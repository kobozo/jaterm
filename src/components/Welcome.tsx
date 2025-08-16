import React, { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { addRecent, getRecents, removeRecent, clearRecents } from '@/store/recents';
import { getRecentSessions, removeRecentSession, clearRecentSessions, getRecentSshSessions, removeRecentSshSession, clearRecentSshSessions } from '@/store/sessions';
import { getLocalProfiles, getSshProfiles, saveLocalProfile, saveSshProfile, deleteLocalProfile, deleteSshProfile, type LocalProfile, type SshProfileStored } from '@/store/persist';
import { sshConnect, sshDisconnect, sshHomeDir, sshSftpList, onSshUploadProgress, sshSftpMkdirs, sshSftpWrite, sshExec } from '@/types/ipc';
import { ensureHelper } from '@/services/helper';
import { useToasts } from '@/store/toasts';

import type { RecentSession } from '@/store/sessions';

type Props = {
  onOpenFolder: (path: string) => void;
  onOpenSession?: (session: RecentSession) => void;
  onOpenSsh?: (opts: { host: string; port?: number; user: string; auth: { password?: string; keyPath?: string; passphrase?: string; agent?: boolean }; cwd?: string; profileId?: string }) => void;
};

export default function Welcome({ onOpenFolder, onOpenSession, onOpenSsh }: Props) {
  const { show, update, dismiss } = useToasts();
  const [recents, setRecents] = useState<{ path: string; lastOpenedAt: number }[]>([]);
  const [recentSessions, setRecentSessions] = useState<{ cwd: string; closedAt: number; panes?: number }[]>([]);
  const [recentSsh, setRecentSsh] = useState<{ profileId: string; path: string; closedAt: number }[]>([]);
  const [sshOpen, setSshOpen] = useState(false);
  const [sshForm, setSshForm] = useState<{ host: string; port?: number; user: string; authType: 'password' | 'key' | 'agent'; password?: string; keyPath?: string; passphrase?: string; cwd?: string }>({ host: '', user: '', authType: 'agent' });
  const [localProfiles, setLocalProfiles] = useState<LocalProfile[]>([]);
  const [sshProfiles, setSshProfiles] = useState<SshProfileStored[]>([]);
  const [lpOpen, setLpOpen] = useState(false);
  const [lpForm, setLpForm] = useState<{ id?: string; name: string; path: string }>({ name: '', path: '' });
  const [spOpen, setSpOpen] = useState(false);
  const [spForm, setSpForm] = useState<{ id?: string; name: string; host: string; port?: number; user: string; authType: 'agent'|'password'|'key'; password?: string; keyPath?: string; passphrase?: string; path?: string }>({ name: '', host: '', user: '', authType: 'agent' });
  const [browse, setBrowse] = useState<{ sessionId: string; cwd: string; entries: { name: string; path: string; is_dir: boolean }[] } | null>(null);
  useEffect(() => {
    (async () => {
      setRecents(await getRecents());
      setRecentSessions(await getRecentSessions());
      setRecentSsh(await getRecentSshSessions());
      setLocalProfiles(await getLocalProfiles());
      setSshProfiles(await getSshProfiles());
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
                <a href="#" onClick={(e) => { e.preventDefault(); (onOpenSession ? onOpenSession(s) : onOpenFolder(s.cwd)); }} title={s.cwd + ' — ' + new Date(s.closedAt).toLocaleString()}>
                  {s.cwd} {typeof s.panes === 'number' ? `(panes: ${s.panes})` : ''}
                </a>
                <button onClick={async () => { await removeRecentSession(s.cwd); setRecentSessions(await getRecentSessions()); }} title="Remove">×</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recentSsh.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Recent SSH sessions</span>
            <button onClick={async () => { await clearRecentSshSessions(); setRecentSsh(await getRecentSshSessions()); }} title="Clear recent SSH sessions">Clear</button>
          </h3>
          <ul>
            {recentSsh.map((s) => (
              <li key={`${s.profileId}-${s.path}-${s.closedAt}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <a href="#" title={s.path + ' — ' + new Date(s.closedAt).toLocaleString()} onClick={(e) => { e.preventDefault();
                  // Look up profile
                  (async () => {
                    const all = await getSshProfiles();
                    const p = s.profileId ? all.find((x) => x.id === s.profileId) : undefined;
                    if (p) {
                      onOpenSsh?.({ host: p.host, port: p.port, user: p.user, auth: p.auth || { agent: true }, cwd: s.path, profileId: p.id });
                    } else if (s.host && s.user) {
                      onOpenSsh?.({ host: s.host, port: s.port ?? 22, user: s.user, auth: { agent: true } as any, cwd: s.path });
                    } else {
                      alert('Cannot open SSH recent: profile missing and no host/user stored');
                    }
                  })();
                }}>
                  {s.path}
                </a>
                <button onClick={async () => { await removeRecentSshSession((s.profileId || ''), s.path); setRecentSsh(await getRecentSshSessions()); }} title="Remove">×</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <h2>Profiles</h2>
        <div style={{ display: 'flex', gap: 24 }}>
          <div style={{ flex: 1 }}>
            <h3>Local</h3>
            <button onClick={() => { setLpForm({ id: crypto.randomUUID(), name: '', path: '' }); setLpOpen(true); }}>New Local Profile</button>
            <ul>
              {localProfiles.map((p) => (
                <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <a href="#" onClick={(e) => { e.preventDefault(); onOpenFolder(p.path); }}>{p.name || p.path}</a>
                  <button onClick={async () => { await deleteLocalProfile(p.id); setLocalProfiles(await getLocalProfiles()); }} title="Remove">×</button>
                </li>
              ))}
            </ul>
          </div>
          <div style={{ flex: 1 }}>
            <h3>SSH</h3>
            <button onClick={() => { setSpForm({ id: crypto.randomUUID(), name: '', host: '', user: '', authType: 'agent' }); setSpOpen(true); }}>New SSH Profile</button>
            <ul>
              {sshProfiles.map((p) => (
                <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span title={(p.name || `${p.user}@${p.host}`) + (p.path ? `: ${p.path}` : '')}>{p.name || `${p.user}@${p.host}`}{p.path ? `: ${p.path}` : ''}</span>
                  <button onClick={async () => {
                    if (!onOpenSsh) return;
                    onOpenSsh({ host: p.host, port: p.port, user: p.user, auth: p.auth || { agent: true }, cwd: p.path, profileId: p.id });
                  }}>Open</button>
                  <button onClick={async () => { await deleteSshProfile(p.id); setSshProfiles(await getSshProfiles()); }} title="Remove">×</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {lpOpen && (
        <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)' }}>
          <div style={{ background: '#1e1e1e', color: '#eee', padding: 16, borderRadius: 8, minWidth: 420 }}>
            <h3 style={{ marginTop: 0 }}>Local Profile</h3>
            <label>Name<input style={{ width: '100%' }} value={lpForm.name} onChange={(e) => setLpForm({ ...lpForm, name: e.target.value })} /></label>
            <label>Path<input style={{ width: '100%' }} value={lpForm.path} onChange={(e) => setLpForm({ ...lpForm, path: e.target.value })} placeholder="/absolute/path" /></label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={() => setLpOpen(false)}>Cancel</button>
              <button onClick={async () => { if (!lpForm.id) lpForm.id = crypto.randomUUID(); await saveLocalProfile(lpForm as any); setLocalProfiles(await getLocalProfiles()); setLpOpen(false); }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {spOpen && (
        <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)' }}>
          <div style={{ background: '#1e1e1e', color: '#eee', padding: 16, borderRadius: 8, minWidth: 520 }}>
            <h3 style={{ marginTop: 0 }}>SSH Profile</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              <label>Name<input style={{ width: '100%' }} value={spForm.name} onChange={(e) => setSpForm({ ...spForm, name: e.target.value })} /></label>
              <label>Host<input style={{ width: '100%' }} value={spForm.host} onChange={(e) => setSpForm({ ...spForm, host: e.target.value })} placeholder="example.com" /></label>
              <label>Port<input style={{ width: '100%' }} type="number" value={spForm.port ?? 22} onChange={(e) => setSpForm({ ...spForm, port: Number(e.target.value) || 22 })} /></label>
              <label>User<input style={{ width: '100%' }} value={spForm.user} onChange={(e) => setSpForm({ ...spForm, user: e.target.value })} placeholder="root" /></label>
              <div>
                <label style={{ marginRight: 8 }}><input type="radio" checked={spForm.authType === 'agent'} onChange={() => setSpForm({ ...spForm, authType: 'agent' })} /> SSH Agent</label>
                <label style={{ marginRight: 8 }}><input type="radio" checked={spForm.authType === 'password'} onChange={() => setSpForm({ ...spForm, authType: 'password' })} /> Password</label>
                <label><input type="radio" checked={spForm.authType === 'key'} onChange={() => setSpForm({ ...spForm, authType: 'key' })} /> Key File</label>
              </div>
              {spForm.authType === 'password' && (<label>Password<input style={{ width: '100%' }} type="password" value={spForm.password ?? ''} onChange={(e) => setSpForm({ ...spForm, password: e.target.value })} /></label>)}
              {spForm.authType === 'key' && (<><label>Key Path<input style={{ width: '100%' }} value={spForm.keyPath ?? ''} onChange={(e) => setSpForm({ ...spForm, keyPath: e.target.value })} placeholder="~/.ssh/id_ed25519" /></label><label>Passphrase<input style={{ width: '100%' }} type="password" value={spForm.passphrase ?? ''} onChange={(e) => setSpForm({ ...spForm, passphrase: e.target.value })} /></label></>)}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ flex: 1 }}>Remote Path<input style={{ width: '100%' }} value={spForm.path ?? ''} onChange={(e) => setSpForm({ ...spForm, path: e.target.value })} placeholder="/home/user" /></label>
                <button onClick={async () => {
                  try {
                    const sessionId = await sshConnect({ host: spForm.host, port: spForm.port ?? 22, user: spForm.user, auth: { password: spForm.password, key_path: spForm.keyPath, passphrase: spForm.passphrase, agent: spForm.authType === 'agent' } as any, timeout_ms: 15000 });
                    const home = await sshHomeDir(sessionId);
                    const start = spForm.path || home;
                    const entries = await sshSftpList(sessionId, start);
                    setBrowse({ sessionId, cwd: start, entries });
                  } catch (e) { alert('SSH browse failed: ' + (e as any)); }
                }}>Browse…</button>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={async () => {
                  // Background install of helper with progress toast
                  try {
                    const sessionId = await sshConnect({ host: spForm.host, port: spForm.port ?? 22, user: spForm.user, auth: { password: spForm.password, key_path: spForm.keyPath, passphrase: spForm.passphrase, agent: spForm.authType === 'agent' } as any, timeout_ms: 15000 });
                    const home = await sshHomeDir(sessionId);
                    const helperDir = home.replace(/\/+$/, '') + '/.jaterm-helper';
                    const helperPath = helperDir + '/jaterm-agent';
                    await sshSftpMkdirs(sessionId, helperDir);
                    // Minimal placeholder helper script
                    const content = '#!/bin/sh\n\ncase "$1" in\n  health)\n    echo "{\\"ok\\":true,\\"version\\":\\"0.1.0\\"}"\n    exit 0\n    ;;\n  *)\n    echo "jaterm-agent: unknown command: $1" 1>&2\n    exit 1\n    ;;\nesac\n';
                    await ensureHelper(sessionId, { show, update, dismiss });
                    try { await sshDisconnect(sessionId); } catch {}
                  } catch (e) {
                    const tid = show({ title: 'Install helper failed', message: String(e), kind: 'error' });
                    setTimeout(() => dismiss(tid), 2500);
                  }
                }}>Install Helper</button>
                <button onClick={() => setSpOpen(false)}>Cancel</button>
                <button onClick={async () => {
                  if (!spForm.id) spForm.id = crypto.randomUUID();
                  const profile = { id: spForm.id!, name: spForm.name, host: spForm.host, port: spForm.port, user: spForm.user, auth: spForm.authType === 'agent' ? { agent: true } : spForm.authType === 'password' ? { password: spForm.password } : { keyPath: spForm.keyPath, passphrase: spForm.passphrase }, path: spForm.path } as any;
                  await saveSshProfile(profile);
                  setSshProfiles(await getSshProfiles());
                  setSpOpen(false);
                }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {browse && (
        <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.45)' }}>
          <div style={{ background: '#1e1e1e', color: '#eee', padding: 16, borderRadius: 8, minWidth: 520 }}>
            <h3 style={{ marginTop: 0 }}>Browse Remote</h3>
            <div style={{ marginBottom: 8 }}>Path: {browse.cwd}</div>
            <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #444', borderRadius: 4 }}>
              <div>
                <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={async () => {
                  const parent = browse.cwd.replace(/\/+$/, '').replace(/\/+[^/]+$/, '') || '/';
                  try { const entries = await sshSftpList(browse.sessionId, parent); setBrowse({ ...browse, cwd: parent, entries }); } catch {}
                }}>..</div>
                {browse.entries.filter(e => e.is_dir).map((e) => (
                  <div key={e.path} style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={async () => { try { const entries = await sshSftpList(browse.sessionId, e.path); setBrowse({ ...browse, cwd: e.path, entries }); } catch {} }}>{e.name}</div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={async () => { try { await sshDisconnect(browse.sessionId); } catch {} setBrowse(null); }}>Cancel</button>
              <button onClick={async () => { setSpForm({ ...spForm, path: browse.cwd }); try { await sshDisconnect(browse.sessionId); } catch {} setBrowse(null); }}>Select</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
