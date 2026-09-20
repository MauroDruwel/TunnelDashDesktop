# Changelog

All notable changes to this project will be documented in this file.

## [0.4.0] - 2026-09-20

### Added
- **OpenSSH key-based authentication** — `~/.ssh/config` blocks now include `User` and `IdentityFile` fields; no password entry ever needed.
- **macOS menu bar template icon** — dedicated monochrome `tray-icon.png` (cloud + gear silhouette, transparent background) with `icon_as_template(true)` so the system auto-inverts it for light/dark menu bars.

### Changed
- **Tunnels screen** — protocol selector replaced with a compact multi-choice dropdown (SSH, HTTP, TCP, RDP, SMB, All). No more horizontal tab overflow.
- **Row actions** — removed redundant "Open" button (hostname is now clickable); removed RDP button; kept SSH and Proxy Local. All ingress rules show Proxy Local / Disconnect unconditionally.
- **Stable table during refresh** — stale tunnel list is kept in-view while reloading; skeleton only shown when table is empty and `loading = true`, eliminating UI "despawning".
- **Credential form removed** — password fields scrubbed; SSH key path + optional passphrase replaces username/password in settings and SSH modal.
- **Settings — API token field hardened** — token is masked (readonly display); changing requires explicit "Re-verify Token" flow to prevent accidental edits.

### Fixed
- Tray icon was showing the full-colour app icon (a square) instead of a proper menu bar template image.
- `cloudflared` version is read live from the binary at startup, not cached.
- SSH config block generation preserves all user config before/after the managed marker block.
- `useTunnelState` stale closure fixed: `save`, `verify`, and `toggleTunnel` are now `useCallback`-stabilised with refs.

## [0.3.0] - 2026-08-23

### Added
- Port assignments are persisted back to Cloudflare tunnel metadata (`tunneldashPort`) via `PATCH /.../cfd_tunnel`, matching the mobile app. Requires `Cloudflare Tunnel: Edit`; read-only tokens still work in-session but won't persist.
- **SSH Sessions tab**: dashboard of every SSH endpoint across all tunnels — live online/offline health, local port binding (with "proxy active" hint), auth state, search + online/offline filters, and one-click **Connect** into the native terminal.
- **Per-host credential editor** (inline in the SSH tab): username + password *or* SSH key (path + passphrase), stored in the OS keychain. Connecting without saved credentials opens the editor; the dashboard's Terminal button redirects into it as well.
- **Saved Credentials card**: lists every keychain entry for the app — including orphaned hosts whose tunnels are gone — with confirm-to-remove and reload.
- **Menu bar tray icon** (macOS template image): lists currently proxying tunnels, opens the app on a clicked tunnel, Quit. Closing the window hides to the tray.
- **Launch at login** toggle (Settings → Startup, via the autostart plugin).
- **`tunneldash-cli`**: `list` / `status` / `connect` / `stop` sharing the app core (keychain, cloudflared resolution, ssh invocation). GUI- and CLI-started proxies coexist via a shared state file; ships with `skills/tunneldash/SKILL.md` for AI agents.
- **Encrypted credential sync** (Settings → Credential Sync): push/pull saved credentials through your own Cloudflare account as an AES-256-GCM vault in tunnel metadata (PBKDF2-SHA256, 600k iterations). Key derived from the API token (default) or a separate passphrase.
- **Clean lifecycle**: quitting kills every `cloudflared` listener the app spawned; startup reaps orphans left by crashed sessions before they can hold ports hostage.

### Removed
- The built-in xterm/russh web terminal (`TerminalScreen`, `TerminalView`, `session.rs`, `ssh/sessions.ts`) in favor of native terminal launching with full key support (`-i <key>`, passphrase via `SSH_ASKPASS`).

### Fixed
- Tauri builder: a second chained `.setup()` silently replaced the first — all startup hooks (vibrancy, tray, orphan reaper) now live in a single hook.
- The macOS bundle picked the wrong executable when multiple cargo bins existed; the CLI bin is now feature-gated and the main binary is pinned via `mainBinaryName`.
- `tunnels.rs` resolves the bundled `cloudflared` via Tauri `resource_dir`, supports sidecar `-<triple>` names and dev layout `src-tauri/binaries/`, falling back to `PATH` (the CLI resolves without a Tauri handle).
- `useTunnelState` is stale-closure safe: `save`, `verify`, `toggleTunnel`, and `ensureTunnelRunning` use refs + `useCallback`, persist correctly, and validate ports 1024-65535.
- Local port assignment gives each ingress route a unique sequential port; ports already saved in `tunneldashPort` metadata are reused, newly assigned ones are PATCHed back to Cloudflare.
- `settingsStorage` no longer leaks the `verified` flag into the `Settings` object.
- `TunnelsScreen` search no longer double-filters `hideOffline`; expanded state syncs when tunnels load; clipboard has a secure-context fallback.
- Removed external Google Fonts (CSP violation): system fonts only; `App.css` split into `src/styles/*` modules.
- `vite.config.ts` splits `react`/`tauri` into manualChunks to stay under the 500 kB warning.
- Unified theme handling via `src/theme.ts` (`cf-theme` key) and `useTheme()` in `App.tsx`.

### Changed
- `package.json` includes `description`, `repository`, `homepage`, `keywords`, and `license` for community discoverability.

## [0.2.0] - 2026-08-14

> First release shipped as a pre-release (`v0.2.0-pre.1`).

### Added
- SSH on any SSH rule: credential form (username/password) saved to the OS keychain (`security` CLI on macOS, Credential Manager / Secret Service elsewhere), then either open the native terminal (password auto-fed via `SSH_ASKPASS`) or connect through the built-in client.
- Built-in Termius-style SSH sessions: session tabs + xterm.js terminal, pure-Rust SSH (russh), sessions survive tab switches.
- Native macOS look: vibrancy, overlay title bar with traffic lights, sidebar navigation, Apple system colors/fonts, light/dark theme.
- cloudflared is now bundled as a Tauri sidecar for macOS/Windows/Linux - no manual cloudflared install needed (PATH fallback kept for dev).
- Settings moved from localStorage to the Tauri store plugin (with localStorage fallback for web preview).
- Linting (ESLint + typescript-eslint), unit tests (vitest + Rust tests), and `typecheck` script.
- CI/CD: `ci.yml`, `build.yml`, `release.yml` (GitHub Releases on tags), `opencode.yml`, `dependabot.yml`.
- Content Security Policy for production builds; system-font rendering (no remote font dependency).

### Fixed
- `parseProtocol` misparsed bare protocol names like `tcp` (returned `ssh`).
- Tunnel child processes now get killed tree-wide on Windows (`taskkill /T /F`).
- cloudflared stdout/stderr now logged to the app log dir for easier debugging.

### Changed
- UI restyled to a native macOS look: system fonts, Apple blue accent, sidebar navigation, vibrancy, light-by-default theme.
- Tab bar icons replaced with inline SVGs.
- App renamed to "TunnelDash" in window title, favicon, and product metadata.

## [0.1.0] - initial release

- Cloudflare token verification, tunnel listing, connect/disconnect via cloudflared.
- Onboarding wizard, settings with port range and display filters.
- React + TypeScript + Vite frontend, Tauri 2 backend.
