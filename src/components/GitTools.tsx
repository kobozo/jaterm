import React from 'react';
import { resolvePathAbsolute, sshHomeDir } from '@/types/ipc';
import { gitStatusViaHelper } from '@/services/git';

type Props = {
  cwd?: string | null;
  kind?: 'local' | 'ssh';
  sessionId?: string | null;
  helperPath?: string | null;
  title?: string | null;
};

export default function GitTools({ cwd, kind, sessionId, helperPath, title }: Props) {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<any | null>(null);

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
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  const helperReady = kind !== 'ssh' || (!!sessionId && !!helperPath);
  const disabled = loading || !helperReady;

  return (
    <div style={{ padding: 16, height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Git Tools</h3>
        <button onClick={refresh} disabled={disabled} title={!helperReady ? 'SSH helper not ready yet' : 'Refresh Git status'}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {!cwd && <p style={{ opacity: 0.8 }}>No working directory.</p>}
      {kind === 'ssh' && !helperReady && (
        <p style={{ opacity: 0.8 }}>SSH helper not ready yet. It installs automatically after connect.</p>
      )}
      {err && (
        <div style={{ marginTop: 12, color: '#f0a1a1' }}>Error: {err}</div>
      )}
      {status && (
        <div style={{ marginTop: 12, lineHeight: 1.6 }}>
          <div><strong>Branch:</strong> {status.branch}</div>
          <div><strong>Ahead/Behind:</strong> {status.ahead} / {status.behind}</div>
          <div><strong>Staged:</strong> {status.staged}</div>
          <div><strong>Unstaged:</strong> {status.unstaged}</div>
        </div>
      )}
      {!status && !err && !disabled && (
        <p style={{ marginTop: 12, opacity: 0.8 }}>Click Refresh to fetch Git status.</p>
      )}
    </div>
  );
}
