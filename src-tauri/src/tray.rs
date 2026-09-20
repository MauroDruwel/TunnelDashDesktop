use crate::tunnels;
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

const TRAY_ID: &str = "tunneldash-main-tray";

/// Create the menu bar icon. Best-effort: a failure here must never take the
/// whole app down, so everything is logged and swallowed.
pub fn init(app: &AppHandle) {
    if let Err(e) = try_init(app) {
        log::warn!("tray icon unavailable: {e}");
    }
}

static TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-icon.png");

fn tray_icon() -> Option<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(TRAY_ICON_BYTES).ok()
}

fn try_init(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("TunnelDash")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            id => {
                if id.starts_with("tunnel:") {
                    let _ = app.emit("tray-navigate", id.trim_start_matches("tunnel:"));
                    show_main(app);
                }
            }
        });

    let icon = tray_icon().or_else(|| app.default_window_icon().cloned());
    if let Some(icon) = icon {
        builder = builder.icon(icon).icon_as_template(true);
    }
    builder.build(app)?;
    Ok(())
}

/// Rebuild the tray menu from the live proxy map (called after every
/// start/stop so the list is always current).
pub fn update(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let count = tunnels::active_proxies().len();
    let _ = tray.set_tooltip(if count == 0 {
        Some("TunnelDash".to_string())
    } else {
        Some(format!(
            "TunnelDash — {count} tunnel{} proxying",
            if count == 1 { "" } else { "s" }
        ))
    });
    match build_menu(app) {
        Ok(menu) => {
            let _ = tray.set_menu(Some(menu));
        }
        Err(e) => log::warn!("could not rebuild tray menu: {e}"),
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let active = tunnels::active_proxies();
    let mut items: Vec<Box<dyn IsMenuItem<Wry>>> = Vec::new();

    items.push(Box::new(MenuItem::with_id(
        app,
        "header",
        if active.is_empty() {
            "No tunnels proxying".to_string()
        } else {
            format!(
                "{} tunnel{} proxying",
                active.len(),
                if active.len() == 1 { "" } else { "s" }
            )
        },
        false,
        None::<&str>,
    )?));

    if !active.is_empty() {
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
        for (host, port) in active {
            items.push(Box::new(MenuItem::with_id(
                app,
                format!("tunnel:{host}"),
                format!("●  {host} — localhost:{port}"),
                true,
                None::<&str>,
            )?));
        }
    }

    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "open",
        "Open TunnelDash",
        true,
        None::<&str>,
    )?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "quit",
        "Quit TunnelDash",
        true,
        None::<&str>,
    )?));

    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|item| item.as_ref()).collect();
    Menu::with_items(app, &refs)
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
