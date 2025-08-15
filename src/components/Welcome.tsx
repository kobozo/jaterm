import React, { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { addRecent, getRecents, removeRecent, clearRecents } from '@/store/recents';
import { getRecentSessions, removeRecentSession, clearRecentSessions } from '@/store/sessions';

import type { RecentSession } from '@/store/sessions';

type Props = {
  onOpenFolder: (path: string) => void;
  onOpenSession?: (session: RecentSession) => void;
  onOpenSsh?: (opts: { host: string; port?: number; user: string; auth: { password?: string; keyPath?: string; passphrase?: string; agent?: boolean }; cwd?: string }) => void;
};

export default function Welcome({ onOpenFolder, onOpenSession, onOpenSsh }: Props) {
  const [recents, setRecents] = useState<{ path: string; lastOpenedAt: number }[]>([]);
  const [recentSessions, setRecentSessions] = useState<{ cwd: string; closedAt: number; panes?: number }[]>([]);
  const [sshOpen, setSshOpen] = useState(false);
  const [sshForm, setSshForm] = useState<{ host: string; port?: number; user: string; authType: 'password' | 'key' | 'agent'; password?: string; keyPath?: string; passphrase?: string; cwd?: string }>({ host: '', user: '', authType: 'agent' });
  useEffect(() => {
    (async () => {
      setRecents(await getRecents());
      setRecentSessions(await getRecentSessions());
    })();
  }, []);

  const handleHome = async () => {
    try {
      const dir = await homeDir();
      if (dir) {
        addRecent(dir);
        onOpenFolder(dir);
      }
    } catch (e) {
      console.error('homeDir failed', e);
      alert('Could not detect home folder');
    }
  };

  const handlePick = async () => {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === 'string') {
        addRecent(dir);
        onOpenFolder(dir);
      }
    } catch (e) {
      console.error('open folder failed', e);
      alert('Open Folder dialog is unavailable. Is the Tauri dialog plugin installed?');
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h1>Start New Session</h1>
      <p>Start a local terminal in your home or a specific folder.</p>
      <div style={{ margin: '16px 0', display: 'flex', gap: 12 }}>
        <button onClick={handleHome}>Start in Home Folder</button>
        <button onClick={handlePick}>Start in Specific Folder…</button>
        <button onClick={() => setSshOpen(true)}>Open SSH Session…</button>
      </div>
      {sshOpen && (
        <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)' }}>
          <div style={{ background: '#1e1e1e', color: '#eee', padding: 16, borderRadius: 8, minWidth: 420 }}>
            <h3 style={{ marginTop: 0 }}>Open SSH Session</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              <label>
                Host
                <input style={{ width: '100%' }} value={sshForm.host} onChange={(e) => setSshForm((s) => ({ ...s, host: e.target.value }))} placeholder="example.com" />
              </label>
              <label>
                Port
                <input style={{ width: '100%' }} type="number" value={sshForm.port ?? 22} onChange={(e) => setSshForm((s) => ({ ...s, port: Number(e.target.value) || 22 }))} />
              </label>
              <label>
                User
                <input style={{ width: '100%' }} value={sshForm.user} onChange={(e) => setSshForm((s) => ({ ...s, user: e.target.value }))} placeholder="root" />
              </label>
              <div>
                <label style={{ marginRight: 8 }}><input type="radio" checked={sshForm.authType === 'agent'} onChange={() => setSshForm((s) => ({ ...s, authType: 'agent' }))} /> SSH Agent</label>
                <label style={{ marginRight: 8 }}><input type="radio" checked={sshForm.authType === 'password'} onChange={() => setSshForm((s) => ({ ...s, authType: 'password' }))} /> Password</label>
                <label><input type="radio" checked={sshForm.authType === 'key'} onChange={() => setSshForm((s) => ({ ...s, authType: 'key' }))} /> Key File</label>
              </div>
              {sshForm.authType === 'password' && (
                <label>
                  Password
                  <input style={{ width: '100%' }} type="password" value={sshForm.password ?? ''} onChange={(e) => setSshForm((s) => ({ ...s, password: e.target.value }))} />
                </label>
              )}
              {sshForm.authType === 'key' && (
                <>
                  <label>
                    Key Path
                    <input style={{ width: '100%' }} value={sshForm.keyPath ?? ''} onChange={(e) => setSshForm((s) => ({ ...s, keyPath: e.target.value }))} placeholder="~/.ssh/id_ed25519" />
                  </label>
                  <label>
                    Passphrase (optional)
                    <input style={{ width: '100%' }} type="password" value={sshForm.passphrase ?? ''} onChange={(e) => setSshForm((s) => ({ ...s, passphrase: e.target.value }))} />
                  </label>
                </>
              )}
              <label>
                Start in path (optional)
                <input style={{ width: '100%' }} value={sshForm.cwd ?? ''} onChange={(e) => setSshForm((s) => ({ ...s, cwd: e.target.value }))} placeholder="/home/user" />
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setSshOpen(false)}>Cancel</button>
                <button
                  onClick={() => {
                    if (!sshForm.host || !sshForm.user) { alert('Host and user are required'); return; }
                    const auth = sshForm.authType === 'agent'
                      ? { agent: true }
                      : sshForm.authType === 'password'
                      ? { password: sshForm.password }
                      : { keyPath: sshForm.keyPath, passphrase: sshForm.passphrase };
                    onOpenSsh?.({ host: sshForm.host, port: sshForm.port ?? 22, user: sshForm.user, auth: auth as any, cwd: sshForm.cwd });
                    setSshOpen(false);
                  }}
                >
                  Connect
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {recents.length > 0 && (
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Recent folders</span>
            <button onClick={async () => { await clearRecents(); setRecents(await getRecents()); }} title="Clear recent folders">Clear</button>
          </h3>
          <ul>
            {recents.map((r) => (
              <li key={r.path} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <a href="#" onClick={async (e) => { e.preventDefault(); await addRecent(r.path); onOpenFolder(r.path); }}>
                  {r.path}
                </a>
                <button onClick={async () => { await removeRecent(r.path); setRecents(await getRecents()); }} title="Remove">×</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {recentSessions.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Recent sessions</span>
            <button onClick={async () => { await clearRecentSessions(); setRecentSessions(await getRecentSessions()); }} title="Clear recent sessions">Clear</button>
          </h3>
          <ul>
            {recentSessions.map((s) => (
              <li key={`${s.cwd}-${s.closedAt}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <a href="#" onClick={(e) => { e.preventDefault(); (onOpenSession ? onOpenSession(s) : onOpenFolder(s.cwd)); }} title={new Date(s.closedAt).toLocaleString()}>
                  {s.cwd} {typeof s.panes === 'number' ? `(panes: ${s.panes})` : ''}
                </a>
                <button onClick={async () => { await removeRecentSession(s.cwd); setRecentSessions(await getRecentSessions()); }} title="Remove">×</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
