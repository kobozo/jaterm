import React, { useState } from 'react';
import SplitView from '@/components/SplitView';
import TerminalPane from '@/components/TerminalPane/TerminalPane';
import GitStatusBar from '@/components/GitStatusBar';
import Welcome from '@/components/Welcome';
import ComposeDrawer from '@/components/ComposeDrawer';
import TabsBar from '@/components/TabsBar';
import { addRecent } from '@/store/recents';
import { addRecentSession } from '@/store/sessions';
import { appQuit, gitStatus, ptyOpen, ptyKill, ptyWrite } from '@/types/ipc';

export default function App() {
  type Tab = {
    id: string;
    cwd: string | null;
    panes: string[];
    activePane: string | null;
    status: { cwd?: string | null; branch?: string; ahead?: number; behind?: number; staged?: number; unstaged?: number };
    title?: string;
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
      // Fallback: ensure shell is in the desired folder even if the PTY cwd wasn’t applied by the shell (no OSC7 injection)
      try {
        const isWin = navigator.userAgent.includes('Windows');
        if (isWin) {
          const p = path.replace(/"/g, '""');
          console.debug('[reopen] cd fallback (win)', p);
          ptyWrite({ ptyId: sid, data: `cd /d "${p}"\r` });
        } else {
          const p = path.replace(/'/g, "'\\''");
          console.debug('[reopen] cd fallback (posix)', p);
          ptyWrite({ ptyId: sid, data: `cd '${p}'\n` });
        }
      } catch {}
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
    emitCwdViaOsc7(id);
    await new Promise((r) => setTimeout(r, 120));
    try { await ptyKill({ ptyId: id }); } catch {}
    setTabs((prev) => prev.map((t) => {
      if (t.id !== activeTab) return t;
      const nextPanes = t.panes.filter((p) => p !== id);
      const updated = { ...t, panes: nextPanes, activePane: nextPanes[nextPanes.length - 1] ?? null, cwd: nextPanes.length ? t.cwd : null };
      if (t.panes.length > 0 && nextPanes.length === 0 && (t.status.cwd || t.cwd)) {
        addRecentSession({ cwd: (t.status.cwd ?? t.cwd) as string, closedAt: Date.now(), panes: t.panes.length });
      }
      return updated;
    }));
  }

  async function updateTabCwd(tabId: string, dir: string) {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: { ...t.status, cwd: dir, seenOsc7: true as any } } : t)));
    try {
      const st = await gitStatus(dir);
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: { cwd: dir, branch: st.branch, ahead: st.ahead, behind: st.behind, staged: st.staged, unstaged: st.unstaged, seenOsc7: true as any } } : t)));
    } catch {
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: { ...t.status, branch: '-', ahead: 0, behind: 0, staged: 0, unstaged: 0 } } : t)));
    }
  }

  function emitCwdViaOsc7(ptyId: string) {
    try {
      const seq = `printf '\\033]7;file://%s%s\\007' "$(hostname)" "$PWD"\n`;
      ptyWrite({ ptyId: ptyId, data: seq });
    } catch {}
  }

  function newTab() {
    const id = crypto.randomUUID();
    setTabs((prev) => [...prev, { id, cwd: null, panes: [], activePane: null, status: {} }]);
    setActiveTab(id);
  }

  async function closeTab(id: string) {
    // record session for the tab if it had a cwd
    const toRecord = tabs.find((t) => t.id === id);
    if (toRecord && (toRecord.status.cwd || toRecord.cwd)) {
      addRecentSession({ cwd: (toRecord.status.cwd ?? toRecord.cwd) as string, closedAt: Date.now(), panes: toRecord.panes.length });
    }
    if (toRecord?.activePane) {
      emitCwdViaOsc7(toRecord.activePane);
      await new Promise((r) => setTimeout(r, 120));
    }
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
        tabs={tabs.map((t) => {
          const full = t.status.cwd ?? t.cwd;
          const derived = full ? (full.split(/[\\/]/).filter(Boolean).pop() || full) : 'Welcome';
          const title = t.title ?? derived;
          return { id: t.id, title, isWelcome: !full };
        })}
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
                <TerminalPane
                  key={id}
                  id={id}
                  onCwd={(_pid, dir) => updateTabCwd(t.id, dir)}
                  onTitle={(_pid, title) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, title } : tt)))}
                  onFocusPane={(pid) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, activePane: pid } : tt)))}
                  onClose={closePane}
                />
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
        {/* Offer zsh helper if no OSC7 observed yet */}
        {!((active as any).status?.seenOsc7) && (
          <button
            onClick={async () => {
              try {
                const ok = await (await import('@/types/ipc')).installZshOsc7();
                alert(ok ? 'Installed zsh cwd tracking to ~/.zshrc. Restart your shell.' : 'zsh cwd tracking already installed.');
              } catch (e) {
                alert('Failed to install zsh cwd tracking: ' + (e as any));
              }
            }}
            title="Enable automatic cwd tracking in zsh"
          >
            Enable zsh cwd tracking
          </button>
        )}
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
