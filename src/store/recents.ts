const KEY = 'jaterm.recents.v1';

export type RecentItem = {
  path: string;
  lastOpenedAt: number;
};

export function getRecents(limit = 10): RecentItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentItem[]) : [];
    return list
      .filter((r) => typeof r.path === 'string' && typeof r.lastOpenedAt === 'number')
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function addRecent(path: string) {
  const now = Date.now();
  const list = getRecents(100);
  const filtered = list.filter((r) => r.path !== path);
  filtered.unshift({ path, lastOpenedAt: now });
  localStorage.setItem(KEY, JSON.stringify(filtered.slice(0, 50)));
  localStorage.setItem(KEY + '.last', path);
}

export function getLastOpened(): string | null {
  return localStorage.getItem(KEY + '.last');
}

export function setLastOpened(path: string | null) {
  if (path) localStorage.setItem(KEY + '.last', path);
  else localStorage.removeItem(KEY + '.last');
}

export function removeRecent(path: string) {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentItem[]) : [];
    const next = list.filter((r) => r.path !== path);
    localStorage.setItem(KEY, JSON.stringify(next));
    const last = localStorage.getItem(KEY + '.last');
    if (last === path) localStorage.removeItem(KEY + '.last');
  } catch {}
}

export function clearRecents() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(KEY + '.last');
}
