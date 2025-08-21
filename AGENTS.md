# Repository Guidelines

## Project Structure & Module Organization
- Frontend (React + TypeScript): `src/`
  - UI: `src/components/` (e.g., `TerminalPane/TerminalPane.tsx`)
  - State/Store: `src/store/`
  - Services: `src/services/` (IPC, SSH, terminal events)
  - Types & IPC wrappers: `src/types/`
  - Static assets: `src/assets/`, styles: `src/app.css`
- Backend (Tauri + Rust): `src-tauri/`
  - Commands: `src-tauri/src/commands/` (e.g., `pty.rs`, `ssh.rs`)
  - App setup/menu/state: `src-tauri/src/`
- Helper binary (Rust): `src-helper/`
- Docs: `README.md`, `ARCHITECTURE.md`, updater guides
- Tests (seed): `tests/`

## Build, Test, and Development Commands
- Run dev (Tauri + Vite): `pnpm dev` or `make dev`
- Frontend only: `pnpm vite`
- Type check: `pnpm typecheck`
- Build production app: `pnpm tauri build` or `make build`
- Backend tests: `make test` (runs `cargo test` in `src-tauri` and `src-helper`)
- Clean: `make clean`

## Coding Style & Naming Conventions
- TypeScript strict mode; prefer explicit types for public APIs.
- Indentation: 2 spaces; keep imports grouped and sorted.
- React components: PascalCase filenames; hooks as `useX.ts`.
- Services/utilities: camelCase filenames; avoid one-letter vars.
- Avoid console logs in hot paths; gate behind `import.meta.env.DEV`.

## Testing Guidelines
- Rust: add unit/integration tests under each crate; run with `cargo test`.
- Frontend: placeholder tests exist under `tests/frontend/`; add Vitest when expanding.
- Name tests after subject (e.g., `terminal.spec.ts`), focus on observable behavior.

## Commit & Pull Request Guidelines
- Use Conventional Commits: `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `test:`, `build:`, `chore:`. Example: `perf(terminal): reduce input lag in prod`.
- Keep commits focused and scoped; reference issues like `#123`.
- PRs: include summary, screenshots/GIFs for UI changes, steps to validate, and platforms tested (macOS/Windows/Linux). Note any risk or migration.

## Security & Configuration Tips
- Never commit secrets. Updater signing keys: see `UPDATER_SETUP.md` and `GENERATE_UPDATER_KEYS.md`.
- Tauri permissions are declared in `src-tauri/capabilities/`; add only what you need.
