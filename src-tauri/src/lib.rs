mod cloudflare;
mod ssh;
mod tunnels;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            cloudflare::cf_accounts,
            cloudflare::cf_tunnels,
            cloudflare::cf_tunnel_config,
            tunnels::cloudflared_version,
            tunnels::start_tunnel,
            tunnels::stop_tunnel,
            ssh::ssh_connect,
            ssh::ssh_write,
            ssh::ssh_resize,
            ssh::ssh_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
