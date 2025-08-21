import { 
  loadState, 
  saveState, 
  loadProfilesEncrypted, 
  saveProfilesEncrypted,
  encryptionStatus 
} from '@/types/ipc';
import { 
  loadProfilesV2, 
  saveProfilesV2 
} from '@/services/api/encryption_v2';

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
    const [stateData, profilesData] = await Promise.all([
      loadState('jaterm'),
      loadProfilesV2('jaterm'),  // Use new encryption system
    ]);
    const merged: AppPersistState = {
      ...(stateData || {}),
      ...(profilesData || {}),
    } as AppPersistState;
    return merged;
  } catch (err) {
    console.error('Failed to load app state:', err);
    // If it's an encryption error, we should still load the non-encrypted state
    try {
      const stateData = await loadState('jaterm');
      return stateData || {};
    } catch {
      return {};
    }
  }
}

export async function saveAppState(partial: AppPersistState): Promise<void> {
  try {
    // Load current split files
    const [stateCurrent, profilesCurrent] = await Promise.all([
      loadState('jaterm'),
      loadProfilesV2('jaterm'),  // Use new encryption system
    ]);

    // Route profiles-related keys
    const profilesPatch: any = {};
    if (typeof partial.profiles !== 'undefined') profilesPatch.profiles = partial.profiles;
    if (typeof partial.profilesTree !== 'undefined') profilesPatch.profilesTree = partial.profilesTree;

    // Route runtime state keys (everything else)
    const statePatch: any = { ...partial };
    delete statePatch.profiles;
    delete statePatch.profilesTree;

    const writes: Promise<any>[] = [];
    if (Object.keys(profilesPatch).length) {
      const nextProfiles = { ...(profilesCurrent || {}), ...profilesPatch };
      writes.push(saveProfilesV2(nextProfiles, 'jaterm'));  // Use new encryption system
    }
    if (Object.keys(statePatch).length) {
      const nextState = { ...(stateCurrent || {}), ...statePatch };
      writes.push(saveState(nextState, 'jaterm'));
    }
    await Promise.all(writes);
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
// Folder-level settings that profiles can inherit
export type FolderSettings = {
  shell?: ShellSettings;
  terminal?: TerminalSettings;
  ssh?: {
    // Keep host/user/auth optional defaults for future use; today we primarily use advanced
    host?: string;
    port?: number;
    user?: string;
    auth?: { password?: string; keyPath?: string; passphrase?: string; agent?: boolean };
    advanced?: SshAdvancedSettings;
  };
};

export type ProfilesTreeNode =
  | { id: string; type: 'folder'; name: string; children: ProfilesTreeNode[]; settings?: FolderSettings }
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

// -------------------------------
// Inheritance resolver
// -------------------------------

export type ResolvedSettings = {
  shell?: ShellSettings;
  terminal?: TerminalSettings;
  // SSH connection overrides and advanced
  ssh?: { host?: string; port?: number; user?: string; auth?: { password?: string; keyPath?: string; passphrase?: string; agent?: boolean } };
  advanced?: SshAdvancedSettings;
};

function mergeEnv(base?: Record<string, string>, overlay?: Record<string, string>): Record<string, string> | undefined {
  if (!base && !overlay) return undefined;
  return { ...(base || {}), ...(overlay || {}) };
}

function concatUniqueForwards(parent?: SshAdvancedSettings['defaultForwards'], child?: SshAdvancedSettings['defaultForwards']): SshAdvancedSettings['defaultForwards'] | undefined {
  const list = [...(parent || []), ...(child || [])];
  if (!list.length) return undefined;
  const seen = new Set<string>();
  const uniq: NonNullable<SshAdvancedSettings['defaultForwards']> = [];
  for (const f of list) {
    const key = [f.type, f.srcHost, f.srcPort, f.dstHost, f.dstPort].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(f);
  }
  return uniq;
}

function nearest<T>(vals: (T | undefined)[]): T | undefined {
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i];
    if (typeof v !== 'undefined') return v;
  }
  return undefined;
}

export function findPathToNode(root: ProfilesTreeNode | null, targetId: string): ProfilesTreeNode[] {
  if (!root) return [];
  const path: ProfilesTreeNode[] = [];
  function walk(n: ProfilesTreeNode, acc: ProfilesTreeNode[]): boolean {
    if (n.id === targetId) { path.push(...acc, n); return true; }
    if (n.type === 'folder') {
      for (const c of n.children) {
        if (walk(c, [...acc, n])) return true;
      }
    }
    return false;
  }
  walk(root, []);
  return path;
}

export function resolveEffectiveSettings(args: {
  root: ProfilesTreeNode | null;
  nodeId: string; // profile node id in tree
  profileKind: 'local' | 'ssh';
  profileSettings?: { shell?: ShellSettings; terminal?: TerminalSettings; advanced?: SshAdvancedSettings; ssh?: { host?: string; port?: number; user?: string; auth?: { password?: string; keyPath?: string; passphrase?: string; agent?: boolean } } };
}): ResolvedSettings {
  const { root, nodeId, profileKind, profileSettings } = args;
  const path = findPathToNode(root, nodeId);
  // Collect folder settings along the path (exclude the profile node itself)
  const folders = path.filter((n) => n.type === 'folder') as Array<Extract<ProfilesTreeNode, { type: 'folder' }>>;

  // Accumulate shell
  let shellEnv: Record<string, string> | undefined = undefined;
  let shellInit: string[] | undefined = undefined;
  const shellOverrideChain: (string | undefined)[] = [];
  for (const f of folders) {
    const s = f.settings?.shell;
    if (s?.env) shellEnv = mergeEnv(shellEnv, s.env);
    if (s?.initCommands) shellInit = [...(shellInit || []), ...s.initCommands];
    shellOverrideChain.push(s?.shell);
  }
  // Apply profile shell settings
  if (profileSettings?.shell?.env) shellEnv = mergeEnv(shellEnv, profileSettings.shell.env);
  if (profileSettings?.shell?.initCommands) shellInit = [...(shellInit || []), ...profileSettings.shell.initCommands];
  shellOverrideChain.push(profileSettings?.shell?.shell);

  const shell: ShellSettings | undefined = (shellEnv || shellInit || nearest(shellOverrideChain))
    ? {
        env: shellEnv,
        initCommands: shellInit,
        shell: nearest(shellOverrideChain),
      }
    : undefined;

  // Accumulate terminal: nearest defined wins per field
  const termFontSizeChain: (number | undefined)[] = [];
  const termFontFamilyChain: (string | undefined)[] = [];
  const termLineHeightChain: (number | undefined)[] = [];
  const termCursorStyleChain: (NonNullable<TerminalSettings['cursorStyle']> | undefined)[] = [];
  const termCursorBlinkChain: (boolean | undefined)[] = [];
  const termThemeChain: (string | undefined)[] = [];
  const termScrollbackChain: (number | undefined)[] = [];
  const termBellStyleChain: (NonNullable<TerminalSettings['bellStyle']> | undefined)[] = [];
  for (const f of folders) {
    const t = f.settings?.terminal;
    if (!t) continue;
    termFontSizeChain.push(t.fontSize);
    termFontFamilyChain.push(t.fontFamily);
    termLineHeightChain.push(t.lineHeight);
    termCursorStyleChain.push(t.cursorStyle);
    termCursorBlinkChain.push(t.cursorBlink);
    termThemeChain.push(t.theme);
    termScrollbackChain.push(t.scrollback);
    termBellStyleChain.push(t.bellStyle);
  }
  if (profileSettings?.terminal) {
    const t = profileSettings.terminal;
    termFontSizeChain.push(t.fontSize);
    termFontFamilyChain.push(t.fontFamily);
    termLineHeightChain.push(t.lineHeight);
    termCursorStyleChain.push(t.cursorStyle);
    termCursorBlinkChain.push(t.cursorBlink);
    termThemeChain.push(t.theme);
    termScrollbackChain.push(t.scrollback);
    termBellStyleChain.push(t.bellStyle);
  }
  const terminal: TerminalSettings | undefined = (termFontSizeChain.length || termFontFamilyChain.length || termThemeChain.length)
    ? {
        fontSize: nearest(termFontSizeChain),
        fontFamily: nearest(termFontFamilyChain),
        lineHeight: nearest(termLineHeightChain),
        cursorStyle: nearest(termCursorStyleChain),
        cursorBlink: nearest(termCursorBlinkChain),
        theme: nearest(termThemeChain),
        scrollback: nearest(termScrollbackChain),
        bellStyle: nearest(termBellStyleChain),
      }
    : undefined;

  // Accumulate SSH advanced (only for ssh profiles)
  let advanced: SshAdvancedSettings | undefined = undefined;
  if (profileKind === 'ssh') {
    let keepaliveChain: (number | undefined)[] = [];
    let compressionChain: (boolean | undefined)[] = [];
    let x11Chain: (boolean | undefined)[] = [];
    let agentChain: (boolean | undefined)[] = [];
    let socksChain: ({ port: number } | undefined)[] = [];
    let autoReconnectChain: (boolean | undefined)[] = [];
    let reconnectDelayChain: (number | undefined)[] = [];
    let forwards: SshAdvancedSettings['defaultForwards'] | undefined = undefined;
    for (const f of folders) {
      const a = f.settings?.ssh?.advanced;
      if (!a) continue;
      keepaliveChain.push(a.keepaliveInterval);
      compressionChain.push(a.compression);
      x11Chain.push(a.x11Forwarding);
      agentChain.push(a.agentForwarding);
      socksChain.push(a.socksProxy);
      autoReconnectChain.push(a.autoReconnect);
      reconnectDelayChain.push(a.reconnectDelay);
      forwards = concatUniqueForwards(forwards, a.defaultForwards);
    }
    if (profileSettings?.advanced) {
      const a = profileSettings.advanced;
      keepaliveChain.push(a.keepaliveInterval);
      compressionChain.push(a.compression);
      x11Chain.push(a.x11Forwarding);
      agentChain.push(a.agentForwarding);
      socksChain.push(a.socksProxy);
      autoReconnectChain.push(a.autoReconnect);
      reconnectDelayChain.push(a.reconnectDelay);
      forwards = concatUniqueForwards(forwards, a.defaultForwards);
    }
    const maybe: SshAdvancedSettings = {
      keepaliveInterval: nearest(keepaliveChain),
      compression: nearest(compressionChain),
      x11Forwarding: nearest(x11Chain),
      agentForwarding: nearest(agentChain),
      socksProxy: nearest(socksChain),
      autoReconnect: nearest(autoReconnectChain),
      reconnectDelay: nearest(reconnectDelayChain),
      defaultForwards: forwards,
    };
    // Strip empty object
    advanced = Object.values(maybe).some((v) => typeof v !== 'undefined') ? maybe : undefined;
  }

  // SSH base connection overrides (nearest defined wins)
  let sshHostChain: (string | undefined)[] = [];
  let sshPortChain: (number | undefined)[] = [];
  let sshUserChain: (string | undefined)[] = [];
  let sshAuthChain: ({ password?: string; keyPath?: string; passphrase?: string; agent?: boolean } | undefined)[] = [];
  if (profileKind === 'ssh') {
    for (const f of folders) {
      const s = f.settings?.ssh;
      if (!s) continue;
      sshHostChain.push(s.host);
      sshPortChain.push(s.port);
      sshUserChain.push(s.user);
      sshAuthChain.push(s.auth);
    }
    if (profileSettings?.ssh) {
      sshHostChain.push(profileSettings.ssh.host);
      sshPortChain.push(profileSettings.ssh.port);
      sshUserChain.push(profileSettings.ssh.user);
      sshAuthChain.push(profileSettings.ssh.auth);
    }
  }

  const sshOverrides = (profileKind === 'ssh')
    ? {
        host: nearest(sshHostChain),
        port: nearest(sshPortChain),
        user: nearest(sshUserChain),
        auth: nearest(sshAuthChain),
      }
    : undefined;

  return { shell, terminal, ssh: sshOverrides, advanced };
}
