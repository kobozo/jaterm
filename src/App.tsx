import React, { useEffect, useState } from 'react';
import SplitView from '@/components/SplitView';
import TerminalPane from '@/components/TerminalPane/TerminalPane';
import GitStatusBar from '@/components/GitStatusBar';
import Welcome from '@/components/Welcome';
import { addRecent, getLastOpened } from '@/store/recents';
import { ptyOpen } from '@/types/ipc';

export default function App() {
  const [cwd, setCwd] = useState<string | null>(null);
  const [ptyId, setPtyId] = useState<string | null>(null);

  useEffect(() => {
    const last = getLastOpened();
    if (last) void openFolder(last, { remember: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openFolder(path: string, opts: { remember?: boolean } = { remember: true }) {
    setCwd(path);
    if (opts.remember !== false) addRecent(path);
    try {
      const res = await ptyOpen({ cwd: path });
      const id = typeof res === 'string' ? res : (res as any).ptyId ?? res;
      setPtyId(String(id));
    } catch (e) {
      console.error('ptyOpen failed', e);
    }
  }

  return (
    <div className="app-root">
      {cwd ? (
        <>
          <SplitView>
            <TerminalPane id={ptyId ?? 'main'} />
          </SplitView>
          <div className="status-bar">
            <GitStatusBar />
          </div>
        </>
      ) : (
        <Welcome onOpenFolder={(p) => openFolder(p)} />
      )}
    </div>
  );
}
