// Terminal profile management service

import { 
  TerminalProfile, 
  BUILTIN_PROFILES, 
  validateProfile, 
  mergeProfileWithDefaults,
  matchesAutoDetect
} from '@/types/terminalProfile';
import { loadConfig, saveConfig } from '@/types/ipc';
import { getSetting } from './settings';

interface ProfileStorage {
  version: number;
  profiles: TerminalProfile[];
  defaultProfileId?: string;
}

class ProfileManager {
  private profiles: Map<string, TerminalProfile> = new Map();
  private defaultProfileId: string = 'default';
  private initialized = false;

  /**
   * Initialize the profile manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load built-in profiles
    for (const profile of BUILTIN_PROFILES) {
      this.profiles.set(profile.id, profile);
    }

    // Load custom profiles from storage
    await this.loadCustomProfiles();
    
    this.initialized = true;
  }

  /**
   * Load custom profiles from encrypted storage
   */
  private async loadCustomProfiles(): Promise<void> {
    try {
      const data = await loadConfig('terminal-profiles');
      if (data && typeof data === 'object') {
        const storage = data as ProfileStorage;
        
        // Load custom profiles
        if (Array.isArray(storage.profiles)) {
          for (const profile of storage.profiles) {
            if (!profile.isBuiltIn) {
              this.profiles.set(profile.id, profile);
            }
          }
        }
        
        // Set default profile
        if (storage.defaultProfileId) {
          this.defaultProfileId = storage.defaultProfileId;
        }
      }
    } catch (error) {
      console.warn('Failed to load terminal profiles:', error);
    }
  }

  /**
   * Save custom profiles to encrypted storage
   */
  private async saveCustomProfiles(): Promise<void> {
    const customProfiles = Array.from(this.profiles.values())
      .filter(p => !p.isBuiltIn);
    
    const storage: ProfileStorage = {
      version: 1,
      profiles: customProfiles,
      defaultProfileId: this.defaultProfileId
    };
    
    await saveConfig(storage, 'terminal-profiles');
  }

  /**
   * Get all profiles
   */
  getAllProfiles(): TerminalProfile[] {
    if (!this.initialized) {
      throw new Error('ProfileManager not initialized');
    }
    return Array.from(this.profiles.values());
  }

  /**
   * Get profiles grouped by category
   */
  getGroupedProfiles(): Map<string, TerminalProfile[]> {
    const groups = new Map<string, TerminalProfile[]>();
    
    // Built-in shells
    const shells = this.getAllProfiles().filter(p => 
      p.isBuiltIn && ['default', 'bash', 'zsh', 'fish'].includes(p.id)
    );
    if (shells.length > 0) {
      groups.set('Shells', shells);
    }
    
    // Development environments
    const devEnvs = this.getAllProfiles().filter(p => 
      p.isBuiltIn && p.id.endsWith('-dev')
    );
    if (devEnvs.length > 0) {
      groups.set('Development', devEnvs);
    }
    
    // Custom profiles
    const custom = this.getAllProfiles().filter(p => !p.isBuiltIn);
    if (custom.length > 0) {
      groups.set('Custom', custom);
    }
    
    return groups;
  }

  /**
   * Get a specific profile by ID
   */
  getProfile(id: string): TerminalProfile | undefined {
    if (!this.initialized) {
      throw new Error('ProfileManager not initialized');
    }
    return this.profiles.get(id);
  }

  /**
   * Get the default profile
   */
  getDefaultProfile(): TerminalProfile {
    const profile = this.profiles.get(this.defaultProfileId);
    if (!profile) {
      // Fallback to system default
      return this.profiles.get('default')!;
    }
    return profile;
  }

  /**
   * Set the default profile
   */
  async setDefaultProfile(id: string): Promise<void> {
    if (!this.profiles.has(id)) {
      throw new Error(`Profile not found: ${id}`);
    }
    
    this.defaultProfileId = id;
    await this.saveCustomProfiles();
  }

  /**
   * Create a new custom profile
   */
  async createProfile(profile: Partial<TerminalProfile>): Promise<TerminalProfile> {
    // Validate profile
    const errors = validateProfile(profile);
    if (errors.length > 0) {
      throw new Error(`Invalid profile: ${errors.join(', ')}`);
    }
    
    // Get terminal defaults from settings
    const terminalSettings = await getSetting('terminal');
    
    // Merge with defaults
    const newProfile = mergeProfileWithDefaults(profile, {
      appearance: terminalSettings,
      behavior: {
        copyOnSelect: terminalSettings.copyOnSelect,
        rightClickSelectsWord: terminalSettings.rightClickSelectsWord,
        pasteOnMiddleClick: terminalSettings.pasteOnMiddleClick,
        confirmPaste: terminalSettings.confirmPaste
      }
    });
    
    // Ensure it's not marked as built-in
    newProfile.isBuiltIn = false;
    newProfile.createdAt = new Date().toISOString();
    newProfile.updatedAt = newProfile.createdAt;
    
    // Add to profiles
    this.profiles.set(newProfile.id, newProfile);
    
    // Save to storage
    await this.saveCustomProfiles();
    
    return newProfile;
  }

  /**
   * Update an existing profile
   */
  async updateProfile(id: string, updates: Partial<TerminalProfile>): Promise<TerminalProfile> {
    const existing = this.profiles.get(id);
    if (!existing) {
      throw new Error(`Profile not found: ${id}`);
    }
    
    if (existing.isBuiltIn) {
      throw new Error('Cannot modify built-in profiles');
    }
    
    // Validate updates
    const errors = validateProfile({ ...existing, ...updates });
    if (errors.length > 0) {
      throw new Error(`Invalid profile update: ${errors.join(', ')}`);
    }
    
    // Merge updates
    const updated: TerminalProfile = {
      ...existing,
      ...updates,
      id: existing.id, // Preserve ID
      isBuiltIn: false, // Ensure not built-in
      updatedAt: new Date().toISOString()
    };
    
    // Update in memory
    this.profiles.set(id, updated);
    
    // Save to storage
    await this.saveCustomProfiles();
    
    return updated;
  }

  /**
   * Delete a custom profile
   */
  async deleteProfile(id: string): Promise<void> {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error(`Profile not found: ${id}`);
    }
    
    if (profile.isBuiltIn) {
      throw new Error('Cannot delete built-in profiles');
    }
    
    if (id === this.defaultProfileId) {
      throw new Error('Cannot delete the default profile');
    }
    
    // Remove from memory
    this.profiles.delete(id);
    
    // Save to storage
    await this.saveCustomProfiles();
  }

  /**
   * Duplicate an existing profile
   */
  async duplicateProfile(id: string, newName?: string): Promise<TerminalProfile> {
    const original = this.profiles.get(id);
    if (!original) {
      throw new Error(`Profile not found: ${id}`);
    }
    
    const duplicate: Partial<TerminalProfile> = {
      ...original,
      id: crypto.randomUUID(),
      name: newName || `${original.name} (Copy)`,
      isBuiltIn: false,
      isDefault: false
    };
    
    return this.createProfile(duplicate);
  }

  /**
   * Auto-detect the best profile for a given context
   */
  autoDetectProfile(context: {
    cwd?: string;
    gitBranch?: string;
    env?: Record<string, string>;
  }): TerminalProfile | null {
    // Check all profiles with auto-detect rules
    for (const profile of this.profiles.values()) {
      if (matchesAutoDetect(profile, context)) {
        return profile;
      }
    }
    
    return null;
  }

  /**
   * Export profiles to JSON
   */
  exportProfiles(includeBuiltIn = false): string {
    const profiles = includeBuiltIn 
      ? this.getAllProfiles()
      : this.getAllProfiles().filter(p => !p.isBuiltIn);
    
    return JSON.stringify({
      version: 1,
      profiles,
      defaultProfileId: this.defaultProfileId
    }, null, 2);
  }

  /**
   * Import profiles from JSON
   */
  async importProfiles(json: string, overwrite = false): Promise<number> {
    try {
      const data = JSON.parse(json) as ProfileStorage;
      
      if (!data.profiles || !Array.isArray(data.profiles)) {
        throw new Error('Invalid profile data format');
      }
      
      let imported = 0;
      
      for (const profile of data.profiles) {
        // Skip built-in profiles
        if (profile.isBuiltIn) continue;
        
        // Validate profile
        const errors = validateProfile(profile);
        if (errors.length > 0) {
          console.warn(`Skipping invalid profile ${profile.name}: ${errors.join(', ')}`);
          continue;
        }
        
        // Check for existing profile
        if (this.profiles.has(profile.id) && !overwrite) {
          // Generate new ID for duplicate
          profile.id = crypto.randomUUID();
          profile.name = `${profile.name} (Imported)`;
        }
        
        // Add profile
        profile.isBuiltIn = false;
        profile.updatedAt = new Date().toISOString();
        this.profiles.set(profile.id, profile);
        imported++;
      }
      
      // Save if any profiles were imported
      if (imported > 0) {
        await this.saveCustomProfiles();
      }
      
      return imported;
    } catch (error) {
      throw new Error(`Failed to import profiles: ${error}`);
    }
  }

  /**
   * Reset to default profiles
   */
  async resetToDefaults(): Promise<void> {
    // Clear all custom profiles
    const customIds = Array.from(this.profiles.keys())
      .filter(id => !this.profiles.get(id)?.isBuiltIn);
    
    for (const id of customIds) {
      this.profiles.delete(id);
    }
    
    // Reset default profile
    this.defaultProfileId = 'default';
    
    // Save changes
    await this.saveCustomProfiles();
  }
}

// Singleton instance
export const profileManager = new ProfileManager();