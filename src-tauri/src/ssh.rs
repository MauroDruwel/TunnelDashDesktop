#[cfg(not(target_os = "macos"))]
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::Manager;

const SERVICE: &str = "be.maurodruwel.tunneldash";

#[derive(Debug, Serialize, Deserialize)]
pub struct SshCredential {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshCredentialInfo {
    pub username: Option<String>,
    pub has_password: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshOpenRequest {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub use_saved: bool,
}

#[cfg(not(target_os = "macos"))]
fn entry_for(host: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, host).map_err(|e| format!("keychain unavailable: {e}"))
}

#[cfg(target_os = "macos")]
fn store_credential(host: &str, username: &str, password: &str) -> Result<(), String> {
    let payload = serde_json::to_string(&SshCredential {
        username: username.to_string(),
        password: password.to_string(),
    })
    .map_err(|e| format!("could not serialize credential: {e}"))?;
    let output = Command::new("security")
        .args([
            "add-generic-password",
            "-a",
            host,
            "-s",
            SERVICE,
            "-w",
            &payload,
            "-U",
        ])
        .output()
        .map_err(|e| format!("could not run security tool: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "could not save to keychain: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn read_credential(host: &str) -> Result<Option<SshCredential>, String> {
    let output = Command::new("security")
        .args(["find-generic-password", "-a", host, "-s", SERVICE, "-w"])
        .output()
        .map_err(|e| format!("could not run security tool: {e}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let payload = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let cred = serde_json::from_str::<SshCredential>(&payload)
        .map_err(|_| "saved credentials are corrupt".to_string())?;
    Ok(Some(cred))
}

#[cfg(target_os = "macos")]
fn delete_credential(host: &str) -> Result<(), String> {
    let output = Command::new("security")
        .args(["delete-generic-password", "-a", host, "-s", SERVICE])
        .output()
        .map_err(|e| format!("could not run security tool: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.contains("could not be found") {
            return Err(format!("could not clear keychain entry: {}", stderr.trim()));
        }
    }
    Ok(())
}

pub fn credential_for(host: &str) -> Result<Option<SshCredential>, String> {
    #[cfg(target_os = "macos")]
    {
        read_credential(host)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let entry = entry_for(host)?;
        let payload = match entry.get_password() {
            Ok(p) => p,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(e) => return Err(format!("could not read keychain: {e}")),
        };
        let cred = serde_json::from_str::<SshCredential>(&payload)
            .map_err(|_| "saved credentials are corrupt".to_string())?;
        Ok(Some(cred))
    }
}

#[tauri::command]
pub fn ssh_save_credential(host: String, username: String, password: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        store_credential(&host, &username, &password)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let entry = entry_for(&host)?;
        let payload = serde_json::to_string(&SshCredential { username, password })
            .map_err(|e| format!("could not serialize credential: {e}"))?;
        entry
            .set_password(&payload)
            .map_err(|e| format!("could not save to keychain: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_get_credential(host: String) -> Result<SshCredentialInfo, String> {
    let cred = credential_for(&host)?;
    Ok(match cred {
        Some(c) => SshCredentialInfo {
            username: Some(c.username),
            has_password: true,
        },
        None => SshCredentialInfo {
            username: None,
            has_password: false,
        },
    })
}

#[tauri::command]
pub fn ssh_delete_credential(host: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        delete_credential(&host)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let entry = entry_for(&host)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("could not clear keychain entry: {e}")),
        }?;
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_open(app: tauri::AppHandle, request: SshOpenRequest) -> Result<String, String> {
    let (username, password) = if request.use_saved {
        let cred = credential_for(&request.host)?
            .ok_or_else(|| "no saved credentials for this host".to_string())?;
        (cred.username, cred.password)
    } else {
        let username = request
            .username
            .ok_or_else(|| "username is required".to_string())?;
        let password = request
            .password
            .ok_or_else(|| "password is required".to_string())?;
        ssh_save_credential(request.host.clone(), username.clone(), password.clone())?;
        (username, password)
    };

    let port = request.port;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("could not resolve cache dir: {e}"))?;
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("could not create cache dir: {e}"))?;

    let command = format!("ssh -p {port} {username}@localhost");
    launch_in_terminal(&cache_dir, &command, &password)?;
    Ok(command)
}

fn launch_in_terminal(
    cache_dir: &std::path::Path,
    command: &str,
    password: &str,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let askpass = write_askpass_helper(cache_dir, password)?;
        let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "tell application \"Terminal\"\nactivate\nset w to do script \"export SSH_ASKPASS='{}' SSH_ASKPASS_REQUIRE=force; {}\"\nend tell",
            askpass.display(),
            escaped
        );
        let output = Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map_err(|e| format!("could not launch Terminal.app: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "could not launch Terminal.app: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows OpenSSH reads SSH_ASKPASS too, but a shell script is not
        // executable there - open a plain session and let the user type the
        // password (credentials are still saved in the keychain).
        Command::new("cmd")
            .args(["/c", "start", "", "cmd", "/k", command])
            .spawn()
            .map_err(|e| format!("could not open a terminal: {e}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let askpass = write_askpass_helper(cache_dir, password)?;
        let terminal = std::env::var("TERMINAL")
            .or_else(|_| {
                Command::new("which")
                    .arg("x-terminal-emulator")
                    .output()
                    .ok()
                    .filter(|o| o.status.success())
                    .map(|_| "x-terminal-emulator".to_string())
            })
            .map_err(|_| "no terminal emulator found".to_string())?;

        Command::new(&terminal)
            .arg("-e")
            .arg("sh")
            .arg("-c")
            .arg(command)
            .env("SSH_ASKPASS", &askpass)
            .env("SSH_ASKPASS_REQUIRE", "force")
            .spawn()
            .map_err(|e| format!("could not open a terminal: {e}"))?;
    }

    Ok(())
}

#[cfg(unix)]
fn write_askpass_helper(
    cache_dir: &std::path::Path,
    password: &str,
) -> Result<std::path::PathBuf, String> {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    let password_path = cache_dir.join("ssh-pass");
    let askpass_path = cache_dir.join("ssh-askpass.sh");

    let mut pw = std::fs::File::create(&password_path)
        .map_err(|e| format!("could not write password helper: {e}"))?;
    pw.write_all(password.as_bytes())
        .map_err(|e| format!("could not write password helper: {e}"))?;
    std::fs::set_permissions(&password_path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("could not secure password helper: {e}"))?;

    let mut ask = std::fs::File::create(&askpass_path)
        .map_err(|e| format!("could not write askpass helper: {e}"))?;
    writeln!(ask, "#!/bin/sh")
        .and_then(|_| writeln!(ask, "cat '{}'", password_path.display()))
        .map_err(|e| format!("could not write askpass helper: {e}"))?;
    std::fs::set_permissions(&askpass_path, std::fs::Permissions::from_mode(0o700))
        .map_err(|e| format!("could not secure askpass helper: {e}"))?;

    Ok(askpass_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "touches the real OS keychain"]
    fn keychain_roundtrip() {
        let host = format!("test-{}", std::process::id());
        ssh_save_credential(host.clone(), "alice".into(), "s3cret".into()).expect("save");
        let info = ssh_get_credential(host.clone()).expect("get");
        assert_eq!(info.username.as_deref(), Some("alice"));
        assert!(info.has_password);
        ssh_delete_credential(host.clone()).expect("delete");
        let gone = ssh_get_credential(host).expect("get after delete");
        assert!(!gone.has_password);
    }

    #[test]
    #[ignore = "opens Terminal.app on the host"]
    fn launch_in_terminal_opens_native_terminal() {
        let dir = std::env::temp_dir().join(format!("tunneldash-launch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        launch_in_terminal(&dir, "echo tunneldash-launch-ok && exit", "test-pass").expect("launch");
    }
}
