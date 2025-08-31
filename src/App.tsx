import React, { useState, useRef, useEffect } from 'react';
import SplitView from '@/components/SplitView';
import FileExplorerWithEditor from '@/components/FileExplorerWithEditor';
import TerminalPane from '@/components/TerminalPane/TerminalPane';
import RemoteTerminalPane from '@/components/RemoteTerminalPane';
import GitStatusBar from '@/components/GitStatusBar';
import GitTools from '@/components/GitTools';
import { SettingsPane } from '@/components/SettingsPane';
import PortsPanel from '@/components/PortsPanel';
import Sessions from '@/components/sessions';
import type { LayoutShape } from '@/store/sessions';
import ComposeDrawer from '@/components/ComposeDrawer';
import { CommandPalette } from '@/components/CommandPalette';
import { commandRegistry } from '@/services/commandRegistry';
import { Command, CommandCategory } from '@/types/commands';
import TabsBar from '@/components/TabsBar';
import SplitTree, { LayoutNode, LayoutSplit, LayoutLeaf } from '@/components/SplitTree';
import Toaster from '@/components/Toaster';
import { MasterKeyDialog } from '@/components/MasterKeyDialog';
import { addRecent } from '@/store/recents';
import { saveAppState, loadAppState } from '@/store/persist';
import { addRecentSession } from '@/store/sessions';
import { appQuit, installZshOsc7, installBashOsc7, installFishOsc7, openPathSystem, ptyOpen, ptyKill, ptyWrite, resolvePathAbsolute, sshCloseShell, sshConnect, sshDisconnect, sshOpenShell, sshWrite, sshSetPrimary, encryptionStatus, checkProfilesNeedMigration } from '@/types/ipc';
import { getCachedConfig, loadGlobalConfig, saveGlobalConfig } from '@/services/settings';
import { getThemeList } from '@/config/themes';
import { initEncryption, encryptionNeedsSetup, checkProfilesNeedMigrationV2, migrateProfilesV2 } from '@/services/api/encryption_v2';
import { useToasts } from '@/store/toasts';
import { ensureHelper, ensureLocalHelper } from '@/services/helper';
import { gitStatusViaHelper } from '@/services/git';
import { TerminalEventDetector, debounce } from '@/services/terminalEvents';
import HelperConsentModal from '@/components/HelperConsentModal';
import KeyGenerationModal from '@/components/KeyGenerationModal';
import { logger } from '@/services/logger';
import { telemetry, TelemetryEvent } from '@/services/telemetry';
import { featureFlags } from '@/services/features';

export default function App() {
  // imported above
  type LayoutShapeLeaf = { type: 'leaf' };
  type LayoutShapeSplit = { type: 'split'; direction: 'row' | 'column'; children: LayoutShape[] };
  type LayoutShape = LayoutShapeLeaf | LayoutShapeSplit;
  type Tab = {
    id: string;
    kind?: 'local' | 'ssh' | 'settings';
    sshSessionId?: string;
    profileId?: string;
    openPath?: string | null;
    cwd: string | null;
    panes: string[];
    activePane: string | null;
    primaryPane?: string | null; // Track which pane's session is primary for Git/SFTP
    status: { cwd?: string | null; fullPath?: string | null; branch?: string; ahead?: number; behind?: number; staged?: number; unstaged?: number; seenOsc7?: boolean; helperOk?: boolean; helperVersion?: string; helperChecked?: boolean; helperPath?: string | null };
    title?: string;
    view?: 'terminal' | 'git' | 'ports' | 'files';
    forwards?: { id: string; type: 'L' | 'R'; srcHost: string; srcPort: number; dstHost: string; dstPort: number; status?: 'starting'|'active'|'error'|'closed' }[];
    detectedPorts?: number[];
    sftpCwd?: string;
    indicator?: 'activity' | 'bell';
    terminalSettings?: { theme?: string; fontSize?: number; fontFamily?: string };
    reconnectState?: {
      isReconnecting: boolean;
      attempts: number;
      lastAttempt?: number;
      scheduledReconnect?: NodeJS.Timeout;
      maxAttempts?: number;
    };
    reconnectSettings?: {
      enabled: boolean;
      delay: number;
      auth: any;
      opts: any;
    };
  };
  const [sessionsId] = useState<string>(() => crypto.randomUUID());
  const [tabs, setTabs] = useState<Tab[]>([{ id: sessionsId, cwd: null, panes: [], activePane: null, status: {} }]);
  const tabsRef = useRef<Tab[]>(tabs);
  const [activeTab, setActiveTab] = useState<string>(sessionsId);
  const [composeOpen, setComposeOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  // Map channel IDs to SSH session IDs (for splits with independent connections)
  const [channelToSession, setChannelToSession] = useState<Record<string, string>>({});
  const [customPortDialog, setCustomPortDialog] = useState<{ sessionId: string; remotePort: number } | null>(null);
  // Master key dialog state
  const [masterKeyDialog, setMasterKeyDialog] = useState<{ isOpen: boolean; mode: 'setup' | 'unlock'; isMigration?: boolean }>({ isOpen: false, mode: 'setup' });
  // Helper consent modal state
  const [helperConsentModal, setHelperConsentModal] = useState<{ 
    sessionId: string; 
    profileId?: string; 
    profileName: string; 
    host: string;
    tabId: string;
    opts: any;
  } | null>(null);
  
  // SSH key generation modal state
  const [keyGenerationModal, setKeyGenerationModal] = useState<{
    sessionId: string;
    profileId: string;
    profileName: string;
    host: string;
    port: number;
    user: string;
  } | null>(null);
  
  // SSH profiles state for passing to Sessions component
  const [sshProfiles, setSshProfiles] = useState<any[]>([]);
  
  // Updater state
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<null | { version?: string }>(null);
  const { show, update, dismiss } = useToasts();
  const addToast = show;
  
  // Register commands for command palette
  const registerCommands = React.useCallback(() => {
    const commands: Command[] = [
      // Terminal commands
      {
        id: 'terminal.newTab',
        label: 'New Tab',
        category: CommandCategory.Terminal,
        icon: '➕',
        shortcut: 'Cmd/Ctrl+T',
        description: 'Open a new terminal tab',
        action: () => newTab(),
      },
      {
        id: 'terminal.closeTab',
        label: 'Close Tab',
        category: CommandCategory.Terminal,
        icon: '❌',
        shortcut: 'Cmd/Ctrl+W',
        description: 'Close the current tab',
        action: () => {
          if (activeTab && activeTab !== sessionsId) {
            closeTab(activeTab);
          }
        },
        enabled: () => activeTab !== sessionsId,
      },
      {
        id: 'terminal.splitHorizontal',
        label: 'Split Pane Horizontal',
        category: CommandCategory.Terminal,
        icon: '⬌',
        shortcut: 'Cmd/Ctrl+Shift+H',
        description: 'Split the current pane horizontally',
        action: () => {
          const t = tabs.find((x) => x.id === activeTab);
          const pane = t?.activePane ?? (t?.panes[0] || null);
          if (pane) splitPane(pane, 'row');
        },
        enabled: () => {
          const t = tabs.find((x) => x.id === activeTab);
          return Boolean(t && t.panes.length > 0);
        },
      },
      {
        id: 'terminal.splitVertical',
        label: 'Split Pane Vertical',
        category: CommandCategory.Terminal,
        icon: '⬍',
        shortcut: 'Cmd/Ctrl+Shift+V',
        description: 'Split the current pane vertically',
        action: () => {
          const t = tabs.find((x) => x.id === activeTab);
          const pane = t?.activePane ?? (t?.panes[0] || null);
          if (pane) splitPane(pane, 'column');
        },
        enabled: () => {
          const t = tabs.find((x) => x.id === activeTab);
          return Boolean(t && t.panes.length > 0);
        },
      },
      {
        id: 'terminal.nextTab',
        label: 'Next Tab',
        category: CommandCategory.Terminal,
        icon: '→',
        shortcut: 'Ctrl+Tab',
        description: 'Switch to the next tab',
        action: () => {
          const idx = tabs.findIndex((t) => t.id === activeTab);
          if (idx !== -1) {
            const next = (idx + 1) % tabs.length;
            setActiveTab(tabs[next].id);
          }
        },
      },
      {
        id: 'terminal.prevTab',
        label: 'Previous Tab',
        category: CommandCategory.Terminal,
        icon: '←',
        shortcut: 'Ctrl+Shift+Tab',
        description: 'Switch to the previous tab',
        action: () => {
          const idx = tabs.findIndex((t) => t.id === activeTab);
          if (idx !== -1) {
            const next = (idx - 1 + tabs.length) % tabs.length;
            setActiveTab(tabs[next].id);
          }
        },
      },
      
      // View commands
      {
        id: 'view.toggleGit',
        label: 'Toggle Git Panel',
        category: CommandCategory.View,
        icon: '🔀',
        description: 'Show/hide the Git panel',
        action: () => {
          const t = tabs.find((x) => x.id === activeTab);
          if (t) {
            const newView = t.view === 'git' ? 'terminal' : 'git';
            setTabs((prev) => prev.map((tb) => 
              tb.id === activeTab ? { ...tb, view: newView } : tb
            ));
          }
        },
        enabled: () => {
          const t = tabs.find((x) => x.id === activeTab);
          return Boolean(t && t.kind !== 'settings' && t.cwd);
        },
      },
      {
        id: 'view.toggleFiles',
        label: 'Toggle File Explorer',
        category: CommandCategory.View,
        icon: '📁',
        description: 'Show/hide the file explorer',
        action: () => {
          const t = tabs.find((x) => x.id === activeTab);
          if (t) {
            const newView = t.view === 'files' ? 'terminal' : 'files';
            setTabs((prev) => prev.map((tb) => 
              tb.id === activeTab ? { ...tb, view: newView } : tb
            ));
          }
        },
        enabled: () => {
          const t = tabs.find((x) => x.id === activeTab);
          return Boolean(t && t.kind !== 'settings');
        },
      },
      {
        id: 'view.togglePorts',
        label: 'Toggle Ports Panel',
        category: CommandCategory.View,
        icon: '🔌',
        description: 'Show/hide the ports panel',
        action: () => {
          const t = tabs.find((x) => x.id === activeTab);
          if (t) {
            const newView = t.view === 'ports' ? 'terminal' : 'ports';
            setTabs((prev) => prev.map((tb) => 
              tb.id === activeTab ? { ...tb, view: newView } : tb
            ));
          }
        },
        enabled: () => {
          const t = tabs.find((x) => x.id === activeTab);
          return Boolean(t && t.kind === 'ssh');
        },
      },
      
      // Settings commands
      {
        id: 'settings.open',
        label: 'Open Settings',
        category: CommandCategory.Settings,
        icon: '⚙️',
        description: 'Open the settings panel',
        action: () => {
          // Check if settings tab already exists
          const settingsTab = tabs.find(t => t.kind === 'settings');
          if (settingsTab) {
            setActiveTab(settingsTab.id);
          } else {
            const id = crypto.randomUUID();
            setTabs((prev) => [...prev, { 
              id, 
              kind: 'settings', 
              cwd: null, 
              panes: [], 
              activePane: null, 
              status: {} 
            }]);
            setActiveTab(id);
          }
        },
      },
      
      // Session commands  
      {
        id: 'session.openWelcome',
        label: 'Open Welcome Screen',
        category: CommandCategory.Session,
        icon: '🏠',
        description: 'Return to the welcome screen',
        action: () => {
          setActiveTab(sessionsId);
        },
      },
      
      // Other commands
      {
        id: 'app.checkUpdates',
        label: 'Check for Updates',
        category: CommandCategory.Settings,
        icon: '🔄',
        description: 'Check for application updates',
        action: () => checkForUpdatesInteractive(),
      },
      {
        id: 'app.compose',
        label: 'Compose with AI',
        category: CommandCategory.Terminal,
        icon: '🤖',
        shortcut: 'Cmd/Ctrl+K',
        description: 'Open AI compose assistant',
        action: () => setComposeOpen(true),
        enabled: () => {
          const t = tabs.find((x) => x.id === activeTab);
          return Boolean(t && t.activePane);
        },
      },
    ];
    
    // Register SSH profile commands dynamically
    if (sshProfiles && sshProfiles.length > 0) {
      sshProfiles.forEach(profile => {
        commands.push({
          id: `ssh.connect.${profile.id}`,
          label: `SSH: ${profile.name}`,
          category: CommandCategory.SSH,
          icon: '🔐',
          description: `Connect to ${profile.host}`,
          keywords: [profile.host, profile.user || ''],
          action: () => {
            const id = crypto.randomUUID();
            setTabs((prev) => [...prev, { id, cwd: null, panes: [], activePane: null, status: {} }]);
            setActiveTab(id);
            openSshFor(id, { profileId: profile.id });
          },
        });
      });
    }
    
    // Register theme commands
    const themeList = getThemeList();
    themeList.forEach(theme => {
      commands.push({
        id: `theme.switch.${theme.id}`,
        label: `Theme: ${theme.name}`,
        category: CommandCategory.Theme,
        icon: '🎨',
        description: theme.dark ? 'Dark theme' : 'Light theme',
        keywords: [theme.dark ? 'dark' : 'light'],
        action: async () => {
          const config = await loadGlobalConfig();
          config.terminal.theme = theme.id;
          await saveGlobalConfig(config);
          show({ title: `Theme changed to ${theme.name}`, kind: 'success' });
          // Reload to apply theme
          window.location.reload();
        },
      });
    });
    
    commandRegistry.registerAll(commands);
  }, [tabs, activeTab, sessionsId, sshProfiles]);
  // Simple bell sound using WebAudio
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  function ringBell() {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!audioCtxRef.current && AC) audioCtxRef.current = new AC();
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880; // A5
      o.connect(g);
      g.connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.setValueAtTime(0.0, now);
      g.gain.linearRampToValueAtTime(0.15, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      o.start(now);
      o.stop(now + 0.14);
    } catch {}
  }

  // Load global settings and check updates on startup
  React.useEffect(() => {
    (async () => {
      // Initialize services
      const startTime = performance.now();
      
      // Load global configuration
      let config;
      try {
        config = await loadGlobalConfig();
        logger.info('Global configuration loaded');
      } catch (error) {
        logger.error('Failed to load global config', error);
      }
      
      // Track app startup
      const loadTime = performance.now() - startTime;
      telemetry.trackPerformance('app_startup', loadTime);
      logger.info(`App initialized in ${loadTime.toFixed(2)}ms`);

      // Check for updates if enabled in settings
      if (config?.general?.autoCheckUpdates !== false) { // Default to true if not set
        try {
          const mod: any = await import('@tauri-apps/plugin-updater');
          const res = await mod.check();
          if (res && res.available) {
            setUpdateAvailable({ version: (res as any).version || undefined });
            const tid = show({
              title: `Update available${(res as any).version ? ' ' + (res as any).version : ''}`,
              message: 'Restart to install the latest version.',
              kind: 'info',
              actions: [
                { label: 'Restart & Update', onClick: async () => {
                  try {
                    // Show downloading toast
                    const downloadId = show({ 
                      title: 'Downloading update...', 
                      message: 'Please wait while the update is downloaded.', 
                      kind: 'info' 
                    });
                    
                    // v2 exposes install(); fallback to downloadAndInstall if present
                    if (mod.install) await mod.install();
                    else if (res.downloadAndInstall) await res.downloadAndInstall();
                    
                    dismiss(downloadId);
                    
                    // Show restarting toast briefly
                    show({ 
                      title: 'Restarting...', 
                      message: 'The application will now restart to apply the update.', 
                      kind: 'success' 
                    });
                    
                    // Wait a moment for the toast to be visible
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Restart the application
                    const { relaunch } = await import('@tauri-apps/plugin-process');
                    await relaunch();
                  } catch (e) {
                    show({ title: 'Update failed', message: String(e), kind: 'error' });
                  }
                } }
              ]
            });
            setTimeout(() => dismiss(tid), 15000);
          }
        } catch {}
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep tabsRef in sync with tabs state
  React.useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Load SSH profiles on startup and when unlocked
  React.useEffect(() => {
    const loadProfiles = async () => {
      try {
        const { getSshProfiles } = await import('@/store/persist');
        const profiles = await getSshProfiles();
        setSshProfiles(profiles);
      } catch (e) {
        logger.warn('Failed to load SSH profiles:', e);
      }
    };

    loadProfiles();

    // Listen for profiles unlocked event
    const handleProfilesUnlocked = () => {
      logger.info('Profiles unlocked, reloading SSH profiles...');
      loadProfiles();
    };

    window.addEventListener('profiles-unlocked', handleProfilesUnlocked);
    return () => {
      window.removeEventListener('profiles-unlocked', handleProfilesUnlocked);
    };
  }, []);
  
  // Register commands when dependencies change
  React.useEffect(() => {
    registerCommands();
  }, [registerCommands]);

  async function checkForUpdatesInteractive() {
    if (updateChecking) return;
    setUpdateChecking(true);
    try {
      const mod: any = await import('@tauri-apps/plugin-updater');
      const res = await mod.check();
      if (res && res.available) {
        setUpdateAvailable({ version: (res as any).version || undefined });
        const tid = show({
          title: `Update available${(res as any).version ? ' ' + (res as any).version : ''}`,
          message: 'A new version is ready to install.',
          kind: 'info',
          actions: [
            { label: 'Restart & Update', onClick: async () => {
              try {
                // Show downloading toast
                const downloadId = show({ 
                  title: 'Downloading update...', 
                  message: 'Please wait while the update is downloaded.', 
                  kind: 'info' 
                });
                
                // v2 exposes install(); fallback to downloadAndInstall if present
                if (mod.install) await mod.install();
                else if (res.downloadAndInstall) await res.downloadAndInstall();
                
                dismiss(downloadId);
                
                // Show restarting toast briefly
                show({ 
                  title: 'Restarting...', 
                  message: 'The application will now restart to apply the update.', 
                  kind: 'success' 
                });
                
                // Wait a moment for the toast to be visible
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Restart the application
                const { relaunch } = await import('@tauri-apps/plugin-process');
                await relaunch();
              } catch (e) {
                show({ title: 'Update failed', message: String(e), kind: 'error' });
              }
            } },
            { label: 'View Release Notes', onClick: async () => {
              const { open } = await import('@tauri-apps/plugin-shell');
              await open('https://github.com/Kobozo/JaTerm/releases');
            } }
          ]
        });
        setTimeout(() => dismiss(tid), 20000);
      } else {
        const tid = show({ 
          title: 'Up to date', 
          message: 'No updates available.', 
          kind: 'success',
          actions: [
            { label: 'View All Releases', onClick: async () => {
              const { open } = await import('@tauri-apps/plugin-shell');
              await open('https://github.com/Kobozo/JaTerm/releases');
            } }
          ]
        });
        setTimeout(() => dismiss(tid), 5000);
      }
    } catch (e) {
      const tid = show({ 
        title: 'Update check failed', 
        message: 'Unable to check for updates. You can check manually on GitHub.', 
        kind: 'error',
        actions: [
          { label: 'View Releases on GitHub', onClick: async () => {
            const { open } = await import('@tauri-apps/plugin-shell');
            await open('https://github.com/Kobozo/JaTerm/releases');
          } }
        ]
      });
      setTimeout(() => dismiss(tid), 5000);
    } finally {
      setUpdateChecking(false);
    }
  }
  
  // Terminal event detectors for each pane
  const terminalEventDetectors = React.useRef<Map<string, TerminalEventDetector>>(new Map());
  const debouncedUpdateGitRef = React.useRef<((tabId: string) => void) | null>(null);
  const debouncedDetectPortsRef = React.useRef<((sessionId: string) => void) | null>(null);

  // Start on the Welcome screen by default; no auto-open on launch.

  /**
   * Get the default working directory based on user settings
   */
  async function getDefaultWorkingDirectory(): Promise<string | null> {
    const config = getCachedConfig();
    
    if (!config?.general?.defaultWorkingDir) {
      return null;
    }
    
    switch (config.general.defaultWorkingDir) {
      case 'home':
        try {
          return await resolvePathAbsolute('~');
        } catch {
          logger.warn('Failed to resolve home directory');
          return null;
        }
      
      case 'lastUsed':
        try {
          const lastUsed = localStorage.getItem('jaterm.lastUsedDirectory');
          if (lastUsed) {
            return await resolvePathAbsolute(lastUsed);
          }
        } catch {
          logger.warn('Failed to resolve last used directory');
        }
        // If no last used, fall back to home
        try {
          return await resolvePathAbsolute('~');
        } catch {
          return null;
        }
      
      case 'custom':
        if (config.general.customWorkingDir) {
          try {
            return await resolvePathAbsolute(config.general.customWorkingDir);
          } catch {
            logger.warn('Failed to resolve custom directory:', config.general.customWorkingDir);
          }
        }
        return null;
      
      default:
        return null;
    }
  }

  async function openFolderFor(tabId: string, path: string, opts: { 
    remember?: boolean;
    terminal?: any; // Terminal customization
    shell?: any; // Shell settings
  } = { remember: true }) {
    if (opts.remember !== false) {
      await addRecent(path);
      // Store as last used directory for default working directory setting
      try {
        localStorage.setItem('jaterm.lastUsedDirectory', path);
      } catch {}
    }
    try {
      const abs = await resolvePathAbsolute(path);
      // Use default shell from settings if configured
      const config = getCachedConfig();
      const defaultShell = config?.general?.defaultShell;
      const res = await ptyOpen({ 
        cwd: abs,
        shell: defaultShell || undefined
      });
      const id = typeof res === 'string' ? res : (res as any).ptyId ?? res;
      const sid = String(id);
      
      // Apply shell settings if provided
      if (opts.shell) {
        // Set environment variables
        if (opts.shell.env) {
          for (const [key, value] of Object.entries(opts.shell.env)) {
            const exportCmd = `export ${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n`;
            await ptyWrite({ ptyId: sid, data: exportCmd });
          }
        }
        
        // Run initialization commands
        if (opts.shell.initCommands) {
          for (const cmd of opts.shell.initCommands) {
            await ptyWrite({ ptyId: sid, data: cmd + '\n' });
          }
        }
        
        // Override shell if specified
        if (opts.shell.shell) {
          await ptyWrite({ ptyId: sid, data: `exec ${opts.shell.shell}\n` });
        }
      }
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, cwd: abs, panes: [sid], activePane: sid, status: { ...t.status, fullPath: abs } } : t)));
      setActiveTab(tabId);
      // Ensure local helper in background and record status
      try {
        (ensureLocalHelper as any)?.()?.then((res: any) => {
          setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: { ...t.status, helperOk: !!res?.ok, helperVersion: res?.version, helperPath: res?.path, helperChecked: true } } : t)));
        });
      } catch {}
      // Auto-install zsh OSC7 helper on mac if missing (once)
      try {
        const ua = navigator.userAgent.toLowerCase();
        const isMac = ua.includes('mac');
        const already = localStorage.getItem('jaterm.zsh.osc7.auto') === 'done';
        if (isMac && !already) {
          setTimeout(async () => {
            const t = tabs.find((x) => x.id === tabId);
            const seen = t?.status && (t.status as any).seenOsc7;
            if (!seen) {
              try {
                const ok = await installZshOsc7();
                if (ok) {
                  localStorage.setItem('jaterm.zsh.osc7.auto', 'done');
                  alert('Enabled zsh cwd tracking in ~/.zshrc. Restart your shell for live cwd.');
                }
              } catch {}
            }
          }, 1500);
        }
      } catch {}
      // No fallback cd: we rely on PTY cwd and shell OSC7 hooks
    } catch (e) {
      logger.error('ptyOpen failed', e);
    }
  }

  async function newTerminal() {
    const t = tabs.find((x) => x.id === activeTab);
    if (!t || !t.cwd) return;
    if (t.kind === 'ssh') { return; }
    try {
      // Determine working directory based on settings
      const config = getCachedConfig();
      let cwd = t.cwd;
      
      if (config?.general?.defaultWorkingDir) {
        switch (config.general.defaultWorkingDir) {
          case 'home':
            // Use home directory
            try {
              cwd = await resolvePathAbsolute('~');
            } catch {
              // Fallback to current directory if home resolution fails
            }
            break;
          case 'lastUsed':
            // Use last used directory if available
            try {
              const lastUsed = localStorage.getItem('jaterm.lastUsedDirectory');
              if (lastUsed) {
                cwd = await resolvePathAbsolute(lastUsed);
              }
            } catch {
              // Fallback to current directory if last used is invalid
            }
            break;
          case 'custom':
            // Use custom directory if configured
            if (config.general.customWorkingDir) {
              try {
                cwd = await resolvePathAbsolute(config.general.customWorkingDir);
              } catch {
                // Fallback to current directory if custom path is invalid
              }
            }
            break;
        }
      }
      
      const defaultShell = config?.general?.defaultShell;
      const res = await ptyOpen({ 
        cwd,
        shell: defaultShell || undefined
      });
      const id = typeof res === 'string' ? res : (res as any).ptyId ?? res;
      const sid = String(id);
      setTabs((prev) => prev.map((tb) => (tb.id === activeTab ? { ...tb, panes: [...tb.panes, sid], activePane: sid } : tb)));
    } catch (e) {
      logger.error('ptyOpen failed', e);
    }
  }

  function layoutToShape(n?: LayoutNode): LayoutShape | undefined {
    if (!n) return undefined;
    if (n.type === 'leaf') return { type: 'leaf' };
    const childShapes = n.children.map((c) => layoutToShape(c)!).filter(Boolean) as LayoutShape[];
    const sizes = (n as any).sizes as number[] | undefined;
    return { type: 'split', direction: n.direction, sizes: sizes && sizes.slice(), children: childShapes };
  }

  function replaceLeaf(node: LayoutNode, targetPane: string, replacement: LayoutNode): LayoutNode {
    if (node.type === 'leaf') return node.paneId === targetPane ? replacement : node;
    return { ...node, children: node.children.map((c) => replaceLeaf(c, targetPane, replacement)) };
  }

  function removeLeaf(node: LayoutNode, targetPane: string): LayoutNode | null {
    if (node.type === 'leaf') return node.paneId === targetPane ? null : node;
    const newChildren = node.children.map((c) => removeLeaf(c, targetPane)).filter(Boolean) as LayoutNode[];
    if (newChildren.length === 0) return null;
    if (newChildren.length === 1) return newChildren[0];
    return { ...node, children: newChildren };
  }

  async function splitPane(paneId: string, direction: 'row' | 'column') {
    const t = tabs.find((x) => x.id === activeTab);
    if (!t) return;
    if (t.kind === 'ssh') {
      if (!t.sshSessionId) return;
      try {
        const result = await sshOpenShell({ sessionId: t.sshSessionId, cwd: t.cwd ?? undefined, cols: 120, rows: 30 });
        // Handle both new format (object) and old format (string)
        const channelId = typeof result === 'string' ? result : result.channelId;
        const sessionId = typeof result === 'string' ? t.sshSessionId : result.sessionId;
        
        // Track the channel-to-session mapping for splits
        setChannelToSession(prev => ({ ...prev, [channelId]: sessionId }));
        
        const replacement: LayoutNode = { type: 'split', direction, children: [{ type: 'leaf', paneId }, { type: 'leaf', paneId: channelId }] };
        const newLayout: LayoutNode = t.layout ? replaceLeaf(t.layout as any, paneId, replacement) : replacement;
        setTabs((prev) => prev.map((tb) => (tb.id === activeTab ? { ...tb, panes: [...tb.panes, channelId], activePane: channelId, layout: newLayout } : tb)));
      } catch (e) {
        logger.error('ssh split failed', e);
      }
      return;
    }
    if (!t.cwd) return;
    try {
      const res = await ptyOpen({ cwd: t.cwd });
      const newId = String(typeof res === 'string' ? res : (res as any).ptyId ?? res);
      const replacement: LayoutNode = { type: 'split', direction, children: [{ type: 'leaf', paneId }, { type: 'leaf', paneId: newId }] };
      const newLayout: LayoutNode = t.layout ? replaceLeaf(t.layout as any, paneId, replacement) : replacement;
      setTabs((prev) => prev.map((tb) => (tb.id === activeTab ? { ...tb, panes: [...tb.panes, newId], activePane: newId, layout: newLayout } : tb)));
    } catch (e) {
      logger.error('split failed', e);
    }
  }

  async function setPrimaryPane(paneId: string) {
    const t = tabs.find(x => x.id === activeTab);
    if (!t || !t.panes.includes(paneId)) return;
    
    // Update the primary pane for this tab
    setTabs(prev => prev.map(tab => {
      if (tab.id === activeTab) {
        return { ...tab, primaryPane: paneId };
      }
      return tab;
    }));
    
    // If this is an SSH tab, update the backend primary flag
    if (t.kind === 'ssh' && channelToSession[paneId]) {
      const sessionId = channelToSession[paneId];
      await sshSetPrimary(sessionId);
    }
  }
  
  // Wrapper function that decides between reconnection and normal close
  async function closePaneOrReconnect(id: string, isUnexpectedExit: boolean = false) {
    const t = tabs.find((x) => x.id === activeTab);
    
    // Check if this is an SSH pane that should auto-reconnect
    if (isUnexpectedExit && t?.kind === 'ssh' && t.reconnectSettings?.enabled && !t.reconnectState?.isReconnecting) {
      // Handle with reconnection
      await handleSshDisconnection(id);
    } else {
      // Normal close
      await closePane(id);
    }
  }
  
  async function closePane(id: string) {
    // Clean up event detector
    unregisterTerminalEventDetector(id);
    
    const t = tabs.find((x) => x.id === activeTab);
    
    // Check if we're closing the primary pane
    const isClosingPrimary = t?.primaryPane === id;
    
    if (t?.kind === 'ssh') {
      try { 
        await sshCloseShell(id);
        // If this pane has its own SSH session (from a split), disconnect it
        const sessionId = channelToSession[id];
        if (sessionId && sessionId !== t.sshSessionId) {
          // This is a split with its own connection - disconnect it
          await sshDisconnect(sessionId);
          // Clean up the mapping
          setChannelToSession(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }
      } catch {}
    } else {
      emitCwdViaOsc7(id);
      await new Promise((r) => setTimeout(r, 120));
      try { await ptyKill({ ptyId: id }); } catch {}
    }
    // Precompute whether we should record an SSH recent after state update
    const shouldRecordSshRecent = !!(t && t.kind === 'ssh' && (t as any).profileId);
    const sshProfileId = (t as any)?.profileId as string | undefined;
    const sshOpenPath = (t as any)?.openPath as string | undefined;
    const sshPathAtClosePre = (t?.status?.fullPath ?? t?.cwd) as string | undefined;
    setTabs((prev) => prev.map((t) => {
      if (t.id !== activeTab) return t;
      const nextPanes = t.panes.filter((p) => p !== id);
      const nextLayout = t.layout ? removeLeaf(t.layout as any, id) : undefined;
      
      // If we're closing the primary pane and there are still other panes, set a new primary
      let nextPrimary = t.primaryPane;
      if (isClosingPrimary && nextPanes.length > 0) {
        // Set the first remaining pane as the new primary
        nextPrimary = nextPanes[0];
        // Update backend if SSH
        if (t.kind === 'ssh' && channelToSession[nextPrimary]) {
          const newPrimarySessionId = channelToSession[nextPrimary];
          sshSetPrimary(newPrimarySessionId).catch(() => {});
        }
      } else if (nextPanes.length === 0) {
        // No panes left, clear primary
        nextPrimary = null;
      }
      
      const updated = { 
        ...t, 
        panes: nextPanes, 
        activePane: nextPanes[nextPanes.length - 1] ?? null, 
        primaryPane: nextPrimary,
        cwd: nextPanes.length ? t.cwd : null, 
        layout: nextLayout 
      };
      
      if (t.kind !== 'ssh' && t.panes.length > 0 && nextPanes.length === 0 && (t.status.fullPath || t.cwd)) {
        addRecentSession({ cwd: (t.status.fullPath ?? t.cwd) as string, closedAt: Date.now(), panes: t.panes.length, title: t.title ?? undefined, layoutShape: layoutToShape(t.layout as any) });
      }
      return updated;
    }));
    // If this was an SSH tab and we just closed its last pane, close the tab; saving happens in closeTab
    let wasLastPaneFlag = false;
    try {
      const current = tabs.find((x) => x.id === activeTab);
      const wasLastPane = current ? current.panes.length === 1 : false;
      wasLastPaneFlag = wasLastPane;
    } catch {}
    // Always auto-close the SSH tab if no panes remain (parity with local)
    if (t?.kind === 'ssh' && wasLastPaneFlag) {
      setTimeout(() => closeTab(activeTab), 0);
    }
  }

  // Track pending CWD updates and last update time to prevent race conditions
  const pendingCwdUpdates = React.useRef<Map<string, NodeJS.Timeout>>(new Map());
  const lastCwdUpdate = React.useRef<Map<string, { dir: string; timestamp: number }>>(new Map());
  const lastNormalizedPath = React.useRef<Map<string, string>>(new Map());
  
  async function updateTabCwd(tabId: string, dir: string, paneId?: string) {
    const now = Date.now();
    
    // Check if this is a stale update (same as last or going backwards)
    const last = lastCwdUpdate.current.get(tabId);
    if (last && last.dir === dir && (now - last.timestamp) < 1000) {
      // Same directory within 1 second, skip
      console.info('[git] Skipping duplicate CWD update:', dir, 'paneId:', paneId);
      return;
    }
    
    // Check if this update is from the primary pane (for SSH tabs)
    const tab = tabs.find(t => t.id === tabId);
    if (tab && tab.kind === 'ssh' && paneId && tab.primaryPane && paneId !== tab.primaryPane) {
      // This is not the primary pane, don't update Git/SFTP
      console.info('[git] Skipping non-primary pane update:', dir, 'paneId:', paneId, 'primaryPane:', tab.primaryPane);
      return;
    }
    
    console.info('[git] updateTabCwd called:', dir, 'paneId:', paneId, 'previous:', last?.dir);
    
    // Cancel any pending update for this tab
    const pending = pendingCwdUpdates.current.get(tabId);
    if (pending) {
      console.info('[git] Cancelling pending update for:', last?.dir);
      clearTimeout(pending);
      pendingCwdUpdates.current.delete(tabId);
    }
    
    // Record this update attempt
    lastCwdUpdate.current.set(tabId, { dir, timestamp: now });
    
    // Debounce the update to avoid race conditions
    const timeoutId = setTimeout(async () => {
      pendingCwdUpdates.current.delete(tabId);
      
      // Double-check this is still the most recent directory
      const latest = lastCwdUpdate.current.get(tabId);
      if (!latest || latest.dir !== dir) {
        console.info('[git] Skipping stale CWD update:', dir, 'latest:', latest?.dir);
        return;
      }
      
      console.info('[git] Executing debounced update for:', dir);
      await doUpdateTabCwd(tabId, dir, paneId);
    }, 150); // 150ms debounce
    
    pendingCwdUpdates.current.set(tabId, timeoutId);
  }
  
  async function doUpdateTabCwd(tabId: string, dir: string, paneId?: string) {
    // Resolve to absolute for local sessions only; SSH paths are remote and should not be resolved locally
    let abs = dir;
    const tcur = tabs.find((x) => x.id === tabId);
    const isSsh = tcur?.kind === 'ssh';
    let sshHome: string | undefined = undefined;
    if (!isSsh) {
      try {
        const mod = await import('@/types/ipc');
        abs = await (mod as any).resolvePathAbsolute(dir);
      } catch {}
    } else {
      // Normalize SSH path with remote home if looks home-relative like "/foo" or starts with "~/"
      try {
        const mod = await import('@/types/ipc');
        sshHome = tcur?.sshSessionId ? await (mod as any).sshHomeDir(tcur.sshSessionId) : undefined;
        if (sshHome) {
          if (abs.startsWith('~/')) {
            abs = sshHome.replace(/\/$/, '') + abs.slice(1);
          } else {
            const isKnownRoot = /^\/(home|usr|var|etc|opt|bin|sbin|lib|tmp|mnt|media|root)\//.test(abs);
            if (!isKnownRoot && !abs.startsWith(sshHome.replace(/\/$/, '') + '/')) {
              abs = sshHome.replace(/\/$/, '') + '/' + abs.replace(/^\//, '');
            }
          }
        }
      } catch {}
    }
    
    // Check if we've already processed this NORMALIZED path recently
    const lastNormalized = lastNormalizedPath.current.get(tabId);
    if (lastNormalized === abs) {
      console.info('[git] Skipping duplicate normalized path:', abs, '(original:', dir, ')');
      return;
    }
    
    // Before doing any async work, check if this is still the latest directory
    const beforeGitCheck = lastCwdUpdate.current.get(tabId);
    if (!beforeGitCheck || beforeGitCheck.dir !== dir) {
      console.info('[git] Aborting stale CWD update (pre-git):', dir, 'latest:', beforeGitCheck?.dir);
      return;
    }
    
    // Record the normalized path
    lastNormalizedPath.current.set(tabId, abs);
    
    // Store cwd and ensure helperPath for SSH if we derived a home
    setTabs((prev) => prev.map((t) => {
      if (t.id !== tabId) return t;
      const nextStatus: any = { ...t.status, cwd: abs, fullPath: abs, seenOsc7: true };
      if (isSsh && sshHome && !nextStatus.helperPath) {
        nextStatus.helperPath = sshHome.replace(/\/$/, '') + '/.jaterm-helper/jaterm-agent';
      }
      return { ...t, status: nextStatus };
    }));
    try {
      const t = tabs.find((x) => x.id === tabId);
      const helperPath = (t?.status?.helperPath as string | null) ?? (sshHome ? sshHome.replace(/\/$/, '') + '/.jaterm-helper/jaterm-agent' : null);
      // IMPORTANT: Always use the original session for Git operations (it has the helper deployed)
      // Split sessions don't have the helper, so we must use the original session ID
      const gitSessionId = (t as any)?.sshSessionId; // Original session with helper
      console.info('[git] doUpdateTabCwd git-status cwd=', abs, { tabId, kind: t?.kind, helperPath, sessionId: gitSessionId });
      const st = await gitStatusViaHelper({ kind: t?.kind === 'ssh' ? 'ssh' : 'local', sessionId: gitSessionId, helperPath }, abs);
      
      // After the async git status call, check again if this is still current
      const afterGitCheck = lastCwdUpdate.current.get(tabId);
      if (!afterGitCheck || afterGitCheck.dir !== dir) {
        console.info('[git] Aborting stale CWD update (post-git):', dir, 'latest:', afterGitCheck?.dir);
        return;
      }
      
      setTabs((prev) => prev.map((t) => {
        if (t.id === tabId) {
          const newStatus = { ...t.status, cwd: abs, fullPath: abs, branch: st.branch, ahead: st.ahead, behind: st.behind, staged: st.staged, unstaged: st.unstaged, seenOsc7: true };
          // Keep current view as is when in a git repo
          // Reset sftpCwd to null so SFTP follows the terminal's CWD
          return { ...t, status: newStatus, sftpCwd: null };
        }
        return t;
      }));
    } catch {
      // After the async git status call failed, check again if this is still current
      const afterGitCheck = lastCwdUpdate.current.get(tabId);
      if (!afterGitCheck || afterGitCheck.dir !== dir) {
        console.info('[git] Aborting stale CWD update (post-git-error):', dir, 'latest:', afterGitCheck?.dir);
        return;
      }
      
      // Clear the normalized path since this is not a git repo
      lastNormalizedPath.current.set(tabId, abs + '_not_git');
      
      setTabs((prev) => prev.map((t) => {
        if (t.id === tabId) {
          const newStatus = { ...t.status, fullPath: abs, branch: '-', ahead: 0, behind: 0, staged: 0, unstaged: 0 };
          // If we were viewing git tools but we're no longer in a git repo, switch to terminal view
          const newView = t.view === 'git' ? 'terminal' : t.view;
          // Reset sftpCwd to null so SFTP follows the terminal's CWD
          return { ...t, status: newStatus, view: newView, sftpCwd: null };
        }
        return t;
      }));
    }
  }

  function emitCwdViaOsc7(ptyId: string) {
    try {
      const seq = `printf '\\033]7;file://%s%s\\007' "$(hostname)" "$PWD"\n`;
      ptyWrite({ ptyId: ptyId, data: seq });
    } catch {}
  }

  function newTab() {
    // Focus the fixed Sessions tab instead of creating a blank tab
    setActiveTab(sessionsId);
  }

  async function closeTab(id: string) {
    if (id === sessionsId) return; // fixed Sessions tab cannot be closed
    // Clean up tracking for this tab
    pendingCwdUpdates.current.delete(id);
    lastCwdUpdate.current.delete(id);
    lastNormalizedPath.current.delete(id);
    
    // record session for the tab if it had a cwd
    const toRecord = tabsRef.current.find((t) => t.id === id);
    if (toRecord && toRecord.kind !== 'ssh' && (toRecord.status.cwd || toRecord.cwd)) {
      addRecentSession({ cwd: (toRecord.status.cwd ?? toRecord.cwd) as string, closedAt: Date.now(), panes: toRecord.panes.length, title: toRecord.title ?? undefined, layoutShape: layoutToShape(toRecord.layout as any) });
      // Dispatch event so Sessions component can refresh
      window.dispatchEvent(new CustomEvent('recent-sessions-updated'));
    }
    // SSH recents recorded below in a unified normalized form
    if (toRecord?.activePane) {
      if (toRecord.kind === 'ssh') {
        try { await Promise.all(toRecord.panes.map((pid) => sshCloseShell(pid))); } catch {}
        if (toRecord.sshSessionId) { 
          // Clean up notified ports for this session
          notifiedPortsRef.current.delete(toRecord.sshSessionId);
          try { await sshDisconnect(toRecord.sshSessionId); } catch {} 
        }
      } else {
        emitCwdViaOsc7(toRecord.activePane);
        await new Promise((r) => setTimeout(r, 120));
      }
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        appQuit();
        return prev;
      }
      if (activeTab === id) {
        const fallback = next[0];
        if (fallback) setActiveTab(fallback.id);
      }
      return next;
    });
    // Record SSH recent if opened from a profile (use final path normalization, prefer title-derived path if deeper when normalized)
    if (toRecord?.kind === 'ssh' && toRecord.profileId) {
      // Prefer parsing the tab title for the final cwd if present
      let path = (toRecord.status.fullPath ?? toRecord.cwd) as string | undefined;
      const rawTitle = toRecord.title as string | undefined;
      let titleCandidate: string | undefined;
      if (rawTitle) {
        const mTilde = rawTitle.match(/~\/[\S]+/);
        if (mTilde && mTilde[0]) titleCandidate = mTilde[0];
        if (!titleCandidate) {
          const mAbs = rawTitle.match(/\/[A-Za-z0-9_\-\.\/]+/g);
          if (mAbs && mAbs.length) titleCandidate = mAbs[mAbs.length - 1];
        }
      }
      if (path) {
        try {
          const mod = await import('@/types/ipc');
          // Try to resolve remote home; fallback to derive from helperPath
          let home: string | undefined = undefined;
          if (toRecord.sshSessionId) {
            try { home = await (mod as any).sshHomeDir(toRecord.sshSessionId); } catch {}
          }
          if (!home && toRecord.status?.helperPath) {
            const hp = toRecord.status.helperPath as string;
            const idx = hp.indexOf('/.jaterm-helper/');
            if (idx > 0) home = hp.slice(0, idx);
          }
          if (home) {
            // Expand tilde in path if present
            if (path.startsWith('~/')) {
              path = home.replace(/\/$/, '') + path.slice(1);
            }
            if (titleCandidate) {
              if (titleCandidate.startsWith('~/')) {
                titleCandidate = home.replace(/\/$/, '') + titleCandidate.slice(1);
              } else {
                const isRoot = /^\/(home|usr|var|etc|opt|bin|sbin|lib|tmp|mnt|media|root)\//.test(titleCandidate);
                if (!isRoot && titleCandidate.startsWith('/')) {
                  titleCandidate = home.replace(/\/$/, '') + '/' + titleCandidate.replace(/^\//, '');
                }
              }
            }
            const isKnownRoot = /^\/(home|usr|var|etc|opt|bin|sbin|lib|tmp|mnt|media|root)\//.test(path);
            if (!isKnownRoot && !path.startsWith(home.replace(/\/$/, '') + '/')) {
              path = home.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
            }
          }
        } catch {}
        // Use the actual current working directory from status.fullPath or status.cwd
        // This is the last known CWD tracked via OSC7 sequences
        if (toRecord.status?.fullPath) {
          path = toRecord.status.fullPath;
          console.info('[ssh][recents] Using fullPath from status:', path);
        } else if (toRecord.status?.cwd) {
          // Fall back to status.cwd if fullPath is not available
          path = toRecord.status.cwd;
          console.info('[ssh][recents] Using cwd from status:', path);
        } else {
          // Final fallback to title parsing only if no status paths available
          if (titleCandidate && !titleCandidate.startsWith('~/') && (!path || titleCandidate.length > path.length)) {
            path = titleCandidate;
          }
          console.info('[ssh][recents] Using title/initial path:', path);
        }
        console.info('[ssh][recents] save final path=', path, 'status:', toRecord.status);
        const { addRecentSshSession } = await import('@/store/sessions');
        await addRecentSshSession({ profileId: toRecord.profileId, path, closedAt: Date.now(), panes: toRecord.panes.length, title: toRecord.title ?? undefined, layoutShape: layoutToShape(toRecord.layout as any) });
        // Dispatch event so Sessions component can refresh
        window.dispatchEvent(new CustomEvent('recent-sessions-updated'));
      }
    }
  }

  function shapeAssignPanes(shape: LayoutShape, panes: string[]): { node: LayoutNode; rest: string[] } {
    if (shape.type === 'leaf') {
      const [head, ...rest] = panes;
      return { node: { type: 'leaf', paneId: head }, rest } as any;
    }
    let rest = panes;
    const children: LayoutNode[] = [];
    for (const ch of shape.children) {
      const r = shapeAssignPanes(ch, rest);
      children.push(r.node);
      rest = r.rest;
    }
    const sizes = shape.sizes && shape.sizes.slice();
    return { node: { type: 'split', direction: shape.direction, sizes, children } as LayoutNode, rest };
  }

  async function openSessionFor(tabId: string, session: { cwd: string; layoutShape?: LayoutShape; title?: string }) {
    try {
      const abs = await resolvePathAbsolute(session.cwd);
      let paneIds: string[] = [];
      let layout: LayoutNode | undefined = undefined;
      if (session.layoutShape) {
        // Count leaves
        function countLeaves(s: LayoutShape): number {
          return s.type === 'leaf' ? 1 : s.children.map(countLeaves).reduce((a, b) => a + b, 0);
        }
        const n = countLeaves(session.layoutShape);
        for (let i = 0; i < n; i++) {
          const res = await ptyOpen({ cwd: abs });
          const id = String(typeof res === 'string' ? res : (res as any).ptyId ?? res);
          paneIds.push(id);
        }
        const assigned = shapeAssignPanes(session.layoutShape, paneIds);
        layout = assigned.node;
      } else {
        const res = await ptyOpen({ cwd: abs });
        paneIds = [String(typeof res === 'string' ? res : (res as any).ptyId ?? res)];
      }
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, cwd: abs, status: { ...t.status, fullPath: abs }, title: session.title ?? t.title, panes: paneIds, activePane: paneIds[0], layout } : t)));
      setActiveTab(tabId);
      // Ensure local helper for restored sessions
      try {
        (ensureLocalHelper as any)?.()?.then((res: any) => {
          setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: { ...t.status, helperOk: !!res?.ok, helperVersion: res?.version, helperPath: res?.path, helperChecked: true } } : t)));
        });
      } catch {}
    } catch (e) {
      logger.error('open session failed', e);
    }
  }

  // Helper function to resolve helper consent from profile and folder inheritance
  async function resolveHelperConsent(profileId?: string): Promise<'yes' | 'no' | undefined> {
    if (!profileId) return undefined;
    
    try {
      const { getSshProfiles, getProfilesTree, findPathToNode, resolveEffectiveSettings } = await import('@/store/persist');
      const profiles = await getSshProfiles();
      const profile = profiles.find(p => p.id === profileId);
      
      // If profile has explicit consent, use that
      if (profile?.helperConsent !== undefined) {
        return profile.helperConsent;
      }
      
      // Otherwise check folder inheritance
      const tree = await getProfilesTree();
      if (!tree) return undefined;
      
      // Find the profile node in the tree
      const profileNodes = [];
      function findProfileNode(node: any, acc: any[] = []): void {
        if (node.type === 'profile' && node.ref?.kind === 'ssh' && node.ref?.id === profileId) {
          profileNodes.push(...acc, node);
        } else if (node.type === 'folder') {
          for (const child of node.children || []) {
            findProfileNode(child, [...acc, node]);
          }
        }
      }
      findProfileNode(tree, []);
      
      if (profileNodes.length > 0) {
        const nodeId = profileNodes[profileNodes.length - 1].id;
        const effective = resolveEffectiveSettings({ root: tree, nodeId, profileKind: 'ssh' });
        return (effective as any).ssh?.helperConsent;
      }
    } catch (e) {
      logger.error('Failed to resolve helper consent:', e);
    }
    
    return undefined;
  }

  // Handle helper consent from modal
  async function handleHelperConsent(consent: 'yes' | 'no') {
    if (!helperConsentModal) return;
    
    const { sessionId, profileId, tabId, opts } = helperConsentModal;
    
    // Save consent to profile if we have one
    if (profileId) {
      try {
        const { getSshProfiles, saveSshProfile } = await import('@/store/persist');
        const profiles = await getSshProfiles();
        const profile = profiles.find(p => p.id === profileId);
        if (profile) {
          profile.helperConsent = consent;
          await saveSshProfile(profile);
          console.info('[Helper] Saved consent to profile:', profileId, consent);
        }
      } catch (e) {
        logger.error('[Helper] Failed to save consent to profile:', e);
      }
    }
    
    // Clear modal
    setHelperConsentModal(null);
    
    // Deploy helper if consent is yes
    if (consent === 'yes') {
      try {
        (ensureHelper as any)?.(sessionId, { show, update, dismiss })?.then(async (res: any) => {
          setTabs((prev) => {
            const detectedOs = (!opts.os || opts.os === 'auto-detect') ? res?.os : opts.os;
            // Keep existing helperPath if res.path is undefined
            const updated = prev.map((t) => (t.id === tabId ? { 
              ...t, 
              status: { 
                ...t.status, 
                helperOk: !!res?.ok, 
                helperVersion: res?.version, 
                helperPath: res?.path || t.status.helperPath, // Keep existing path if undefined
                os: detectedOs 
              } 
            } : t));
            const cur = updated.find((t) => t.id === tabId);
            if (cur?.status?.fullPath && cur.status.helperOk) {
              // Skip this git status call - it will be triggered by CWD updates
              // This was causing duplicate calls with stale paths
              // gitStatusViaHelper now handled properly via updateTabCwd
              setTimeout(() => {
                detectPorts(sessionId);
              }, 200);
            }
            return updated;
          });
        });
      } catch {}
    }
    
    // Continue with opening the SSH shell
    continueOpenSshFor(sessionId, tabId, opts);
  }
  
  // Continue SSH session after consent
  async function continueOpenSshFor(sessionId: string, tabId: string, opts: any) {
    try {
      const result = await sshOpenShell({ sessionId, cwd: opts.cwd, cols: 120, rows: 30 });
      // Handle both new format (object) and old format (string)
      const chanId = typeof result === 'string' ? result : result.channelId;
      const newSessionId = typeof result === 'string' ? sessionId : result.sessionId;
      
      // Track the channel-to-session mapping
      setChannelToSession(prev => ({ ...prev, [chanId]: newSessionId }));
      
      // Apply shell settings if provided
      if (opts.shell) {
        // Set environment variables
        if (opts.shell.env) {
          for (const [key, value] of Object.entries(opts.shell.env)) {
            const exportCmd = `export ${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n`;
            await sshWrite({ channelId: chanId, data: exportCmd });
          }
        }
        
        // Run initialization commands
        if (opts.shell.initCommands) {
          for (const cmd of opts.shell.initCommands) {
            await sshWrite({ channelId: chanId, data: cmd + '\n' });
          }
        }
        
        // Override shell if specified
        if (opts.shell.shell) {
          await sshWrite({ channelId: chanId, data: `exec ${opts.shell.shell}\n` });
        }
      }
      
      // Setup default port forwards if provided
      if (opts.advanced?.defaultForwards) {
        const { sshOpenForward } = await import('@/types/ipc');
        for (const f of opts.advanced.defaultForwards) {
          try {
            await sshOpenForward({
              sessionId,
              forward: {
                type: f.type,
                srcHost: f.srcHost || (f.type === 'R' ? '0.0.0.0' : '127.0.0.1'),
                srcPort: f.srcPort,
                dstHost: f.dstHost || '127.0.0.1',
                dstPort: f.dstPort
              } as any
            });
          } catch (e) {
            logger.error('Failed to setup default forward:', e);
          }
        }
      }
      
      // Get SSH home directory to set default helper path
      let sshHome: string | undefined;
      try {
        const { sshHomeDir } = await import('@/types/ipc');
        sshHome = await sshHomeDir(sessionId);
      } catch {}
      
      // Load global config for reconnect settings
      const { loadGlobalConfig } = await import('@/services/settings');
      const globalConfig = await loadGlobalConfig();
      
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { 
        ...t, 
        kind: 'ssh', 
        sshSessionId: sessionId, 
        profileId: opts.profileId, 
        sshHost: opts.host, 
        sshUser: opts.user, 
        sshPort: opts.port ?? 22, 
        openPath: opts.cwd ?? null, 
        cwd: opts.cwd ?? sshHome ?? null, 
        // Set the title to profile name if available, otherwise use user@host
        title: opts.profileName || `${opts.user}@${opts.host}`,
        panes: [chanId], 
        activePane: chanId,
        primaryPane: chanId, // Initial pane is primary for Git/SFTP
        status: { 
          ...t.status,
          // Set default helper path if we have home directory
          helperPath: sshHome ? sshHome.replace(/\/$/, '') + '/.jaterm-helper/jaterm-agent' : undefined
        },
        // Store reconnection settings for potential auto-reconnect
        reconnectSettings: globalConfig.ssh.autoReconnect ? {
          enabled: true,
          delay: globalConfig.ssh.reconnectDelay,
          auth: opts.auth,
          opts: opts
        } : undefined,
        // Store terminal settings
        terminalSettings: opts.terminal
      } : t)));
      setActiveTab(tabId);
    } catch (e) {
      logger.error('Failed to continue SSH session:', e);
      addToast({ 
        title: 'SSH Session Failed', 
        message: `Failed to open shell on ${opts.host}: ${String(e)}`,
        kind: 'error',
        timeout: 10000
      });
      
      // Disconnect and close tab
      try {
        await sshDisconnect(sessionId);
      } catch {}
      closeTab(tabId);
    }
  }

  // Handle SSH disconnection with potential auto-reconnect
  async function handleSshDisconnection(paneId: string) {
    const tab = tabsRef.current.find(t => t.panes.includes(paneId));
    if (!tab || !tab.reconnectSettings?.enabled) {
      // Fall back to normal close if not configured for auto-reconnect
      removePane(paneId);
      return;
    }

    // Get the last working directory - the key advantage!
    const lastCwd = tab.status?.fullPath || tab.cwd;
    console.info('[ssh][reconnect] Disconnected from', tab.title, 'at', lastCwd);
    
    // Check if we're already reconnecting (avoid duplicate attempts)
    if (tab.reconnectState?.isReconnecting) {
      console.info('[ssh][reconnect] Already reconnecting, skipping');
      return;
    }
    
    // Mark as reconnecting (visual feedback)
    const maxAttempts = 5; // Could be made configurable
    setTabs(prev => prev.map(t => 
      t.id === tab.id 
        ? { 
            ...t, 
            reconnectState: { 
              isReconnecting: true, 
              attempts: 0,
              maxAttempts 
            }
          }
        : t
    ));
    
    // Schedule first reconnection attempt
    scheduleReconnection(tab.id, lastCwd);
  }
  
  // Schedule a reconnection attempt with exponential backoff
  function scheduleReconnection(tabId: string, lastCwd: string | null) {
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (!tab?.reconnectSettings || !tab.reconnectState) return;
    
    const { delay } = tab.reconnectSettings;
    const { attempts, maxAttempts = 5 } = tab.reconnectState;
    
    if (attempts >= maxAttempts) {
      console.info('[ssh][reconnect] Max attempts reached, giving up');
      addToast({
        title: 'SSH Reconnection Failed',
        message: `Failed to reconnect to ${tab.title} after ${maxAttempts} attempts`,
        kind: 'error',
        timeout: 10000
      });
      // Clean up and close the tab
      setTabs(prev => prev.map(t => 
        t.id === tabId ? { ...t, reconnectState: undefined } : t
      ));
      closeTab(tabId);
      return;
    }
    
    // Calculate delay with exponential backoff (1.5x multiplier)
    const backoffDelay = delay * 1000 * Math.pow(1.5, attempts);
    const nextAttemptTime = Date.now() + backoffDelay;
    
    console.info(`[ssh][reconnect] Scheduling attempt ${attempts + 1}/${maxAttempts} in ${backoffDelay}ms`);
    
    const timeoutId = setTimeout(() => {
      attemptReconnection(tabId, lastCwd);
    }, backoffDelay);
    
    // Store the timeout ID so it can be cancelled if needed
    setTabs(prev => prev.map(t => 
      t.id === tabId && t.reconnectState
        ? { 
            ...t, 
            reconnectState: { 
              ...t.reconnectState, 
              scheduledReconnect: timeoutId,
              lastAttempt: nextAttemptTime
            }
          }
        : t
    ));
  }
  
  // Attempt to reconnect to SSH with the last known directory
  async function attemptReconnection(tabId: string, lastCwd: string | null) {
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (!tab?.reconnectSettings || !tab.reconnectState) return;
    
    const { opts, auth } = tab.reconnectSettings;
    const { attempts, maxAttempts = 5 } = tab.reconnectState;
    
    console.info(`[ssh][reconnect] Attempting reconnection ${attempts + 1}/${maxAttempts} to ${opts.host}`);
    
    // Update attempt counter
    setTabs(prev => prev.map(t => 
      t.id === tabId && t.reconnectState
        ? { 
            ...t, 
            reconnectState: { 
              ...t.reconnectState, 
              attempts: attempts + 1,
              scheduledReconnect: undefined
            }
          }
        : t
    ));
    
    try {
      // Clear existing panes (they're disconnected anyway)
      setTabs(prev => prev.map(t => 
        t.id === tabId ? { ...t, panes: [], activePane: null } : t
      ));
      
      // Reconnect with the last known directory
      const reconnectOpts = {
        ...opts,
        auth: auth,
        cwd: lastCwd, // This ensures we reconnect to where the user was!
        _isReconnection: true // Flag to skip certain initialization
      };
      
      // Attempt to reconnect
      await openSshFor(tabId, reconnectOpts);
      
      // Success! Clear reconnection state
      setTabs(prev => prev.map(t => 
        t.id === tabId ? { ...t, reconnectState: undefined } : t
      ));
      
      addToast({
        title: 'SSH Reconnected',
        message: `Successfully reconnected to ${opts.host}`,
        kind: 'success',
        timeout: 5000
      });
      
      console.info('[ssh][reconnect] Successfully reconnected to', opts.host);
    } catch (error) {
      logger.error('[ssh][reconnect] Reconnection failed:', error);
      
      // Schedule next attempt if not at max
      const updatedTab = tabsRef.current.find(t => t.id === tabId);
      if (updatedTab?.reconnectState && updatedTab.reconnectState.attempts < (updatedTab.reconnectState.maxAttempts || 5)) {
        scheduleReconnection(tabId, lastCwd);
      } else {
        // Max attempts reached
        handleSshDisconnection(tabId);
      }
    }
  }
  
  // Cancel ongoing reconnection attempts
  function cancelReconnection(tabId: string) {
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (tab?.reconnectState?.scheduledReconnect) {
      clearTimeout(tab.reconnectState.scheduledReconnect);
    }
    
    setTabs(prev => prev.map(t => 
      t.id === tabId ? { ...t, reconnectState: undefined } : t
    ));
    
    // Close the tab normally
    closeTab(tabId);
  }

  async function openSshFor(tabId: string, opts: { 
    host: string; 
    port?: number; 
    user: string; 
    auth: { password?: string; keyPath?: string; passphrase?: string; agent?: boolean }; 
    cwd?: string; 
    profileId?: string;
    profileName?: string; // Profile name for tab title
    terminal?: any; // Terminal customization settings
    shell?: any; // Shell and environment settings
    advanced?: any; // Advanced SSH settings
    os?: string; // OS from profile
    _resolved?: boolean; // Flag indicating settings are already resolved with inheritance
  }) {
    try {
      // Ensure we have a usable auth. Some profiles may load with encrypted fields until master key is unlocked.
      function hasUsableAuth(a: any | undefined): boolean {
        return !!(a && (a.agent || (a.password && a.password.length) || a.keyPath));
      }
      let authToUse = opts.auth;
      
      // Skip re-fetching if settings are already resolved (from openProfile with inheritance)
      if (!opts._resolved && opts.profileId) {
        try {
          const { getSshProfiles } = await import('@/store/persist');
          const profiles = await getSshProfiles();
          const p = profiles.find(pr => pr.id === opts.profileId);
          if (p && hasUsableAuth(p.auth as any)) {
            authToUse = (p.auth as any);
          } else {
            const { encryptionStatus } = await import('@/types/ipc');
            const enc = await encryptionStatus();
            if (!enc.has_master_key) {
              // Ask user to unlock master key and abort this attempt
              setMasterKeyDialog({ isOpen: true, mode: 'unlock' });
              alert('This profile is encrypted. Please unlock your master key and try again.');
              return;
            }
          }
        } catch {}
      }
      // Final fallback to agent if still no usable auth
      if (!hasUsableAuth(authToUse)) authToUse = { agent: true } as any;

      // Load global SSH settings
      const { loadGlobalConfig } = await import('@/services/settings');
      const globalConfig = await loadGlobalConfig();
      const sshSettings = globalConfig.ssh;

      // Use port from options first, then from global settings, then default to 22
      const port = opts.port ?? sshSettings.defaultPort ?? 22;

      const { sshConnectWithTrustPrompt } = await import('@/types/ipc');
      const sessionId = await sshConnectWithTrustPrompt({ 
        host: opts.host, 
        port, 
        user: opts.user, 
        auth: { password: authToUse.password, key_path: (authToUse as any).keyPath, passphrase: authToUse.passphrase, agent: authToUse.agent } as any, 
        timeout_ms: 15000,
        keepalive_interval: sshSettings.keepaliveInterval,
        compression: sshSettings.compression,
        x11_forwarding: sshSettings.x11Forwarding,
        agent_forwarding: sshSettings.agentForwarding
      } as any);
      
      // Check if password auth was used and we have a profile that could be upgraded
      if (authToUse.password && opts.profileId && opts.profileName) {
        // Check if we should offer key generation (only if not already offered)
        try {
          const { getSshProfiles } = await import('@/store/persist');
          const profiles = await getSshProfiles();
          const profile = profiles.find(p => p.id === opts.profileId);
          
          // Only offer if profile doesn't have a "skipKeyGeneration" flag
          if (profile && !profile.skipKeyGeneration) {
            // Show key generation modal
            setKeyGenerationModal({
              sessionId,
              profileId: opts.profileId,
              profileName: opts.profileName,
              host: opts.host,
              port: opts.port ?? 22,
              user: opts.user
            });
            // Continue with the connection but modal will be shown
          }
        } catch (e) {
          logger.error('Failed to check key generation status:', e);
        }
      }
      
      // Check helper consent - use global setting if no profile-specific consent
      let consent = await resolveHelperConsent(opts.profileId);
      
      // If no profile-specific consent, check global setting
      if (consent === undefined) {
        if (sshSettings.helperAutoConsent === 'always') {
          consent = 'yes';
        } else if (sshSettings.helperAutoConsent === 'never') {
          consent = 'no';
        } else {
          // 'ask' - show modal
          setHelperConsentModal({
            sessionId,
            profileId: opts.profileId,
            profileName: opts.profileName || opts.host,
            host: opts.host,
            tabId,
            opts
          });
          return; // Will continue in handleHelperConsent
        }
      }
      
      // Ensure helper in background (non-blocking) and record status in tab
      if (consent === 'yes') {
        try {
          (ensureHelper as any)?.(sessionId, { show, update, dismiss })?.then(async (res: any) => {
          setTabs((prev) => {
            // If auto-detect or no OS specified, use detected OS from helper
            const detectedOs = (!opts.os || opts.os === 'auto-detect') ? res?.os : opts.os;
            const updated = prev.map((t) => (t.id === tabId ? { ...t, status: { ...t.status, helperOk: !!res?.ok, helperVersion: res?.version, helperPath: res?.path, os: detectedOs } } : t));
            // Once helper is ready, trigger initial git status check if we have a cwd
            const tab = updated.find(t => t.id === tabId);
            if (res?.ok && res?.path) {
              // Use setTimeout to ensure state is updated before triggering
              if (tab?.status?.fullPath || tab?.cwd) {
                setTimeout(() => updateGitStatus(tabId), 100);
              }
              // Also trigger port detection after helper is ready
              setTimeout(() => {
                detectPorts(sessionId);
              }, 200);
            }
            return updated;
          });
          
          // Save detected OS back to profile if it was auto-detected
          if (opts.profileId && (!opts.os || opts.os === 'auto-detect') && res?.os) {
            try {
              const { getSshProfiles, saveSshProfile } = await import('@/store/persist');
              const profiles = await getSshProfiles();
              const profile = profiles.find(p => p.id === opts.profileId);
              if (profile) {
                profile.os = res.os;
                await saveSshProfile(profile);
                console.info('[SSH] Saved detected OS to profile:', opts.profileId, res.os);
              }
            } catch (e) {
              logger.error('[SSH] Failed to save detected OS to profile:', e);
            }
          }
        });
      } catch {}
      }
      
      // If consent is yes or no consent needed, continue immediately
      if (consent !== undefined) {
        await continueOpenSshFor(sessionId, tabId, opts);
      }
    } catch (e) {
      logger.error('SSH connection failed:', e);
      
      // Parse error message for better user feedback
      let errorMessage = String(e);
      let errorTitle = 'SSH Connection Failed';
      
      // Common error patterns
      if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
        errorTitle = 'SSH Connection Timeout';
        errorMessage = `Unable to connect to ${opts.host}:${opts.port || 22}. The server may be down or unreachable.`;
      } else if (errorMessage.includes('authentication') || errorMessage.includes('Authentication')) {
        errorTitle = 'SSH Authentication Failed';
        errorMessage = 'Invalid credentials or authentication method. Please check your username, password, or SSH key.';
      } else if (errorMessage.includes('refused') || errorMessage.includes('Connection refused')) {
        errorTitle = 'Connection Refused';
        errorMessage = `Connection to ${opts.host}:${opts.port || 22} was refused. The SSH service may not be running.`;
      } else if (errorMessage.includes('Host not trusted')) {
        errorTitle = 'Host Key Verification Failed';
        errorMessage = 'The host key verification was cancelled.';
      } else if (errorMessage.includes('Network')) {
        errorTitle = 'Network Error';
        errorMessage = `Unable to reach ${opts.host}. Please check your network connection.`;
      }
      
      // Show toast with error details
      addToast({ 
        title: errorTitle, 
        message: errorMessage,
        kind: 'error',
        timeout: 10000 // Show for 10 seconds
      });
      
      // Close the empty tab that was created
      closeTab(tabId);
    }
  }

  const active = tabs.find((t) => t.id === activeTab)!;
  // When switching tabs, ask panes to refit when shown
  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent('jaterm:panes-resized'));
    // Notify panes the tab became visible so they can scroll bottom after fit
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('jaterm:tab-shown'));
    }, 0);
  }, [activeTab]);

  // Listen for tunnel state updates
  React.useEffect(() => {
    (async () => {
      try {
        const { onTunnelState } = await import('@/types/ipc');
        const un = await onTunnelState((e) => {
          const { forwardId, status } = e as any;
          logger.info('Tunnel state event:', forwardId, status);
          setTabs((prev) => prev.map((tb) => {
            const t = tb;
            const f = (t.forwards || []).map((x) => x.id === forwardId ? { ...x, status } : x);
            return { ...t, forwards: f };
          }));
        });
        return () => { try { (un as any)(); } catch {} };
      } catch {}
    })();
  }, []);

  // Track notified ports per session to avoid duplicate notifications
  const notifiedPortsRef = React.useRef<Map<string, Set<number>>>(new Map());
  
  // Listen for detected ports on SSH connection
  React.useEffect(() => {
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const unlisten = await listen('ssh_detected_ports', (event) => {
          const { sessionId, ports } = event.payload as any;
          logger.info(`Detected ${ports.length} open ports on session ${sessionId}`);
          
          // Get or create the set of already notified ports for this session
          if (!notifiedPortsRef.current.has(sessionId)) {
            notifiedPortsRef.current.set(sessionId, new Set());
          }
          const notifiedPorts = notifiedPortsRef.current.get(sessionId)!;
          
          // Find ports that are newly detected (not previously notified)
          const newPorts = ports.filter((port: number) => !notifiedPorts.has(port));
          
          // Find ports that were previously notified but are now closed
          const closedPorts = Array.from(notifiedPorts).filter(port => !ports.includes(port));
          
          // Update the notified ports set
          newPorts.forEach((port: number) => notifiedPorts.add(port));
          closedPorts.forEach((port: number) => notifiedPorts.delete(port));
          
          // Show notification for closed ports
          if (closedPorts.length > 0) {
            closedPorts.forEach((port: number) => {
              show({
                title: `Port ${port} closed`,
                message: 'Service is no longer running on remote',
                kind: 'info'
              });
            });
          }
          
          // Show notification for each new port
          if (newPorts.length > 0) {
            newPorts.forEach((port: number) => {
              const portName = [
                { port: 3000, name: 'Node.js / React' },
                { port: 3001, name: 'Node.js (alt)' },
                { port: 4000, name: 'Jekyll / Phoenix' },
                { port: 4200, name: 'Angular' },
                { port: 5173, name: 'Vite' },
                { port: 5174, name: 'Vite (alt)' },
                { port: 8000, name: 'Django / Python' },
                { port: 8080, name: 'HTTP Alternative' },
                { port: 8081, name: 'Metro / React Native' },
                { port: 8888, name: 'Jupyter' },
                { port: 9000, name: 'PHP / SonarQube' }
              ].find(p => p.port === port);
              
              show({
                title: `Port ${port} detected`,
                message: portName ? `${portName.name} is now running` : 'New service detected on remote',
                kind: 'info',
                actions: [
                  {
                    label: 'Forward Port',
                    onClick: () => {
                      // Find the current tab for this session
                      setTabs(prev => {
                        const currentTab = prev.find(t => t.kind === 'ssh' && t.sshSessionId === sessionId);
                        if (!currentTab) return prev;
                        
                        // Switch to ports view
                        return prev.map(t => 
                          t.id === currentTab.id ? { ...t, view: 'ports' } : t
                        );
                      });
                      
                      // Add the forward
                      const forward = {
                        id: crypto.randomUUID(),
                        type: 'L' as const,
                        srcHost: '127.0.0.1',
                        srcPort: port,
                        dstHost: '127.0.0.1',
                        dstPort: port,
                        status: 'starting' as const
                      };
                      
                      // Trigger the forward activation
                      import('@/types/ipc').then(({ sshOpenForward }) => {
                        sshOpenForward({ sessionId, forward });
                      });
                    }
                  },
                  {
                    label: 'Custom Forward',
                    onClick: () => {
                      // Show the custom port dialog
                      setCustomPortDialog({ sessionId, remotePort: port });
                    }
                  }
                ]
              });
            });
          }
          
          // Update the tab's detected ports
          setTabs((prev) => prev.map((tb) => {
            if (tb.kind === 'ssh' && tb.sshSessionId === sessionId) {
              return { ...tb, detectedPorts: ports };
            }
            return tb;
          }));
        });
        return () => { unlisten(); };
      } catch {}
    })();
  }, [show]);

  // Event-driven port detection with debouncing
  const detectPorts = React.useCallback(debounce(async (sessionId: string) => {
    try {
      const { sshDetectPorts } = await import('@/types/ipc');
      const ports = await sshDetectPorts(sessionId);
      logger.info(`Event-driven port detection found ${ports.length} ports`);
      // The event handler will update the state
    } catch (e) {
      logger.error('Port detection failed:', e);
    }
  }, 1000), []); // Debounce for 1 second
  
  // Fallback port detection at a slower rate (30 seconds)
  React.useEffect(() => {
    const interval = setInterval(async () => {
      const currentTab = tabs.find(t => t.id === activeTab);
      if (currentTab?.kind === 'ssh' && currentTab.sshSessionId) {
        detectPorts(currentTab.sshSessionId);
      }
    }, 30000); // Poll every 30 seconds as fallback

    return () => clearInterval(interval);
  }, [tabs, activeTab, detectPorts]);


  // Ensure local helper when a local tab becomes active and has a cwd, if not checked yet
  React.useEffect(() => {
    const t = tabs.find((x) => x.id === activeTab);
    if (!t) return;
    const hasCwd = !!(t.status?.fullPath || t.cwd);
    const isLocal = t.kind !== 'ssh';
    const checked = (t.status as any)?.helperChecked === true || typeof t.status?.helperOk !== 'undefined' || typeof t.status?.helperVersion !== 'undefined';
    if (isLocal && hasCwd && !checked) {
      (ensureLocalHelper as any)?.()?.then((res: any) => {
        setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, status: { ...tb.status, helperOk: !!res?.ok, helperVersion: res?.version, helperPath: res?.path, helperChecked: true } } : tb)));
      }).catch(() => {
        setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, status: { ...tb.status, helperOk: false, helperChecked: true } } : tb)));
      });
    }
  }, [tabs, activeTab]);

  // Event-driven Git status updates with debouncing
  const updateGitStatus = React.useCallback(debounce(async (tabId: string) => {
    const t = tabs.find((x) => x.id === tabId);
    if (!t) return;
    const cwd = (t.status?.fullPath ?? t.cwd) as string | undefined;
    if (!cwd) return;
    
    const kind = t.kind === 'ssh' ? 'ssh' : 'local';
    const sessionId = (t as any)?.sshSessionId as string | undefined;
    const helperPath = t.status?.helperPath ?? null;
    
    try {
      const st = await gitStatusViaHelper({ kind: kind as any, sessionId, helperPath }, cwd);
      setTabs((prev) => prev.map((tb) => (tb.id === tabId ? { ...tb, status: { ...tb.status, branch: st.branch, ahead: st.ahead, behind: st.behind } } : tb)));
    } catch {}
  }, 500), [tabs]); // Debounce for 500ms
  
  // Fallback polling at a much slower rate (30 seconds) for safety
  React.useEffect(() => {
    const t = tabs.find((x) => x.id === activeTab);
    if (!t) return;
    const cwd = (t.status?.fullPath ?? t.cwd) as string | undefined;
    if (!cwd) return;
    // Only poll when we know we're inside a repo
    const inRepo = !!t.status && t.status.branch && t.status.branch !== '-';
    if (!inRepo) return;
    
    const iv = window.setInterval(() => {
      updateGitStatus(t.id);
    }, 30000); // 30 seconds instead of 5
    
    return () => window.clearInterval(iv);
  }, [tabs, activeTab, updateGitStatus]);
  
  // Store references to debounced functions
  React.useEffect(() => {
    debouncedUpdateGitRef.current = updateGitStatus;
    debouncedDetectPortsRef.current = detectPorts;
  }, [updateGitStatus, detectPorts]);
  
  // Register a terminal event detector for a pane
  const registerTerminalEventDetector = React.useCallback((paneId: string, tabId: string) => {
    if (terminalEventDetectors.current.has(paneId)) return terminalEventDetectors.current.get(paneId)!;
    
    const detector = new TerminalEventDetector();
    terminalEventDetectors.current.set(paneId, detector);
    
    // Listen for events
    detector.on((event) => {
      const tab = tabs.find(t => t.id === tabId);
      if (!tab) return;
      
      // logger.info(`Terminal event in pane ${paneId}:`, event);
      
      switch (event.type) {
        case 'git-command':
          // Git command executed, update status
          debouncedUpdateGitRef.current?.(tabId);
          break;
          
        case 'process-start':
          // Process started, check ports for SSH tabs
          if (tab.kind === 'ssh' && tab.sshSessionId) {
            debouncedDetectPortsRef.current?.(tab.sshSessionId);
          }
          break;
          
        case 'command':
          // Any command executed
          if (event.command.includes('git')) {
            debouncedUpdateGitRef.current?.(tabId);
          }
          // Check if it's a process that might open ports
          if (tab.kind === 'ssh' && tab.sshSessionId) {
            if (event.command.match(/npm|yarn|pnpm|python|node|cargo|rails|django/)) {
              // Delay a bit to let the process start
              setTimeout(() => {
                if (tab.sshSessionId) debouncedDetectPortsRef.current?.(tab.sshSessionId);
              }, 2000);
            }
          }
          break;
          
        case 'directory-change':
          // Directory changed, update git status
          debouncedUpdateGitRef.current?.(tabId);
          break;
          
        case 'prompt':
          // New prompt appeared, good time to check git status if in repo
          const inRepo = !!tab.status && tab.status.branch && tab.status.branch !== '-';
          if (inRepo) {
            debouncedUpdateGitRef.current?.(tabId);
          }
          break;
          
        case 'process-stop':
          // Process stopped (Ctrl+C), check ports for SSH tabs
          if (tab.kind === 'ssh' && tab.sshSessionId) {
            // Check ports after a short delay to let the process fully stop
            setTimeout(() => {
              if (tab.sshSessionId) debouncedDetectPortsRef.current?.(tab.sshSessionId);
            }, 500);
          }
          // Also update git status in case a git operation was cancelled
          debouncedUpdateGitRef.current?.(tabId);
          break;
      }
    });
    
    return detector;
  }, [tabs]);
  
  // Unregister a terminal event detector
  const unregisterTerminalEventDetector = React.useCallback((paneId: string) => {
    const detector = terminalEventDetectors.current.get(paneId);
    if (detector) {
      detector.reset();
      terminalEventDetectors.current.delete(paneId);
    }
  }, []);
  
  // Handle terminal data from panes
  const handleTerminalData = React.useCallback((paneId: string, event: { type: 'input' | 'output'; data: string }) => {
    // Find which tab this pane belongs to
    const tab = tabs.find(t => t.panes.includes(paneId));
    if (!tab) return;
    
    
    // Get or create detector for this pane
    let detector = terminalEventDetectors.current.get(paneId);
    if (!detector) {
      detector = registerTerminalEventDetector(paneId, tab.id);
    }
    
    // Feed data to detector
    if (event.type === 'input') {
      detector.processInput(event.data);
    } else {
      detector.processData(event.data);
      if (tab.id !== activeTab) {
        // Mark background activity if no bell pending
        setTabs((prev) => prev.map((tb) => tb.id === tab.id && tb.indicator !== 'bell' ? { ...tb, indicator: 'activity' } : tb));
      }
    }
  }, [tabs, registerTerminalEventDetector]);

  // Debounced save function for workspace persistence
  const saveWorkspaceDebounced = React.useMemo(() => {
    const config = getCachedConfig();
    const intervalMs = (config?.general?.stateInterval || 60) * 1000; // Convert seconds to milliseconds
    
    return debounce(async (tabsToSave: Tab[], activeTabId: string) => {
      const ws = {
        activeTabIndex: Math.max(0, tabsToSave.findIndex((t) => t.id === activeTabId)),
        tabs: tabsToSave
          .filter((t) => t.cwd && t.kind !== 'ssh')
          .map((t) => ({ cwd: t.status.fullPath ?? (t.cwd as string), title: t.title, layoutShape: layoutToShape(t.layout as any) })),
      };
      await saveAppState({ workspace: ws });
    }, intervalMs);
  }, []); // Only create once on mount
  
  // Persist workspace on changes (local tabs only)
  React.useEffect(() => {
    // Check if auto-save is enabled in settings
    const config = getCachedConfig();
    if (!config?.general?.autoSaveState) {
      return; // Skip auto-save if disabled
    }
    
    // Use debounced save function
    saveWorkspaceDebounced(tabs, activeTab);
  }, [tabs, activeTab, saveWorkspaceDebounced]);

  // Restore workspace on first load and check encryption status
  React.useEffect(() => {
    (async () => {
      try {
        // Initialize new encryption system
        const initialized = await initEncryption();
        
        if (!initialized) {
          // DEK not found in keychain, check what we need to do
          const needsSetup = await encryptionNeedsSetup();
          const needsMigration = await checkProfilesNeedMigrationV2('jaterm');
          
          if (needsSetup) {
            // First time setup - need to create master password
            setMasterKeyDialog({ isOpen: true, mode: 'setup', isMigration: needsMigration });
          } else {
            // Have encrypted DEK but no keychain access - need master password to recover
            setMasterKeyDialog({ isOpen: true, mode: 'unlock' });
          }
        } else {
          // Encryption initialized successfully
          // Check if we need to migrate plain text profiles
          const needsMigration = await checkProfilesNeedMigrationV2('jaterm');
          if (needsMigration) {
            // Auto-migrate plain text profiles
            await migrateProfilesV2('jaterm');
            addToast({ title: 'Profiles migrated to encrypted format', kind: 'success' } as any);
          }
        }
        
        const s = await loadAppState();
        const ws = s.workspace;
        if (ws && ws.tabs && ws.tabs.length) {
          // Always keep the sessions tab as the first tab
          const sessionsTab = { id: sessionsId, cwd: null as any, panes: [], activePane: null as any, status: {} };
          // Prepare restored tabs (skip any that might be the old sessions tab)
          const restoredTabs = ws.tabs
            .filter(t => t.cwd || t.layoutShape) // Only restore tabs that had actual content
            .map(() => ({ id: crypto.randomUUID(), cwd: null as any, panes: [], activePane: null as any, status: {} as any, title: undefined as any, layout: undefined as any }));
          
          // Combine sessions tab with restored tabs
          const newTabs = [sessionsTab, ...restoredTabs];
          setTabs(newTabs);
          
          // Adjust active tab index (account for sessions tab being at index 0)
          const targetIndex = Math.min((ws.activeTabIndex ?? 0) + 1, newTabs.length - 1);
          setActiveTab(newTabs[targetIndex].id);
          
          // Open each restored tab sequentially (skip sessions tab at index 0)
          for (let i = 0; i < restoredTabs.length; i++) {
            const entry = ws.tabs[i];
            if (entry.cwd || entry.layoutShape) {
              await openSessionFor(restoredTabs[i].id, { cwd: entry.cwd, layoutShape: entry.layoutShape, title: entry.title });
            }
          }
        }
      } catch (e) {
        logger.warn('workspace restore failed', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      // Avoid when typing in inputs/textareas
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // Split shortcuts: Meta+Shift+H/V
      if (meta && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
        e.preventDefault();
        const t = tabs.find((x) => x.id === activeTab);
        const pane = t?.activePane ?? (t?.panes[0] || null);
        if (pane) void (async () => splitPane(pane, 'row'))();
      }
      if (meta && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        const t = tabs.find((x) => x.id === activeTab);
        const pane = t?.activePane ?? (t?.panes[0] || null);
        if (pane) void (async () => splitPane(pane, 'column'))();
      }
      // Close active pane: Meta+W
      if (meta && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        const t = tabs.find((x) => x.id === activeTab);
        const pane = t?.activePane ?? (t?.panes[0] || null);
        if (pane) void closePane(pane);
      }
      // Switch panes: Meta+Alt+ArrowLeft/Right cycles
      if (meta && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const t = tabs.find((x) => x.id === activeTab);
        if (t && t.panes.length > 1) {
          const idx = t.panes.indexOf(t.activePane || t.panes[0]);
          const next = e.key === 'ArrowRight' ? (idx + 1) % t.panes.length : (idx - 1 + t.panes.length) % t.panes.length;
          setTabs((prev) => prev.map((tb) => (tb.id === activeTab ? { ...tb, activePane: t.panes[next] } : tb)));
        }
      }
      // New Tab: Meta+T
      if (meta && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        newTab();
      }
      // Compose with AI: Meta/Ctrl+K
      if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setComposeOpen(true);
      }
      // Command Palette: Meta/Ctrl+Shift+P
      if (meta && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
      // Next/Prev tab: Ctrl+Tab / Ctrl+Shift+Tab (Meta-less to avoid browser conflict in app window)
      if (e.ctrlKey && !e.metaKey && e.key === 'Tab') {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTab);
        if (idx !== -1) {
          const next = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
          setActiveTab(tabs[next].id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabs, activeTab]);
  
  // Menu event handlers
  React.useEffect(() => {
    const unlisteners: (() => void)[] = [];
    
    const setupMenuListeners = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      
      // File menu events
      unlisteners.push(await listen('menu:new_tab', () => newTab()));
      unlisteners.push(await listen('menu:close_tab', () => {
        if (activeTab) closeTab(activeTab);
      }));
      unlisteners.push(await listen('menu:open_ssh', () => {
        // Open sessions tab and focus SSH section
        setActiveTab(sessionsId);
      }));
      unlisteners.push(await listen('menu:settings', () => {
        setTabs(prev => {
          // Check if settings tab already exists
          const existingSettings = prev.find(t => t.kind === 'settings');
          if (existingSettings) {
            setActiveTab(existingSettings.id);
            return prev; // No change to tabs
          } else {
            const settingsTab: Tab = {
              id: crypto.randomUUID(),
              kind: 'settings',
              cwd: null,
              panes: [],
              activePane: null,
              status: {},
              title: 'Settings',
              layoutShape: { type: 'leaf' }
            };
            setActiveTab(settingsTab.id);
            return [...prev, settingsTab];
          }
        });
      }));
      
      // Edit menu events
      unlisteners.push(await listen('menu:clear_terminal', () => {
        const t = tabs.find((x) => x.id === activeTab);
        const pane = t?.activePane ?? (t?.panes[0] || null);
        if (pane && pane.kind === 'local') {
          // Send clear command (Ctrl+L)
          void ptyWrite(pane.id, '\x0c');
        } else if (pane && pane.kind === 'ssh') {
          void sshWrite(pane.id, '\x0c');
        }
      }));
      unlisteners.push(await listen('menu:find', () => {
        // TODO: Implement find functionality
        addToast('info', 'Find functionality coming soon!');
      }));
      
      // View menu events
      unlisteners.push(await listen('menu:zoom_in', () => {
        document.documentElement.style.fontSize = `${parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.1}px`;
      }));
      unlisteners.push(await listen('menu:zoom_out', () => {
        document.documentElement.style.fontSize = `${parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.9}px`;
      }));
      unlisteners.push(await listen('menu:reset_zoom', async () => {
        try {
          const { getCachedConfig } = await import('@/services/settings');
          const config = getCachedConfig();
          const baseFontSize = config?.terminal?.fontSize || 14;
          // Use a slightly larger base for UI elements
          document.documentElement.style.fontSize = `${baseFontSize + 2}px`;
        } catch {
          document.documentElement.style.fontSize = '16px';
        }
      }));
      unlisteners.push(await listen('menu:toggle_git', () => setGitOpen((prev) => !prev)));
      unlisteners.push(await listen('menu:toggle_sftp', () => setSftpOpen((prev) => !prev)));
      unlisteners.push(await listen('menu:toggle_ports', () => setPortsOpen((prev) => !prev)));
      
      // Window menu events
      unlisteners.push(await listen('menu:split_horizontal', () => {
        const t = tabs.find((x) => x.id === activeTab);
        const pane = t?.activePane ?? (t?.panes[0] || null);
        if (pane) void (async () => splitPane(pane, 'row'))();
      }));
      unlisteners.push(await listen('menu:split_vertical', () => {
        const t = tabs.find((x) => x.id === activeTab);
        const pane = t?.activePane ?? (t?.panes[0] || null);
        if (pane) void (async () => splitPane(pane, 'column'))();
      }));
      unlisteners.push(await listen('menu:next_tab', () => {
        const idx = tabs.findIndex((t) => t.id === activeTab);
        const next = (idx + 1) % tabs.length;
        setActiveTab(tabs[next].id);
      }));
      unlisteners.push(await listen('menu:prev_tab', () => {
        const idx = tabs.findIndex((t) => t.id === activeTab);
        const prev = (idx - 1 + tabs.length) % tabs.length;
        setActiveTab(tabs[prev].id);
      }));
      unlisteners.push(await listen('menu:next_pane', () => {
        const t = tabs.find((x) => x.id === activeTab);
        if (t && t.panes.length > 1) {
          const idx = t.panes.indexOf(t.activePane || t.panes[0]);
          const next = (idx + 1) % t.panes.length;
          setTabs((prev) => prev.map((tb) => (tb.id === activeTab ? { ...tb, activePane: t.panes[next] } : tb)));
        }
      }));
      unlisteners.push(await listen('menu:prev_pane', () => {
        const t = tabs.find((x) => x.id === activeTab);
        if (t && t.panes.length > 1) {
          const idx = t.panes.indexOf(t.activePane || t.panes[0]);
          const prev = (idx - 1 + t.panes.length) % t.panes.length;
          setTabs((prev) => prev.map((tb) => (tb.id === activeTab ? { ...tb, activePane: t.panes[prev] } : tb)));
        }
      }));
      
      // Help menu events
      unlisteners.push(await listen('menu:about', () => {
        addToast('info', 'JaTerm v1.5.6\nA modern terminal emulator with SSH support\n© 2025 Kobozo');
      }));
      
      // Check for updates handler
      unlisteners.push(await listen('menu:check_updates', () => {
        checkForUpdatesInteractive();
      }));
      
      // URL opening handler
      unlisteners.push(await listen<string>('menu:open_url', async (event) => {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(event.payload);
      }));
    };
    
    setupMenuListeners();
    
    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [tabs, activeTab, sessionsId]);
  
  return (
    <div className="app-root">
      <TabsBar
        tabs={tabs.map((t) => {
          const full = t.status.fullPath ?? t.cwd;
          const isSessions = t.id === sessionsId;
          const nonSshBaseTitle = t.title ?? (isSessions ? 'Sessions' : (full ?? ''));
          const title = t.kind === 'ssh' ? (t.title ?? 'SSH') : (nonSshBaseTitle || '');
          const icon = isSessions ? '\uf07c' : (t.kind === 'ssh' ? '\uf0c1' : '\uf120'); // folder-open, link, terminal icons
          return { id: t.id, title, icon, isWelcome: isSessions, indicator: t.indicator };
        })}
        activeId={activeTab}
        onSelect={(id) => {
          setActiveTab(id);
          // Clear indicator when tab becomes active
          setTabs((prev) => prev.map((tb) => tb.id === id ? { ...tb, indicator: undefined } : tb));
        }}
        onClose={closeTab}
        onAdd={newTab}
      />
      {/* Render all tabs' content; hide inactive with display:none to preserve xterm buffers */}
      {tabs.map((t) => (
        <div key={t.id} style={{ display: t.id === activeTab ? 'block' : 'none', height: '100%' }}>
          <div style={{ display: 'flex', height: '100%', width: '100%' }}>
            {/* Sidebar - only show for terminal views (local and SSH) */}
            {t.cwd && t.kind !== 'settings' && (
              <div style={{ width: 44, borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', gap: 6, padding: 6, boxSizing: 'border-box' }}>
              <button
                className="nf-icon"
                style={{ padding: 6, borderRadius: 4, border: '1px solid #444', background: (t.view ?? 'terminal') === 'terminal' ? '#2b2b2b' : 'transparent', color: '#ddd', cursor: 'pointer' }}
                onClick={() => {
                  setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, view: 'terminal' } : tb)));
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('jaterm:panes-resized'));
                    window.dispatchEvent(new CustomEvent('jaterm:tab-shown'));
                  }, 0);
                }}
                title="Terminal"
              >
                ⌘
              </button>
              {/* Only show Git button when in a git repository */}
              {t.status?.branch && t.status.branch !== '-' && (
                <button
                  className="nf-icon"
                  style={{ padding: 6, borderRadius: 4, border: '1px solid #444', background: t.view === 'git' ? '#2b2b2b' : 'transparent', color: '#ddd', cursor: 'pointer' }}
                  onClick={() => {
                    setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, view: 'git' } : tb)));
                  }}
                  title="Git Tools"
                >
                  ⎇
                </button>
              )}
              <button
                className="nf-icon"
                style={{ padding: 6, borderRadius: 4, border: '1px solid #444', background: t.view === 'files' ? '#2b2b2b' : 'transparent', color: '#ddd', cursor: 'pointer' }}
                onClick={() => setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, view: 'files' } : tb)))}
                title="Files"
              >
                
              </button>
              {t.kind === 'ssh' && (
                <button
                  className="nf-icon"
                  style={{ padding: 6, borderRadius: 4, border: '1px solid #444', background: t.view === 'ports' ? '#2b2b2b' : 'transparent', color: '#ddd', cursor: 'pointer' }}
                  onClick={() => setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, view: 'ports' } : tb)))}
                  title="Ports"
                >
                  ≣
                </button>
              )}
              </div>
            )}
            {/* Content: render both views and toggle visibility to preserve terminal DOM */}
            <div style={{ flex: 1, minWidth: 0, height: '100%', position: 'relative' }}>
              {/* Git view */}
              <div style={{ display: (t.view === 'git') ? 'block' : 'none', height: '100%' }}>
                <GitTools
                  cwd={t.status.fullPath ?? t.cwd ?? undefined}
                  kind={t.kind}
                  sessionId={(t as any).sshSessionId}
                  helperPath={t.status.helperPath}
                  title={t.title ?? null}
                  isActive={t.view === 'git'}
                  onStatus={(st) => setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, status: { ...tb.status, branch: st.branch, ahead: st.ahead, behind: st.behind } } : tb)))}
                />
              </div>
              {/* Files view with integrated editor */}
              <div style={{ display: (t.view === 'files') ? 'block' : 'none', height: '100%' }}>
                <FileExplorerWithEditor
                  isLocal={!(t.kind === 'ssh' && t.sshSessionId)}
                  sessionId={t.kind === 'ssh' ? t.sshSessionId : undefined}
                  cwd={(t as any).sftpCwd || t.status.fullPath || t.status.cwd || t.cwd || undefined}
                  isActive={t.view === 'files'}
                  onCwdChange={(next) => {
                    setTabs((prev) => prev.map((tb) => 
                      tb.id === t.id ? { ...tb, sftpCwd: next } : tb
                    ));
                  }}
                />
              </div>
              {/* Ports view (kept mounted) */}
              <div style={{ display: (t.view === 'ports') ? 'block' : 'none', height: '100%' }}>
                <PortsPanel
                  forwards={t.forwards || []}
                  detectedPorts={t.detectedPorts || []}
                  suggestedPorts={[3000, 3001, 4000, 4200, 5173, 5174, 8000, 8080, 8081, 8888, 9000]}
                  onRefreshPorts={async () => {
                    if (t.kind !== 'ssh' || !t.sshSessionId) return;
                    try {
                      const { sshDetectPorts } = await import('@/types/ipc');
                      const ports = await sshDetectPorts(t.sshSessionId);
                      logger.info(`Manual refresh found ${ports.length} ports`);
                    } catch (e) {
                      logger.error('Port refresh failed:', e);
                    }
                  }}
                  onAdd={async (fwd) => {
                    if (t.kind !== 'ssh' || !t.sshSessionId) return;
                    const { sshOpenForward } = await import('@/types/ipc');
                    try {
                      const res: any = await sshOpenForward({ sessionId: t.sshSessionId, forward: { id: '', type: fwd.type, srcHost: fwd.srcHost, srcPort: fwd.srcPort, dstHost: fwd.dstHost, dstPort: fwd.dstPort } as any });
                      const fid = typeof res === 'string' ? res : (res?.forwardId || res);
                      setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, forwards: [ ...(tb.forwards || []), { ...fwd, id: fid, status: 'starting' } ] } : tb)));
                    } catch (e) { alert('open forward failed: ' + (e as any)); }
                  }}
                  onActivate={async (fwd) => {
                    if (t.kind !== 'ssh' || !t.sshSessionId) return;
                    const { sshOpenForward } = await import('@/types/ipc');
                    try {
                      const res: any = await sshOpenForward({ sessionId: t.sshSessionId, forward: { id: '', type: fwd.type, srcHost: fwd.srcHost, srcPort: fwd.srcPort, dstHost: fwd.dstHost, dstPort: fwd.dstPort } as any });
                      const fid = typeof res === 'string' ? res : (res?.forwardId || res);
                      setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, forwards: [ ...(tb.forwards || []), { ...fwd, id: fid, status: 'starting' } ] } : tb)));
                    } catch (e) { alert('activate forward failed: ' + (e as any)); }
                  }}
                  onStop={async (id) => {
                    const { sshCloseForward } = await import('@/types/ipc');
                    try { await sshCloseForward(id); } catch {}
                    setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, forwards: (tb.forwards || []).map((x) => x.id === id ? { ...x, status: 'closed' } : x) } : tb)));
                  }}
                  onDelete={(id) => {
                    setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, forwards: (tb.forwards || []).filter((x) => x.id !== id) } : tb)));
                  }}
                  onEdit={async (id, newFwd) => {
                    // Stop the old forward and create a new one
                    const { sshCloseForward, sshOpenForward } = await import('@/types/ipc');
                    try {
                      await sshCloseForward(id);
                      const res: any = await sshOpenForward({ sessionId: t.sshSessionId, forward: { id: '', type: newFwd.type, srcHost: newFwd.srcHost, srcPort: newFwd.srcPort, dstHost: newFwd.dstHost, dstPort: newFwd.dstPort } as any });
                      const fid = typeof res === 'string' ? res : (res?.forwardId || res);
                      setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { 
                        ...tb, 
                        forwards: tb.forwards?.map(f => f.id === id ? { ...newFwd, id: fid, status: 'starting' } : f) 
                      } : tb)));
                    } catch (e) { alert('edit forward failed: ' + (e as any)); }
                  }}
                />
              </div>
              {/* Terminal/Welcome view (kept mounted) */}
              <div style={{ display: (t.view === 'git' || t.view === 'ports' || t.view === 'files') ? 'none' : 'block', height: '100%' }}>
                {t.kind === 'settings' ? (
                  <SettingsPane />
                ) : t.kind === 'ssh' ? (
                  t.layout ? (
                    <SplitTree
                      node={t.layout as any}
                      onChange={(n) => setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, layout: n } : tb)))}
                      renderLeaf={(pid) => (
                        <RemoteTerminalPane
                          key={pid}
                          id={pid}
                          desiredCwd={undefined}
                          sessionId={(t as any).sshSessionId}
                          terminalSettings={(t as any).terminalSettings}
                          isPrimary={t.primaryPane === pid}
                          onSetPrimary={t.panes.length > 1 ? () => setPrimaryPane(pid) : undefined}
                          onCwd={(pid, dir) => updateTabCwd(t.id, dir, pid)}
                          onTitle={(_pid, title) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, title } : tt)))}
                          onFocusPane={(pane) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, activePane: pane } : tt)))}
                          onClose={closePane}
                          onDisconnected={t.reconnectSettings?.enabled ? handleSshDisconnection : undefined}
                          isReconnecting={t.reconnectState?.isReconnecting}
                          reconnectInfo={t.reconnectState ? {
                            attempts: t.reconnectState.attempts,
                            maxAttempts: t.reconnectState.maxAttempts || 5,
                            nextAttempt: t.reconnectState.lastAttempt
                          } : undefined}
                          onCancelReconnect={() => cancelReconnection(t.id)}
                          onSplit={(pane, dir) => splitPane(pane, dir)}
                          onCompose={() => setComposeOpen(true)}
                          onTerminalEvent={handleTerminalData}
                        />
                      )}
                    />
                  ) : (
                    <SplitView>
                      {t.panes.map((pid) => (
                        <RemoteTerminalPane
                          key={pid}
                          id={pid}
                          desiredCwd={undefined}
                          sessionId={(t as any).sshSessionId}
                          terminalSettings={(t as any).terminalSettings}
                          isPrimary={t.primaryPane === pid}
                          onSetPrimary={t.panes.length > 1 ? () => setPrimaryPane(pid) : undefined}
                          onCwd={(pid, dir) => updateTabCwd(t.id, dir, pid)}
                          onTitle={(_pid, title) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, title } : tt)))}
                          onFocusPane={(pane) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, activePane: pane } : tt)))}
                          onClose={closePane}
                          onDisconnected={t.reconnectSettings?.enabled ? handleSshDisconnection : undefined}
                          isReconnecting={t.reconnectState?.isReconnecting}
                          reconnectInfo={t.reconnectState ? {
                            attempts: t.reconnectState.attempts,
                            maxAttempts: t.reconnectState.maxAttempts || 5,
                            nextAttempt: t.reconnectState.lastAttempt
                          } : undefined}
                          onCancelReconnect={() => cancelReconnection(t.id)}
                          onSplit={(pane, dir) => splitPane(pane, dir)}
                          onCompose={() => setComposeOpen(true)}
                          onTerminalEvent={handleTerminalData}
                        />
                      ))}
                    </SplitView>
                  )
                ) : t.cwd ? (
                  t.layout ? (
                    <SplitTree
                      node={t.layout as any}
                      onChange={(n) => setTabs((prev) => prev.map((tb) => (tb.id === t.id ? { ...tb, layout: n } : tb)))}
                      renderLeaf={(pid) => (
                        <TerminalPane
                          key={pid}
                          id={pid}
                          desiredCwd={t.status.fullPath ?? t.cwd ?? undefined}
                          onCwd={(pid, dir) => updateTabCwd(t.id, dir, pid)}
                          onTitle={(_pid, title) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, title } : tt)))}
                          onFocusPane={(pane) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, activePane: pane } : tt)))}
                          onClose={closePane}
                          onSplit={(pane, dir) => splitPane(pane, dir)}
                          onCompose={() => setComposeOpen(true)}
                          onTerminalEvent={handleTerminalData}
                        />
                      )}
                    />
                  ) : (
                    <SplitView>
                      {t.panes.map((pid) => (
                        <TerminalPane
                          key={pid}
                          id={pid}
                          desiredCwd={t.status.fullPath ?? t.cwd ?? undefined}
                          onCwd={(pid, dir) => updateTabCwd(t.id, dir, pid)}
                          onTitle={(_pid, title) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, title } : tt)))}
                          onFocusPane={(pane) => setTabs((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, activePane: pane } : tt)))}
                          onClose={closePane}
                          onSplit={(pane, dir) => splitPane(pane, dir)}
                          onTerminalEvent={handleTerminalData}
                        />
                      ))}
                    </SplitView>
                  )
                ) : (
                  <Sessions
                    sshProfiles={sshProfiles}
                    onOpenFolder={(p) => {
                      const id = crypto.randomUUID();
                      setTabs((prev) => [...prev, { id, cwd: null, panes: [], activePane: null, status: {} }]);
                      setActiveTab(id);
                      if (typeof p === 'string') {
                        openFolderFor(id, p);
                      } else if (p && typeof p === 'object' && p.path) {
                        openFolderFor(id, p.path, { terminal: (p as any).terminal, shell: (p as any).shell });
                      } else {
                        logger.error('Invalid path provided to onOpenFolder:', p);
                      }
                    }}
                    onOpenSession={(s) => {
                      const id = crypto.randomUUID();
                      setTabs((prev) => [...prev, { id, cwd: null, panes: [], activePane: null, status: {} }]);
                      setActiveTab(id);
                      openSessionFor(id, s);
                    }}
                    onOpenSsh={(o) => {
                      const id = crypto.randomUUID();
                      setTabs((prev) => [...prev, { id, cwd: null, panes: [], activePane: null, status: {} }]);
                      setActiveTab(id);
                      openSshFor(id, o);
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
      {/* Single status bar for active tab */}
      {active && (
        <div className="status-bar" style={{ display: 'flex', gap: 12, alignItems: 'center', position: 'relative' }}>
          <GitStatusBar 
            cwd={active.status?.fullPath ?? active.status?.cwd ?? active.cwd} 
            branch={active.status?.branch} 
            ahead={active.status?.ahead} 
            behind={active.status?.behind}
            staged={active.status?.staged}
            unstaged={active.status?.unstaged}
          />
          <span style={{ width: 1, height: 14, background: '#444', display: 'inline-block' }} />
          
          {/* Helper status aligned right with colored indicator */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            {active.status?.os && (
              <>
                <span style={{ color: '#8fe18f' }}>OS: {active.status.os}</span>
                <span style={{ width: 1, height: 14, background: '#444', display: 'inline-block' }} />
              </>
            )}
            <span
              title={active.status?.helperOk ? 'Helper OK' : 'Helper not ready'}
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: active.status?.helperOk ? '#8fe18f' : '#f0a1a1',
                display: 'inline-block',
              }}
            />
            <span>Helper: {active.status?.helperVersion ? active.status?.helperVersion : '—'}</span>
            <span style={{ width: 1, height: 14, background: '#444', display: 'inline-block' }} />
            <button onClick={checkForUpdatesInteractive} disabled={updateChecking} title="Check for updates" style={{ fontSize: 12 }}>
              {updateChecking ? 'Checking…' : (updateAvailable ? 'Update Ready' : 'Check Updates')}
            </button>
          </div>
          <ComposeDrawer
            open={composeOpen}
            onClose={() => setComposeOpen(false)}
            onSend={(text) => {
              if (active.activePane) {
                if (active.kind === 'ssh') sshWrite({ channelId: active.activePane, data: text });
                else ptyWrite({ ptyId: active.activePane, data: text });
              }
              setComposeOpen(false);
            }}
          />
        </div>
      )}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
      {customPortDialog && (
        <div style={{ 
          position: 'fixed', 
          inset: 0, 
          display: 'grid', 
          placeItems: 'center', 
          background: 'rgba(0,0,0,0.5)',
          zIndex: 999
        }}>
          <div style={{ 
            background: '#1e1e1e', 
            color: '#eee', 
            padding: 20, 
            borderRadius: 8, 
            width: 380,
            maxWidth: '90vw',
            border: '1px solid #444'
          }}>
            <h3 style={{ marginTop: 0 }}>Custom Port Forward</h3>
            <p style={{ fontSize: 14, color: '#bbb', marginBottom: 16 }}>
              Forward remote port {customPortDialog.remotePort} to local address:
            </p>
            <form onSubmit={(e) => {
              e.preventDefault();
              const form = e.target as HTMLFormElement;
              const bindAddress = (form.elements.namedItem('bindAddress') as HTMLInputElement).value;
              const localPort = Number((form.elements.namedItem('localPort') as HTMLInputElement).value);
              
              if (localPort < 1 || localPort > 65535) {
                alert('Invalid port number. Must be between 1 and 65535.');
                return;
              }
              
              // Find the current tab for this session
              setTabs(prev => {
                const currentTab = prev.find(t => t.kind === 'ssh' && t.sshSessionId === customPortDialog.sessionId);
                if (!currentTab) return prev;
                
                // Switch to ports view
                return prev.map(t => 
                  t.id === currentTab.id ? { ...t, view: 'ports' } : t
                );
              });
              
              // Add the forward with custom local port and bind address
              const forward = {
                id: crypto.randomUUID(),
                type: 'L' as const,
                srcHost: bindAddress,
                srcPort: localPort,
                dstHost: '127.0.0.1',
                dstPort: customPortDialog.remotePort,
                status: 'starting' as const
              };
              
              // Trigger the forward activation
              import('@/types/ipc').then(({ sshOpenForward }) => {
                sshOpenForward({ sessionId: customPortDialog.sessionId, forward });
              });
              
              // Show confirmation
              show({
                title: 'Port forward created',
                message: `Forwarding ${bindAddress}:${localPort} → remote:${customPortDialog.remotePort}`,
                kind: 'success'
              });
              
              // Close dialog
              setCustomPortDialog(null);
            }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#999', marginBottom: 4 }}>
                  Bind Address
                </label>
                <input
                  name="bindAddress"
                  type="text"
                  defaultValue="127.0.0.1"
                  placeholder="127.0.0.1"
                  style={{
                    width: 'calc(100% - 18px)',
                    padding: '8px',
                    fontSize: 14,
                    background: '#2a2a2a',
                    color: '#eee',
                    border: '1px solid #444',
                    borderRadius: 4,
                    boxSizing: 'border-box'
                  }}
                />
                <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>
                  Use 127.0.0.1 for localhost only, 0.0.0.0 for all interfaces
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#999', marginBottom: 4 }}>
                  Local Port
                </label>
                <input
                  name="localPort"
                  type="number"
                  defaultValue={customPortDialog.remotePort}
                  min="1"
                  max="65535"
                  autoFocus
                  style={{
                    width: 'calc(100% - 18px)',
                    padding: '8px',
                    fontSize: 14,
                    background: '#2a2a2a',
                    color: '#eee',
                    border: '1px solid #444',
                    borderRadius: 4,
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setCustomPortDialog(null)}
                  style={{
                    padding: '6px 12px',
                    background: '#333',
                    color: '#eee',
                    border: '1px solid #555',
                    borderRadius: 4,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '6px 12px',
                    background: '#10b981',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer'
                  }}
                >
                  Forward Port
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {helperConsentModal && (
        <HelperConsentModal
          profileName={helperConsentModal.profileName}
          host={helperConsentModal.host}
          onConsent={handleHelperConsent}
          onCancel={() => {
            // Cancel: disconnect SSH and clear modal
            const { sessionId } = helperConsentModal;
            setHelperConsentModal(null);
            sshDisconnect(sessionId).catch(() => {});
            addToast({ title: 'SSH Connection Cancelled', message: 'Helper deployment was declined', kind: 'info' });
          }}
        />
      )}
      {keyGenerationModal && (
        <KeyGenerationModal
          sessionId={keyGenerationModal.sessionId}
          profileName={keyGenerationModal.profileName}
          host={keyGenerationModal.host}
          port={keyGenerationModal.port}
          user={keyGenerationModal.user}
          onSuccess={async (keyPath, passphrase) => {
            // Update the profile to use the new key
            try {
              const { getSshProfiles, saveSshProfile } = await import('@/store/persist');
              const profiles = await getSshProfiles();
              const profile = profiles.find(p => p.id === keyGenerationModal.profileId);
              if (profile) {
                // Replace password auth with key auth
                profile.auth = {
                  keyPath,
                  passphrase: passphrase || undefined,
                  agent: false
                };
                await saveSshProfile(profile);
                addToast({ 
                  title: 'SSH Key Deployed', 
                  message: `Profile "${profile.name}" now uses key authentication`, 
                  kind: 'success' 
                });
              }
            } catch (e) {
              logger.error('Failed to update profile with key:', e);
            }
            setKeyGenerationModal(null);
          }}
          onCancel={() => {
            // User cancelled - don't disconnect, just close modal
            setKeyGenerationModal(null);
          }}
          onSkip={async () => {
            // User wants to keep using password - mark profile to not ask again
            try {
              const { getSshProfiles, saveSshProfile } = await import('@/store/persist');
              const profiles = await getSshProfiles();
              const profile = profiles.find(p => p.id === keyGenerationModal.profileId);
              if (profile) {
                profile.skipKeyGeneration = true;
                await saveSshProfile(profile);
              }
            } catch (e) {
              logger.error('Failed to update profile skip flag:', e);
            }
            setKeyGenerationModal(null);
          }}
        />
      )}
      <MasterKeyDialog
        isOpen={masterKeyDialog.isOpen}
        mode={masterKeyDialog.mode}
        isMigration={masterKeyDialog.isMigration}
        onClose={() => setMasterKeyDialog({ ...masterKeyDialog, isOpen: false })}
        onSuccess={async () => {
          setMasterKeyDialog({ ...masterKeyDialog, isOpen: false });
          addToast({ title: masterKeyDialog.isMigration ? 'Profiles encrypted successfully' : 'Master key unlocked successfully', kind: 'success' } as any);
          
          // Emit a custom event to notify components to reload profiles
          window.dispatchEvent(new CustomEvent('profiles-unlocked'));
          
          // Also reload the app state to update tabs
          try {
            const freshState = await loadAppState();
            // If we're on the sessions tab, it will reload via the event listener
            logger.info('Profiles reloaded after unlock');
          } catch (e) {
            logger.error('Failed to reload profiles:', e);
          }
        }}
      />
      <Toaster />
    </div>
  );
}
