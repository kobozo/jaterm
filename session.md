# Session Summary: SSH Port Forwarding, Terminal Stability, and Git Helper Integration

## Context
- Goal: Add SSH port forwarding (Local now, Remote later), keep terminals stable across view switches, and drive Git features via helper with auto-refresh.
- Environment: Tauri + React app, Rust backend using `ssh2` (libssh2) and internal state in `src-tauri`.

## What We Implemented
- Terminal stability and concurrency safety
  - Introduced a per-SSH-session mutex to serialize all libssh2 calls across shell, exec, SFTP, and port forwarding.
  - Standardized lock ordering to prevent deadlocks: always acquire the session lock first, then any channel lock.
  - Shell reader, `ssh_exec`, `ssh_write`, `ssh_resize`, `ssh_close_shell` updated to respect the lock ordering and minimize lock hold time.

- SSH forwarding via ssh2 (libssh2)
  - Local `-L`: Implemented a local `TcpListener` that, per accepted connection, opens `channel_direct_tcpip(dst_host, dst_port, originator)` and bi-directionally pumps bytes between the local socket and the SSH channel.
  - Remote `-R`: Implemented server-side listen using `channel_forward_listen(port, Some(bind_host), None)`; each `accept()` yields an SSH channel that we bridge to a local `TcpStream` to `dst_host:dst_port`.
  - Non-blocking session support: libssh2 may return `WouldBlock (-37)` when the SSH session is in non-blocking mode. We added short retry loops for channel opens and for read/write operations.
  - Originator handling: For `-L` direct-tcpip, we try with `Some((client_ip, client_port))` first, then fall back to `None` if that fails (some servers are picky).
  - Logging: Directional byte counters are logged when each pump ends: `s->c` (server to client) and `c->s` (client to server), plus accept events and open errors.

- Session hygiene
  - KnownHosts: Best-effort verification of `~/.ssh/known_hosts` using `sess.known_hosts()`. We handle `Match`, `NotFound` (warn), `Mismatch` (error), and `Failure` (warn).
  - Keepalives: Enabled `sess.set_keepalive(true, 30)` to reduce idle disconnects.

## Files Touched (Rust backend)
- `src-tauri/src/commands/ssh.rs`
  - Added KnownHosts check and keepalive in `ssh_connect`.
  - Added per-session mutex usage across all SSH operations.
  - Implemented Local `-L` forward with accept loop, robust open retry/fallback, and bidirectional pumps with WouldBlock handling.
  - Implemented Remote `-R` forward using `channel_forward_listen` and per-accept bridging to local TCP.
  - Fixed non-blocking behavior and exit status retrieval in `ssh_exec`; ensured stderr and stdout are read safely.
  - Standardized lock order in `ssh_open_shell` reader, `ssh_write`, `ssh_resize`, `ssh_close_shell`.

- `src-tauri/src/state/app_state.rs`
  - `SshSession` now includes a session-level lock (`Arc<Mutex<()>>`) and identity (`host`, `port`, `user`).
  - Forward state updated to allow multiple backends; current path uses `LocalThread` for `-L`/`-R`.

## Current Behavior (observed)
- Accepts are logged for Local `-L` (e.g., `127.0.0.1:5174 -> 127.0.0.1:5173`) and we see repeated accept lines when the browser probes.
- Previously, responses were not flowing and curl showed `Recv failure: Connection reset by peer`.
- We added:
  - Retry on `channel_direct_tcpip` open under non-blocking sessions.
  - Fallback to `None` originator address.
  - Directional byte counters to verify flow.

## Known Issues / Open Items
- Local `-L`: If curl still shows resets and we do not see `s->c bytes=...`, likely causes:
  - Remote service at `dst_host:dst_port` is not accepting or immediately closing connections.
  - SSH server `AllowTcpForwarding` is disabled or restricted by policy.
  - Originator address is rejected; we now fall back to `None`, but we can expose a UI toggle to force one behavior.
  - Contention: Heavy background Git operations can add latency; we can pause/throttle Git auto-refresh while forwards are active.
- Remote `-R`: Binding to non-loopback requires `GatewayPorts yes` in the SSH server config; otherwise only loopback is exposed.
- Forward status events: Currently emit `active` and `closed`. We can extend to `starting`, `accepted`, `error` with details, and surface stderr/logs in the Ports UI.
- Dynamic `-D` (SOCKS5): Not yet implemented; can be added by bridging a small SOCKS5 server to `channel_direct_tcpip`.

## How To Build / Run / Validate
- Build and run dev:
  - `cd src-tauri && cargo build && pnpm dev`
- Start a Local forward in the Ports panel, e.g.: `127.0.0.1:5174 -> 127.0.0.1:5173` (remote side host:port).
- Validate with curl locally:
  - `curl -I http://127.0.0.1:5174 -vvv`
- Watch logs and confirm you see (per request):
  - `[fwd] L accept from ...`
  - `[fwd] L c->s bytes=...` and `[fwd] L s->c bytes=...`
- If you only see accepts and not the byte counters, capture any `[fwd] L direct-tcpip open error: ... (fallback None: ...)` lines.

## Quick Troubleshooting
- No response bytes (`s->c` is missing):
  - Verify the remote server binds on `dst_host` and listens on `dst_port`.
  - Try forcing originator to `None` (we can add a toggle; currently it falls back automatically if the first attempt fails).
  - Check SSH server policy: `AllowTcpForwarding yes`.
- Frequent resets:
  - Ensure only one app listens on the local bind `src_host:src_port` to avoid conflicts.
  - Temporarily close the Git panel to reduce background polling; if this helps, we’ll add auto-throttling while forwards are active.

## Next Steps (recommended)
1. Add UI toggle for originator address (Some vs None) in Local `-L`.
2. Extend tunnel state events with detailed lifecycle (`starting`, `active`, `accepted`, `error` with message/code).
3. Optionally pause/throttle Git auto-refresh while any SSH forward is active.
4. Implement Dynamic `-D` via SOCKS5 and bridge to `channel_direct_tcpip`.
5. Surface KnownHosts prompts in UI for first-time hosts instead of skipping on NotFound.
6. Add “Copy URL” and error toasts in Ports UI for quick testing/feedback.

## Reference Snippets (for future work)
- Local `-L` open with fallback:
  - Try `channel_direct_tcpip(dst_host, dst_port, Some((client_ip, client_port)))`.
  - On error (not WouldBlock), retry with `None` originator.
  - Use session lock around libssh2 calls; keep retries for WouldBlock with small sleeps (session is non-blocking).
- Remote `-R` accept loop:
  - `let (listener, _bound_port) = sess.channel_forward_listen(port, Some(bind_host), None)?;`
  - `let ch = listener.accept()?;` then connect to local `dst` and pump.

---

Owner: session created for handoff continuity after restart. See `src-tauri/src/commands/ssh.rs` and `src-tauri/src/state/app_state.rs` for latest changes. If you want this summarized in the UI, we can render this markdown in a dedicated “Session” view.
