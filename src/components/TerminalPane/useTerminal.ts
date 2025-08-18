import { useCallback, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';

export function useTerminal(id: string) {
  const term = useMemo(() => new Terminal({
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    cursorBlink: true,
    allowProposedApi: false,
    convertEol: false,
    scrollback: 5000,
    bellStyle: 'none',
  }), [id]);

  const attach = useCallback((el: HTMLDivElement) => {
    term.open(el);
    // focus so typing works
    term.focus();
  }, [term]);

  const dispose = useCallback(() => {
    term.dispose();
  }, [term]);

  return { attach, dispose, term };
}
