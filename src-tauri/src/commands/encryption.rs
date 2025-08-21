use crate::state::app_state::AppState;
use tauri::State;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct EncryptionStatus {
    pub has_master_key: bool,
    pub hardware_security_available: bool,
}

#[tauri::command]
pub async fn encryption_status(state: State<'_, AppState>) -> Result<EncryptionStatus, String> {
    Ok(EncryptionStatus {
        has_master_key: state.encryption.has_master_key(),
        hardware_security_available: crate::encryption::is_hardware_security_available(),
    })
}

#[tauri::command]
pub async fn set_master_key(
    password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.encryption
        .set_master_key(&password)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn verify_master_key(
    password: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state.encryption
        .verify_master_key(&password)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_master_key(state: State<'_, AppState>) -> Result<(), String> {
    state.encryption.clear_master_key();
    Ok(())
}

#[tauri::command]
pub async fn remove_master_key(state: State<'_, AppState>) -> Result<(), String> {
    state.encryption
        .remove_master_key()
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize)]
pub struct TestEncryption {
    pub original: String,
    pub encrypted: crate::encryption::EncryptedData,
    pub decrypted: String,
}

#[tauri::command]
pub async fn test_encryption(
    data: String,
    state: State<'_, AppState>,
) -> Result<TestEncryption, String> {
    let encrypted = state.encryption
        .encrypt(&data)
        .map_err(|e| e.to_string())?;
    
    let decrypted = state.encryption
        .decrypt(&encrypted)
        .map_err(|e| e.to_string())?;
    
    Ok(TestEncryption {
        original: data,
        encrypted,
        decrypted,
    })
}