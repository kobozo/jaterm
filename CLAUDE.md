# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JATerm is a Tauri-based terminal application with SSH tunneling, Git integration, and build automation. It combines a React/TypeScript frontend with a Rust backend.

## Development Commands

```bash
# Development
pnpm dev              # Start Tauri dev server with hot reload
pnpm vite             # Start Vite dev server only

# Build & Quality
pnpm build            # Build production app
pnpm typecheck        # Run TypeScript type checking

# Backend (from src-tauri/)
cargo build           # Build Rust backend
cargo test            # Run Rust tests
```

## Architecture Overview

### Frontend-Backend Communication
- **Commands**: Frontend calls backend via `invoke()` from `@tauri-apps/api/core`
- **Events**: Backend emits events via `emit()`, frontend listens with `listen()`
- **Type Definitions**: Shared types in `src/types/ipc.ts`

### Key Service Layers

**Frontend Services** (`src/services/`):
- `api/tauri.ts` - Wraps Tauri commands with TypeScript types
- `terminal.ts` - Terminal management (PTY sessions)
- `ssh.ts` - SSH connections and port forwarding
- `git.ts` - Git repository operations

**Backend Commands** (`src-tauri/src/commands/`):
- `pty.rs` - PTY creation, read/write, resize
- `ssh.rs` - SSH connections, port forwarding (local/remote/reverse)
- `git.rs` - Git status, stage/unstage, commit operations
- `watcher.rs` - File watching and build automation

### State Management
- Frontend: Zustand stores in `src/store/`
- Backend: Shared state via `AppState` in `src-tauri/src/state/app_state.rs`
- Session persistence via `src/store/persist.ts`

## Working with Terminal/PTY

Terminal sessions use xterm.js frontend with portable-pty backend:

```typescript
// Frontend: src/components/TerminalPane/TerminalPane.tsx
// Uses xterm.js Terminal with custom addons

// Backend: src-tauri/src/services/pty/
// Handles Unix PTY and Windows ConPTY abstraction
```

## SSH Port Forwarding

Recently implemented SSH tunneling system:

```rust
// Backend commands in src-tauri/src/commands/ssh.rs:
// - ssh_open_forward() - Opens local/remote/reverse tunnels
// - ssh_close_forward() - Closes active tunnels
// - State tracked in AppState.forwards HashMap
```

```typescript
// Frontend UI in src/components/PortsPanel.tsx
// Manages tunnel lifecycle and displays active forwards
```

## Git Integration

Git tools provide repository awareness:

```typescript
// Frontend: src/components/GitTools.tsx
// Shows status, staging area, commit interface

// Backend: src-tauri/src/commands/git.rs
// Uses git2 crate for repository operations
```

## Adding New Features

1. **New Tauri Command**:
   - Add handler in `src-tauri/src/commands/`
   - Register in `src-tauri/src/main.rs` builder
   - Add TypeScript types in `src/types/ipc.ts`
   - Create service wrapper in `src/services/api/tauri.ts`

2. **New UI Component**:
   - Add component in `src/components/`
   - Use existing stores from `src/store/`
   - Follow split pane pattern if needed

3. **New Event Type**:
   - Define event in `src-tauri/src/events.rs`
   - Emit from backend command
   - Listen in frontend component with `useEffect` + `listen()`

## Testing Approach

- Frontend: Component testing with React Testing Library
- Backend: Unit tests with `cargo test`
- Integration: Manual testing in dev mode (`pnpm dev`)

## Important Files

- `src/types/ipc.ts` - All TypeScript types for Tauri IPC
- `src-tauri/src/state/app_state.rs` - Shared backend state
- `src/App.tsx` - Main application layout and routing
- `src/components/TerminalPane/TerminalPane.tsx` - Core terminal implementation