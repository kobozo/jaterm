import { loadAppState, saveAppState } from '@/store/persist';

export type RecentSession = { cwd: string; closedAt: number; panes?: number };

export async function getRecentSessions(limit = 10): Promise<RecentSession[]> {
  const s = await loadAppState();
  const list = (s.recentSessions || []) as RecentSession[];
  return list
    .filter((r) => typeof r.cwd === 'string' && typeof r.closedAt === 'number')
    .sort((a, b) => b.closedAt - a.closedAt)
    .slice(0, limit);
}

export async function addRecentSession(sess: RecentSession) {
  const s = await loadAppState();
  const list = (s.recentSessions || []) as RecentSession[];
  const filtered = list.filter((r) => r.cwd !== sess.cwd);
  filtered.unshift(sess);
  await saveAppState({ recentSessions: filtered.slice(0, 50) });
}

export async function removeRecentSession(cwd: string) {
  const s = await loadAppState();
  const list = (s.recentSessions || []) as RecentSession[];
  const next = list.filter((r) => r.cwd !== cwd);
  await saveAppState({ recentSessions: next });
}

export async function clearRecentSessions() {
  await saveAppState({ recentSessions: [] });
}
