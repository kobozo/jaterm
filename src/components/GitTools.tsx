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
};

export default function GitTools({ cwd, kind, sessionId, helperPath, title, onStatus }: Props) {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<any | null>(null);
  const [files, setFiles] = React.useState<GitChange[]>([]);
  const [selected, setSelected] = React.useState<{ path: string; staged: boolean } | null>(null);
  const [diffText, setDiffText] = React.useState<string>('');

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

  async function refresh() {
    setLoading(true);
    setErr(null);
    setStatus(null);
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
      setStatus(st);
      try { onStatus?.(st); } catch {}
      const ch = await gitListChanges({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!);
      setFiles(ch);
      // Keep selection if still present
      if (selected) {
        const exists = ch.find((c) => c.path === selected.path && c.staged === selected.staged);
        if (exists) {
          const dt = await gitDiffFile({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!, selected.path, selected.staged);
          setDiffText(dt);
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
  const disabled = loading || !helperReady;

  // Auto refresh when inputs change (cwd, session/helper, title)
  React.useEffect(() => {
    if (!cwd || !helperReady) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, kind, sessionId, helperPath, title]);

  // Periodic refresh while mounted
  React.useEffect(() => {
    if (!cwd || !helperReady) return;
    const id = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, kind, sessionId, helperPath]);

  return (
    <div style={{ height: '100%', display: 'flex', minHeight: 0 }}>
      {/* Left: file tree grouped by Staged / Changes */}
      <div style={{ width: 320, borderRight: '1px solid #333', padding: 8, boxSizing: 'border-box', overflow: 'auto' }}>
        <div style={{ fontWeight: 600, margin: '4px 0' }}>Staged</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {files.filter(f => f.staged).map((f) => (
            <li key={`st-${f.path}`} style={{ padding: '4px 6px', cursor: 'pointer', background: selected?.path===f.path && selected?.staged ? '#2b2b2b' : 'transparent' }} onClick={async () => {
              setSelected({ path: f.path, staged: true });
              const abs = kind === 'ssh' ? (cwd as string) : await resolvePathAbsolute(cwd!);
              const dt = await gitDiffFile({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!, f.path, true);
              setDiffText(dt);
            }}>
              <span style={{ opacity: 0.8, marginRight: 6 }}>{f.x}</span>
              <span>{f.path}</span>
            </li>
          ))}
        </ul>
        <div style={{ fontWeight: 600, margin: '8px 0 4px' }}>Changes</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {files.filter(f => !f.staged).map((f) => (
            <li key={`ch-${f.path}`} style={{ padding: '4px 6px', cursor: 'pointer', background: selected?.path===f.path && !selected?.staged ? '#2b2b2b' : 'transparent' }} onClick={async () => {
              setSelected({ path: f.path, staged: false });
              const abs = kind === 'ssh' ? (cwd as string) : await resolvePathAbsolute(cwd!);
              const dt = await gitDiffFile({ kind: kind === 'ssh' ? 'ssh' : 'local', sessionId: sessionId || undefined, helperPath: helperPath || undefined }, abs!, f.path, false);
              setDiffText(dt);
            }}>
              <span style={{ opacity: 0.8, marginRight: 6 }}>{f.y}</span>
              <span>{f.path}</span>
            </li>
          ))}
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
