# Host Trust Flow

Goal: prevent silent SSH MITM by prompting on first connect, showing the server’s public key fingerprint, and persisting trust to `~/.ssh/known_hosts`.

## UX

- On unknown host: show modal with host, port, key type, and SHA256 fingerprint. Options: Trust & Continue, Cancel.
- On mismatch: show error and block connect.
- On failure to read known_hosts: treat as unknown host and prompt.

## Backend

- Location: `src-tauri/src/commands/ssh.rs` within `ssh_connect`.
- After `handshake()`, retrieve `sess.host_key()` and check with libssh2 KnownHosts reader.
- Cases:
  - Match: proceed.
  - NotFound/Failure and `trust_host != true`: return `Err(JSON)` with shape:
    `{ "error":"KNOWN_HOSTS_PROMPT", "host", "port", "keyType", "fingerprintSHA256" }`.
  - NotFound/Failure and `trust_host == true`: append `"host keytype base64key"` to `~/.ssh/known_hosts` and proceed.
  - Mismatch: return error.
- Fingerprint: SHA256 of raw host key bytes, base64 without padding.

## Frontend

- Types: `JsSshProfile` includes optional `trust_host?: boolean` (default false).
- Helper: `sshConnectWithTrustPrompt(profile)` wraps `sshConnect()` and on `KNOWN_HOSTS_PROMPT` error shows a `confirm()` with details; if accepted, retries with `trust_host: true`.
- Call sites updated to use `sshConnectWithTrustPrompt` in `App.tsx` and `Welcome.tsx`.

## Notes

- Hostnames are normalized to lowercase before checks and persistence.
- The write format is a simple OpenSSH known_hosts line; hashed hostnames are not used yet.
- Future: richer modal with copyable fingerprint, explanation, and per-profile trust storage.

