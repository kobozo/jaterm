import React, { useEffect, useState } from 'react';
import SplitView from '@/components/SplitView';
import TerminalPane from '@/components/TerminalPane/TerminalPane';
import GitStatusBar from '@/components/GitStatusBar';
import Welcome from '@/components/Welcome';
import ComposeDrawer from '@/components/ComposeDrawer';
import { addRecent } from '@/store/recents';
import { gitStatus, ptyOpen, ptyKill } from '@/types/ipc';

export default function App() {
  const [cwd, setCwd] = useState<string | null>(null);
  const [panes, setPanes] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [status, setStatus] = useState<{ cwd?: string | null; branch?: string; ahead?: number; behind?: number; staged?: number; unstaged?: number }>({});
  const [composeOpen, setComposeOpen] = useState(false);

  // Start on the Welcome screen by default; no auto-open on launch.

  async function openFolder(path: string, opts: { remember?: boolean } = { remember: true }) {
    setCwd(path);
    if (opts.remember !== false) addRecent(path);
    try {
      const res = await ptyOpen({ cwd: path });
      const id = typeof res === 'string' ? res : (res as any).ptyId ?? res;
      const sid = String(id);
      setPanes([sid]);
      setActive(sid);
    } catch (e) {
      console.error('ptyOpen failed', e);
    }
  }

  async function newTerminal() {
    if (!cwd) return;
    try {
      const res = await ptyOpen({ cwd });
      const id = typeof res === 'string' ? res : (res as any).ptyId ?? res;
      const sid = String(id);
      setPanes((prev) => [...prev, sid]);
      setActive(sid);
    } catch (e) {
      console.error('ptyOpen failed', e);
    }
  }

  async function closePane(id: string) {
    try { await ptyKill({ ptyId: id }); } catch {}
    setPanes((prev) => prev.filter((p) => p !== id));
    if (active === id) setActive(null);
    if (panes.length <= 1) {
      setCwd(null);
      setStatus({});
    }
  }

  async function handleCwd(paneId: string, dir: string) {
    setStatus((s) => ({ ...s, cwd: dir }));
    try {
      const st = await gitStatus(dir);
      setStatus({ cwd: dir, branch: st.branch, ahead: st.ahead, behind: st.behind, staged: st.staged, unstaged: st.unstaged });
    } catch {
      setStatus((s) => ({ ...s, branch: '-', ahead: 0, behind: 0, staged: 0, unstaged: 0 }));
    }
  }

  return (
    <div className="app-root">
      {cwd ? (
        <>
          <SplitView>
            {panes.map((id) => (
              <TerminalPane key={id} id={id} onCwd={handleCwd} onFocusPane={setActive} onClose={closePane} />
            ))}
          </SplitView>
          <div className="status-bar" style={{ display: 'flex', gap: 12, alignItems: 'center', position: 'relative' }}>
            <button onClick={newTerminal}>New Terminal</button>
            <button onClick={() => setComposeOpen((v) => !v)}>Compose (Cmd/Ctrl+E)</button>
            <GitStatusBar cwd={status.cwd} branch={status.branch} ahead={status.ahead} behind={status.behind} staged={status.staged} unstaged={status.unstaged} />
            <ComposeDrawer
              open={composeOpen}
              onClose={() => setComposeOpen(false)}
              onSend={(text) => {
                if (active) ptyWrite({ ptyId: active, data: text });
                setComposeOpen(false);
              }}
            />
          </div>
        </>
      ) : (
        <Welcome onOpenFolder={(p) => openFolder(p)} />
      )}
    </div>
  );
}
