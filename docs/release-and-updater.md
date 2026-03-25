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

If the GitHub secret `TAURI_SIGNING_PRIVATE_KEY` is rotated, `src-tauri/tauri.conf.json` must be updated to embed the matching public key before the next release.

Otherwise updater verification will fail with `The signature was created with a different key than the one provided`, and existing installs using the old embedded public key will require a manual reinstall to move onto the new signing chain.

## Release Flow

1. Update the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Commit the version bump.
3. Push a Git tag such as `v0.1.0`.
4. GitHub Actions will build the NSIS installer and publish the release assets.
5. The updater endpoint will read `latest.json` from the latest GitHub release.
