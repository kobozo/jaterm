# JaTerm

A modern, secure terminal emulator with SSH support, built with Tauri (Rust backend) and React (xterm.js frontend).

## Features

- 🖥️ **Cross-platform**: Windows, macOS, Linux
- 🔐 **Secure**: Master key encryption for passwords and sensitive data
- 🌐 **SSH Client**: Built-in SSH with port forwarding (local/remote/SOCKS)
- 📁 **SFTP**: File transfer and browsing
- 🔑 **SSH Keys**: Support for SSH keys with passphrase
- 📊 **Git Integration**: Real-time git status in terminal
- 🚀 **Auto-updates**: Cryptographically signed updates
- 🎨 **Modern UI**: Split panes, tabs, and customizable themes

## Quick start

1) Install prerequisites: Rust (stable), Node.js + pnpm, Tauri deps per OS.
2) Install JS deps: `pnpm install`
3) Dev run: `pnpm dev` (runs Vite via Tauri config and launches the app)
4) Build: `pnpm build`

Note: Commands and services are stubs. Fill in Rust services and frontend bindings as needed.

## Structure

See the folder layout in this README’s sibling files. Frontend code lives in `src/` and the
Tauri backend in `src-tauri/`.

## Security

JaTerm prioritizes security for your sensitive data:

- **Encryption**: AES-256-GCM encryption for passwords using a master key
- **Key Derivation**: Argon2 for secure key derivation from your master password
- **Secure Storage**: Integration with system keychains (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- **Hardware Security**: Support for TPM and Secure Enclave when available

For detailed security information, see [SECURITY.md](SECURITY.md).

## License

© 2025 Kobozo. All rights reserved.

