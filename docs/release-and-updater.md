# Release And Updater

## GitHub Actions Release

The release workflow is defined in `.github/workflows/release.yml`.

It runs on Windows when a tag matching `v*` is pushed, for example `v0.1.0`.

The workflow expects these GitHub repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: The full content of your updater private key file.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Optional. Leave empty if the key has no password.

## Updater Key

The updater public key is embedded in `src-tauri/tauri.conf.json`.

The matching private key was generated locally and is not committed to this repository.

Local key paths:

- `C:\Users\William\.tauri\clawtachie-updater.key`
- `C:\Users\William\.tauri\clawtachie-updater.key.pub`

## Release Flow

1. Update the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Commit the version bump.
3. Push a Git tag such as `v0.1.0`.
4. GitHub Actions will build the NSIS installer and publish the release assets.
5. The updater endpoint will read `latest.json` from the latest GitHub release.
