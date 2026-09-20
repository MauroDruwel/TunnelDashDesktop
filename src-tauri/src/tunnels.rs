use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};

struct ActiveProxy {
    child: Child,
    local_port: u16,
    pid: u32,
}

static ACTIVE: Lazy<Mutex<HashMap<String, ActiveProxy>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Hostname + local port of every live cloudflared proxy, sorted by host.
pub(crate) fn active_proxies() -> Vec<(String, u16)> {
    let mut active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    let mut list: Vec<(String, u16)> = Vec::new();
    // Prune dead listeners (crashed cloudflared) while collecting live ones so
    // the tray never lies.
    active.retain(|host, proxy| {
        let alive = proxy
            .child
            .try_wait()
            .map(|status| status.is_none())
            .unwrap_or(false);
        if alive {
            list.push((host.clone(), proxy.local_port));
        }
        alive
    });
    list.sort();
    list
}

/// Cache dir shared by the GUI and the CLI (matches Tauri's app_cache_dir).
pub(crate) fn shared_cache_dir(app: Option<&AppHandle>) -> PathBuf {
    if let Some(app) = app {
        if let Ok(dir) = app.path().app_cache_dir() {
            return dir;
        }
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join("Library/Caches/be.maurodruwel.tunneldash");
    }
    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(local).join("tunneldash/cache");
    }
    std::env::temp_dir().join("tunneldash")
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct ProxyStateEntry {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) pid: u32,
    /// Who spawned this proxy: "gui" or "cli". GUI snapshots never overwrite
    /// CLI-owned entries so both tools can coexist on one machine.
    #[serde(default = "default_owner")]
    pub(crate) owner: String,
}

fn default_owner() -> String {
    "gui".to_string()
}

/// Is anything listening on 127.0.0.1:`port`?
fn port_listening(port: u16) -> bool {
    use std::net::TcpStream;
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(400),
    )
    .is_ok()
}

/// Snapshot of live proxies persisted to `<cache>/proxies.json` after every
/// mutation, so `tunneldash-cli status/stop` can see GUI-started proxies.
pub(crate) fn persist_proxies(app: Option<&AppHandle>) {
    let gui_entries: Vec<ProxyStateEntry> = {
        let mut active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
        let mut list = Vec::new();
        active.retain(|host, proxy| {
            let alive = proxy
                .child
                .try_wait()
                .map(|status| status.is_none())
                .unwrap_or(false);
            if alive {
                list.push(ProxyStateEntry {
                    host: host.clone(),
                    port: proxy.local_port,
                    pid: proxy.pid,
                    owner: "gui".to_string(),
                });
            }
            alive
        });
        list.sort_by(|a, b| a.host.cmp(&b.host));
        list
    };

    let path = shared_cache_dir(app).join("proxies.json");
    // Merge: keep only *live* non-GUI entries, replace the GUI-owned set wholesale.
    let mut merged: Vec<ProxyStateEntry> = gui_entries;
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(previous) = serde_json::from_str::<Vec<ProxyStateEntry>>(&raw) {
            for entry in previous {
                if entry.owner != "gui"
                    && !merged.iter().any(|e| e.host == entry.host)
                    && port_listening(entry.port)
                {
                    merged.push(entry);
                }
            }
        }
    }
    merged.sort_by(|a, b| a.host.cmp(&b.host));

    match serde_json::to_string_pretty(&merged) {
        Ok(json) => {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(e) = std::fs::write(&path, json) {
                log::warn!("could not write proxy state: {e}");
            }
        }
        Err(e) => log::warn!("could not serialize proxy state: {e}"),
    }
}

fn cloudflared_binary_name() -> &'static str {
    if cfg!(windows) {
        "cloudflared.exe"
    } else {
        "cloudflared"
    }
}

/// Resolve the cloudflared binary. The Tauri handle is optional so the CLI
/// binary can share this logic without spinning up an app context.
pub(crate) fn resolve_cloudflared(app: Option<&AppHandle>) -> Option<PathBuf> {
    let name = cloudflared_binary_name();

    // 1. Check standard host installation paths first (e.g. Homebrew, system install)
    #[cfg(target_os = "windows")]
    {
        for candidate in [
            "C:\\Program Files\\cloudflared\\cloudflared.exe",
            "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
        ] {
            let p = PathBuf::from(candidate);
            if p.exists() {
                return Some(p);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        for candidate in [
            "/opt/homebrew/bin/cloudflared",
            "/usr/local/bin/cloudflared",
            "/usr/bin/cloudflared",
        ] {
            let p = PathBuf::from(candidate);
            if p.exists() {
                return Some(p);
            }
        }
    }

    // 2. Check system PATH
    if let Some(paths) = std::env::var_os("PATH") {
        if let Some(p) = std::env::split_paths(&paths)
            .map(|dir| dir.join(name))
            .find(|candidate| candidate.exists())
        {
            return Some(p);
        }
    }

    // 3. Fallback: Tauri resource dir (bundled sidecar via externalBin)
    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            for candidate in [
                resource_dir.join(name),
                resource_dir.join("binaries").join(name),
            ] {
                if candidate.exists() {
                    return Some(candidate);
                }
            }
            // Sidecar may still have target-triple suffix in dev builds; scan resource dir
            if let Ok(entries) = std::fs::read_dir(&resource_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if let Some(fname) = p.file_name().and_then(|s| s.to_str()) {
                        if fname.starts_with("cloudflared") && p.exists() {
                            return Some(p);
                        }
                    }
                }
            }
        }
    }

    // 4. Next to current exe (covers dev and some bundle layouts)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for candidate in [dir.join(name), dir.join("binaries").join(name)] {
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }

    // 5. Dev layout: project/src-tauri/binaries/cloudflared-<triple>
    if let Ok(cwd) = std::env::current_dir() {
        let dev_binaries = cwd.join("src-tauri").join("binaries");
        if dev_binaries.exists() {
            if let Ok(entries) = std::fs::read_dir(&dev_binaries) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if let Some(fname) = p.file_name().and_then(|s| s.to_str()) {
                        if fname.starts_with("cloudflared") && p.exists() {
                            return Some(p);
                        }
                    }
                }
            }
        }
    }

    None
}

#[tauri::command]
pub fn cloudflared_version(app: AppHandle) -> Result<String, String> {
    let bin = resolve_cloudflared(Some(&app)).ok_or_else(|| "cloudflared not found".to_string())?;
    let output = Command::new(&bin)
        .arg("--version")
        .output()
        .map_err(|e| format!("cloudflared --version failed: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "cloudflared --version failed: status {}",
            output.status
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout
        .lines()
        .next()
        .unwrap_or("unknown")
        .trim()
        .to_string();
    Ok(first_line)
}

#[tauri::command]
pub fn start_tunnel(
    app: AppHandle,
    hostname: String,
    local_port: u16,
    protocol: Option<String>,
) -> Result<(), String> {
    let mut active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());

    // Reuse an already-running proxy, but only if its process is actually
    // alive. A cloudflared listener can die (edge reconnect, crash, etc.) while
    // we still think the host is "active" — if so, drop the zombie and respawn
    // so the local port is listening again for the SSH client.
    if let Some(proxy) = active.get_mut(&hostname) {
        match proxy.child.try_wait() {
            Ok(None) => return Ok(()),
            _ => {
                active.remove(&hostname);
            }
        }
    }

    let bin = resolve_cloudflared(Some(&app)).ok_or_else(|| {
        "cloudflared not found - install it or bundle it with the app".to_string()
    })?;

    let url = format!("localhost:{local_port}");
    let proto = protocol.unwrap_or_else(|| "tcp".into()).to_lowercase();

    let mut args: Vec<String> = vec!["access".into()];
    match proto.as_str() {
        "ssh" => args.push("ssh".into()),
        "rdp" => args.push("rdp".into()),
        "smb" => args.push("smb".into()),
        _ => args.push("tcp".into()),
    }
    args.push("--hostname".into());
    args.push(hostname.clone());
    args.push("--url".into());
    args.push(url.clone());

    let log_path = log_file_path(&app, &hostname);
    let mut log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("could not open tunnel log file: {e}"))?;

    writeln!(log, "spawning: {} {:?}", bin.display(), args)
        .map_err(|e| format!("could not write tunnel log: {e}"))?;

    let child = Command::new(&bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .spawn()
        .map_err(|e| format!("failed to start cloudflared: {e}"))?;

    let pid = child.id();
    active.insert(
        hostname.clone(),
        ActiveProxy {
            child,
            local_port,
            pid,
        },
    );
    drop(active); // release the lock before blocking on the liveness check

    // cloudflared binds the local listener asynchronously. Give it a short
    // grace period, then confirm the process actually survived. If it exited
    // (e.g. "address already in use", auth failure) we'd otherwise leave a dead
    // entry that the SSH client can never reach — surface the real error
    // instead of failing silently later.
    thread::sleep(Duration::from_millis(1500));
    let mut active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(proxy) = active.get_mut(&hostname) {
        if let Ok(Some(status)) = proxy.child.try_wait() {
            active.remove(&hostname);
            drop(active);
            crate::tray::update(&app);
            persist_proxies(Some(&app));
            let detail = read_cloudflared_error(&app, &hostname)
                .unwrap_or_else(|| format!("cloudflared exited with status {status}"));
            let hint = if detail.to_lowercase().contains("address already in use") {
                " — the local port is held by another cloudflared/proxy. Stop the conflicting \
                 tunnel (or pick a different local port in Settings) and retry."
            } else {
                "."
            };
            return Err(format!(
                "tunnel '{hostname}' failed to start: {detail}{hint}"
            ));
        }
    }
    drop(active);
    crate::tray::update(&app);
    persist_proxies(Some(&app));
    Ok(())
}

#[tauri::command]
pub fn stop_tunnel(app: AppHandle, hostname: String) -> Result<(), String> {
    let mut active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut proxy) = active.remove(&hostname) {
        kill_child(&mut proxy.child);
    }
    drop(active);
    crate::tray::update(&app);
    persist_proxies(Some(&app));
    Ok(())
}

fn kill_child(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .status();
        let _ = child.wait();
    }

    #[cfg(not(windows))]
    {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Is `pid` still a live process?
fn pid_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}")])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// Terminate a proxy we only know by pid (e.g. left over from a previous
/// session). TERM first so cloudflared shuts down cleanly, KILL as backstop.
fn kill_foreign_pid(pid: u32) {
    let _ = Command::new("kill").arg(pid.to_string()).status();
    thread::sleep(Duration::from_millis(300));
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
}

/// Kill every proxy this process owns — called when the app exits so
/// cloudflared listeners never outlive TunnelDash.
pub(crate) fn kill_all_proxies() {
    let mut active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    for (_, mut proxy) in active.drain() {
        kill_child(&mut proxy.child);
    }
}

/// Called once at startup: proxies from a *previous* app session (crash,
/// force-quit, `tauri dev` Ctrl-C) would otherwise hold their local ports
/// hostage forever. Only GUI-owned entries are ours to reap; CLI-started
/// sessions belong to whoever launched them and keep running.
pub(crate) fn reap_orphaned_proxies(app: Option<&AppHandle>) {
    let path = shared_cache_dir(app).join("proxies.json");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return;
    };
    let Ok(entries) = serde_json::from_str::<Vec<ProxyStateEntry>>(&raw) else {
        return;
    };

    let mut kept: Vec<ProxyStateEntry> = Vec::new();
    for entry in entries {
        if entry.owner == "gui" && pid_alive(entry.pid) {
            log::info!("reaping orphaned proxy {} (pid {})", entry.host, entry.pid);
            kill_foreign_pid(entry.pid);
        } else if entry.owner != "gui" {
            kept.push(entry);
        }
    }
    kept.sort_by(|a, b| a.host.cmp(&b.host));
    if let Ok(json) = serde_json::to_string_pretty(&kept) {
        let _ = std::fs::write(&path, json);
    }
}

pub(crate) fn log_file_path(app: &AppHandle, hostname: &str) -> PathBuf {
    let dir = app
        .path()
        .app_log_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("tunneldash"));
    let _ = std::fs::create_dir_all(&dir);
    dir.join(format!("cloudflared-{}.log", sanitize(hostname)))
}

/// Pull the most recent error line out of a tunnel's cloudflared log so we can
/// turn a vague "connection failed" into something actionable (e.g. the
/// "address already in use" bind error).
pub(crate) fn read_cloudflared_error(app: &AppHandle, hostname: &str) -> Option<String> {
    let path = log_file_path(app, hostname);
    let content = std::fs::read_to_string(&path).ok()?;
    content
        .lines()
        .rev()
        .find(|l| {
            let low = l.to_lowercase();
            low.contains("err") || low.contains("error") || low.contains("fail")
        })
        .map(|l| l.trim().to_string())
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TunnelCommandDetails {
    pub hostname: String,
    pub local_port: u16,
    pub protocol: String,
    pub binary: String,
    pub command: String,
    pub args: Vec<String>,
    pub running: bool,
    pub pid: Option<u32>,
    pub log_path: String,
}

#[tauri::command]
pub fn get_tunnel_command(
    app: AppHandle,
    hostname: String,
    local_port: u16,
    protocol: Option<String>,
) -> Result<TunnelCommandDetails, String> {
    let bin = resolve_cloudflared(Some(&app)).unwrap_or_else(|| PathBuf::from("cloudflared"));
    let proto = protocol.unwrap_or_else(|| "tcp".into()).to_lowercase();
    let sub = match proto.as_str() {
        "ssh" => "ssh",
        "rdp" => "rdp",
        "smb" => "smb",
        _ => "tcp",
    };
    let url = format!("localhost:{local_port}");
    let args = vec![
        "access".to_string(),
        sub.to_string(),
        "--hostname".to_string(),
        hostname.clone(),
        "--url".to_string(),
        url,
    ];
    let full_command = format!("{} {}", bin.display(), args.join(" "));

    let active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    let (running, pid) = match active.get(&hostname) {
        Some(p) => (true, Some(p.pid)),
        None => (false, None),
    };
    let log_path = log_file_path(&app, &hostname).display().to_string();

    Ok(TunnelCommandDetails {
        hostname,
        local_port,
        protocol: proto,
        binary: bin.display().to_string(),
        command: full_command,
        args,
        running,
        pid,
        log_path,
    })
}

#[tauri::command]
pub fn get_tunnel_logs(
    app: AppHandle,
    hostname: String,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    let path = log_file_path(&app, &hostname);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => return Err(format!("could not read logs: {e}")),
    };
    let lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let max = limit.unwrap_or(200);
    let start = lines.len().saturating_sub(max);
    Ok(lines[start..].to_vec())
}
