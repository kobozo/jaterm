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
import { appQuit, installZshOsc7, installBashOsc7, installFishOsc7, openPathSystem, ptyOpen, ptyKill, ptyWrite, resolvePathAbsolute, sshCloseShell, sshConnect, sshDisconnect, sshOpenShell, sshWrite, sshSetPrimary, checkProfilesNeedMigration } from '@/types/ipc';
import { getCachedConfig, loadGlobalConfig, saveGlobalConfig } from '@/services/settings';
import { getThemeList } from '@/config/themes';
import { initEncryption, encryptionNeedsSetup, checkProfilesNeedMigrationV2, migrateProfilesV2 } from '@/services/api/encryption_v2';
import { ensureEncryptionReady } from '@/services/encryptionGate';
import { useToasts } from '@/store/toasts';
import { ensureHelper, ensureLocalHelper } from '@/services/helper';
import { gitStatusViaHelper } from '@/services/git';
import { TerminalEventDetector, debounce } from '@/services/terminalEvents';
import { homeDir } from '@tauri-apps/api/path';
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
    terminalProfileId?: string; // Terminal profile for local tabs
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
        subCommands: async () => {
          const { getLocalProfiles, getSshProfiles } = await import('@/store/persist');
          const localProfiles = await getLocalProfiles();
          const sshProfiles = await getSshProfiles();
          
          const profileCommands: Command[] = [];
          
          // Add local terminal option
          profileCommands.push({
            id: 'terminal.newTab.local',
            label: 'Local Terminal',
            category: CommandCategory.Terminal,
            icon: '💻',
            description: 'Open a local terminal',
            action: async () => {
              const cwd = await homeDir();
              const id = crypto.randomUUID();
              setTabs(prev => [...prev, { 
                id, 
                kind: 'local',
                cwd: null, 
                panes: [], 
                activePane: null, 
                status: {} 
              }]);
              setActiveTab(id);
              await openSessionFor(id, { cwd });
            },
          });
          
          // Add local profiles
          localProfiles.forEach(profile => {
            profileCommands.push({
              id: `terminal.profile.local.${profile.id}`,
              label: profile.name,
              category: CommandCategory.Terminal,
              icon: '📁',
              description: `Open at ${profile.path}`,
              keywords: [profile.path],
              action: async () => {
                const id = crypto.randomUUID();
                setTabs(prev => [...prev, { 
                  id, 
                  kind: 'local',
                  cwd: null, 
                  panes: [], 
                  activePane: null, 
                  status: {} 
                }]);
                setActiveTab(id);
                await openSessionFor(id, { cwd: profile.path });
              },
            });
          });
          
          // Add SSH profiles
          sshProfiles.forEach(profile => {
            profileCommands.push({
              id: `terminal.profile.ssh.${profile.id}`,
              label: profile.name,
              category: CommandCategory.Terminal,
              icon: '🔐',
              description: `SSH to ${profile.user}@${profile.host}`,
              keywords: [profile.host, profile.user],
              action: async () => {
                const id = crypto.randomUUID();
                setTabs(prev => [...prev, { 
                  id, 
                  kind: 'ssh',
                  profileId: profile.id,
                  cwd: null, 
                  panes: [], 
                  activePane: null, 
                  status: {} 
                }]);
                setActiveTab(id);
                
                // Resolve effective settings with inheritance
                try {
                  const { getProfilesTree, resolveEffectiveSettings, findPathToNode } = await import('@/store/persist');
                  const tree = await getProfilesTree();
                  
                  // Find the profile node in the tree
                  let profileNodeId = null;
                  const findProfileNode = (node: any, path: string[]) => {
                    if (node.type === 'profile' && node.ref?.id === profile.id) {
                      profileNodeId = node.id;
                      return;
                    }
                    if (node.children) {
                      for (const child of node.children) {
                        findProfileNode(child, [...path, node.id]);
                      }
                    }
                  };
                  if (tree) {
                    findProfileNode(tree, []);
                  }
                  
                  if (profileNodeId && tree) {
                    const effective = resolveEffectiveSettings({ 
                      root: tree, 
                      nodeId: profileNodeId, 
                      profileKind: 'ssh', 
                      profileSettings: { 
                        terminal: profile.terminal, 
                        shell: profile.shell, 
                        advanced: profile.advanced, 
                        ssh: { 
                          host: profile.host, 
                          port: profile.port, 
                          user: profile.user, 
                          auth: profile.auth 
                        } 
                      } 
                    });
                    
                    await openSshFor(id, {
                      host: effective.ssh?.host ?? profile.host,
                      port: effective.ssh?.port ?? profile.port,
                      user: effective.ssh?.user ?? profile.user,
                      auth: effective.ssh?.auth ?? (profile.auth || { agent: true }),
                      cwd: profile.path,
                      profileId: profile.id,
                      profileName: profile.name,
                      terminal: effective.terminal,
                      shell: effective.shell,
                      advanced: effective.advanced,
                      os: profile.os,
                      _resolved: true // Mark that settings are already resolved
                    });
                  } else {
                    // Fallback if profile not in tree
                    await openSshFor(id, {
                      profileId: profile.id,
                      profileName: profile.name,
                      host: profile.host,
                      port: profile.port,
                      user: profile.user,
                      path: profile.path,
                      auth: profile.auth || { agent: true },
                      _resolved: true // Still mark as resolved to avoid re-fetching
                    });
                  }
                } catch (err) {
                  console.error('Failed to resolve effective settings:', err);
                  // Fallback
                  await openSshFor(id, {
                    profileId: profile.id,
                    profileName: profile.name,
                    host: profile.host,
                    port: profile.port,
                    user: profile.user,
                    path: profile.path,
                    auth: profile.auth || { agent: true },
                    _resolved: true
                  });
                }
              },
            });
          });
          
          return profileCommands;
        },
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
        id: 'app.commandPalette',
        label: 'Open Command Palette',
        category: CommandCategory.View,
        icon: '🎯',
        shortcut: 'Cmd/Ctrl+K',
        description: 'Open the command palette for quick access to commands',
        action: () => setCommandPaletteOpen(true),
      },
      {
        id: 'app.compose',
        label: 'Compose with AI',
        category: CommandCategory.Terminal,
        icon: '🤖',
        shortcut: 'Cmd/Ctrl+Shift+K',
        description: 'Open AI compose assistant',
        action: () => setComposeOpen(true),
        enabled: () => {
          const t = tabs.find((x) => x.id === activeTab);
          return Boolean(t && t.activePane);
        },
      },
    ];
    
    // We'll register local profiles separately after they load
    
    // Register SSH profile commands dynamically
    if (sshProfiles && sshProfiles.length > 0) {
      sshProfiles.forEach(profile => {
        commands.push({
          id: `ssh.connect.${profile.id}`,
          label: `SSH: ${profile.name}`,
          category: CommandCategory.SSH,
          icon: '🔐',
          description: `Connect to ${profile.user}@${profile.host}`,
          keywords: [profile.host, profile.user || '', profile.name],
          action: async () => {
            const id = crypto.randomUUID();
            setTabs((prev) => [...prev, { 
              id, 
              kind: 'ssh',
              profileId: profile.id,
              cwd: null, 
              panes: [], 
              activePane: null, 
              status: {} 
            }]);
            setActiveTab(id);
            
            // Resolve effective settings with inheritance
            try {
              const { getProfilesTree, resolveEffectiveSettings } = await import('@/store/persist');
              const tree = await getProfilesTree();
              
              // Find the profile node in the tree
              let profileNodeId = null;
              const findProfileNode = (node: any) => {
                if (node.type === 'profile' && node.ref?.id === profile.id) {
                  profileNodeId = node.id;
                  return;
                }
                if (node.children) {
                  for (const child of node.children) {
                    findProfileNode(child);
                  }
                }
              };
              if (tree) {
                findProfileNode(tree);
              }
              
              if (profileNodeId && tree) {
                const effective = resolveEffectiveSettings({ 
                  root: tree, 
                  nodeId: profileNodeId, 
                  profileKind: 'ssh', 
                  profileSettings: { 
                    terminal: profile.terminal, 
                    shell: profile.shell, 
                    advanced: profile.advanced, 
                    ssh: { 
                      host: profile.host, 
                      port: profile.port, 
                      user: profile.user, 
                      auth: profile.auth 
                    } 
                  } 
                });
                
                await openSshFor(id, {
                  host: effective.ssh?.host ?? profile.host,
                  port: effective.ssh?.port ?? profile.port,
                  user: effective.ssh?.user ?? profile.user,
                  auth: effective.ssh?.auth ?? (profile.auth || { agent: true }),
                  cwd: profile.path,
                  profileId: profile.id,
                  profileName: profile.name,
                  terminal: effective.terminal,
                  shell: effective.shell,
                  advanced: effective.advanced,
                  os: profile.os,
                  _resolved: true // Mark that settings are already resolved
                });
              } else {
                // Fallback if profile not in tree
                await openSshFor(id, {
                  profileId: profile.id,
                  profileName: profile.name,
                  host: profile.host,
                  port: profile.port,
                  user: profile.user,
                  path: profile.path,
                  auth: profile.auth || { agent: true },
                  _resolved: true // Still mark as resolved to avoid re-fetching
                });
              }
            } catch (err) {
              console.error('Failed to resolve effective settings:', err);
              // Fallback
              await openSshFor(id, {
                profileId: profile.id,
                profileName: profile.name,
                host: profile.host,
                port: profile.port,
                user: profile.user,
                path: profile.path,
                auth: profile.auth || { agent: true },
                _resolved: true
              });
            }
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
    
    // Add AI analysis command
    commands.push({
      id: 'ai.analyzeOutput',
      label: 'Analyze Terminal Output with AI',
      category: CommandCategory.Terminal,
      icon: '🤖',
      description: 'Analyze the visible terminal output using AI',
      keywords: ['ai', 'analyze', 'output', 'explain', 'error'],
      action: async () => {
        try {
          // For now, prompt user to copy text
          const { aiService } = await import('@/services/ai');
          
          // Try to get text from clipboard (user needs to select and copy first)
          const clipboardText = await navigator.clipboard.readText();
          
          if (!clipboardText || clipboardText.trim().length === 0) {
            show({
              title: 'No text to analyze',
              message: 'Please select and copy terminal output first (Cmd+C), then run this command',
              kind: 'info'
            });
            return;
          }
          
          show({
            title: 'Analyzing output...',
            message: 'AI is analyzing the terminal output',
            kind: 'info'
          });
          
          const analysis = await aiService.analyzeTerminalOutput(clipboardText);
          
          // Show analysis in a modal or toast
          show({
            title: 'AI Analysis',
            message: analysis,
            kind: 'success',
            duration: 10000 // Show for 10 seconds
          });
        } catch (error) {
          show({
            title: 'Analysis failed',
            message: String(error),
            kind: 'error'
          });
        }
      },
      enabled: () => {
        // Only enable if AI is configured
        const config = getCachedConfig();
        return config?.ai?.enabled === true;
      }
    });
    
    commandRegistry.registerAll(commands);
  }, [tabs, activeTab, sessionsId, sshProfiles]);
  // Simple bell sound using WebAudio
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  function ringBell() {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!audioCtxRef.current and so on...