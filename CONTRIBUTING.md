# Contributing to TunnelDash Desktop

Thanks for your interest in improving TunnelDash! This is a Tauri (Rust) + React/TypeScript app, so contributions touch either the frontend (`src/`) or the Rust core (`src-tauri/src/`).

## Getting started

```bash
pnpm install                 # install JS deps
pnpm tauri dev               # run the app with hot reload
```

You'll need a Rust toolchain and (on Linux) the webkit/appindicator dev libraries listed in the README.

## Before opening a PR

Run the same checks CI runs:

```bash
pnpm lint                    # eslint
pnpm typecheck               # tsc --noEmit
pnpm test                    # vitest
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

The `deploy:fix` / `lint:fix` scripts can auto-correct most lint issues.

## Guidelines

- Keep files focused and reasonably sized; extract logic into tested pure functions under `src/utils/` or dedicated Rust modules.
- Add tests for new transform/crypto/version-parsing logic.
- Credentials and secrets live in the OS keychain — never log them or commit them.
- Document user-facing changes in `CHANGELOG.md`.

## Reporting bugs

Open an issue with your OS, app version, and the relevant `cloudflared-*.log` output from the app log dir.
