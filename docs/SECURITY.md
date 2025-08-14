# Security Notes

- Keep privileged work (PTY/SSH/Git) in Rust commands.
- Minimize Tauri allowlist; prefer explicit command surfaces.
- Validate inputs, sanitize paths and command args.
- Consider sandboxing shells (login vs non-login) and environment.
- Follow Tauri security checklist and platform-specific hardening.

