#!/usr/bin/env bash
set -euo pipefail

# Publish the local wiki/ folder to the GitHub Wiki repo (<repo>.wiki.git)
# Usage: scripts/publish-wiki.sh
# Optional env:
#   REMOTE (default: origin) – which remote to read URL from
#   WIKI_URL – override full wiki repo URL (auth included), e.g.
#     https://x-access-token:${GITHUB_TOKEN}@github.com/OWNER/REPO.wiki.git

REMOTE="${REMOTE:-origin}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required" >&2
  exit 1
fi

if [ ! -d wiki ]; then
  echo "wiki/ folder not found at repo root" >&2
  exit 1
fi

if [ -n "${WIKI_URL:-}" ]; then
  wiki_url="$WIKI_URL"
else
  repo_url=$(git remote get-url "$REMOTE")
  if [ -z "$repo_url" ]; then
    echo "Could not determine remote URL for $REMOTE" >&2
    exit 1
  fi
  # Derive wiki URL for https and ssh forms
  if [[ "$repo_url" == git@*:* ]]; then
    base="${repo_url%.git}"
    wiki_url="${base}.wiki.git"
  else
    base="${repo_url%.git}"
    wiki_url="${base}.wiki.git"
  fi
fi

tmp_dir=$(mktemp -d 2>/dev/null || mktemp -d -t 'wiki')
trap 'rm -rf "$tmp_dir"' EXIT

echo "Cloning wiki repo: $wiki_url"
git clone "$wiki_url" "$tmp_dir"

cd "$tmp_dir"
git config user.name "${GIT_AUTHOR_NAME:-github-actions}"
git config user.email "${GIT_AUTHOR_EMAIL:-github-actions@users.noreply.github.com}"
rm -f ./*.md
cp -v ../wiki/*.md .

git add -A
if git diff --cached --quiet; then
  echo "No changes to publish."
  exit 0
fi

msg="docs(wiki): publish $(date -u +"%Y-%m-%d %H:%M:%SZ")"
git commit -m "$msg"
git push

echo "Wiki published. Open: ${wiki_url%.git}"
