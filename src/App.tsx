import React, { useState } from 'react';
import SplitView from '@/components/SplitView';
import TerminalPane from '@/components/TerminalPane/TerminalPane';
import RemoteTerminalPane from '@/components/RemoteTerminalPane';
import GitStatusBar from '@/components/GitStatusBar';
import Welcome from '@/components/Welcome';
import type { LayoutShape } from '@/store/sessions';
import ComposeDrawer from '@/components/ComposeDrawer';
import TabsBar from '@/components/TabsBar';
import SplitTree, { LayoutNode, LayoutSplit, LayoutLeaf } from '@/components/SplitTree';
import { addRecent } from '@/store/recents';
import { saveAppState, loadAppState } from '@/store/persist';
import { addRecentSession } from '@/store/sessions';
import { appQuit, gitStatus, installZshOsc7, installBashOsc7, installFishOsc7, openPathSystem, ptyOpen, ptyKill, ptyWrite, resolvePathAbsolute, sshCloseShell, sshConnect, sshDisconnect, sshOpenShell, sshWrite } from '@/types/ipc';

export default function App() {
  // imported above
  type LayoutShapeLeaf = { type: 'leaf' };
  type LayoutShapeSplit = { type: 'split'; direction: 'row' | 'column'; children: LayoutShape[] };
  type LayoutShape = LayoutShapeLeaf | LayoutShapeSplit;
  type Tab = {
    id: string;
    kind?: 'local' | 'ssh';
    sshSessionId?: string;
    cwd: string | null;
    panes: string[];
    activePane: string | null;
    status: { cwd?: string | null; fullPath?: string | null; branch?: string; ahead?: number; behind?: number; staged?: number; unstaged?: number; seenOsc7?: boolean };
    title?: string;
  };
  const [tabs, setTabs] = useState<Tab[]>([{ id: crypto.randomUUID(), cwd: null, panes: [], activePane: null, status: {} }]);
  const [activeTab, setActiveTab] = useState<string>(tabs[0].id);
  const [composeOpen, setComposeOpen] = useState(false);

  // Start on the Welcome screen by default; no auto-open on launch.

  async function openFolderFor(tabId: string, path: string, opts: { remember?: boolean } = { remember: true }) {
    if (opts.remember !== false) await addRecent(path);
    try {
      const abs = await resolvePathAbsolute(path);
      const res = await ptyOpen({ cwd: abs });
      const id = typeof res === 'string' ? res : (res as any).ptyId ?? res;
      const sid = String(id);
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, cwd: abs, panes: [sid], activePane: sid, status: { ...t.status, fullPath: abs } } : t)));
      setActiveTab(tabId);
      // Auto-install zsh OSC7 helper on mac if missing (once)
      try {
        const ua = navigator.userAgent.toLowerCase();
        const isMac = ua.includes('mac');
        const already = localStorage.getItem('jaterm.zsh.osc7.auto') === 'done';
        if (isMac && !already) {
          setTimeout(async () => {
            const t = tabs.find((x) => x.id === tabId);
            const seen = t?.status && (t.status as any).seenOsc7;
            if (!seen) {
              try {
                const ok = await installZshOsc7();
                if (ok) {
                  localStorage.setItem('jaterm.zsh.osc7.auto', 'done');
                  alert('Enabled zsh cwd tracking in ~/.zshrc. Restart your shell for live cwd.');
                }
              } catch {}
            }
          }, 1500);
        }
      } catch {}
      // No fallback cd: we rely on PTY cwd and shell OSC7 hooks
    } catch (e) {
      console.error('ptyOpen failed', e);
    }
  }

  async function newTerminal() {
    const t = tabs.find((x) => x.id === activeTab);
    if (!t || !t.cwd) return;
    if (t.kind === 'ssh') { return; }
    try {
      const res = await ptyOpen({ cwd: t.cwd });
      const id = typeof res === 'string' ? res : (res as any).ptyId ?? res;
      const sid = String(id);
      setTabs((prev) => prev.map((tb) => (tb.id === activeTab ? { ...tb, panes: [...tb.panes, sid], activePane: sid } : tb)));
    } catch (e) {
      console.error('ptyOpen failed', e);
    }
  }

  function layoutToShape(n?: LayoutNode): LayoutShape | undefined {
    if (!n) return undefined;
    if (n.type === 'leaf') return { type: 'leaf' };
    const childShapes = n.children.map((c) => layoutToShape(c)!).filter(Boolean) as LayoutShape[];
    const sizes = (n as any).sizes as number[] | undefined;
    return { type: 'split', direction: n.direction, sizes: sizes && sizes.slice(), children: childShapes };
  }

  function replaceLeaf(node: LayoutNode, targetPane: string, replacement: LayoutNode): LayoutNode {
    if (node.type === 'leaf') return node.paneId === targetPane ? replacement : node;
    return { ...node, children: node.children.map((c) => replaceLeaf(c, targetPane, replacement)) };
  }

  function removeLeaf(node: LayoutNode, targetPane: string): LayoutNode | null {
    if (node.type === 'leaf') return node.paneId === targetPane ? null : node;
    const newChildren = node.children.map((c) => removeLeaf(c, targetPane)).filter(Boolean) as LayoutNode[];
    if (newChildren.length === 0) return null;
    if (newChildren.length === 1) return newChildren[0];
    return { ...node, children: newChildren };
  }

  async function splitPane(paneId: string, direction: 'row' | 'column') {
    const t = tabs.find((x) => x.id === activeTab);
    if (!t) return;
    if (t.kind === 'ssh') {
      if (!t.sshSessionId) return;
      try {
        const newId = await sshOpenShell({ sessionId: t.sshSessionId, cwd: t.cwd ?? undefined, cols: 120, rows: 30 });
        const replacement: LayoutNode = { type: 'split', direction, children: [{ type: 'leaf', paneId }, { type: 'leaf', paneId: newId }] };
        const newLayout: LayoutNode = t.layout ? replaceLeaf(t.layout as any, paneId, replacement) : replacement;
        setTabs((prev) => prev.map((tb) => (tb.id === activeTab ? { ...tb, panes: [...tb.panes, newId], activePane: newId, layout: newLayout } : tb)));
      } catch (e) {
        console.error('ssh split failed', e);
      }
      return;
    }
    if (!t.cwd) return;
    try {
      const res = await ptyOpen({ cwd: t.cwd });
      const newId = String(typeof res === 'string' ? res : (res as any).ptyId ?? res);
      const replacement: LayoutNode = { type: 'split', direction, children: [{ type: 'leaf', paneId }, { type: 'leaf', paneId: newId }] };
      const newLayout: LayoutNode = t.layout ? replaceLeaf(t.layout as any, paneId, replacement) : replacement;
      setTabs((prev) => prev.map((tb) => (tb.id === activeTab ? { ...tb, panes: [...tb.panes, newId], activePane: newId, layout: newLayout } : tb)));
    } catch (e) {
      console.error('split failed', e);
    }
  }

  async function closePane(id: string) {
    const t = tabs.find((x) => x.id === activeTab);
    if (t?.kind === 'ssh') {
      try { await sshCloseShell(id); } catch {}
    } else {
      emitCwdViaOsc7(id);
      await new Promise((r) => setTimeout(r, 120));
      try { await ptyKill({ ptyId: id }); } catch {}
    }
    setTabs((prev) => prev.map((t) => {
      if (t.id !== activeTab) return t;
      const nextPanes = t.panes.filter((p) => p !== id);
      const nextLayout = t.layout ? removeLeaf(t.layout as any, id) : undefined;
      const updated = { ...t, panes: nextPanes, activePane: nextPanes[nextPanes.length - 1] ?? null, cwd: nextPanes.length ? t.cwd : null, layout: nextLayout };
      if (t.kind !== 'ssh' && t.panes.length > 0 && nextPanes.length === 0 && (t.status.fullPath || t.cwd)) {
        addRecentSession({ cwd: (t.status.fullPath ?? t.cwd) as string, closedAt: Date.now(), panes: t.panes.length, title: t.title ?? undefined, layoutShape: layoutToShape(t.layout as any) });
      }
      return updated;
    }));
  }

  async function updateTabCwd(tabId: string, dir: string) {
    // Resolve to absolute so we persist correct paths
    let abs = dir;
    try {
      const mod = await import('@/types/ipc');
      abs = await (mod as any).resolvePathAbsolute(dir);
    } catch {}
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: { ...t.status, cwd: abs, fullPath: abs, seenOsc7: true } } : t)));
    try {
      const st = await gitStatus(abs);
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: { cwd: abs, fullPath: abs, branch: st.branch, ahead: st.ahead, behind: st.behind, staged: st.staged, unstaged: st.unstaged, seenOsc7: true } } : t)));
    } catch {
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: { ...t.status, fullPath: abs, branch: '-', ahead: 0, behind: 0, staged: 0, unstaged: 0 } } : t)));
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
    if (toRecord && toRecord.kind !== 'ssh' && (toRecord.status.cwd || toRecord.cwd)) {
      addRecentSession({ cwd: (toRecord.status.cwd ?? toRecord.cwd) as string, closedAt: Date.now(), panes: toRecord.panes.length, title: toRecord.title ?? undefined, layoutShape: layoutToShape(toRecord.layout as any) });
    }
    if (toRecord?.activePane) {
      if (toRecord.kind === 'ssh') {
        try { await Promise.all(toRecord.panes.map((pid) => sshCloseShell(pid))); } catch {}
        if (toRecord.sshSessionId) { try { await sshDisconnect(toRecord.sshSessionId); } catch {} }
      } else {
        emitCwdViaOsc7(toRecord.activePane);
        await new Promise((r) => setTimeout(r, 120));
      }
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
    // Record SSH recent if opened from a profile
    if (toRecord?.kind === 'ssh' && toRecord.profileId) {
      const path = (toRecord.status.fullPath ?? toRecord.cwd) as string | undefined;
      if (path) {
        const { addRecentSshSession } = await import('@/store/sessions');
        await addRecentSshSession({ profileId: toRecord.profileId, path, closedAt: Date.now(), panes: toRecord.panes.length, title: toRecord.title ?? undefined, layoutShape: layoutToShape(toRecord.layout as any) });
      }
    }
  }

  function shapeAssignPanes(shape: LayoutShape, panes: string[]): { node: LayoutNode; rest: string[] } {
    if (shape.type === 'leaf') {
      const [head, ...rest] = panes;
      return { node: { type: 'leaf', paneId: head }, rest } as any;
    }
    let rest = panes;
    const children: LayoutNode[] = [];
    for (const ch of shape.children) {
      const r = shapeAssignPanes(ch, rest);
      children.push(r.node);
      rest = r.rest;
    }
    const sizes = shape.sizes && shape.sizes.slice();
    return { node: { type: 'split', direction: shape.direction, sizes, children } as LayoutNode, rest };
  }

  async function openSessionFor(tabId: string, session: { cwd: string; layoutShape?: LayoutShape; title?: string }) {
    try {
      const abs = await resolvePathAbsolute(session.cwd);
      let paneIds: string[] = [];
      let layout: LayoutNode | undefined = undefined;
      if (session.layoutShape) {
        // Count leaves
        function countLeaves(s: LayoutShape): number {
          return s.type === 'leaf' ? 1 : s.children.map(countLeaves).reduce((a, b) => a + b, 0);
        }
        const n = countLeaves(session.layoutShape);
        for (let i = 0; i < n; i++) {
          const res = await ptyOpen({ cwd: abs });
          const id = String(typeof res === 'string' ? res : (res as any).ptyId ?? res);
          paneIds.push(id);
        }
        const assigned = shapeAssignPanes(session.layoutShape, paneIds);
        layout = assigned.node;
      } else {
        const res = await ptyOpen({ cwd: abs });
        paneIds = [String(typeof res === 'string' ? res : (res as any).ptyId ?? res)];
      }
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, cwd: abs, status: { ...t.status, fullPath: abs }, title: session.title ?? t.title, panes: paneIds, activePane: paneIds[0], layout } : t)));
      setActiveTab(tabId);
    } catch (e) {
      console.error('open session failed', e);
    }
  }

  async function openSshFor(tabId: string, opts: { host: string; port?: number; user: string; auth: { password?: string; keyPath?: string; passphrase?: string; agent?: boolean }; cwd?: string; profileId?: string }) {
    try {
      const sessionId = await sshConnect({ host: opts.host, port: opts.port ?? 22, user: opts.user, auth: { password: opts.auth.password, key_path: opts.auth.keyPath, passphrase: opts.auth.passphrase, agent: opts.auth.agent } as any, timeout_ms: 15000 });
      const chanId = await sshOpenShell({ sessionId, cwd: opts.cwd, cols: 120, rows: 30 });
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, kind: 'ssh', sshSessionId: sessionId, profileId: opts.profileId, cwd: opts.cwd ?? null, panes: [chanId], activePane: chanId, status: { ...t.status } } : t)));
      setActiveTab(tabId);
    } catch (e) {
      alert('SSH connection failed: ' + (e as any));
      console.error('ssh open failed', e);
    }
  }

  const active = tabs.find((t) => t.id === activeTab)!;
  // When switching tabs, ask panes to refit when shown
  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent('jaterm:panes-resized'));
    // Notify panes the tab became visible so they can scroll bottom after fit
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('jaterm:tab-shown'));
    }, 0);
  }, [activeTab]);

  // Persist workspace on changes (local tabs only)
  React.useEffect(() => {
    const ws = {
      activeTabIndex: Math.max(0, tabs.findIndex((t) => t.id === activeTab)),
      tabs: tabs
        .filter((t) => t.cwd && t.kind !== 'ssh')
        .map((t) => ({ cwd: t.status.fullPath ?? (t.cwd as string), title: t.title, layoutShape: layoutToShape(t.layout as any) })),
    };
    void saveAppState({ workspace: ws });
  }, [tabs, activeTab]);

  // Restore workspace on first load
  React.useEffect(() => {
    (async () => {
      try {
        const s = await loadAppState();
        const ws = s.workspace;
        if (ws && ws.tabs && ws.tabs.length) {
          // Prepare tabs
          const newTabs = ws.tabs.map(() => ({ id: crypto.randomUUID(), cwd: null as any, panes: [], activePane: null as any, status: {} as any, title: undefined as any, layout: undefined as any }));
          setTabs(newTabs);
          const targetIndex = Math.min(ws.activeTabIndex ?? 0, ws.tabs.length - 1);
          setActiveTab(newTabs[targetIndex].id);
          // Open each tab sequentially
          for (let i = 0; i < ws.tabs.length; i++) {
            const entry = ws.tabs[i];
            await openSessionFor(newTabs[i].id, { cwd: entry.cwd, layoutShape: entry.layoutShape, title: entry.title });
          }
        }
      } catch (e) {
        console.warn('workspace restore failed', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      // Avoid when typing in inputs/textareas
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // Split shortcuts: Meta+Shift+H/V
      if (meta && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
        e.preventDefault();
        const t = tabs.find((x) => x.id === activeTab);
        const pane = t?.activePane ?? (t?.panes[0] || null);
        if (pane) void (async () => splitPane(pane, 'row'))();
      }
      if (meta && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        const t = tabs.find((x) => x.id === activeTab);
        const pane = t?.activePane ?? (t?.panes[0] || null);
        if (pane) void (async () => splitPane(pane, 'column'))();
      }
      // Close active pane: Meta+W
      if (meta && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        const t = tabs.find((x) => x.id === activeTab);
        const pane = t?.activePane ?? (t?.panes[0] || null);
        if (pane) void closePane(pane);
      }
      // Switch panes: Meta+Alt+ArrowLeft/Right cycles
      if (meta && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const t = tabs.find((x) => x.id === activeTab);
        if (t && t.panes.length > 1) {
          const idx = t.panes.indexOf(t.activePane || t.panes[0]);
          const next = e.key === 'ArrowRight' ? (idx + 1) % t.panes.length : (idx - 1 + t.panes.length) % t.panes.length;
          setTabs((prev) => prev.map((tb) => (tb.id === activeTab ? { ...tb, activePane: t.panes[next] } : tb)));
        }
      }
      // New Tab: Meta+T
      if (meta && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        newTab();
      }
      // Next/Prev tab: Ctrl+Tab / Ctrl+Shift+Tab (Meta-less to avoid browser conflict in app window)
      if (e.ctrlKey && !e.metaKey && e.key === 'Tab') {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTab);
        if (idx !== -1) {
          const next = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
          setActiveTab(tabs[next].id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabs, activeTab]);
  return (
    <div className="app-root">
      <TabsBar
        tabs={tabs.map((t) => {
          const full = t.status.fullPath ?? t.cwd;
          const title = t.kind === 'ssh' ? (t.title ?? 'SSH') : (t.title ?? (full ?? 'Welcome'));
          return { id: t.id, title, isWelcome: !full && t.kind !== 'ssh' };
        })}
        activeId={activeTab}
        onSelect={setActiveTab}
        onClose={closeTab}
        onAdd={newTab}
      />
      {/* Render all tabs' content; hide inactive with display:none to preserve xterm buffers */}
      {tabs.map((t) => (
        <div key={t.id} style={{ display: t.id === activeTab ? 'block' : 'none', height: '100%' }}>
          {t.kind === 'ssh' ? (
            t.layout ? (
              <SplitTree
                node={t.layout as any}
                onChange={(n) => setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, layout: n } : tb)))}
                renderLeaf={(pid) => (
                  <RemoteTerminalPane
                    key={pid}
                    id={pid}
                    desiredCwd={t.status.fullPath ?? t.cwd ?? undefined}
                    onCwd={(_pid, dir) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, status: { ...tt.status, cwd: dir, fullPath: dir } } : tt)))}
                    onTitle={(_pid, title) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, title } : tt)))}
                    onFocusPane={(pane) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, activePane: pane } : tt)))}
                    onClose={closePane}
                    onSplit={(pane, dir) => splitPane(pane, dir)}
                  />
                )}
              />
            ) : (
              <SplitView>
                {t.panes.map((pid) => (
                  <RemoteTerminalPane
                    key={pid}
                    id={pid}
                    desiredCwd={t.status.fullPath ?? t.cwd ?? undefined}
                    onCwd={(_pid, dir) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, status: { ...tt.status, cwd: dir, fullPath: dir } } : tt)))}
                    onTitle={(_pid, title) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, title } : tt)))}
                    onFocusPane={(pane) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, activePane: pane } : tt)))}
                    onClose={closePane}
                    onSplit={(pane, dir) => splitPane(pane, dir)}
                  />
                ))}
              </SplitView>
            )
          ) : t.cwd ? (
            t.layout ? (
              <SplitTree
                node={t.layout as any}
                onChange={(n) => setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, layout: n } : tb)))}
                renderLeaf={(pid) => (
                  <TerminalPane
                    key={pid}
                    id={pid}
                    desiredCwd={t.status.fullPath ?? t.cwd ?? undefined}
                    onCwd={(_pid, dir) => updateTabCwd(t.id, dir)}
                    onTitle={(_pid, title) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, title } : tt)))}
                    onFocusPane={(pane) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, activePane: pane } : tt)))}
                    onClose={closePane}
                    onSplit={(pane, dir) => splitPane(pane, dir)}
                  />
                )}
              />
            ) : (
              <SplitView>
                {t.panes.map((pid) => (
                  <TerminalPane
                    key={pid}
                    id={pid}
                    desiredCwd={t.status.fullPath ?? t.cwd ?? undefined}
                    onCwd={(_pid, dir) => updateTabCwd(t.id, dir)}
                    onTitle={(_pid, title) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, title } : tt)))}
                    onFocusPane={(pane) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, activePane: pane } : tt)))}
                    onClose={closePane}
                    onSplit={(pane, dir) => splitPane(pane, dir)}
                  />
                ))}
              </SplitView>
            )
          ) : (
            <Welcome onOpenFolder={(p) => openFolderFor(t.id, p)} onOpenSession={(s) => openSessionFor(t.id, s)} onOpenSsh={(o) => openSshFor(t.id, o)} />
          )}
        </div>
      ))}
      {/* Single status bar for active tab */}
      <div className="status-bar" style={{ display: 'flex', gap: 12, alignItems: 'center', position: 'relative' }}>
        {active.cwd && <button onClick={newTerminal}>New Terminal</button>}
        {/* Offer zsh helper if no OSC7 observed yet */}
        {!active.status?.seenOsc7 && (
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
        <button onClick={() => openPathSystem(undefined)}>Open Config Folder</button>
        <button onClick={async () => openPathSystem((await import('@/types/ipc')).getConfigDir ? await (await import('@/types/ipc')).getConfigDir() : undefined)}>View state.json</button>
        {active.kind !== 'ssh' && (
          <GitStatusBar cwd={active.status.fullPath ?? active.status.cwd ?? active.cwd} branch={active.status.branch} ahead={active.status.ahead} behind={active.status.behind} staged={active.status.staged} unstaged={active.status.unstaged} />
        )}
        <ComposeDrawer
          open={composeOpen}
          onClose={() => setComposeOpen(false)}
          onSend={(text) => {
            if (active.activePane) {
              if (active.kind === 'ssh') sshWrite({ channelId: active.activePane, data: text });
              else ptyWrite({ ptyId: active.activePane, data: text });
            }
            setComposeOpen(false);
          }}
        />
      </div>
    </div>
  );
}
