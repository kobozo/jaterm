import React, { useState } from 'react';
import SplitView from '@/components/SplitView';
import TerminalPane from '@/components/TerminalPane/TerminalPane';
import RemoteTerminalPane from '@/components/RemoteTerminalPane';
import GitStatusBar from '@/components/GitStatusBar';
import GitTools from '@/components/GitTools';
import PortsPanel from '@/components/PortsPanel';
import Welcome from '@/components/Welcome';
import type { LayoutShape } from '@/store/sessions';
import ComposeDrawer from '@/components/ComposeDrawer';
import TabsBar from '@/components/TabsBar';
import SplitTree, { LayoutNode, LayoutSplit, LayoutLeaf } from '@/components/SplitTree';
import Toaster from '@/components/Toaster';
import { addRecent } from '@/store/recents';
import { saveAppState, loadAppState } from '@/store/persist';
import { addRecentSession } from '@/store/sessions';
import { appQuit, installZshOsc7, installBashOsc7, installFishOsc7, openPathSystem, ptyOpen, ptyKill, ptyWrite, resolvePathAbsolute, sshCloseShell, sshConnect, sshDisconnect, sshOpenShell, sshWrite } from '@/types/ipc';
import { useToasts } from '@/store/toasts';
import { ensureHelper, ensureLocalHelper } from '@/services/helper';
import { gitStatusViaHelper } from '@/services/git';

export default function App() {
  // imported above
  type LayoutShapeLeaf = { type: 'leaf' };
  type LayoutShapeSplit = { type: 'split'; direction: 'row' | 'column'; children: LayoutShape[] };
  type LayoutShape = LayoutShapeLeaf | LayoutShapeSplit;
  type Tab = {
    id: string;
    kind?: 'local' | 'ssh';
    sshSessionId?: string;
    profileId?: string;
    openPath?: string | null;
    cwd: string | null;
    panes: string[];
    activePane: string | null;
    status: { cwd?: string | null; fullPath?: string | null; branch?: string; ahead?: number; behind?: number; staged?: number; unstaged?: number; seenOsc7?: boolean; helperOk?: boolean; helperVersion?: string; helperChecked?: boolean; helperPath?: string | null };
    title?: string;
    view?: 'terminal' | 'git' | 'ports';
    forwards?: { id: string; type: 'L' | 'R'; srcHost: string; srcPort: number; dstHost: string; dstPort: number; status?: 'starting'|'active'|'error'|'closed' }[];
    detectedPorts?: number[];
  };
  const [tabs, setTabs] = useState<Tab[]>([{ id: crypto.randomUUID(), cwd: null, panes: [], activePane: null, status: {} }]);
  const [activeTab, setActiveTab] = useState<string>(tabs[0].id);
  const [composeOpen, setComposeOpen] = useState(false);
  const { show, update, dismiss } = useToasts();

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
      // Ensure local helper in background and record status
      try {
        (ensureLocalHelper as any)?.()?.then((res: any) => {
          setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: { ...t.status, helperOk: !!res?.ok, helperVersion: res?.version, helperPath: res?.path, helperChecked: true } } : t)));
        });
      } catch {}
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
    // Precompute whether we should record an SSH recent after state update
    const shouldRecordSshRecent = !!(t && t.kind === 'ssh' && (t as any).profileId);
    const sshProfileId = (t as any)?.profileId as string | undefined;
    const sshOpenPath = (t as any)?.openPath as string | undefined;
    const sshPathAtClosePre = (t?.status?.fullPath ?? t?.cwd) as string | undefined;
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
    // If this was an SSH tab and we just closed its last pane, close the tab; saving happens in closeTab
    let wasLastPaneFlag = false;
    try {
      const current = tabs.find((x) => x.id === activeTab);
      const wasLastPane = current ? current.panes.length === 1 : false;
      wasLastPaneFlag = wasLastPane;
    } catch {}
    // Always auto-close the SSH tab if no panes remain (parity with local)
    if (t?.kind === 'ssh' && wasLastPaneFlag) {
      setTimeout(() => closeTab(activeTab), 0);
    }
  }

  async function updateTabCwd(tabId: string, dir: string) {
    // Resolve to absolute for local sessions only; SSH paths are remote and should not be resolved locally
    let abs = dir;
    const tcur = tabs.find((x) => x.id === tabId);
    const isSsh = tcur?.kind === 'ssh';
    let sshHome: string | undefined = undefined;
    if (!isSsh) {
      try {
        const mod = await import('@/types/ipc');
        abs = await (mod as any).resolvePathAbsolute(dir);
      } catch {}
    } else {
      // Normalize SSH path with remote home if looks home-relative like "/foo" or starts with "~/"
      try {
        const mod = await import('@/types/ipc');
        sshHome = tcur?.sshSessionId ? await (mod as any).sshHomeDir(tcur.sshSessionId) : undefined;
        if (sshHome) {
          if (abs.startsWith('~/')) {
            abs = sshHome.replace(/\/$/, '') + abs.slice(1);
          } else {
            const isKnownRoot = /^\/(home|usr|var|etc|opt|bin|sbin|lib|tmp|mnt|media|root)\//.test(abs);
            if (!isKnownRoot && !abs.startsWith(sshHome.replace(/\/$/, '') + '/')) {
              abs = sshHome.replace(/\/$/, '') + '/' + abs.replace(/^\//, '');
            }
          }
        }
      } catch {}
    }
    // Store cwd and ensure helperPath for SSH if we derived a home
    setTabs((prev) => prev.map((t) => {
      if (t.id !== tabId) return t;
      const nextStatus: any = { ...t.status, cwd: abs, fullPath: abs, seenOsc7: true };
      if (isSsh && sshHome && !nextStatus.helperPath) {
        nextStatus.helperPath = sshHome.replace(/\/$/, '') + '/.jaterm-helper/jaterm-agent';
      }
      return { ...t, status: nextStatus };
    }));
    try {
      const t = tabs.find((x) => x.id === tabId);
      const helperPath = (t?.status?.helperPath as string | null) ?? (sshHome ? sshHome.replace(/\/$/, '') + '/.jaterm-helper/jaterm-agent' : null);
      console.info('[git] updateTabCwd git-status cwd=', abs, { tabId, kind: t?.kind, helperPath, sessionId: (t as any)?.sshSessionId });
      const st = await gitStatusViaHelper({ kind: t?.kind === 'ssh' ? 'ssh' : 'local', sessionId: (t as any)?.sshSessionId, helperPath }, abs);
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: { ...t.status, cwd: abs, fullPath: abs, branch: st.branch, ahead: st.ahead, behind: st.behind, staged: st.staged, unstaged: st.unstaged, seenOsc7: true } } : t)));
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
    // SSH recents recorded below in a unified normalized form
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
    // Record SSH recent if opened from a profile (use final path normalization, prefer title-derived path if deeper when normalized)
    if (toRecord?.kind === 'ssh' && toRecord.profileId) {
      // Prefer parsing the tab title for the final cwd if present
      let path = (toRecord.status.fullPath ?? toRecord.cwd) as string | undefined;
      const rawTitle = toRecord.title as string | undefined;
      let titleCandidate: string | undefined;
      if (rawTitle) {
        const mTilde = rawTitle.match(/~\/[\S]+/);
        if (mTilde && mTilde[0]) titleCandidate = mTilde[0];
        if (!titleCandidate) {
          const mAbs = rawTitle.match(/\/[A-Za-z0-9_\-\.\/]+/g);
          if (mAbs && mAbs.length) titleCandidate = mAbs[mAbs.length - 1];
        }
      }
      if (path) {
        try {
          const mod = await import('@/types/ipc');
          // Try to resolve remote home; fallback to derive from helperPath
          let home: string | undefined = undefined;
          if (toRecord.sshSessionId) {
            try { home = await (mod as any).sshHomeDir(toRecord.sshSessionId); } catch {}
          }
          if (!home && toRecord.status?.helperPath) {
            const hp = toRecord.status.helperPath as string;
            const idx = hp.indexOf('/.jaterm-helper/');
            if (idx > 0) home = hp.slice(0, idx);
          }
          if (home) {
            // Expand tilde in path if present
            if (path.startsWith('~/')) {
              path = home.replace(/\/$/, '') + path.slice(1);
            }
            if (titleCandidate) {
              if (titleCandidate.startsWith('~/')) {
                titleCandidate = home.replace(/\/$/, '') + titleCandidate.slice(1);
              } else {
                const isRoot = /^\/(home|usr|var|etc|opt|bin|sbin|lib|tmp|mnt|media|root)\//.test(titleCandidate);
                if (!isRoot && titleCandidate.startsWith('/')) {
                  titleCandidate = home.replace(/\/$/, '') + '/' + titleCandidate.replace(/^\//, '');
                }
              }
            }
            const isKnownRoot = /^\/(home|usr|var|etc|opt|bin|sbin|lib|tmp|mnt|media|root)\//.test(path);
            if (!isKnownRoot && !path.startsWith(home.replace(/\/$/, '') + '/')) {
              path = home.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
            }
          }
        } catch {}
        // Only prefer title candidate if it was normalized (i.e., not starting with '~') and is deeper
        if (titleCandidate && !titleCandidate.startsWith('~/') && (!path || titleCandidate.length > path.length)) {
          path = titleCandidate;
        }
        console.info('[ssh][recents] save final path=', path);
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
      // Ensure local helper for restored sessions
      try {
        (ensureLocalHelper as any)?.()?.then((res: any) => {
          setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: { ...t.status, helperOk: !!res?.ok, helperVersion: res?.version, helperPath: res?.path, helperChecked: true } } : t)));
        });
      } catch {}
    } catch (e) {
      console.error('open session failed', e);
    }
  }

  async function openSshFor(tabId: string, opts: { host: string; port?: number; user: string; auth: { password?: string; keyPath?: string; passphrase?: string; agent?: boolean }; cwd?: string; profileId?: string }) {
    try {
      const sessionId = await sshConnect({ host: opts.host, port: opts.port ?? 22, user: opts.user, auth: { password: opts.auth.password, key_path: opts.auth.keyPath, passphrase: opts.auth.passphrase, agent: opts.auth.agent } as any, timeout_ms: 15000 });
      // Ensure helper in background (non-blocking) and record status in tab
      try {
        (ensureHelper as any)?.(sessionId, { show, update, dismiss })?.then((res: any) => {
          setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: { ...t.status, helperOk: !!res?.ok, helperVersion: res?.version, helperPath: res?.path } } : t)));
        });
      } catch {}
      const chanId = await sshOpenShell({ sessionId, cwd: opts.cwd, cols: 120, rows: 30 });
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, kind: 'ssh', sshSessionId: sessionId, profileId: opts.profileId, sshHost: opts.host, sshUser: opts.user, sshPort: opts.port ?? 22, openPath: opts.cwd ?? null, cwd: opts.cwd ?? null, panes: [chanId], activePane: chanId, status: { ...t.status } } : t)));
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

  // Listen for tunnel state updates
  React.useEffect(() => {
    (async () => {
      try {
        const { onTunnelState } = await import('@/types/ipc');
        const un = await onTunnelState((e) => {
          const { forwardId, status } = e as any;
          console.log('Tunnel state event:', forwardId, status);
          setTabs((prev) => prev.map((tb) => {
            const t = tb;
            const f = (t.forwards || []).map((x) => x.id === forwardId ? { ...x, status } : x);
            return { ...t, forwards: f };
          }));
        });
        return () => { try { (un as any)(); } catch {} };
      } catch {}
    })();
  }, []);

  // Listen for detected ports on SSH connection
  React.useEffect(() => {
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const unlisten = await listen('ssh_detected_ports', (event) => {
          const { sessionId, ports } = event.payload as any;
          console.log(`Detected ${ports.length} open ports on session ${sessionId}`);
          setTabs((prev) => prev.map((tb) => {
            if (tb.kind === 'ssh' && tb.sshSessionId === sessionId) {
              return { ...tb, detectedPorts: ports };
            }
            return tb;
          }));
        });
        return () => { unlisten(); };
      } catch {}
    })();
  }, []);

  // Periodic port detection for active SSH tabs
  React.useEffect(() => {
    const interval = setInterval(async () => {
      const currentTab = tabs.find(t => t.id === activeTab);
      if (currentTab?.kind === 'ssh' && currentTab.sshSessionId) {
        try {
          const { sshDetectPorts } = await import('@/types/ipc');
          const ports = await sshDetectPorts(currentTab.sshSessionId);
          console.log(`Periodic port detection found ${ports.length} ports`);
          // The event handler will update the state
        } catch (e) {
          console.error('Port detection failed:', e);
        }
      }
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [tabs, activeTab]);


  // Ensure local helper when a local tab becomes active and has a cwd, if not checked yet
  React.useEffect(() => {
    const t = tabs.find((x) => x.id === activeTab);
    if (!t) return;
    const hasCwd = !!(t.status?.fullPath || t.cwd);
    const isLocal = t.kind !== 'ssh';
    const checked = (t.status as any)?.helperChecked === true || typeof t.status?.helperOk !== 'undefined' || typeof t.status?.helperVersion !== 'undefined';
    if (isLocal && hasCwd && !checked) {
      (ensureLocalHelper as any)?.()?.then((res: any) => {
        setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, status: { ...tb.status, helperOk: !!res?.ok, helperVersion: res?.version, helperPath: res?.path, helperChecked: true } } : tb)));
      }).catch(() => {
        setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, status: { ...tb.status, helperOk: false, helperChecked: true } } : tb)));
      });
    }
  }, [tabs, activeTab]);

  // Auto-refresh Git status periodically for the active tab (only when inside a Git repo)
  React.useEffect(() => {
    const t = tabs.find((x) => x.id === activeTab);
    if (!t) return;
    const cwd = (t.status?.fullPath ?? t.cwd) as string | undefined;
    if (!cwd) return;
    // Only poll when we know we're inside a repo
    const inRepo = !!t.status && t.status.branch && t.status.branch !== '-';
    if (!inRepo) return;
    const kind = t.kind === 'ssh' ? 'ssh' : 'local';
    const sessionId = (t as any)?.sshSessionId as string | undefined;
    const helperPath = t.status?.helperPath ?? null;
    const refresh = async () => {
      try {
        const st = await gitStatusViaHelper({ kind: kind as any, sessionId, helperPath }, cwd);
        setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, status: { ...tb.status, branch: st.branch, ahead: st.ahead, behind: st.behind } } : tb)));
      } catch {}
    };
    const iv = window.setInterval(refresh, 5000);
    return () => window.clearInterval(iv);
    // Recreate interval when tab, path, helper, or ssh session changes
  }, [tabs, activeTab]);

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
      // Compose with AI: Meta/Ctrl+K
      if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setComposeOpen(true);
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
          <div style={{ display: 'flex', height: '100%', width: '100%' }}>
            {/* Sidebar */}
            <div style={{ width: 44, borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', gap: 6, padding: 6, boxSizing: 'border-box' }}>
              <button
                style={{ padding: 6, borderRadius: 4, border: '1px solid #444', background: (t.view ?? 'terminal') === 'terminal' ? '#2b2b2b' : 'transparent', color: '#ddd', cursor: 'pointer' }}
                onClick={() => {
                  setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, view: 'terminal' } : tb)));
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('jaterm:panes-resized'));
                    window.dispatchEvent(new CustomEvent('jaterm:tab-shown'));
                  }, 0);
                }}
                title="Terminal"
              >
                ⌘
              </button>
              <button
                style={{ padding: 6, borderRadius: 4, border: '1px solid #444', background: t.view === 'git' ? '#2b2b2b' : 'transparent', color: '#ddd', cursor: 'pointer' }}
                onClick={() => {
                  setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, view: 'git' } : tb)));
                }}
                title="Git Tools"
              >
                ⎇
              </button>
              {t.kind === 'ssh' && (
                <button
                  style={{ padding: 6, borderRadius: 4, border: '1px solid #444', background: t.view === 'ports' ? '#2b2b2b' : 'transparent', color: '#ddd', cursor: 'pointer' }}
                  onClick={() => setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, view: 'ports' } : tb)))}
                  title="Ports"
                >
                  ≣
                </button>
              )}
            </div>
            {/* Content: render both views and toggle visibility to preserve terminal DOM */}
            <div style={{ flex: 1, minWidth: 0, height: '100%', position: 'relative' }}>
              {/* Git view */}
              <div style={{ display: (t.view === 'git') ? 'block' : 'none', height: '100%' }}>
                <GitTools
                  cwd={t.status.fullPath ?? t.cwd ?? undefined}
                  kind={t.kind}
                  sessionId={(t as any).sshSessionId}
                  helperPath={t.status.helperPath}
                  title={t.title ?? null}
                  isActive={t.view === 'git'}
                  onStatus={(st) => setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, status: { ...tb.status, branch: st.branch, ahead: st.ahead, behind: st.behind } } : tb)))}
                />
              </div>
              {/* Ports view (kept mounted) */}
              <div style={{ display: (t.view === 'ports') ? 'block' : 'none', height: '100%' }}>
                <PortsPanel
                  forwards={t.forwards || []}
                  detectedPorts={t.detectedPorts || []}
                  suggestedPorts={[3000, 3001, 4000, 4200, 5173, 5174, 8000, 8080, 8081, 8888, 9000]}
                  onRefreshPorts={async () => {
                    if (t.kind !== 'ssh' || !t.sshSessionId) return;
                    try {
                      const { sshDetectPorts } = await import('@/types/ipc');
                      const ports = await sshDetectPorts(t.sshSessionId);
                      console.log(`Manual refresh found ${ports.length} ports`);
                    } catch (e) {
                      console.error('Port refresh failed:', e);
                    }
                  }}
                  onAdd={async (fwd) => {
                    if (t.kind !== 'ssh' || !t.sshSessionId) return;
                    const { sshOpenForward } = await import('@/types/ipc');
                    try {
                      const res: any = await sshOpenForward({ sessionId: t.sshSessionId, forward: { id: '', type: fwd.type, srcHost: fwd.srcHost, srcPort: fwd.srcPort, dstHost: fwd.dstHost, dstPort: fwd.dstPort } as any });
                      const fid = typeof res === 'string' ? res : (res?.forwardId || res);
                      setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, forwards: [ ...(tb.forwards || []), { ...fwd, id: fid, status: 'starting' } ] } : tb)));
                    } catch (e) { alert('open forward failed: ' + (e as any)); }
                  }}
                  onActivate={async (fwd) => {
                    if (t.kind !== 'ssh' || !t.sshSessionId) return;
                    const { sshOpenForward } = await import('@/types/ipc');
                    try {
                      const res: any = await sshOpenForward({ sessionId: t.sshSessionId, forward: { id: '', type: fwd.type, srcHost: fwd.srcHost, srcPort: fwd.srcPort, dstHost: fwd.dstHost, dstPort: fwd.dstPort } as any });
                      const fid = typeof res === 'string' ? res : (res?.forwardId || res);
                      setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, forwards: [ ...(tb.forwards || []), { ...fwd, id: fid, status: 'starting' } ] } : tb)));
                    } catch (e) { alert('activate forward failed: ' + (e as any)); }
                  }}
                  onStop={async (id) => {
                    const { sshCloseForward } = await import('@/types/ipc');
                    try { await sshCloseForward(id); } catch {}
                    setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, forwards: (tb.forwards || []).map((x) => x.id === id ? { ...x, status: 'closed' } : x) } : tb)));
                  }}
                  onDelete={(id) => {
                    setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, forwards: (tb.forwards || []).filter((x) => x.id !== id) } : tb)));
                  }}
                  onEdit={async (id, newFwd) => {
                    // Stop the old forward and create a new one
                    const { sshCloseForward, sshOpenForward } = await import('@/types/ipc');
                    try {
                      await sshCloseForward(id);
                      const res: any = await sshOpenForward({ sessionId: t.sshSessionId, forward: { id: '', type: newFwd.type, srcHost: newFwd.srcHost, srcPort: newFwd.srcPort, dstHost: newFwd.dstHost, dstPort: newFwd.dstPort } as any });
                      const fid = typeof res === 'string' ? res : (res?.forwardId || res);
                      setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { 
                        ...tb, 
                        forwards: tb.forwards?.map(f => f.id === id ? { ...newFwd, id: fid, status: 'starting' } : f) 
                      } : tb)));
                    } catch (e) { alert('edit forward failed: ' + (e as any)); }
                  }}
                />
              </div>
              {/* Terminal/Welcome view (kept mounted) */}
              <div style={{ display: (t.view === 'git' || t.view === 'ports') ? 'none' : 'block', height: '100%' }}>
                {t.kind === 'ssh' ? (
                  t.layout ? (
                    <SplitTree
                      node={t.layout as any}
                      onChange={(n) => setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, layout: n } : tb)))}
                      renderLeaf={(pid) => (
                        <RemoteTerminalPane
                          key={pid}
                          id={pid}
                          desiredCwd={undefined}
                          sessionId={(t as any).sshSessionId}
                          onCwd={(_pid, dir) => updateTabCwd(t.id, dir)}
                          onTitle={(_pid, title) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, title } : tt)))}
                          onFocusPane={(pane) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, activePane: pane } : tt)))}
                          onClose={closePane}
                          onSplit={(pane, dir) => splitPane(pane, dir)}
                          onCompose={() => setComposeOpen(true)}
                        />
                      )}
                    />
                  ) : (
                    <SplitView>
                      {t.panes.map((pid) => (
                        <RemoteTerminalPane
                          key={pid}
                          id={pid}
                          desiredCwd={undefined}
                          sessionId={(t as any).sshSessionId}
                          onCwd={(_pid, dir) => updateTabCwd(t.id, dir)}
                          onTitle={(_pid, title) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, title } : tt)))}
                          onFocusPane={(pane) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, activePane: pane } : tt)))}
                          onClose={closePane}
                          onSplit={(pane, dir) => splitPane(pane, dir)}
                          onCompose={() => setComposeOpen(true)}
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
                          onCompose={() => setComposeOpen(true)}
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
            </div>
          </div>
        </div>
      ))}
      {/* Single status bar for active tab */}
      <div className="status-bar" style={{ display: 'flex', gap: 12, alignItems: 'center', position: 'relative' }}>
        <GitStatusBar cwd={active.status.fullPath ?? active.status.cwd ?? active.cwd} branch={active.status.branch} ahead={active.status.ahead} behind={active.status.behind} />
        <span style={{ width: 1, height: 14, background: '#444', display: 'inline-block' }} />
        
        {/* Helper status aligned right with colored indicator */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span
            title={active.status.helperOk ? 'Helper OK' : 'Helper not ready'}
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: active.status.helperOk ? '#8fe18f' : '#f0a1a1',
              display: 'inline-block',
            }}
          />
          <span>Helper: {active.status.helperVersion ? active.status.helperVersion : '—'}</span>
        </div>
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
      <Toaster />
    </div>
  );
}
