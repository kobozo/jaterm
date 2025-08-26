import { useCallback, useMemo, useEffect, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { CanvasAddon } from '@xterm/addon-canvas';
import { applyThemeToTerminal } from '@/config/themes';
import { getCachedConfig } from '@/services/settings';
import { DEFAULT_CONFIG } from '@/types/settings';
import { isMacOS } from '@/utils/platform';

export function useTerminal(id: string, options?: { theme?: string; fontSize?: number; fontFamily?: string }) {
  // Get global settings or use defaults
  const globalConfig = getCachedConfig();
  const terminalDefaults = globalConfig?.terminal || DEFAULT_CONFIG.terminal;

  const term = useMemo(() => new Terminal({
    fontFamily: options?.fontFamily || terminalDefaults.fontFamily,
    fontSize: options?.fontSize || terminalDefaults.fontSize,
    cursorBlink: terminalDefaults.cursorBlink,
    cursorStyle: terminalDefaults.cursorStyle,
    allowProposedApi: false,
    convertEol: false,
    scrollback: terminalDefaults.scrollback,
    bellStyle: terminalDefaults.bellStyle,
  }), [id]);

  const attach = useCallback((el: HTMLDivElement) => {
    term.open(el);
    
    // On macOS, use the Canvas addon instead of WebGL to avoid WKWebView rendering issues
    // This prevents missing/slow keystrokes in release builds
    // The Canvas addon provides better compatibility with Safari/WKWebView
    if (isMacOS()) {
      const canvasAddon = new CanvasAddon();
      term.loadAddon(canvasAddon);
    }
    
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
