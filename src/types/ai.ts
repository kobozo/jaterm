// AI-related types for command generation

export interface AiGenerateRequest {
  prompt: string;
  includeContext: boolean;
}

export interface CommandSuggestion {
  command: string;
  explanation: string;
  confidence: number;
  safetyLevel: 'Safe' | 'Caution' | 'Dangerous';
  warnings: string[];
}

export interface AiGenerateResponse {
  suggestions: CommandSuggestion[];
}

export interface AiCommandContext {
  currentDirectory: string;
  shellType: string;
  os: string;
  recentCommands: string[];
  gitBranch?: string;
  gitStatus?: string;
}