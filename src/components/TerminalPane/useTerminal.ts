import { useCallback, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { applyThemeToTerminal } from '@/config/themes';

export function useTerminal(id: string, options?: { theme?: string; fontSize?: number; fontFamily?: string }) {
  const term = useMemo(() => new Terminal({
    fontFamily: options?.fontFamily || 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: options?.fontSize || 14,
    cursorBlink: true,
    allowProposedApi: false,
    convertEol: false,
    scrollback: 5000,
    bellStyle: 'none',
  }), [id]);

  const attach = useCallback((el: HTMLDivElement) => {
    term.open(el);
    // Apply theme if specified
    if (options?.theme) {
      applyThemeToTerminal(term, options.theme);
    }
    // focus so typing works
    term.focus();
  }, [term, options]);

  const dispose = useCallback(() => {
    term.dispose();
  }, [term]);

  return { attach, dispose, term };
}
