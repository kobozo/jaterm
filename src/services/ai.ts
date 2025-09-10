import { invoke } from '@tauri-apps/api/core';
import { AiSettings } from '@/types/settings';
import { AiGenerateRequest, AiGenerateResponse, CommandSuggestion } from '@/types/ai';
import { loadGlobalConfig, saveGlobalConfig } from './settings';

class AiService {
  private initialized = false;

  async initialize(): Promise<void> {
    const config = await loadGlobalConfig();
    if (!config.ai || !config.ai.enabled) {
      throw new Error('AI features are not enabled');
    }

    try {
      await invoke('ai_initialize', { config: config.ai });
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize AI service: ${error}`);
    }
  }

  async generateCommand(prompt: string, includeContext = true): Promise<CommandSuggestion[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const request: AiGenerateRequest = {
      prompt,
      includeContext,
    };

    try {
      const response = await invoke<AiGenerateResponse>('ai_generate_command', { request });
      return response.suggestions;
    } catch (error) {
      throw new Error(`Failed to generate command: ${error}`);
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await invoke<boolean>('ai_test_connection');
    } catch (error) {
      throw new Error(`Connection test failed: ${error}`);
    }
  }

  async listOllamaModels(): Promise<string[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await invoke<string[]>('ai_list_ollama_models');
    } catch (error) {
      throw new Error(`Failed to list Ollama models: ${error}`);
    }
  }

  async explainCommand(command: string): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await invoke<string>('ai_explain_command', { command });
    } catch (error) {
      throw new Error(`Failed to explain command: ${error}`);
    }
  }

  async analyzeTerminalOutput(output: string, context?: string): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await invoke<string>('ai_analyze_output', { output, context });
    } catch (error) {
      throw new Error(`Failed to analyze output: ${error}`);
    }
  }

  async startChat(terminalOutput: string): Promise<{ chatId: string; analysis: string; hasCliSolution: boolean }> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await invoke('ai_start_chat', { terminalOutput });
    } catch (error) {
      throw new Error(`Failed to start chat: ${error}`);
    }
  }

  async sendChatMessage(chatId: string, message: string): Promise<{ message: string; hasCliSolution: boolean }> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await invoke('ai_send_message', { chatId, message });
    } catch (error) {
      throw new Error(`Failed to send message: ${error}`);
    }
  }

  async generateCliSolution(chatId: string): Promise<{ command: string; explanation: string }> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await invoke('ai_generate_solution', { chatId });
    } catch (error) {
      throw new Error(`Failed to generate solution: ${error}`);
    }
  }

  async updateSettings(settings: AiSettings): Promise<void> {
    const config = await loadGlobalConfig();
    config.ai = settings;
    await saveGlobalConfig(config);
    
    // Reinitialize with new settings if enabled
    if (settings.enabled) {
      this.initialized = false;
      await this.initialize();
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const aiService = new AiService();