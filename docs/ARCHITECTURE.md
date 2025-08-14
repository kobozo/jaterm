# Architecture

- Frontend: React + xterm.js in `src/`.
- Backend: Tauri + Rust in `src-tauri/`.
- Communication: Tauri `invoke` for commands, events for streaming data.
- Services: PTY, SSH, Git, Watch under `src-tauri/src/services/`.

Flow example (PTY):
Frontend asks `pty_open` -> Rust spawns PTY -> emits `PTY_OUTPUT` -> frontend renders in xterm.

