import React, { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { onSshExit, onSshOutput, sshResize, sshWrite, sshHomeDir } from '@/types/ipc';
import { useTerminal } from './TerminalPane/useTerminal';

type Props = {
  id: string; // channelId
  desiredCwd?: string;
  onCwd?: (id: string, cwd: string) => void;
  onFocusPane?: (id: string) => void;
  onClose?: (id: string) => void;
  onTitle?: (id: string, title: string) => void;
  onSplit?: (id: string, dir: 'row' | 'column') => void;
  sessionId?: string;
  onCompose?: () => void;
  onTerminalEvent?: (id: string, event: any) => void;
  terminalSettings?: { theme?: string; fontSize?: number; fontFamily?: string };
};

export default function RemoteTerminalPane({ id, desiredCwd, onCwd, onFocusPane, onClose, onTitle, onSplit, sessionId, onCompose, onTerminalEvent, terminalSettings }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { attach, dispose, term } = useTerminal(id, terminalSettings);
  const fitRef = useRef<FitAddon | null>(null);
  const correctedRef = useRef(false);
  const openedAtRef = useRef<number>(Date.now());
  const decoderRef = useRef<TextDecoder | null>(null);
  const IS_DEV = import.meta.env.DEV;
  
  // Keystroke buffering for better performance
  const writeBufferRef = useRef<string>('');
  const writeTimerRef = useRef<number | null>(null);
  
  // Buffered write function to batch rapid keystrokes
  const bufferedWrite = useRef((data: string) => {
    writeBufferRef.current += data;
    
    // Clear any existing timer
    if (writeTimerRef.current !== null) {
      clearTimeout(writeTimerRef.current);
    }
    
    // For single characters or short input, use a very short delay
    // For longer pastes, send immediately
    const delay = data.length > 10 ? 0 : 5;
    
    writeTimerRef.current = window.setTimeout(() => {
      if (writeBufferRef.current && id) {
        const toSend = writeBufferRef.current;
        writeBufferRef.current = '';
        sshWrite({ channelId: id, data: toSend });
        // Feed to event detector
        onTerminalEvent?.(id, { type: 'input', data: toSend });
      }
      writeTimerRef.current = null;
    }, delay);
  }).current;
  
  // Only allow a single correction per pane (on open), do not reset on cwd changes
  useEffect(() => { correctedRef.current = false; openedAtRef.current = Date.now(); }, [id]);
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  React.useEffect(() => {
    const onCloseMenu = () => setMenu(null);
    window.addEventListener('click', onCloseMenu);
    return () => window.removeEventListener('click', onCloseMenu);
  }, []);

  function b64ToUint8Array(b64: string): Uint8Array {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    return bytes;
  }

  function parseOsc7Cwds(s: string): string[] {
    const results: string[] = [];
    let i = 0;
    while (i < s.length) {
      const idx = s.indexOf("\x1b]7;file://", i);
      if (idx === -1) break;
      const start = idx + 11;
      let j = s.indexOf("\x07", start);
      let end = j;
      if (j === -1) {
        const st = s.indexOf("\x1b\\", start);
        end = st;
      }
      if (end && end > start) {
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
    if (IS_DEV) console.info('[ssh] attach terminal', id);
    attach(containerRef.current);
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    const raf = requestAnimationFrame(() => {
      fit.fit();
      if (id) sshResize({ channelId: id, cols: term.cols, rows: term.rows }).catch(() => {});
    });
    const onWinResize = () => {
      fit.fit();
    };
    window.addEventListener('resize', onWinResize);
    const paneResize = () => onWinResize();
    window.addEventListener('jaterm:panes-resized', paneResize as any);
    const onTabShown = () => {
      requestAnimationFrame(() => {
        try { fit.fit(); } catch {}
        try { (term as any).scrollToBottom?.(); } catch {}
        if (id) sshResize({ channelId: id, cols: term.cols, rows: term.rows });
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
    const sub = term.onData((data) => { 
      if (id) {
        bufferedWrite(data);
      }
    });
    const keySub = term.onKey(({ key, domEvent }) => {
      if ((domEvent.key === 'Enter' || domEvent.code === 'Enter') && domEvent.shiftKey) { 
        domEvent.preventDefault(); 
        if (id) {
          bufferedWrite('\n');
        }
      }
    });
    const elem = term.element as HTMLElement | null;
    const handleFocus = () => onFocusPane?.(id);
    elem?.addEventListener('focusin', handleFocus);
    elem?.addEventListener('mousedown', handleFocus);
    const resizeSub = term.onResize(({ cols, rows }) => { if (id) sshResize({ channelId: id, cols, rows }).catch(() => {}); });
    const titleSub = term.onTitleChange?.((title: string) => {
      if (IS_DEV) console.info('[ssh][title] raw=', title);
      onTitle?.(id, title);
      try {
        let candidate: string | null = null;
        // 1) Look for explicit home-relative path like ~/foo/bar
        const tilde = title.match(/~\/[\S]+/);
        if (tilde && tilde[0]) {
          candidate = tilde[0];
        } else if (title.startsWith('/') || /^[A-Za-z]:\\/.test(title) || title.startsWith('~')) {
          // 2) Whole title is a path-like
          candidate = title;
        } else {
          // 3) Extract last absolute path-like segment
          const matches = title.match(/\/[A-Za-z0-9_\-\.\/]+/g);
          if (matches && matches.length) candidate = matches[matches.length - 1];
        }
        if (candidate) {
          if (IS_DEV) console.info('[ssh][title] candidate=', candidate);
          if (candidate.startsWith('~')) {
            const rest = candidate.slice(1);
            if (sessionId) {
              sshHomeDir(sessionId).then((hd) => {
                const abs = hd.replace(/\/$/, '') + rest;
                if (IS_DEV) console.info('[ssh][title] cwd=', abs);
                onCwd?.(id, abs);
              }).catch(() => {});
            }
          } else if (candidate.startsWith('/') && sessionId) {
            // Heuristic: some prompts render home-relative as "/foo" (missing home prefix). Prefix with $HOME unless it's a known root path.
            const KNOWN_ROOTS = ['/home/', '/usr/', '/var/', '/etc/', '/opt/', '/bin/', '/sbin/', '/lib', '/tmp/', '/mnt/', '/media/', '/root/'];
            const looksRooted = KNOWN_ROOTS.some((p) => candidate.startsWith(p));
            sshHomeDir(sessionId).then((hd) => {
              const home = hd.replace(/\/$/, '') + '/';
              let abs = candidate;
              if (!candidate.startsWith(home) && !looksRooted) {
                abs = home + candidate.replace(/^\//, '');
              }
              if (IS_DEV) console.info('[ssh][title] cwd=', abs);
              onCwd?.(id, abs);
            }).catch(() => {
              if (IS_DEV) console.info('[ssh][title] cwd=', candidate);
              onCwd?.(id, candidate);
            });
          } else {
            if (IS_DEV) console.info('[ssh][title] cwd=', candidate);
            onCwd?.(id, candidate);
          }
        }
      } catch {}
    });
    let unlisten: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    onSshOutput((e) => {
      if (e.channelId !== id) return;
      if (e.dataBytes) {
        const bytes = b64ToUint8Array(e.dataBytes);
        try {
          if (!decoderRef.current) decoderRef.current = new TextDecoder('utf-8', { fatal: false });
          const dataStr = decoderRef.current.decode(bytes);
          const cwds = parseOsc7Cwds(dataStr);
          cwds.forEach((p) => {
            onCwd?.(id, p);
            const withinWindow = Date.now() - openedAtRef.current < 2500;
            if (!correctedRef.current && withinWindow && desiredCwd && p !== desiredCwd) {
              // Use direct write for cd commands to ensure they're sent immediately
              sshWrite({ channelId: id, data: `cd '${desiredCwd.replace(/'/g, "'\\''")}'\n` });
              correctedRef.current = true;
            }
          });
        } catch {}
        term.write(bytes);
        // Feed output to event detector using the same decoded string
        try {
          if (!decoderRef.current) decoderRef.current = new TextDecoder('utf-8', { fatal: false });
          const dataStr = decoderRef.current.decode(bytes);
          onTerminalEvent?.(id, { type: 'output', data: dataStr });
        } catch {}
      } else if (e.data) {
        const data = e.data as string;
        const cwds = parseOsc7Cwds(data);
        cwds.forEach((p) => {
          onCwd?.(id, p);
          const withinWindow = Date.now() - openedAtRef.current < 2500;
          if (!correctedRef.current && withinWindow && desiredCwd && p !== desiredCwd) {
            sshWrite({ channelId: id, data: `cd '${desiredCwd.replace(/'/g, "'\\''")}'\n` });
            correctedRef.current = true;
          }
        });
        term.write(data);
        // Feed output to event detector
        onTerminalEvent?.(id, { type: 'output', data });
      }
    }).then((u) => (unlisten = u));
    onSshExit((e) => { if (e.channelId === id) { if (IS_DEV) console.info('[ssh] exit', id); onClose?.(id); } }).then((u) => (unlistenExit = u));
    return () => {
      // Flush any pending writes before cleanup
      if (writeTimerRef.current !== null) {
        clearTimeout(writeTimerRef.current);
        if (writeBufferRef.current && id) {
          sshWrite({ channelId: id, data: writeBufferRef.current });
        }
      }
      sub.dispose();
      keySub.dispose();
      resizeSub.dispose();
      titleSub?.dispose?.();
      elem?.removeEventListener('focusin', handleFocus);
      elem?.removeEventListener('mousedown', handleFocus);
      if (unlisten) unlisten();
      if (unlistenExit) unlistenExit();
    };
  }, [id, term]);

  return (
    <div
      style={{ height: '100%', width: '100%', position: 'relative', boxSizing: 'border-box', border: '1px solid #444', borderRadius: 4, minHeight: 0, overflow: 'hidden' }}
      onMouseDown={() => onFocusPane?.(id)}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
    >
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
      {onClose && (
        <button onClick={() => onClose(id)} style={{ position: 'absolute', right: 6, top: 6, fontSize: 12 }} title="Close SSH terminal">×</button>
      )}
      {menu && (
        <div style={{ position: 'fixed', left: menu.x, top: menu.y, background: '#222', color: '#eee', border: '1px solid #444', borderRadius: 4, padding: 4, zIndex: 20, minWidth: 180 }}>
          <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={() => { onSplit?.(id, 'row'); setMenu(null); }}>Split Horizontally</div>
          <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={() => { onSplit?.(id, 'column'); setMenu(null); }}>Split Vertically</div>
          <div style={{ height: 1, background: '#444', margin: '4px 0' }} />
          <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={() => { onCompose?.(); setMenu(null); }}>Compose with AI</div>
          <div style={{ height: 1, background: '#444', margin: '4px 0' }} />
          <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={async () => { try { const sel = term.getSelection?.() || ''; if (sel) await navigator.clipboard.writeText(sel); } catch {} setMenu(null); }}>Copy Selection</div>
          <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={async () => { try { const text = await navigator.clipboard.readText(); if (text) bufferedWrite(text); } catch {} setMenu(null); }}>Paste</div>
          <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={() => { try { (term as any).selectAll?.(); } catch {} setMenu(null); }}>Select All</div>
          <div style={{ padding: '6px 10px', cursor: 'pointer' }} onClick={() => { try { term.clear?.(); } catch {} setMenu(null); }}>Clear</div>
          <div style={{ height: 1, background: '#444', margin: '4px 0' }} />
          <div style={{ padding: '6px 10px', cursor: 'pointer', color: '#ff7777' }} onClick={() => { onClose?.(id); setMenu(null); }}>Close Pane</div>
        </div>
      )}
    </div>
  );
}
