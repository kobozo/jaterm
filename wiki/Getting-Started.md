# Getting Started

Prerequisites
- Node.js 18+, pnpm, Rust (stable), Tauri CLI (`pnpm add -g @tauri-apps/cli`)
- macOS/Linux/Windows supported. For Linux, install libgtk/dev deps per Tauri docs.

Local Dev
- Install deps: `pnpm install`
- Start app (Vite + Tauri): `pnpm dev` or `make dev`
- Frontend only: `pnpm vite`

Build
- Production bundle: `pnpm tauri build` or `make build`
- Clean artifacts: `make clean`

Helper Binary (optional local testing)
- Build helper: `make build-helper`
- Install helper for testing: `make install-helper-dev`

Where things live
- Frontend UI: `src/`
- Backend (Rust): `src-tauri/`
- Helper (Rust): `src-helper/`
