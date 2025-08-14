import { loadAppState, saveAppState } from '@/store/persist';

export type RecentItem = { path: string; lastOpenedAt: number };

export async function getRecents(limit = 10): Promise<RecentItem[]> {
  const s = await loadAppState();
  const list = (s.recents || []) as RecentItem[];
  return list
    .filter((r) => typeof r.path === 'string' && typeof r.lastOpenedAt === 'number')
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, limit);
}

export async function addRecent(path: string) {
  const now = Date.now();
  const s = await loadAppState();
  const list = (s.recents || []) as RecentItem[];
  const filtered = list.filter((r) => r.path !== path);
  filtered.unshift({ path, lastOpenedAt: now });
  await saveAppState({ recents: filtered.slice(0, 50), lastOpenedPath: path });
}

export async function getLastOpened(): Promise<string | null> {
  const s = await loadAppState();
  return (s.lastOpenedPath as string) ?? null;
}

export async function setLastOpened(path: string | null) {
  await saveAppState({ lastOpenedPath: path ?? null });
}

export async function removeRecent(path: string) {
  const s = await loadAppState();
  const list = (s.recents || []) as RecentItem[];
  const next = list.filter((r) => r.path !== path);
  const nextLast = s.lastOpenedPath === path ? null : s.lastOpenedPath ?? null;
  await saveAppState({ recents: next, lastOpenedPath: nextLast });
}

export async function clearRecents() {
  await saveAppState({ recents: [], lastOpenedPath: null });
}
