//! Update check: compares the running version against the latest GitHub
//! release and can open the releases page. Silent best-effort — never blocks
//! startup or surfaces errors for offline/air-gapped machines.

use serde::Serialize;

const RELEASES_API: &str =
    "https://api.github.com/repos/MauroDruwel/TunnelDashDesktop/releases/latest";
const RELEASES_PAGE: &str = "https://github.com/MauroDruwel/TunnelDashDesktop/releases/latest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub url: String,
}

/// Compare `vMAJOR.MINOR.PATCH[-pre]` tags. Returns true when `latest` is a
/// strictly newer release than `current` (a prerelease never beats a stable
/// with the same numeric triple).
pub fn is_newer_version(current: &str, latest: &str) -> bool {
    let parse = |tag: &str| -> Option<(u64, u64, u64, bool)> {
        let core = tag.trim().trim_start_matches('v');
        let (nums, pre) = match core.split_once('-') {
            Some((n, _)) => (n, true),
            None => (core, false),
        };
        let mut it = nums.split('.');
        let major = it.next()?.parse().ok()?;
        let minor = it.next()?.parse().ok()?;
        let patch = it.next()?.parse().ok()?;
        Some((major, minor, patch, pre))
    };

    let (Some(c), Some(l)) = (parse(current), parse(latest)) else {
        return false;
    };
    let (cm, cn, cp, cpre) = c;
    let (lm, ln, lp, lpre) = l;
    match (lm, ln, lp).cmp(&(cm, cn, cp)) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Equal => cpre && !lpre,
        std::cmp::Ordering::Less => false,
    }
}

/// Returns update info when the latest GitHub release is newer than the
/// running app, else `None`. Any failure (offline, rate limit) is `None`.
#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let current = app.package_info().version.to_string();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .user_agent("tunneldash-desktop")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(RELEASES_API)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let tag = body["tag_name"].as_str().unwrap_or_default().to_string();
    if tag.is_empty() || !is_newer_version(&current, &tag) {
        return Ok(None);
    }
    Ok(Some(UpdateInfo {
        version: tag,
        url: body["html_url"]
            .as_str()
            .unwrap_or(RELEASES_PAGE)
            .to_string(),
    }))
}

/// Open the releases page in the user's browser.
#[tauri::command]
pub fn open_release_page() -> Result<(), String> {
    open_url(RELEASES_PAGE.to_string())
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
        // A prerelease of a higher triple still beats a lower stable.
        assert!(is_newer_version("0.3.0", "0.3.1-pre.1"));
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
