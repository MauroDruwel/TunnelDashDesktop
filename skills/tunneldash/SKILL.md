---
name: tunneldash
description: Control Cloudflare Tunnel local proxies and SSH sessions from the CLI via `tunneldash-cli` (list tunnels, connect/stop proxies, check status). Use when a task needs access to servers behind Cloudflare Tunnels on this machine.
---

# TunnelDash CLI

`tunneldash-cli` is the terminal companion to the TunnelDash desktop app. It starts/stops local cloudflared proxies (`cloudflared access`) and opens interactive SSH sessions through them, reusing the exact credentials stored by the desktop app.

## Prerequisites

- The TunnelDash desktop app has been launched once and its API token verified (the CLI reads the saved settings).
- `cloudflared` available: bundled with the app, or on PATH (`brew install cloudflared`).
- SSH credentials configured once per host — either in the desktop app (**SSH Sessions → Configure**) or inline via connect flags.

## Commands

```sh
tunneldash-cli list      # all tunnels + endpoints (ssh/tcp/http) with local ports
tunneldash-cli status    # what is proxied right now (liveness-checked)
tunneldash-cli connect <host> [flags]   # proxy host + open SSH in Terminal.app
tunneldash-cli stop <host>              # stop one proxy ("stop --all" stops everything)
```

### connect flags

| Flag | Meaning |
|---|---|
| `--port N` | Local port to bind (default: next free port from 50000) |
| `--username U` | SSH username (persisted to the keychain) |
| `--password P` | Password auth (stored in OS keychain) |
| `--key-path K` | Private key path (stored in OS keychain) |
| `--key-passphrase S` | Passphrase for that key |

### Examples

```sh
tunneldash-cli list
tunneldash-cli connect prod-db.corp.example.com
tunneldash-cli connect db.internal.example.com --username deploy --key-path ~/.ssh/id_ed25519 --port 51000
tunneldash-cli status
tunneldash-cli stop prod-db            # partial hostname match works
```

`connect` is idempotent: if the host is already proxied and listening it reuses the existing listener. It waits until the local listener answers, then opens Terminal.app running the ssh command (passwords/key passphrases are fed via a 0600 SSH_ASKPASS helper that self-deletes after 10 minutes).

## Behavior notes

- Credentials are keyed by **hostname** in the macOS Keychain, service `be.maurodruwel.tunneldash`. Never print or echo secrets.
- Running proxy state lives in `~/Library/Caches/be.maurodruwel.tunneldash/proxies.json`. GUI-started proxies are owned by the app (visible in its menu bar tray); CLI-started ones are owned by the CLI. Both show up in `status`; `stop` can kill either.
- Prefer keychain-saved credentials over inline `--password` flags.
- Exit codes: `0` success, `1` error (message goes to stderr) — safe to script/loop against.

## Building the CLI from source

```sh
cd src-tauri && cargo build --release --features cli --bin tunneldash-cli
# binary at src-tauri/target/release/tunneldash-cli
```

The CLI bin is feature-gated so the desktop app bundle only ever contains one
executable — always pass `--features cli` when building it.
