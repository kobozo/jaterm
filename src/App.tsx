import React, { useState } from 'react';
import SplitView from '@/components/SplitView';
import TerminalPane from '@/components/TerminalPane/TerminalPane';
import GitStatusBar from '@/components/GitStatusBar';
import Welcome from '@/components/Welcome';
import ComposeDrawer from '@/components/ComposeDrawer';
import TabsBar from '@/components/TabsBar';
import { addRecent } from '@/store/recents';
import { appQuit, gitStatus, ptyOpen, ptyKill, ptyWrite } from '@/types/ipc';

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

  async function openFolderFor(tabId: string, path: string, opts: { remember?: boolean } = { remember: true }) {
    if (opts.remember !== false) addRecent(path);
    try {
      const res = await ptyOpen({ cwd: path });
      const id = typeof res === 'string' ? res : (res as any).ptyId ?? res;
      const sid = String(id);
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, cwd: path, panes: [sid], activePane: sid } : t)));
      setActiveTab(tabId);
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
    setTabs((prev) => {
      if (prev.length <= 1) {
        // last tab being closed: quit the app
        appQuit();
        return prev; // will terminate shortly
      }
      const next = prev.filter((t) => t.id !== id);
      if (activeTab === id) {
        const fallback = next[0];
        if (fallback) setActiveTab(fallback.id);
      }
      return next;
    });
  }

  const active = tabs.find((t) => t.id === activeTab)!;
  // When switching tabs, ask panes to refit when shown
  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent('jaterm:panes-resized'));
  }, [activeTab]);
  return (
    <div className="app-root">
      <TabsBar
        tabs={tabs.map((t) => ({ id: t.id, title: t.cwd ? t.cwd : 'Welcome', isWelcome: !t.cwd }))}
        activeId={activeTab}
        onSelect={setActiveTab}
        onClose={closeTab}
        onAdd={newTab}
      />
      {/* Render all tabs' content; hide inactive with display:none to preserve xterm buffers */}
      {tabs.map((t) => (
        <div key={t.id} style={{ display: t.id === activeTab ? 'block' : 'none', height: '100%' }}>
          {t.cwd ? (
            <SplitView>
              {t.panes.map((id) => (
                <TerminalPane key={id} id={id} onCwd={handleCwd} onFocusPane={(pid) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, activePane: pid } : tt)))} onClose={closePane} />
              ))}
            </SplitView>
          ) : (
            <Welcome onOpenFolder={(p) => openFolderFor(t.id, p)} />
          )}
        </div>
      ))}
      {/* Single status bar for active tab */}
      <div className="status-bar" style={{ display: 'flex', gap: 12, alignItems: 'center', position: 'relative' }}>
        {active.cwd && <button onClick={newTerminal}>New Terminal</button>}
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
    </div>
  );
}
