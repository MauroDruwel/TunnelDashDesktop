use reqwest::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Serialize, Deserialize)]
pub struct CloudflareError {
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CloudflareResponse<T> {
    pub success: Option<bool>,
    pub errors: Option<Vec<CloudflareError>>,
    pub result: Option<T>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Tunnel {
    pub id: String,
    pub name: String,
    pub status: Option<String>,
    pub created_at: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub connections: Option<Vec<Connection>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Connection {
    pub id: Option<String>,
    pub uuid: Option<String>,
    pub colo_name: Option<String>,
    pub origin_ip: Option<String>,
    pub client_version: Option<String>,
    pub opened_at: Option<String>,
    pub is_pending_reconnect: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TunnelConfig {
    pub result: Option<serde_json::Value>,
}

static HTTP: once_cell::sync::Lazy<Client> = once_cell::sync::Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("tunneldash-desktop/0.2")
        .build()
        .expect("http client build failed")
});

#[tauri::command]
pub async fn cf_accounts(token: String) -> Result<CloudflareResponse<Vec<Account>>, String> {
    let url = "https://api.cloudflare.com/client/v4/accounts";
    http_get(url, &token).await
}

#[tauri::command]
pub async fn cf_tunnels(
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
pub async fn cf_tunnel_config(
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
            if body.result.is_none() {
                body.result = Some(serde_json::json!({}));
            }
            body
        })
}

pub async fn http_get<T: DeserializeOwned + Serialize>(
    url: &str,
    token: &str,
) -> Result<T, String> {
    let resp = HTTP
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Cloudflare request failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .json::<T>()
        .await
        .map_err(|e| format!("Cloudflare response parse failed: {e}"))?;

    if !status.is_success() {
        let err_msg = extract_error(&body).unwrap_or_else(|| "Cloudflare request failed".into());
        return Err(err_msg);
    }

    Ok(body)
}

pub fn extract_error<T: Serialize>(body: &T) -> Option<String> {
    let val = serde_json::to_value(body).ok()?;
    let cf = serde_json::from_value::<CloudflareResponse<serde_json::Value>>(val).ok()?;
    cf.errors
        .and_then(|mut errs| errs.drain(..).next())
        .and_then(|e| e.message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_error_reads_first_message() {
        let body = serde_json::json!({
            "success": false,
            "errors": [{"code": 1003, "message": "bad token"}, {"code": 1, "message": "second"}],
        });
        let err = extract_error(&body).unwrap();
        assert_eq!(err, "bad token");
    }

    #[test]
    fn extract_error_returns_none_for_unknown_shape() {
        let body = serde_json::json!({"foo": 1});
        assert!(extract_error(&body).is_none());
    }
}
