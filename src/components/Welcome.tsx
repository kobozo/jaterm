import React, { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { addRecent, getRecents, removeRecent, clearRecents } from '@/store/recents';
import { getRecentSessions, removeRecentSession, clearRecentSessions, getRecentSshSessions, removeRecentSshSession, clearRecentSshSessions } from '@/store/sessions';
import { getLocalProfiles, getSshProfiles, saveLocalProfile, saveSshProfile, deleteLocalProfile, deleteSshProfile, type LocalProfile, type SshProfileStored } from '@/store/persist';
import { getThemeList, themes } from '@/config/themes';
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
  const [spForm, setSpForm] = useState<{ 
    id?: string; 
    name: string; 
    host: string; 
    port?: number; 
    user: string; 
    authType: 'agent'|'password'|'key'; 
    password?: string; 
    keyPath?: string; 
    passphrase?: string; 
    path?: string;
    // New settings
    envVars?: Array<{ key: string; value: string }>;
    initCommands?: string[];
    shellOverride?: string;
    defaultForwards?: Array<{ type: 'L' | 'R'; srcHost: string; srcPort: number; dstHost: string; dstPort: number }>;
    // Terminal settings
    theme?: string;
    fontSize?: number;
    fontFamily?: string;
  }>({ name: '', host: '', user: '', authType: 'agent' });
  const [activeTab, setActiveTab] = useState<'basic' | 'environment' | 'forwarding' | 'terminal'>('basic');
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
                      onOpenSsh?.({ 
                        host: p.host, 
                        port: p.port, 
                        user: p.user, 
                        auth: p.auth || { agent: true }, 
                        cwd: s.path, 
                        profileId: p.id,
                        terminal: p.terminal,
                        shell: p.shell,
                        advanced: p.advanced
                      });
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
            <button onClick={() => { setLpForm({ name: '', path: '' }); setLpOpen(true); }}>New Local Profile</button>
            <ul>
              {localProfiles.map((p) => (
                <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <a href="#" onClick={(e) => { e.preventDefault(); onOpenFolder(p.path); }}>{p.name || p.path}</a>
                  <button onClick={() => { 
                    setLpForm({ id: p.id, name: p.name, path: p.path }); 
                    setLpOpen(true); 
                  }} title="Edit">✎</button>
                  <button onClick={async () => { await deleteLocalProfile(p.id); setLocalProfiles(await getLocalProfiles()); }} title="Remove">×</button>
                </li>
              ))}
            </ul>
          </div>
          <div style={{ flex: 1 }}>
            <h3>SSH</h3>
            <button onClick={() => { setSpForm({ name: '', host: '', user: '', authType: 'agent' }); setSpOpen(true); }}>New SSH Profile</button>
            <ul>
              {sshProfiles.map((p) => (
                <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <a 
                    href="#" 
                    onClick={(e) => {
                      e.preventDefault();
                      if (!onOpenSsh) return;
                      onOpenSsh({ 
                        host: p.host, 
                        port: p.port, 
                        user: p.user, 
                        auth: p.auth || { agent: true }, 
                        cwd: p.path, 
                        profileId: p.id,
                        terminal: p.terminal,
                        shell: p.shell,
                        advanced: p.advanced
                      });
                    }}
                    title={(p.name || `${p.user}@${p.host}`) + (p.path ? `: ${p.path}` : '')}
                  >
                    {p.name || `${p.user}@${p.host}`}{p.path ? `: ${p.path}` : ''}
                  </a>
                  <button onClick={() => {
                    // Load existing profile data into form
                    const authType = p.auth?.agent ? 'agent' : p.auth?.password ? 'password' : 'key';
                    setSpForm({ 
                      id: p.id,
                      name: p.name, 
                      host: p.host, 
                      port: p.port,
                      user: p.user, 
                      authType: authType as any,
                      password: p.auth?.password,
                      keyPath: p.auth?.keyPath,
                      passphrase: p.auth?.passphrase,
                      path: p.path,
                      // Load advanced settings
                      envVars: p.shell?.env ? Object.entries(p.shell.env).map(([key, value]) => ({ key, value: value as string })) : undefined,
                      initCommands: p.shell?.initCommands,
                      shellOverride: p.shell?.shell,
                      defaultForwards: p.advanced?.defaultForwards,
                      theme: p.terminal?.theme,
                      fontSize: p.terminal?.fontSize,
                      fontFamily: p.terminal?.fontFamily
                    }); 
                    setSpOpen(true); 
                  }} title="Edit">✎</button>
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
            <h3 style={{ marginTop: 0 }}>{lpForm.id ? 'Edit' : 'New'} Local Profile</h3>
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
          <div style={{ background: '#1e1e1e', color: '#eee', padding: 0, borderRadius: 8, minWidth: 580, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 16px 0', borderBottom: '1px solid #444' }}>
              <h3 style={{ margin: 0 }}>{spForm.id ? 'Edit' : 'New'} SSH Profile</h3>
              {/* Tab Navigation */}
              <div style={{ display: 'flex', gap: 0, marginTop: 12 }}>
                <button 
                  onClick={() => setActiveTab('basic')} 
                  style={{ 
                    padding: '8px 16px', 
                    background: activeTab === 'basic' ? '#333' : 'transparent', 
                    border: 'none',
                    borderBottom: activeTab === 'basic' ? '2px solid #0078d4' : '2px solid transparent',
                    color: activeTab === 'basic' ? '#fff' : '#aaa',
                    cursor: 'pointer'
                  }}
                >
                  Basic
                </button>
                <button 
                  onClick={() => setActiveTab('environment')} 
                  style={{ 
                    padding: '8px 16px', 
                    background: activeTab === 'environment' ? '#333' : 'transparent',
                    border: 'none', 
                    borderBottom: activeTab === 'environment' ? '2px solid #0078d4' : '2px solid transparent',
                    color: activeTab === 'environment' ? '#fff' : '#aaa',
                    cursor: 'pointer'
                  }}
                >
                  Environment
                </button>
                <button 
                  onClick={() => setActiveTab('forwarding')} 
                  style={{ 
                    padding: '8px 16px', 
                    background: activeTab === 'forwarding' ? '#333' : 'transparent',
                    border: 'none',
                    borderBottom: activeTab === 'forwarding' ? '2px solid #0078d4' : '2px solid transparent',
                    color: activeTab === 'forwarding' ? '#fff' : '#aaa',
                    cursor: 'pointer'
                  }}
                >
                  Forwarding
                </button>
                <button 
                  onClick={() => setActiveTab('terminal')} 
                  style={{ 
                    padding: '8px 16px', 
                    background: activeTab === 'terminal' ? '#333' : 'transparent',
                    border: 'none',
                    borderBottom: activeTab === 'terminal' ? '2px solid #0078d4' : '2px solid transparent',
                    color: activeTab === 'terminal' ? '#fff' : '#aaa',
                    cursor: 'pointer'
                  }}
                >
                  Terminal
                </button>
              </div>
            </div>
            
            {/* Tab Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {activeTab === 'basic' && (
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
                        const { sshConnectWithTrustPrompt } = await import('@/types/ipc');
                        const sessionId = await sshConnectWithTrustPrompt({ host: spForm.host, port: spForm.port ?? 22, user: spForm.user, auth: { password: spForm.password, key_path: spForm.keyPath, passphrase: spForm.passphrase, agent: spForm.authType === 'agent' } as any, timeout_ms: 15000 });
                        const home = await sshHomeDir(sessionId);
                        const start = spForm.path || home;
                        const entries = await sshSftpList(sessionId, start);
                        setBrowse({ sessionId, cwd: start, entries });
                      } catch (e) { alert('SSH browse failed: ' + (e as any)); }
                    }}>Browse…</button>
                  </div>
                </div>
              )}
              
              {activeTab === 'environment' && (
                <div style={{ display: 'grid', gap: 12 }}>
                  {/* Shell Override */}
                  <div>
                    <label>Shell Override
                      <input 
                        style={{ width: '100%' }} 
                        value={spForm.shellOverride || ''} 
                        onChange={(e) => setSpForm({ ...spForm, shellOverride: e.target.value || undefined })}
                        placeholder="/bin/zsh (leave empty for default)"
                      />
                    </label>
                  </div>
                  
                  {/* Environment Variables */}
                  <div>
                    <label style={{ display: 'block', marginBottom: 4 }}>Environment Variables</label>
                  {(spForm.envVars || []).map((env, i) => (
                    <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      <input 
                        placeholder="KEY" 
                        value={env.key} 
                        onChange={(e) => {
                          const newVars = [...(spForm.envVars || [])];
                          newVars[i].key = e.target.value;
                          setSpForm({ ...spForm, envVars: newVars });
                        }}
                        style={{ flex: 1 }}
                      />
                      <input 
                        placeholder="value" 
                        value={env.value} 
                        onChange={(e) => {
                          const newVars = [...(spForm.envVars || [])];
                          newVars[i].value = e.target.value;
                          setSpForm({ ...spForm, envVars: newVars });
                        }}
                        style={{ flex: 2 }}
                      />
                      <button onClick={() => {
                        const newVars = (spForm.envVars || []).filter((_, idx) => idx !== i);
                        setSpForm({ ...spForm, envVars: newVars.length ? newVars : undefined });
                      }}>×</button>
                    </div>
                  ))}
                    <button onClick={() => {
                      setSpForm({ ...spForm, envVars: [...(spForm.envVars || []), { key: '', value: '' }] });
                    }} style={{ fontSize: 12 }}>+ Add Variable</button>
                  </div>
                  
                  {/* Init Commands */}
                  <div>
                    <label style={{ display: 'block', marginBottom: 4 }}>Initialization Commands</label>
                  {(spForm.initCommands || []).map((cmd, i) => (
                    <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      <input 
                        value={cmd} 
                        onChange={(e) => {
                          const newCmds = [...(spForm.initCommands || [])];
                          newCmds[i] = e.target.value;
                          setSpForm({ ...spForm, initCommands: newCmds });
                        }}
                        placeholder="Command to run on connect"
                        style={{ flex: 1 }}
                      />
                      <button onClick={() => {
                        const newCmds = (spForm.initCommands || []).filter((_, idx) => idx !== i);
                        setSpForm({ ...spForm, initCommands: newCmds.length ? newCmds : undefined });
                      }}>×</button>
                    </div>
                  ))}
                    <button onClick={() => {
                      setSpForm({ ...spForm, initCommands: [...(spForm.initCommands || []), ''] });
                    }} style={{ fontSize: 12 }}>+ Add Command</button>
                  </div>
                </div>
              )}
              
              {activeTab === 'forwarding' && (
                <div>
                  <label style={{ display: 'block', marginBottom: 4 }}>Default Port Forwards</label>
                  {(spForm.defaultForwards || []).map((fwd, i) => (
                    <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                      <select 
                        value={fwd.type} 
                        onChange={(e) => {
                          const newFwds = [...(spForm.defaultForwards || [])];
                          newFwds[i].type = e.target.value as 'L' | 'R';
                          setSpForm({ ...spForm, defaultForwards: newFwds });
                        }}
                        style={{ width: 45 }}
                      >
                        <option value="L">L</option>
                        <option value="R">R</option>
                      </select>
                      <input 
                        placeholder="127.0.0.1" 
                        value={fwd.srcHost} 
                        onChange={(e) => {
                          const newFwds = [...(spForm.defaultForwards || [])];
                          newFwds[i].srcHost = e.target.value;
                          setSpForm({ ...spForm, defaultForwards: newFwds });
                        }}
                        style={{ width: 90 }}
                      />
                      <input 
                        type="number" 
                        placeholder="3000" 
                        value={fwd.srcPort || ''} 
                        onChange={(e) => {
                          const newFwds = [...(spForm.defaultForwards || [])];
                          newFwds[i].srcPort = Number(e.target.value);
                          setSpForm({ ...spForm, defaultForwards: newFwds });
                        }}
                        style={{ width: 60 }}
                      />
                      <span>→</span>
                      <input 
                        placeholder="127.0.0.1" 
                        value={fwd.dstHost} 
                        onChange={(e) => {
                          const newFwds = [...(spForm.defaultForwards || [])];
                          newFwds[i].dstHost = e.target.value;
                          setSpForm({ ...spForm, defaultForwards: newFwds });
                        }}
                        style={{ width: 90 }}
                      />
                      <input 
                        type="number" 
                        placeholder="3000" 
                        value={fwd.dstPort || ''} 
                        onChange={(e) => {
                          const newFwds = [...(spForm.defaultForwards || [])];
                          newFwds[i].dstPort = Number(e.target.value);
                          setSpForm({ ...spForm, defaultForwards: newFwds });
                        }}
                        style={{ width: 60 }}
                      />
                      <button onClick={() => {
                        const newFwds = (spForm.defaultForwards || []).filter((_, idx) => idx !== i);
                        setSpForm({ ...spForm, defaultForwards: newFwds.length ? newFwds : undefined });
                      }}>×</button>
                    </div>
                  ))}
                    <button onClick={() => {
                      setSpForm({ 
                        ...spForm, 
                        defaultForwards: [...(spForm.defaultForwards || []), { 
                          type: 'L' as const, 
                          srcHost: '127.0.0.1', 
                          srcPort: 0, 
                          dstHost: '127.0.0.1', 
                          dstPort: 0 
                        }] 
                      });
                    }} style={{ fontSize: 12 }}>+ Add Forward</button>
                </div>
              )}
              
              {activeTab === 'terminal' && (
                <div style={{ display: 'grid', gap: 12 }}>
                  {/* Theme Selector */}
                  <div>
                    <label>Theme
                      <select 
                        style={{ width: '100%' }} 
                        value={spForm.theme || 'default'} 
                        onChange={(e) => setSpForm({ ...spForm, theme: e.target.value })}
                      >
                        {getThemeList().map(theme => (
                          <option key={theme.key} value={theme.key}>
                            {theme.name} {theme.dark ? '(dark)' : '(light)'}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  
                  {/* Font Size */}
                  <div>
                    <label>Font Size
                      <input 
                        type="number" 
                        style={{ width: '100%' }} 
                        value={spForm.fontSize || 14} 
                        onChange={(e) => setSpForm({ ...spForm, fontSize: Number(e.target.value) || undefined })}
                        min="8"
                        max="32"
                        placeholder="14"
                      />
                    </label>
                  </div>
                  
                  {/* Font Family */}
                  <div>
                    <label>Font Family
                      <input 
                        style={{ width: '100%' }} 
                        value={spForm.fontFamily || ''} 
                        onChange={(e) => setSpForm({ ...spForm, fontFamily: e.target.value || undefined })}
                        placeholder="'Cascadia Code', 'Fira Code', monospace"
                      />
                    </label>
                  </div>
                  
                  {/* Theme Preview */}
                  <div style={{ marginTop: 12 }}>
                    <label style={{ display: 'block', marginBottom: 8 }}>Preview</label>
                    <div 
                      style={{ 
                        padding: 12, 
                        borderRadius: 4, 
                        fontFamily: spForm.fontFamily || "'Cascadia Code', monospace",
                        fontSize: (spForm.fontSize || 14) + 'px',
                        background: themes[spForm.theme || 'default']?.colors.background || '#1e1e1e',
                        color: themes[spForm.theme || 'default']?.colors.foreground || '#cccccc',
                        border: '1px solid #444'
                      }}
                    >
                      <div>$ npm run dev</div>
                      <div style={{ color: themes[spForm.theme || 'default']?.colors.green || '#0dbc79' }}>✓ Server running at http://localhost:3000</div>
                      <div style={{ color: themes[spForm.theme || 'default']?.colors.yellow || '#e5e510' }}>⚠ Warning: Some dependencies need update</div>
                      <div style={{ color: themes[spForm.theme || 'default']?.colors.red || '#cd3131' }}>✗ Error: Module not found</div>
                      <div style={{ color: themes[spForm.theme || 'default']?.colors.blue || '#2472c8' }}>→ Building application...</div>
                      <div style={{ color: themes[spForm.theme || 'default']?.colors.magenta || '#bc3fbc' }}>◆ Debug: Variable = {'{value}'}</div>
                      <div style={{ color: themes[spForm.theme || 'default']?.colors.cyan || '#11a8cd' }}>ℹ Info: Cache cleared successfully</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div style={{ padding: 16, borderTop: '1px solid #444', display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
              <button onClick={async () => {
                // Background install of helper with progress toast
                try {
                  const { sshConnectWithTrustPrompt } = await import('@/types/ipc');
                  const sessionId = await sshConnectWithTrustPrompt({ host: spForm.host, port: spForm.port ?? 22, user: spForm.user, auth: { password: spForm.password, key_path: spForm.keyPath, passphrase: spForm.passphrase, agent: spForm.authType === 'agent' } as any, timeout_ms: 15000 });
                  await ensureHelper(sessionId, { show, update, dismiss });
                  try { await sshDisconnect(sessionId); } catch {}
                } catch (e) {
                  const tid = show({ title: 'Install helper failed', message: String(e), kind: 'error' });
                  setTimeout(() => dismiss(tid), 2500);
                }
              }}>Install Helper</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setSpOpen(false); setActiveTab('basic'); }}>Cancel</button>
                <button onClick={async () => {
                  if (!spForm.id) spForm.id = crypto.randomUUID();
                  const profile: any = { 
                    id: spForm.id!, 
                    name: spForm.name, 
                    host: spForm.host, 
                    port: spForm.port, 
                    user: spForm.user, 
                    auth: spForm.authType === 'agent' ? { agent: true } : spForm.authType === 'password' ? { password: spForm.password } : { keyPath: spForm.keyPath, passphrase: spForm.passphrase }, 
                    path: spForm.path 
                  };
                  
                  // Add shell settings if provided
                  if (spForm.envVars?.length || spForm.initCommands?.length || spForm.shellOverride) {
                    profile.shell = {};
                    if (spForm.envVars?.length) {
                      profile.shell.env = Object.fromEntries(spForm.envVars.map(v => [v.key, v.value]));
                    }
                    if (spForm.initCommands?.length) {
                      profile.shell.initCommands = spForm.initCommands;
                    }
                    if (spForm.shellOverride) {
                      profile.shell.shell = spForm.shellOverride;
                    }
                  }
                  
                  // Add advanced settings if provided
                  if (spForm.defaultForwards?.length) {
                    profile.advanced = { defaultForwards: spForm.defaultForwards };
                  }
                  
                  // Add terminal settings if provided
                  if (spForm.theme || spForm.fontSize || spForm.fontFamily) {
                    profile.terminal = {};
                    if (spForm.theme) profile.terminal.theme = spForm.theme;
                    if (spForm.fontSize) profile.terminal.fontSize = spForm.fontSize;
                    if (spForm.fontFamily) profile.terminal.fontFamily = spForm.fontFamily;
                  }
                  
                  await saveSshProfile(profile);
                  setSshProfiles(await getSshProfiles());
                  setSpOpen(false);
                  setActiveTab('basic');
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
