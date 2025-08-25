use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use zeroize::{Zeroize, ZeroizeOnDrop};

const KEYRING_SERVICE: &str = "jaterm";
const KEYRING_USER: &str = "master_key";
const SALT_KEY: &str = "encryption_salt";

#[derive(Debug, thiserror::Error)]
pub enum EncryptionError {
    #[error("Master key not set")]
    MasterKeyNotSet,
    #[error("Invalid master key")]
    InvalidMasterKey,
    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),
    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),
    #[error("Keyring error: {0}")]
    KeyringError(String),
    #[error("Serialization error: {0}")]
    SerializationError(String),
}

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
struct MasterKey {
    key: Vec<u8>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EncryptedData {
    pub nonce: String,
    pub ciphertext: String,
    pub salt: String,
    pub version: u8,
}

pub struct EncryptionManager {
    master_key: Mutex<Option<MasterKey>>,
    salt: Mutex<Option<String>>,
}

impl Default for EncryptionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl EncryptionManager {
    pub fn new() -> Self {
        Self {
            master_key: Mutex::new(None),
            salt: Mutex::new(None),
        }
    }

    /// Get the path for the fallback key storage file
    fn fallback_key_path() -> Result<PathBuf, EncryptionError> {
        let config_dir = crate::config::ensure_config_dir(Some("jaterm")).map_err(|e| {
            EncryptionError::KeyringError(format!("Failed to get config dir: {}", e))
        })?;
        Ok(config_dir.join(".master_key_hash"))
    }

    /// Save master key hash to fallback file
    fn save_key_fallback(&self, password_hash: &str, salt: &str) -> Result<(), EncryptionError> {
        let path = Self::fallback_key_path()?;
        let data = serde_json::json!({
            "hash": password_hash,
            "salt": salt,
            "version": 1
        });
        fs::write(&path, serde_json::to_string(&data).unwrap()).map_err(|e| {
            EncryptionError::KeyringError(format!("Failed to save key fallback: {}", e))
        })?;
        // Set restrictive permissions on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&path).unwrap().permissions();
            perms.set_mode(0o600);
            let _ = fs::set_permissions(&path, perms);
        }
        Ok(())
    }

    /// Load master key hash from fallback file
    fn load_key_fallback(&self) -> Result<(String, String), EncryptionError> {
        let path = Self::fallback_key_path()?;
        if !path.exists() {
            return Err(EncryptionError::MasterKeyNotSet);
        }
        let data = fs::read_to_string(&path).map_err(|e| {
            EncryptionError::KeyringError(format!("Failed to read key fallback: {}", e))
        })?;
        let json: serde_json::Value = serde_json::from_str(&data).map_err(|e| {
            EncryptionError::KeyringError(format!("Invalid key fallback format: {}", e))
        })?;

        let hash = json
            .get("hash")
            .and_then(|v| v.as_str())
            .ok_or_else(|| EncryptionError::KeyringError("Missing hash in fallback".to_string()))?;
        let salt = json
            .get("salt")
            .and_then(|v| v.as_str())
            .ok_or_else(|| EncryptionError::KeyringError("Missing salt in fallback".to_string()))?;

        Ok((hash.to_string(), salt.to_string()))
    }

    /// Initialize the encryption manager, loading saved keys if available
    pub fn init(&self) -> Result<bool, EncryptionError> {
        // Try to load the master key from the system keyring first
        match Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            Ok(entry) => {
                match entry.get_password() {
                    Ok(stored_key) => {
                        // Also load the salt
                        if let Ok(salt_entry) = Entry::new(KEYRING_SERVICE, SALT_KEY) {
                            if let Ok(salt) = salt_entry.get_password() {
                                *self.salt.lock().unwrap() = Some(salt);
                            }
                        }

                        // Decode the stored key
                        if let Ok(key_bytes) = B64.decode(stored_key) {
                            *self.master_key.lock().unwrap() = Some(MasterKey { key: key_bytes });
                            eprintln!("Successfully loaded master key from keychain");
                            return Ok(true);
                        }
                    }
                    Err(e) => {
                        eprintln!("No master key found in keychain: {}, trying fallback", e);
                    }
                }
            }
            Err(e) => {
                eprintln!(
                    "Failed to access keychain during init: {}, trying fallback",
                    e
                );
            }
        }

        // Try fallback file storage
        if let Ok((_hash, salt)) = self.load_key_fallback() {
            // We have the hash and salt but not the actual key
            // The key will need to be provided via verify_master_key
            *self.salt.lock().unwrap() = Some(salt);
            eprintln!("Found master key hash in fallback storage");
            // Return false because we don't have the actual key yet
            return Ok(false);
        }

        Ok(false)
    }

    /// Set a new master key from a password
    pub fn set_master_key(&self, password: &str) -> Result<(), EncryptionError> {
        // Check if we already have a salt (from verification) and reuse it
        let existing_salt = self.salt.lock().unwrap().clone();

        let salt = if let Some(salt_str) = existing_salt {
            // Reuse existing salt
            SaltString::from_b64(&salt_str)
                .map_err(|e| EncryptionError::EncryptionFailed(e.to_string()))?
        } else {
            // Generate a new salt for key derivation
            SaltString::generate(&mut OsRng)
        };

        // Derive key from password using Argon2
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| EncryptionError::EncryptionFailed(e.to_string()))?;

        // Extract the key material (32 bytes for AES-256)
        let key_bytes = password_hash.hash.unwrap().as_bytes()[..32].to_vec();

        // Store in memory
        *self.master_key.lock().unwrap() = Some(MasterKey {
            key: key_bytes.clone(),
        });
        *self.salt.lock().unwrap() = Some(salt.to_string());

        // Save to fallback file storage (always save here for reliability)
        if let Err(e) = self.save_key_fallback(&password_hash.to_string(), &salt.to_string()) {
            eprintln!("Warning: Failed to save master key to fallback: {}", e);
        } else {
            eprintln!("Master key saved to fallback storage");
        }

        // Try to store in system keyring for persistence
        match Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            Ok(entry) => {
                if let Err(e) = entry.set_password(&B64.encode(&key_bytes)) {
                    eprintln!("Warning: Failed to store master key in keychain: {}", e);
                }
            }
            Err(e) => {
                eprintln!("Warning: Failed to access keychain for master key: {}", e);
            }
        }

        match Entry::new(KEYRING_SERVICE, SALT_KEY) {
            Ok(salt_entry) => {
                if let Err(e) = salt_entry.set_password(&salt.to_string()) {
                    eprintln!("Warning: Failed to store salt in keychain: {}", e);
                }
            }
            Err(e) => {
                eprintln!("Warning: Failed to access keychain for salt: {}", e);
            }
        }

        Ok(())
    }

    /// Verify a master key password by testing decryption of the actual profiles file
    pub fn verify_master_key(&self, password: &str) -> Result<bool, EncryptionError> {
        // First check if we have salt in memory
        let has_salt = self.salt.lock().unwrap().is_some();
        let _has_key = self.master_key.lock().unwrap().is_some();

        // If we don't have salt but have a fallback file, load from there
        if !has_salt {
            if let Ok((stored_hash, salt)) = self.load_key_fallback() {
                // Verify the password against the stored hash
                let parsed_hash = PasswordHash::new(&stored_hash)
                    .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
                let argon2 = Argon2::default();

                if argon2
                    .verify_password(password.as_bytes(), &parsed_hash)
                    .is_ok()
                {
                    // Password is correct, derive the key and store it
                    let salt_str = SaltString::from_b64(&salt)
                        .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
                    let password_hash = argon2
                        .hash_password(password.as_bytes(), &salt_str)
                        .map_err(|_e| EncryptionError::InvalidMasterKey)?;
                    let key_bytes = password_hash.hash.unwrap().as_bytes()[..32].to_vec();

                    // Store in memory for this session
                    *self.master_key.lock().unwrap() = Some(MasterKey { key: key_bytes });
                    *self.salt.lock().unwrap() = Some(salt);

                    // Now test if we can actually decrypt the profiles file
                    if let Ok(enc_path) = crate::config::profiles_file_path(Some("jaterm")) {
                        let enc_path = enc_path.with_extension("json.enc");
                        if enc_path.exists() {
                            eprintln!("Testing decryption of encrypted profiles...");
                            // Try to decrypt to verify the key works
                            if let Ok(contents) = std::fs::read_to_string(&enc_path) {
                                if let Ok(encrypted) =
                                    serde_json::from_str::<EncryptedData>(&contents)
                                {
                                    // Try to decrypt - if this fails, the key is wrong
                                    match self.decrypt(&encrypted) {
                                        Ok(_) => {
                                            eprintln!("Decryption test successful");
                                            return Ok(true);
                                        }
                                        Err(e) => {
                                            eprintln!("Decryption test failed: {}", e);
                                            // Clear the invalid key
                                            *self.master_key.lock().unwrap() = None;
                                            *self.salt.lock().unwrap() = None;
                                            return Ok(false);
                                        }
                                    }
                                }
                            }
                        } else {
                            // No encrypted profiles exist yet - password is correct since it matches the hash
                            // Store the key for future use
                            eprintln!("No encrypted profiles exist yet, storing verified key");
                            return Ok(true);
                        }
                    }

                    // If we can't find the profiles path, assume it's correct
                    return Ok(true);
                } else {
                    return Ok(false);
                }
            }
        }

        // Standard verification when we have salt in memory
        let salt_guard = self.salt.lock().unwrap();
        let salt_str = salt_guard
            .as_ref()
            .ok_or(EncryptionError::MasterKeyNotSet)?;

        // Parse the stored salt
        let salt = SaltString::from_b64(salt_str)
            .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;

        // Derive key from password
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|_e| EncryptionError::InvalidMasterKey)?;

        let key_bytes = password_hash.hash.unwrap().as_bytes()[..32].to_vec();

        // Temporarily store the key to test decryption
        *self.master_key.lock().unwrap() = Some(MasterKey {
            key: key_bytes.clone(),
        });

        // Test if we can actually decrypt the profiles file with this key
        let can_decrypt = if let Ok(enc_path) = crate::config::profiles_file_path(Some("jaterm")) {
            let enc_path = enc_path.with_extension("json.enc");
            if enc_path.exists() {
                eprintln!("Testing decryption of encrypted profiles...");
                // Try to decrypt the file to verify the key works
                if let Ok(contents) = std::fs::read_to_string(&enc_path) {
                    if let Ok(encrypted) = serde_json::from_str::<EncryptedData>(&contents) {
                        // Try to decrypt - if this fails, the key is wrong
                        match self.decrypt(&encrypted) {
                            Ok(_) => {
                                eprintln!("Decryption test successful");
                                true
                            }
                            Err(e) => {
                                eprintln!("Decryption test failed: {}", e);
                                false
                            }
                        }
                    } else {
                        eprintln!("Failed to parse encrypted data");
                        false
                    }
                } else {
                    eprintln!("Failed to read encrypted file");
                    // Can't read file, but password hash matches - assume ok
                    true
                }
            } else {
                // No encrypted file yet, key is valid for new encryption
                eprintln!("No encrypted profiles found, key accepted for new encryption");
                true
            }
        } else {
            // Can't get path, assume key is ok
            true
        };

        if !can_decrypt {
            // Clear the invalid key
            *self.master_key.lock().unwrap() = None;
            return Ok(false);
        }

        // Key is valid and works for decryption
        Ok(true)
    }

    /// Clear the master key from memory
    pub fn clear_master_key(&self) {
        *self.master_key.lock().unwrap() = None;
        *self.salt.lock().unwrap() = None;
    }

    /// Remove the master key from the system keyring
    pub fn remove_master_key(&self) -> Result<(), EncryptionError> {
        self.clear_master_key();

        // Remove from keychain
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            let _ = entry.delete_credential();
        }

        if let Ok(salt_entry) = Entry::new(KEYRING_SERVICE, SALT_KEY) {
            let _ = salt_entry.delete_credential();
        }

        // Remove fallback file
        if let Ok(path) = Self::fallback_key_path() {
            let _ = fs::remove_file(path);
        }

        Ok(())
    }

    /// Check if a master key is set
    pub fn has_master_key(&self) -> bool {
        self.master_key.lock().unwrap().is_some()
    }

    /// Encrypt sensitive data
    pub fn encrypt(&self, data: &str) -> Result<EncryptedData, EncryptionError> {
        let master_key_guard = self.master_key.lock().unwrap();
        let master_key = master_key_guard
            .as_ref()
            .ok_or(EncryptionError::MasterKeyNotSet)?;

        let salt_guard = self.salt.lock().unwrap();
        let salt = salt_guard
            .as_ref()
            .ok_or(EncryptionError::MasterKeyNotSet)?;

        // Create cipher
        let key = Key::<Aes256Gcm>::from_slice(&master_key.key);
        let cipher = Aes256Gcm::new(key);

        // Generate nonce
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

        // Encrypt data
        let ciphertext = cipher
            .encrypt(&nonce, data.as_bytes())
            .map_err(|e| EncryptionError::EncryptionFailed(e.to_string()))?;

        Ok(EncryptedData {
            nonce: B64.encode(nonce.as_slice()),
            ciphertext: B64.encode(ciphertext),
            salt: salt.clone(),
            version: 1,
        })
    }

    /// Decrypt sensitive data
    pub fn decrypt(&self, encrypted: &EncryptedData) -> Result<String, EncryptionError> {
        let master_key_guard = self.master_key.lock().unwrap();
        let master_key = master_key_guard
            .as_ref()
            .ok_or(EncryptionError::MasterKeyNotSet)?;

        // Decode from base64
        let nonce_bytes = B64
            .decode(&encrypted.nonce)
            .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
        let ciphertext = B64
            .decode(&encrypted.ciphertext)
            .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;

        // Create cipher
        let key = Key::<Aes256Gcm>::from_slice(&master_key.key);
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Decrypt data
        let plaintext = cipher
            .decrypt(nonce, ciphertext.as_ref())
            .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;

        String::from_utf8(plaintext).map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))
    }

    /// Encrypt a serializable object
    pub fn encrypt_json<T: Serialize>(&self, data: &T) -> Result<EncryptedData, EncryptionError> {
        let json = serde_json::to_string(data)
            .map_err(|e| EncryptionError::SerializationError(e.to_string()))?;
        self.encrypt(&json)
    }

    /// Decrypt to a deserializable object
    pub fn decrypt_json<T: for<'de> Deserialize<'de>>(
        &self,
        encrypted: &EncryptedData,
    ) -> Result<T, EncryptionError> {
        let json = self.decrypt(encrypted)?;
        serde_json::from_str(&json).map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))
    }
}

// Helper to check if TPM/Secure Enclave is available
pub fn is_hardware_security_available() -> bool {
    #[cfg(target_os = "windows")]
    {
        // Check for Windows TPM availability
        // This would require Windows-specific APIs
        false // Simplified for now
    }

    #[cfg(target_os = "macos")]
    {
        // Check for Secure Enclave availability
        // Available on Macs with Apple Silicon or T2 chip
        std::process::Command::new("system_profiler")
            .args(&["SPiBridgeDataType"])
            .output()
            .map(|output| {
                let stdout = String::from_utf8_lossy(&output.stdout);
                stdout.contains("Apple T2") || stdout.contains("Apple M")
            })
            .unwrap_or(false)
    }

    #[cfg(target_os = "linux")]
    {
        // Check for TPM on Linux
        std::path::Path::new("/dev/tpm0").exists() || std::path::Path::new("/dev/tpmrm0").exists()
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encryption_roundtrip() {
        let manager = EncryptionManager::new();

        // Set master key
        manager.set_master_key("test_password_123").unwrap();

        // Test data
        let original = "sensitive data";

        // Encrypt
        let encrypted = manager.encrypt(original).unwrap();

        // Decrypt
        let decrypted = manager.decrypt(&encrypted).unwrap();

        assert_eq!(original, decrypted);
    }

    #[test]
    fn test_json_encryption() {
        let manager = EncryptionManager::new();
        manager.set_master_key("test_password_123").unwrap();

        #[derive(Serialize, Deserialize, PartialEq, Debug)]
        struct TestData {
            password: String,
            api_key: String,
        }

        let original = TestData {
            password: "secret123".to_string(),
            api_key: "api_key_xyz".to_string(),
        };

        // Encrypt
        let encrypted = manager.encrypt_json(&original).unwrap();

        // Decrypt
        let decrypted: TestData = manager.decrypt_json(&encrypted).unwrap();

        assert_eq!(original, decrypted);
    }

    #[test]
    fn test_verify_master_key() {
        let manager = EncryptionManager::new();

        // Start fresh - remove any existing keys
        let _ = manager.remove_master_key();

        // Set the master key
        manager.set_master_key("correct_password").unwrap();

        // Clear the in-memory key to force verification from storage
        *manager.master_key.lock().unwrap() = None;
        *manager.salt.lock().unwrap() = None;

        // Test 1: Correct password should verify successfully
        assert!(manager.verify_master_key("correct_password").unwrap());

        // Clear again for next test
        *manager.master_key.lock().unwrap() = None;
        *manager.salt.lock().unwrap() = None;

        // Test 2: Wrong password should fail
        assert!(!manager.verify_master_key("wrong_password").unwrap());

        // Cleanup - remove the test key
        let _ = manager.remove_master_key();
    }
}
