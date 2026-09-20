//! `tunneldash-cli` — drive TunnelDash proxies from the terminal.
//!
//! Shares the Rust core with the desktop app: same cloudflared resolution,
//! same macOS Keychain credentials, same ssh invocation. Designed so humans
//! *and* AI agents can start/list/stop local tunnel proxies non-interactively.

use crate::cloudflare::{cf_tunnel_config, cf_tunnels};
use crate::ssh::{build_ssh_command, credential_for};
use crate::tunnels::{resolve_cloudflared, shared_cache_dir, ProxyStateEntry};
use serde::Deserialize;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

const IDENTIFIER: &str = "be.maurodruwel.tunneldash";

// ─── Entry point ──────────────────────────────────────────────────────────────

pub fn run(args: Vec<String>) -> i32 {
    match args.first().map(String::as_str) {
        None | Some("help") | Some("--help") | Some("-h") => {
            print_help();
            0
        }
        Some("version") | Some("--version") | Some("-V") => {
            println!("tunneldash-cli {}", env!("CARGO_PKG_VERSION"));
            0
        }
        Some("list") => match block_on(list()) {
            Ok(()) => 0,
            Err(e) => fail(&e),
        },
        Some("status") => match status() {
            Ok(()) => 0,
            Err(e) => fail(&e),
        },
        Some("connect") => match connect(args.get(1..).unwrap_or(&[])) {
            Ok(()) => 0,
            Err(e) => fail(&e),
        },
        Some("stop") => match stop(args.get(1..).unwrap_or(&[])) {
            Ok(()) => 0,
            Err(e) => fail(&e),
        },
        Some(other) => {
            eprintln!("unknown command: {other}\n");
            print_help();
            1
        }
    }
}

fn print_help() {
    println!(
        "TunnelDash CLI {version} — Cloudflare Tunnel proxies from the terminal

USAGE:
    tunneldash-cli <COMMAND>

COMMANDS:
    list                      List tunnels and their endpoints (token saved by the desktop app)
    status                    Show tunnels currently proxied on this machine
    connect <host> [flags]    Proxy an endpoint locally and open SSH in a new terminal window
    stop <host> | --all       Stop a running proxy
    version                   Print version

CONNECT FLAGS:
    --port <N>                Local port to bind (default: next free port from 50000)
    --username <U>            SSH username (saved to the keychain for next time)
    --password <P>            SSH password (stored in the system keychain)
    --key-path <K>            Path to a private key (stored in the system keychain)
    --key-passphrase <S>      Passphrase for the private key

EXAMPLES:
    tunneldash-cli list
    tunneldash-cli connect prod-db.corp.example.com
    tunneldash-cli connect db.internal.example.com --username deploy --port 51000
    tunneldash-cli status
    tunneldash-cli stop prod-db.corp.example.com

NOTES:
    Credentials live in your OS keychain (service \"{svc}\"), keyed by hostname.
    Configure them once via the desktop app (SSH Sessions > Configure) or pass
    them inline with the connect flags above.",
        version = env!("CARGO_PKG_VERSION"),
        svc = IDENTIFIER
    );
}

fn fail(message: &str) -> i32 {
    eprintln!("error: {message}");
    1
}

fn block_on<F: std::future::Future>(fut: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime")
        .block_on(fut)
}

// ─── Shared paths ─────────────────────────────────────────────────────────────

fn state_file() -> PathBuf {
    shared_cache_dir(None).join("proxies.json")
}

/// tauri-plugin-store saves settings at `<appConfigDir>/settings.json`.
fn settings_store_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| {
            PathBuf::from(h)
                .join("Library/Application Support")
                .join(IDENTIFIER)
                .join("settings.json")
        })
    }
    #[cfg(target_os = "linux")]
    {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
        Some(base.join(IDENTIFIER).join("settings.json"))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(IDENTIFIER).join("settings.json"))
    }
}

#[derive(Debug, Deserialize)]
struct StoredSettings {
    #[serde(default, rename = "apiKey")]
    api_key: String,
    #[serde(default, rename = "accountId")]
    account_id: Option<String>,
    #[serde(default, rename = "portStart")]
    port_start: Option<String>,
}

fn load_settings() -> Result<StoredSettings, String> {
    let path = settings_store_path().ok_or("could not locate the app data dir")?;
    let raw = std::fs::read_to_string(&path).map_err(|_| {
        format!(
            "no TunnelDash settings at {} — launch the desktop app once and verify your API token",
            path.display()
        )
    })?;
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("settings file unreadable: {e}"))?;
    // Store v2 wraps values under their key; fall back to the root otherwise.
    let inner = value.get("settings").unwrap_or(&value);
    serde_json::from_value(inner.clone()).map_err(|e| format!("settings incomplete: {e}"))
}

// ─── list ─────────────────────────────────────────────────────────────────────

async fn list() -> Result<(), String> {
    let settings = load_settings()?;
    if settings.api_key.is_empty() {
        return Err("no API token stored — verify a token in the desktop app first".into());
    }
    let account_id = settings
        .account_id
        .clone()
        .ok_or("no verified account stored — verify a token in the desktop app first")?;

    let response = cf_tunnels(settings.api_key.clone(), account_id.clone())
        .await
        .map_err(|e| format!("could not fetch tunnels: {e}"))?;
    let tunnels_list = response.result.unwrap_or_default();
    if tunnels_list.is_empty() {
        println!("no tunnels found");
        return Ok(());
    }

    for tunnel in &tunnels_list {
        let status = tunnel.status.as_deref().unwrap_or("unknown");
        println!("{} ({})", tunnel.name, status);

        let mut ports = std::collections::BTreeMap::new();
        if let Some(map) = tunnel
            .metadata
            .as_ref()
            .and_then(|m| m.get("tunneldashPort"))
            .and_then(|v| v.as_object())
        {
            for (host, port) in map {
                if let Some(port) = port.as_u64() {
                    ports.insert(host.to_lowercase(), port as u16);
                }
            }
        }

        let Ok(config) = cf_tunnel_config(
            settings.api_key.clone(),
            account_id.clone(),
            tunnel.id.clone(),
        )
        .await
        else {
            println!("    (config unavailable)");
            continue;
        };
        let ingress = config
            .result
            .as_ref()
            .and_then(|r| r.get("config"))
            .and_then(|c| c.get("ingress"))
            .and_then(|i| i.as_array())
            .cloned()
            .unwrap_or_default();

        for rule in ingress {
            let service = rule
                .get("service")
                .and_then(|s| s.as_str())
                .unwrap_or_default();
            let proto = service.split("://").next().unwrap_or(service);
            if proto.is_empty() || service.starts_with("http_status:") {
                continue;
            }
            let hostname = rule
                .get("hostname")
                .and_then(|h| h.as_str())
                .unwrap_or_default();
            let port = ports.get(&hostname.to_lowercase()).copied();
            match port {
                Some(p) => println!("  {:<5} {:<45} localhost:{}", proto, hostname, p),
                None => println!("  {:<5} {:<45} (no local port yet)", proto, hostname),
            }
        }
    }
    Ok(())
}

// ─── status ───────────────────────────────────────────────────────────────────

fn load_state() -> Vec<ProxyStateEntry> {
    std::fs::read_to_string(state_file())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_state(entries: &[ProxyStateEntry]) -> Result<(), String> {
    let path = state_file();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("could not write {}: {e}", path.display()))
}

fn port_listening(port: u16) -> bool {
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(400),
    )
    .is_ok()
}

fn status() -> Result<(), String> {
    let entries = load_state();
    if entries.is_empty() {
        println!("No tunnels proxying.");
        return Ok(());
    }
    for entry in &entries {
        let alive = port_listening(entry.port);
        let mark = if alive { "●" } else { "✗" };
        println!(
            "{mark} {:<45} localhost:{:<6} (pid {}{})",
            entry.host,
            entry.port,
            entry.pid,
            if alive { "" } else { ", not listening" }
        );
    }
    Ok(())
}

// ─── stop ─────────────────────────────────────────────────────────────────────

fn stop(args: &[String]) -> Result<(), String> {
    let mut entries = load_state();

    if args.first().map(String::as_str) == Some("--all") {
        for entry in &entries {
            kill_pid(entry.pid);
            println!("stopped {}", entry.host);
        }
        entries.clear();
        save_state(&entries)?;
        return Ok(());
    }

    let host = args
        .first()
        .ok_or("usage: tunneldash-cli stop <host>")?
        .clone();
    let index = entries
        .iter()
        .position(|e| e.host == host || host_matches(&e.host, &host))
        .ok_or_else(|| format!("'{host}' is not being proxied (see: tunneldash-cli status)"))?;

    let entry = entries.remove(index);
    kill_pid(entry.pid);
    save_state(&entries)?;
    println!("stopped {}", entry.host);
    Ok(())
}

/// Allow stopping by partial suffix (`prod-db` matches `prod-db.corp.example.com`).
fn host_matches(candidate: &str, query: &str) -> bool {
    candidate.split('.').next() == Some(query)
}

fn kill_pid(pid: u32) {
    #[cfg(windows)]
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status();
    #[cfg(not(windows))]
    let _ = Command::new("kill").arg(pid.to_string()).status();
}

// ─── connect ──────────────────────────────────────────────────────────────────

struct ConnectFlags {
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    key_path: Option<String>,
    key_passphrase: Option<String>,
}

fn parse_connect_flags(args: &[String]) -> Result<(String, ConnectFlags), String> {
    let mut host = None;
    let mut flags = ConnectFlags {
        port: None,
        username: None,
        password: None,
        key_path: None,
        key_passphrase: None,
    };
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        let value_for =
            |name: &str, iter: &mut std::slice::Iter<String>| -> Result<String, String> {
                iter.next()
                    .cloned()
                    .ok_or_else(|| format!("{name} expects a value"))
            };
        match arg.as_str() {
            "--port" => {
                let v = value_for("--port", &mut iter)?;
                flags.port = Some(
                    v.parse()
                        .map_err(|_| "--port must be a number (1024-65535)")?,
                );
            }
            "--username" | "--user" => flags.username = Some(value_for("--username", &mut iter)?),
            "--password" => flags.password = Some(value_for("--password", &mut iter)?),
            "--key-path" => flags.key_path = Some(value_for("--key-path", &mut iter)?),
            "--key-passphrase" => {
                flags.key_passphrase = Some(value_for("--key-passphrase", &mut iter)?)
            }
            other if other.starts_with('-') => return Err(format!("unknown flag: {other}")),
            other => {
                if host.is_some() {
                    return Err("only one host can be connected at a time".into());
                }
                host = Some(other.to_string());
            }
        }
    }
    let host = host.ok_or("usage: tunneldash-cli connect <host> [flags]")?;
    Ok((host, flags))
}

fn connect(args: &[String]) -> Result<(), String> {
    let (host, flags) = parse_connect_flags(args)?;
    let cache_dir = shared_cache_dir(None);
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("could not create cache dir: {e}"))?;

    // Already proxied? Reuse the existing listener instead of spawning twice.
    let existing = load_state()
        .into_iter()
        .find(|e| e.host == host && port_listening(e.port));
    let port = match (&existing, flags.port) {
        (Some(entry), _) => {
            println!(
                "already proxying {} on localhost:{} — reusing",
                entry.host, entry.port
            );
            entry.port
        }
        (None, Some(p)) => p,
        (None, None) => pick_free_port(&load_settings()?.port_start),
    };

    // Credentials: inline flags win and are persisted for the desktop app too;
    // otherwise fall back to whatever is saved in the OS keychain.
    let (username, _password, key_path, _key_passphrase) = if flags.username.is_some() {
        let user = flags.username.clone().unwrap_or_default();
        crate::ssh::ssh_save_credential(
            host.clone(),
            user.clone(),
            flags.password.clone(),
            flags.key_path.clone(),
            flags.key_passphrase.clone(),
        )?;
        (
            user,
            flags.password.clone(),
            flags.key_path.clone(),
            flags.key_passphrase.clone(),
        )
    } else {
        let cred = credential_for(&host)?.ok_or_else(|| {
            format!(
                "no credentials saved for '{host}'. Configure once in the TunnelDash app \
                     (SSH Sessions > Configure) or pass --username/--password/--key-path"
            )
        })?;
        (
            cred.username,
            cred.password,
            cred.key_path,
            cred.key_passphrase,
        )
    };

    if existing.is_none() {
        spawn_proxy(&host, port)?;
    }

    let command = build_ssh_command(key_path.as_deref(), port, &username);
    println!("Proxy running on localhost:{port}");
    println!("Direct local connection command:\n  {command}\n");
    println!("Tip: Access directly without local proxying by adding to ~/.ssh/config:");
    println!("  Host {host}");
    println!("      ProxyCommand cloudflared access ssh --hostname %h\n");
    Ok(())
}

fn pick_free_port(start: &Option<String>) -> u16 {
    let start: u16 = start
        .as_deref()
        .and_then(|v| v.parse().ok())
        .filter(|p| (1024..=65535).contains(p))
        .unwrap_or(50000);
    (start..=65535)
        .find(|p| TcpListener::bind(("127.0.0.1", *p)).is_ok())
        .unwrap_or(start)
}

/// Spawn cloudflared access for `host` and wait until the local listener answers.
fn spawn_proxy(host: &str, port: u16) -> Result<u32, String> {
    let bin = resolve_cloudflared(None)
        .ok_or_else(|| "cloudflared not found — install it (brew install cloudflared) or launch the desktop app once".to_string())?;

    let log_path = shared_cache_dir(None).join(format!("cloudflared-cli-{}.log", sanitize(host)));
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("could not open tunnel log: {e}"))?;

    let mut child = Command::new(&bin)
        .args([
            "access",
            "tcp",
            "--hostname",
            host,
            "--url",
            &format!("localhost:{port}"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .spawn()
        .map_err(|e| format!("failed to start cloudflared: {e}"))?;
    let pid = child.id();

    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    while std::time::Instant::now() < deadline {
        if port_listening(port) {
            // Register in the shared state file so `status`/`stop` can see us.
            let mut entries = load_state();
            entries.retain(|e| e.host != host);
            entries.push(ProxyStateEntry {
                host: host.to_string(),
                port,
                pid,
                owner: "cli".to_string(),
            });
            entries.sort_by(|a, b| a.host.cmp(&b.host));
            save_state(&entries)?;
            println!("proxying {host} → localhost:{port} (pid {pid})");
            return Ok(pid);
        }
        std::thread::sleep(Duration::from_millis(250));
    }

    let _ = child.kill();
    Err(format!(
        "local listener on port {port} never came up — see {} for details",
        log_path.display()
    ))
}

fn sanitize(input: &str) -> String {
    input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}
