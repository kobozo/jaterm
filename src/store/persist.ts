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

// Profile helpers
export type LocalProfile = { id: string; name: string; path: string };
export type SshProfileStored = { id: string; name: string; host: string; port?: number; user: string; auth?: { password?: string; keyPath?: string; passphrase?: string; agent?: boolean }; path?: string };

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
