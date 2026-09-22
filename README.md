<p align="center">
  <img width="120" alt="TunnelDash Logo" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/public/favicon.png" />
</p>

<h1 align="center">🕳️ TunnelDash Desktop</h1>
<p align="center"><b>A tiny Cloudflare Tunnel sidekick that SSHes you anywhere — from the GUI, the menu bar, or the CLI.</b></p>

<p align="center">
  <a href="#-screenshots">Screenshots</a> |
  <a href="#%EF%B8%8F-getting-started">Getting Started</a> |
  <a href="#-cli">CLI</a> |
  <a href="#-credential-sync">Credential Sync</a> |
  <a href="#-api-permissions">Permissions</a> |
  <a href="#-how-it-works">How It Works</a> |
  <a href="#-development">Development</a>
</p>

<p align="center">
  <a href="https://github.com/MauroDruwel/quality-gate"><img alt="Mauro Quality Gate" src="https://img.shields.io/badge/Mauro%20Quality%20Gate-Passed-2ea44f?style=flat&logo=github"/></a>
  <img alt="Release" src="https://img.shields.io/github/v/release/MauroDruwel/TunnelDashDesktop"/>
  <img alt="License" src="https://img.shields.io/github/license/MauroDruwel/TunnelDashDesktop"/>
  <img alt="Platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-blue"/>
  <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/MauroDruwel/TunnelDashDesktop/ci.yml?branch=main&label=CI"/>
</p>

Stop grepping through config files or memorizing hostnames. TunnelDash connects to the Cloudflare API, auto-detects your services (SSH, TCP, HTTP), assigns them local ports, spins up the `cloudflared access` commands you actually need — and drops you into a native SSH session without leaving the app.

## 🚀 Why use this?

If you use Cloudflare Tunnels for infrastructure access, you know the pain of typing this out every time:
`cloudflared access ssh --hostname long-server-name.corp.com --url localhost:50000`

**TunnelDash Desktop handles the boilerplate.**

 *   **Auto-Discovery:** Reads your tunnel ingress rules to find SSH, TCP, and HTTP services.
 *   **OpenSSH Integration (`~/.ssh/config` & Windows `%USERPROFILE%\.ssh\config`):** Automatically generates isolated, delimited host blocks so `ssh <alias>` instantly connects through Cloudflare Zero Trust Access on macOS, Linux, and Windows 10/11.
 *   **Zero Trust Key Authentication:** Configure default or per-host `User` and `IdentityFile` (`~/.ssh/id_ed25519`) for passwordless access.
 *   **Port Management:** Automatically assigns sequential local ports (starting at 50000) and persists them to Cloudflare metadata.
 *   **SSH Sessions Tab:** Every SSH endpoint across all tunnels with live Cloudflare health, interactive click-to-copy `ssh <alias>` badges, and 1-click native terminal launching.
 *   **Native Terminal Launcher:** 1-click launch your preferred system terminal (macOS Terminal.app, Windows Terminal / PowerShell, Linux emulator) directly connected into your server.
 *   **Cloudflare Kumo Design System:** True Cloudflare look-and-feel with live KPI metric ribbons, shimmer skeletons, and dual status/protocol filters.
 *   **Menu Bar Tray:** Glance at active proxies, jump back into the app, and quit cleanly.
 *   **CLI for Humans & AI Agents:** Companion `tunneldash-cli` with an agent-ready `SKILL.md`.
 *   **Zero Install:** `cloudflared` is bundled with the app cross-platform.

## 📸 Screenshots

| Tunnels | SSH Sessions |
|---|---|
| <img width="700" alt="Tunnels" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/docs/screenshots/tunnels.png" /> | <img width="700" alt="SSH Sessions" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/docs/screenshots/ssh-sessions.png" /> |

| Settings | Credential Sync |
|---|---|
| <img width="700" alt="Settings" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/docs/screenshots/settings.png" /> | <img width="700" alt="Credential Sync" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/docs/screenshots/credential-sync.png" /> |

<details>
<summary>Setup flow</summary>

| Welcome | Port | API Token |
|---|---|---|
| <img width="440" alt="Welcome" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/docs/screenshots/setup-welcome.png" /> | <img width="440" alt="Port" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/docs/screenshots/setup-port.png" /> | <img width="440" alt="API Token" src="https://raw.githubusercontent.com/MauroDruwel/TunnelDashDesktop/main/docs/screenshots/setup-api.png" /> |

</details>

## 🛠️ Getting Started

Download the binaries from the latest release or build locally:

1.  Have pnpm and a Rust toolchain installed.
    - Linux devs also need: `libwebkit2gtk-4.1-dev build-essential pkg-config libayatana-appindicator3-dev librsvg2-dev` (the appindicator lib powers the tray icon).
2.  Install deps: `pnpm install`
3.  Run the app: `pnpm tauri dev`
4.  Walk through setup, paste token, verify, hop to **SSH Sessions**, connect.

To test a production-style bundle locally:

```bash
node scripts/download-cloudflared.mjs   # fetch the cloudflared sidecar for your platform
pnpm tauri build
```

*Note for macOS: building the `.dmg` installer requires the `create-dmg` package (`brew install create-dmg`); the `.app` bundle builds without it.*

### Demo mode

Append `?demo` to the URL when running `pnpm dev` to preview the UI with mock data (used for screenshots). Add `?demo&setup` to force the onboarding wizard, or `?demo&tab=ssh` / `?demo&tab=settings` to jump straight to a tab.

## 🖥️ CLI

`tunneldash-cli` shares the Rust core with the desktop app: same cloudflared resolution, same OS keychain credentials, same ssh invocation, same proxy state.

```bash
tunneldash-cli list                        # all tunnels + ssh/tcp/http endpoints with local ports
tunneldash-cli status                      # what's proxied right now (liveness-checked)
tunneldash-cli connect <host> [flags]      # proxy host + open SSH in a new terminal window
tunneldash-cli stop <host> | --all         # stop proxies (partial hostname match works)

# connect flags: --port N  --username U  --password P  --key-path K  --key-passphrase S
tunneldash-cli connect prod-db.corp.example.com
tunneldash-cli connect db.internal.example.com --username deploy --key-path ~/.ssh/id_ed25519
```

`connect` is idempotent — an already-listening host is reused. GUI-started and CLI-started proxies coexist: the tray shows the app's, `status` shows everyone's, `stop` can kill either. Build it with:

```bash
cd src-tauri && cargo build --release --features cli --bin tunneldash-cli
```

AI agents: point them at [`skills/tunneldash/SKILL.md`](./skills/tunneldash/SKILL.md) — it documents the whole surface.

## 🔑 OpenSSH Client Integration (`~/.ssh/config` & Windows)

TunnelDash automatically keeps your system OpenSSH client configured with clean, isolated host entries:

```sshconfig
# >>> TunnelDash managed SSH configuration >>>
# Automatically generated by TunnelDash. Any manual changes inside this block will be overwritten.

Host generalserver
    HostName ssh-generalserver.maurodruwel.be
    ProxyCommand /usr/local/bin/cloudflared access ssh --hostname %h
    User codermauro
    IdentityFile ~/.ssh/id_ed25519

# <<< TunnelDash managed SSH configuration <<<
```

### Cross-Platform OpenSSH Support

*   **macOS**: Synchronizes to `~/.ssh/config` (`0600` permissions).
*   **Linux**: Synchronizes to `~/.ssh/config` across standard distributions.
*   **Windows 10/11**: Synchronizes to `%USERPROFILE%\.ssh\config`. The built-in OpenSSH client (preinstalled since Windows 10 1809) reads this file natively from Windows Terminal, PowerShell, or Command Prompt.

Any user configurations before or after the delimiter markers are **strictly preserved untouched**.

### Zero Trust Passwordless Connection

Simply type:
```bash
ssh generalserver
```
OpenSSH invokes `cloudflared access ssh` on-the-fly and authenticates with your configured SSH key without needing separate proxy daemons running.

## 🗂️ Project structure

```
src/
  App.tsx                 # shell, sidebar, tab routing, tray navigation events
  theme.ts                # light/dark theme hook (cf-theme key)
  useTunnelState.ts       # settings, verification, tunnel fetch, connect/disconnect
  api.ts                  # Tauri invoke wrappers + demo mocks
  types.ts                # shared types
  components/icons.tsx    # Cloudflare-accurate SVG icons
  screens/
    TunnelsScreen.tsx     # tunnel table, filters, per-route actions
    SshScreen.tsx         # SSH dashboard, credential editor, saved-credentials card
    SettingsScreen.tsx    # token, ports, startup, credential sync, display filters
  setup/Steps.tsx         # onboarding wizard steps
  utils/
    tunnelTransforms.ts   # ingress → display logic (tested)
    settingsStorage.ts    # Tauri Store + localStorage fallback (tested)
    errors.ts             # error normalization (tested)
  styles/                 # modular CSS (variables, sidebar, tables, ssh, ...)
skills/tunneldash/SKILL.md  # AI-agent guide for the CLI
src-tauri/src/
  lib.rs, main.rs         # Tauri entry, single setup hook, exit cleanup
  cloudflare.rs           # Cloudflare API (reqwest/rustls)
  tunnels.rs              # cloudflared sidecar control + shared proxy state file
  ssh.rs                  # OS keychain, native terminal launcher (SSH_ASKPASS)
  sync.rs                 # AES-GCM vault crypto for credential sync (tested)
  tray.rs                 # menu bar icon + live proxy menu
  cli.rs                  # tunneldash-cli (feature-gated bin)
```

### 🔐 API Permissions

You need a generic API token. Go to [Cloudflare Profile > API Tokens > Create Token](https://dash.cloudflare.com/profile/api-tokens) and use the **"Create Custom Token"** template.

**Required permissions:**

| Resource | Permission | Why? |
| :--- | :--- | :--- |
| **Account Settings** | `Read` | To find your Account ID automatically. |
| **Cloudflare Tunnel** | `Edit` | To list tunnels, read ingress rules, and persist port assignments + the credential vault to tunnel metadata. |

*Note: A `Read`-only Tunnel token still works — the app will assign and use ports in-session and skip syncing, but it cannot persist anything back to Cloudflare.*

## 🧠 How It Works

TunnelDash Desktop is a Tauri (Rust) wrapper around the Cloudflare API with a local `cloudflared` sidecar.

1.  **Fetch:** It pulls your tunnel list and configurations via the API.
2.  **Parse:** It looks at ingress rules (e.g., `ssh://localhost:22`) to determine the service type.
3.  **Assign:** It assigns a unique local port (default `50000`, then `50001`, …) to each ingress route, reusing any ports already saved in the tunnel's `tunneldashPort` metadata.
4.  **Persist:** It saves that port map back to the tunnel's metadata (`PATCH /.../cfd_tunnel`) so your ports stay consistent across devices — same as the mobile app.
5.  **Proxy:** One click starts `cloudflared access` for any route; the menu bar tray mirrors what's running.
6.  **SSH:** The SSH tab lists every SSH route with live Cloudflare health. **Connect** ensures the proxy is up, then opens your native terminal (`ssh -i <key> -o StrictHostKeyChecking=accept-new -p <port> user@127.0.0.1`); passwords and key passphrases are fed via a `0600` `SSH_ASKPASS` helper that self-deletes after 10 minutes. Credentials live in the OS keychain (`security` CLI on macOS, Credential Manager / Secret Service elsewhere).
7.  **Sync & survive:** The credential vault rides in tunnel metadata; running proxies are tracked in a shared state file; quitting kills all spawned listeners and the next launch reaps anything a crash left behind.

## 🔌 Endpoints Used
For those curious about what the app is doing:
*   `GET /accounts` (Auth check)
*   `GET /.../cfd_tunnel` (List tunnels)
*   `GET /.../configurations` (Read ingress rules)
*   `PATCH /.../cfd_tunnel` (Save port assignments + encrypted credential vault to metadata)

## 🧪 Development

```bash
pnpm lint          # eslint
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm build         # tsc + vite
```

Preview a production build without Tauri:
```bash
pnpm build && pnpm preview
# open http://localhost:4173/?demo
```

## 🔒 Security notes

- App-local storage only: token/account stay on your machine except for Cloudflare API calls.
- SSH credentials (passwords **and** private-key references) go to the OS keychain — never stored in the app's files. Only the key *path* + optional passphrase are saved; the key file itself stays where you put it.
- Credential sync stores only AES-256-GCM ciphertext in tunnel metadata; keys are derived via PBKDF2-SHA256 (600k iterations) from your token or a separate passphrase. Disable sync by simply not pushing.
- The temporary `SSH_ASKPASS` helper under the app cache dir is `0600`/`0700` and auto-removed after 10 minutes.
- Host keys are accepted TOFU-style (`StrictHostKeyChecking=accept-new`) — sensible for ephemeral localhost ports; full pinning is on the roadmap.
- Quitting the app (or tray → Quit) terminates every `cloudflared` process it spawned.

## 🤝 Contributing

Found a bug? Want to add a feature? PRs are welcome.

1. Fork and create a feature branch.
2. Run `pnpm lint && pnpm typecheck && pnpm test` and `cargo fmt --check && cargo clippy --all-targets -- -D warnings`.
3. Open a PR — CI will run frontend + backend checks on Ubuntu.

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for setup details and the full checklist. By participating you agree to abide by the project's [Code of Conduct](./CODE_OF_CONDUCT.md).

## 📝 Notes

See [CHANGELOG.md](./CHANGELOG.md) for release history.

---

*Built for people who love Cloudflare Tunnels but don't want to remember every cloudflared access command*
