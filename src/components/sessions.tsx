import React, { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { addRecent } from '@/store/recents';
import { getRecentSessions, removeRecentSession, clearRecentSessions, getRecentSshSessions, removeRecentSshSession, clearRecentSshSessions } from '@/store/sessions';
import { getLocalProfiles, getSshProfiles, saveLocalProfile, saveSshProfile, deleteLocalProfile, deleteSshProfile, ensureProfilesTree, saveProfilesTree, resolveEffectiveSettings, type LocalProfile, type SshProfileStored, type ProfilesTreeNode } from '@/store/persist';
import { getThemeList, themes } from '@/config/themes';
import { sshConnect, sshDisconnect, sshHomeDir, sshSftpList, onSshUploadProgress, sshSftpMkdirs, sshSftpWrite, sshExec, scanSshKeys, type SshKeyInfo } from '@/types/ipc';
import { ensureHelper } from '@/services/helper';
import { useToasts } from '@/store/toasts';

import type { RecentSession, RecentSshSession } from '@/store/sessions';

// SSH Key Selector Component
function SshKeySelector({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const [sshKeys, setSshKeys] = useState<SshKeyInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Scan for SSH keys when component mounts or dropdown is opened
  const loadSshKeys = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const keys = await scanSshKeys();
      setSshKeys(keys);
    } catch (err) {
      console.error('Failed to scan SSH keys:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSshKeys();
  }, []);

  const handleBrowse = async () => {
    try {
      const home = await homeDir();
      const selected = await open({
        multiple: false,
        directory: false,
        defaultPath: `${home}/.ssh`,
        title: 'Select SSH Private Key',
      });
      
      if (selected && typeof selected === 'string') {
        onChange(selected);
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err);
    }
  };

  return (
    <div>
      <label>Key Path</label>
      <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            style={{ width: '100%' }}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="~/.ssh/id_ed25519"
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          />
          {showDropdown && sshKeys.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: '#1e1e1e',
              border: '1px solid #444',
              borderTop: 'none',
              maxHeight: 200,
              overflowY: 'auto',
              zIndex: 1000,
            }}>
              {sshKeys.map((key) => (
                <div
                  key={key.path}
                  style={{
                    padding: '6px 8px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid #333',
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(key.path);
                    setShowDropdown(false);
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#2a2a2a';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span style={{ fontSize: 13 }}>{key.name}</span>
                  <span style={{ fontSize: 11, color: '#888' }}>{key.key_type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleBrowse}
          style={{
            padding: '4px 12px',
            background: '#2a2a2a',
            border: '1px solid #444',
            borderRadius: 4,
            cursor: 'pointer',
          }}
          title="Browse for key file"
        >
          Browse...
        </button>
      </div>
      {sshKeys.length > 0 && !showDropdown && (
        <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
          {sshKeys.length} key{sshKeys.length !== 1 ? 's' : ''} found in ~/.ssh
        </div>
      )}
    </div>
  );
}

type Props = {
  onOpenFolder: (arg: string | { path: string; terminal?: any; shell?: any }) => void;
  onOpenSession?: (session: RecentSession) => void;
  onOpenSsh?: (opts: { host: string; port?: number; user: string; auth: { password?: string; keyPath?: string; passphrase?: string; agent?: boolean }; cwd?: string; profileId?: string; profileName?: string; os?: string }) => void;
};

export default function Welcome({ onOpenFolder, onOpenSession, onOpenSsh }: Props) {
  const { show, update, dismiss } = useToasts();
  const [recentSessions, setRecentSessions] = useState<{ cwd: string; closedAt: number; panes?: number }[]>([]);
  const [recentSsh, setRecentSsh] = useState<RecentSshSession[]>([]);
  const [tree, setTree] = useState<ProfilesTreeNode | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<null | { x: number; y: number; type: 'folder' | 'profile'; node: any }>(null);
  const [folderDialog, setFolderDialog] = useState<null | { parentId: string; name: string }>(null);
  const [moveDialog, setMoveDialog] = useState<null | { node: Extract<ProfilesTreeNode, { type: 'profile' }>; destId: string | null }>(null);
  const [folderActiveTab, setFolderActiveTab] = useState<'environment' | 'forwarding' | 'terminal' | 'ssh'>('environment');
  const [folderSettingsDialog, setFolderSettingsDialog] = useState<null | { folderId: string; form: { 
    envVars?: Array<{ key: string; value: string }>;
    initCommands?: string[];
    shellOverride?: string;
    // Terminal
    theme?: string;
    fontSize?: number;
    fontFamily?: string;
    // SSH
    defaultForwards?: Array<{ type: 'L' | 'R'; srcHost: string; srcPort: number; dstHost: string; dstPort: number }>;
    sshHost?: string;
    sshPort?: number;
    sshUser?: string;
    sshAuthType?: 'agent' | 'password' | 'key';
    sshPassword?: string;
    sshKeyPath?: string;
    sshPassphrase?: string;
  } }>(null);
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
    // OS detection
    os?: string;
  }>({ name: '', host: '', user: '', authType: 'agent', os: 'auto-detect' });
  // Inheritance helpers for SSH modal
  const [spInherit, setSpInherit] = useState<{ theme?: boolean; fontSize?: boolean; fontFamily?: boolean; sshUser?: boolean; sshAuth?: boolean }>({});
  const [inheritedForSsh, setInheritedForSsh] = useState<ResolvedSettings | null>(null);
  const [inheritContextNodeId, setInheritContextNodeId] = useState<string | null>(null);
  const [inheritContextFolderId, setInheritContextFolderId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'basic' | 'environment' | 'forwarding' | 'terminal'>('basic');
  const [browse, setBrowse] = useState<{ sessionId: string; cwd: string; entries: { name: string; path: string; is_dir: boolean }[] } | null>(null);
  // Global search state
  const [search, setSearch] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  
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

  // Build a flat list of profile nodes from the tree
  function flattenProfiles(node: ProfilesTreeNode | null): Array<Extract<ProfilesTreeNode, { type: 'profile' }>> {
    const out: Array<Extract<ProfilesTreeNode, { type: 'profile' }>> = [];
    function walk(n: ProfilesTreeNode) {
      if (n.type === 'profile') out.push(n as any);
      else n.children.forEach(walk);
    }
    if (node) walk(node);
    return out;
  }

  type SearchItem =
    | { kind: 'profile'; node: Extract<ProfilesTreeNode, { type: 'profile' }>; label: string; aux?: string; icon: string }
    | { kind: 'recent-local'; s: { cwd: string; closedAt: number; panes?: number; title?: string; layoutShape?: any }; label: string; icon: string }
    | { kind: 'recent-ssh'; s: RecentSshSession; label: string; icon: string };

  const searchResults = React.useMemo<SearchItem[]>(() => {
    const q = (search || '').trim().toLowerCase();
    if (!q) return [];
    const items: SearchItem[] = [];
    // Profiles
    for (const n of flattenProfiles(tree)) {
      const label = profileLabel(n);
      const icon = iconFor(n);
      if (!label) continue;
      if (label.toLowerCase().includes(q)) items.push({ kind: 'profile', node: n, label, icon });
    }
    // Recents (locals + ssh)
    for (const s of recentSessions) {
      const label = s.cwd;
      if (label.toLowerCase().includes(q)) items.push({ kind: 'recent-local', s, label, icon: '\uf07c' }); // folder-open icon
    }
    for (const s of recentSsh) {
      const text = s.path + (s.user && s.host ? ` [${s.user}@${s.host}]` : '');
      if (text.toLowerCase().includes(q)) items.push({ kind: 'recent-ssh', s, label: text, icon: '\uf0c1' });
    }
    // Limit
    return items.slice(0, 30);
  }, [search, tree, recentSessions, recentSsh, localProfiles, sshProfiles]);

  function openSearchItem(it: SearchItem) {
    if (it.kind === 'profile') {
      openProfile(it.node);
      setSearch('');
      setSearchActive(false);
      return;
    }
    if (it.kind === 'recent-local') {
      if (onOpenSession) onOpenSession(it.s);
      else onOpenFolder(it.s.cwd);
      setSearch(''); setSearchActive(false);
      return;
    }
    // recent-ssh
    (async () => {
      const r = it.s;
      if (r.profileId) {
        const pAll = await getSshProfiles();
        const p = pAll.find((x) => x.id === r.profileId);
        if (p) {
          // Resolve effective settings from tree if possible
          let term = p.terminal, shell = p.shell, advanced = p.advanced, ssh: any = { host: p.host, port: p.port, user: p.user, auth: p.auth };
          try {
            const t = tree ?? (await ensureProfilesTree());
            function findNode(n: ProfilesTreeNode, kind: 'ssh'|'local', id: string): Extract<ProfilesTreeNode, { type: 'profile' }> | null {
              if (n.type === 'profile' && n.ref.kind === kind && n.ref.id === id) return n as any;
              if (n.type === 'folder') { for (const c of n.children) { const f = findNode(c, kind, id); if (f) return f; } }
              return null;
            }
            const node = t ? findNode(t, 'ssh', p.id) : null;
            if (node) {
              const eff = resolveEffectiveSettings({ root: t, nodeId: node.id, profileKind: 'ssh', profileSettings: { terminal: p.terminal, shell: p.shell, advanced: p.advanced, ssh: { host: p.host, port: p.port, user: p.user, auth: p.auth } } });
              term = eff.terminal; shell = eff.shell; advanced = eff.advanced; ssh = eff.ssh ? { ...ssh, ...eff.ssh } : ssh;
            }
          } catch {}
          onOpenSsh?.({ host: ssh.host, port: ssh.port, user: ssh.user, auth: ssh.auth || { agent: true }, cwd: r.path, profileId: p.id, profileName: p.name, terminal: term, shell, advanced, os: p.os });
        }
      } else if (r.user && r.host) {
        onOpenSsh?.({ host: r.host, port: (r as any).port ?? 22, user: r.user, auth: { agent: true } as any, cwd: r.path });
      }
      setSearch(''); setSearchActive(false);
    })();
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
  function addProfileNode(root: ProfilesTreeNode, kind: 'local' | 'ssh', id: string, destFolderId?: string | null) {
    function findFolder(node: ProfilesTreeNode, fid: string): (ProfilesTreeNode & { type: 'folder' }) | null {
      if (node.type === 'folder') {
        if (node.id === fid) return node as any;
        for (const c of node.children) { const f = findFolder(c, fid); if (f) return f; }
      }
      return null;
    }
    if (root.type !== 'folder') return;
    const node: any = { id: `${kind}-${id}`, type: 'profile', ref: { kind, id } };
    if (destFolderId) {
      const dest = findFolder(root, destFolderId);
      if (dest) { (dest as any).children.push(node); return; }
    }
    (root as any).children.push(node);
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
  function iconFor(n: ProfilesTreeNode): string { 
    if (n.type === 'folder') return '\uf07b'; // Nerd Font folder icon
    if (n.ref.kind === 'local') return '\uf108'; // Nerd Font terminal/computer icon
    
    // For SSH profiles, use OS-specific icons
    const profile = sshProfiles.find((x) => x.id === n.ref.id);
    if (!profile) return '\uf0c1'; // Nerd Font link/chain icon for SSH
    
    // Map OS to Nerd Font icons using Unicode code points
    const os = profile.os || 'auto-detect';
    switch (os) {
      case 'linux':
      case 'linux-ubuntu': return '\uf31b'; // Ubuntu logo
      case 'linux-debian': return '\uf306'; // Debian logo
      case 'linux-fedora': return '\uf30a'; // Fedora logo
      case 'linux-rhel':
      case 'linux-redhat': return '\uf316'; // Red Hat logo
      case 'linux-centos': return '\uf304'; // CentOS logo
      case 'linux-arch': return '\uf303'; // Arch Linux logo
      case 'linux-alpine': return '\uf300'; // Alpine logo
      case 'linux-opensuse':
      case 'linux-suse': return '\uf314'; // SUSE logo
      case 'macos': return '\uf179'; // Apple logo
      case 'windows': return '\uf17a'; // Windows logo
      case 'freebsd': return '\uf30c'; // FreeBSD logo
      case 'auto-detect': return '\uf233'; // Generic server icon
      default: 
        // Generic Linux for any linux-* not specifically handled
        if (os.startsWith('linux-')) return '\uf17c'; // Generic Linux logo
        return '\uf233'; // Generic server icon
    }
  }
  function openProfile(n: Extract<ProfilesTreeNode, { type: 'profile' }>) {
    if (n.ref.kind === 'local') {
      const p = localProfiles.find((x) => x.id === n.ref.id);
      if (p && p.path) {
        try {
          const effective = resolveEffectiveSettings({ root: tree, nodeId: n.id, profileKind: 'local', profileSettings: { terminal: p.terminal, shell: p.shell } });
          const arg: any = { path: p.path };
          if (effective.shell) arg.shell = effective.shell;
          if (effective.terminal) arg.terminal = effective.terminal;
          onOpenFolder(arg);
        } catch (err) {
          console.error('Failed to resolve effective settings for local profile:', err);
          // Fallback: open without inheritance
          onOpenFolder({ path: p.path, terminal: p.terminal, shell: p.shell });
        }
      } else if (p) {
        alert('Local profile has no path configured');
      } else {
        console.error('Local profile not found:', n.ref.id);
        alert('Profile not found. It may be encrypted and requires unlocking.');
      }
    } else {
      const p = sshProfiles.find((x) => x.id === n.ref.id);
      if (p && onOpenSsh) {
        try {
          const effective = resolveEffectiveSettings({ root: tree, nodeId: n.id, profileKind: 'ssh', profileSettings: { terminal: p.terminal, shell: p.shell, advanced: p.advanced, ssh: { host: p.host, port: p.port, user: p.user, auth: p.auth } } });
          onOpenSsh({ 
            host: effective.ssh?.host ?? p.host,
            port: effective.ssh?.port ?? p.port,
            user: effective.ssh?.user ?? p.user,
            auth: effective.ssh?.auth ?? (p.auth || { agent: true }),
            cwd: p.path, 
            profileId: p.id,
            profileName: p.name,
            terminal: effective.terminal, 
            shell: effective.shell, 
            advanced: effective.advanced, 
            os: p.os
          } as any);
        } catch (err) {
          console.error('Failed to resolve effective settings for SSH profile:', err);
          // Fallback: open without inheritance
          onOpenSsh({ 
            host: p.host,
            port: p.port,
            user: p.user,
            auth: p.auth || { agent: true },
            cwd: p.path, 
            profileId: p.id,
            profileName: p.name,
            terminal: p.terminal, 
            shell: p.shell, 
            advanced: p.advanced, 
            os: p.os
          } as any);
        }
      } else if (!p) {
        console.error('SSH profile not found:', n.ref.id);
        alert('Profile not found. It may be encrypted and requires unlocking.');
      }
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
        setSpForm({ id: p.id, name: p.name, host: p.host, port: p.port, user: p.user, authType: authType as any, password: p.auth?.password, keyPath: p.auth?.keyPath, passphrase: p.auth?.passphrase, path: p.path, envVars: p.shell?.env ? Object.entries(p.shell.env).map(([key, value]) => ({ key, value: value as string })) : undefined, initCommands: p.shell?.initCommands, shellOverride: p.shell?.shell, defaultForwards: p.advanced?.defaultForwards, theme: p.terminal?.theme, fontSize: p.terminal?.fontSize, fontFamily: p.terminal?.fontFamily, os: p.os || 'auto-detect' });
        try {
          if (tree) {
            const eff = resolveEffectiveSettings({ root: tree, nodeId: n.id, profileKind: 'ssh' });
            setInheritedForSsh(eff);
            setSpInherit({ 
              theme: !!eff.terminal?.theme && typeof p.terminal?.theme === 'undefined',
              fontSize: typeof eff.terminal?.fontSize !== 'undefined' && typeof p.terminal?.fontSize === 'undefined',
              fontFamily: !!eff.terminal?.fontFamily && typeof p.terminal?.fontFamily === 'undefined',
              sshUser: !!eff.ssh?.user && !p.user,
              sshAuth: !!eff.ssh?.auth && !p.auth,
            });
            setInheritContextNodeId(n.id);
            setInheritContextFolderId(null);
          } else { setInheritedForSsh(null); setSpInherit({}); setInheritContextNodeId(null); setInheritContextFolderId(null); }
        } catch { setInheritedForSsh(null); setSpInherit({}); setInheritContextNodeId(null); setInheritContextFolderId(null); }
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
    const loadData = async () => {
      try {
        setRecentSessions(await getRecentSessions());
        setRecentSsh(await getRecentSshSessions());
        const localProfs = await getLocalProfiles();
        const sshProfs = await getSshProfiles();
        setLocalProfiles(localProfs);
        setSshProfiles(sshProfs);
        
        // Check if profiles loaded successfully
        if (localProfs.length === 0 && sshProfs.length === 0) {
          console.warn('No profiles loaded - may need to unlock encryption');
        }
        
        const root = await ensureProfilesTree();
        setTree(root);
        setCurrentFolderId(root.id);
      } catch (err) {
        console.error('Failed to load session data:', err);
        // Still try to load what we can
        try {
          setRecentSessions(await getRecentSessions());
          setRecentSsh(await getRecentSshSessions());
        } catch {}
      }
    };
    
    loadData();
    
    // Listen for profiles unlocked event
    const handleProfilesUnlocked = () => {
      console.log('Profiles unlocked, reloading...');
      loadData();
    };
    window.addEventListener('profiles-unlocked', handleProfilesUnlocked);
    
    // Refresh profiles periodically to catch external updates (e.g., OS detection)
    const interval = setInterval(async () => {
      setSshProfiles(await getSshProfiles());
    }, 5000); // Check every 5 seconds
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('profiles-unlocked', handleProfilesUnlocked);
    };
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
          {/* Global search */}
          <div style={{ margin: '12px 0' }}>
            <input
              placeholder="Search profiles and recent sessions…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSearchIndex(0); setSearchActive(true); }}
              onFocus={() => setSearchActive(true)}
              onKeyDown={(e) => {
                if (!searchResults.length) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); setSearchIndex((i) => Math.min(i + 1, searchResults.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchIndex((i) => Math.max(i - 1, 0)); }
                else if (e.key === 'Enter') { e.preventDefault(); openSearchItem(searchResults[searchIndex]); }
                else if (e.key === 'Escape') { setSearch(''); setSearchActive(false); }
              }}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #333', background: '#1b1b1b', color: '#eee' }}
            />
            {searchActive && search && searchResults.length > 0 && (
              <div style={{ marginTop: 6, border: '1px solid #333', borderRadius: 6, maxHeight: 260, overflow: 'auto' }}>
                {searchResults.map((it, i) => (
                  <div
                    key={(it as any).label + ':' + i}
                    onMouseDown={(e) => { e.preventDefault(); openSearchItem(it); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: i === searchIndex ? '#2a2a2a' : 'transparent', cursor: 'pointer' }}
                  >
                    <span className="nf-icon" style={{ width: 18 }}>{it.icon}</span>
                    <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
                    <span style={{ fontSize: 11, color: '#888' }}>{it.kind === 'profile' ? 'Profile' : it.kind === 'recent-local' ? 'Recent' : 'SSH'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p>Start a local terminal in your home or a specific folder.</p>
          <div style={{ margin: '16px 0', display: 'flex', gap: 12 }}>
            <button 
              onClick={handleHome}
              style={{
                padding: '8px 16px',
                backgroundColor: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#059669'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#10b981'}
            >Start in Home Folder</button>
            <button 
              onClick={handlePick}
              style={{
                padding: '8px 16px',
                backgroundColor: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#059669'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#10b981'}
            >Start in Specific Folder…</button>
            <button 
              onClick={() => setSshOpen(true)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#059669'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#10b981'}
            >Open SSH Session…</button>
          </div>

          {/* Profiles tree */}
          <div style={{ marginTop: 24 }}>
            <h2>Profiles</h2>
            <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center' }}>
              <button 
                onClick={() => { setLpForm({ name: '', path: '' }); setLpOpen(true); }}
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'transparent',
                  color: '#10b981',
                  border: '1px solid #10b981',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#10b981'; e.currentTarget.style.color = 'white'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#10b981'; }}
              >New Local Profile</button>
              <button 
                onClick={async () => { 
                setSpForm({ name: '', host: '', user: '', authType: 'agent', os: 'auto-detect' });
                try {
                  if (tree && currentFolderId) {
                    const eff = resolveEffectiveSettings({ root: tree, nodeId: currentFolderId, profileKind: 'ssh' });
                    setInheritedForSsh(eff);
                    setSpInherit({ 
                      theme: !!eff.terminal?.theme,
                      fontSize: typeof eff.terminal?.fontSize !== 'undefined',
                      fontFamily: !!eff.terminal?.fontFamily,
                      sshUser: !!eff.ssh?.user,
                      sshAuth: !!eff.ssh?.auth,
                    });
                    setInheritContextFolderId(currentFolderId);
                    setInheritContextNodeId(null);
                  } else { setInheritedForSsh(null); setSpInherit({}); setInheritContextFolderId(null); setInheritContextNodeId(null); }
                } catch { setInheritedForSsh(null); setSpInherit({}); setInheritContextFolderId(null); setInheritContextNodeId(null); }
                setSpOpen(true);
              }}
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'transparent',
                  color: '#10b981',
                  border: '1px solid #10b981',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#10b981'; e.currentTarget.style.color = 'white'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#10b981'; }}
              >New SSH Profile</button>
              <span style={{ flex: 1 }} />
              <button 
                onClick={() => {
                if (!tree || !currentFolderId) return;
                setFolderDialog({ parentId: currentFolderId, name: '' });
              }}
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'transparent',
                  color: '#10b981',
                  border: '1px solid #10b981',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#10b981'; e.currentTarget.style.color = 'white'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#10b981'; }}
              >+ Folder</button>
            </div>
            <div style={{ border: '1px solid #333', borderRadius: 6, padding: 12 }}>
              {tree && currentFolderId ? (
                <>
                  {/* Breadcrumbs */}
                  <div style={{ marginBottom: 8, fontSize: 13, color: '#bbb' }}>
                    {breadcrumbs(tree, currentFolderId).map((seg, i, arr) => (
                      <span key={seg.id}>
                        <a href="#" onClick={(e) => { e.preventDefault(); setCurrentFolderId(seg.id); }} style={{ color: '#10b981', textDecoration: 'none' }}>{seg.name}</a>
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
                            style={{ position: 'relative', border: '1px solid #333', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'default' }}
                          >
                            {/* Folder icon */}
                            <div className="nf-icon" style={{ fontSize: 28 }}>{'\uf07b'}</div>
                            <div style={{ fontSize: 12, textAlign: 'center', wordBreak: 'break-word' }}>{n.name}</div>
                            {/* Overrides indicator: tiny gear at top-right when settings exist */}
                            {Boolean((n as any).settings) && (
                              <div title="Has overrides" style={{ position: 'absolute', top: 6, right: 6, fontSize: 12, color: '#cbd5e1' }}>⚙</div>
                            )}
                          </div>
                        ) : (
                          <div
                            key={n.id}
                            onDoubleClick={() => openProfile(n)}
                            onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, type: 'profile', node: n }); }}
                            style={{ border: '1px solid #333', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'default' }}
                          >
                            <div className="nf-icon" style={{ fontSize: 28 }}>{iconFor(n)}</div>
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
                  style={{
                    padding: '2px 8px',
                    backgroundColor: 'transparent',
                    color: '#9ca3af',
                    border: '1px solid #4b5563',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#4b5563'; e.currentTarget.style.color = '#9ca3af'; }}
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
                          style={{
                            color: '#10b981',
                            textDecoration: 'none',
                            transition: 'color 0.2s',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = '#34d399'}
                          onMouseLeave={(e) => e.currentTarget.style.color = '#10b981'}
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
                          style={{
                            color: '#10b981',
                            textDecoration: 'none',
                            transition: 'color 0.2s',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = '#34d399'}
                          onMouseLeave={(e) => e.currentTarget.style.color = '#10b981'}
                          onClick={(e) => {
                            e.preventDefault();
                            (async () => {
                              const all = await getSshProfiles();
                              const p = r.s.profileId ? all.find((x) => x.id === r.s.profileId) : undefined;
                              if (p) {
                                // Try to resolve effective settings from the first occurrence in the tree
                                let term = p.terminal, shell = p.shell, advanced = p.advanced, ssh: any = { host: p.host, port: p.port, user: p.user, auth: p.auth };
                                try {
                                  const t = tree ?? (await ensureProfilesTree());
                                  // Find first tree node referencing this profile
                                  function findNode(n: ProfilesTreeNode, kind: 'ssh'|'local', id: string): Extract<ProfilesTreeNode, { type: 'profile' }> | null {
                                    if (n.type === 'profile' && n.ref.kind === kind && n.ref.id === id) return n as any;
                                    if (n.type === 'folder') {
                                      for (const c of n.children) { const f = findNode(c, kind, id); if (f) return f; }
                                    }
                                    return null;
                                  }
                                  const node = t ? findNode(t, 'ssh', p.id) : null;
                                  if (node) {
                                    const eff = resolveEffectiveSettings({ root: t, nodeId: node.id, profileKind: 'ssh', profileSettings: { terminal: p.terminal, shell: p.shell, advanced: p.advanced, ssh: { host: p.host, port: p.port, user: p.user, auth: p.auth } } });
                                    term = eff.terminal; shell = eff.shell; advanced = eff.advanced; ssh = eff.ssh ? { ...ssh, ...eff.ssh } : ssh;
                                  }
                                } catch {}
                                onOpenSsh?.({ host: ssh.host, port: ssh.port, user: ssh.user, auth: ssh.auth || { agent: true }, cwd: r.s.path, profileId: p.id, profileName: p.name, terminal: term, shell, advanced, os: p.os });
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
                  <SshKeySelector
                    value={sshForm.keyPath ?? ''}
                    onChange={(keyPath) => setSshForm((s) => ({ ...s, keyPath }))}
                  />
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
                if (!lpForm.path || lpForm.path.trim() === '') {
                  alert('Path is required for local profile');
                  return;
                }
                if (!lpForm.id) lpForm.id = crypto.randomUUID(); 
                await saveLocalProfile(lpForm as any); 
                setLocalProfiles(await getLocalProfiles()); 
                if (tree && !hasProfileNode(tree, 'local', lpForm.id)) {
                  const dest = currentFolderId;
                  updateTree((root) => addProfileNode(root, 'local', lpForm.id!, dest));
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
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ flex: 1 }}>User
                        <input 
                          style={{ width: '100%' }}
                          value={spForm.user}
                          onChange={(e) => setSpForm({ ...spForm, user: e.target.value })}
                          placeholder={inheritedForSsh?.ssh?.user ? `(inherits: ${inheritedForSsh.ssh.user})` : 'root'}
                          disabled={!!spInherit.sshUser}
                        />
                      </label>
                      {inheritedForSsh?.ssh?.user && (
                        <label style={{ fontSize: 12 }}>
                          <input type="checkbox" checked={!!spInherit.sshUser} onChange={(e) => {
                            const on = e.target.checked; 
                            setSpInherit({ ...spInherit, sshUser: on });
                            if (!on && inheritedForSsh?.ssh?.user) setSpForm({ ...spForm, user: inheritedForSsh.ssh.user });
                          }} /> Inherit
                        </label>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div>
                        <label style={{ marginRight: 8 }}><input type="radio" disabled={!!spInherit.sshAuth} checked={spForm.authType === 'agent'} onChange={() => setSpForm({ ...spForm, authType: 'agent' })} /> SSH Agent</label>
                        <label style={{ marginRight: 8 }}><input type="radio" disabled={!!spInherit.sshAuth} checked={spForm.authType === 'password'} onChange={() => setSpForm({ ...spForm, authType: 'password' })} /> Password</label>
                        <label><input type="radio" disabled={!!spInherit.sshAuth} checked={spForm.authType === 'key'} onChange={() => setSpForm({ ...spForm, authType: 'key' })} /> Key File</label>
                      </div>
                      {inheritedForSsh?.ssh?.auth && (
                        <label style={{ fontSize: 12 }}>
                          <input type="checkbox" checked={!!spInherit.sshAuth} onChange={(e) => {
                            const on = e.target.checked;
                            setSpInherit({ ...spInherit, sshAuth: on });
                            if (!on) {
                              // Prefill auth type from inherited
                              const inh = inheritedForSsh.ssh.auth;
                              if (inh?.agent) setSpForm({ ...spForm, authType: 'agent', password: undefined, keyPath: undefined, passphrase: undefined });
                              else if (inh?.password) setSpForm({ ...spForm, authType: 'password', password: inh.password });
                              else if (inh?.keyPath) setSpForm({ ...spForm, authType: 'key', keyPath: inh.keyPath, passphrase: inh.passphrase });
                            }
                          }} /> Inherit
                        </label>
                      )}
                    </div>
                  </div>
                  {spForm.authType === 'password' && (<label>Password<input style={{ width: '100%' }} type="password" value={spForm.password ?? ''} disabled={!!spInherit.sshAuth} onChange={(e) => setSpForm({ ...spForm, password: e.target.value })} /></label>)}
                  {spForm.authType === 'key' && (
                    <>
                      {!spInherit.sshAuth ? (
                        <SshKeySelector
                          value={spForm.keyPath ?? ''}
                          onChange={(keyPath) => setSpForm({ ...spForm, keyPath })}
                        />
                      ) : (
                        <label>
                          Key Path
                          <input style={{ width: '100%' }} value={spForm.keyPath ?? ''} disabled={true} placeholder="~/.ssh/id_ed25519" />
                        </label>
                      )}
                      <label>
                        Passphrase
                        <input style={{ width: '100%' }} type="password" value={spForm.passphrase ?? ''} disabled={!!spInherit.sshAuth} onChange={(e) => setSpForm({ ...spForm, passphrase: e.target.value })} />
                      </label>
                    </>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <label style={{ flex: 1 }}>Remote Path<input style={{ width: '100%' }} value={spForm.path ?? ''} onChange={(e) => setSpForm({ ...spForm, path: e.target.value })} placeholder="/home/user" /></label>
                    <button onClick={async () => {
                      try {
                        const { sshConnectWithTrustPrompt } = await import('@/types/ipc');
                        const effHost = spForm.host || inheritedForSsh?.ssh?.host || '';
                        const effPort = spForm.port ?? inheritedForSsh?.ssh?.port ?? 22;
                        const effUser = spInherit.sshUser ? (inheritedForSsh?.ssh?.user || spForm.user) : spForm.user;
                        let effAuth: any;
                        if (spInherit.sshAuth && inheritedForSsh?.ssh?.auth) {
                          const a = inheritedForSsh.ssh.auth;
                          if (a.agent) effAuth = { agent: true };
                          else if (a.password) effAuth = { password: a.password };
                          else if (a.keyPath) effAuth = { key_path: a.keyPath, passphrase: a.passphrase };
                        } else {
                          effAuth = spForm.authType === 'agent' ? { agent: true } : spForm.authType === 'password' ? { password: spForm.password } : { key_path: spForm.keyPath, passphrase: spForm.passphrase };
                        }
                        if (!effHost || !effUser) { alert('Host and user are required'); return; }
                        const sessionId = await sshConnectWithTrustPrompt({ host: effHost, port: effPort, user: effUser, auth: effAuth, timeout_ms: 15000 });
                        const home = await sshHomeDir(sessionId);
                        const start = spForm.path || home;
                        const entries = await sshSftpList(sessionId, start);
                        setBrowse({ sessionId, cwd: start, entries });
                      } catch (e) { alert('SSH browse failed: ' + (e as any)); }
                    }}>Browse…</button>
                  </div>
                  <label>
                    Operating System
                    <select 
                      style={{ width: '100%' }} 
                      value={spForm.os || 'auto-detect'} 
                      onChange={(e) => setSpForm({ ...spForm, os: e.target.value })}
                    >
                      <option value="auto-detect">Auto-detect</option>
                      <option value="linux">Linux (Generic)</option>
                      <option value="linux-ubuntu">Ubuntu</option>
                      <option value="linux-debian">Debian</option>
                      <option value="linux-rhel">Red Hat Enterprise Linux</option>
                      <option value="linux-centos">CentOS</option>
                      <option value="linux-fedora">Fedora</option>
                      <option value="linux-arch">Arch Linux</option>
                      <option value="linux-alpine">Alpine Linux</option>
                      <option value="linux-opensuse">openSUSE</option>
                      <option value="macos">macOS</option>
                      <option value="freebsd">FreeBSD</option>
                      <option value="windows">Windows</option>
                      <option value="openbsd">OpenBSD</option>
                      <option value="netbsd">NetBSD</option>
                    </select>
                  </label>
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
                  {/* Theme Selector with Inherit */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ flex: 1 }}>Theme
                        <select 
                          style={{ width: '100%' }} 
                          value={spForm.theme || (inheritedForSsh?.terminal?.theme ? inheritedForSsh.terminal.theme : 'default')} 
                          onChange={(e) => setSpForm({ ...spForm, theme: e.target.value })}
                          disabled={!!spInherit.theme}
                        >
                          {getThemeList().map(theme => (
                            <option key={theme.key} value={theme.key}>
                              {theme.name} {theme.dark ? '(dark)' : '(light)'}
                            </option>
                          ))}
                        </select>
                      </label>
                      {inheritedForSsh?.terminal?.theme && (
                        <label style={{ fontSize: 12 }}>
                          <input type="checkbox" checked={!!spInherit.theme} onChange={(e) => {
                            const on = e.target.checked;
                            setSpInherit({ ...spInherit, theme: on });
                            if (!on && inheritedForSsh?.terminal?.theme) setSpForm({ ...spForm, theme: inheritedForSsh.terminal.theme });
                          }} /> Inherit
                        </label>
                      )}
                    </div>
                  </div>
                  
                  {/* Font Size with Inherit */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ flex: 1 }}>Font Size
                        <input 
                          type="number" 
                          style={{ width: '100%' }} 
                          value={spForm.fontSize || inheritedForSsh?.terminal?.fontSize || 14} 
                          onChange={(e) => setSpForm({ ...spForm, fontSize: Number(e.target.value) || undefined })}
                          min="8"
                          max="32"
                          placeholder="14"
                          disabled={!!spInherit.fontSize}
                        />
                      </label>
                      {typeof inheritedForSsh?.terminal?.fontSize !== 'undefined' && (
                        <label style={{ fontSize: 12 }}>
                          <input type="checkbox" checked={!!spInherit.fontSize} onChange={(e) => {
                            const on = e.target.checked; setSpInherit({ ...spInherit, fontSize: on });
                            if (!on && typeof inheritedForSsh?.terminal?.fontSize !== 'undefined') setSpForm({ ...spForm, fontSize: inheritedForSsh.terminal.fontSize });
                          }} /> Inherit
                        </label>
                      )}
                    </div>
                  </div>
                  
                  {/* Font Family with Inherit */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ flex: 1 }}>Font Family
                        <input 
                          style={{ width: '100%' }} 
                          value={spForm.fontFamily || inheritedForSsh?.terminal?.fontFamily || ''} 
                          onChange={(e) => setSpForm({ ...spForm, fontFamily: e.target.value || undefined })}
                          placeholder="'Cascadia Code', 'Fira Code', monospace"
                          disabled={!!spInherit.fontFamily}
                        />
                      </label>
                      {inheritedForSsh?.terminal?.fontFamily && (
                        <label style={{ fontSize: 12 }}>
                          <input type="checkbox" checked={!!spInherit.fontFamily} onChange={(e) => {
                            const on = e.target.checked; setSpInherit({ ...spInherit, fontFamily: on });
                            if (!on && inheritedForSsh?.terminal?.fontFamily) setSpForm({ ...spForm, fontFamily: inheritedForSsh.terminal.fontFamily });
                          }} /> Inherit
                        </label>
                      )}
                    </div>
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
                  const profile: any = { id: spForm.id!, name: spForm.name, host: spForm.host, port: spForm.port, path: spForm.path };
                  // Only set user/auth if not inheriting
                  if (!spInherit.sshUser) profile.user = spForm.user;
                  if (!spInherit.sshAuth) profile.auth = spForm.authType === 'agent' ? { agent: true } : spForm.authType === 'password' ? { password: spForm.password } : { keyPath: spForm.keyPath, passphrase: spForm.passphrase };
                  
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
                  
                  // Add terminal settings only for fields not inheriting
                  const term: any = {};
                  if (!spInherit.theme && spForm.theme) term.theme = spForm.theme;
                  if (!spInherit.fontSize && spForm.fontSize) term.fontSize = spForm.fontSize;
                  if (!spInherit.fontFamily && spForm.fontFamily) term.fontFamily = spForm.fontFamily;
                  if (Object.keys(term).length) profile.terminal = term;
                  
                  // Add OS field if not auto-detect
                  if (spForm.os && spForm.os !== 'auto-detect') {
                    profile.os = spForm.os;
                  }
                  
                  await saveSshProfile(profile);
                  setSshProfiles(await getSshProfiles());
                  if (tree && !hasProfileNode(tree, 'ssh', spForm.id!)) {
                    const dest = inheritContextFolderId || currentFolderId;
                    updateTree((root) => addProfileNode(root, 'ssh', spForm.id!, dest));
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
                <button style={{ width: '100%', textAlign: 'left' }} onClick={() => {
                  const f = tree ? findFolder(tree, ctxMenu.node.id) : null;
                  if (!f) return;
                  const settings = (f as any).settings || {};
                  const form: any = {};
                  if (settings.shell?.env) form.envVars = Object.entries(settings.shell.env).map(([key, value]: any) => ({ key, value }));
                  if (settings.shell?.initCommands) form.initCommands = settings.shell.initCommands.slice();
                  if (settings.shell?.shell) form.shellOverride = settings.shell.shell;
                  if (settings.terminal?.theme) form.theme = settings.terminal.theme;
                  if (settings.terminal?.fontSize) form.fontSize = settings.terminal.fontSize;
                  if (settings.terminal?.fontFamily) form.fontFamily = settings.terminal.fontFamily;
                  if (settings.ssh?.advanced?.defaultForwards) form.defaultForwards = settings.ssh.advanced.defaultForwards.slice();
                  if (settings.ssh?.user) form.sshUser = settings.ssh.user;
                  if (settings.ssh?.auth) {
                    if (settings.ssh.auth.agent) { form.sshAuthType = 'agent'; }
                    else if (settings.ssh.auth.password) { form.sshAuthType = 'password'; form.sshPassword = settings.ssh.auth.password; }
                    else if (settings.ssh.auth.keyPath) { form.sshAuthType = 'key'; form.sshKeyPath = settings.ssh.auth.keyPath; form.sshPassphrase = settings.ssh.auth.passphrase; }
                  }
                  setFolderSettingsDialog({ folderId: ctxMenu.node.id, form });
                  setCtxMenu(null);
                }}>Edit settings…</button>
                <button style={{ width: '100%', textAlign: 'left' }} onClick={() => { if ((ctxMenu.node.children || []).length) { alert('Folder not empty'); return; } updateTree((root) => { removeNode(root, ctxMenu.node.id); }); setCtxMenu(null); }}>Delete</button>
              </>
            ) : (
              <>
                <button style={{ width: '100%', textAlign: 'left' }} onClick={() => { openProfile(ctxMenu.node); setCtxMenu(null); }}>Open</button>
                <button style={{ width: '100%', textAlign: 'left' }} onClick={() => { editProfile(ctxMenu.node); setCtxMenu(null); }}>Edit</button>
                <button style={{ width: '100%', textAlign: 'left' }} onClick={() => { setMoveDialog({ node: ctxMenu.node, destId: currentFolderId }); setCtxMenu(null); }}>Move</button>
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
      {folderSettingsDialog && (
        <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.45)', zIndex: 999 }}>
          <div style={{ background: '#1e1e1e', color: '#eee', padding: 0, borderRadius: 8, minWidth: 620, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 16px 0', borderBottom: '1px solid #444' }}>
              <h3 style={{ margin: 0 }}>Folder Settings</h3>
              {/* Tabs matching profile modal */}
              <div style={{ display: 'flex', gap: 0, marginTop: 12 }}>
                <button onClick={() => setFolderActiveTab('environment')} style={{ padding: '8px 16px', background: folderActiveTab === 'environment' ? '#333' : 'transparent', border: 'none', borderBottom: folderActiveTab === 'environment' ? '2px solid #0078d4' : '2px solid transparent', color: folderActiveTab === 'environment' ? '#fff' : '#aaa', cursor: 'pointer' }}>Environment</button>
                <button onClick={() => setFolderActiveTab('forwarding')} style={{ padding: '8px 16px', background: folderActiveTab === 'forwarding' ? '#333' : 'transparent', border: 'none', borderBottom: folderActiveTab === 'forwarding' ? '2px solid #0078d4' : '2px solid transparent', color: folderActiveTab === 'forwarding' ? '#fff' : '#aaa', cursor: 'pointer' }}>Forwarding</button>
                <button onClick={() => setFolderActiveTab('terminal')} style={{ padding: '8px 16px', background: folderActiveTab === 'terminal' ? '#333' : 'transparent', border: 'none', borderBottom: folderActiveTab === 'terminal' ? '2px solid #0078d4' : '2px solid transparent', color: folderActiveTab === 'terminal' ? '#fff' : '#aaa', cursor: 'pointer' }}>Terminal</button>
                <button onClick={() => setFolderActiveTab('ssh')} style={{ padding: '8px 16px', background: folderActiveTab === 'ssh' ? '#333' : 'transparent', border: 'none', borderBottom: folderActiveTab === 'ssh' ? '2px solid #0078d4' : '2px solid transparent', color: folderActiveTab === 'ssh' ? '#fff' : '#aaa', cursor: 'pointer' }}>SSH</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {folderActiveTab === 'environment' && (
                <div>
                  <h4 style={{ margin: '8px 0' }}>Environment Variables</h4>
                  {(folderSettingsDialog.form.envVars || []).map((env, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <input value={env.key} onChange={(e) => {
                        const envVars = [...(folderSettingsDialog.form.envVars || [])];
                        envVars[i] = { ...envVars[i], key: e.target.value };
                        setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, envVars } });
                      }} placeholder="KEY" style={{ flex: 1 }} />
                      <input value={env.value} onChange={(e) => {
                        const envVars = [...(folderSettingsDialog.form.envVars || [])];
                        envVars[i] = { ...envVars[i], value: e.target.value };
                        setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, envVars } });
                      }} placeholder="value" style={{ flex: 2 }} />
                      <button onClick={() => {
                        const next = (folderSettingsDialog.form.envVars || []).filter((_, idx) => idx !== i);
                        setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, envVars: next.length ? next : undefined } });
                      }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, envVars: [...(folderSettingsDialog.form.envVars || []), { key: '', value: '' }] } })} style={{ fontSize: 12 }}>+ Add Variable</button>
                  <div style={{ height: 1, background: '#333', margin: '8px 0' }} />
                  <h4 style={{ margin: '8px 0' }}>Init Commands</h4>
                  {(folderSettingsDialog.form.initCommands || []).map((cmd, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <input value={cmd} onChange={(e) => {
                        const initCommands = [...(folderSettingsDialog.form.initCommands || [])];
                        initCommands[i] = e.target.value;
                        setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, initCommands } });
                      }} placeholder="echo Hello" style={{ flex: 1 }} />
                      <button onClick={() => {
                        const next = (folderSettingsDialog.form.initCommands || []).filter((_, idx) => idx !== i);
                        setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, initCommands: next.length ? next : undefined } });
                      }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, initCommands: [...(folderSettingsDialog.form.initCommands || []), '' ] } })} style={{ fontSize: 12 }}>+ Add Command</button>
                  <div style={{ height: 1, background: '#333', margin: '8px 0' }} />
                  <h4 style={{ margin: '8px 0' }}>Shell Override</h4>
                  <input value={folderSettingsDialog.form.shellOverride || ''} onChange={(e) => setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, shellOverride: e.target.value || undefined } })} placeholder="/bin/zsh" style={{ width: '100%' }} />
                </div>
              )}
              {folderActiveTab === 'forwarding' && (
                <div>
                  <h4 style={{ margin: '8px 0' }}>Default Forwards</h4>
                  {(folderSettingsDialog.form.defaultForwards || []).map((fwd, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 80px 1fr 80px auto', gap: 6, marginBottom: 6 }}>
                      <select value={fwd.type} onChange={(e) => {
                        const arr = [...(folderSettingsDialog.form.defaultForwards || [])];
                        arr[i] = { ...arr[i], type: e.target.value as any };
                        setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, defaultForwards: arr } });
                      }}>
                        <option value="L">L</option>
                        <option value="R">R</option>
                      </select>
                      <input value={fwd.srcHost} onChange={(e) => {
                        const arr = [...(folderSettingsDialog.form.defaultForwards || [])];
                        arr[i] = { ...arr[i], srcHost: e.target.value };
                        setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, defaultForwards: arr } });
                      }} placeholder="src host" />
                      <input type="number" value={fwd.srcPort} onChange={(e) => {
                        const arr = [...(folderSettingsDialog.form.defaultForwards || [])];
                        arr[i] = { ...arr[i], srcPort: Number(e.target.value) };
                        setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, defaultForwards: arr } });
                      }} placeholder="src port" />
                      <input value={fwd.dstHost} onChange={(e) => {
                        const arr = [...(folderSettingsDialog.form.defaultForwards || [])];
                        arr[i] = { ...arr[i], dstHost: e.target.value };
                        setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, defaultForwards: arr } });
                      }} placeholder="dst host" />
                      <input type="number" value={fwd.dstPort} onChange={(e) => {
                        const arr = [...(folderSettingsDialog.form.defaultForwards || [])];
                        arr[i] = { ...arr[i], dstPort: Number(e.target.value) };
                        setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, defaultForwards: arr } });
                      }} placeholder="dst port" />
                      <button onClick={() => {
                        const next = (folderSettingsDialog.form.defaultForwards || []).filter((_, idx) => idx !== i);
                        setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, defaultForwards: next.length ? next : undefined } });
                      }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, defaultForwards: [...(folderSettingsDialog.form.defaultForwards || []), { type: 'L', srcHost: '127.0.0.1', srcPort: 3000, dstHost: '127.0.0.1', dstPort: 3000 } ] } })} style={{ fontSize: 12 }}>+ Add Forward</button>
                </div>
              )}
              {folderActiveTab === 'terminal' && (
                <div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ minWidth: 80 }}>Theme</label>
                    <select
                      value={folderSettingsDialog.form.theme || 'default'}
                      onChange={(e) => setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, theme: e.target.value || undefined } })}
                      style={{ flex: 1 }}
                    >
                      {getThemeList().map(theme => (
                        <option key={theme.key} value={theme.key}>
                          {theme.name} {theme.dark ? '(dark)' : '(light)'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <label style={{ minWidth: 80 }}>Font size</label>
                    <input type="number" value={folderSettingsDialog.form.fontSize || 14} onChange={(e) => setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, fontSize: Number(e.target.value) || undefined } })} style={{ width: 100 }} />
                    <label style={{ minWidth: 80 }}>Font family</label>
                    <input value={folderSettingsDialog.form.fontFamily || ''} onChange={(e) => setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, fontFamily: e.target.value || undefined } })} placeholder="Font family" style={{ flex: 1 }} />
                  </div>
                  {/* Preview box reusing theme colors */}
                  <div style={{ border: '1px solid #333', borderRadius: 6, padding: 12, fontFamily: folderSettingsDialog.form.fontFamily || 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: (folderSettingsDialog.form.fontSize || 14) + 'px', background: themes[folderSettingsDialog.form.theme || 'default']?.colors.background || '#1e1e1e', color: themes[folderSettingsDialog.form.theme || 'default']?.colors.foreground || '#cccccc' }}>
                    <div>$ echo "Folder terminal preview"</div>
                    <div style={{ color: themes[folderSettingsDialog.form.theme || 'default']?.colors.green || '#0dbc79' }}>✓ Service mounted</div>
                    <div style={{ color: themes[folderSettingsDialog.form.theme || 'default']?.colors.yellow || '#e5e510' }}>⚠ Warning example</div>
                    <div style={{ color: themes[folderSettingsDialog.form.theme || 'default']?.colors.red || '#cd3131' }}>✗ Error example</div>
                  </div>
                </div>
              )}
              {folderActiveTab === 'ssh' && (
                <div>
                  <div style={{ marginBottom: 8 }}>
                    <label>Username
                      <input 
                        style={{ width: '100%' }} 
                        value={folderSettingsDialog.form.sshUser || ''} 
                        onChange={(e) => setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, sshUser: e.target.value || undefined } })}
                        placeholder="user"
                      />
                    </label>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ marginRight: 8 }}><input type="radio" checked={(folderSettingsDialog.form.sshAuthType || 'agent') === 'agent'} onChange={() => setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, sshAuthType: 'agent', sshPassword: undefined, sshKeyPath: undefined, sshPassphrase: undefined } })} /> SSH Agent</label>
                    <label style={{ marginRight: 8 }}><input type="radio" checked={folderSettingsDialog.form.sshAuthType === 'password'} onChange={() => setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, sshAuthType: 'password', sshKeyPath: undefined, sshPassphrase: undefined } })} /> Password</label>
                    <label><input type="radio" checked={folderSettingsDialog.form.sshAuthType === 'key'} onChange={() => setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, sshAuthType: 'key', sshPassword: undefined } })} /> Key File</label>
                  </div>
                  {folderSettingsDialog.form.sshAuthType === 'password' && (
                    <div style={{ marginBottom: 8 }}>
                      <label>Password
                        <input type="password" style={{ width: '100%' }} value={folderSettingsDialog.form.sshPassword || ''} onChange={(e) => setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, sshPassword: e.target.value || undefined } })} />
                      </label>
                    </div>
                  )}
                  {folderSettingsDialog.form.sshAuthType === 'key' && (
                    <>
                      <div style={{ marginBottom: 8 }}>
                        <SshKeySelector
                          value={folderSettingsDialog.form.sshKeyPath || ''}
                          onChange={(keyPath) => setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, sshKeyPath: keyPath || undefined } })}
                        />
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <label>Passphrase
                          <input type="password" style={{ width: '100%' }} value={folderSettingsDialog.form.sshPassphrase || ''} onChange={(e) => setFolderSettingsDialog({ ...folderSettingsDialog, form: { ...folderSettingsDialog.form, sshPassphrase: e.target.value || undefined } })} />
                        </label>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: 16, borderTop: '1px solid #444' }}>
              <button onClick={() => setFolderSettingsDialog(null)}>Cancel</button>
              <button onClick={() => {
                updateTree((root) => {
                  const findFolder = (node: ProfilesTreeNode, id: string): (ProfilesTreeNode & { type: 'folder' }) | null => {
                    if (node.type === 'folder') {
                      if (node.id === id) return node as any;
                      for (const c of node.children) { const f = findFolder(c, id); if (f) return f; }
                    }
                    return null;
                  };
                  const f = root ? findFolder(root, folderSettingsDialog.folderId) : null;
                  if (!f) return;
                  const form = folderSettingsDialog.form;
                  const settings: any = {};
                  if (form.envVars?.length || form.initCommands?.length || form.shellOverride) {
                    settings.shell = {};
                    if (form.envVars?.length) settings.shell.env = Object.fromEntries(form.envVars.map(v => [v.key, v.value]));
                    if (form.initCommands?.length) settings.shell.initCommands = form.initCommands;
                    if (form.shellOverride) settings.shell.shell = form.shellOverride;
                  }
                  if (form.theme || form.fontSize || form.fontFamily) {
                    settings.terminal = {};
                    if (form.theme) settings.terminal.theme = form.theme;
                    if (form.fontSize) settings.terminal.fontSize = form.fontSize;
                    if (form.fontFamily) settings.terminal.fontFamily = form.fontFamily;
                  }
                  // SSH overrides: connection + forwarding
                  if (form.defaultForwards?.length || form.sshUser || form.sshAuthType) {
                    settings.ssh = settings.ssh || {};
                    if (form.defaultForwards?.length) settings.ssh.advanced = { defaultForwards: form.defaultForwards };
                    if (form.sshUser) settings.ssh.user = form.sshUser;
                    if (form.sshAuthType) {
                      if (form.sshAuthType === 'agent') settings.ssh.auth = { agent: true };
                      if (form.sshAuthType === 'password' && form.sshPassword) settings.ssh.auth = { password: form.sshPassword };
                      if (form.sshAuthType === 'key' && form.sshKeyPath) settings.ssh.auth = { keyPath: form.sshKeyPath, passphrase: form.sshPassphrase };
                    }
                  }
                  if (Object.keys(settings).length) (f as any).settings = settings; else delete (f as any).settings;
                });
                setFolderSettingsDialog(null);
              }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {moveDialog && (
        <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.45)', zIndex: 999 }}>
          <div style={{ background: '#1e1e1e', color: '#eee', padding: 16, borderRadius: 8, minWidth: 420 }}>
            <h3 style={{ marginTop: 0 }}>Move Profile</h3>
            <div style={{ marginBottom: 8, fontSize: 12, color: '#bbb' }}>Select destination folder</div>
            <select style={{ width: '100%' }} value={moveDialog.destId || ''} onChange={(e) => setMoveDialog({ ...moveDialog, destId: e.target.value })}>
              {folderList(tree).map((f) => (
                <option key={f.id} value={f.id}>{f.path}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setMoveDialog(null)}>Cancel</button>
              <button onClick={() => {
                if (!moveDialog.destId || !tree) { setMoveDialog(null); return; }
                updateTree((root) => {
                  removeNode(root, moveDialog.node.id);
                  const dest = (function findF(n: ProfilesTreeNode, id: string): any { if (n.type === 'folder') { if (n.id === id) return n; for (const c of n.children) { const r = findF(c, id); if (r) return r; } } return null; })(root, moveDialog.destId!);
                  if (dest) dest.children.push(moveDialog.node);
                });
                setMoveDialog(null);
              }}>Move</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
