import { Command, CommandCategory, CommandHistory } from '@/types/commands';

const STORAGE_KEY = 'jaterm_command_history';
const MAX_RECENT_COMMANDS = 10;
const MAX_HISTORY_SIZE = 100;

class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private history: CommandHistory[] = [];
  private listeners: ((commands: Command[]) => void)[] = [];

  constructor() {
    this.loadHistory();
  }

  register(command: Command): void {
    this.commands.set(command.id, command);
    this.notifyListeners();
  }

  registerAll(commands: Command[]): void {
    commands.forEach(cmd => this.commands.set(cmd.id, cmd));
    this.notifyListeners();
  }

  unregister(commandId: string): void {
    this.commands.delete(commandId);
    this.notifyListeners();
  }

  get(commandId: string): Command | undefined {
    return this.commands.get(commandId);
  }

  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  getByCategory(category: CommandCategory): Command[] {
    return this.getAll().filter(cmd => cmd.category === category);
  }

  getVisible(): Command[] {
    return this.getAll().filter(cmd => {
      if (cmd.visible && !cmd.visible()) return false;
      return true;
    });
  }

  getEnabled(): Command[] {
    return this.getVisible().filter(cmd => {
      if (cmd.enabled && !cmd.enabled()) return false;
      return true;
    });
  }

  async execute(commandId: string): Promise<void> {
    const command = this.commands.get(commandId);
    if (!command) {
      throw new Error(`Command not found: ${commandId}`);
    }

    if (command.enabled && !command.enabled()) {
      throw new Error(`Command is disabled: ${commandId}`);
    }

    // Record in history
    this.recordUsage(commandId);

    // Execute the command
    await command.action();
  }

  getRecentCommands(limit = MAX_RECENT_COMMANDS): Command[] {
    const sortedHistory = [...this.history].sort((a, b) => {
      // Calculate frecency score (frequency + recency)
      const now = Date.now();
      const aRecency = 1 / (now - a.timestamp + 1);
      const bRecency = 1 / (now - b.timestamp + 1);
      const aScore = a.frequency * 0.7 + aRecency * 1000000 * 0.3;
      const bScore = b.frequency * 0.7 + bRecency * 1000000 * 0.3;
      return bScore - aScore;
    });

    const recentCommands: Command[] = [];
    for (const entry of sortedHistory) {
      const command = this.commands.get(entry.commandId);
      if (command && (!command.visible || command.visible())) {
        recentCommands.push(command);
        if (recentCommands.length >= limit) break;
      }
    }

    return recentCommands;
  }

  private recordUsage(commandId: string): void {
    const existing = this.history.find(h => h.commandId === commandId);
    
    if (existing) {
      existing.frequency++;
      existing.timestamp = Date.now();
    } else {
      this.history.push({
        commandId,
        timestamp: Date.now(),
        frequency: 1,
      });
    }

    // Limit history size
    if (this.history.length > MAX_HISTORY_SIZE) {
      // Remove least frequently used items
      this.history.sort((a, b) => b.frequency - a.frequency);
      this.history = this.history.slice(0, MAX_HISTORY_SIZE);
    }

    this.saveHistory();
  }

  private loadHistory(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.history = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load command history:', error);
      this.history = [];
    }
  }

  private saveHistory(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history));
    } catch (error) {
      console.warn('Failed to save command history:', error);
    }
  }

  clearHistory(): void {
    this.history = [];
    this.saveHistory();
  }

  onChange(listener: (commands: Command[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private notifyListeners(): void {
    const commands = this.getAll();
    this.listeners.forEach(listener => listener(commands));
  }
}

export const commandRegistry = new CommandRegistry();