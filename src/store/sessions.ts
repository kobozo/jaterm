const KEY = 'jaterm.sessions.v1';

export type RecentSession = {
  cwd: string;
  closedAt: number;
  panes?: number;
};

export function getRecentSessions(limit = 10): RecentSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentSession[]) : [];
    return list
      .filter((s) => typeof s.cwd === 'string' && typeof s.closedAt === 'number')
      .sort((a, b) => b.closedAt - a.closedAt)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function addRecentSession(sess: RecentSession) {
  const list = getRecentSessions(100);
  const filtered = list.filter((s) => s.cwd !== sess.cwd);
  filtered.unshift(sess);
  localStorage.setItem(KEY, JSON.stringify(filtered.slice(0, 50)));
}

export function removeRecentSession(cwd: string) {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentSession[]) : [];
    const next = list.filter((s) => s.cwd !== cwd);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}

export function clearRecentSessions() {
  localStorage.removeItem(KEY);
}
