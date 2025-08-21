# Release & Updater

Updater
- Uses Tauri updater plugin. App checks for updates on startup and on-demand.
- Configure signing keys per `UPDATER_SETUP.md` and `GENERATE_UPDATER_KEYS.md`.

Builds
- Local production: `pnpm tauri build` or `make build`.
- CI: see GitHub Actions (uses TAURI_SIGNING_PRIVATE_KEY secrets).

User Flow
- On update available, a toast offers “Restart & Update”.
- Release notes link opens GitHub Releases.
