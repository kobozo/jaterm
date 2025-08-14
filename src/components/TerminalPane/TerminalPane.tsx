import React, { useEffect, useRef } from 'react';
import { useTerminal } from './useTerminal';
import '@xterm/xterm/css/xterm.css';
import { onPtyOutput, ptyResize, ptyWrite } from '@/types/ipc';
import { FitAddon } from '@xterm/addon-fit';

type Props = { id: string };

export default function TerminalPane({ id }: Props) {
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
    // Listen for backend PTY output
    let unlisten: (() => void) | undefined;
    onPtyOutput((e) => {
      if (e.ptyId === id) term.write(e.data);
    }).then((u) => (unlisten = u));
    return () => {
      sub.dispose();
      if (unlisten) unlisten();
    };
  }, [id, term]);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
