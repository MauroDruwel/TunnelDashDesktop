//! Encrypted credential sync via Cloudflare tunnel metadata.
//!
//! Saved SSH credentials are serialized, encrypted with AES-256-GCM and stored
//! in the metadata of one designated "carrier" tunnel (same channel as the
//! auto-assigned ports). The key is derived with PBKDF2-HMAC-SHA256 from either
//! the account's API token (default, zero setup) or a user-chosen passphrase.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

const KDF_ITERATIONS: u32 = 600_000;
const VAULT_VERSION: u32 = 1;

/// One credential as it travels through the sync vault (secrets included).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedCredential {
    pub host: String,
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub key_path: Option<String>,
    #[serde(default)]
    pub key_passphrase: Option<String>,
}

/// The vault embedded into `metadata.tunneldashSshSync` on the carrier tunnel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncVault {
    pub v: u32,
    /// "token" or "passphrase" — which secret the key was derived from.
    pub mode: String,
    pub kdf: KdfParams,
    /// hostname -> base64(nonce || ciphertext || tag)
    pub creds: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdfParams {
    pub alg: String,
    /// base64-encoded random salt; identical across devices.
    pub salt: String,
    pub iter: u32,
}

fn derive_key(mode: &str, secret: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    // Domain-separate so token/passphrase vaults never share keys.
    let input = format!("tunneldash-sync-v1:{mode}:{secret}");
    pbkdf2_hmac::<Sha256>(input.as_bytes(), salt, KDF_ITERATIONS, &mut key);
    key
}

fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("encrypt failed: {e}"))?;
    let mut blob = nonce_bytes.to_vec();
    blob.extend(ct);
    Ok(B64.encode(blob))
}

fn decrypt(key: &[u8; 32], blob_b64: &str) -> Result<Vec<u8>, String> {
    let blob = B64
        .decode(blob_b64)
        .map_err(|_| "corrupt vault entry".to_string())?;
    if blob.len() < 13 {
        return Err("corrupt vault entry".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let pt = cipher
        .decrypt(Nonce::from_slice(&blob[..12]), &blob[12..])
        .map_err(|_| "wrong secret — could not decrypt vault".to_string())?;
    Ok(pt)
}

fn normalize_mode(mode: &str) -> Result<&'static str, String> {
    match mode {
        "token" => Ok("token"),
        "passphrase" => Ok("passphrase"),
        other => Err(format!("unknown sync mode '{other}'")),
    }
}

/// Encrypt credentials into a vault ready to be written to tunnel metadata.
#[tauri::command]
pub fn ssh_sync_build_vault(
    mode: String,
    secret: String,
    salt: Option<String>,
    creds: Vec<SyncedCredential>,
) -> Result<SyncVault, String> {
    let mode = normalize_mode(&mode)?;
    if secret.is_empty() {
        return Err("empty sync secret".into());
    }

    let salt = match salt.filter(|s| !s.trim().is_empty()) {
        Some(s) => s,
        None => {
            let mut bytes = [0u8; 16];
            rand::thread_rng().fill_bytes(&mut bytes);
            B64.encode(bytes)
        }
    };
    let decoded_salt = B64.decode(&salt).map_err(|_| "invalid salt".to_string())?;

    let key = derive_key(mode, &secret, &decoded_salt);
    let mut map = serde_json::Map::new();
    for cred in creds {
        let plaintext = serde_json::to_vec(&cred).map_err(|e| e.to_string())?;
        let blob = encrypt(&key, &plaintext)?;
        map.insert(cred.host.to_lowercase(), serde_json::Value::String(blob));
    }

    Ok(SyncVault {
        v: VAULT_VERSION,
        mode: mode.to_string(),
        kdf: KdfParams {
            alg: "pbkdf2-sha256".into(),
            salt,
            iter: KDF_ITERATIONS,
        },
        creds: map,
    })
}

/// Decrypt a vault pulled from tunnel metadata back into plain credentials.
#[tauri::command]
pub fn ssh_sync_open_vault(
    mode: String,
    secret: String,
    vault: SyncVault,
) -> Result<Vec<SyncedCredential>, String> {
    let mode = normalize_mode(&mode)?;
    if vault.v != VAULT_VERSION {
        return Err(format!("unsupported vault version {}", vault.v));
    }
    if vault.mode != mode {
        return Err(format!("vault uses '{}' mode", vault.mode));
    }
    if secret.is_empty() {
        return Err("empty sync secret".into());
    }
    if vault.kdf.alg != "pbkdf2-sha256" || vault.kdf.iter != KDF_ITERATIONS {
        return Err("unsupported kdf parameters".into());
    }
    let decoded_salt = B64
        .decode(&vault.kdf.salt)
        .map_err(|_| "invalid salt".to_string())?;
    let key = derive_key(mode, &secret, &decoded_salt);

    let mut out = Vec::new();
    for (host, blob) in &vault.creds {
        let Some(blob_str) = blob.as_str() else {
            return Err(format!("corrupt vault entry for '{host}'"));
        };
        let plaintext = decrypt(&key, blob_str)?;
        let mut cred: SyncedCredential = serde_json::from_slice(&plaintext)
            .map_err(|_| format!("corrupt payload for '{host}'"))?;
        // Trust the map key for casing consistency.
        cred.host = host.clone();
        out.push(cred);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<SyncedCredential> {
        vec![
            SyncedCredential {
                host: "prod-db.corp.example.com".into(),
                username: "deploy".into(),
                password: Some("hunter2".into()),
                key_path: None,
                key_passphrase: None,
            },
            SyncedCredential {
                host: "jump.corp.example.com".into(),
                username: "ops".into(),
                password: None,
                key_path: Some("~/.ssh/id_ed25519".into()),
                key_passphrase: Some("keypass".into()),
            },
        ]
    }

    #[test]
    fn vault_roundtrip_token_mode() {
        let vault =
            ssh_sync_build_vault("token".into(), "tok123".into(), None, sample()).expect("build");
        assert_eq!(vault.creds.len(), 2);
        assert_eq!(vault.mode, "token");
        let opened =
            ssh_sync_open_vault("token".into(), "tok123".into(), vault.clone()).expect("open");
        assert_eq!(opened.len(), 2);
        let by_host = |host: &str| {
            opened
                .iter()
                .find(|c| c.host == host)
                .unwrap_or_else(|| panic!("missing {host}"))
        };
        let db = by_host("prod-db.corp.example.com");
        assert_eq!(db.username, "deploy");
        assert_eq!(db.password.as_deref(), Some("hunter2"));
        let jump = by_host("jump.corp.example.com");
        assert_eq!(jump.username, "ops");
        assert_eq!(jump.key_path.as_deref(), Some("~/.ssh/id_ed25519"));
    }

    #[test]
    fn vault_roundtrip_passphrase_mode_and_wrong_secret() {
        let vault =
            ssh_sync_build_vault("passphrase".into(), "correct horse".into(), None, sample())
                .expect("build");
        let err = ssh_sync_open_vault("passphrase".into(), "wrong".into(), vault.clone())
            .expect_err("must fail");
        assert!(err.contains("wrong secret"), "{err}");

        let opened =
            ssh_sync_open_vault("passphrase".into(), "correct horse".into(), vault).expect("open");
        let jump = opened
            .iter()
            .find(|c| c.host == "jump.corp.example.com")
            .expect("jump");
        assert_eq!(jump.key_passphrase.as_deref(), Some("keypass"));
    }

    #[test]
    fn vault_salt_is_stable_across_devices() {
        // Same explicit salt + secret must produce decryptable blobs from any device.
        let salt = "c3RhZHQtc2FsdA==".to_string(); // "stdt-salt"
        let a = ssh_sync_build_vault("token".into(), "T".into(), Some(salt.clone()), sample())
            .expect("a");
        let b = ssh_sync_open_vault("token".into(), "T".into(), a).expect("b");
        assert_eq!(b.len(), 2);
    }

    #[test]
    fn vault_rejects_mode_mismatch() {
        let vault =
            ssh_sync_build_vault("token".into(), "T".into(), None, sample()).expect("build");
        let err = ssh_sync_open_vault("passphrase".into(), "T".into(), vault)
            .expect_err("mode mismatch must fail");
        assert!(err.contains("'token'"), "{err}");
    }
}
