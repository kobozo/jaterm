# Terminal & Performance

Terminal Engine
- Xterm.js (`@xterm/xterm`) with FitAddon. Styles in `src/app.css`.
- Local PTY and remote SSH panes share terminal hooks.

Performance Tips
- Decoding: we reuse a single `TextDecoder` per pane; avoid duplicate decodes.
- Logging: hot-path logs are gated behind `import.meta.env.DEV`.
- Resize: panes refit on window/tab visibility events; backend only resizes on effective col/row change.

Troubleshooting Input Lag
- Ensure production build is up to date (`pnpm tauri build`).
- If heavy output still stalls input, consider reducing background parsing (event detector) or enabling WebGL renderer (opt-in).
