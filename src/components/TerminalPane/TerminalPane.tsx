import React, { useEffect, useRef } from 'react';
import { useTerminal } from './useTerminal';
import '@xterm/xterm/css/xterm.css';
import { onPtyExit, onPtyOutput, ptyResize, ptyWrite } from '@/types/ipc';
import { homeDir } from '@tauri-apps/api/path';
import { FitAddon } from '@xterm/addon-fit';

type Props = { id: string; desiredCwd?: string; onCwd?: (id: string, cwd: string) => void; onFocusPane?: (id: string) => void; onClose?: (id: string) => void; onTitle?: (id: string, title: string) => void; onSplit?: (id: string, dir: 'row' | 'column') => void; onCompose?: () => void };

export default function TerminalPane({ id, desiredCwd, onCwd, onFocusPane, onClose, onTitle, onSplit, onCompose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { attach, dispose, term } = useTerminal(id);
  const fitRef = useRef<FitAddon | null>(null);
  const correctedRef = useRef(false);
  useEffect(() => { correctedRef.current = false; }, [id, desiredCwd]);

  function b64ToUint8Array(b64: string): Uint8Array {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    return bytes;
  }

  function parseOsc7Cwds(s: string): string[] {
    // OSC 7 format: ESC ] 7 ; file://<host><path> BEL or ST
    // We extract <path>
    const results: string[] = [];
    let i = 0;
    while (i < s.length) {
      const idx = s.indexOf("\x1b]7;file://", i);
      if (idx === -1) break;
      const start = idx + 11; // after prefix
      // find terminator: BEL (\x07) or ST (ESC \\)
      let j = s.indexOf("\x07", start);
      let end = j;
      if (j === -1) {
        const st = s.indexOf("\x1b\\", start);
        end = st;
      }
      if (end && end > start) {
        // path starts after host, which ends at first '/' after start
        const firstSlash = s.indexOf('/', start);
        if (firstSlash !== -1 && firstSlash < end) {
          const path = s.slice(firstSlash, end);
          results.push(path);
        }
        i = end + 1;
      } else {
        break;
      }
    }
    return results;
  }

  useEffect(() => {
    if (!containerRef.current) return;
    attach(containerRef.current);

    // Load fit addon and size to container
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);

    // Defer first fit until layout settled
    const raf = requestAnimationFrame(() => {
      fit.fit();
      if (id) ptyResize({ ptyId: id, cols: term.cols, rows: term.rows });
    });

    const onWinResize = () => {
      const prevCols = term.cols;
      const prevRows = term.rows;
      fit.fit();
      // ptyResize is sent via term.onResize handler below
    };
    window.addEventListener('resize', onWinResize);
    const paneResize = () => onWinResize();
    window.addEventListener('jaterm:panes-resized', paneResize as any);
    const onTabShown = () => {
      // After becoming visible, refit and scroll to bottom
      requestAnimationFrame(() => {
        try { fit.fit(); } catch {}
        try { (term as any).scrollToBottom?.(); } catch {}
        if (id) ptyResize({ ptyId: id, cols: term.cols, rows: term.rows });
      });
    };
    window.addEventListener('jaterm:tab-shown', onTabShown as any);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onWinResize);
      window.removeEventListener('jaterm:panes-resized', paneResize as any);
      window.removeEventListener('jaterm:tab-shown', onTabShown as any);
      dispose();
    };
  }, [attach, dispose, id, term]);

  useEffect(() => {
    // Forward user input to backend
    const sub = term.onData((data) => {
      if (id) ptyWrite({ ptyId: id, data });
    });
    // Intercept Shift+Enter and send LF (\n) instead of default CR
    const keySub = term.onKey(({ key, domEvent }) => {
      if ((domEvent.key === 'Enter' || domEvent.code === 'Enter') && domEvent.shiftKey) {
        domEvent.preventDefault();
        if (id) ptyWrite({ ptyId: id, data: '\n' });
      }
    });
    // Track focus via DOM focus/mouse events (xterm has no onFocus API)
    const elem = term.element as HTMLElement | null;
    const handleFocus = () => onFocusPane?.(id);
    elem?.addEventListener('focusin', handleFocus);
    elem?.addEventListener('mousedown', handleFocus);
    // Send resize events only when term reports size change
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (id) ptyResize({ ptyId: id, cols, rows });
    });
    // Title changes via OSC 0/2
    const titleSub = term.onTitleChange?.((title: string) => {
      console.debug('[title] pane', id, title);
      onTitle?.(id, title);
      // Heuristic: if title looks like an absolute path, treat it as cwd fallback
      try {
        const looksPath = title.startsWith('/') || /^[A-Za-z]:\\/.test(title) || title.startsWith('~');
        if (looksPath) {
          if (title.startsWith('~')) {
            const rest = title.slice(1);
            homeDir().then((hd) => {
              const abs = (hd.replace(/\/$/, '')) + rest;
              onCwd?.(id, abs);
            }).catch(() => {});
          } else {
            onCwd?.(id, title);
          }
        }
      } catch {}
    });
    // Listen for backend PTY output and parse OSC 7 CWD
    let unlisten: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    onPtyOutput((e: any) => {
      if (e.ptyId !== id) return;
      if (e.dataBytes) {
        const bytes = b64ToUint8Array(e.dataBytes);
        // Parse OSC 7 in the decoded string for cwd updates
        try {
          const dataStr = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
          const cwds = parseOsc7Cwds(dataStr);
          cwds.forEach((p) => {
            console.debug('[osc7] pane', id, 'cwd', p);
            onCwd?.(id, p);
            if (!correctedRef.current && desiredCwd && p !== desiredCwd) {
              console.debug('[cwd-correct] pane', id, 'expected', desiredCwd, 'got', p);
              ptyWrite({ ptyId: id, data: `cd '${desiredCwd.replace(/'/g, "'\\''")}'\n` });
              correctedRef.current = true;
            }
          });
        } catch {}
        term.write(bytes);
      } else if (e.data) {
        const data = e.data as string;
        const cwds = parseOsc7Cwds(data);
        cwds.forEach((p) => {
          console.debug('[osc7] pane', id, 'cwd', p);
          onCwd?.(id, p);
          if (!correctedRef.current && desiredCwd && p !== desiredCwd) {
            console.debug('[cwd-correct] pane', id, 'expected', desiredCwd, 'got', p);
            ptyWrite({ ptyId: id, data: `cd '${desiredCwd.replace(/'/g, "'\\''")}'\n` });
            correctedRef.current = true;
          }
        });
        term.write(data);
      }
    }).then((u) => (unlisten = u));
    onPtyExit((e) => {
      if (e.ptyId === id) {
        console.debug('[pty] exit', id);
        onClose?.(id);
      }
    }).then((u) => (unlistenExit = u));
    return () => {
      sub.dispose();
      elem?.removeEventListener('focusin', handleFocus);
      elem?.removeEventListener('mousedown', handleFocus);
      keySub.dispose();
      resizeSub.dispose();
      titleSub?.dispose?.();
      if (unlisten) unlisten();
      if (unlistenExit) unlistenExit();
    };
  }, [id, term]);

  const [menu, setMenu] = React.useState<{x:number;y:number}|null>(null);
  const onCtx = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };
  React.useEffect(() => {
    const onCloseMenu = () => setMenu(null);
    window.addEventListener('click', onCloseMenu);
    return () => window.removeEventListener('click', onCloseMenu);
  }, []);

  // Context menu actions
  const copySelection = async () => {
    try {
      const sel = term.getSelection?.() || '';
      if (sel) await navigator.clipboard.writeText(sel);
    } catch {}
  };
  const pasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) ptyWrite({ ptyId: id, data: text });
    } catch {}
  };
  const selectAll = () => {
    try { (term as any).selectAll?.(); } catch {}
  };
  const clearBuffer = () => {
    try { term.clear?.(); } catch {}
  };

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        boxSizing: 'border-box',
        border: '1px solid #444',
        borderRadius: 4,
        minHeight: 0,
        overflow: 'hidden',
      }}
      onMouseDown={() => onFocusPane?.(id)}
      onContextMenu={onCtx}
    >
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
      {onClose && (
        <button
          onClick={() => onClose(id)}
          style={{ position: 'absolute', right: 6, top: 6, fontSize: 12 }}
          title="Close terminal"
        >
          ×
        </button>
      )}
      {menu && (
        <div style={{ position: 'fixed', left: menu.x, top: menu.y, background: '#222', color: '#eee', border: '1px solid #444', borderRadius: 4, padding: 4, zIndex: 20, minWidth: 180 }}>
          <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={() => { onSplit?.(id, 'row'); setMenu(null); }}>Split Horizontally</div>
          <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={() => { onSplit?.(id, 'column'); setMenu(null); }}>Split Vertically</div>
          <div style={{ height: 1, background: '#444', margin: '4px 0' }} />
          <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={() => { onCompose?.(); setMenu(null); }}>Compose with AI</div>
          <div style={{ height: 1, background: '#444', margin: '4px 0' }} />
          <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={() => { copySelection(); setMenu(null); }}>Copy Selection</div>
          <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={() => { pasteClipboard(); setMenu(null); }}>Paste</div>
          <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={() => { selectAll(); setMenu(null); }}>Select All</div>
          <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={() => { clearBuffer(); setMenu(null); }}>Clear</div>
          <div style={{ height: 1, background: '#444', margin: '4px 0' }} />
          <div style={{ padding: '6px 10px', cursor: 'pointer', color: '#ff7777' }} onClick={() => { onClose?.(id); setMenu(null); }}>Close Pane</div>
        </div>
      )}
    </div>
  );
}
