import { loadGlobalConfig, getCachedConfig } from './settings';
import type { GlobalConfig } from '@/types/settings';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: any;
  source?: string;
}

class Logger {
  private static instance: Logger;
  private logBuffer: LogEntry[] = [];
  private maxBufferSize = 1000;
  private currentLogLevel: LogLevel = 'error';
  private initialized = false;

  private constructor() {
    this.initialize();
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private async initialize() {
    try {
      const config = await loadGlobalConfig();
      this.currentLogLevel = config.advanced.logLevel;
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize logger:', error);
      this.currentLogLevel = 'error';
      this.initialized = true;
    }
  }

  /**
   * Update log level from settings
   */
  updateLogLevel(level: LogLevel) {
    this.currentLogLevel = level;
  }

  /**
   * Check if we should log at the given level
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    const currentIndex = levels.indexOf(this.currentLogLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex <= currentIndex;
  }

  /**
   * Get log level from cached config if available
   */
  private getLogLevel(): LogLevel {
    if (!this.initialized) {
      return 'error'; // Default until initialized
    }
    const cached = getCachedConfig();
    if (cached) {
      return cached.advanced.logLevel;
    }
    return this.currentLogLevel;
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, data?: any, source?: string) {
    const logLevel = this.getLogLevel();
    const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    const currentIndex = levels.indexOf(logLevel);
    const messageIndex = levels.indexOf(level);
    
    if (messageIndex > currentIndex) {
      return; // Don't log if message level is higher than current setting
    }

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      data,
      source: source || this.getCallerSource()
    };

    // Add to buffer
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }

    // Output to console in development
    const prefix = `[${level.toUpperCase()}]`;
    const timestamp = new Date().toISOString();
    const fullMessage = source 
      ? `${timestamp} ${prefix} [${source}] ${message}`
      : `${timestamp} ${prefix} ${message}`;

    switch (level) {
      case 'error':
        console.error(fullMessage, data || '');
        break;
      case 'warn':
        console.warn(fullMessage, data || '');
        break;
      case 'info':
        console.info(fullMessage, data || '');
        break;
      case 'debug':
        console.log(fullMessage, data || '');
        break;
    }
  }

  /**
   * Try to determine the source of the log call
   */
  private getCallerSource(): string {
    try {
      const stack = new Error().stack;
      if (stack) {
        const lines = stack.split('\n');
        // Skip first 3 lines (Error, this function, and the log method)
        if (lines.length > 3) {
          const callerLine = lines[3];
          // Extract filename from the stack trace
          const match = callerLine.match(/([^/\\]+\.(ts|tsx|js|jsx)):/);
          if (match) {
            return match[1];
          }
        }
      }
    } catch {
      // Ignore errors in getting source
    }
    return 'unknown';
  }

  /**
   * Public logging methods
   */
  error(message: string, data?: any, source?: string) {
    this.log('error', message, data, source);
  }

  warn(message: string, data?: any, source?: string) {
    this.log('warn', message, data, source);
  }

  info(message: string, data?: any, source?: string) {
    this.log('info', message, data, source);
  }

  debug(message: string, data?: any, source?: string) {
    this.log('debug', message, data, source);
  }

  /**
   * Get buffered logs for debugging
   */
  getLogBuffer(): LogEntry[] {
    return [...this.logBuffer];
  }

  /**
   * Clear log buffer
   */
  clearBuffer() {
    this.logBuffer = [];
  }

  /**
   * Export logs as formatted string
   */
  exportLogs(): string {
    return this.logBuffer
      .map(entry => {
        const timestamp = new Date(entry.timestamp).toISOString();
        const level = entry.level.toUpperCase().padEnd(5);
        const source = entry.source ? `[${entry.source}]` : '';
        const data = entry.data ? `\n  Data: ${JSON.stringify(entry.data, null, 2)}` : '';
        return `${timestamp} ${level} ${source} ${entry.message}${data}`;
      })
      .join('\n');
  }

  /**
   * Save logs to IndexedDB for persistence (optional)
   */
  async saveLogs(): Promise<void> {
    try {
      if (!window.indexedDB) return;

      const db = await this.openLogDatabase();
      const transaction = db.transaction(['logs'], 'readwrite');
      const store = transaction.objectStore('logs');
      
      // Clear old logs and save current buffer
      await new Promise((resolve, reject) => {
        const clearReq = store.clear();
        clearReq.onsuccess = resolve;
        clearReq.onerror = reject;
      });

      for (const entry of this.logBuffer) {
        store.add(entry);
      }

      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = reject;
      });
    } catch (error) {
      console.error('Failed to save logs to IndexedDB:', error);
    }
  }

  /**
   * Load logs from IndexedDB
   */
  async loadLogs(): Promise<void> {
    try {
      if (!window.indexedDB) return;

      const db = await this.openLogDatabase();
      const transaction = db.transaction(['logs'], 'readonly');
      const store = transaction.objectStore('logs');
      
      const logs = await new Promise<LogEntry[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = reject;
      });

      this.logBuffer = logs.slice(-this.maxBufferSize);
    } catch (error) {
      console.error('Failed to load logs from IndexedDB:', error);
    }
  }

  /**
   * Open or create the log database
   */
  private openLogDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('JaTermLogs', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('logs')) {
          const store = db.createObjectStore('logs', { autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('level', 'level', { unique: false });
        }
      };
    });
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Export convenience functions
export const log = {
  error: (message: string, data?: any, source?: string) => logger.error(message, data, source),
  warn: (message: string, data?: any, source?: string) => logger.warn(message, data, source),
  info: (message: string, data?: any, source?: string) => logger.info(message, data, source),
  debug: (message: string, data?: any, source?: string) => logger.debug(message, data, source),
};