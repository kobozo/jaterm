import { loadState, saveState } from '@/types/ipc';

export type AppPersistState = {
  recents?: { path: string; lastOpenedAt: number }[];
  recentSessions?: { cwd: string; closedAt: number; panes?: number }[];
  lastOpenedPath?: string | null;
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
