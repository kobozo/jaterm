use serde::{Deserialize, Serialize};
use ssh_key::{Algorithm, LineEnding, PrivateKey};
use ssh_key::private::{KeypairData, RsaKeypair};
use std::fs;
use std::path::Path;
use std::os::unix::fs::PermissionsExt;
use rand_core::OsRng;

#[derive(Serialize, Deserialize, Debug)]
pub struct GeneratedKey {
    pub private_key_path: String,
    pub public_key_path: String,
    pub public_key_string: String,
    pub fingerprint: String,
}

/// Generate a new SSH key pair
#[tauri::command]
pub async fn generate_ssh_key(
    algorithm: String,
    passphrase: Option<String>,
    profile_name: String,
) -> Result<GeneratedKey, String> {
    // Sanitize profile name for use in filename
    let safe_name = profile_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>()
        .to_lowercase();
    
    // Generate timestamp for uniqueness
    let timestamp = chrono::Utc::now().timestamp();
    
    // Determine key algorithm
    let algo = match algorithm.as_str() {
        "rsa" => Algorithm::Rsa { hash: Some(ssh_key::HashAlg::Sha256) },
        "ed25519" | _ => Algorithm::Ed25519,
    };
    
    // Generate the key pair
    let mut private_key = if algorithm == "rsa" {
        // Generate 4096-bit RSA key
        let keypair = RsaKeypair::random(&mut OsRng, 4096)
            .map_err(|e| format!("Failed to generate RSA key: {}", e))?;
        let keypair_data = KeypairData::Rsa(keypair);
        PrivateKey::new(keypair_data, "")
            .map_err(|e| format!("Failed to create RSA private key: {}", e))?
    } else {
        // Generate Ed25519 key
        PrivateKey::random(&mut OsRng, algo)
            .map_err(|e| format!("Failed to generate Ed25519 key: {}", e))?
    };
    
    // Set comment
    let comment = format!("jaterm_{}_{}", safe_name, timestamp);
    private_key.set_comment(&comment);
    
    // Encrypt with passphrase if provided
    if let Some(ref pass) = passphrase {
        if !pass.is_empty() {
            private_key = private_key.encrypt(&mut OsRng, pass)
                .map_err(|e| format!("Failed to encrypt key: {}", e))?;
        }
    }
    
    // Get public key
    let public_key = private_key.public_key();
    
    // Generate file paths
    let ssh_dir = dirs::home_dir()
        .ok_or_else(|| "Could not find home directory".to_string())?
        .join(".ssh");
    
    // Ensure .ssh directory exists with proper permissions
    if !ssh_dir.exists() {
        fs::create_dir_all(&ssh_dir)
            .map_err(|e| format!("Failed to create .ssh directory: {}", e))?;
    }
    
    #[cfg(unix)]
    {
        fs::set_permissions(&ssh_dir, fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Failed to set .ssh directory permissions: {}", e))?;
    }
    
    let key_name = format!("jaterm_{}_{}", safe_name, timestamp);
    let private_key_path = ssh_dir.join(&key_name);
    let public_key_path = ssh_dir.join(format!("{}.pub", key_name));
    
    // Write private key
    let private_key_string = private_key.to_openssh(LineEnding::LF)
        .map_err(|e| format!("Failed to encode private key: {}", e))?;
    
    fs::write(&private_key_path, private_key_string.as_bytes())
        .map_err(|e| format!("Failed to write private key: {}", e))?;
    
    // Set private key permissions to 600
    #[cfg(unix)]
    {
        fs::set_permissions(&private_key_path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to set private key permissions: {}", e))?;
    }
    
    // Write public key
    let public_key_string = public_key.to_openssh()
        .map_err(|e| format!("Failed to encode public key: {}", e))?;
    
    fs::write(&public_key_path, &public_key_string)
        .map_err(|e| format!("Failed to write public key: {}", e))?;
    
    // Set public key permissions to 644
    #[cfg(unix)]
    {
        fs::set_permissions(&public_key_path, fs::Permissions::from_mode(0o644))
            .map_err(|e| format!("Failed to set public key permissions: {}", e))?;
    }
    
    // Get fingerprint
    let fingerprint = public_key.fingerprint(ssh_key::HashAlg::Sha256).to_string();
    
    Ok(GeneratedKey {
        private_key_path: private_key_path.to_string_lossy().to_string(),
        public_key_path: public_key_path.to_string_lossy().to_string(),
        public_key_string,
        fingerprint,
    })
}

/// Deploy public key to remote server's authorized_keys
#[tauri::command]
pub async fn deploy_public_key(
    state: tauri::State<'_, crate::state::app_state::AppState>,
    session_id: String,
    public_key: String,
) -> Result<(), String> {
    use crate::commands::ssh::{ssh_exec, ssh_sftp_mkdirs};
    
    // Ensure .ssh directory exists on remote with proper permissions
    ssh_sftp_mkdirs(state.clone(), session_id.clone(), "~/.ssh".to_string()).await
        .map_err(|e| format!("Failed to create remote .ssh directory: {}", e))?;
    
    // Set .ssh directory permissions to 700
    let chmod_ssh = ssh_exec(
        state.clone(),
        session_id.clone(),
        "chmod 700 ~/.ssh".to_string(),
    ).await
        .map_err(|e| format!("Failed to set .ssh permissions: {}", e))?;
    
    if chmod_ssh.exit_code != 0 {
        eprintln!("Warning: chmod 700 ~/.ssh failed: {}", chmod_ssh.stderr);
    }
    
    // Check if authorized_keys exists and create if not
    let check_auth_keys = ssh_exec(
        state.clone(),
        session_id.clone(),
        "test -f ~/.ssh/authorized_keys && echo exists || echo missing".to_string(),
    ).await
        .map_err(|e| format!("Failed to check authorized_keys: {}", e))?;
    
    if check_auth_keys.stdout.trim() == "missing" {
        // Create empty authorized_keys file
        let create_auth_keys = ssh_exec(
            state.clone(),
            session_id.clone(),
            "touch ~/.ssh/authorized_keys".to_string(),
        ).await
            .map_err(|e| format!("Failed to create authorized_keys: {}", e))?;
        
        if create_auth_keys.exit_code != 0 {
            return Err(format!("Failed to create authorized_keys: {}", create_auth_keys.stderr));
        }
    }
    
    // Check if key already exists
    let escaped_key = public_key.replace("'", "'\\''");
    let check_key = ssh_exec(
        state.clone(),
        session_id.clone(),
        format!("grep -F '{}' ~/.ssh/authorized_keys >/dev/null 2>&1 && echo exists || echo missing", 
                escaped_key.split_whitespace().nth(1).unwrap_or("")),
    ).await
        .map_err(|e| format!("Failed to check existing key: {}", e))?;
    
    if check_key.stdout.trim() == "exists" {
        eprintln!("Key already exists in authorized_keys");
        return Ok(());
    }
    
    // Append public key to authorized_keys
    let append_key = ssh_exec(
        state.clone(),
        session_id.clone(),
        format!("echo '{}' >> ~/.ssh/authorized_keys", escaped_key),
    ).await
        .map_err(|e| format!("Failed to append key: {}", e))?;
    
    if append_key.exit_code != 0 {
        return Err(format!("Failed to append key to authorized_keys: {}", append_key.stderr));
    }
    
    // Set authorized_keys permissions to 600
    let chmod_auth_keys = ssh_exec(
        state.clone(),
        session_id.clone(),
        "chmod 600 ~/.ssh/authorized_keys".to_string(),
    ).await
        .map_err(|e| format!("Failed to set authorized_keys permissions: {}", e))?;
    
    if chmod_auth_keys.exit_code != 0 {
        eprintln!("Warning: chmod 600 authorized_keys failed: {}", chmod_auth_keys.stderr);
    }
    
    eprintln!("Successfully deployed public key to remote server");
    Ok(())
}

/// Test SSH key authentication
#[tauri::command]
pub async fn test_key_auth(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::app_state::AppState>,
    host: String,
    port: u16,
    user: String,
    key_path: String,
    passphrase: Option<String>,
) -> Result<bool, String> {
    use crate::commands::ssh::{SshProfile, SshAuth};
    
    // Try to connect using the key
    let profile = SshProfile {
        host: host.clone(),
        port,
        user: user.clone(),
        auth: Some(SshAuth {
            password: None,
            key_path: Some(key_path.clone()),
            passphrase,
            agent: false,
        }),
        trust_host: Some(true),
        timeout_ms: Some(10000),
    };
    
    match crate::commands::ssh::ssh_connect(
        app,
        state.clone(),
        profile,
    ).await {
        Ok(session_id) => {
            // Connection successful, disconnect
            let _ = crate::commands::ssh::ssh_disconnect(state, session_id).await;
            Ok(true)
        }
        Err(e) => {
            eprintln!("Key auth test failed: {}", e);
            Ok(false)
        }
    }
}