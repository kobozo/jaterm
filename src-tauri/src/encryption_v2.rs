use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::{
    password_hash::{PasswordHasher, SaltString, PasswordHash, PasswordVerifier},
    Argon2,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::fs;
use std::path::PathBuf;
use zeroize::{Zeroize, ZeroizeOnDrop};
use rand::RngCore;

const KEYRING_SERVICE: &str = "com.kobozo.jaterm";
const DEK_ACCOUNT: &str = "data-encryption-key-v1";
const MASTER_KEY_HASH_ACCOUNT: &str = "master-key-hash-v1";
const ENCRYPTED_DEK_ACCOUNT: &str = "encrypted-dek-v1";

#[derive(Debug, thiserror::Error)]
pub enum EncryptionError {
    #[error("Data encryption key not set")]
    DekNotSet,
    #[error("Master key required for initial setup")]
    MasterKeyRequired,
    #[error("Invalid master key")]
    InvalidMasterKey,
    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),
    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),
    #[error("Keyring error: {0}")]
    KeyringError(String),
    #[error("IO error: {0}")]
    IoError(String),
}

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
struct DataEncryptionKey {
    key: Vec<u8>, // 32 bytes for AES-256
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EncryptedData {
    pub nonce: String,
    pub ciphertext: String,
    pub version: u8,
}

#[derive(Serialize, Deserialize)]
struct EncryptedDek {
    encrypted_key: String,  // DEK encrypted with master key
    salt: String,           // Salt used for master key derivation
    nonce: String,          // Nonce for DEK encryption
    version: u8,
}

pub struct EncryptionManager {
    dek: Mutex<Option<DataEncryptionKey>>,
    master_key_hash: Mutex<Option<String>>, // For verification only
}

impl Default for EncryptionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl EncryptionManager {
    pub fn new() -> Self {
        Self {
            dek: Mutex::new(None),
            master_key_hash: Mutex::new(None),
        }
    }
    
    /// Initialize encryption on app startup - loads or creates DEK
    pub fn initialize(&self) -> Result<bool, EncryptionError> {
        eprintln!("=== ENCRYPTION INITIALIZE CALLED ===");
        eprintln!("Attempting to load DEK from keychain...");
        eprintln!("Service: {}, Account: {}", KEYRING_SERVICE, DEK_ACCOUNT);
        
        // Try to load DEK from OS keychain
        match Entry::new(KEYRING_SERVICE, DEK_ACCOUNT) {
            Ok(entry) => {
                eprintln!("✅ Successfully created keychain Entry object");
                match entry.get_password() {
                    Ok(b64_key) => {
                        eprintln!("✅ Successfully retrieved password from keychain");
                        eprintln!("DEK length (base64): {}", b64_key.len());
                        
                        // Decode and store the DEK
                        match B64.decode(&b64_key) {
                            Ok(key_bytes) => {
                                eprintln!("✅ Successfully decoded DEK, byte length: {}", key_bytes.len());
                                
                                if key_bytes.len() != 32 {
                                    eprintln!("❌ Invalid key size: {} (expected 32)", key_bytes.len());
                                    return Err(EncryptionError::KeyringError("Invalid key size".into()));
                                }
                                
                                *self.dek.lock().unwrap() = Some(DataEncryptionKey { 
                                    key: key_bytes 
                                });
                                
                                eprintln!("✅✅✅ Successfully loaded DEK from keychain!");
                                return Ok(true);
                            }
                            Err(e) => {
                                eprintln!("❌ Failed to decode DEK from base64: {}", e);
                                return Err(EncryptionError::KeyringError(e.to_string()));
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("❌ No DEK found in keychain: {}", e);
                        eprintln!("Will need to create one with master key");
                    }
                }
            }
            Err(e) => {
                eprintln!("❌ Keychain Entry creation error: {}", e);
                eprintln!("Will need master key for setup");
            }
        }
        
        // Fallback: Try to load DEK from dev cache if in development mode
        #[cfg(debug_assertions)]
        {
            eprintln!("DEBUG MODE: Checking for cached DEK...");
            if let Ok(dek_cache_path) = self.dev_dek_cache_path() {
                if dek_cache_path.exists() {
                    eprintln!("Found DEK cache file: {}", dek_cache_path.display());
                    if let Ok(cached_dek) = fs::read_to_string(&dek_cache_path) {
                        if let Ok(key_bytes) = B64.decode(cached_dek.trim()) {
                            if key_bytes.len() == 32 {
                                *self.dek.lock().unwrap() = Some(DataEncryptionKey { 
                                    key: key_bytes 
                                });
                                eprintln!("✅ Successfully loaded DEK from dev cache!");
                                return Ok(true);
                            }
                        }
                    }
                }
            }
        }
        
        eprintln!("No DEK in keychain or cache - initialization incomplete");
        // No DEK found - need to create one with master key
        Ok(false)
    }
    
    /// Set up encryption with a master key (first time setup)
    pub fn setup_with_master_key(&self, password: &str) -> Result<(), EncryptionError> {
        eprintln!("=== SETUP_WITH_MASTER_KEY CALLED ===");
        eprintln!("Password length: {}", password.len());
        
        // Generate a new random DEK
        let mut dek_bytes = vec![0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut dek_bytes);
        eprintln!("Generated new DEK of {} bytes", dek_bytes.len());
        
        // Generate salt for master key derivation
        let salt = SaltString::generate(&mut OsRng);
        
        // Derive key from master password
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| EncryptionError::EncryptionFailed(e.to_string()))?;
        
        // Extract key material for encrypting the DEK
        let master_key_bytes = password_hash.hash.unwrap().as_bytes()[..32].to_vec();
        
        // Encrypt the DEK with the master key for backup/recovery
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&master_key_bytes));
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let encrypted_dek = cipher
            .encrypt(&nonce, dek_bytes.as_ref())
            .map_err(|e| EncryptionError::EncryptionFailed(e.to_string()))?;
        
        // Store the DEK in OS keychain for automatic access
        eprintln!("Attempting to store DEK in keychain...");
        eprintln!("Creating Entry with Service: {}, Account: {}", KEYRING_SERVICE, DEK_ACCOUNT);
        
        let dek_b64 = B64.encode(&dek_bytes);
        eprintln!("DEK base64 length: {}", dek_b64.len());
        
        // Try to store in keychain
        let keychain_result = Entry::new(KEYRING_SERVICE, DEK_ACCOUNT)
            .and_then(|entry| entry.set_password(&dek_b64));
        
        match keychain_result {
            Ok(_) => {
                eprintln!("✅✅✅ Successfully stored DEK in keychain during setup!");
                
                // In dev mode, ALWAYS save to cache file as backup
                #[cfg(debug_assertions)]
                {
                    eprintln!("DEBUG MODE: Also saving DEK to cache file for next restart...");
                    if let Ok(cache_path) = self.dev_dek_cache_path() {
                        match fs::write(&cache_path, &dek_b64) {
                            Ok(_) => eprintln!("✅ Saved DEK to dev cache: {}", cache_path.display()),
                            Err(e) => eprintln!("❌ Failed to save DEK to dev cache: {}", e),
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("❌ Failed to store DEK in keychain: {}", e);
                eprintln!("Error details: {:?}", e);
                
                // In dev mode, save to cache file as fallback
                #[cfg(debug_assertions)]
                {
                    eprintln!("DEBUG MODE: Saving DEK to cache file as fallback...");
                    if let Ok(cache_path) = self.dev_dek_cache_path() {
                        match fs::write(&cache_path, &dek_b64) {
                            Ok(_) => eprintln!("✅ Saved DEK to dev cache: {}", cache_path.display()),
                            Err(e) => eprintln!("❌ Failed to save DEK to dev cache: {}", e),
                        }
                    }
                }
                
                // Don't fail the entire setup if keychain storage fails
                eprintln!("Continuing despite keychain storage failure...");
            }
        }
        
        // Store the encrypted DEK for recovery/export
        let encrypted_dek_data = EncryptedDek {
            encrypted_key: B64.encode(&encrypted_dek),
            salt: salt.to_string(),
            nonce: B64.encode(nonce.as_slice()),
            version: 1,
        };
        
        // Save encrypted DEK to keychain (for recovery)
        let encrypted_dek_entry = Entry::new(KEYRING_SERVICE, ENCRYPTED_DEK_ACCOUNT)
            .map_err(|e| EncryptionError::KeyringError(e.to_string()))?;
        encrypted_dek_entry
            .set_password(&serde_json::to_string(&encrypted_dek_data).unwrap())
            .map_err(|e| EncryptionError::KeyringError(format!("Failed to store encrypted DEK: {}", e)))?;
        
        // Store master key hash for verification
        let hash_entry = Entry::new(KEYRING_SERVICE, MASTER_KEY_HASH_ACCOUNT)
            .map_err(|e| EncryptionError::KeyringError(e.to_string()))?;
        hash_entry
            .set_password(&password_hash.to_string())
            .map_err(|e| EncryptionError::KeyringError(format!("Failed to store master key hash: {}", e)))?;
        
        // Also save to fallback file for emergency recovery
        self.save_recovery_file(&encrypted_dek_data, &password_hash.to_string())?;
        
        // Store DEK in memory
        *self.dek.lock().unwrap() = Some(DataEncryptionKey { key: dek_bytes });
        *self.master_key_hash.lock().unwrap() = Some(password_hash.to_string());
        
        eprintln!("Successfully set up encryption with master key");
        Ok(())
    }
    
    /// Recover DEK using master key (when keychain is unavailable)
    pub fn recover_with_master_key(&self, password: &str) -> Result<(), EncryptionError> {
        eprintln!("=== RECOVER_WITH_MASTER_KEY CALLED ===");
        eprintln!("Password length: {}", password.len());
        
        // Load the encrypted DEK and metadata
        let encrypted_dek_data = self.load_encrypted_dek()?;
        eprintln!("Loaded encrypted DEK data");
        
        // Parse salt and derive key from password
        let salt = SaltString::from_b64(&encrypted_dek_data.salt)
            .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
        
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|_| EncryptionError::InvalidMasterKey)?;
        
        // Verify against stored hash if available
        if let Some(stored_hash) = self.load_master_key_hash() {
            let parsed_hash = PasswordHash::new(&stored_hash)
                .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
            
            if argon2.verify_password(password.as_bytes(), &parsed_hash).is_err() {
                return Err(EncryptionError::InvalidMasterKey);
            }
        }
        
        // Decrypt the DEK
        let master_key_bytes = password_hash.hash.unwrap().as_bytes()[..32].to_vec();
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&master_key_bytes));
        
        let nonce_bytes = B64.decode(&encrypted_dek_data.nonce)
            .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
        let nonce = Nonce::from_slice(&nonce_bytes);
        
        let encrypted_dek = B64.decode(&encrypted_dek_data.encrypted_key)
            .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
        
        let dek_bytes = cipher
            .decrypt(nonce, encrypted_dek.as_ref())
            .map_err(|_| EncryptionError::InvalidMasterKey)?;
        
        // Try to store in keychain for next time
        eprintln!("Attempting to restore DEK to keychain after recovery...");
        eprintln!("Creating Entry with Service: {}, Account: {}", KEYRING_SERVICE, DEK_ACCOUNT);
        
        let dek_b64 = B64.encode(&dek_bytes);
        
        match Entry::new(KEYRING_SERVICE, DEK_ACCOUNT) {
            Ok(entry) => {
                eprintln!("DEK base64 length for storage: {}", dek_b64.len());
                
                match entry.set_password(&dek_b64) {
                    Ok(_) => {
                        eprintln!("✅✅✅ Successfully restored DEK to keychain!");
                        
                        // In dev mode, ALWAYS save to cache file as backup
                        #[cfg(debug_assertions)]
                        {
                            eprintln!("DEBUG MODE: Also saving DEK to cache file for next restart...");
                            if let Ok(cache_path) = self.dev_dek_cache_path() {
                                match fs::write(&cache_path, &dek_b64) {
                                    Ok(_) => eprintln!("✅ Saved DEK to dev cache: {}", cache_path.display()),
                                    Err(e) => eprintln!("❌ Failed to save DEK to dev cache: {}", e),
                                }
                            }
                        }
                    },
                    Err(e) => {
                        eprintln!("❌ Failed to store DEK in keychain: {}", e);
                        eprintln!("Error details: {:?}", e);
                        
                        // In dev mode, save to cache file as fallback
                        #[cfg(debug_assertions)]
                        {
                            eprintln!("DEBUG MODE: Saving DEK to cache file as fallback...");
                            if let Ok(cache_path) = self.dev_dek_cache_path() {
                                match fs::write(&cache_path, &dek_b64) {
                                    Ok(_) => eprintln!("✅ Saved DEK to dev cache: {}", cache_path.display()),
                                    Err(e) => eprintln!("❌ Failed to save DEK to dev cache: {}", e),
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("❌ Failed to create keychain Entry for DEK restoration: {}", e);
                eprintln!("Error details: {:?}", e);
                
                // In dev mode, save to cache file as fallback
                #[cfg(debug_assertions)]
                {
                    eprintln!("DEBUG MODE: Saving DEK to cache file as fallback...");
                    if let Ok(cache_path) = self.dev_dek_cache_path() {
                        match fs::write(&cache_path, &dek_b64) {
                            Ok(_) => eprintln!("✅ Saved DEK to dev cache: {}", cache_path.display()),
                            Err(e) => eprintln!("❌ Failed to save DEK to dev cache: {}", e),
                        }
                    }
                }
            }
        }
        
        // Store in memory
        *self.dek.lock().unwrap() = Some(DataEncryptionKey { key: dek_bytes });
        
        eprintln!("Successfully recovered DEK with master key");
        Ok(())
    }
    
    /// Verify master key (for UI validation)
    pub fn verify_master_key(&self, password: &str) -> Result<bool, EncryptionError> {
        // Try to decrypt a test file or the encrypted DEK
        match self.load_encrypted_dek() {
            Ok(encrypted_dek_data) => {
                // Try to decrypt the DEK with provided password
                let salt = SaltString::from_b64(&encrypted_dek_data.salt)
                    .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
                
                let argon2 = Argon2::default();
                let password_hash = argon2
                    .hash_password(password.as_bytes(), &salt)
                    .map_err(|_| EncryptionError::InvalidMasterKey)?;
                
                let master_key_bytes = password_hash.hash.unwrap().as_bytes()[..32].to_vec();
                let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&master_key_bytes));
                
                let nonce_bytes = B64.decode(&encrypted_dek_data.nonce)
                    .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
                let nonce = Nonce::from_slice(&nonce_bytes);
                
                let encrypted_dek = B64.decode(&encrypted_dek_data.encrypted_key)
                    .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
                
                // Try to decrypt - if it works, password is correct
                match cipher.decrypt(nonce, encrypted_dek.as_ref()) {
                    Ok(_) => Ok(true),
                    Err(_) => Ok(false),
                }
            }
            Err(_) => {
                // No encrypted DEK, can't verify
                Ok(false)
            }
        }
    }
    
    /// Check if encryption is set up
    pub fn is_initialized(&self) -> bool {
        self.dek.lock().unwrap().is_some()
    }
    
    /// Check if we need master key setup (first run)
    pub fn needs_setup(&self) -> bool {
        // Check if we have a DEK in keychain or encrypted DEK for recovery
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, DEK_ACCOUNT) {
            if entry.get_password().is_ok() {
                return false;
            }
        }
        
        // Check for encrypted DEK (recovery file)
        !self.has_encrypted_dek()
    }
    
    /// Encrypt data using the DEK
    pub fn encrypt(&self, plaintext: &str) -> Result<EncryptedData, EncryptionError> {
        let dek_guard = self.dek.lock().unwrap();
        let dek = dek_guard
            .as_ref()
            .ok_or(EncryptionError::DekNotSet)?;
        
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&dek.key));
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        
        let ciphertext = cipher
            .encrypt(&nonce, plaintext.as_bytes())
            .map_err(|e| EncryptionError::EncryptionFailed(e.to_string()))?;
        
        Ok(EncryptedData {
            nonce: B64.encode(nonce.as_slice()),
            ciphertext: B64.encode(&ciphertext),
            version: 1,
        })
    }
    
    /// Decrypt data using the DEK
    pub fn decrypt(&self, encrypted: &EncryptedData) -> Result<String, EncryptionError> {
        if encrypted.version != 1 {
            return Err(EncryptionError::DecryptionFailed("Unsupported version".into()));
        }
        
        let dek_guard = self.dek.lock().unwrap();
        let dek = dek_guard
            .as_ref()
            .ok_or(EncryptionError::DekNotSet)?;
        
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&dek.key));
        
        let nonce_bytes = B64.decode(&encrypted.nonce)
            .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
        let nonce = Nonce::from_slice(&nonce_bytes);
        
        let ciphertext = B64.decode(&encrypted.ciphertext)
            .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
        
        let plaintext = cipher
            .decrypt(nonce, ciphertext.as_ref())
            .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
        
        String::from_utf8(plaintext)
            .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))
    }
    
    /// Export encrypted DEK for backup/transfer
    pub fn export_encrypted_dek(&self) -> Result<String, EncryptionError> {
        let encrypted_dek = self.load_encrypted_dek()?;
        serde_json::to_string_pretty(&encrypted_dek)
            .map_err(|e| EncryptionError::EncryptionFailed(e.to_string()))
    }
    
    /// Import encrypted DEK from backup
    pub fn import_encrypted_dek(&self, data: &str, password: &str) -> Result<(), EncryptionError> {
        let encrypted_dek: EncryptedDek = serde_json::from_str(data)
            .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
        
        // Save the encrypted DEK
        let entry = Entry::new(KEYRING_SERVICE, ENCRYPTED_DEK_ACCOUNT)
            .map_err(|e| EncryptionError::KeyringError(e.to_string()))?;
        entry
            .set_password(&serde_json::to_string(&encrypted_dek).unwrap())
            .map_err(|e| EncryptionError::KeyringError(e.to_string()))?;
        
        // Now recover with the master key
        self.recover_with_master_key(password)
    }
    
    // Helper methods
    
    fn load_encrypted_dek(&self) -> Result<EncryptedDek, EncryptionError> {
        // Try keychain first
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, ENCRYPTED_DEK_ACCOUNT) {
            if let Ok(data) = entry.get_password() {
                return serde_json::from_str(&data)
                    .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()));
            }
        }
        
        // Try recovery file
        let recovery_path = self.recovery_file_path()?;
        if recovery_path.exists() {
            let content = fs::read_to_string(&recovery_path)
                .map_err(|e| EncryptionError::IoError(e.to_string()))?;
            
            let data: serde_json::Value = serde_json::from_str(&content)
                .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;
            
            if let Some(encrypted_dek) = data.get("encrypted_dek") {
                return serde_json::from_value(encrypted_dek.clone())
                    .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()));
            }
        }
        
        Err(EncryptionError::DekNotSet)
    }
    
    fn has_encrypted_dek(&self) -> bool {
        // Check keychain
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, ENCRYPTED_DEK_ACCOUNT) {
            if entry.get_password().is_ok() {
                return true;
            }
        }
        
        // Check recovery file
        if let Ok(path) = self.recovery_file_path() {
            return path.exists();
        }
        
        false
    }
    
    fn load_master_key_hash(&self) -> Option<String> {
        // Try keychain
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, MASTER_KEY_HASH_ACCOUNT) {
            if let Ok(hash) = entry.get_password() {
                return Some(hash);
            }
        }
        
        // Try recovery file
        if let Ok(path) = self.recovery_file_path() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(hash) = data.get("master_key_hash").and_then(|v| v.as_str()) {
                        return Some(hash.to_string());
                    }
                }
            }
        }
        
        None
    }
    
    fn recovery_file_path(&self) -> Result<PathBuf, EncryptionError> {
        let config_dir = crate::config::ensure_config_dir(Some("jaterm"))
            .map_err(|e| EncryptionError::IoError(format!("Failed to get config dir: {}", e)))?;
        Ok(config_dir.join(".encryption_recovery"))
    }
    
    fn dev_dek_cache_path(&self) -> Result<PathBuf, EncryptionError> {
        let config_dir = crate::config::ensure_config_dir(Some("jaterm"))
            .map_err(|e| EncryptionError::IoError(format!("Failed to get config dir: {}", e)))?;
        Ok(config_dir.join(".dek_cache_dev"))
    }
    
    fn save_recovery_file(&self, encrypted_dek: &EncryptedDek, master_key_hash: &str) -> Result<(), EncryptionError> {
        let path = self.recovery_file_path()?;
        
        let data = serde_json::json!({
            "encrypted_dek": encrypted_dek,
            "master_key_hash": master_key_hash,
            "version": 1,
            "note": "This file contains your encrypted data encryption key. Keep it safe for emergency recovery."
        });
        
        // Write atomically
        let tmp_path = path.with_extension("tmp");
        fs::write(&tmp_path, serde_json::to_string_pretty(&data).unwrap())
            .map_err(|e| EncryptionError::IoError(e.to_string()))?;
        fs::rename(&tmp_path, &path)
            .map_err(|e| EncryptionError::IoError(e.to_string()))?;
        
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
    
    /// Clear all encryption data (for testing/reset)
    pub fn clear_all(&self) -> Result<(), EncryptionError> {
        // Clear memory
        *self.dek.lock().unwrap() = None;
        *self.master_key_hash.lock().unwrap() = None;
        
        // Clear keychain entries
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, DEK_ACCOUNT) {
            let _ = entry.delete_credential();
        }
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, ENCRYPTED_DEK_ACCOUNT) {
            let _ = entry.delete_credential();
        }
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, MASTER_KEY_HASH_ACCOUNT) {
            let _ = entry.delete_credential();
        }
        
        // Remove recovery file
        if let Ok(path) = self.recovery_file_path() {
            let _ = fs::remove_file(path);
        }
        
        Ok(())
    }
}