// Terminal event detection service
// Monitors terminal output for patterns that indicate state changes

export type TerminalEvent = 
  | { type: 'command'; command: string }
  | { type: 'prompt' }
  | { type: 'directory-change'; path: string }
  | { type: 'git-command'; command: string }
  | { type: 'process-start'; command: string }
  | { type: 'process-stop' }
  | { type: 'bell' };

export type TerminalEventListener = (event: TerminalEvent) => void;

export class TerminalEventDetector {
  private listeners: Set<TerminalEventListener> = new Set();
  private lastLine: string = '';
  private commandBuffer: string = '';
  private inCommand: boolean = false;
  
  // Common prompt patterns
  private promptPatterns = [
    /\$\s*$/,           // Bash/Zsh $ prompt
    />\s*$/,            // Fish/PowerShell > prompt
    /#\s*$/,            // Root # prompt
    /❯\s*$/,            // Starship/Oh-my-zsh
    /➜\s*$/,            // Oh-my-zsh arrow
    /\]\$\s*$/,         // Common [user@host]$ format
    /\]#\s*$/,          // Common [user@host]# format
  ];
  
  // Git command patterns
  private gitCommandPatterns = [
    /^git\s+(add|commit|push|pull|fetch|merge|rebase|checkout|branch|status|diff|log|stash|reset|restore)/,
    /^(gaa|gc|gp|gl|gco|gb|gst|gd)\s*/,  // Common git aliases
  ];
  
  // Process start patterns
  private processStartPatterns = [
    /^(npm|yarn|pnpm|bun)\s+(start|dev|run|serve)/,
    /^(python|python3|node|deno|ruby|java|go)\s+\S+/,
    /^(cargo|rustc|gcc|g\+\+|make)\s+/,
    /^(docker|podman)\s+(run|compose)/,
    /^(rails|django|flask|fastapi|uvicorn|gunicorn)\s+/,
    /^(vite|webpack|parcel|rollup|esbuild)/,
  ];
  
  on(listener: TerminalEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  private emit(event: TerminalEvent) {
    this.listeners.forEach(listener => listener(event));
  }
  
  // Process terminal output data
  processData(data: string) {
    // Handle bell character
    if (data.includes('\x07')) {
      this.emit({ type: 'bell' });
    }
    
    // Build up the current line
    const lines = data.split(/\r?\n/);
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // If we get a newline, process the completed line
      if (i > 0 && this.lastLine) {
        this.processCompleteLine(this.lastLine);
      }
      
      // Update the current line
      if (i === lines.length - 1) {
        // Last piece might be incomplete
        this.lastLine = (i === 0 ? this.lastLine : '') + line;
      } else {
        this.lastLine = line;
      }
      
      // Check for prompt patterns on the current line
      if (this.isPrompt(this.lastLine)) {
        this.handlePromptDetected();
      }
    }
  }
  
  // Process user input (what they type)
  processInput(data: string) {
    // Track what the user is typing
    if (data === '\r' || data === '\n') {
      // Enter pressed - command is being executed
      if (this.commandBuffer.trim()) {
        this.handleCommandExecution(this.commandBuffer.trim());
      }
      this.commandBuffer = '';
      this.inCommand = false;
    } else if (data === '\x7f' || data === '\b') {
      // Backspace
      this.commandBuffer = this.commandBuffer.slice(0, -1);
    } else if (data === '\x03') {
      // Ctrl+C - process interrupted
      this.commandBuffer = '';
      this.inCommand = false;
      // Emit process-stop event to trigger checks
      this.emit({ type: 'process-stop' });
    } else if (data.match(/^[\x20-\x7e]+$/)) {
      // Printable characters
      this.commandBuffer += data;
      this.inCommand = true;
    }
  }
  
  private processCompleteLine(line: string) {
    // Strip ANSI escape codes for analysis
    const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
    
    // Check if it looks like a command that was executed
    if (cleanLine.trim() && !this.isPrompt(cleanLine)) {
      // Could be output or a command echo
      this.checkForPatterns(cleanLine);
    }
  }
  
  private isPrompt(line: string): boolean {
    // Strip ANSI codes
    const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
    return this.promptPatterns.some(pattern => pattern.test(clean));
  }
  
  private handlePromptDetected() {
    this.emit({ type: 'prompt' });
    this.inCommand = true;
    this.commandBuffer = '';
  }
  
  private handleCommandExecution(command: string) {
    // Emit general command event
    this.emit({ type: 'command', command });
    
    // Check for specific command types
    if (this.gitCommandPatterns.some(p => p.test(command))) {
      this.emit({ type: 'git-command', command });
    }
    
    if (this.processStartPatterns.some(p => p.test(command))) {
      this.emit({ type: 'process-start', command });
    }
    
    // Check for cd command
    if (/^cd\s+/.test(command)) {
      const match = command.match(/^cd\s+(.+)$/);
      if (match) {
        this.emit({ type: 'directory-change', path: match[1] });
      }
    }
  }
  
  private checkForPatterns(line: string) {
    // Additional pattern checking for output lines
    // Could detect things like "Listening on port 3000" etc.
    if (line.includes('Listening on') || line.includes('Server running') || line.includes('started on port')) {
      // Server started - might want to check ports
      const portMatch = line.match(/(?:port|Port)\s*:?\s*(\d{4,5})/);
      if (portMatch) {
        this.emit({ type: 'process-start', command: `server:${portMatch[1]}` });
      }
    }
  }
  
  reset() {
    this.lastLine = '';
    this.commandBuffer = '';
    this.inCommand = false;
  }
}

// Debounce helper for rate-limiting events
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): T & { cancel: () => void } {
  let timeout: NodeJS.Timeout | null = null;
  
  const debounced = ((...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      func(...args);
      timeout = null;
    }, wait);
  }) as T & { cancel: () => void };
  
  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };
  
  return debounced;
}