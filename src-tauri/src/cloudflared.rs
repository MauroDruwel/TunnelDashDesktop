use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

pub const MISSING: &str = "No usable cloudflared found. Install it from https://developers.cloudflare.com/tunnel/downloads/ and try again.";

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    System,
    Bundled,
}

#[derive(Serialize)]
pub struct CloudflaredStatus {
    path: PathBuf,
    version: String,
    source: Source,
}

impl CloudflaredStatus {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

fn candidates(app: Option<&AppHandle>) -> Vec<(PathBuf, Source)> {
    let name = if cfg!(windows) {
        "cloudflared.exe"
    } else {
        "cloudflared"
    };
    let mut paths = Vec::new();
    if cfg!(windows) {
        for variable in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Some(dir) = std::env::var_os(variable) {
                paths.push((
                    PathBuf::from(dir).join("cloudflared").join(name),
                    Source::System,
                ));
            }
        }
    } else {
        for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            paths.push((Path::new(dir).join(name), Source::System));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&path).map(|dir| (dir.join(name), Source::System)));
    }
    if let Some(dir) = app.and_then(|app| app.path().resource_dir().ok()) {
        paths.push((dir.join(name), Source::Bundled));
        paths.push((dir.join("binaries").join(name), Source::Bundled));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push((dir.join(name), Source::Bundled));
            paths.push((dir.join("binaries").join(name), Source::Bundled));
        }
    }
    paths
}

fn select(
    paths: impl IntoIterator<Item = (PathBuf, Source)>,
    probe: impl Fn(&Path) -> Option<String>,
) -> Option<CloudflaredStatus> {
    paths
        .into_iter()
        .filter(|(path, _)| path.is_absolute())
        .find_map(|(path, source)| {
            let version = probe(&path)?;
            Some(CloudflaredStatus {
                path,
                version,
                source,
            })
        })
}

pub fn detect(app: Option<&AppHandle>) -> Option<CloudflaredStatus> {
    select(candidates(app), |path| {
        if !path.is_file() {
            return None;
        }
        let mut command = Command::new(path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let output = command.arg("--version").output().ok()?;
        if !output.status.success() {
            return None;
        }
        let version = String::from_utf8_lossy(&output.stdout);
        version
            .lines()
            .map(str::trim)
            .find(|line| line.starts_with("cloudflared version "))
            .map(str::to_owned)
    })
}

pub fn ssh_path(app: &AppHandle, found: &CloudflaredStatus) -> Result<PathBuf, String> {
    // AppImage mounts disappear when the app exits. Copy that sidecar to a
    // persistent, versioned location before writing an OpenSSH ProxyCommand.
    if cfg!(target_os = "linux")
        && matches!(found.source, Source::Bundled)
        && std::env::var_os("APPDIR").is_some_and(|dir| found.path.starts_with(dir))
    {
        use sha2::{Digest, Sha256};
        let folder = app
            .path()
            .app_local_data_dir()
            .map_err(|err| err.to_string())?
            .join("ssh-proxy");
        let digest = Sha256::digest(found.version.as_bytes());
        let destination = folder.join(format!("cloudflared-{digest:x}"));
        if !destination.is_file() {
            std::fs::create_dir_all(&folder).map_err(|err| err.to_string())?;
            let temporary = folder.join(format!(".cloudflared-{:016x}.tmp", rand::random::<u64>()));
            let result = (|| -> std::io::Result<()> {
                let mut output = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temporary)?;
                let mut input = std::fs::File::open(found.path())?;
                std::io::copy(&mut input, &mut output)?;
                output.set_permissions(input.metadata()?.permissions())?;
                drop(output);
                std::fs::rename(&temporary, &destination)
            })();
            if let Err(err) = result {
                let _ = std::fs::remove_file(&temporary);
                return Err(format!(
                    "Could not prepare bundled cloudflared for SSH: {err}"
                ));
            }
        }
        return Ok(destination);
    }
    Ok(found.path.clone())
}

#[tauri::command]
pub async fn cloudflared_status(app: AppHandle) -> Result<CloudflaredStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        detect(Some(&app)).ok_or_else(|| MISSING.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_system_before_bundle_and_skips_broken_candidates() {
        let root = std::env::temp_dir();
        let system = root.join("system/cloudflared");
        let broken = root.join("broken/cloudflared");
        let bundle = root.join("bundle/cloudflared");
        let paths = [
            (broken.clone(), Source::System),
            (system.clone(), Source::System),
            (bundle.clone(), Source::Bundled),
        ];
        let selected = select(paths.clone(), |path| {
            (path != broken).then(|| "version".into())
        })
        .unwrap();
        assert_eq!(selected.path(), system);
        assert!(matches!(selected.source, Source::System));
        let selected = select(paths, |path| (path == bundle).then(|| "version".into())).unwrap();
        assert_eq!(selected.path(), bundle);
        assert!(matches!(selected.source, Source::Bundled));
    }
}
