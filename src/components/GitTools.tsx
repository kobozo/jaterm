import React from 'react';
import { resolvePathAbsolute, sshHomeDir } from '@/types/ipc';
import { gitStatusViaHelper, gitListChanges, gitDiffFile, GitChange } from '@/services/git';

type Props = {
  cwd?: string | null;
  kind?: 'local' | 'ssh';
  sessionId?: string | null;
  helperPath?: string | null;
  title?: string | null;
  onStatus?: (st: { branch: string; ahead: number; behind: number; staged: number; unstaged: number }) => void;
  isActive?: boolean;
};

export default function GitTools({ cwd, kind, sessionId, helperPath, title, onStatus, isActive = true }: Props) {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<any | null>(null);
  const [files, setFiles] = React.useState<GitChange[]>([]);
  const [selected, setSelected] = React.useState<{ path: string; staged: boolean } | null>(null);
  const [diffText, setDiffText] = React.useState<string>('');
  const [commitMsg, setCommitMsg] = React.useState<string>('');
  const [busy, setBusy] = React.useState<boolean>(false);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());

  async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  async function sshHomeDirWithRetry(id: string, tries = 40, delayMs = 15): Promise<string> {
    let lastErr: any = null;
    for (let i = 0; i < tries; i++) {
      try {
        const h = await sshHomeDir(id);
        return h;
      } catch (e: any) {
        lastErr = e;
        const msg = String(e || '');
        if (msg.includes('(-37)') || msg.includes('would block') || msg.toLowerCase().includes('block')) {
          await sleep(delayMs);
          continue;
        }
        break;
      }
    }
    throw lastErr || new Error('sshHomeDir failed');
  }

  function statusEqual(a: any, b: any) {
    if (!a || !b) return false;
    return a.branch === b.branch && a.ahead === b.ahead && a.behind === b.behind && a.staged === b.staged && a.unstaged === b.unstaged;
  }

  function filesEqual(a: GitChange[], b: GitChange[]) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    const sa = [...a].sort((x,y)=> (x.staged===y.staged?0:(x.staged?1:-1)) || x.path.localeCompare(y.path) || x.x.localeCompare(y.x) || x.y.localeCompare(y.y));
    const sb = [...b].sort((x,y)=> (x.staged===y.staged?0:(x.staged?1:-1)) || x.path.localeCompare(y.path) || x.x.localeCompare(y.x) || x.y.localeCompare(y.y));
    for (let i=0;i<sa.length;i++) {
      const x = sa[i], y = sb[i];
      if (x.path!==y.path || x.x!==y.x || x.y!==y.y || x.staged!==y.staged) return false;
    }
    return true;
  }

  async function refresh() {
    // Keep previous UI; only update when data changes
    setErr(null);
    try {
      if (!cwd) throw new Error('No working directory');
      // Only resolve locally for local sessions; SSH paths are remote and should not be resolved locally
      let abs = kind === 'ssh' ? cwd : await resolvePathAbsolute(cwd);
      if (kind === 'ssh') {
        console.info('[git] GitTools title=', title);
        try {
          let home: string | undefined = undefined;
          if (sessionId) {
            try { home = await sshHomeDirWithRetry(sessionId); } catch (e) { /* ignore, will fallback */ }
          }
          // Fallback: derive home from helperPath like "/home/user/.jaterm-helper/jaterm-agent"
          if (!home && helperPath) {
            const idx = helperPath.indexOf('/.jaterm-helper/');
            if (idx > 0) home = helperPath.slice(0, idx);
          }
          const pref = home ? home.replace(/\/$/, '') + '/' : undefined;
          // Prefer extracting from the end of the title after ':'
          let candidate: string | undefined;
          if (title) {
            const afterColon = title.includes(':') ? title.split(':').slice(-1)[0].trim() : title.trim();
            if (afterColon.startsWith('~/')) candidate = afterColon;
            else if (afterColon.startsWith('/')) candidate = afterColon;
            // Fallback regexes
            if (!candidate) {
              const mTilde = title.match(/~\/[A-Za-z0-9_\-\.\/~]+/);
              if (mTilde && mTilde[0]) candidate = mTilde[0];
            }
            if (!candidate) {
              const mAbs = title.match(/\/[A-Za-z0-9_\-\.\/]+/g);
              if (mAbs && mAbs.length) candidate = mAbs[mAbs.length - 1];
            }
          }
          console.info('[git] GitTools candidate=', candidate, 'home=', home);
          if (candidate) {
            if (candidate.startsWith('~/')) {
              if (home) abs = home.replace(/\/$/, '') + candidate.slice(1);
              else abs = candidate; // helper will expand ~ now
            } else {
              abs = candidate;
            }
          }
          // Normalize home-relative like "/foo" when not a known root
          if (home && abs && abs.startsWith('/')) {
            const known = /^(\/home\/|\/usr\/|\/var\/|\/etc\/|\/opt\/|\/bin\/|\/sbin\/|\/lib|\/tmp\/|\/mnt\/|\/media\/|\/root\/)/;
            if (!known.test(abs) && pref && !abs.startsWith(pref)) {
              abs = pref + abs.replace(/^\//, '');
            }
          }
        } catch (e) { console.info('[git] GitTools path resolve error', e); }
      }
      console.info('[git] GitTools refresh cwd=', abs, { kind, sessionId, helperPath });
      const st = await gitStatusViaHelper({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!);
      const prevStatus = status;
      const statusChanged = !prevStatus || !statusEqual(prevStatus, st);
      if (statusChanged) {
        setStatus(st);
        try { onStatus?.(st); } catch {}
      }
      const ch = await gitListChanges({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!);
      const prevFiles = files;
      const filesChanged = !filesEqual(prevFiles, ch);
      if (filesChanged) setFiles(ch);
      // Update diff only when selection still present AND there were changes in status/files
      if (selected && (filesChanged || statusChanged)) {
        const exists = ch.find((c) => c.path === selected.path && c.staged === selected.staged);
        if (exists) {
          const dt = await gitDiffFile({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!, selected.path, selected.staged);
          if (dt !== diffText) setDiffText(dt);
        } else {
          setSelected(null);
          setDiffText('');
        }
      }
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  const helperReady = kind !== 'ssh' || (!!sessionId && !!helperPath);
  const disabled = !helperReady || busy;

  // Auto refresh when inputs change (cwd, session/helper, title)
  React.useEffect(() => {
    if (!cwd || !helperReady || !isActive) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, kind, sessionId, helperPath, title, isActive]);

  // Periodic refresh while mounted
  React.useEffect(() => {
    if (!cwd || !helperReady || !isActive) return;
    // Only poll when inside a repo per current view status
    if (!status || status.branch === '-') return;
    const id = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, kind, sessionId, helperPath, isActive, status?.branch]);

  // Build a simple always-expanded tree for a given staged state
  type TreeNode = { name: string; children?: TreeNode[]; file?: GitChange; fullPath: string };
  function buildTree(group: GitChange[]): TreeNode[] {
    const root: Record<string, any> = {};
    for (const f of group) {
      const parts = f.path.split('/');
      let cur = root;
      let acc = '';
      for (let i = 0; i < parts.length; i++) {
        const seg = parts[i];
        acc = acc ? acc + '/' + seg : seg;
        if (i === parts.length - 1) {
          if (!cur['__files']) cur['__files'] = [] as any[];
          cur['__files'].push({ name: seg, file: f, fullPath: acc });
        } else {
          cur[seg] = cur[seg] || { __dir: {} };
          cur = cur[seg].__dir;
        }
      }
    }
    function toNodes(dir: Record<string, any>, base: string): TreeNode[] {
      const dirs: TreeNode[] = [];
      const files: TreeNode[] = [];
      for (const key of Object.keys(dir)) {
        if (key === '__files') continue;
        const child = dir[key].__dir as Record<string, any>;
        const full = base ? base + '/' + key : key;
        dirs.push({ name: key, fullPath: full, children: toNodes(child, full) });
      }
      if (dir['__files']) {
        for (const f of dir['__files']) {
          files.push({ name: f.name, fullPath: f.fullPath, file: f.file });
        }
      }
      // Sort: dirs first alphabetically, then files
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));
      return [...dirs, ...files];
    }
    return toNodes(root, '');
  }

  function renderTree(nodes: TreeNode[], depth: number, stagedFlag: boolean) {
    return nodes.map((n) => {
      const pad = { padding: '4px 6px', paddingLeft: 6 + depth * 14 } as React.CSSProperties;
      const badge = (code: string) => {
        // Normalize code and color mapping
        let c = code || ' ';
        if (c === '?') c = 'U';
        let bg = '#666';
        if (c === 'M') bg = '#e0b05a'; // modified
        else if (c === 'A') bg = '#6cc86c'; // added
        else if (c === 'D') bg = '#e08a8a'; // deleted
        else if (c === 'R') bg = '#6cb0e0'; // renamed
        else if (c === 'C') bg = '#b08ae0'; // copied
        else if (c === 'U') bg = '#6ac7c7'; // untracked
        return (
          <span style={{
            display: 'inline-block',
            minWidth: 18,
            textAlign: 'center',
            borderRadius: 4,
            padding: '0 4px',
            marginRight: 6,
            fontSize: 12,
            background: bg,
            color: '#111'
          }}>{c.trim() || '\u00A0'}</span>
        );
      };
      if (n.file) {
        const f = n.file as GitChange;
        const isSel = selected?.path === f.path && selected?.staged === stagedFlag;
        const code = stagedFlag ? (f.x || ' ') : (f.y || ' ');
        const isDeleted = (stagedFlag ? f.x : f.y) === 'D';
        return (
          <li key={(stagedFlag ? 'st-' : 'ch-') + n.fullPath} style={{ ...pad, listStyle: 'none', cursor: 'pointer', background: isSel ? '#2b2b2b' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={async (e) => {
            e.stopPropagation();
            setSelected({ path: f.path, staged: stagedFlag });
            const abs = kind === 'ssh' ? (cwd as string) : await resolvePathAbsolute(cwd!);
            const dt = await gitDiffFile({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!, f.path, stagedFlag);
            setDiffText(dt);
          }}>
            {badge(code)}
            <span style={{ flex: 1, textDecoration: isDeleted ? 'line-through' as const : 'none' }}>{n.name}</span>
            <span>
              {stagedFlag ? (
                <button
                  style={{ fontSize: 11, marginLeft: 8 }}
                  title="Unstage"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!cwd) return;
                    setBusy(true);
                    try {
                      const abs = kind === 'ssh' ? (cwd as string) : await resolvePathAbsolute(cwd!);
                      const { gitUnstageFile } = await import('@/services/git');
                      await gitUnstageFile({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!, f.path);
                      await refresh();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Unstage
                </button>
              ) : (
                <button
                  style={{ fontSize: 11, marginLeft: 8 }}
                  title="Stage"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!cwd) return;
                    setBusy(true);
                    try {
                      const abs = kind === 'ssh' ? (cwd as string) : await resolvePathAbsolute(cwd!);
                      const { gitStageFile } = await import('@/services/git');
                      await gitStageFile({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!, f.path);
                      await refresh();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Stage
                </button>
              )}
              {!stagedFlag && (
                <button
                  style={{ fontSize: 11, marginLeft: 8 }}
                  title="Discard changes"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!cwd || !confirm('Discard changes to this file?')) return;
                    setBusy(true);
                    try {
                      const abs = kind === 'ssh' ? (cwd as string) : await resolvePathAbsolute(cwd!);
                      const { gitDiscardFile } = await import('@/services/git');
                      await gitDiscardFile({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!, f.path);
                      await refresh();
                    } finally { setBusy(false); }
                  }}
                >
                  Discard
                </button>
              )}
            </span>
          </li>
        );
      }
      // directory node
      return (
        <li key={(stagedFlag ? 'dir-st-' : 'dir-ch-') + n.fullPath} style={{ ...pad, listStyle: 'none', color: '#bbb', cursor: 'pointer' }} onClick={() => {
          setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(n.fullPath)) next.delete(n.fullPath); else next.add(n.fullPath);
            return next;
          });
        }}>
          <span style={{ marginRight: 6 }}>{collapsed.has(n.fullPath) ? '▸' : '▾'}</span>
          {n.name}
          {!collapsed.has(n.fullPath) && (
            <ul style={{ margin: 0, padding: 0 }}>
              {renderTree(n.children || [], depth + 1, stagedFlag)}
            </ul>
          )}
        </li>
      );
    });
  }

  return (
    <div style={{ height: '100%', display: 'flex', minHeight: 0 }}>
      {/* Left: file tree grouped by Staged / Changes */}
      <div style={{ width: 360, borderRight: '1px solid #333', padding: 8, boxSizing: 'border-box', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Commit box */}
        <div>
          <textarea
            placeholder="Commit message"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            style={{ width: '100%', minHeight: 60, boxSizing: 'border-box', background: '#151515', color: '#eee', border: '1px solid #444', borderRadius: 4, padding: 8 }}
          />
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {!commitMsg && status && (
              <span style={{ opacity: 0.8 }}>Ahead/Behind: {status.ahead} / {status.behind}</span>
            )}
            <button
              disabled={disabled || busy}
              onClick={async () => {
                if (!cwd) return;
                setBusy(true);
                try {
                  const abs = kind === 'ssh' ? cwd : await resolvePathAbsolute(cwd);
                  if (commitMsg.trim()) {
                    const { gitCommit } = await import('@/services/git');
                    const res = await gitCommit({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!, commitMsg.trim());
                    console.info('[git] commit', res.output);
                    setCommitMsg('');
                  } else {
                    const { gitSync } = await import('@/services/git');
                    const res = await gitSync({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!);
                    console.info('[git] sync', res.output);
                  }
                  await refresh();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {commitMsg.trim() ? 'Commit' : 'Sync'}
            </button>
            <span style={{ flex: 1 }} />
            <button
              disabled={disabled || busy}
              title="Stage all"
              onClick={async () => {
                if (!cwd) return;
                setBusy(true);
                try {
                  const abs = kind === 'ssh' ? cwd : await resolvePathAbsolute(cwd);
                  const { gitStageAll } = await import('@/services/git');
                  await gitStageAll({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!);
                  await refresh();
                } finally { setBusy(false); }
              }}
            >Stage All</button>
            <button
              disabled={disabled || busy}
              title="Unstage all"
              onClick={async () => {
                if (!cwd) return;
                setBusy(true);
                try {
                  const abs = kind === 'ssh' ? cwd : await resolvePathAbsolute(cwd);
                  const { gitUnstageAll } = await import('@/services/git');
                  await gitUnstageAll({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!);
                  await refresh();
                } finally { setBusy(false); }
              }}
            >Unstage All</button>
            <button
              disabled={disabled || busy}
              title="Pull --rebase"
              onClick={async () => {
                if (!cwd) return;
                setBusy(true);
                try {
                  const abs = kind === 'ssh' ? cwd : await resolvePathAbsolute(cwd);
                  const { gitPull } = await import('@/services/git');
                  await gitPull({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!);
                  await refresh();
                } finally { setBusy(false); }
              }}
            >Pull</button>
            <button
              disabled={disabled || busy}
              title="Push"
              onClick={async () => {
                if (!cwd) return;
                setBusy(true);
                try {
                  const abs = kind === 'ssh' ? cwd : await resolvePathAbsolute(cwd);
                  const { gitPush } = await import('@/services/git');
                  await gitPush({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!);
                  await refresh();
                } finally { setBusy(false); }
              }}
            >Push</button>
          </div>
        </div>
        <div style={{ fontWeight: 600, margin: '4px 0' }}>Staged</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {renderTree(buildTree(files.filter(f => f.staged)), 0, true)}
        </ul>
        <div style={{ fontWeight: 600, margin: '8px 0 4px' }}>Changes</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {renderTree(buildTree(files.filter(f => !f.staged)), 0, false)}
        </ul>
      </div>
      {/* Right: diff viewer (simple pre styled) */}
      <div style={{ flex: 1, minWidth: 0, padding: 8, boxSizing: 'border-box', overflow: 'auto' }}>
        {selected ? (
          <div>
            <div style={{ marginBottom: 8, opacity: 0.8 }}>{selected.staged ? 'Staged' : 'Working tree'} · {selected.path}</div>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#1e1e1e', color: '#ddd', padding: 12, borderRadius: 6 }}>
              {diffText.split('\n').map((line, idx) => {
                const color = line.startsWith('+') ? '#8fe18f' : line.startsWith('-') ? '#f0a1a1' : line.startsWith('@@') ? '#8fbbe1' : '#ddd';
                return <div key={idx} style={{ color }}>{line}</div>;
              })}
            </pre>
          </div>
        ) : (
          <div style={{ opacity: 0.8 }}>Select a file to view diff.</div>
        )}
      </div>
    </div>
  );
}
