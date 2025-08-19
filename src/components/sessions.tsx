import React, { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { addRecent } from '@/store/recents';
import { getRecentSessions, removeRecentSession, clearRecentSessions, getRecentSshSessions, removeRecentSshSession, clearRecentSshSessions } from '@/store/sessions';
import { getLocalProfiles, getSshProfiles, saveLocalProfile, saveSshProfile, deleteLocalProfile, deleteSshProfile, ensureProfilesTree, saveProfilesTree, type LocalProfile, type SshProfileStored, type ProfilesTreeNode } from '@/store/persist';
import { getThemeList, themes } from '@/config/themes';
import { sshConnect, sshDisconnect, sshHomeDir, sshSftpList, onSshUploadProgress, sshSftpMkdirs, sshSftpWrite, sshExec } from '@/types/ipc';
import { ensureHelper } from '@/services/helper';
import { useToasts } from '@/store/toasts';

import type { RecentSession, RecentSshSession } from '@/store/sessions';

type Props = {
  onOpenFolder: (path: string) => void;
  onOpenSession?: (session: RecentSession) => void;
  onOpenSsh?: (opts: { host: string; port?: number; user: string; auth: { password?: string; keyPath?: string; passphrase?: string; agent?: boolean }; cwd?: string; profileId?: string }) => void;
};

export default function Welcome({ onOpenFolder, onOpenSession, onOpenSsh }: Props) {
  const { show, update, dismiss } = useToasts();
  const [recentSessions, setRecentSessions] = useState<{ cwd: string; closedAt: number; panes?: number }[]>([]);
  const [recentSsh, setRecentSsh] = useState<RecentSshSession[]>([]);
  const [tree, setTree] = useState<ProfilesTreeNode | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<null | { x: number; y: number; type: 'folder' | 'profile'; node: any }>(null);
  const [folderDialog, setFolderDialog] = useState<null | { parentId: string; name: string }>(null);
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
  
  function folderList(n: ProfilesTreeNode | null): { id: string; name: string; path: string }[] {
    const acc: { id: string; name: string; path: string }[] = [];
    function walk(node: ProfilesTreeNode, prefix: string, depth: number) {
      if (node.type === 'folder') {
        const path = prefix ? `${prefix}/${node.name}` : `/${node.name}`;
        if (depth > 0) acc.push({ id: node.id, name: node.name, path });
        node.children.forEach((c) => walk(c, path, depth + 1));
      }
    }
    if (n) walk(n, '', 0);
    return acc;
  }

  function updateTree(mut: (n: ProfilesTreeNode) => void) {
    if (!tree) return;
    const clone = JSON.parse(JSON.stringify(tree)) as ProfilesTreeNode;
    mut(clone);
    setTree(clone);
    saveProfilesTree(clone);
  }

  function findFolder(node: ProfilesTreeNode, id: string): (ProfilesTreeNode & { type: 'folder' }) | null {
    if (node.type === 'folder') {
      if (node.id === id) return node as any;
      for (const c of node.children) {
        const found = findFolder(c, id);
        if (found) return found;
      }
    }
    return null;
  }

  function findParentOf(node: ProfilesTreeNode, childId: string): (ProfilesTreeNode & { type: 'folder' }) | null {
    if (node.type !== 'folder') return null;
    if (node.children.some((c) => c.id === childId)) return node as any;
    for (const c of node.children) {
      const p = findParentOf(c, childId);
      if (p) return p;
    }
    return null;
  }

  // Breadcrumb trail for explorer navigation
  function breadcrumbs(root: ProfilesTreeNode, id: string): { id: string; name: string }[] {
    const path: { id: string; name: string }[] = [];
    function walk(node: ProfilesTreeNode, trail: { id: string; name: string }[]): boolean {
      if (node.type === 'folder') {
        const here = [...trail, { id: node.id, name: node.name }];
        if (node.id === id) { path.push(...here); return true; }
        for (const c of node.children) {
          if (walk(c, here)) return true;
        }
      }
      return false;
    }
    walk(root, []);
    return path;
  }

  function removeNode(node: ProfilesTreeNode, id: string): boolean {
    if (node.type !== 'folder') return false;
    const idx = node.children.findIndex((c) => c.id === id);
    if (idx >= 0) { node.children.splice(idx, 1); return true; }
    for (const c of node.children) {
      if (removeNode(c, id)) return true;
    }
    return false;
  }

  function hasProfileNode(node: ProfilesTreeNode, kind: 'local' | 'ssh', id: string): boolean {
    if (node.type === 'profile') return node.ref.kind === kind && node.ref.id === id;
    return node.children.some((c) => hasProfileNode(c, kind, id));
  }
  function addProfileNode(root: ProfilesTreeNode, kind: 'local' | 'ssh', id: string) {
    if (root.type !== 'folder') return;
    // Default: add to root (user can organize into any folder later)
    (root as any).children.push({ id: `${kind}-${id}`, type: 'profile', ref: { kind, id } });
  }

  function profileLabel(n: Extract<ProfilesTreeNode, { type: 'profile' }>): string {
    if (n.ref.kind === 'local') {
      const p = localProfiles.find((x) => x.id === n.ref.id);
      return p ? (p.name || p.path) : '(missing local profile)';
    } else {
      const p = sshProfiles.find((x) => x.id === n.ref.id);
      return p ? (p.name || `${p.user}@${p.host}`) : '(missing ssh profile)';
    }
  }
  function iconFor(n: ProfilesTreeNode): string { return n.type === 'folder' ? '📁' : (n.ref.kind === 'ssh' ? '🔗' : '💻'); }
  function openProfile(n: Extract<ProfilesTreeNode, { type: 'profile' }>) {
    if (n.ref.kind === 'local') {
      const p = localProfiles.find((x) => x.id === n.ref.id);
      if (p) onOpenFolder(p.path);
    } else {
      const p = sshProfiles.find((x) => x.id === n.ref.id);
      if (p && onOpenSsh) onOpenSsh({ host: p.host, port: p.port, user: p.user, auth: p.auth || { agent: true }, cwd: p.path, profileId: p.id, terminal: p.terminal, shell: p.shell, advanced: p.advanced } as any);
    }
  }
  function editProfile(n: Extract<ProfilesTreeNode, { type: 'profile' }>) {
    if (n.ref.kind === 'local') {
      const p = localProfiles.find((x) => x.id === n.ref.id);
      if (p) { setLpForm({ id: p.id, name: p.name, path: p.path }); setLpOpen(true); }
    } else {
      const p = sshProfiles.find((x) => x.id === n.ref.id);
      if (p) {
        const authType = p.auth?.agent ? 'agent' : p.auth?.password ? 'password' : 'key';
        setSpForm({ id: p.id, name: p.name, host: p.host, port: p.port, user: p.user, authType: authType as any, password: p.auth?.password, keyPath: p.auth?.keyPath, passphrase: p.auth?.passphrase, path: p.path, envVars: p.shell?.env ? Object.entries(p.shell.env).map(([key, value]) => ({ key, value: value as string })) : undefined, initCommands: p.shell?.initCommands, shellOverride: p.shell?.shell, defaultForwards: p.advanced?.defaultForwards, theme: p.terminal?.theme, fontSize: p.terminal?.fontSize, fontFamily: p.terminal?.fontFamily });
        setSpOpen(true);
      }
    }
  }
  async function deleteProfileNode(n: Extract<ProfilesTreeNode, { type: 'profile' }>) {
    if (!tree) return;
    if (!confirm('Remove this profile from list? This also deletes the stored profile.')) return;
    if (n.ref.kind === 'local') {
      await deleteLocalProfile(n.ref.id);
      setLocalProfiles(await getLocalProfiles());
    } else {
      await deleteSshProfile(n.ref.id);
      setSshProfiles(await getSshProfiles());
    }
    updateTree((root) => { removeNode(root, n.id); });
  }
  function moveProfileNode(n: Extract<ProfilesTreeNode, { type: 'profile' }>) {
    if (!tree) return;
    const folders = folderList(tree).filter((f) => f.id !== n.id);
    const choice = prompt('Move to folder (type exact path):\n' + folders.map((f) => f.path).join('\n'));
    if (!choice) return;
    const target = folders.find((f) => f.path === choice);
    if (!target) { alert('Folder not found'); return; }
    updateTree((root) => {
      const fromRemoved = removeNode(root, n.id);
      const dest = findFolder(root, target.id);
      if (fromRemoved && dest) dest.children.push(n);
    });
  }
  // Tree renderer removed in favor of an explorer view
  useEffect(() => {
    (async () => {
      setRecentSessions(await getRecentSessions());
      setRecentSsh(await getRecentSshSessions());
      setLocalProfiles(await getLocalProfiles());
      setSshProfiles(await getSshProfiles());
      const root = await ensureProfilesTree();
      setTree(root);
      setCurrentFolderId(root.id);
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

  const combinedRecents = React.useMemo(() => {
    const locals = recentSessions.map((s) => ({ type: 'local' as const, key: `local:${s.cwd}:${s.closedAt}`, closedAt: s.closedAt, s }));
    const sshs = recentSsh.map((s) => ({ type: 'ssh' as const, key: `ssh:${s.profileId || ''}:${s.path}:${s.closedAt}`, closedAt: s.closedAt, s }));
    return [...locals, ...sshs].sort((a, b) => b.closedAt - a.closedAt);
  }, [recentSessions, recentSsh]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Left column: quick actions + profiles (60%) */}
        <div style={{ flex: 6, minWidth: 0 }}>
          <h1>Start New Session</h1>
          <p>Start a local terminal in your home or a specific folder.</p>
          <div style={{ margin: '16px 0', display: 'flex', gap: 12 }}>
            <button onClick={handleHome}>Start in Home Folder</button>
            <button onClick={handlePick}>Start in Specific Folder…</button>
            <button onClick={() => setSshOpen(true)}>Open SSH Session…</button>
          </div>

          {/* Profiles tree */}
          <div style={{ marginTop: 24 }}>
            <h2>Profiles</h2>
            <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center' }}>
              <button onClick={() => { setLpForm({ name: '', path: '' }); setLpOpen(true); }}>New Local Profile</button>
              <button onClick={() => { setSpForm({ name: '', host: '', user: '', authType: 'agent' }); setSpOpen(true); }}>New SSH Profile</button>
              <span style={{ flex: 1 }} />
              <button onClick={() => {
                if (!tree || !currentFolderId) return;
                setFolderDialog({ parentId: currentFolderId, name: '' });
              }}>+ Folder</button>
            </div>
            <div style={{ border: '1px solid #333', borderRadius: 6, padding: 12 }}>
              {tree && currentFolderId ? (
                <>
                  {/* Breadcrumbs */}
                  <div style={{ marginBottom: 8, fontSize: 13, color: '#bbb' }}>
                    {breadcrumbs(tree, currentFolderId).map((seg, i, arr) => (
                      <span key={seg.id}>
                        <a href="#" onClick={(e) => { e.preventDefault(); setCurrentFolderId(seg.id); }} style={{ color: '#cbd5e1' }}>{seg.name}</a>
                        {i < arr.length - 1 ? ' / ' : ''}
                      </span>
                    ))}
                  </div>
                  {/* Items grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                    {(() => {
                      const folder = findFolder(tree, currentFolderId);
                      if (!folder) return <div style={{ color: '#888' }}>Folder not found.</div>;
                      const items = folder.children.slice();
                      items.sort((a, b) => {
                        const aIsFolder = (a as any).type === 'folder' ? 0 : 1;
                        const bIsFolder = (b as any).type === 'folder' ? 0 : 1;
                        if (aIsFolder !== bIsFolder) return aIsFolder - bIsFolder;
                        const aName = (a as any).type === 'folder' ? (a as any).name : profileLabel(a as any);
                        const bName = (b as any).type === 'folder' ? (b as any).name : profileLabel(b as any);
                        return String(aName).localeCompare(String(bName));
                      });
                      return items.map((n: any) => (
                        n.type === 'folder' ? (
                          <div
                            key={n.id}
                            onDoubleClick={() => setCurrentFolderId(n.id)}
                            onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, type: 'folder', node: n }); }}
                            style={{ border: '1px solid #333', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'default' }}
                          >
                            <div style={{ fontSize: 28 }}>📁</div>
                            <div style={{ fontSize: 12, textAlign: 'center', wordBreak: 'break-word' }}>{n.name}</div>
                          </div>
                        ) : (
                          <div
                            key={n.id}
                            onDoubleClick={() => openProfile(n)}
                            onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, type: 'profile', node: n }); }}
                            style={{ border: '1px solid #333', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'default' }}
                          >
                            <div style={{ fontSize: 28 }}>{iconFor(n)}</div>
                            <div style={{ fontSize: 12, textAlign: 'center', wordBreak: 'break-word' }}>{profileLabel(n)}</div>
                          </div>
                        )
                      ));
                    })()}
                  </div>
                </>
              ) : (
                <div style={{ color: '#888' }}>Loading…</div>
              )}
            </div>
          </div>
        </div>

        {/* Right column: Recents (40%) */}
        <div style={{ flex: 4, minWidth: 0 }}>
          {/* Recent folders UI removed (functionality persists via addRecent) */}
          {combinedRecents.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Recent sessions</span>
                <button
                  onClick={async () => {
                    await clearRecentSessions();
                    await clearRecentSshSessions();
                    setRecentSessions(await getRecentSessions());
                    setRecentSsh(await getRecentSshSessions());
                  }}
                  title="Clear all recent sessions"
                >
                  Clear
                </button>
              </h3>
              <ul>
                {combinedRecents.map((r) => (
                  <li key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {r.type === 'local' ? (
                      <>
                        <a
                          href="#"
                          onClick={(e) => { e.preventDefault(); (onOpenSession ? onOpenSession(r.s) : onOpenFolder(r.s.cwd)); }}
                          title={r.s.cwd + ' — ' + new Date(r.s.closedAt).toLocaleString()}
                        >
                          {r.s.cwd}
                        </a>
                        <button
                          onClick={async () => {
                            await removeRecentSession(r.s.cwd);
                            setRecentSessions(await getRecentSessions());
                          }}
                          title="Remove"
                        >
                          ×
                        </button>
                      </>
                    ) : (
                      <>
                        <a
                          href="#"
                          title={r.s.path + ' — ' + new Date(r.s.closedAt).toLocaleString()}
                          onClick={(e) => {
                            e.preventDefault();
                            (async () => {
                              const all = await getSshProfiles();
                              const p = r.s.profileId ? all.find((x) => x.id === r.s.profileId) : undefined;
                              if (p) {
                                onOpenSsh?.({ host: p.host, port: p.port, user: p.user, auth: p.auth || { agent: true }, cwd: r.s.path, profileId: p.id, terminal: p.terminal, shell: p.shell, advanced: p.advanced });
                              } else if (r.s.host && r.s.user) {
                                onOpenSsh?.({ host: r.s.host, port: r.s.port ?? 22, user: r.s.user, auth: { agent: true } as any, cwd: r.s.path });
                              } else {
                                alert('Cannot open SSH recent: profile missing and no host/user stored');
                              }
                            })();
                          }}
                        >
                          {r.s.path} {(() => {
                            const p = r.s.profileId ? sshProfiles.find((x) => x.id === r.s.profileId) : undefined;
                            const label = p ? (p.name || `${p.user}@${p.host}`) : (r.s.user && r.s.host ? `${r.s.user}@${r.s.host}` : undefined);
                            return label ? ` [${label}]` : '';
                          })()}
                        </a>
                        <button
                          onClick={async () => {
                            await removeRecentSshSession((r.s.profileId || ''), r.s.path);
                            setRecentSsh(await getRecentSshSessions());
                          }}
                          title="Remove"
                        >
                          ×
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
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
      

      {lpOpen && (
        <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)' }}>
          <div style={{ background: '#1e1e1e', color: '#eee', padding: 16, borderRadius: 8, minWidth: 420 }}>
            <h3 style={{ marginTop: 0 }}>{lpForm.id ? 'Edit' : 'New'} Local Profile</h3>
            <label>Name<input style={{ width: '100%' }} value={lpForm.name} onChange={(e) => setLpForm({ ...lpForm, name: e.target.value })} /></label>
            <label>Path<input style={{ width: '100%' }} value={lpForm.path} onChange={(e) => setLpForm({ ...lpForm, path: e.target.value })} placeholder="/absolute/path" /></label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={() => setLpOpen(false)}>Cancel</button>
              <button onClick={async () => { 
                if (!lpForm.id) lpForm.id = crypto.randomUUID(); 
                await saveLocalProfile(lpForm as any); 
                setLocalProfiles(await getLocalProfiles()); 
                if (tree && !hasProfileNode(tree, 'local', lpForm.id)) {
                  updateTree((root) => addProfileNode(root, 'local', lpForm.id!));
                }
                setLpOpen(false); 
              }}>Save</button>
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
                  if (tree && !hasProfileNode(tree, 'ssh', spForm.id!)) {
                    updateTree((root) => addProfileNode(root, 'ssh', spForm.id!));
                  }
                  setSpOpen(false);
                  setActiveTab('basic');
                }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Folder dialog */}
      {folderDialog && (
        <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)', zIndex: 999 }}>
          <div style={{ background: '#1e1e1e', color: '#eee', padding: 16, borderRadius: 8, minWidth: 380 }}>
            <h3 style={{ marginTop: 0 }}>New Folder</h3>
            <label>
              Name
              <input
                autoFocus
                style={{ width: '100%' }}
                value={folderDialog.name}
                onChange={(e) => setFolderDialog({ ...folderDialog, name: e.target.value })}
                placeholder="Folder name"
                onKeyDown={(e) => { if (e.key === 'Enter') (document.getElementById('jtrm-folder-save-btn') as HTMLButtonElement)?.click(); }}
              />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
              <button onClick={() => setFolderDialog(null)}>Cancel</button>
              <button
                id="jtrm-folder-save-btn"
                onClick={() => {
                  const name = (folderDialog.name || '').trim();
                  if (!name) { return; }
                  const parentId = folderDialog.parentId;
                  const newId = crypto.randomUUID();
                  updateTree((root) => {
                    const dest = findFolder(root, parentId);
                    if (!dest) return;
                    dest.children.push({ id: newId, type: 'folder', name, children: [] });
                  });
                  setCurrentFolderId(newId);
                  setFolderDialog(null);
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <div
          onClick={() => setCtxMenu(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, background: '#1f1f1f', border: '1px solid #444', borderRadius: 6, minWidth: 160, padding: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
          >
            {ctxMenu.type === 'folder' ? (
              <>
                <button style={{ width: '100%', textAlign: 'left' }} onClick={() => { setCurrentFolderId(ctxMenu.node.id); setCtxMenu(null); }}>Open</button>
                <button style={{ width: '100%', textAlign: 'left' }} onClick={() => { const name = prompt('Rename folder', ctxMenu.node.name); if (name) updateTree((root) => { const f = findFolder(root, ctxMenu.node.id); if (f) (f as any).name = name; }); setCtxMenu(null); }}>Rename</button>
                <button style={{ width: '100%', textAlign: 'left' }} onClick={() => { setFolderDialog({ parentId: ctxMenu.node.id, name: '' }); setCtxMenu(null); }}>New subfolder</button>
                <button style={{ width: '100%', textAlign: 'left' }} onClick={() => { if ((ctxMenu.node.children || []).length) { alert('Folder not empty'); return; } updateTree((root) => { removeNode(root, ctxMenu.node.id); }); setCtxMenu(null); }}>Delete</button>
              </>
            ) : (
              <>
                <button style={{ width: '100%', textAlign: 'left' }} onClick={() => { openProfile(ctxMenu.node); setCtxMenu(null); }}>Open</button>
                <button style={{ width: '100%', textAlign: 'left' }} onClick={() => { editProfile(ctxMenu.node); setCtxMenu(null); }}>Edit</button>
                <button style={{ width: '100%', textAlign: 'left' }} onClick={() => { moveProfileNode(ctxMenu.node); setCtxMenu(null); }}>Move</button>
                <button style={{ width: '100%', textAlign: 'left' }} onClick={async () => { await deleteProfileNode(ctxMenu.node); setCtxMenu(null); }}>Delete</button>
              </>
            )}
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
