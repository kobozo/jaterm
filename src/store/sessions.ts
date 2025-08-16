import { loadAppState, saveAppState } from '@/store/persist';

export type LayoutShapeLeaf = { type: 'leaf' };
export type LayoutShapeSplit = { type: 'split'; direction: 'row' | 'column'; sizes?: number[]; children: LayoutShape[] };
export type LayoutShape = LayoutShapeLeaf | LayoutShapeSplit;

export type RecentSession = { cwd: string; closedAt: number; panes?: number; title?: string; layoutShape?: LayoutShape };

export type RecentSshSession = {
  profileId?: string;
  host?: string;
  port?: number;
  user?: string;
  path: string;
  closedAt: number;
  panes?: number;
  title?: string;
  layoutShape?: LayoutShape;
};

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

// SSH recents (profile-linked)
export async function getRecentSshSessions(limit = 10): Promise<RecentSshSession[]> {
  const s = await loadAppState();
  const list = (s.recentSshSessions || []) as RecentSshSession[];
  return list
    .filter((r) => typeof r.path === 'string' && typeof r.closedAt === 'number')
    .sort((a, b) => b.closedAt - a.closedAt)
    .slice(0, limit);
}

export async function addRecentSshSession(sess: RecentSshSession) {
  const s = await loadAppState();
  const list = (s.recentSshSessions || []) as RecentSshSession[];
  const filtered = list.filter((r) => !((r.profileId || '') === (sess.profileId || '') && r.path === sess.path));
  filtered.unshift(sess);
  await saveAppState({ recentSshSessions: filtered.slice(0, 50) });
}

export async function removeRecentSshSession(profileIdOrKey: string, path: string) {
  const s = await loadAppState();
  const list = (s.recentSshSessions || []) as RecentSshSession[];
  const next = list.filter((r) => !(((r.profileId || '') === profileIdOrKey) && r.path === path));
  await saveAppState({ recentSshSessions: next });
}

export async function clearRecentSshSessions() {
  await saveAppState({ recentSshSessions: [] });
}
