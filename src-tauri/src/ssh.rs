#[cfg(not(target_os = "macos"))]
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

const SERVICE: &str = "be.maurodruwel.tunneldash";

#[derive(Debug, Serialize, Deserialize)]
pub struct SshCredential {
    pub username: String,
    pub password: Option<String>,
    #[serde(default)]
    pub key_path: Option<String>,
    #[serde(default)]
    pub key_passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshCredentialInfo {
    pub username: Option<String>,
    pub has_password: bool,
    pub has_key: bool,
    pub auth_type: Option<String>,
    #[serde(default)]
    pub key_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigStatus {
    pub config_path: String,
    pub file_exists: bool,
    pub managed_hosts: Vec<String>,
    pub cloudflared_command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostConfig {
    pub host: String,
    #[serde(default)]
    pub alias: Option<String>,
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub key_path: Option<String>,
}

#[cfg(not(target_os = "macos"))]
fn entry_for(host: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, host).map_err(|e| format!("keychain unavailable: {e}"))
}

#[cfg(target_os = "macos")]
fn store_credential_json(host: &str, payload: &str) -> Result<(), String> {
    let output = Command::new("security")
        .args([
            "add-generic-password",
            "-a",
            host,
            "-s",
            SERVICE,
            "-w",
            payload,
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
pub fn ssh_save_credential(
    host: String,
    username: String,
    password: Option<String>,
    key_path: Option<String>,
    key_passphrase: Option<String>,
) -> Result<(), String> {
    let existing = credential_for(&host).ok().flatten();

    let key_path_clean = key_path.filter(|p| !p.trim().is_empty());
    let is_key_auth = key_path_clean.is_some();

    let (final_password, final_key_path, final_key_passphrase) = if is_key_auth {
        let passphrase = key_passphrase.filter(|p| !p.trim().is_empty());
        (None, key_path_clean, passphrase)
    } else {
        let clean_pw = password.filter(|p| !p.trim().is_empty());
        let pw = clean_pw.or_else(|| existing.and_then(|c| c.password));
        (pw, None, None)
    };

    let payload = serde_json::to_string(&SshCredential {
        username,
        password: final_password,
        key_path: final_key_path,
        key_passphrase: final_key_passphrase,
    })
    .map_err(|e| format!("could not serialize credential: {e}"))?;

    #[cfg(target_os = "macos")]
    {
        store_credential_json(&host, &payload)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let entry = entry_for(&host)?;
        entry
            .set_password(&payload)
            .map_err(|e| format!("could not save to keychain: {e}"))?;
    }

    // If this host is currently managed in ~/.ssh/config, update its block too
    let (current_managed, exists, _) = read_managed_hosts_from_config();
    if exists && current_managed.contains(&host) {
        let remaining_configs = current_managed
            .into_iter()
            .map(|h| {
                let mut cfg = SshHostConfig {
                    host: h.clone(),
                    alias: None,
                    hostname: Some(h.clone()),
                    username: None,
                    key_path: None,
                };
                if let Ok(Some(cred)) = credential_for(&h) {
                    cfg.username = Some(cred.username);
                    cfg.key_path = cred.key_path;
                }
                cfg
            })
            .collect::<Vec<_>>();
        let _ = write_ssh_config(&generate_ssh_config_block(&remaining_configs));
    }

    Ok(())
}

#[tauri::command]
pub fn ssh_get_credential(host: String) -> Result<SshCredentialInfo, String> {
    let cred = credential_for(&host)?;
    Ok(match cred {
        Some(c) => {
            let has_key = c
                .key_path
                .as_ref()
                .map(|p| !p.trim().is_empty())
                .unwrap_or(false);
            let has_password = c.password.as_ref().map(|p| !p.is_empty()).unwrap_or(false);
            let auth_type = if has_key {
                Some("key".to_string())
            } else {
                Some("password".to_string())
            };
            SshCredentialInfo {
                username: Some(c.username),
                has_password,
                has_key,
                auth_type,
                key_path: c.key_path,
            }
        }
        None => SshCredentialInfo {
            username: None,
            has_password: false,
            has_key: false,
            auth_type: None,
            key_path: None,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshCredentialSummary {
    pub host: String,
    pub username: Option<String>,
    pub has_password: bool,
    pub has_key: bool,
}

fn summarize_host(host: &str) -> Result<Option<SshCredentialSummary>, String> {
    let cred = credential_for(host)?;
    Ok(cred.map(|c| SshCredentialSummary {
        host: host.to_string(),
        username: Some(c.username),
        has_password: c.password.as_ref().map(|p| !p.is_empty()).unwrap_or(false),
        has_key: c
            .key_path
            .as_ref()
            .map(|p| !p.trim().is_empty())
            .unwrap_or(false),
    }))
}

/// Extract `"acct"<blob>="value"` / `"svce"<blob>="value"` attribute values from
/// one line of `security dump-keychain` output.
fn extract_blob_attr<'a>(line: &'a str, name: &str) -> Option<&'a str> {
    let idx = line.find(name)?;
    let rest = line[idx + name.len()..].trim_start();
    let rest = rest.strip_prefix("<blob>=")?.trim();
    let value = rest.strip_prefix('"')?.strip_suffix('"')?;
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/// Parse `security dump-keychain` output and return every account whose service
/// matches ours (one item per keychain record; records start at `class:` lines).
fn parse_dump_accounts(output: &str, service: &str) -> Vec<String> {
    let mut accounts: Vec<String> = Vec::new();
    let mut acct: Option<String> = None;
    let mut svc: Option<String> = None;

    let mut flush = |acct: &mut Option<String>, svc: &mut Option<String>| {
        if svc.as_deref() == Some(service) {
            if let Some(a) = acct.take() {
                if !accounts.contains(&a) {
                    accounts.push(a);
                }
            }
        }
        *svc = None;
        *acct = None;
    };

    for line in output.lines() {
        if line.starts_with("keychain:") || line.starts_with("class:") {
            flush(&mut acct, &mut svc);
            continue;
        }
        if let Some(v) = extract_blob_attr(line, "\"acct\"") {
            acct = Some(v.to_string());
        } else if let Some(v) = extract_blob_attr(line, "\"svce\"") {
            svc = Some(v.to_string());
        }
    }
    flush(&mut acct, &mut svc);
    accounts
}

/// List every SSH credential stored for this app. On macOS all keychain items
/// with our service are enumerated (including hosts whose tunnels were removed);
/// elsewhere we can only probe the candidate tunnel hosts handed to us.
#[tauri::command]
#[cfg_attr(target_os = "macos", allow(unused_variables))]
pub fn ssh_list_credentials(
    hosts: Option<Vec<String>>,
) -> Result<Vec<SshCredentialSummary>, String> {
    #[cfg(target_os = "macos")]
    let accounts = enumerate_hosts()?;
    #[cfg(not(target_os = "macos"))]
    let accounts = hosts.into_iter().flatten().collect::<Vec<_>>();

    let mut summaries = Vec::new();
    for account in accounts {
        match summarize_host(&account) {
            Ok(Some(s)) => summaries.push(s),
            // The item vanished between listing and reading, or its payload
            // was written by another tool — skip rather than fail the list.
            _ => continue,
        }
    }
    summaries.sort_by(|a, b| a.host.cmp(&b.host));
    Ok(summaries)
}

/// Enumerate every account stored under our service (macOS only).
#[cfg(target_os = "macos")]
fn enumerate_hosts() -> Result<Vec<String>, String> {
    let output = Command::new("security")
        .args(["dump-keychain"])
        .output()
        .map_err(|e| format!("could not run security tool: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "could not read keychain: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(parse_dump_accounts(&text, SERVICE))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshFullCredential {
    pub host: String,
    pub username: String,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub key_passphrase: Option<String>,
}

/// Full secrets for every saved credential — used by the sync feature to push
/// an encrypted copy of the local keychain to Cloudflare.
#[tauri::command]
#[cfg_attr(target_os = "macos", allow(unused_variables))]
pub fn ssh_export_local(hosts: Option<Vec<String>>) -> Result<Vec<SshFullCredential>, String> {
    #[cfg(target_os = "macos")]
    let candidates = enumerate_hosts()?;
    #[cfg(not(target_os = "macos"))]
    let candidates = hosts.into_iter().flatten().collect::<Vec<_>>();

    let mut out = Vec::new();
    for host in candidates {
        if let Ok(Some(c)) = credential_for(&host) {
            out.push(SshFullCredential {
                host,
                username: c.username,
                password: c.password,
                key_path: c.key_path,
                key_passphrase: c.key_passphrase,
            });
        }
    }
    out.sort_by(|a, b| a.host.cmp(&b.host));
    Ok(out)
}

pub const MANAGED_START: &str = "# >>> TunnelDash managed SSH configuration >>>";
pub const MANAGED_END: &str = "# <<< TunnelDash managed SSH configuration <<<";

pub fn get_ssh_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "could not determine user home directory".to_string())?;
    Ok(home.join(".ssh"))
}

pub fn get_ssh_config_path() -> Result<PathBuf, String> {
    Ok(get_ssh_dir()?.join("config"))
}

pub fn detect_cloudflared_command() -> String {
    #[cfg(target_os = "windows")]
    {
        for candidate in [
            "C:\\Program Files\\cloudflared\\cloudflared.exe",
            "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
        ] {
            if Path::new(candidate).exists() {
                return format!("\"{}\"", candidate);
            }
        }
        "cloudflared.exe".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        for candidate in [
            "/opt/homebrew/bin/cloudflared",
            "/usr/local/bin/cloudflared",
            "/usr/bin/cloudflared",
        ] {
            if Path::new(candidate).exists() {
                return candidate.to_string();
            }
        }
        if let Some(bin) = crate::tunnels::resolve_cloudflared(None) {
            let s = bin.to_string_lossy().to_string();
            if !s.contains("/target/") && !s.contains("/node_modules/") {
                return s;
            }
        }
        "cloudflared".to_string()
    }
}

pub fn generate_ssh_config_block(hosts: &[SshHostConfig]) -> String {
    if hosts.is_empty() {
        return String::new();
    }
    let cf_bin = detect_cloudflared_command();
    let mut block = String::new();
    block.push_str(MANAGED_START);
    block.push_str("\n# Automatically generated by TunnelDash. Any manual changes inside this block will be overwritten.\n");

    for h in hosts {
        let target = h.hostname.as_deref().unwrap_or(&h.host);
        let host_line = match &h.alias {
            Some(a) if !a.trim().is_empty() => a.trim(),
            _ => target,
        };

        block.push_str(&format!("\nHost {}\n", host_line));
        block.push_str(&format!("    HostName {}\n", target));
        block.push_str(&format!(
            "    ProxyCommand {} access ssh --hostname %h\n",
            cf_bin
        ));
        if let Some(user) = &h.username {
            let u = user.trim();
            if !u.is_empty() {
                block.push_str(&format!("    User {}\n", u));
            }
        }
        if let Some(key) = &h.key_path {
            let k = key.trim();
            if !k.is_empty() {
                block.push_str(&format!("    IdentityFile {}\n", k));
            }
        }
    }
    block.push_str(&format!("\n{}", MANAGED_END));
    block
}

pub fn update_ssh_config_content(existing: &str, new_block: &str) -> String {
    let has_start = existing.find(MANAGED_START);
    let has_end = existing.find(MANAGED_END);

    match (has_start, has_end) {
        (Some(start), Some(end)) if end >= start => {
            let end_idx = end + MANAGED_END.len();
            let before = existing[..start].trim_end();
            let after = existing[end_idx..].trim_start();
            let block = new_block.trim();

            if block.is_empty() {
                if before.is_empty() {
                    if after.is_empty() {
                        String::new()
                    } else {
                        format!("{}\n", after)
                    }
                } else if after.is_empty() {
                    format!("{}\n", before)
                } else {
                    format!("{}\n\n{}\n", before, after)
                }
            } else if before.is_empty() {
                if after.is_empty() {
                    format!("{}\n", block)
                } else {
                    format!("{}\n\n{}\n", block, after)
                }
            } else if after.is_empty() {
                format!("{}\n\n{}\n", before, block)
            } else {
                format!("{}\n\n{}\n\n{}\n", before, block, after)
            }
        }
        _ => {
            let block = new_block.trim();
            if block.is_empty() {
                existing.to_string()
            } else if existing.trim().is_empty() {
                format!("{}\n", block)
            } else {
                format!("{}\n\n{}\n", existing.trim_end(), block)
            }
        }
    }
}

pub fn read_managed_hosts_from_config() -> (Vec<String>, bool, PathBuf) {
    let Ok(path) = get_ssh_config_path() else {
        return (Vec::new(), false, PathBuf::new());
    };
    if !path.exists() {
        return (Vec::new(), false, path);
    }
    let Ok(content) = std::fs::read_to_string(&path) else {
        return (Vec::new(), true, path);
    };
    let Some(start) = content.find(MANAGED_START) else {
        return (Vec::new(), true, path);
    };
    let Some(end) = content.find(MANAGED_END) else {
        return (Vec::new(), true, path);
    };
    if end <= start {
        return (Vec::new(), true, path);
    }
    let block = &content[start + MANAGED_START.len()..end];
    let mut hosts = Vec::new();
    for line in block.lines() {
        let trimmed = line.trim();
        if let Some(host_val) = trimmed.strip_prefix("Host ") {
            for part in host_val.split_whitespace() {
                let h = part.trim();
                if !h.is_empty() && !hosts.contains(&h.to_string()) {
                    hosts.push(h.to_string());
                }
            }
        } else if let Some(hn_val) = trimmed.strip_prefix("HostName ") {
            let hn = hn_val.trim();
            if !hn.is_empty() && !hosts.contains(&hn.to_string()) {
                hosts.push(hn.to_string());
            }
        }
    }
    (hosts, true, path)
}

pub fn write_ssh_config(new_block: &str) -> Result<(), String> {
    let ssh_dir = get_ssh_dir()?;
    if !ssh_dir.exists() {
        std::fs::create_dir_all(&ssh_dir)
            .map_err(|e| format!("could not create ~/.ssh directory: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&ssh_dir, std::fs::Permissions::from_mode(0o700));
        }
    }

    let config_path = ssh_dir.join("config");
    let existing = if config_path.exists() {
        std::fs::read_to_string(&config_path)
            .map_err(|e| format!("could not read {}: {e}", config_path.display()))?
    } else {
        String::new()
    };

    let updated = update_ssh_config_content(&existing, new_block);
    std::fs::write(&config_path, updated.as_bytes())
        .map_err(|e| format!("could not write {}: {e}", config_path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&config_path, std::fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

#[tauri::command]
pub fn ssh_get_config_status() -> Result<SshConfigStatus, String> {
    let (managed_hosts, file_exists, path) = read_managed_hosts_from_config();
    Ok(SshConfigStatus {
        config_path: path.display().to_string(),
        file_exists,
        managed_hosts,
        cloudflared_command: detect_cloudflared_command(),
    })
}

#[tauri::command]
pub fn ssh_sync_config(hosts: Vec<SshHostConfig>) -> Result<SshConfigStatus, String> {
    let mut resolved_hosts = Vec::new();
    for mut h in hosts {
        if h.username.is_none() || h.key_path.is_none() {
            if let Ok(Some(cred)) = credential_for(&h.host) {
                if h.username.is_none() && !cred.username.trim().is_empty() {
                    h.username = Some(cred.username);
                }
                if h.key_path.is_none() {
                    h.key_path = cred.key_path;
                }
            }
        }
        resolved_hosts.push(h);
    }

    let block = generate_ssh_config_block(&resolved_hosts);
    write_ssh_config(&block)?;
    ssh_get_config_status()
}

#[tauri::command]
pub fn ssh_remove_from_config(hosts: Vec<String>) -> Result<SshConfigStatus, String> {
    let (current_hosts, _, _) = read_managed_hosts_from_config();
    let remaining_hostnames: Vec<String> = current_hosts
        .into_iter()
        .filter(|h| !hosts.contains(h))
        .collect();

    let mut remaining_configs = Vec::new();
    for host in remaining_hostnames {
        let mut cfg = SshHostConfig {
            host: host.clone(),
            alias: None,
            hostname: Some(host.clone()),
            username: None,
            key_path: None,
        };
        if let Ok(Some(cred)) = credential_for(&host) {
            cfg.username = Some(cred.username);
            cfg.key_path = cred.key_path;
        }
        remaining_configs.push(cfg);
    }

    let block = generate_ssh_config_block(&remaining_configs);
    write_ssh_config(&block)?;
    ssh_get_config_status()
}

#[tauri::command]
pub fn ssh_preview_config(hosts: Vec<SshHostConfig>) -> Result<String, String> {
    let mut resolved_hosts = Vec::new();
    for mut h in hosts {
        if h.username.is_none() || h.key_path.is_none() {
            if let Ok(Some(cred)) = credential_for(&h.host) {
                if h.username.is_none() && !cred.username.trim().is_empty() {
                    h.username = Some(cred.username);
                }
                if h.key_path.is_none() {
                    h.key_path = cred.key_path;
                }
            }
        }
        resolved_hosts.push(h);
    }
    Ok(generate_ssh_config_block(&resolved_hosts))
}

#[tauri::command]
pub fn launch_terminal(command: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"\ntell application \"Terminal\" to activate",
            escaped
        );
        Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .spawn()
            .map_err(|e| format!("could not open terminal: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", "cmd.exe", "/k", &command])
            .spawn()
            .map_err(|e| format!("could not open terminal: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("x-terminal-emulator")
            .args(["-e", &command])
            .spawn()
            .map_err(|e| format!("could not open terminal: {e}"))?;
        Ok(())
    }
}

#[tauri::command]
pub fn launch_rdp(host: String, port: u16) -> Result<(), String> {
    let target = format!("{host}:{port}");
    #[cfg(target_os = "macos")]
    {
        let url = format!("rdp://full%20address=s:{target}");
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("could not launch RDP client: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("mstsc")
            .arg(format!("/v:{target}"))
            .spawn()
            .map_err(|e| format!("could not launch mstsc: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        if Command::new("remmina")
            .args(["-c", &format!("rdp://{target}")])
            .spawn()
            .is_err()
        {
            let _ = Command::new("xdg-open")
                .arg(format!("rdp://{target}"))
                .spawn();
        }
        Ok(())
    }
}

#[tauri::command]
pub fn launch_smb(host: String, port: u16) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let url = format!("smb://{host}:{port}");
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("could not open SMB share: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("\\\\{host}"))
            .spawn()
            .map_err(|e| format!("could not open SMB share: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let url = format!("smb://{host}:{port}");
        let _ = Command::new("xdg-open").arg(&url).spawn();
        Ok(())
    }
}

/// Build the exact ssh invocation used by the CLI for local proxy connection.
pub(crate) fn build_ssh_command(key_path: Option<&str>, port: u16, username: &str) -> String {
    let ssh_arg = match key_path.filter(|p| !p.trim().is_empty()) {
        Some(key) => format!("-i '{}' ", key.replace('\'', "'\\''")),
        None => String::new(),
    };
    format!("ssh {ssh_arg}-o StrictHostKeyChecking=accept-new -p {port} {username}@127.0.0.1")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "touches the real OS keychain"]
    fn keychain_roundtrip() {
        let host = format!("test-{}", std::process::id());
        ssh_save_credential(
            host.clone(),
            "alice".into(),
            Some("s3cret".into()),
            None,
            None,
        )
        .expect("save");
        let info = ssh_get_credential(host.clone()).expect("get");
        assert_eq!(info.username.as_deref(), Some("alice"));
        assert!(info.has_password);
        ssh_delete_credential(host.clone()).expect("delete");
        let gone = ssh_get_credential(host).expect("get after delete");
        assert!(!gone.has_password);
    }

    #[test]
    fn ssh_config_block_generation() {
        let hosts = vec![
            SshHostConfig {
                host: "server1.corp.example.com".into(),
                alias: Some("server1".into()),
                hostname: Some("server1.corp.example.com".into()),
                username: Some("deploy".into()),
                key_path: Some("~/.ssh/id_ed25519".into()),
            },
            SshHostConfig {
                host: "server2.corp.example.com".into(),
                alias: None,
                hostname: None,
                username: None,
                key_path: None,
            },
        ];
        let block = generate_ssh_config_block(&hosts);
        assert!(block.starts_with(MANAGED_START));
        assert!(block.ends_with(MANAGED_END));
        assert!(block.contains("Host server1\n"));
        assert!(block.contains("HostName server1.corp.example.com"));
        assert!(block.contains("User deploy"));
        assert!(block.contains("IdentityFile ~/.ssh/id_ed25519"));
        assert!(block.contains("ProxyCommand"));
        assert!(block.contains("Host server2.corp.example.com"));
    }

    #[test]
    fn ssh_config_update_preserves_existing_user_config() {
        let existing = "Host github.com\n    User git\n    IdentityFile ~/.ssh/id_rsa\n";
        let new_block = format!(
            "{}\nHost test.com\n    User test\n{}",
            MANAGED_START, MANAGED_END
        );

        let merged = update_ssh_config_content(existing, &new_block);
        assert!(
            merged.starts_with("Host github.com\n    User git\n    IdentityFile ~/.ssh/id_rsa\n\n")
        );
        assert!(merged.contains("Host test.com"));

        // Now update it with an updated block
        let updated_block = format!(
            "{}\nHost test2.com\n    User test2\n{}",
            MANAGED_START, MANAGED_END
        );
        let updated = update_ssh_config_content(&merged, &updated_block);
        assert!(updated
            .starts_with("Host github.com\n    User git\n    IdentityFile ~/.ssh/id_rsa\n\n"));
        assert!(updated.contains("Host test2.com"));
        assert!(!updated.contains("Host test.com"));

        // Now remove the block completely
        let removed = update_ssh_config_content(&updated, "");
        assert_eq!(removed.trim(), existing.trim());
    }

    const DUMP_FIXTURE: &str = r#"
keychain: "/Users/me/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="be.maurodruwel.tunneldash"
    "acct"<blob>="prod-db.corp.example.com"
    "svce"<blob>="be.maurodruwel.tunneldash"
keychain: "/Users/me/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    "acct"<blob>="someone@github.com"
    "svce"<blob>="gh"
class: "genp"
attributes:
    "acct"<blob>="old-box.corp.example.com"
    "svce"<blob>="be.maurodruwel.tunneldash"
class: "inet"
attributes:
    "srvr"<blob>="example.com"
"#;

    #[test]
    fn parse_dump_accounts_filters_by_service() {
        let mut found = parse_dump_accounts(DUMP_FIXTURE, SERVICE);
        found.sort();
        assert_eq!(found.len(), 2);
        assert_eq!(found[0], "old-box.corp.example.com");
        assert_eq!(found[1], "prod-db.corp.example.com");
    }

    #[test]
    fn parse_dump_accounts_handles_nulls_and_empty() {
        let out = parse_dump_accounts("\"acct\"<blob>=<NULL>\n\"svce\"<blob>=<NULL>\n", SERVICE);
        assert!(out.is_empty());
        assert!(parse_dump_accounts("", SERVICE).is_empty());
    }
}
