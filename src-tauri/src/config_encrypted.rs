use crate::encryption::EncryptedData;
use crate::state::app_state::AppState;
use serde_json::Value;
use std::fs;
use tauri::State;

/// Load profiles with automatic decryption if needed
#[tauri::command]
pub async fn load_profiles_encrypted(
    app_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let enc_path = crate::config::profiles_file_path(app_name.as_deref())
        .map_err(|e| e.to_string())?
        .with_extension("json.enc");
    let plain_path =
        crate::config::profiles_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;

    // If encrypted file exists, ONLY use that (require master key)
    if enc_path.exists() {
        if !state.encryption.has_master_key() {
            eprintln!("Encrypted profiles exist but no master key - returning empty");
            // Return empty profiles - frontend will prompt for master key
            return Ok(serde_json::json!({}));
        }

        eprintln!("Loading encrypted profiles from {}", enc_path.display());
        let contents = fs::read_to_string(&enc_path)
            .map_err(|e| format!("Failed to read encrypted profiles: {}", e))?;

        // Parse as encrypted data
        let encrypted: EncryptedData = serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse encrypted profiles: {}", e))?;

        // Decrypt entire file
        let decrypted = state
            .encryption
            .decrypt(&encrypted)
            .map_err(|e| format!("Failed to decrypt profiles: {}", e))?;

        // Parse decrypted JSON
        let profiles: Value = serde_json::from_str(&decrypted)
            .map_err(|e| format!("Failed to parse decrypted profiles: {}", e))?;

        eprintln!("Successfully decrypted profiles");
        return Ok(profiles);
    }

    // Only use plain file if encrypted doesn't exist
    if !plain_path.exists() {
        return Ok(serde_json::json!({}));
    }

    eprintln!("Loading plain profiles from {}", plain_path.display());
    let contents =
        fs::read_to_string(&plain_path).map_err(|e| format!("Failed to read profiles: {}", e))?;

    // Parse as plain JSON
    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse profiles: {}", e))
}

/// Save profiles with encryption if master key is set
#[tauri::command]
pub async fn save_profiles_encrypted(
    profiles: Value,
    app_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = crate::config::profiles_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;

    // If we have a master key, save encrypted version
    if state.encryption.has_master_key() {
        // Serialize profiles to JSON string
        let json_str = serde_json::to_string_pretty(&profiles)
            .map_err(|e| format!("Failed to serialize profiles: {}", e))?;

        // Encrypt entire JSON
        let encrypted = state
            .encryption
            .encrypt(&json_str)
            .map_err(|e| format!("Failed to encrypt profiles: {}", e))?;

        // Save encrypted file
        let enc_path = path.with_extension("json.enc");
        let enc_data = serde_json::to_string_pretty(&encrypted)
            .map_err(|e| format!("Failed to serialize encrypted data: {}", e))?;

        // Write atomically
        let tmp = enc_path.with_extension("tmp");
        fs::write(&tmp, enc_data)
            .map_err(|e| format!("Failed to write encrypted profiles: {}", e))?;
        fs::rename(&tmp, &enc_path)
            .map_err(|e| format!("Failed to save encrypted profiles: {}", e))?;

        eprintln!("Saved encrypted profiles to {}", enc_path.display());

        // Delete the plain text file if it exists (security!)
        if path.exists() {
            if let Err(e) = fs::remove_file(&path) {
                eprintln!("Warning: Failed to delete plain profiles.json: {}", e);
            } else {
                eprintln!("Deleted plain profiles.json for security");
            }
        }
    } else {
        // No master key, save as plain JSON
        let data = serde_json::to_vec_pretty(&profiles)
            .map_err(|e| format!("Failed to serialize profiles: {}", e))?;

        // Write atomically
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, data).map_err(|e| format!("Failed to write profiles: {}", e))?;
        fs::rename(&tmp, &path).map_err(|e| format!("Failed to save profiles: {}", e))?;
    }

    Ok(())
}

/// Check if profiles need migration (plain text exists but no encrypted version)
#[tauri::command]
pub async fn check_profiles_need_migration(app_name: Option<String>) -> Result<bool, String> {
    let path = crate::config::profiles_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;
    let enc_path = path.with_extension("json.enc");

    // Need migration if:
    // 1. Plain exists but encrypted doesn't (initial migration)
    // 2. Encrypted exists but user deleted master key file (re-setup required)
    if enc_path.exists() {
        // Encrypted exists, check if we need to unlock
        return Ok(false);
    }

    // Need migration if plain exists
    Ok(path.exists())
}

/// Migrate existing plain profiles to encrypted format
#[tauri::command]
pub async fn migrate_profiles_to_encrypted(
    app_name: Option<String>,
    password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Set the master key first
    state
        .encryption
        .set_master_key(&password)
        .map_err(|e| format!("Failed to set master key: {}", e))?;

    // Load existing profiles
    let path = crate::config::profiles_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;

    if !path.exists() {
        return Ok(());
    }

    let contents =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read profiles: {}", e))?;

    let profiles: Value =
        serde_json::from_str(&contents).map_err(|e| format!("Failed to parse profiles: {}", e))?;

    // Save encrypted version
    save_profiles_encrypted(profiles, app_name, state).await?;

    eprintln!("Successfully migrated profiles to encrypted format");
    Ok(())
}
