import { useCallback, useMemo, useEffect, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { CanvasAddon } from '@xterm/addon-canvas';
import { SerializeAddon } from '@xterm/addon-serialize';
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
    lineHeight: terminalDefaults.lineHeight,
    cursorBlink: terminalDefaults.cursorBlink,
    cursorStyle: terminalDefaults.cursorStyle,
    allowProposedApi: false,
    convertEol: false,
    scrollback: terminalDefaults.scrollback,
    bellStyle: terminalDefaults.bellStyle,
  }), [id]);

  // Add serialize addon for buffer capture
  const serializeAddon = useMemo(() => new SerializeAddon(), []);

  const attach = useCallback((el: HTMLDivElement) => {
    term.open(el);
    
    // Load serialize addon for buffer capture
    try {
      term.loadAddon(serializeAddon);
    } catch (e) {
      console.warn('Failed to load Serialize addon:', e);
    }
    
    // On macOS, use the Canvas addon instead of WebGL to avoid WKWebView rendering issues
    // This prevents missing/slow keystrokes in release builds
    // The Canvas addon provides better compatibility with Safari/WKWebView
    if (isMacOS()) {
      try {
        const canvasAddon = new CanvasAddon();
        term.loadAddon(canvasAddon);
      } catch (e) {
        // Addon might already be loaded or not compatible
        console.warn('Failed to load Canvas addon:', e);
      }
    }
    
    // Apply theme if specified
    if (options?.theme) {
      applyThemeToTerminal(term, options.theme);
    }
    // focus so typing works
    term.focus();
  }, [term, serializeAddon, options]);

  const dispose = useCallback(() => {
    term.dispose();
  }, [term]);

  return { attach, dispose, term, serializeAddon };
}
