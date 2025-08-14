import React, { useState } from 'react';
import SplitView from '@/components/SplitView';
import TerminalPane from '@/components/TerminalPane/TerminalPane';
import GitStatusBar from '@/components/GitStatusBar';
import Welcome from '@/components/Welcome';
import ComposeDrawer from '@/components/ComposeDrawer';
import TabsBar from '@/components/TabsBar';
import { addRecent } from '@/store/recents';
import { gitStatus, ptyOpen, ptyKill, ptyWrite } from '@/types/ipc';

export default function App() {
  type Tab = {
    id: string;
    cwd: string | null;
    panes: string[];
    activePane: string | null;
    status: { cwd?: string | null; branch?: string; ahead?: number; behind?: number; staged?: number; unstaged?: number };
  };
  const [tabs, setTabs] = useState<Tab[]>([{ id: crypto.randomUUID(), cwd: null, panes: [], activePane: null, status: {} }]);
  const [activeTab, setActiveTab] = useState<string>(tabs[0].id);
  const [composeOpen, setComposeOpen] = useState(false);

  // Start on the Welcome screen by default; no auto-open on launch.

  async function openFolder(path: string, opts: { remember?: boolean } = { remember: true }) {
    if (opts.remember !== false) addRecent(path);
    try {
      const res = await ptyOpen({ cwd: path });
      const id = typeof res === 'string' ? res : (res as any).ptyId ?? res;
      const sid = String(id);
      setTabs((prev) => prev.map((t) => (t.id === activeTab ? { ...t, cwd: path, panes: [sid], activePane: sid } : t)));
    } catch (e) {
      console.error('ptyOpen failed', e);
    }
  }

  async function newTerminal() {
    const t = tabs.find((x) => x.id === activeTab);
    if (!t || !t.cwd) return;
    try {
      const res = await ptyOpen({ cwd: t.cwd });
      const id = typeof res === 'string' ? res : (res as any).ptyId ?? res;
      const sid = String(id);
      setTabs((prev) => prev.map((tb) => (tb.id === activeTab ? { ...tb, panes: [...tb.panes, sid], activePane: sid } : tb)));
    } catch (e) {
      console.error('ptyOpen failed', e);
    }
  }

  async function closePane(id: string) {
    try { await ptyKill({ ptyId: id }); } catch {}
    setTabs((prev) => prev.map((t) => {
      if (t.id !== activeTab) return t;
      const nextPanes = t.panes.filter((p) => p !== id);
      return { ...t, panes: nextPanes, activePane: nextPanes[nextPanes.length - 1] ?? null, cwd: nextPanes.length ? t.cwd : null };
    }));
  }

  async function handleCwd(_paneId: string, dir: string) {
    setTabs((prev) => prev.map((t) => (t.id === activeTab ? { ...t, status: { ...t.status, cwd: dir } } : t)));
    try {
      const st = await gitStatus(dir);
      setTabs((prev) => prev.map((t) => (t.id === activeTab ? { ...t, status: { cwd: dir, branch: st.branch, ahead: st.ahead, behind: st.behind, staged: st.staged, unstaged: st.unstaged } } : t)));
    } catch {
      setTabs((prev) => prev.map((t) => (t.id === activeTab ? { ...t, status: { ...t.status, branch: '-', ahead: 0, behind: 0, staged: 0, unstaged: 0 } } : t)));
    }
  }

  function newTab() {
    const id = crypto.randomUUID();
    setTabs((prev) => [...prev, { id, cwd: null, panes: [], activePane: null, status: {} }]);
    setActiveTab(id);
  }

  function closeTab(id: string) {
    setTabs((prev) => prev.filter((t) => t.id !== id));
    if (activeTab === id && tabs.length > 1) {
      const next = tabs.find((t) => t.id !== id);
      if (next) setActiveTab(next.id);
    }
  }

  const active = tabs.find((t) => t.id === activeTab)!;
  return (
    <div className="app-root">
      <TabsBar
        tabs={tabs.map((t) => ({ id: t.id, title: t.cwd ? t.cwd : 'Welcome', isWelcome: !t.cwd }))}
        activeId={activeTab}
        onSelect={setActiveTab}
        onClose={closeTab}
        onAdd={newTab}
      />
      {active.cwd ? (
        <>
          <SplitView>
            {active.panes.map((id) => (
              <TerminalPane key={id} id={id} onCwd={handleCwd} onFocusPane={(pid) => setTabs((prev) => prev.map((t) => (t.id === activeTab ? { ...t, activePane: pid } : t)))} onClose={closePane} />
            ))}
          </SplitView>
          <div className="status-bar" style={{ display: 'flex', gap: 12, alignItems: 'center', position: 'relative' }}>
            <button onClick={newTerminal}>New Terminal</button>
            <button onClick={() => setComposeOpen((v) => !v)}>Compose (Cmd/Ctrl+E)</button>
            <GitStatusBar cwd={active.status.cwd} branch={active.status.branch} ahead={active.status.ahead} behind={active.status.behind} staged={active.status.staged} unstaged={active.status.unstaged} />
            <ComposeDrawer
              open={composeOpen}
              onClose={() => setComposeOpen(false)}
              onSend={(text) => {
                if (active.activePane) ptyWrite({ ptyId: active.activePane, data: text });
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
