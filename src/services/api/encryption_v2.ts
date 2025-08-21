import { invoke } from '@tauri-apps/api/core';

/**
 * Initialize encryption on app startup
 * Returns true if DEK is loaded, false if setup is needed
 */
export async function initEncryption(): Promise<boolean> {
  return invoke('init_encryption');
}

/**
 * Check if encryption needs setup (first run)
 */
export async function encryptionNeedsSetup(): Promise<boolean> {
  return invoke('encryption_needs_setup');
}

/**
 * Set up encryption with master key (first time)
 */
export async function setupEncryption(password: string): Promise<void> {
  return invoke('setup_encryption', { password });
}

/**
 * Verify master key (for UI validation)
 */
export async function verifyMasterKeyV2(password: string): Promise<boolean> {
  return invoke('verify_master_key_v2', { password });
}

/**
 * Recover encryption with master key (when keychain fails)
 */
export async function recoverEncryption(password: string): Promise<void> {
  return invoke('recover_encryption', { password });
}

/**
 * Load profiles with automatic decryption
 */
export async function loadProfilesV2(appName?: string): Promise<any> {
  return invoke('load_profiles_v2', { appName });
}

/**
 * Save profiles with automatic encryption
 */
export async function saveProfilesV2(profiles: any, appName?: string): Promise<void> {
  return invoke('save_profiles_v2', { profiles, appName });
}

/**
 * Check if profiles need migration from plain text
 */
export async function checkProfilesNeedMigrationV2(appName?: string): Promise<boolean> {
  return invoke('check_profiles_need_migration_v2', { appName });
}

/**
 * Migrate plain profiles to encrypted
 */
export async function migrateProfilesV2(appName?: string): Promise<void> {
  return invoke('migrate_profiles_v2', { appName });
}

/**
 * Export encrypted DEK for backup
 */
export async function exportEncryptionKey(): Promise<string> {
  return invoke('export_encryption_key');
}

/**
 * Import encrypted DEK from backup
 */
export async function importEncryptionKey(data: string, password: string): Promise<void> {
  return invoke('import_encryption_key', { data, password });
}