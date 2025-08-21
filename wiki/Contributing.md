# Contributing

Local setup
- `pnpm install` then `pnpm dev` or `make dev`.
- Type-check with `pnpm typecheck`; tests with `make test`.

Style
- 2-space indent, strict TypeScript. PascalCase components, camelCase utils.
- Avoid hot-path console logs in production; gate with `import.meta.env.DEV`.

Commits & PRs
- Conventional Commits (e.g., `feat:`, `fix:`, `perf:`). Example: `perf(terminal): reduce input lag in prod`.
- PRs: include summary, validation steps, platform coverage, and screenshots for UI.

More
- See `AGENTS.md` for repository guidelines and structure.
