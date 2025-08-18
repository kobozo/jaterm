# Roadmap

- Implement portable-pty integration and session registry.
- Wire SSH tunnels via libssh2 with lifecycle management.
- Implement Git status via git2 + periodic refresh.
- Add FS watch via notify + debounce + build triggers.
- Improve SplitView with resizable panes and tabs.
- Add tests and CI for backend and frontend.

## Near-term Features

- Host Trust Flow (first-connect fingerprint prompt, persist trust)
- SFTP Phase 1 (download, delete, rename, attrs; transfer queue)
- Port Forward Manager (persisted, health checks, auto-restart)
- Dynamic SOCKS (D) forwarding

## Medium-term

- Dual-pane SFTP with drag-drop, bookmarks, recents
- Snippets/macros and command palette
- Workspaces (save/restore tabs, panes, forwards)
- Jump hosts (ProxyJump) chaining UI

## Longer-term

- Session recording and share-view
- Task runner + watchers (local/SSH via helper)
