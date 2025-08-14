import React, { useEffect, useRef } from 'react';
import { useTerminal } from './useTerminal';
import '@xterm/xterm/css/xterm.css';
import { onPtyOutput, ptyResize, ptyWrite } from '@/types/ipc';
import { FitAddon } from '@xterm/addon-fit';

type Props = { id: string; onCwd?: (id: string, cwd: string) => void; onFocusPane?: (id: string) => void; onClose?: (id: string) => void };

export default function TerminalPane({ id, onCwd, onFocusPane, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { attach, dispose, term } = useTerminal(id);
  const fitRef = useRef<FitAddon | null>(null);

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
      if ((term.cols !== prevCols || term.rows !== prevRows) && id) {
        ptyResize({ ptyId: id, cols: term.cols, rows: term.rows });
      }
    };
    window.addEventListener('resize', onWinResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onWinResize);
      dispose();
    };
  }, [attach, dispose, id, term]);

  useEffect(() => {
    // Forward user input to backend
    const sub = term.onData((data) => {
      if (id) ptyWrite({ ptyId: id, data });
    });
    // Track focus
    const focusSub = term.onFocus(() => onFocusPane?.(id));
    // Listen for backend PTY output and parse OSC 7 CWD
    let unlisten: (() => void) | undefined;
    onPtyOutput((e) => {
      if (e.ptyId === id) {
        const data = e.data as string;
        // Parse OSC 7 sequences: ESC ] 7;file://host/path BEL or ESC \
        const regex = /\x1b\]7;file:\/\/[^/]*\/(.*?)\x07|\x1b\\/g;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(data))) {
          const p = m[1];
          if (p) onCwd?.(id, '/' + p);
        }
        term.write(data);
      }
    }).then((u) => (unlisten = u));
    return () => {
      sub.dispose();
      focusSub.dispose();
      if (unlisten) unlisten();
    };
  }, [id, term]);

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
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
    </div>
  );
}
