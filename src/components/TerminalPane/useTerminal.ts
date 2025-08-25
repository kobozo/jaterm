import { useCallback, useMemo, useEffect, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { applyThemeToTerminal } from '@/config/themes';
import { getCachedConfig } from '@/services/settings';
import { DEFAULT_CONFIG } from '@/types/settings';

export function useTerminal(id: string, options?: { theme?: string; fontSize?: number; fontFamily?: string }) {
  // Get global settings or use defaults
  const globalConfig = getCachedConfig();
  const terminalDefaults = globalConfig?.terminal || DEFAULT_CONFIG.terminal;

  const term = useMemo(() => new Terminal({
    fontFamily: options?.fontFamily || terminalDefaults.fontFamily,
    fontSize: options?.fontSize || terminalDefaults.fontSize,
    lineHeight: terminalDefaults.lineHeight,
    cursorBlink: terminalDefaults.cursorBlink,
    cursorStyle: terminalDefaults.cursorStyle,
    allowProposedApi: false,
    convertEol: false,
    scrollback: terminalDefaults.scrollback,
    bellStyle: terminalDefaults.bellStyle,
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
