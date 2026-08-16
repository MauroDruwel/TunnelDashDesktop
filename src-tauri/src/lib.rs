mod cloudflare;
mod session;
mod ssh;
mod tunnels;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_store::Builder::new().build());

    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

        builder = builder.setup(|app| {
            let window = app.get_webview_window("main").expect("main window missing");
            apply_vibrancy(
                &window,
                NSVisualEffectMaterial::Sidebar,
                Some(NSVisualEffectState::Active),
                Some(18.0),
            )
            .expect("failed to apply vibrancy");
            Ok(())
        });
    }

    builder
        .invoke_handler(tauri::generate_handler![
            cloudflare::cf_accounts,
            cloudflare::cf_tunnels,
            cloudflare::cf_tunnel_config,
            tunnels::cloudflared_version,
            tunnels::start_tunnel,
            tunnels::stop_tunnel,
            ssh::ssh_save_credential,
            ssh::ssh_get_credential,
            ssh::ssh_delete_credential,
            ssh::ssh_open,
            session::ssh_connect,
            session::ssh_write,
            session::ssh_resize,
            session::ssh_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
