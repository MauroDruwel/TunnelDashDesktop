//! TunnelDash command-line companion.
//!
//! Shares all core logic with the desktop app (same crate): cloudflared
//! resolution, macOS Keychain credentials, proxy state file, and the exact
//! ssh invocation the GUI uses.

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::process::exit(tunneldash_lib::cli::run(args));
}
