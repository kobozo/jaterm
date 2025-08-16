import { onSshUploadProgress, sshExec, sshHomeDir, sshSftpMkdirs, sshSftpWrite, helperLocalEnsure } from '@/types/ipc';

export const HELPER_VERSION = '0.1.2';
export const HELPER_NAME = 'jaterm-agent';
export const HELPER_REL_DIR = '.jaterm-helper';

// POSIX shell helper with health command
export const HELPER_CONTENT = `#!/bin/sh

case "$1" in
  health)
    echo '{"ok":true,"version":"${HELPER_VERSION}"}'
    exit 0
    ;;
  git-status)
    # Usage: jaterm-agent git-status [path]
    DIR="$2"
    # Expand leading ~ to $HOME even when quoted
    case "$DIR" in
      ~*) DIR="$HOME${'${DIR#~}'}";;
    esac
    if [ -z "$DIR" ]; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      echo '{"branch":"-","ahead":0,"behind":0,"staged":0,"unstaged":0}'
      exit 0
    fi
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo DETACHED)
    AHEAD=0; BEHIND=0
    if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
      # behind ahead order from --left-right --count
      set -- $(git rev-list --left-right --count @{upstream}...HEAD 2>/dev/null || echo "0 0")
      BEHIND=$1; AHEAD=$2
    fi
    STAGED=0; UNSTAGED=0
    git status --porcelain 2>/dev/null | while IFS= read -r L; do
      XY=$(printf "%s" "$L" | cut -c1-2)
      if [ "$XY" = "??" ]; then UNSTAGED=$((UNSTAGED+1)); continue; fi
      X=$(printf "%s" "$XY" | cut -c1)
      Y=$(printf "%s" "$XY" | cut -c2)
      if [ "$X" != " " ]; then STAGED=$((STAGED+1)); fi
      if [ "$Y" != " " ]; then UNSTAGED=$((UNSTAGED+1)); fi
    done
    # Busybox sh vs bash subshell var scope: recompute counts via awk to be safe
    read STAGED UNSTAGED <<EOF
$(git status --porcelain 2>/dev/null | awk 'BEGIN{s=0;u=0} {xy=substr($0,1,2); if (xy=="??") u++; else {x=substr(xy,1,1); y=substr(xy,2,1); if (x!=" ") s++; if (y!=" ") u++;}} END{print s, u}')
EOF
    printf '{"branch":"%s","ahead":%s,"behind":%s,"staged":%s,"unstaged":%s}\n' "$BRANCH" "$AHEAD" "$BEHIND" "$STAGED" "$UNSTAGED"
    ;;
  git-changes)
    DIR="$2"
    case "$DIR" in
      ~*) DIR="$HOME${'${DIR#~}'}";;
    esac
    if [ -z "$DIR" ]; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      echo '[]'
      exit 0
    fi
    # Use porcelain for staged/unstaged
    git status --porcelain 2>/dev/null | awk '
      {
        xy=substr($0,1,2);
        x=substr(xy,1,1); y=substr(xy,2,1);
        p=substr($0,4);
        # handle rename format "R old -> new"
        arrow=index(p, " -> ");
        if (arrow>0) { p=substr(p, arrow+4); }
        staged=(x!=" ")?"true":"false";
        # escape JSON
        gsub(/\\\\/, "\\\\\\\\", p); gsub(/\"/, "\\\"", p);
        if (NR>1) printf ",";
        printf "{\"path\":\"%s\",\"x\":\"%s\",\"y\":\"%s\",\"staged\":%s}", p, x, y, staged;
      }
    END { }' | awk 'BEGIN{printf "["}{print}END{printf "]"}'
    ;;
  git-diff)
    DIR="$2"; FILE="$3"; MODE="$4"
    case "$DIR" in
      ~*) DIR="$HOME${'${DIR#~}'}";;
    esac
    cd "$DIR" 2>/dev/null || cd .
    if [ "$MODE" = "staged" ]; then git diff --cached -- "$FILE" 2>/dev/null; else git diff -- "$FILE" 2>/dev/null; fi
    ;;
  git-commit)
    DIR="$2"; shift 2; MSG="$*"
    case "$DIR" in
      ~*) DIR="$HOME${'${DIR#~}'}";;
    esac
    if [ -z "$DIR" ]; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    git commit -m "$MSG" 2>&1
    ;;
  git-sync)
    DIR="$2"
    case "$DIR" in
      ~*) DIR="$HOME${'${DIR#~}'}";;
    esac
    if [ -z "$DIR" ]; then DIR="."; fi
    cd "$DIR" 2>/dev/null || cd .
    git pull --rebase 2>&1 && git push 2>&1
    ;;
  *)
    echo "jaterm-agent: unknown command: $1" 1>&2
    exit 1
    ;;
esac
`;

export type HelperStatus = { ok: boolean; version?: string; path?: string };

export async function ensureHelper(
  sessionId: string,
  opts: { show: (t: any) => string; update: (id: string, patch: any) => void; dismiss: (id: string) => void }
): Promise<HelperStatus> {
  const { show, update, dismiss } = opts;
  try {
    console.info('[helper] ensureHelper: start', { sessionId });
    const home = await sshHomeDir(sessionId);
    console.info('[helper] home', home);
    const helperDir = home.replace(/\/+$/, '') + '/' + HELPER_REL_DIR;
    const helperPath = helperDir + '/' + HELPER_NAME;

    // Check existing helper
    try {
      const res = await sshExec(sessionId, `'${helperPath.replace(/'/g, "'\\''")}' health`);
      console.info('[helper] health check (existing)', { exit: res.exit_code, stdout: res.stdout, stderr: res.stderr });
      if (res.exit_code === 0) {
        try {
          const j = JSON.parse(res.stdout);
          if (j && j.ok && j.version === HELPER_VERSION) {
            console.info('[helper] up to date', j.version);
            return { ok: true, version: j.version, path: helperPath };
          }
        } catch {}
      }
    } catch {}

    // Need to (re)install
    console.info('[helper] mkdirs', helperDir);
    await sshSftpMkdirs(sessionId, helperDir);
    const b64 = btoa(HELPER_CONTENT);
    const toastId = show({ title: 'Installing helper', message: helperPath, progress: { current: 0, total: HELPER_CONTENT.length }, kind: 'info' });
    const unlisten = await onSshUploadProgress((p) => {
      if (p.path === helperPath) update(toastId, { progress: { current: p.written, total: p.total } });
    });
    try {
      console.info('[helper] upload start', helperPath);
      await sshSftpWrite(sessionId, helperPath, b64);
      console.info('[helper] chmod +x', helperPath);
      const ch = await sshExec(sessionId, `chmod +x '${helperPath.replace(/'/g, "'\\''")}'`);
      console.info('[helper] chmod result', { exit: ch.exit_code, stdout: ch.stdout, stderr: ch.stderr });
      const res = await sshExec(sessionId, `'${helperPath.replace(/'/g, "'\\''")}' health`);
      console.info('[helper] health after install', { exit: res.exit_code, stdout: res.stdout, stderr: res.stderr });
      if (res.exit_code !== 0) throw new Error(res.stderr || 'health failed');
      update(toastId, { title: 'Helper ready', kind: 'success' });
      setTimeout(() => dismiss(toastId), 1500);
      try {
        const j = JSON.parse(res.stdout);
        return { ok: !!j?.ok, version: j?.version, path: helperPath };
      } catch {
        return { ok: true, version: HELPER_VERSION, path: helperPath };
      }
    } finally {
      unlisten();
    }
  } catch (e) {
    console.error('[helper] ensure error', e);
    // Try to close any existing install toast if present by updating/dismissing
    try {
      // We don't hold the id here reliably; rely on a new error toast and let any stale progress toast be dismissed by timeout
      const id = opts.show({ title: 'Helper install failed', message: String(e), kind: 'error' });
      setTimeout(() => opts.dismiss(id), 3000);
    } catch {}
    return { ok: false };
  }
}

// Ensure local helper for local sessions; mirrors SSH ensure but simpler
export async function ensureLocalHelper(): Promise<HelperStatus> {
  try {
    const res = await helperLocalEnsure();
    return { ok: !!res?.ok, version: res?.version, path: res?.path };
  } catch (e) {
    console.error('[helper] local ensure error', e);
    return { ok: false };
  }
}
