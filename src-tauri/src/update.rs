//! Manual update checks against the latest stable GitHub release.
use serde::Serialize;

const RELEASES: &str = "https://github.com/MauroDruwel/TunnelDashDesktop/releases";

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub html_url: String,
}

pub fn is_newer_version(current: &str, latest: &str) -> bool {
    let (Ok(current), Ok(latest)) = (
        semver::Version::parse(current),
        semver::Version::parse(latest.trim_start_matches('v')),
    ) else {
        return false;
    };
    latest.pre.is_empty() && latest.cmp_precedence(&current).is_gt()
}

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("tunneldash-desktop")
        .build()
        .map_err(|e| e.to_string())?
        .get("https://api.github.com/repos/MauroDruwel/TunnelDashDesktop/releases/latest")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "GitHub update service returned status {}",
            response.status()
        ));
    }
    let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let tag = body["tag_name"].as_str().unwrap_or_default();
    let latest_version = tag.trim_start_matches('v').to_string();
    semver::Version::parse(&latest_version)
        .map_err(|_| "GitHub returned an invalid release version".to_string())?;
    Ok(UpdateInfo {
        has_update: is_newer_version(&current_version, &latest_version),
        current_version,
        latest_version,
        html_url: format!("{RELEASES}/tag/{tag}"),
    })
}

/// Open an arbitrary web URL in the user's default browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("invalid URL protocol".to_string());
    }
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/c", "start", "", &url]);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&url);
        c
    };
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open browser: {e}"))
}

#[cfg(test)]
mod tests {
    use super::is_newer_version;

    #[test]
    fn detects_newer_versions() {
        assert!(is_newer_version("0.2.0", "v0.3.0"));
        assert!(is_newer_version("0.2.0", "1.0.0"));
        assert!(is_newer_version("0.2.9", "0.3.0"));
        assert!(is_newer_version("0.3.0-pre.1", "0.3.0"));
        assert!(!is_newer_version("0.3.0", "0.3.1-pre.1"));
        assert!(!is_newer_version("0.3.0", "0.3.0+build.1"));
    }

    #[test]
    fn ignores_same_and_older() {
        assert!(!is_newer_version("0.3.0", "v0.3.0"));
        assert!(!is_newer_version("0.3.0", "0.2.9"));
        assert!(!is_newer_version("1.0.0", "0.9.9"));
        // A prerelease of the SAME triple never beats a stable user.
        assert!(!is_newer_version("0.3.0", "0.3.0-rc.1"));
        // A stable release DOES supersede its own prerelease.
        assert!(is_newer_version("0.3.0-rc.1", "0.3.0"));
    }

    #[test]
    fn garbage_is_never_newer() {
        assert!(!is_newer_version("0.3.0", ""));
        assert!(!is_newer_version("0.3.0", "banana"));
        assert!(!is_newer_version("", "0.4.0"));
    }
}
