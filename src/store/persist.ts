import { loadState, saveState } from '@/types/ipc';

export type AppPersistState = {
  recents?: { path: string; lastOpenedAt: number }[];
  recentSessions?: { cwd: string; closedAt: number; panes?: number }[];
  recentSshSessions?: { profileId: string; path: string; closedAt: number; panes?: number; title?: string; layoutShape?: any }[];
  lastOpenedPath?: string | null;
  workspace?: {
    activeTabIndex?: number;
    tabs?: { cwd: string; title?: string; layoutShape?: any }[];
  };
  profiles?: {
    local?: { id: string; name: string; path: string }[];
    ssh?: { id: string; name: string; host: string; port?: number; user: string; auth?: { password?: string; keyPath?: string; passphrase?: string; agent?: boolean }; path?: string }[];
  };
  profilesTree?: ProfilesTreeNode;
};

export async function loadAppState(): Promise<AppPersistState> {
  try {
    const data = (await loadState('jaterm')) || {};
    return (data || {}) as AppPersistState;
  } catch {
    return {};
  }
}

export async function saveAppState(partial: AppPersistState): Promise<void> {
  try {
    const current = (await loadAppState()) as AppPersistState;
    const next = { ...current, ...partial };
    await saveState(next, 'jaterm');
  } catch {
    // ignore
  }
}

// Terminal customization settings
export type TerminalSettings = {
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
  theme?: string; // Theme name like 'dracula', 'solarized-dark', etc.
  scrollback?: number;
  bellStyle?: 'none' | 'visual' | 'sound' | 'both';
};

// Environment and shell settings
export type ShellSettings = {
  shell?: string; // Override shell command
  env?: Record<string, string>; // Environment variables
  initCommands?: string[]; // Commands to run on connect
  workingDir?: 'remember' | 'default' | 'prompt'; // Working directory behavior
};

// SSH-specific settings
export type SshAdvancedSettings = {
  keepaliveInterval?: number; // Seconds between keepalive packets
  compression?: boolean;
  x11Forwarding?: boolean;
  agentForwarding?: boolean;
  defaultForwards?: Array<{
    type: 'L' | 'R';
    srcHost: string;
    srcPort: number;
    dstHost: string;
    dstPort: number;
  }>;
  socksProxy?: { port: number };
  autoReconnect?: boolean;
  reconnectDelay?: number; // Seconds before reconnect attempt
};

// Profile helpers
export type LocalProfile = { 
  id: string; 
  name: string; 
  path: string;
  terminal?: TerminalSettings;
  shell?: ShellSettings;
};

export type SshProfileStored = { 
  id: string; 
  name: string; 
  host: string; 
  port?: number; 
  user: string; 
  auth?: { password?: string; keyPath?: string; passphrase?: string; agent?: boolean }; 
  path?: string;
  terminal?: TerminalSettings;
  shell?: ShellSettings;
  advanced?: SshAdvancedSettings;
  os?: string; // auto-detected or user-selected OS
};

// Profiles tree: folders and profile references
export type ProfilesTreeNode =
  | { id: string; type: 'folder'; name: string; children: ProfilesTreeNode[] }
  | { id: string; type: 'profile'; ref: { kind: 'local' | 'ssh'; id: string } };

export async function getProfilesTree(): Promise<ProfilesTreeNode | null> {
  const s = await loadAppState();
  return (s.profilesTree as any) || null;
}

export async function saveProfilesTree(root: ProfilesTreeNode): Promise<void> {
  await saveAppState({ profilesTree: root } as any);
}

// Ensure a tree exists; if missing, create one referencing existing profiles
export async function ensureProfilesTree(): Promise<ProfilesTreeNode> {
  const existing = await getProfilesTree();
  if (existing) {
    // If an early default tree exists with fixed Local/SSH, flatten into root for full user control
    if (
      existing.type === 'folder' &&
      Array.isArray((existing as any).children) &&
      (existing as any).children.length &&
      (existing as any).children.every((c: any) => c.type === 'folder' && (c.id === 'folder-local' || c.id === 'folder-ssh'))
    ) {
      const flattened = (existing as any).children.flatMap((c: any) => (c.children || []));
      const root: ProfilesTreeNode = { id: existing.id || 'root', type: 'folder', name: existing.name || 'Profiles', children: flattened };
      await saveProfilesTree(root);
      return root;
    }
    return existing;
  }
  const s = await loadAppState();
  const local = (s.profiles?.local ?? []) as { id: string; name: string; path: string }[];
  const ssh = (s.profiles?.ssh ?? []) as { id: string; name: string; host: string; port?: number; user: string; auth?: any; path?: string }[];
  const children: ProfilesTreeNode[] = [
    ...local.map((p) => ({ id: `local-${p.id}`, type: 'profile', ref: { kind: 'local', id: p.id } } as ProfilesTreeNode)),
    ...ssh.map((p) => ({ id: `ssh-${p.id}`, type: 'profile', ref: { kind: 'ssh', id: p.id } } as ProfilesTreeNode)),
  ];
  const root: ProfilesTreeNode = { id: 'root', type: 'folder', name: 'Profiles', children };
  await saveProfilesTree(root);
  return root;
}

export async function getLocalProfiles(): Promise<LocalProfile[]> {
  const s = await loadAppState();
  return s.profiles?.local ?? [];
}
export async function getSshProfiles(): Promise<SshProfileStored[]> {
  const s = await loadAppState();
  return s.profiles?.ssh ?? [];
}
export async function saveLocalProfile(p: LocalProfile): Promise<void> {
  const s = await loadAppState();
  const list = s.profiles?.local ?? [];
  const next = [p, ...list.filter((x) => x.id !== p.id)];
  await saveAppState({ profiles: { ...(s.profiles ?? {}), local: next } });
}
export async function deleteLocalProfile(id: string): Promise<void> {
  const s = await loadAppState();
  const list = s.profiles?.local ?? [];
  await saveAppState({ profiles: { ...(s.profiles ?? {}), local: list.filter((x) => x.id !== id) } });
}
export async function saveSshProfile(p: SshProfileStored): Promise<void> {
  const s = await loadAppState();
  const list = s.profiles?.ssh ?? [];
  // Normalize hostnames to lowercase for consistency
  const normalized: SshProfileStored = { ...p, host: (p.host || '').toLowerCase() };
  const next = [normalized, ...list.filter((x) => x.id !== p.id)];
  await saveAppState({ profiles: { ...(s.profiles ?? {}), ssh: next } });
}
export async function deleteSshProfile(id: string): Promise<void> {
  const s = await loadAppState();
  const list = s.profiles?.ssh ?? [];
  await saveAppState({ profiles: { ...(s.profiles ?? {}), ssh: list.filter((x) => x.id !== id) } });
}
