# JATerm Architecture and Plan

## Vision
- Build a fast, secure, cross‑platform terminal/SSH app with a modern UI: split panes, robust SSH with intuitive local/remote/reverse forwarding, live Git status, and a Makefile watcher that can spawn builds in a sub‑terminal.
- Stack: Tauri (small binaries, strong security) + Rust backends (PTY/SSH/Git/fs‑watch) + xterm.js (battle‑tested terminal emulation).

## Primary Outcomes
- Terminal ergonomics: multiple panes/tabs, fast rendering, resize/IME support.
- First‑class SSH: saved connections, easy port‑forward presets, health indicators.
- Repository awareness: compact Git status (branch, ahead/behind, staged/unstaged).
- Automations: watch the working directory & Makefile, debounce, trigger builds in a sub‑terminal.
- True cross‑platform PTY: Unix PTYs + Windows ConPTY via `portable-pty`.

## Users & Jobs
- DevOps/Backend: juggle SSH tunnels, logs; need reliable split panes and persistent sessions.
- Data/ML: long builds and remote jobs; quick “forward 8888” for notebooks.
- SREs: monitor services, tail logs, kick off Make/CI tasks from repo root.

## Feature Set (V1)
1) Split panes & tabs
- Create/close panes; drag to reflow; save/restore layouts.
- Each pane is an xterm.js instance connected to a PTY.

2) SSH connections & tunnels
- Connection manager (host, user, key, jump host optional).
- One‑click Local, Remote, Reverse forwarding with status chips per forward.
- Backed by `ssh2` (libssh2).

3) Git status bar
- Auto‑detect repo in active pane’s CWD; show branch, ahead/behind, staged/unstaged counts using `git2`.

4) Makefile watcher & build pane
- `notify` subscribes to repo changes; debounce; on Build, run `make` in a new PTY sub‑terminal.

5) Cross‑platform PTY
- Use `portable-pty` to abstract Unix PTY and Windows ConPTY (Windows 10+).

6) Command editor drawer (optional)
- Drawer for multiline composition; Cmd+Enter sends to PTY.

## Non‑Goals (V1)
- No full IDE features (code intelligence, diff UI).
- No plugin system.
- No remote file browser/SFTP.

## Architecture
- Frontend (Vite/React)
  - xterm.js instances per pane; stream via Tauri events.
  - Lightweight store for sessions, forwards, repo status.
  - Local storage for preferences and saved SSH profiles.
- Backend (Rust in `src-tauri`)
  - PTY service: spawn shells/commands; resize; write/read; multiplex output.
  - SSH service: sessions, channels, forwards via `ssh2`.
  - Git service: repo discovery & status via `git2`.
  - Watcher service: fs notifications via `notify` (debounced).
  - Events bus: emits PTY_OUTPUT, GIT_STATUS, WATCH_EVENT, SSH_TUNNEL_STATE.

### Windows specifics
- Host terminals with ConPTY (via `portable-pty`).

## Key Data Models (sketch)
- Session: `{ id, cwd, env, shell, pty_id }`
- SshProfile: `{ id, host, port, user, auth: { keyPath|agent|password }, jump?: SshProfileRef }`
- PortForward: `{ id, type: 'L'|'R'|'D', srcHost, srcPort, dstHost, dstPort, status }`
- GitStatus: `{ branch, ahead, behind, staged, unstaged, conflicted }`

## Commands & Events
- Commands (`#[tauri::command]`):
  - `pty_open({cwd, env, shell, cols, rows}) -> { ptyId }`
  - `pty_write({ ptyId, data })`
  - `pty_resize({ ptyId, cols, rows })`
  - `pty_kill({ ptyId })`
  - `ssh_connect(profileId) -> { sessionId }`
  - `ssh_disconnect(sessionId)`
  - `ssh_open_forward(sessionId, PortForward) -> { forwardId }`
  - `ssh_close_forward(forwardId)`
  - `git_status({ cwd }) -> GitStatus`
  - `watch_subscribe({ paths }) -> { subscriptionId }`
  - `watch_unsubscribe(subscriptionId)`
- Events (frontend listens)
  - `PTY_OUTPUT({ ptyId, data })`
  - `PTY_EXIT({ ptyId, code, signal })`
  - `SSH_TUNNEL_STATE({ forwardId, status })`
  - `GIT_STATUS({ cwd, status })`
  - `WATCH_EVENT({ path, kind })`

## Security & Privacy
- Keep Tauri API allowlist minimal; validate inputs across FE/BE.
- Don’t persist secrets unencrypted; prefer OS keychains.
- Sanitize paths/env crossing FE/BE boundaries.

## Performance Notes
- Use xterm.js write buffering; avoid reflow on each chunk.
- Stream PTY output via events; debounce Git and watch updates.
- Keep frontend dependencies lean.

## Compatibility & Prereqs
- macOS, Linux, Windows 10 1809+ (ConPTY).
- OpenSSL for `ssh2` (crate auto‑builds/links if missing; follow crate guidance when bundling).

## Milestones
- M0 – Walking skeleton (1–2 weeks)
  - Single xterm pane ↔ PTY; open/resize/close; echo test.
  - Git status for active CWD; basic status bar.
  - File watcher hooked up; log events.
- M1 – SSH & forwards
  - Saved profiles; connect/disconnect.
  - Local forward; then remote/reverse; surface state in UI.
- M2 – Panes & build sub‑terminal
  - Split panes/tabs; persistent layouts.
  - Build button runs make in a new PTY pane.
- M3 – Polish
  - Command editor drawer.
  - Robust error surfaces; telemetry toggles; theming.

---

See `src/types/ipc.ts` for the typed command/event interface used by the frontend.
