import { loadConfig, saveConfig, loadConfigV2, saveConfigV2, checkConfigNeedsEncryptionV2 } from '@/types/ipc';
import { GlobalConfig, DEFAULT_CONFIG } from '@/types/settings';

let cachedConfig: GlobalConfig | null = null;
let useEncryption: boolean | null = null;

/**
 * Check if we should use encrypted config
 */
async function shouldUseEncryption(): Promise<boolean> {
  if (useEncryption !== null) {
    return useEncryption;
  }
  
  try {
    // Try to use V2 encrypted config first
    await loadConfigV2('jaterm');
    useEncryption = true;
    return true;
  } catch (error) {
    // Fall back to plain config
    console.log('Encryption not available, using plain config');
    useEncryption = false;
    return false;
  }
}

/**
 * Load global configuration from config.json
 * Falls back to defaults if file doesn't exist or is invalid
 */
export async function loadGlobalConfig(): Promise<GlobalConfig> {
  try {
    const encrypted = await shouldUseEncryption();
    const data = encrypted 
      ? await loadConfigV2('jaterm')
      : await loadConfig('jaterm');
      
    if (data && typeof data === 'object') {
      // Merge with defaults to ensure all fields exist
      cachedConfig = mergeWithDefaults(data as Partial<GlobalConfig>);
      return cachedConfig;
    }
  } catch (error) {
    console.warn('Failed to load config.json, using defaults:', error);
  }
  
  cachedConfig = { ...DEFAULT_CONFIG };
  return cachedConfig;
}

/**
 * Save global configuration to config.json
 */
export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  try {
    const encrypted = await shouldUseEncryption();
    
    if (encrypted) {
      await saveConfigV2(config, 'jaterm');
    } else {
      await saveConfig(config, 'jaterm');
    }
    
    cachedConfig = config;
  } catch (error) {
    console.error('Failed to save config.json:', error);
    throw error;
  }
}

/**
 * Check if config needs encryption migration
 */
export async function checkConfigNeedsEncryption(): Promise<boolean> {
  try {
    return await checkConfigNeedsEncryptionV2('jaterm');
  } catch {
    return false;
  }
}

/**
 * Get a specific setting value with fallback to default
 */
export async function getSetting<K extends keyof GlobalConfig>(
  section: K
): Promise<GlobalConfig[K]> {
  const config = cachedConfig || await loadGlobalConfig();
  return config[section] || DEFAULT_CONFIG[section];
}

/**
 * Update a specific section of the configuration
 */
export async function updateSettings<K extends keyof GlobalConfig>(
  section: K,
  values: Partial<GlobalConfig[K]>
): Promise<void> {
  const config = cachedConfig || await loadGlobalConfig();
  config[section] = { ...config[section], ...values };
  await saveGlobalConfig(config);
}

/**
 * Reset a specific section to defaults
 */
export async function resetSection<K extends keyof GlobalConfig>(
  section: K
): Promise<void> {
  const config = cachedConfig || await loadGlobalConfig();
  config[section] = { ...DEFAULT_CONFIG[section] };
  await saveGlobalConfig(config);
}

/**
 * Reset all settings to defaults
 */
export async function resetAllSettings(): Promise<void> {
  await saveGlobalConfig({ ...DEFAULT_CONFIG });
}

/**
 * Merge partial config with defaults
 */
function mergeWithDefaults(partial: Partial<GlobalConfig>): GlobalConfig {
  return {
    general: { ...DEFAULT_CONFIG.general, ...partial.general },
    terminal: { ...DEFAULT_CONFIG.terminal, ...partial.terminal },
    shell: { ...DEFAULT_CONFIG.shell, ...partial.shell },
    editor: { ...DEFAULT_CONFIG.editor, ...partial.editor },
    ssh: { ...DEFAULT_CONFIG.ssh, ...partial.ssh },
    ai: { 
      ...DEFAULT_CONFIG.ai, 
      ...partial.ai,
      providers: {
        ...DEFAULT_CONFIG.ai.providers,
        ...partial.ai?.providers
      },
      generation: {
        ...DEFAULT_CONFIG.ai.generation,
        ...partial.ai?.generation
      },
      privacy: {
        ...DEFAULT_CONFIG.ai.privacy,
        ...partial.ai?.privacy
      }
    },
    advanced: { ...DEFAULT_CONFIG.advanced, ...partial.advanced }
  };
}

/**
 * Export configuration as JSON string
 */
export async function exportConfig(): Promise<string> {
  const config = cachedConfig || await loadGlobalConfig();
  return JSON.stringify(config, null, 2);
}

/**
 * Import configuration from JSON string
 */
export async function importConfig(jsonString: string): Promise<void> {
  try {
    const imported = JSON.parse(jsonString) as GlobalConfig;
    // Validate the structure
    if (!imported.general || !imported.terminal || !imported.ssh) {
      throw new Error('Invalid configuration structure');
    }
    const merged = mergeWithDefaults(imported);
    await saveGlobalConfig(merged);
  } catch (error) {
    throw new Error(`Failed to import configuration: ${error}`);
  }
}

/**
 * Get the cached config without loading from disk
 */
export function getCachedConfig(): GlobalConfig | null {
  return cachedConfig;
}

/**
 * Clear the cached config (forces reload on next access)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}