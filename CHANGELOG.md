# Changelog

All notable changes to this project will be documented in this file.

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
