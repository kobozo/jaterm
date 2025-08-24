#!/usr/bin/env node

/**
 * Generate release notes using OpenAI based on git commits and diffs.
 * - No external deps; uses Node 18+ fetch.
 * - Defaults to last tag..HEAD if --since-tag provided, or require --from/--to.
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';

function die(msg, code = 1) {
  console.error(`[release-notes] ${msg}`);
  process.exit(code);
}

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function hasGit() {
  try { run('git rev-parse --is-inside-work-tree'); return true; } catch { return false; }
}

function parseArgs(argv) {
  const args = {
    from: undefined,
    to: 'HEAD',
    sinceTag: false,
    includeDiffs: false,
    maxDiffBytes: 120000, // ~120KB
    out: undefined,
    model: 'gpt-5',
    temperature: 0.2,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--since-tag') args.sinceTag = true;
    else if (a === '--include-diffs') args.includeDiffs = true;
    else if (a === '--max-diff-bytes') args.maxDiffBytes = parseInt(argv[++i], 10);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--temp' || a === '--temperature') args.temperature = parseFloat(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else die(`Unknown arg: ${a}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node tools/${basename(process.argv[1])} [--from <ref>] [--to <ref>] [--since-tag] [--include-diffs] [--max-diff-bytes N] [--out FILE] [--model MODEL] [--temperature T] [--dry-run]\n`);
}

function lastTag() {
  try { return run('git describe --tags --abbrev=0'); } catch { return undefined; }
}

function resolveRange(args) {
  let from = args.from;
  const to = args.to || 'HEAD';
  if (!from && args.sinceTag) {
    from = lastTag();
    if (!from) die('No tags found. Provide --from <ref> or create a tag.');
  }
  if (!from) die('Missing range. Provide --since-tag or --from <ref>.');
  return { from, to };
}

function getCommits(from, to) {
  // Use a unique delimiter that won't appear in commit messages
  const delimiter = '<<<COMMIT_DELIMITER>>>';
  // Format: SHA<TAB>Author<TAB>ISODate<TAB>Subject<TAB>Body
  const fmt = `%H%x09%an%x09%aI%x09%s%x09%b${delimiter}`;
  const log = run(`git log --no-merges --pretty=format:'${fmt}' ${from}..${to}`);
  if (!log) return [];
  
  // Split by delimiter and filter out empty entries
  return log.split(delimiter).filter(Boolean).map(entry => {
    const lines = entry.trim().split('\n');
    const firstLine = lines[0];
    const [sha, author, date, subject, ...bodyParts] = firstLine.split('\t');
    
    // Reconstruct body from remaining parts and additional lines
    let body = bodyParts.join('\t');
    if (lines.length > 1) {
      body = body + '\n' + lines.slice(1).join('\n');
    }
    
    return { sha, author, date, subject, body: body.trim() };
  });
}

function getCommitFiles(sha) {
  // name-status: e.g., M\tpath, A\tpath, D\tpath
  // Use -- to separate revision from paths to avoid ambiguity
  const out = run(`git show --pretty=format:'' --name-status "${sha}" --`);
  return out.split('\n').filter(Boolean).map(line => {
    const [status, ...rest] = line.split(/\s+/);
    return { status, path: rest.join(' ') };
  });
}

function getCommitShortstat(sha) {
  // Use -- to separate revision from paths to avoid ambiguity
  const out = run(`git show --shortstat --pretty=format:'' "${sha}" --`);
  // e.g., 3 files changed, 20 insertions(+), 5 deletions(-)
  return out.split('\n').filter(Boolean).pop() || '';
}

function getDiffPatch(sha, budget, used) {
  let patch = '';
  try {
    // Use -- to separate revision from paths to avoid ambiguity
    const full = run(`git show --patch --pretty=format:'' "${sha}" --`);
    const remaining = Math.max(0, budget - used);
    patch = full.slice(0, remaining);
    return { patch, bytes: patch.length, truncated: full.length > remaining };
  } catch { return { patch: '', bytes: 0, truncated: false }; }
}

function summarizeRange({ from, to }, { includeDiffs, maxDiffBytes }) {
  const commits = getCommits(from, to);
  let used = 0;
  const items = commits.map(c => {
    const files = getCommitFiles(c.sha);
    const shortstat = getCommitShortstat(c.sha);
    let patch = undefined; let truncated = false; let bytes = 0;
    if (includeDiffs && maxDiffBytes > 0) {
      const res = getDiffPatch(c.sha, maxDiffBytes, used);
      patch = res.patch; truncated = res.truncated; bytes = res.bytes; used += bytes;
    }
    return { ...c, files, shortstat, patch, patch_truncated: truncated };
  });
  // Also include high-level diffstat for the range
  let rangeStat = '';
  try { rangeStat = run(`git diff --shortstat ${from}..${to}`); } catch {}
  return { from, to, count: items.length, rangeShortstat: rangeStat, commits: items };
}

function buildPrompt(repoMeta, data) {
  const system = `You are an expert release notes writer for a cross-platform desktop app built with Tauri (Rust backend) and React + TypeScript frontend. Produce concise, accurate, audience-friendly release notes in Markdown. Follow these rules:\n\n- Group by sections: Features, Fixes, Performance, Security, UX/UI, Docs, Chore/Infra, Breaking Changes (only if any), and Upgrade Notes (only if needed).\n- Use short, action-oriented bullets; avoid repeating commit messages verbatim.\n- Merge related commits; avoid noisy internal refactors unless impactful.\n- If commit messages use Conventional Commits, leverage them to group items.\n- Mention platform-specific bits (macOS/Windows/Linux) if clear from context.\n- Include a top Summary (1–3 sentences).\n- Include a small "Thanks" section crediting contributors (names only).\n- Do not invent changes not supported by context.`;

  const instructions = `Repository: ${repoMeta.name}\nRange: ${data.from}..${data.to}\nCommits: ${data.count}\nRange diffstat: ${data.rangeShortstat || 'n/a'}\n\nProvide well-structured Markdown suitable for a GitHub Release. Keep it crisp.`;

  // To keep tokens low, provide a compact JSON of commits with selected fields.
  const compactCommits = data.commits.map(c => ({
    sha: c.sha,
    author: c.author,
    date: c.date,
    subject: c.subject,
    body: c.body,
    shortstat: c.shortstat,
    files: c.files.slice(0, 50), // cap list length
    // Only include patch if present; it's already size-capped globally.
    patch: c.patch ? c.patch : undefined,
    patch_truncated: c.patch_truncated || false,
  }));

  const user = {
    role: 'user',
    content: [
      { type: 'text', text: instructions },
      { type: 'text', text: `\nCommits (JSON):\n${JSON.stringify(compactCommits, null, 2)}` },
    ],
  };

  return { system, user };
}

async function callOpenAI({ model, temperature }, { system, user }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) die('OPENAI_API_KEY not set.');

  const payload = {
    model,
    messages: [
      { role: 'system', content: system },
      user,
    ],
    temperature,
    response_format: { type: 'text' },
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '<no body>');
    die(`OpenAI API error ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) die('No content returned from OpenAI.');
  return content;
}

function getRepoMeta() {
  let name = '';
  try { name = run('basename "$(git rev-parse --show-toplevel)"'); } catch {}
  if (!name) name = basename(process.cwd());
  return { name };
}

async function main() {
  if (!hasGit()) die('Not a git repository.');
  const args = parseArgs(process.argv);
  const range = resolveRange(args);
  const summary = summarizeRange(range, { includeDiffs: args.includeDiffs, maxDiffBytes: args.maxDiffBytes });
  const prompt = buildPrompt(getRepoMeta(), summary);

  if (args.dryRun) {
    console.log('# DRY RUN: Showing prompt context that would be sent to OpenAI\n');
    console.log('--- SYSTEM PROMPT ---');
    console.log(prompt.system);
    console.log('\n--- USER CONTENT (truncated view) ---');
    const contentText = prompt.user.content.map(c => c.text || '').join('\n');
    console.log(contentText.slice(0, 5000));
    return;
  }

  const markdown = await callOpenAI(args, prompt);
  if (args.out) {
    writeFileSync(args.out, markdown, 'utf8');
    console.log(`[release-notes] Wrote ${args.out}`);
  } else {
    console.log(markdown);
  }
}

main().catch(err => die(err?.message || String(err)));

