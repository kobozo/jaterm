use crate::encryption_v2::EncryptedData;
use crate::state::app_state::AppState;
use serde_json::Value;
use std::fs;
use tauri::State;

/// Initialize encryption on app startup
#[tauri::command]
pub async fn init_encryption(state: State<'_, AppState>) -> Result<bool, String> {
    // Initialize encryption manager
    // Returns true if DEK is loaded, false if setup is needed
    state.encryption_v2.initialize().map_err(|e| e.to_string())
}

/// Check if encryption needs setup (first run)
#[tauri::command]
pub async fn encryption_needs_setup(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.encryption_v2.needs_setup())
}

/// Set up encryption with master key (first time)
#[tauri::command]
pub async fn setup_encryption(password: String, state: State<'_, AppState>) -> Result<(), String> {
    eprintln!("=== TAURI COMMAND: setup_encryption ===");
    state
        .encryption_v2
        .setup_with_master_key(&password)
        .map_err(|e| e.to_string())
}

/// Verify master key (for UI validation)
#[tauri::command]
pub async fn verify_master_key_v2(
    password: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state
        .encryption_v2
        .verify_master_key(&password)
        .map_err(|e| e.to_string())
}

/// Recover encryption with master key (when keychain fails)
#[tauri::command]
pub async fn recover_encryption(
    password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    eprintln!("=== TAURI COMMAND: recover_encryption ===");
    state
        .encryption_v2
        .recover_with_master_key(&password)
        .map_err(|e| e.to_string())
}

/// Load profiles with automatic decryption
#[tauri::command]
pub async fn load_profiles_v2(
    app_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let enc_path = crate::config::profiles_file_path(app_name.as_deref())
        .map_err(|e| e.to_string())?
        .with_extension("json.enc");
    let plain_path =
        crate::config::profiles_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;

    // Check if encryption is initialized
    if !state.encryption_v2.is_initialized() {
        // Try to initialize
        if !state.encryption_v2.initialize().unwrap_or(false) {
            // Encryption not set up yet
            if enc_path.exists() {
                // Have encrypted file but no key - return empty
                eprintln!("Encrypted profiles exist but encryption not initialized");
                return Ok(serde_json::json!({}));
            }
            // No encrypted file, check for plain
            if plain_path.exists() {
                // Migration needed - return plain for now
                eprintln!("Plain profiles exist, migration needed");
                let contents = fs::read_to_string(&plain_path)
                    .map_err(|e| format!("Failed to read profiles: {}", e))?;
                return serde_json::from_str(&contents)
                    .map_err(|e| format!("Failed to parse profiles: {}", e));
            }
            return Ok(serde_json::json!({}));
        }
    }

    // Encryption is initialized, proceed with loading
    if enc_path.exists() {
        eprintln!("Loading encrypted profiles from {}", enc_path.display());
        let contents = fs::read_to_string(&enc_path)
            .map_err(|e| format!("Failed to read encrypted profiles: {}", e))?;

        // Parse as encrypted data
        let encrypted: EncryptedData = serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse encrypted profiles: {}", e))?;

        // Decrypt entire file
        let decrypted = state
            .encryption_v2
            .decrypt(&encrypted)
            .map_err(|e| format!("Failed to decrypt profiles: {}", e))?;

        // Parse decrypted JSON
        let profiles: Value = serde_json::from_str(&decrypted)
            .map_err(|e| format!("Failed to parse decrypted profiles: {}", e))?;

        eprintln!("Successfully decrypted profiles");
        return Ok(profiles);
    }

    // Check for plain file (migration scenario)
    if plain_path.exists() {
        eprintln!(
            "Loading plain profiles for migration from {}",
            plain_path.display()
        );
        let contents = fs::read_to_string(&plain_path)
            .map_err(|e| format!("Failed to read profiles: {}", e))?;

        serde_json::from_str(&contents).map_err(|e| format!("Failed to parse profiles: {}", e))
    } else {
        Ok(serde_json::json!({}))
    }
}

/// Save profiles with automatic encryption
#[tauri::command]
pub async fn save_profiles_v2(
    profiles: Value,
    app_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = crate::config::profiles_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;

    // Check if encryption is initialized
    if !state.encryption_v2.is_initialized() {
        // Try to initialize
        if !state.encryption_v2.initialize().unwrap_or(false) {
            // Can't encrypt, save as plain (should not happen in normal flow)
            eprintln!("Warning: Encryption not initialized, saving as plain text");
            let data = serde_json::to_vec_pretty(&profiles)
                .map_err(|e| format!("Failed to serialize profiles: {}", e))?;

            let tmp = path.with_extension("json.tmp");
            fs::write(&tmp, data).map_err(|e| format!("Failed to write profiles: {}", e))?;
            fs::rename(&tmp, &path).map_err(|e| format!("Failed to save profiles: {}", e))?;
            return Ok(());
        }
    }

    // Serialize profiles to JSON string
    let json_str = serde_json::to_string_pretty(&profiles)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;

    // Encrypt entire JSON
    let encrypted = state
        .encryption_v2
        .encrypt(&json_str)
        .map_err(|e| format!("Failed to encrypt profiles: {}", e))?;

    // Save encrypted file
    let enc_path = path.with_extension("json.enc");
    let enc_data = serde_json::to_string_pretty(&encrypted)
        .map_err(|e| format!("Failed to serialize encrypted data: {}", e))?;

    // Write atomically
    let tmp = enc_path.with_extension("tmp");
    fs::write(&tmp, enc_data).map_err(|e| format!("Failed to write encrypted profiles: {}", e))?;
    fs::rename(&tmp, &enc_path).map_err(|e| format!("Failed to save encrypted profiles: {}", e))?;

    eprintln!("Saved encrypted profiles to {}", enc_path.display());

    // Delete the plain text file if it exists
    if path.exists() {
        if let Err(e) = fs::remove_file(&path) {
            eprintln!("Warning: Failed to delete plain profiles.json: {}", e);
        } else {
            eprintln!("Deleted plain profiles.json for security");
        }
    }

    Ok(())
}

/// Check if profiles need migration
#[tauri::command]
pub async fn check_profiles_need_migration_v2(app_name: Option<String>) -> Result<bool, String> {
    let path = crate::config::profiles_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;
    let enc_path = path.with_extension("json.enc");

    // Need migration if plain exists but encrypted doesn't
    Ok(path.exists() && !enc_path.exists())
}

/// Migrate plain profiles to encrypted
#[tauri::command]
pub async fn migrate_profiles_v2(
    app_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Load existing plain profiles
    let path = crate::config::profiles_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;

    if !path.exists() {
        return Ok(());
    }

    let contents =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read profiles: {}", e))?;

    let profiles: Value =
        serde_json::from_str(&contents).map_err(|e| format!("Failed to parse profiles: {}", e))?;

    // Save as encrypted
    save_profiles_v2(profiles, app_name, state).await?;

    eprintln!("Successfully migrated profiles to encrypted format");
    Ok(())
}

/// Export encrypted DEK for backup
#[tauri::command]
pub async fn export_encryption_key(state: State<'_, AppState>) -> Result<String, String> {
    state
        .encryption_v2
        .export_encrypted_dek()
        .map_err(|e| e.to_string())
}

/// Import encrypted DEK from backup
#[tauri::command]
pub async fn import_encryption_key(
    data: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .encryption_v2
        .import_encrypted_dek(&data, &password)
        .map_err(|e| e.to_string())
}

/// Helper function to encrypt sensitive fields in a JSON value
fn encrypt_sensitive_fields(
    value: &mut Value,
    state: &AppState,
    path: &[String],
) -> Result<(), String> {
    // Define sensitive field paths that should be encrypted
    let sensitive_paths = vec![
        vec!["ai", "providers", "openai", "apiKey"],
        vec!["ai", "providers", "anthropic", "apiKey"],
        vec!["ai", "providers", "azure", "apiKey"],
        vec!["ai", "providers", "huggingface", "apiToken"],
    ];

    match value {
        Value::Object(map) => {
            for (key, val) in map.iter_mut() {
                let mut current_path = path.to_vec();
                current_path.push(key.clone());
                
                // Check if current path matches any sensitive path
                let is_sensitive = sensitive_paths.iter().any(|sp| {
                    sp.len() == current_path.len() &&
                    sp.iter().zip(current_path.iter()).all(|(a, b)| a == b)
                });

                if is_sensitive {
                    // Encrypt the value if it's a string
                    if let Value::String(s) = val {
                        if !s.is_empty() && !s.starts_with("enc:") {
                            // Encrypt the value
                            let encrypted = state
                                .encryption_v2
                                .encrypt(s)
                                .map_err(|e| format!("Failed to encrypt field: {}", e))?;
                            
                            // Store as JSON with a marker prefix
                            let encrypted_json = serde_json::to_string(&encrypted)
                                .map_err(|e| format!("Failed to serialize encrypted data: {}", e))?;
                            *val = Value::String(format!("enc:{}", encrypted_json));
                        }
                    }
                } else {
                    // Recurse into nested objects
                    encrypt_sensitive_fields(val, state, &current_path)?;
                }
            }
        }
        Value::Array(arr) => {
            for item in arr {
                encrypt_sensitive_fields(item, state, path)?;
            }
        }
        _ => {}
    }
    
    Ok(())
}

/// Helper function to decrypt sensitive fields in a JSON value
fn decrypt_sensitive_fields(
    value: &mut Value,
    state: &AppState,
) -> Result<(), String> {
    match value {
        Value::Object(map) => {
            for val in map.values_mut() {
                if let Value::String(s) = val {
                    if let Some(encrypted_json) = s.strip_prefix("enc:") {
                        // Parse the encrypted data
                        let encrypted: EncryptedData = serde_json::from_str(encrypted_json)
                            .map_err(|e| format!("Failed to parse encrypted field: {}", e))?;
                        
                        // Decrypt the value
                        let decrypted = state
                            .encryption_v2
                            .decrypt(&encrypted)
                            .map_err(|e| format!("Failed to decrypt field: {}", e))?;
                        
                        *val = Value::String(decrypted);
                    }
                } else {
                    // Recurse into nested objects
                    decrypt_sensitive_fields(val, state)?;
                }
            }
        }
        Value::Array(arr) => {
            for item in arr {
                decrypt_sensitive_fields(item, state)?;
            }
        }
        _ => {}
    }
    
    Ok(())
}

/// Load config with automatic decryption of sensitive fields
#[tauri::command]
pub async fn load_config_v2(
    app_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let path = crate::config::config_file_path(app_name.as_deref())
        .map_err(|e| e.to_string())?;

    if !path.exists() {
        return Ok(serde_json::json!({}));
    }

    // Read the config file
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    
    let mut config: Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    // Check if encryption is initialized
    if state.encryption_v2.is_initialized() || state.encryption_v2.initialize().unwrap_or(false) {
        // Decrypt sensitive fields in place
        decrypt_sensitive_fields(&mut config, &state)?;
    }

    Ok(config)
}

/// Save config with automatic encryption of sensitive fields
#[tauri::command]
pub async fn save_config_v2(
    config: Value,
    app_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = crate::config::config_file_path(app_name.as_deref())
        .map_err(|e| e.to_string())?;

    let mut config_to_save = config.clone();

    // Check if encryption is initialized
    if state.encryption_v2.is_initialized() || state.encryption_v2.initialize().unwrap_or(false) {
        // Encrypt sensitive fields in place
        encrypt_sensitive_fields(&mut config_to_save, &state, &Vec::new())?;
    }

    // Serialize the config
    let data = serde_json::to_vec_pretty(&config_to_save)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    // Write atomically
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    fs::rename(&tmp, &path)
        .map_err(|e| format!("Failed to save config: {}", e))?;

    Ok(())
}

/// Check if config needs migration to encrypted format
#[tauri::command]
pub async fn check_config_needs_encryption_v2(
    app_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let path = crate::config::config_file_path(app_name.as_deref())
        .map_err(|e| e.to_string())?;

    if !path.exists() {
        return Ok(false);
    }

    // Read the config file
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    
    let config: Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    // Check if any API keys are not encrypted
    let needs_encryption = check_has_unencrypted_keys(&config);

    Ok(needs_encryption)
}

/// Helper to check if config has unencrypted API keys
fn check_has_unencrypted_keys(value: &Value) -> bool {
    // Check AI provider API keys
    if let Some(ai) = value.get("ai") {
        if let Some(providers) = ai.get("providers") {
            // Check each provider
            for provider in ["openai", "anthropic", "azure"] {
                if let Some(p) = providers.get(provider) {
                    if let Some(Value::String(key)) = p.get("apiKey") {
                        if !key.is_empty() && !key.starts_with("enc:") {
                            return true;
                        }
                    }
                }
            }
            // Check HuggingFace token
            if let Some(hf) = providers.get("huggingface") {
                if let Some(Value::String(token)) = hf.get("apiToken") {
                    if !token.is_empty() && !token.starts_with("enc:") {
                        return true;
                    }
                }
            }
        }
    }
    false
}
