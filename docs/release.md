# Release And Update Setup

## GitHub Actions

- Workflow: `.github/workflows/release.yml`
- Trigger: push a tag like `v0.1.0`

## Required GitHub Secrets

- `TAURI_SIGNING_PRIVATE_KEY`
  - Store the full content of `C:\Users\William\.tauri\clawtachie-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  - Optional. Leave empty because the current key was generated without a password.

## Local Signing Material

- Private key: `C:\Users\William\.tauri\clawtachie-updater.key`
- Public key: `C:\Users\William\.tauri\clawtachie-updater.key.pub`

Do not commit the private key.

## Updater Endpoint

The desktop app checks GitHub Releases here:

- `https://github.com/Lucent-Snow/ClawTachie/releases/latest/download/latest.json`

This file is generated automatically by the Tauri release build once the updater artifacts are signed.

## Release Flow

1. Update the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Push a Git tag like `v0.1.0`.
3. Wait for GitHub Actions to finish building the signed installer and updater metadata.
4. Verify the GitHub Release assets, then publish the release.
