import React, { useEffect, useState } from 'react';
import SplitView from '@/components/SplitView';
import TerminalPane from '@/components/TerminalPane/TerminalPane';
import GitStatusBar from '@/components/GitStatusBar';
import Welcome from '@/components/Welcome';
import { addRecent } from '@/store/recents';
import { ptyOpen } from '@/types/ipc';

export default function App() {
  const [cwd, setCwd] = useState<string | null>(null);
  const [panes, setPanes] = useState<string[]>([]);

  // Start on the Welcome screen by default; no auto-open on launch.

  async function openFolder(path: string, opts: { remember?: boolean } = { remember: true }) {
    setCwd(path);
    if (opts.remember !== false) addRecent(path);
    try {
      const res = await ptyOpen({ cwd: path });
      const id = typeof res === 'string' ? res : (res as any).ptyId ?? res;
      setPanes([String(id)]);
    } catch (e) {
      console.error('ptyOpen failed', e);
    }
  }

  async function newTerminal() {
    if (!cwd) return;
    try {
      const res = await ptyOpen({ cwd });
      const id = typeof res === 'string' ? res : (res as any).ptyId ?? res;
      setPanes((prev) => [...prev, String(id)]);
    } catch (e) {
      console.error('ptyOpen failed', e);
    }
  }

  return (
    <div className="app-root">
      {cwd ? (
        <>
          <SplitView>
            {panes.map((id) => (
              <TerminalPane key={id} id={id} />
            ))}
          </SplitView>
          <div className="status-bar" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button onClick={newTerminal}>New Terminal</button>
            <GitStatusBar />
          </div>
        </>
      ) : (
        <Welcome onOpenFolder={(p) => openFolder(p)} />
      )}
    </div>
  );
}
