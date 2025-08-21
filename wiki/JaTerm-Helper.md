# JaTerm Helper

What & Why
- `jaterm-agent` is a tiny Rust binary used to accelerate Git/status checks, port detection, and some remote tasks. It keeps the UI snappy by moving heavier work off the main process and by running natively on the target host for SSH sessions.

Where it lives
- Local source: `src-helper/` (Rust crate).
- Default install paths:
  - Local (dev install): `~/.jaterm-helper/jaterm-agent-bin`
  - Remote (SSH sessions): `~/.jaterm-helper/jaterm-agent`

Capabilities
- Health/version: `jaterm-agent health` → JSON with `{ ok, version, os }`.
- Git status and changes for fast prompts and status bar.
- Port detection on remote hosts to help with forward setup.

How it’s installed
- Local: `make build-helper` then `make install-helper-dev` to put a copy under `~/.jaterm-helper/` for testing.
- Remote: on first SSH connect, the app calls `ensureHelper(sessionId)` which:
  1. Checks `~/.jaterm-helper/jaterm-agent health`.
  2. If missing/outdated, uploads the correct binary via SFTP (`ssh_deploy_helper`) and `chmod +x`.
  3. Verifies with `health` and records version/OS.

How the app uses it
- Frontend: `src/services/helper.ts` (functions `ensureHelper` and `ensureLocalHelper`).
- Backend: `src-tauri/src/commands/helper.rs` exposes helper bytes; `ssh_deploy_helper` writes them to the remote over SFTP.

Security notes
- The helper is versioned and verified with a health check after upload.
- Paths are under the user’s home directory; no elevated privileges required.

Troubleshooting
- If install fails, check remote permissions on `~/.jaterm-helper/` and available disk space.
- Run manually on the remote: `~/.jaterm-helper/jaterm-agent health` and inspect output.
