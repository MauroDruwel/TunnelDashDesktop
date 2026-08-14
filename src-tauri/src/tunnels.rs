use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

static ACTIVE: Lazy<Mutex<HashMap<String, Child>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn cloudflared_binary_name() -> &'static str {
    if cfg!(windows) {
        "cloudflared.exe"
    } else {
        "cloudflared"
    }
}

fn resolve_cloudflared(app: &AppHandle) -> Option<PathBuf> {
    let _ = app;
    let name = cloudflared_binary_name();

    let bundled = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(name)));
    if let Some(path) = bundled {
        if path.exists() {
            return Some(path);
        }
    }

    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join(name))
            .find(|candidate| candidate.exists())
    })
}

#[tauri::command]
pub fn cloudflared_version(app: AppHandle) -> Result<String, String> {
    let bin = resolve_cloudflared(&app).ok_or_else(|| "cloudflared not found".to_string())?;
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
    let mut active = ACTIVE.lock().unwrap();

    if active.contains_key(&hostname) {
        return Ok(());
    }

    let bin = resolve_cloudflared(&app).ok_or_else(|| {
        "cloudflared not found - install it or bundle it with the app".to_string()
    })?;

    let url = format!("localhost:{local_port}");
    let proto = protocol.unwrap_or_else(|| "tcp".into());

    let mut args: Vec<String> = vec!["access".into()];
    match proto.as_str() {
        "ssh" => args.push("ssh".into()),
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

    active.insert(hostname, child);
    Ok(())
}

#[tauri::command]
pub fn stop_tunnel(hostname: String) -> Result<(), String> {
    let mut active = ACTIVE.lock().unwrap();
    if let Some(mut child) = active.remove(&hostname) {
        kill_child(&mut child);
    }
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

fn log_file_path(app: &AppHandle, hostname: &str) -> PathBuf {
    let dir = app
        .path()
        .app_log_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("tunneldash"));
    let _ = std::fs::create_dir_all(&dir);
    dir.join(format!("cloudflared-{}.log", sanitize(hostname)))
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
