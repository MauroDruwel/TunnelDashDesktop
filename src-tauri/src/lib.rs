use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::HashMap;
use std::process::{Child, Command};
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize)]
struct CloudflareError {
    message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CloudflareResponse<T> {
    success: Option<bool>,
    errors: Option<Vec<CloudflareError>>,
    result: Option<T>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Account {
    id: String,
    name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Tunnel {
    id: String,
    name: String,
    status: Option<String>,
    created_at: Option<String>,
    metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TunnelConfig {
    result: Option<serde_json::Value>,
}

// stash running cloudflared child processes so we can stop them later
static ACTIVE: Lazy<Mutex<HashMap<String, Child>>> = Lazy::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
async fn cf_accounts(token: String) -> Result<CloudflareResponse<Vec<Account>>, String> {
    let url = "https://api.cloudflare.com/client/v4/accounts";
    http_get(url, &token).await
}

#[tauri::command]
async fn cf_tunnels(
    token: String,
    account_id: String,
) -> Result<CloudflareResponse<Vec<Tunnel>>, String> {
    let url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{}/cfd_tunnel?is_deleted=false",
        account_id
    );
    http_get(&url, &token).await
}

#[tauri::command]
async fn cf_tunnel_config(
    token: String,
    account_id: String,
    tunnel_id: String,
) -> Result<TunnelConfig, String> {
    let url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{}/cfd_tunnel/{}/configurations",
        account_id, tunnel_id
    );

    http_get::<TunnelConfig>(&url, &token)
        .await
        .map(|mut body| {
            // Cloudflare nests the useful bits under `result`, so ensure we return an object.
            if body.result.is_none() {
                body.result = Some(serde_json::json!({}));
            }
            body
        })
}

#[tauri::command]
async fn start_tunnel(hostname: String, local_port: u16, protocol: Option<String>) -> Result<(), String> {
    let mut active = ACTIVE.lock().unwrap();

    if active.contains_key(&hostname) {
        // already running for this host, don't spawn dupes
        return Ok(());
    }

    let url = format!("localhost:{local_port}");
    let proto = protocol.unwrap_or_else(|| "tcp".into());

    let mut cmd = Command::new("cloudflared");
    match proto.as_str() {
        "ssh" => {
            cmd.args(["access", "ssh", "--hostname", hostname.as_str(), "--url", url.as_str()]);
        }
        _ => {
            cmd.args(["access", "tcp", "--hostname", hostname.as_str(), "--url", url.as_str()]);
        }
    }

    let child = cmd.spawn().map_err(|e| e.to_string())?;

    active.insert(hostname, child);
    Ok(())
}

#[tauri::command]
async fn stop_tunnel(hostname: String) -> Result<(), String> {
    let mut active = ACTIVE.lock().unwrap();
    if let Some(mut child) = active.remove(&hostname) {
        // best effort kill, no drama if it's already gone
        let _ = child.kill();
    }
    Ok(())
}

async fn http_get<T: DeserializeOwned + Serialize>(url: &str, token: &str) -> Result<T, String> {
    let client = Client::new();
    let resp = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let body = resp.json::<T>().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        let err_msg = extract_error(&body).unwrap_or_else(|| "Cloudflare request failed".into());
        return Err(err_msg);
    }

    Ok(body)
}

fn extract_error<T: Serialize>(body: &T) -> Option<String> {
    // best effort: try to coerce whatever we got into the CloudflareResponse shape
    let val = serde_json::to_value(body).ok()?;
    if let Ok(cf) = serde_json::from_value::<CloudflareResponse<serde_json::Value>>(val) {
        return cf
            .errors
            .and_then(|mut errs| errs.drain(..).next())
            .and_then(|e| e.message);
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            cf_accounts,
            cf_tunnels,
            cf_tunnel_config,
            start_tunnel,
            stop_tunnel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
