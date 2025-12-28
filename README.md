# TunnelDash Desktop

Tiny Cloudflare Tunnel sidekick built with React + Tauri. Verify a token, see your tunnels, and flip them on/off without touching the CLI. UI vibe: chunky gradients, high-contrast cards, SlashOS-ish.

Related project (Android mobile): https://github.com/maurodruwel/tunneldash. This repo is the desktop version.

## What it does (quick tour)
- Setup: pick a starting local port and drop in a Cloudflare token (`Account Settings:Read` + `Cloudflare Tunnel:Read`).
- Verify: Rust/Tauri calls `GET /accounts`, caches account info in local storage.
- Tunnels: lists your tunnels, shows connection bits, can hide HTTP entries, and tries to surface the Cloudflared version.
- Connect: for each ingress rule we map host → local port and ask Rust to start/stop `cloudflared` with that mapping.
- Settings: tweak display, bump the port start, or erase local data.

## Getting started
1) Have pnpm and dependencies installed.
2) Install deps: `pnpm install`
3) Run the app: `pnpm tauri dev`
4) Walk through setup, paste token, verify, hop to tunnels, connect.

## Project structure
- `src/App.tsx` – tab shell for tunnels vs settings.
- `src/useTunnelState.ts` – brains: settings, verification, tunnel fetch, connect/disconnect.
- `src/screens/` – `TunnelsScreen` and `SettingsScreen` UIs.
- `src/setup/Steps.tsx` – onboarding steps.
- `src/utils/` – local storage helper + tunnel transforms.
- `src-tauri/` – Rust side: Cloudflare API calls and `cloudflared` control (see `src-tauri/src`).

## Notes
- Local storage only: token/account stay local except for the Cloudflare API calls.
- Ports: start from your `portStart` between 1024–65535.
- Filters: hide HTTP/HTTPS if you only care about SSH/other protocols; can also hide IP info.

## Commands
- `pnpm dev` – web preview (no Tauri backend).
- `pnpm tauri dev` – full desktop app for testing.
- `pnpm tauri build` – production build.

## Credits
- UI inspiration: SlashOS aesthetics.
- Built with Vite, React, TypeScript, and Tauri 2.
