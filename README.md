<p align="center">
  <img width="120" alt="TunnelDash Logo" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/public/favicon.svg" />
</p>

<h1 align="center">🕳️ TunnelDash Desktop</h1>
<p align="center"><b>A tiny Cloudflare Tunnel sidekick with a built-in SSH terminal.</b></p>

<p align="center">
  <a href="#-screenshots">Screenshots</a> |
  <a href="#%EF%B8%8F-getting-started">Getting Started</a> |
  <a href="#-api-permissions">Permissions</a> |
  <a href="#-how-it-works">How It Works</a> |
  <a href="#-endpoints-used">Endpoints Used</a>
</p>

<p align="center">
  <img alt="Release" src="https://img.shields.io/github/v/release/MauroDruwel/TunnelDashDesktop"/>
  <img alt="License" src="https://img.shields.io/github/license/MauroDruwel/TunnelDashDesktop"/>
  <img alt="Platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-blue"/>
</p>

Stop grepping through config files or memorizing hostnames. TunnelDash connects to the Cloudflare API, auto-detects your services (SSH, TCP, HTTP), assigns them local ports, and spins up the `cloudflared access` commands you actually need - then lets you SSH into the box without leaving the app.

## 🚀 Why use this?

If you use Cloudflared Tunnels for infrastructure access, you know the pain of typing this out every time:
`cloudflared access ssh --hostname long-server-name.corp.com --url localhost:50000`

**TunnelDash Desktop handles the boilerplate.**

*   **Auto-Discovery:** Reads your tunnel ingress rules to find SSH, TCP, and HTTP services.
*   **Port Management:** Automatically assigns local ports (starting at 50000).
*   **One-Click Connect:** Starts/stops `cloudflared` for any ingress rule - no CLI needed.
*   **Built-in SSH Terminal:** Password or private-key auth, full xterm.js terminal, sessions survive tab switches.
*   **Zero Install:** cloudflared is bundled with the app for macOS, Windows, and Linux.

## 📸 Screenshots

| Tunnels | SSH Terminal | Settings |
|---|---|---|
| <img width="280" alt="Screenshot" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/docs/screenshots/tunnels.png" /> | <img width="280" alt="Screenshot" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/docs/screenshots/terminal-connected.png" /> | <img width="280" alt="Screenshot" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/docs/screenshots/settings.png" /> |
|  | <img width="280" alt="Screenshot" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/docs/screenshots/terminal.png" /> |  |

### Setup Screenshots

<table>
  <tr>
    <td><img width="280" alt="Screenshot" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/docs/screenshots/setup-welcome.png" /></td>
    <td><img width="280" alt="Screenshot" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/docs/screenshots/setup-port.png" /></td>
    <td><img width="280" alt="Screenshot" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/docs/screenshots/setup-api.png" /></td>
  </tr>
</table>

## 🛠️ Getting Started

Download the binaries from the latest release or build locally:

1.  Have pnpm and a Rust toolchain installed.
2.  Install deps: `pnpm install`
3.  Run the app: `pnpm tauri dev`
4.  Walk through setup, paste token, verify, hop to tunnels, connect.

To test a production-style bundle locally:

```bash
node scripts/download-cloudflared.mjs   # fetch the cloudflared sidecar for your platform
pnpm tauri build
```

*Note for macOS: building the `.dmg` installer requires the `create-dmg` package (`brew install create-dmg`); the `.app` bundle builds without it.*

### 🔐 API Permissions

You need a generic API token. Go to [Cloudflare Profile > API Tokens > Create Token](https://dash.cloudflare.com/profile/api-tokens) and use the **"Create Custom Token"** template.

**Required permissions:**

| Resource | Permission | Why? |
| :--- | :--- | :--- |
| **Account Settings** | `Read` | To find your Account ID automatically. |
| **Cloudflare Tunnel** | `Read` | To list tunnels and read ingress rules. |

*Unlike the mobile app, the desktop version never writes to your tunnel metadata - read-only is enough.*

## 🧠 How It Works

TunnelDash Desktop is a Tauri (Rust) wrapper around the Cloudflare API with a local `cloudflared` sidecar.

1.  **Fetch:** It pulls your tunnel list and configurations via the API.
2.  **Parse:** It looks at ingress rules (e.g., `ssh://localhost:22`) to determine the service type.
3.  **Map:** It maps each hostname to a local port and lets you start `cloudflared access` with one click.
4.  **Terminal:** SSH sessions run through a pure-Rust SSH client (russh) wired to an xterm.js terminal.

## 🔌 Endpoints Used
For those curious about what the app is doing:
*   `GET /accounts` (Auth check)
*   `GET /.../cfd_tunnel` (List tunnels)
*   `GET /.../configurations` (Read ingress rules)

## 🤝 Contributing

Found a bug? Want to add a feature? PRs are welcome.

---
*Built for people who love Cloudflared Tunnels but don't want to remember every cloudflared access command*
