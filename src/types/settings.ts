// Global application settings stored in config.json

export interface GlobalConfig {
  general: GeneralSettings;
  terminal: TerminalSettings;
  editor: EditorSettings;
  ssh: SshDefaultSettings;
  ai: AiSettings;
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

export interface AiSettings {
  enabled: boolean;
  defaultProvider: 'openai' | 'anthropic' | 'azure' | 'ollama' | 'huggingface';
  providers: {
    openai?: {
      apiKey: string; // Encrypted using existing system
      model: string; // gpt-4, gpt-3.5-turbo, etc.
      baseUrl?: string; // For OpenAI-compatible APIs
    };
    anthropic?: {
      apiKey: string; // Encrypted
      model: string; // claude-3-opus, claude-3-sonnet, etc.
    };
    azure?: {
      apiKey: string; // Encrypted
      endpoint: string;
      deploymentName: string;
      apiVersion: string;
    };
    ollama?: {
      baseUrl: string; // Default: http://localhost:11434
      model: string; // llama2, codellama, mistral, etc.
      keepAlive?: string; // How long to keep model in memory
    };
    huggingface?: {
      apiToken: string; // Encrypted
      model: string; // Model ID from HF Hub
      endpoint?: string; // For dedicated endpoints
    };
  };
  generation: {
    temperature: number;
    maxTokens: number;
    systemPrompt?: string; // Custom system prompt
  };
  privacy: {
    sendContext: boolean; // Send directory/git context
    storeHistory: boolean; // Store command history
    offlineOnly: boolean; // Only use local models
  };
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
  ai: {
    enabled: false,
    defaultProvider: 'ollama',
    providers: {
      ollama: {
        baseUrl: 'http://localhost:11434',
        model: 'llama2'
      }
    },
    generation: {
      temperature: 0.7,
      maxTokens: 2000
    },
    privacy: {
      sendContext: true,
      storeHistory: true,
      offlineOnly: false
    }
  },
  advanced: {
    logLevel: 'error',
    enableTelemetry: false,
    experimentalFeatures: false
  }
};