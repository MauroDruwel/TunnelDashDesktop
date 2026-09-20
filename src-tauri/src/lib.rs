pub mod cli;
mod cloudflare;
mod ssh;
mod sync;
mod tray;
mod tunnels;
mod update;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // Closing the window keeps TunnelDash alive in the menu bar; quit via
        // the tray menu or Cmd+Q instead.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        // Single setup hook — a second chained `.setup()` call would silently
        // replace this one on some Tauri versions.
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                use window_vibrancy::{
                    apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
                };

                let window = app.get_webview_window("main").expect("main window missing");
                apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::Sidebar,
                    Some(NSVisualEffectState::Active),
                    Some(18.0),
                )
                .expect("failed to apply vibrancy");
            }

            // Kill cloudflared listeners orphaned by a previous crash/force-quit
            // before anything can collide with their local ports.
            tunnels::reap_orphaned_proxies(Some(app.handle()));
            // Menu bar icon for at-a-glance proxy status.
            tray::init(app.handle());
            Ok(())
        });

    let app = builder
        .invoke_handler(tauri::generate_handler![
            cloudflare::cf_accounts,
            cloudflare::cf_tunnels,
            cloudflare::cf_tunnel_config,
            cloudflare::cf_update_tunnel_metadata,
            tunnels::cloudflared_version,
            tunnels::start_tunnel,
            tunnels::stop_tunnel,
            tunnels::get_tunnel_command,
            tunnels::get_tunnel_logs,
            ssh::ssh_save_credential,
            ssh::ssh_get_credential,
            ssh::ssh_delete_credential,
            ssh::ssh_list_credentials,
            ssh::ssh_export_local,
            ssh::ssh_get_config_status,
            ssh::ssh_sync_config,
            ssh::ssh_remove_from_config,
            ssh::ssh_preview_config,
            ssh::launch_terminal,
            ssh::launch_rdp,
            ssh::launch_smb,
            sync::ssh_sync_build_vault,
            sync::ssh_sync_open_vault,
            update::check_for_update,
            update::open_release_page,
            update::open_url
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Quitting TunnelDash (tray menu, Cmd+Q, dock) must never leave cloudflared
    // listeners running in the background.
    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            tunnels::kill_all_proxies();
            tunnels::persist_proxies(Some(app));
        }
    });
}
