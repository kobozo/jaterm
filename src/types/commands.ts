export enum CommandCategory {
  Terminal = 'Terminal',
  SSH = 'SSH',
  Git = 'Git',
  Settings = 'Settings',
  Theme = 'Theme',
  Ports = 'Ports',
  Session = 'Session',
  View = 'View',
  File = 'File',
}

export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  icon?: string;
  shortcut?: string;
  description?: string;
  action: () => void | Promise<void>;
  enabled?: () => boolean;
  visible?: () => boolean;
  keywords?: string[];
}

export interface CommandGroup {
  category: CommandCategory;
  commands: Command[];
}

export interface CommandHistory {
  commandId: string;
  timestamp: number;
  frequency: number;
}

export interface CommandPaletteState {
  isOpen: boolean;
  searchQuery: string;
  selectedIndex: number;
  filteredCommands: Command[];
  recentCommands: Command[];
}