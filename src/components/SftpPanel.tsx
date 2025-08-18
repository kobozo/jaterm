import React from 'react';
import { onSshUploadProgress, sshHomeDir, sshSftpList, sshSftpMkdirs, sshSftpWrite, sshSftpRead, type SftpEntry } from '@/types/ipc';

type Props = {
  sessionId: string;
  cwd?: string | null;
  onCwdChange?: (next: string) => void;
  isActive?: boolean;
};

export default function SftpPanel({ sessionId, cwd, onCwdChange, isActive = true }: Props) {
  const [path, setPath] = React.useState<string>('');
  const [entries, setEntries] = React.useState<SftpEntry[]>([]);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [busy, setBusy] = React.useState<boolean>(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{ path: string; written: number; total: number } | null>(null);
  const [showHidden, setShowHidden] = React.useState<boolean>(false);
  const [newDirOpen, setNewDirOpen] = React.useState<boolean>(false);
  const [newDirName, setNewDirName] = React.useState<string>('');

  React.useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        unlisten = await onSshUploadProgress((p) => {
          if (!p || !p.path) return;
          setProgress(p);
        });
      } catch {}
    })();
    return () => { try { unlisten && unlisten(); } catch {} };
  }, []);

  async function load(dir?: string) {
    setLoading(true); setErr(null);
    try {
      let cur = dir || path;
      if (!cur) {
        cur = cwd || (await sshHomeDir(sessionId));
      }
      const list = await sshSftpList(sessionId, cur);
      setPath(cur);
      setEntries(list);
      onCwdChange?.(cur);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { if (isActive) void load(cwd || undefined); }, [sessionId, isActive]);

  function join(a: string, b: string) { return (a.replace(/\/+$/, '') + '/' + b.replace(/^\/+/, '')).replace(/\/+$/, ''); }
  function parentDir(p: string) { const x = p.replace(/\/+$/, '').replace(/\/+[^/]+$/, ''); return x || '/'; }

  async function mkdirSubmit() {
    const name = (newDirName || '').trim();
    if (!name) { setNewDirOpen(false); setNewDirName(''); return; }
    const full = join(path, name);
    setBusy(true);
    try {
      await sshSftpMkdirs(sessionId, full);
      if (name.startsWith('.') && !showHidden) setShowHidden(true);
      await load(path);
    } catch (e) {
      alert('mkdir failed: ' + (e as any));
    } finally {
      setBusy(false);
      setNewDirOpen(false);
      setNewDirName('');
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const buf = await file.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        const dest = join(path, file.name);
        await sshSftpWrite(sessionId, dest, b64);
      }
      await load(path);
    } catch (e) {
      alert('upload failed: ' + (e as any));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function pickDirectory(): Promise<string | null> {
    try {
      const mod = await import('@tauri-apps/plugin-dialog');
      const dir = await mod.open({ directory: true, multiple: false });
      if (typeof dir === 'string') return dir;
      return null;
    } catch {
      return null;
    }
  }

  async function download(entry: SftpEntry) {
    setBusy(true);
    try {
      const base = await pickDirectory();
      if (!base) { setBusy(false); return; }
      if (entry.is_dir) {
        await (await import('@/types/ipc')).sshSftpDownloadDir(sessionId, entry.path, base + '/' + entry.name);
      } else {
        await (await import('@/types/ipc')).sshSftpDownload(sessionId, entry.path, base + '/' + entry.name);
      }
    } catch (e) {
      alert('download failed: ' + (e as any));
    } finally {
      setBusy(false);
    }
  }

  const canNavigateUp = path && path !== '/';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, color: '#bbb', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {path || '—'}
        </div>
        <label title="Show hidden files" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#bbb' }}>
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          Hidden
        </label>
        <button disabled={!canNavigateUp || busy} onClick={() => load(parentDir(path))} title="Up one level">↑</button>
        <button
          disabled={busy}
          onClick={() => { setNewDirOpen(true); setNewDirName(''); }}
          title="New folder"
        >
          ＋
        </button>
        <label style={{ border: '1px solid #444', borderRadius: 4, padding: '4px 8px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          Upload Files
          <input type="file" multiple style={{ display: 'none' }} onChange={(e) => uploadFiles(e.target.files)} />
        </label>
      </div>
      {progress && (
        <div style={{ padding: '6px 10px', fontSize: 12, color: '#bbb', borderBottom: '1px solid #333' }}>
          Uploading {progress.path.split('/').pop()}: {progress.written}/{progress.total}
          <div style={{ height: 4, background: '#333', borderRadius: 2, marginTop: 4 }}>
            <div style={{ width: `${Math.min(100, Math.round((progress.written / Math.max(progress.total, 1)) * 100))}%`, height: 4, background: '#6cc86c', borderRadius: 2 }} />
          </div>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: 10, color: '#aaa' }}>Loading…</div>
        ) : err ? (
          <div style={{ padding: 10, color: '#f88' }}>{err}</div>
        ) : (
          <div>
            <div style={{ padding: '6px 10px', cursor: canNavigateUp ? 'pointer' : 'default', color: canNavigateUp ? '#ddd' : '#666' }} onClick={() => canNavigateUp && load(parentDir(path))}>..</div>
            {entries
              .filter((e) => showHidden || !e.name.startsWith('.'))
              .map((e) => (
              <div key={e.path} style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, cursor: e.is_dir ? 'pointer' : 'default' }} onClick={() => e.is_dir && load(e.path)}>
                  {e.is_dir ? '📁 ' : '📄 '}{e.name}
                </div>
                <button disabled={busy} onClick={() => download(e)} title={e.is_dir ? 'Download Folder' : 'Download File'}>⬇</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {newDirOpen && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 5 }}>
          <div style={{ background: '#1e1e1e', color: '#eee', padding: 16, borderRadius: 8, minWidth: 360, border: '1px solid #444' }}>
            <h3 style={{ margin: 0, marginBottom: 8 }}>Create Folder</h3>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>Parent: {path || '/'}</div>
            <form onSubmit={(e) => { e.preventDefault(); void mkdirSubmit(); }}>
              <input
                autoFocus
                placeholder="Folder name"
                value={newDirName}
                onChange={(e) => setNewDirName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setNewDirOpen(false); setNewDirName(''); } }}
                style={{ width: '100%', padding: 8, background: '#2a2a2a', color: '#eee', border: '1px solid #444', borderRadius: 4, marginBottom: 10 }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => { setNewDirOpen(false); setNewDirName(''); }}>Cancel</button>
                <button type="submit" disabled={busy || !newDirName.trim()}>Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
