# JATerm (Tauri + React + Rust + xterm.js)

Minimal, multi-OS terminal app scaffold using Tauri (Rust backend) and React (xterm.js frontend).
This repo is structured for PTY, SSH tunnels, Git status, and file watching services.

## Quick start

1) Install prerequisites: Rust (stable), Node.js + pnpm, Tauri deps per OS.
2) Install JS deps: `pnpm install`
3) Dev run: `pnpm dev` (runs Vite via Tauri config and launches the app)
4) Build: `pnpm build`

Note: Commands and services are stubs. Fill in Rust services and frontend bindings as needed.

## Structure

See the folder layout in this README’s sibling files. Frontend code lives in `src/` and the
Tauri backend in `src-tauri/`.

## Next steps

- Choose a license (replace LICENSE placeholder).
- Wire PTY/SSH/Git/watch services in Rust, then expose commands.
- Add xterm.js session management and events in the frontend.
- Harden Tauri allowlist and review docs/SECURITY.md.

