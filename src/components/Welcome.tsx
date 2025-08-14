import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { addRecent, getRecents } from '@/store/recents';
import { getRecentSessions } from '@/store/sessions';

type Props = {
  onOpenFolder: (path: string) => void;
};

export default function Welcome({ onOpenFolder }: Props) {
  const recents = getRecents();
  const recentSessions = getRecentSessions();

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

  return (
    <div style={{ padding: 24 }}>
      <h1>Start New Session</h1>
      <p>Start a local terminal in your home or a specific folder.</p>
      <div style={{ margin: '16px 0', display: 'flex', gap: 12 }}>
        <button onClick={handleHome}>Start in Home Folder</button>
        <button onClick={handlePick}>Start in Specific Folder…</button>
      </div>
      {recents.length > 0 && (
        <div>
          <h3>Recent folders</h3>
          <ul>
            {recents.map((r) => (
              <li key={r.path}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    addRecent(r.path);
                    onOpenFolder(r.path);
                  }}
                >
                  {r.path}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {recentSessions.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>Recent sessions</h3>
          <ul>
            {recentSessions.map((s) => (
              <li key={`${s.cwd}-${s.closedAt}`}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenFolder(s.cwd);
                  }}
                  title={new Date(s.closedAt).toLocaleString()}
                >
                  {s.cwd} {typeof s.panes === 'number' ? `(panes: ${s.panes})` : ''}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
