import { loadGlobalConfig, getCachedConfig } from './settings';
import { logger } from './logger';

/**
 * Experimental features that can be toggled
 */
export enum ExperimentalFeature {
  // SSH Features
  SSH_MULTIPLEXING = 'ssh_multiplexing',
  SSH_AGENT_FORWARDING_UI = 'ssh_agent_forwarding_ui',
  SSH_JUMP_HOST = 'ssh_jump_host',
  
  // Terminal Features
  TERMINAL_BROADCAST = 'terminal_broadcast',
  TERMINAL_RECORDING = 'terminal_recording',
  TERMINAL_SEARCH = 'terminal_search',
  
  // Editor Features
  EDITOR_MULTI_CURSOR = 'editor_multi_cursor',
  EDITOR_MINIMAP = 'editor_minimap',
  EDITOR_COLLABORATION = 'editor_collaboration',
  
  // UI Features
  UI_COMMAND_PALETTE = 'ui_command_palette',
  UI_FLOATING_WINDOWS = 'ui_floating_windows',
  UI_THEMES = 'ui_themes',
  
  // Advanced Features
  PLUGIN_SYSTEM = 'plugin_system',
  SCRIPTING_API = 'scripting_api',
  CLOUD_SYNC = 'cloud_sync',
}

/**
 * Feature flag definitions with metadata
 */
interface FeatureDefinition {
  id: ExperimentalFeature;
  name: string;
  description: string;
  category: 'ssh' | 'terminal' | 'editor' | 'ui' | 'advanced';
  stable: boolean;
  requiresRestart?: boolean;
  dependencies?: ExperimentalFeature[];
}

const FEATURE_DEFINITIONS: Record<ExperimentalFeature, FeatureDefinition> = {
  [ExperimentalFeature.SSH_MULTIPLEXING]: {
    id: ExperimentalFeature.SSH_MULTIPLEXING,
    name: 'SSH Connection Multiplexing',
    description: 'Share SSH connections between tabs for better performance',
    category: 'ssh',
    stable: false,
    requiresRestart: true,
  },
  
  [ExperimentalFeature.SSH_AGENT_FORWARDING_UI]: {
    id: ExperimentalFeature.SSH_AGENT_FORWARDING_UI,
    name: 'SSH Agent Forwarding UI',
    description: 'Visual interface for managing SSH agent forwarding',
    category: 'ssh',
    stable: false,
  },
  
  [ExperimentalFeature.SSH_JUMP_HOST]: {
    id: ExperimentalFeature.SSH_JUMP_HOST,
    name: 'SSH Jump Host Support',
    description: 'Connect through intermediate SSH servers (ProxyJump)',
    category: 'ssh',
    stable: false,
  },
  
  [ExperimentalFeature.TERMINAL_BROADCAST]: {
    id: ExperimentalFeature.TERMINAL_BROADCAST,
    name: 'Terminal Broadcast',
    description: 'Send input to multiple terminals simultaneously',
    category: 'terminal',
    stable: false,
  },
  
  [ExperimentalFeature.TERMINAL_RECORDING]: {
    id: ExperimentalFeature.TERMINAL_RECORDING,
    name: 'Terminal Recording',
    description: 'Record and replay terminal sessions',
    category: 'terminal',
    stable: false,
  },
  
  [ExperimentalFeature.TERMINAL_SEARCH]: {
    id: ExperimentalFeature.TERMINAL_SEARCH,
    name: 'Terminal Search',
    description: 'Search within terminal output history',
    category: 'terminal',
    stable: true,
  },
  
  [ExperimentalFeature.EDITOR_MULTI_CURSOR]: {
    id: ExperimentalFeature.EDITOR_MULTI_CURSOR,
    name: 'Multi-Cursor Editing',
    description: 'Edit with multiple cursors simultaneously',
    category: 'editor',
    stable: false,
  },
  
  [ExperimentalFeature.EDITOR_MINIMAP]: {
    id: ExperimentalFeature.EDITOR_MINIMAP,
    name: 'Editor Minimap',
    description: 'Show code minimap in editor',
    category: 'editor',
    stable: true,
  },
  
  [ExperimentalFeature.EDITOR_COLLABORATION]: {
    id: ExperimentalFeature.EDITOR_COLLABORATION,
    name: 'Collaborative Editing',
    description: 'Real-time collaborative editing (requires server)',
    category: 'editor',
    stable: false,
    dependencies: [ExperimentalFeature.CLOUD_SYNC],
  },
  
  [ExperimentalFeature.UI_COMMAND_PALETTE]: {
    id: ExperimentalFeature.UI_COMMAND_PALETTE,
    name: 'Command Palette',
    description: 'Quick command execution with Cmd+Shift+P',
    category: 'ui',
    stable: true,
  },
  
  [ExperimentalFeature.UI_FLOATING_WINDOWS]: {
    id: ExperimentalFeature.UI_FLOATING_WINDOWS,
    name: 'Floating Windows',
    description: 'Detach tabs into floating windows',
    category: 'ui',
    stable: false,
  },
  
  [ExperimentalFeature.UI_THEMES]: {
    id: ExperimentalFeature.UI_THEMES,
    name: 'Custom Themes',
    description: 'Support for custom UI themes',
    category: 'ui',
    stable: true,
  },
  
  [ExperimentalFeature.PLUGIN_SYSTEM]: {
    id: ExperimentalFeature.PLUGIN_SYSTEM,
    name: 'Plugin System',
    description: 'Load and manage third-party plugins',
    category: 'advanced',
    stable: false,
    requiresRestart: true,
  },
  
  [ExperimentalFeature.SCRIPTING_API]: {
    id: ExperimentalFeature.SCRIPTING_API,
    name: 'Scripting API',
    description: 'JavaScript API for automation',
    category: 'advanced',
    stable: false,
    dependencies: [ExperimentalFeature.PLUGIN_SYSTEM],
  },
  
  [ExperimentalFeature.CLOUD_SYNC]: {
    id: ExperimentalFeature.CLOUD_SYNC,
    name: 'Cloud Sync',
    description: 'Sync settings and sessions across devices',
    category: 'advanced',
    stable: false,
    requiresRestart: true,
  },
};

class FeatureFlags {
  private static instance: FeatureFlags;
  private enabledFeatures: Set<ExperimentalFeature> = new Set();
  private experimentalEnabled = false;
  private initialized = false;

  private constructor() {
    this.initialize();
  }

  static getInstance(): FeatureFlags {
    if (!FeatureFlags.instance) {
      FeatureFlags.instance = new FeatureFlags();
    }
    return FeatureFlags.instance;
  }

  private async initialize() {
    try {
      const config = await loadGlobalConfig();
      this.experimentalEnabled = config.advanced.experimentalFeatures;
      this.initialized = true;
      
      // Enable stable features by default when experimental mode is on
      if (this.experimentalEnabled) {
        Object.values(FEATURE_DEFINITIONS).forEach(feature => {
          if (feature.stable) {
            this.enabledFeatures.add(feature.id);
          }
        });
      }
      
      logger.info('Feature flags initialized', {
        experimentalEnabled: this.experimentalEnabled,
        enabledFeatures: Array.from(this.enabledFeatures),
      });
    } catch (error) {
      logger.error('Failed to initialize feature flags', error);
      this.experimentalEnabled = false;
      this.initialized = true;
    }
  }

  /**
   * Check if experimental features are globally enabled
   */
  isExperimentalEnabled(): boolean {
    const cached = getCachedConfig();
    if (cached) {
      return cached.advanced.experimentalFeatures;
    }
    return this.experimentalEnabled;
  }

  /**
   * Check if a specific feature is enabled
   */
  isEnabled(feature: ExperimentalFeature): boolean {
    if (!this.isExperimentalEnabled()) {
      return false;
    }
    
    const definition = FEATURE_DEFINITIONS[feature];
    if (!definition) {
      logger.warn(`Unknown feature flag: ${feature}`);
      return false;
    }
    
    // Check dependencies
    if (definition.dependencies) {
      for (const dep of definition.dependencies) {
        if (!this.isEnabled(dep)) {
          return false;
        }
      }
    }
    
    return this.enabledFeatures.has(feature);
  }

  /**
   * Enable a feature
   */
  enable(feature: ExperimentalFeature) {
    if (!this.isExperimentalEnabled()) {
      logger.warn('Cannot enable feature: experimental features are disabled');
      return;
    }
    
    const definition = FEATURE_DEFINITIONS[feature];
    if (!definition) {
      logger.warn(`Cannot enable unknown feature: ${feature}`);
      return;
    }
    
    // Enable dependencies first
    if (definition.dependencies) {
      for (const dep of definition.dependencies) {
        this.enable(dep);
      }
    }
    
    this.enabledFeatures.add(feature);
    logger.info(`Feature enabled: ${feature}`);
    
    if (definition.requiresRestart) {
      logger.warn(`Feature ${feature} requires application restart`);
    }
  }

  /**
   * Disable a feature
   */
  disable(feature: ExperimentalFeature) {
    this.enabledFeatures.delete(feature);
    logger.info(`Feature disabled: ${feature}`);
    
    // Disable dependent features
    Object.values(FEATURE_DEFINITIONS).forEach(def => {
      if (def.dependencies?.includes(feature)) {
        this.disable(def.id);
      }
    });
  }

  /**
   * Toggle a feature
   */
  toggle(feature: ExperimentalFeature) {
    if (this.isEnabled(feature)) {
      this.disable(feature);
    } else {
      this.enable(feature);
    }
  }

  /**
   * Get all available features
   */
  getAllFeatures(): FeatureDefinition[] {
    return Object.values(FEATURE_DEFINITIONS);
  }

  /**
   * Get features by category
   */
  getFeaturesByCategory(category: string): FeatureDefinition[] {
    return Object.values(FEATURE_DEFINITIONS).filter(f => f.category === category);
  }

  /**
   * Get enabled features
   */
  getEnabledFeatures(): ExperimentalFeature[] {
    return Array.from(this.enabledFeatures);
  }

  /**
   * Update experimental features setting
   */
  updateExperimentalEnabled(enabled: boolean) {
    this.experimentalEnabled = enabled;
    
    if (enabled) {
      // Enable stable features
      Object.values(FEATURE_DEFINITIONS).forEach(feature => {
        if (feature.stable) {
          this.enabledFeatures.add(feature.id);
        }
      });
    } else {
      // Disable all features
      this.enabledFeatures.clear();
    }
    
    logger.info('Experimental features updated', { enabled });
  }

  /**
   * Check if any features require restart
   */
  hasRestartRequiredFeatures(): boolean {
    return Array.from(this.enabledFeatures).some(feature => {
      return FEATURE_DEFINITIONS[feature]?.requiresRestart === true;
    });
  }
}

// Export singleton instance
export const featureFlags = FeatureFlags.getInstance();

// Export convenience function
export function isFeatureEnabled(feature: ExperimentalFeature): boolean {
  return featureFlags.isEnabled(feature);
}