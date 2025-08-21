# Troubleshooting

Encrypted SSH profile won’t connect
- Unlock the master key. The app will prompt if a profile needs decryption.
- After unlocking, retry the connection. We re-fetch the profile to use decrypted auth.

Dialogs don’t open (file picker)
- Ensure `tauri-plugin-dialog` is installed and enabled in `src-tauri/src/main.rs`.

Terminal lag in production
- Use the latest build. We reuse decoders and gate logs in prod.
- If a pane is flooded with output, consider limiting background parsing or splitting to a new tab.

SSH host trust prompt
- On first connect, we show host key details and ask to trust. If declined, connection is aborted.
