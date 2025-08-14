import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { addRecent, getRecents } from '@/store/recents';

type Props = {
  onOpenFolder: (path: string) => void;
};

export default function Welcome({ onOpenFolder }: Props) {
  const recents = getRecents();

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
    </div>
  );
}
