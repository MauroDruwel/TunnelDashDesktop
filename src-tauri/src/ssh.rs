use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use once_cell::sync::Lazy;
use russh::client::{self, Handle};
use russh::keys::PrivateKeyWithHashAlg;
use russh::{Channel, ChannelMsg};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    pub cols: Option<u32>,
    pub rows: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SshAuth {
    Password {
        password: String,
    },
    Key {
        key_path: Option<String>,
        key_content: Option<String>,
        passphrase: Option<String>,
    },
}

enum SshCommand {
    Data(Vec<u8>),
    Resize(u32, u32),
    Close,
}

struct SshSession {
    tx: mpsc::Sender<SshCommand>,
}

static SESSIONS: Lazy<Mutex<HashMap<u64, SshSession>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Serialize)]
struct SshOutput {
    id: u64,
    data: String,
}

#[derive(Clone, Serialize)]
struct SshClosed {
    id: u64,
    error: Option<String>,
}

#[derive(Clone)]
struct SshHandler;

impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

#[tauri::command]
pub fn ssh_connect(app: AppHandle, config: SshConnectConfig) -> Result<u64, String> {
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel::<SshCommand>(256);

    SESSIONS.lock().unwrap().insert(id, SshSession { tx });

    tauri::async_runtime::spawn(async move {
        let result = run_session(app.clone(), id, config, rx).await;
        let error = result.err();
        SESSIONS.lock().unwrap().remove(&id);
        let _ = app.emit("ssh-closed", SshClosed { id, error });
    });

    Ok(id)
}

#[tauri::command]
pub fn ssh_write(id: u64, data: String) -> Result<(), String> {
    let decoded = B64
        .decode(data)
        .map_err(|e| format!("invalid input payload: {e}"))?;
    let sessions = SESSIONS.lock().unwrap();
    let session = sessions
        .get(&id)
        .ok_or_else(|| "no such ssh session".to_string())?;
    session
        .tx
        .blocking_send(SshCommand::Data(decoded))
        .map_err(|_| "session closed".to_string())
}

#[tauri::command]
pub fn ssh_resize(id: u64, cols: u32, rows: u32) -> Result<(), String> {
    let sessions = SESSIONS.lock().unwrap();
    let session = sessions
        .get(&id)
        .ok_or_else(|| "no such ssh session".to_string())?;
    session
        .tx
        .blocking_send(SshCommand::Resize(cols, rows))
        .map_err(|_| "session closed".to_string())
}

#[tauri::command]
pub fn ssh_close(id: u64) -> Result<(), String> {
    let sessions = SESSIONS.lock().unwrap();
    if let Some(session) = sessions.get(&id) {
        let _ = session.tx.blocking_send(SshCommand::Close);
    }
    Ok(())
}

async fn run_session(
    app: AppHandle,
    id: u64,
    config: SshConnectConfig,
    mut rx: mpsc::Receiver<SshCommand>,
) -> Result<(), String> {
    let channel = Arc::new(tokio::sync::Mutex::new(
        connect_and_open_shell(&config).await?,
    ));

    loop {
        tokio::select! {
            cmd = rx.recv() => {
                match cmd {
                    Some(SshCommand::Data(data)) => {
                        let ch = channel.lock().await;
                        let _ = ch.data(&mut &data[..]).await;
                    }
                    Some(SshCommand::Resize(cols, rows)) => {
                        let ch = channel.lock().await;
                        let _ = ch.window_change(cols, rows, 0, 0).await;
                    }
                    Some(SshCommand::Close) | None => break,
                }
            }
            msg = channel_next(channel.clone()) => {
                match msg {
                    Some(ChannelMsg::Data { data }) => emit_output(&app, id, &data),
                    Some(ChannelMsg::ExtendedData { data, .. }) => emit_output(&app, id, &data),
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
    }

    Ok(())
}

pub(crate) async fn connect_and_open_shell(
    config: &SshConnectConfig,
) -> Result<Channel<russh::client::Msg>, String> {
    let client_config = Arc::new(client::Config {
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 3,
        ..client::Config::default()
    });

    let mut session = client::connect(client_config, (&config.host[..], config.port), SshHandler)
        .await
        .map_err(|e| format!("ssh connect failed: {e}"))?;

    authenticate(&mut session, config).await?;

    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("channel open failed: {e}"))?;

    let cols = config.cols.unwrap_or(80).max(20);
    let rows = config.rows.unwrap_or(24).max(5);

    channel
        .request_pty(true, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .map_err(|e| format!("pty request failed: {e}"))?;
    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("shell request failed: {e}"))?;

    Ok(channel)
}

async fn channel_next(
    channel: Arc<tokio::sync::Mutex<Channel<russh::client::Msg>>>,
) -> Option<ChannelMsg> {
    let mut guard = channel.lock().await;
    guard.wait().await
}

async fn authenticate(
    session: &mut Handle<SshHandler>,
    config: &SshConnectConfig,
) -> Result<(), String> {
    match &config.auth {
        SshAuth::Password { password } => {
            let res = session
                .authenticate_password(&config.username, password)
                .await
                .map_err(|e| format!("password auth failed: {e}"))?;
            if !res.success() {
                return Err("authentication failed".into());
            }
        }
        SshAuth::Key {
            key_path,
            key_content,
            passphrase,
        } => {
            let key = if let Some(content) = key_content.as_deref().filter(|c| !c.is_empty()) {
                russh::keys::decode_secret_key(content, passphrase.as_deref())
            } else if let Some(path) = key_path {
                russh::keys::load_secret_key(path, passphrase.as_deref())
            } else {
                return Err("no key file or key content provided".into());
            }
            .map_err(|e| format!("could not load private key: {e}"))?;

            let hash = if key.algorithm().is_rsa() {
                session
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|e| format!("rsa hash negotiation failed: {e}"))?
                    .flatten()
            } else {
                None
            };

            let res = session
                .authenticate_publickey(
                    &config.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                )
                .await
                .map_err(|e| format!("public key auth failed: {e}"))?;
            if !res.success() {
                return Err("authentication failed".into());
            }
        }
    }
    Ok(())
}

fn emit_output(app: &AppHandle, id: u64, data: &[u8]) {
    if data.is_empty() {
        return;
    }
    let _ = app.emit(
        "ssh-output",
        SshOutput {
            id,
            data: B64.encode(data),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn read_until<F: Fn(&str) -> bool>(
        channel: &mut Channel<russh::client::Msg>,
        predicate: F,
        timeout: Duration,
    ) -> String {
        let mut buffer = String::new();
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            match tokio::time::timeout(remaining, channel.wait()).await {
                Ok(Some(ChannelMsg::Data { data })) => {
                    buffer.push_str(&String::from_utf8_lossy(&data));
                    if predicate(&buffer) {
                        break;
                    }
                }
                Ok(Some(ChannelMsg::Eof)) | Ok(Some(ChannelMsg::Close)) | Ok(None) => break,
                Ok(_) => {}
                Err(_) => break,
            }
        }
        buffer
    }

    #[tokio::test]
    #[ignore = "requires network access to a public SSH server"]
    async fn ssh_shell_roundtrip_against_live_server() {
        let config = SshConnectConfig {
            host: "test.rebex.net".into(),
            port: 22,
            username: "demo".into(),
            auth: SshAuth::Password {
                password: "password".into(),
            },
            cols: Some(80),
            rows: Some(24),
        };

        let mut channel = connect_and_open_shell(&config)
            .await
            .expect("connect, auth, pty and shell should succeed");

        let banner = read_until(
            &mut channel,
            |buf| buf.contains("$"),
            Duration::from_secs(20),
        )
        .await;
        assert!(
            banner.contains("$"),
            "expected a shell prompt, got: {banner:?}"
        );

        let bytes = b"echo tunneldash-e2e-ok; echo DONE\n";
        channel
            .data(&mut &bytes[..])
            .await
            .expect("command write should succeed");

        let output = read_until(
            &mut channel,
            |buf| buf.contains("DONE"),
            Duration::from_secs(20),
        )
        .await;
        assert!(
            output.contains("tunneldash-e2e-ok") && output.contains("DONE"),
            "expected command echo + output, got: {output:?}"
        );

        channel
            .window_change(100, 40, 0, 0)
            .await
            .expect("resize should succeed");
        channel.eof().await.expect("eof should succeed");
    }
}
