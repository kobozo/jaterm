// Terminal profile types for managing different terminal configurations

export interface TerminalProfile {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  description?: string;
  
  // Shell configuration
  shell?: {
    program?: string;           // Shell executable path
    args?: string[];           // Shell arguments
    env?: Record<string, string>; // Environment variables
    cwd?: string;              // Working directory
  };
  
  // Terminal appearance
  appearance?: {
    fontSize?: number;
    fontFamily?: string;
    lineHeight?: number;
    cursorStyle?: 'block' | 'underline' | 'bar';
    cursorBlink?: boolean;
    theme?: string;
    scrollback?: number;
    bellStyle?: 'none' | 'visual' | 'sound' | 'both';
  };
  
  // Terminal behavior
  behavior?: {
    copyOnSelect?: boolean;
    rightClickSelectsWord?: boolean;
    pasteOnMiddleClick?: boolean;
    confirmPaste?: boolean;
    wordWrap?: boolean;
  };
  
  // Startup configuration
  startup?: {
    commands?: string[];       // Commands to run on startup
    script?: string;          // Script file to execute
    delay?: number;           // Delay before running commands (ms)
  };
  
  // Auto-detection rules
  autoDetect?: {
    patterns?: string[];      // Directory patterns (glob)
    gitBranch?: string[];    // Git branch patterns
    environment?: Record<string, string>; // Environment variable patterns
  };
  
  // Metadata
  isBuiltIn?: boolean;        // System-provided profile
  isDefault?: boolean;        // Default profile for new tabs
  createdAt?: string;
  updatedAt?: string;
}

// Built-in profile presets
export const BUILTIN_PROFILES: TerminalProfile[] = [
  {
    id: 'default',
    name: 'Default',
    icon: '🖥️',
    description: 'System default shell',
    isBuiltIn: true,
    isDefault: true
  },
  {
    id: 'bash',
    name: 'Bash',
    icon: '🐚',
    description: 'Bourne Again Shell',
    shell: {
      program: '/bin/bash',
      args: ['--login']
    },
    isBuiltIn: true
  },
  {
    id: 'zsh',
    name: 'Zsh',
    icon: '⚡',
    description: 'Z Shell',
    shell: {
      program: '/bin/zsh',
      args: ['-l']
    },
    isBuiltIn: true
  },
  {
    id: 'fish',
    name: 'Fish',
    icon: '🐠',
    description: 'Friendly Interactive Shell',
    shell: {
      program: '/usr/local/bin/fish',
      args: []
    },
    isBuiltIn: true
  },
  {
    id: 'node-dev',
    name: 'Node.js Development',
    icon: '📦',
    color: '#68a063',
    description: 'Node.js development environment',
    shell: {
      env: {
        NODE_ENV: 'development'
      }
    },
    appearance: {
      theme: 'monokai'
    },
    autoDetect: {
      patterns: ['**/package.json', '**/node_modules']
    },
    isBuiltIn: true
  },
  {
    id: 'python-dev',
    name: 'Python Development',
    icon: '🐍',
    color: '#3776ab',
    description: 'Python development environment',
    startup: {
      commands: ['source venv/bin/activate 2>/dev/null || true']
    },
    autoDetect: {
      patterns: ['**/requirements.txt', '**/pyproject.toml', '**/venv']
    },
    isBuiltIn: true
  },
  {
    id: 'rust-dev',
    name: 'Rust Development',
    icon: '🦀',
    color: '#ce412b',
    description: 'Rust development environment',
    shell: {
      env: {
        RUST_BACKTRACE: '1'
      }
    },
    autoDetect: {
      patterns: ['**/Cargo.toml', '**/Cargo.lock']
    },
    isBuiltIn: true
  }
];

// Profile validation
export function validateProfile(profile: Partial<TerminalProfile>): string[] {
  const errors: string[] = [];
  
  if (!profile.name || profile.name.trim() === '') {
    errors.push('Profile name is required');
  }
  
  if (profile.shell?.program && !profile.shell.program.startsWith('/')) {
    errors.push('Shell program must be an absolute path');
  }
  
  if (profile.appearance?.fontSize && (profile.appearance.fontSize < 8 || profile.appearance.fontSize > 72)) {
    errors.push('Font size must be between 8 and 72');
  }
  
  if (profile.appearance?.lineHeight && (profile.appearance.lineHeight < 0.5 || profile.appearance.lineHeight > 3)) {
    errors.push('Line height must be between 0.5 and 3');
  }
  
  return errors;
}

// Merge profile with defaults
export function mergeProfileWithDefaults(
  profile: Partial<TerminalProfile>,
  defaults: Partial<TerminalProfile>
): TerminalProfile {
  return {
    id: profile.id || crypto.randomUUID(),
    name: profile.name || 'Unnamed Profile',
    ...defaults,
    ...profile,
    shell: {
      ...defaults.shell,
      ...profile.shell,
      env: {
        ...defaults.shell?.env,
        ...profile.shell?.env
      }
    },
    appearance: {
      ...defaults.appearance,
      ...profile.appearance
    },
    behavior: {
      ...defaults.behavior,
      ...profile.behavior
    },
    startup: {
      ...defaults.startup,
      ...profile.startup
    },
    autoDetect: {
      ...defaults.autoDetect,
      ...profile.autoDetect
    }
  };
}

// Check if a path matches auto-detection rules
export function matchesAutoDetect(
  profile: TerminalProfile,
  context: {
    cwd?: string;
    gitBranch?: string;
    env?: Record<string, string>;
  }
): boolean {
  if (!profile.autoDetect) return false;
  
  // Check directory patterns
  if (profile.autoDetect.patterns && context.cwd) {
    // Simple pattern matching (would use minimatch in real implementation)
    for (const pattern of profile.autoDetect.patterns) {
      const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
      if (regex.test(context.cwd)) return true;
    }
  }
  
  // Check git branch patterns
  if (profile.autoDetect.gitBranch && context.gitBranch) {
    for (const pattern of profile.autoDetect.gitBranch) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      if (regex.test(context.gitBranch)) return true;
    }
  }
  
  // Check environment variables
  if (profile.autoDetect.environment && context.env) {
    for (const [key, pattern] of Object.entries(profile.autoDetect.environment)) {
      const value = context.env[key];
      if (value) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        if (regex.test(value)) return true;
      }
    }
  }
  
  return false;
}