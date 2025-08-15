import React, { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { homeDir } from '@tauri-apps/api/path';
import { onSshExit, onSshOutput, sshResize, sshWrite } from '@/types/ipc';
import { useTerminal } from './TerminalPane/useTerminal';

type Props = {
  id: string; // channelId
  desiredCwd?: string;
  onCwd?: (id: string, cwd: string) => void;
  onFocusPane?: (id: string) => void;
  onClose?: (id: string) => void;
  onTitle?: (id: string, title: string) => void;
};

export default function RemoteTerminalPane({ id, desiredCwd, onCwd, onFocusPane, onClose, onTitle }: Props) {
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
    console.info('[ssh] attach terminal', id);
    attach(containerRef.current);
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    const raf = requestAnimationFrame(() => {
      fit.fit();
      if (id) sshResize({ channelId: id, cols: term.cols, rows: term.rows });
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
    const sub = term.onData((data) => { if (id) sshWrite({ channelId: id, data }); });
    const keySub = term.onKey(({ key, domEvent }) => {
      if ((domEvent.key === 'Enter' || domEvent.code === 'Enter') && domEvent.shiftKey) { domEvent.preventDefault(); if (id) sshWrite({ channelId: id, data: '\n' }); }
    });
    const elem = term.element as HTMLElement | null;
    const handleFocus = () => onFocusPane?.(id);
    elem?.addEventListener('focusin', handleFocus);
    elem?.addEventListener('mousedown', handleFocus);
    const resizeSub = term.onResize(({ cols, rows }) => { if (id) sshResize({ channelId: id, cols, rows }); });
    const titleSub = term.onTitleChange?.((title: string) => {
      onTitle?.(id, title);
      try {
        const looksPath = title.startsWith('/') || /^[A-Za-z]:\\/.test(title) || title.startsWith('~');
        if (looksPath) {
          if (title.startsWith('~')) {
            const rest = title.slice(1);
            homeDir().then((hd) => { const abs = hd.replace(/\/$/, '') + rest; onCwd?.(id, abs); }).catch(() => {});
          } else {
            onCwd?.(id, title);
          }
        }
      } catch {}
    });
    let unlisten: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    onSshOutput((e) => {
      // console debug to verify event flow
      // console.debug('[ssh] output event', e.channelId, e.dataBytes?.length ?? e.data?.length);
      if (e.channelId !== id) return;
      if (e.dataBytes) {
        const bytes = b64ToUint8Array(e.dataBytes);
        try {
          const dataStr = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
          const cwds = parseOsc7Cwds(dataStr);
          cwds.forEach((p) => {
            onCwd?.(id, p);
            if (!correctedRef.current && desiredCwd && p !== desiredCwd) {
              sshWrite({ channelId: id, data: `cd '${desiredCwd.replace(/'/g, "'\\''")}'\n` });
              correctedRef.current = true;
            }
          });
        } catch {}
        term.write(bytes);
      } else if (e.data) {
        const data = e.data as string;
        const cwds = parseOsc7Cwds(data);
        cwds.forEach((p) => {
          onCwd?.(id, p);
          if (!correctedRef.current && desiredCwd && p !== desiredCwd) {
            sshWrite({ channelId: id, data: `cd '${desiredCwd.replace(/'/g, "'\\''")}'\n` });
            correctedRef.current = true;
          }
        });
        term.write(data);
      }
    }).then((u) => (unlisten = u));
    onSshExit((e) => { if (e.channelId === id) { console.info('[ssh] exit', id); onClose?.(id); } }).then((u) => (unlistenExit = u));
    return () => {
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
    <div style={{ height: '100%', width: '100%', position: 'relative', boxSizing: 'border-box', border: '1px solid #444', borderRadius: 4, minHeight: 0, overflow: 'hidden' }} onMouseDown={() => onFocusPane?.(id)}>
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
      {onClose && (
        <button onClick={() => onClose(id)} style={{ position: 'absolute', right: 6, top: 6, fontSize: 12 }} title="Close SSH terminal">×</button>
      )}
    </div>
  );
}
