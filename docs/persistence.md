Persistence layout and migration

Overview

- Files live under `~/.jaterm/` (or `~/.<appName>` when a custom name is passed).
- Data is now split across three JSON files:
  - `state.json`: runtime state (recents, sessions, workspace, etc.).
  - `profiles.json`: profiles and the profiles tree.
  - `config.json`: reserved for global settings (currently empty).

Versioned migrations

- The backend maintains a `schemaVersion` in `config.json` (default 0).
- On first access to any persistence command, it runs migrations in order from
  the stored `schemaVersion` to the current schema.
- Migration 1 (0 -> 1): Split legacy `state.json` into separate files:
  - Moves `profiles` and `profilesTree` into `profiles.json`.
  - Keeps runtime keys like `recents`, `recentSessions`, `recentSshSessions`,
    `lastOpenedPath`, and `workspace` in `state.json`.
  - Leaves any unknown keys in `state.json` to avoid data loss.
  - Ensures an empty `config.json` exists.
  - Sets `schemaVersion` to `1` in `config.json`.

Adding future migrations

- Bump `CURRENT_SCHEMA_VERSION` in `src-tauri/src/config.rs`.
- Add a `migration_<n>()` function and register it in the version loop.
- Each migration should be idempotent and safe to run once for its specific step.
- After a successful step, the backend persists the new `schemaVersion` so users
  who skip versions still execute all required steps in order.

Frontend API changes

- New IPC commands:
  - `load_profiles` / `save_profiles`: read/write `profiles.json`.
  - `load_config` / `save_config`: read/write `config.json`.
- The frontend persistence helper in `src/store/persist.ts` now merges reads
  from `state.json` and `profiles.json`, and routes writes to the right file.

Notes

- The old `load_state` / `save_state` continue to work; they target the
  runtime-only `state.json` after migration.
- No files are deleted; the legacy `state.json` is left in place but no longer
  used as a combined store once `profiles.json` exists.
