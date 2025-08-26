// Global application settings stored in config.json

export interface GlobalConfig {
  general: GeneralSettings;
  terminal: TerminalSettings;
  editor: EditorSettings;
  ssh: SshDefaultSettings;
  advanced: AdvancedSettings;
}

export interface GeneralSettings {
  autoCheckUpdates: boolean;
  defaultShell?: string;
  defaultWorkingDir: 'home' | 'lastUsed' | 'custom';
  customWorkingDir?: string;
  autoSaveState: boolean;
  stateInterval: number; // seconds
}

export interface TerminalSettings {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
  theme: string;
  scrollback: number;
  bellStyle: 'none' | 'visual' | 'sound' | 'both';
  copyOnSelect: boolean;
  rightClickSelectsWord: boolean;
  pasteOnMiddleClick: boolean;
  confirmPaste: boolean;
}

export interface EditorSettings {
  wordWrap: boolean;
  showLineNumbers: boolean;
  highlightActiveLine: boolean;
}

export interface SshDefaultSettings {
  defaultPort: number;
  keepaliveInterval: number;
  compression: boolean;
  x11Forwarding: boolean;
  agentForwarding: boolean;
  autoReconnect: boolean;
  reconnectDelay: number;
  helperAutoConsent: 'ask' | 'always' | 'never';
}

export interface AdvancedSettings {
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  enableTelemetry: boolean;
  experimentalFeatures: boolean;
}

// Default configuration values
export const DEFAULT_CONFIG: GlobalConfig = {
  general: {
    autoCheckUpdates: true,
    defaultWorkingDir: 'home',
    autoSaveState: true,
    stateInterval: 60
  },
  terminal: {
    fontSize: 14,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: 1.2,
    cursorStyle: 'block',
    cursorBlink: true,
    theme: 'default',
    scrollback: 1000,
    bellStyle: 'visual',
    copyOnSelect: false,
    rightClickSelectsWord: true,
    pasteOnMiddleClick: true,
    confirmPaste: true
  },
  editor: {
    wordWrap: true,
    showLineNumbers: true,
    highlightActiveLine: true
  },
  ssh: {
    defaultPort: 22,
    keepaliveInterval: 30,
    compression: false,
    x11Forwarding: false,
    agentForwarding: false,
    autoReconnect: true,
    reconnectDelay: 5,
    helperAutoConsent: 'ask'
  },
  advanced: {
    logLevel: 'error',
    enableTelemetry: false,
    experimentalFeatures: false
  }
};