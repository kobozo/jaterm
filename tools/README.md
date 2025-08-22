# Release Notes Generator

Generate Markdown release notes from git history using OpenAI. Designed to work without extra npm deps (uses Node's built-in `fetch`).

## Requirements
- Node 18+
- `OPENAI_API_KEY` set in your environment (CI: repo secret).

## Usage

Basic (from last tag to `HEAD`):

```
pnpm release:notes
```

Specify a range:

```
node tools/generate-release-notes.mjs --from v1.1.0 --to HEAD
```

Use the last annotated tag automatically:

```
node tools/generate-release-notes.mjs --since-tag
```

Write to file:

```
node tools/generate-release-notes.mjs --since-tag --out RELEASE_NOTES.md
```

Include diffs (size-capped):

```
node tools/generate-release-notes.mjs --since-tag --include-diffs --max-diff-bytes 200000
```

Pick model:

```
node tools/generate-release-notes.mjs --since-tag --model gpt-4o-mini
```

Dry-run (no API call; prints the prompt context for inspection):

```
node tools/generate-release-notes.mjs --since-tag --dry-run
```

## Notes
- The script prefers Conventional Commit messages for best grouping.
- Diffs are optional and truncated by a byte budget to stay within token limits.
- Output is Markdown suitable for GitHub/Gitea releases.
- If your repo has many commits, consider providing `--from`/`--to` explicitly to scope the range.

