# Architecture

Overview
- Frontend (React + TypeScript) in `src/` renders UI and talks to the backend via Tauri `invoke()` and events.
- Backend (Rust, Tauri) in `src-tauri/` exposes commands (PTY, SSH, Git, helper) and emits events.
- Helper binary (`src-helper/`) accelerates Git/status operations and remote tasks.

Key Modules
- Terminal UI: `src/components/TerminalPane/` and `RemoteTerminalPane.tsx` using `@xterm/xterm`.
- IPC Types: `src/types/ipc.ts` – single source of truth for commands/events.
- SSH: `src-tauri/src/commands/ssh.rs` (connect, shell, forwards, SFTP).
- PTY: `src-tauri/src/commands/pty.rs` (local shell spawn and IO).
- Encryption: `src-tauri/src/encryption.rs`, `src-tauri/src/config_encrypted.rs`.

Event Flow (example: local PTY)
1) Frontend subscribes to `PTY_OUTPUT` and writes via `pty_write`.
2) Rust reads/writes with `portable_pty` and emits base64 data.
3) Frontend decodes and writes to xterm; parses OSC-7 for cwd.
