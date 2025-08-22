use std::io::{Read, Write};
use std::net::TcpStream;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;
use base64::Engine;
use serde::Serialize;
use serde::Deserialize;

#[derive(serde::Deserialize, Clone)]
pub struct SshAuth {
  #[serde(default)]
  pub password: Option<String>,
  #[serde(default)]
  pub key_path: Option<String>,
  #[serde(default)]
  pub passphrase: Option<String>,
  #[serde(default)]
  pub agent: bool,
}

#[derive(serde::Deserialize)]
#[derive(Clone)]
pub struct SshProfile {
  pub host: String,
  #[serde(default = "default_port")] pub port: u16,
  pub user: String,
  #[serde(default)] pub auth: Option<SshAuth>,
  #[serde(default)] #[allow(dead_code)] pub timeout_ms: Option<u64>,
  #[serde(default)] pub trust_host: Option<bool>,
}

fn default_port() -> u16 { 22 }

#[tauri::command]
pub async fn ssh_connect(app: tauri::AppHandle, state: State<'_, crate::state::app_state::AppState>, profile: SshProfile) -> Result<String, String> {
  // Normalize hostnames to lowercase for consistency (DNS is case-insensitive)
  let host_lc = profile.host.to_ascii_lowercase();
  let addr = format!("{}:{}", host_lc, profile.port);
  let tcp = TcpStream::connect(&addr).map_err(|e| format!("tcp connect: {e}"))?;
  // Explicitly set NO timeout on the TCP socket - crucial for SSH channel operations
  tcp.set_read_timeout(None).ok();
  tcp.set_write_timeout(None).ok();
  let mut sess = ssh2::Session::new().map_err(|e| format!("session: {e}"))?;
  sess.set_tcp_stream(tcp.try_clone().map_err(|e| e.to_string())?);
  sess.handshake().map_err(|e| format!("handshake: {e}"))?;
  // Verify known_hosts (best-effort) before user authentication
  if let Ok(mut kh) = sess.known_hosts() {
    if let Ok(home) = std::env::var("HOME") {
      let kh_path = std::path::PathBuf::from(home).join(".ssh/known_hosts");
      let _ = kh.read_file(&kh_path, ssh2::KnownHostFileKind::OpenSSH);
      if let Some((key, _)) = sess.host_key() {
        let hostport = format!("{}:{}", host_lc, profile.port);
        match kh.check(&host_lc, key) {
          ssh2::CheckResult::Match => {}
          ssh2::CheckResult::NotFound => {
            // Prompt user unless trust_host is set
            if profile.trust_host.unwrap_or(false) {
              // Append host key to known_hosts
              let key_type = sess.host_key().map(|(_, t)| t).unwrap_or(ssh2::HostKeyType::Unknown);
              let kt = match key_type {
                ssh2::HostKeyType::Rsa => "ssh-rsa",
                ssh2::HostKeyType::Dss => "ssh-dss",
                ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
                ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
                ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
                ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
                _ => "ssh-ed25519",
              };
              let b64 = base64::engine::general_purpose::STANDARD.encode(key);
              // Ensure directory exists
              if let Some(parent) = kh_path.parent() { let _ = std::fs::create_dir_all(parent); }
              // Append line "host keytype key"
              let line = format!("{} {} {}\n", host_lc, kt, b64);
              use std::io::Write as IoWrite;
              if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&kh_path) {
                let _ = f.write_all(line.as_bytes());
              }
              eprintln!("[ssh] known_hosts: trusted and saved {}", hostport);
            } else {
              // Compute SHA256 fingerprint for prompt
              let fp = {
                use sha2::{Digest, Sha256};
                let mut hasher = Sha256::new();
                hasher.update(key);
                let out = hasher.finalize();
                let b64 = base64::engine::general_purpose::STANDARD.encode(out);
                b64.trim_end_matches('=') .to_string()
              };
              let key_type = sess.host_key().map(|(_, t)| t).unwrap_or(ssh2::HostKeyType::Unknown);
              let kt = match key_type {
                ssh2::HostKeyType::Rsa => "ssh-rsa",
                ssh2::HostKeyType::Dss => "ssh-dss",
                ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
                ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
                ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
                ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
                _ => "unknown",
              };
              let prompt = serde_json::json!({
                "error": "KNOWN_HOSTS_PROMPT",
                "host": host_lc,
                "port": profile.port,
                "keyType": kt,
                "fingerprintSHA256": fp
              });
              return Err(prompt.to_string());
            }
          }
          ssh2::CheckResult::Mismatch => {
            return Err(format!("known_hosts mismatch for {}", hostport));
          }
          ssh2::CheckResult::Failure => {
            if profile.trust_host.unwrap_or(false) {
              // Same handling as NotFound: accept and write
              let key_type = sess.host_key().map(|(_, t)| t).unwrap_or(ssh2::HostKeyType::Unknown);
              let kt = match key_type {
                ssh2::HostKeyType::Rsa => "ssh-rsa",
                ssh2::HostKeyType::Dss => "ssh-dss",
                ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
                ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
                ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
                ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
                _ => "ssh-ed25519",
              };
              let b64 = base64::engine::general_purpose::STANDARD.encode(key);
              if let Some(parent) = kh_path.parent() { let _ = std::fs::create_dir_all(parent); }
              let line = format!("{} {} {}\n", host_lc, kt, b64);
              use std::io::Write as IoWrite;
              if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&kh_path) {
                let _ = f.write_all(line.as_bytes());
              }
              eprintln!("[ssh] known_hosts: accepted on failure and saved {}", hostport);
            } else {
              eprintln!("[ssh] known_hosts: check failure for {} (prompting)", hostport);
              let fp = {
                use sha2::{Digest, Sha256};
                let mut hasher = Sha256::new();
                hasher.update(key);
                let out = hasher.finalize();
                let b64 = base64::engine::general_purpose::STANDARD.encode(out);
                b64.trim_end_matches('=') .to_string()
              };
              let key_type = sess.host_key().map(|(_, t)| t).unwrap_or(ssh2::HostKeyType::Unknown);
              let kt = match key_type {
                ssh2::HostKeyType::Rsa => "ssh-rsa",
                ssh2::HostKeyType::Dss => "ssh-dss",
                ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
                ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
                ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
                ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
                _ => "unknown",
              };
              let prompt = serde_json::json!({
                "error": "KNOWN_HOSTS_PROMPT",
                "host": host_lc,
                "port": profile.port,
                "keyType": kt,
                "fingerprintSHA256": fp
              });
              return Err(prompt.to_string());
            }
          }
        }
      }
    }
  }
  // Auth
  if let Some(auth) = &profile.auth {
    eprintln!("Auth provided - agent: {}, has_password: {}, has_key: {}", 
             auth.agent, auth.password.is_some(), auth.key_path.is_some());
    if auth.agent {
      let mut agent = sess.agent().map_err(|e| e.to_string())?;
      agent.connect().map_err(|e| e.to_string())?;
      agent.list_identities().map_err(|e| e.to_string())?;
      let mut ok = false;
      for id in agent.identities().map_err(|e| e.to_string())? {
        if agent.userauth(&profile.user, &id).is_ok() { ok = true; break; }
      }
      if !ok { return Err("agent auth failed".into()); }
    } else if let Some(pw) = &auth.password {
      eprintln!("Using password auth");
      sess.userauth_password(&profile.user, pw).map_err(|e| format!("auth pw: {e}"))?;
    } else if let Some(key) = &auth.key_path {
      sess.userauth_pubkey_file(&profile.user, None, std::path::Path::new(key), auth.passphrase.as_deref()).map_err(|e| format!("auth key: {e}"))?;
    } else {
      return Err("no auth method provided".into());
    }
  } else {
    return Err("missing auth".into());
  }
  if !sess.authenticated() { return Err("authentication failed".into()); }
  
  // Configure session for optimal performance
  // Keepalive to avoid idle disconnects
  let _ = sess.set_keepalive(true, 30);
  
  // Explicitly set NO timeout (0 means infinite) - crucial for channel creation
  sess.set_timeout(0);
  
  // Start in blocking mode - functions will switch to non-blocking as needed
  sess.set_blocking(true);
  
  // Start watchdog for git status and port detection (non-blocking)
  let session_id_for_watchdog = format!("ssh_{}", nanoid::nanoid!(8));
  let app_for_watchdog = app.clone();
  let host_for_watchdog = host_lc.clone();
  let port_for_watchdog = profile.port;
  let user_for_watchdog = profile.user.clone();
  let session_id_clone = session_id_for_watchdog.clone();
  
  std::thread::spawn(move || {
    std::thread::sleep(std::time::Duration::from_millis(500)); // Small delay to let connection establish
    
    // Initial port detection
    let output = std::process::Command::new("ssh")
      .arg("-p")
      .arg(port_for_watchdog.to_string())
      .arg("-o")
      .arg("StrictHostKeyChecking=no")
      .arg("-o")
      .arg("UserKnownHostsFile=/dev/null")
      .arg(format!("{}@{}", user_for_watchdog, host_for_watchdog))
      .arg("~/.jaterm-helper/jaterm-agent detect-ports 2>/dev/null || echo '[]'")
      .output();
      
    if let Ok(output) = output {
      let stdout = String::from_utf8_lossy(&output.stdout);
      if let Ok(ports) = serde_json::from_str::<Vec<u16>>(&stdout) {
        eprintln!("[ssh] Detected {} open ports on remote", ports.len());
        // Emit event with detected ports
        let _ = app_for_watchdog.emit(
          "ssh_detected_ports",
          serde_json::json!({
            "sessionId": session_id_clone,
            "ports": ports
          })
        );
      }
    }
    
    // TODO: Set up periodic watchdog polling for git + ports
    // This would be better handled by the frontend polling mechanism
  });
  
  let id = session_id_for_watchdog;
  {
    let mut inner = state.inner.lock().map_err(|_| "lock state")?;
    inner.ssh.insert(
      id.clone(),
      crate::state::app_state::SshSession {
        id: id.clone(),
        tcp,
        sess,
        lock: std::sync::Arc::new(std::sync::Mutex::new(())),
        host: host_lc,
        port: profile.port,
        user: profile.user,
      },
    );
  }
  Ok(id)
}

#[tauri::command]
pub async fn ssh_home_dir(state: State<'_, crate::state::app_state::AppState>, session_id: String) -> Result<String, String> {
  let mut inner = state.inner.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  
  // Temporarily set to blocking mode for SFTP creation
  s.sess.set_blocking(true);
  let sftp = s.sess.sftp().map_err(|e| e.to_string())?;
  let path = sftp.realpath(Path::new(".")).map_err(|e| e.to_string())?;
  // Return to non-blocking mode
  s.sess.set_blocking(false);
  path.to_str().map(|s| s.to_string()).ok_or_else(|| "non-utf8 path".to_string())
}

#[derive(Serialize)]
pub struct SftpEntry { pub name: String, pub path: String, pub is_dir: bool }

use std::path::Path;
use std::time::Duration;

#[tauri::command]
pub async fn ssh_sftp_list(state: State<'_, crate::state::app_state::AppState>, session_id: String, path: String) -> Result<Vec<SftpEntry>, String> {
  let mut inner = state.inner.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  let sftp = loop {
    match s.sess.sftp() {
      Ok(h) => break h,
      Err(e) => {
        if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; }
        else { return Err(e.to_string()); }
      }
    }
  };
  let entries = loop {
    match sftp.readdir(Path::new(&path)) {
      Ok(v) => break v,
      Err(e) => {
        if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; }
        else { return Err(e.to_string()); }
      }
    }
  };
  let mut out = Vec::new();
  for (p, st) in entries {
    if let Some(name_os) = p.file_name() {
      if let Some(name) = name_os.to_str() {
        if name == "." { continue; }
        let is_dir = st.is_dir();
        let child_path = p.to_string_lossy().to_string();
        out.push(SftpEntry { name: name.to_string(), path: child_path, is_dir });
      }
    }
  }
  // Sort: directories first, then names
  out.sort_by(|a,b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
  Ok(out)
}

#[tauri::command]
pub async fn ssh_sftp_download(state: State<'_, crate::state::app_state::AppState>, session_id: String, remote_path: String, local_path: String) -> Result<(), String> {
  eprintln!("[ssh] sftp_download session={} remote={} local={}", session_id, remote_path, local_path);
  let mut inner = state.inner.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  let sftp = loop { match s.sess.sftp() { Ok(h) => break h, Err(e) => { if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; } else { return Err(e.to_string()); } } } };
  // Ensure local parent directory exists
  if let Some(parent) = std::path::Path::new(&local_path).parent() { let _ = std::fs::create_dir_all(parent); }
  let mut remote = loop { match sftp.open(Path::new(&remote_path)) { Ok(f) => break f, Err(e) => { if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; } else { return Err(e.to_string()); } } } };
  let mut local = std::fs::File::create(&local_path).map_err(|e| e.to_string())?;
  let mut buf = [0u8; 131072];
  loop {
    match remote.read(&mut buf) {
      Ok(0) => break,
      Ok(n) => {
        let mut off = 0;
        while off < n {
          match local.write(&buf[off..n]) {
            Ok(m) => off += m,
            Err(e) => return Err(e.to_string()),
          }
        }
      }
      Err(e) => {
        if e.kind() == std::io::ErrorKind::WouldBlock { std::thread::sleep(Duration::from_millis(10)); continue; }
        else { return Err(e.to_string()); }
      }
    }
  }
  Ok(())
}

#[tauri::command]
pub async fn ssh_sftp_download_dir(state: State<'_, crate::state::app_state::AppState>, session_id: String, remote_dir: String, local_dir: String) -> Result<(), String> {
  eprintln!("[ssh] sftp_download_dir session={} remote_dir={} local_dir={}", session_id, remote_dir, local_dir);
  let mut inner = state.inner.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  let sftp = loop { match s.sess.sftp() { Ok(h) => break h, Err(e) => { if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; } else { return Err(e.to_string()); } } } };
  let remote_root = Path::new(&remote_dir).to_path_buf();
  let local_root = std::path::Path::new(&local_dir).to_path_buf();
  std::fs::create_dir_all(&local_root).map_err(|e| e.to_string())?;

  fn rel<'a>(root: &std::path::Path, p: &std::path::Path) -> std::path::PathBuf {
    match p.strip_prefix(root) { Ok(r) => r.to_path_buf(), Err(_) => std::path::PathBuf::from(p.file_name().unwrap_or_default()) }
  }

  fn download_recursive(sftp: &ssh2::Sftp, rroot: &std::path::Path, lroot: &std::path::Path, rcur: &std::path::Path) -> Result<(), String> {
    let entries = loop {
      match sftp.readdir(rcur) {
        Ok(v) => break v,
        Err(e) => {
          if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; }
          else { return Err(e.to_string()); }
        }
      }
    };

    for (rpath, st) in entries {
      let name = match rpath.file_name().and_then(|s| s.to_str()) { Some(n) => n, None => continue };
      if name == "." || name == ".." { continue; }
      let lpath = lroot.join(rel(rroot, &rpath));
      if st.is_dir() {
        std::fs::create_dir_all(&lpath).map_err(|e| e.to_string())?;
        download_recursive(sftp, rroot, lroot, &rpath)?;
      } else {
        // file copy
        if let Some(parent) = lpath.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        let mut rfile = loop { match sftp.open(&rpath) { Ok(f) => break f, Err(e) => { if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; } else { return Err(e.to_string()); } } } };
        let mut lfile = std::fs::File::create(&lpath).map_err(|e| e.to_string())?;
        let mut buf = [0u8; 131072];
        loop {
          match rfile.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
              let mut off = 0; while off < n { match lfile.write(&buf[off..n]) { Ok(m) => off += m, Err(e) => return Err(e.to_string()) } }
            }
            Err(e) => {
              if e.kind() == std::io::ErrorKind::WouldBlock { std::thread::sleep(Duration::from_millis(10)); continue; }
              else { return Err(e.to_string()); }
            }
          }
        }
      }
    }
    Ok(())
  }

  download_recursive(&sftp, &remote_root, &local_root, &remote_root)
}

#[tauri::command]
pub async fn ssh_sftp_read(state: State<'_, crate::state::app_state::AppState>, session_id: String, remote_path: String) -> Result<String, String> {
  eprintln!("[ssh] sftp_read session={} path={}", session_id, remote_path);
  let mut inner = state.inner.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  let sftp = loop { match s.sess.sftp() { Ok(h) => break h, Err(e) => { if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; } else { return Err(e.to_string()); } } } };
  let mut file = loop { match sftp.open(Path::new(&remote_path)) { Ok(f) => break f, Err(e) => { if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; } else { return Err(e.to_string()); } } } };
  let mut buf = Vec::new();
  loop {
    let mut tmp = [0u8; 65536];
    match file.read(&mut tmp) {
      Ok(0) => break,
      Ok(n) => { buf.extend_from_slice(&tmp[..n]); }
      Err(e) => {
        if e.kind() == std::io::ErrorKind::WouldBlock { std::thread::sleep(Duration::from_millis(10)); continue; }
        else { return Err(e.to_string()); }
      }
    }
  }
  let b64 = base64::engine::general_purpose::STANDARD.encode(buf);
  Ok(b64)
}

#[tauri::command]
pub async fn ssh_sftp_mkdirs(state: State<'_, crate::state::app_state::AppState>, session_id: String, path: String) -> Result<(), String> {
  eprintln!("[ssh] mkdirs session={} path={}", session_id, path);
  let mut inner = state.inner.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  
  // Temporarily set to blocking mode for SFTP operations
  s.sess.set_blocking(true);
  let sftp = s.sess.sftp().map_err(|e| e.to_string())?;
  let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty() && *p != ".").collect();
  let mut cur = if path.starts_with('/') { String::from("/") } else { String::new() };
  for part in parts {
    if cur != "/" && !cur.is_empty() { cur.push('/'); }
    cur.push_str(part);
    let p = Path::new(&cur);
    // If exists and is dir, continue (no retry needed in blocking mode)
    if let Ok(st) = sftp.stat(p) {
      if st.is_dir() { continue; }
    }
    // Try to create; if it fails, check again if it now exists (race) else error
    if let Err(e) = sftp.mkdir(p, 0o755) {
      eprintln!("[ssh] mkdir failed: {}", e);
      if let Ok(st) = sftp.stat(p) {
        if st.is_dir() { continue; }
      }
      // Return to non-blocking before returning error
      s.sess.set_blocking(false);
      return Err(e.to_string());
    }
  }
  // Return to non-blocking mode
  s.sess.set_blocking(false);
  Ok(())
}

#[tauri::command]
pub async fn ssh_deploy_helper(app: tauri::AppHandle, state: State<'_, crate::state::app_state::AppState>, session_id: String, remote_path: String) -> Result<(), String> {
  eprintln!("[ssh] deploy_helper session={} path={}", session_id, remote_path);
  
  // Use ssh_exec to detect OS first - it handles the locking properly
  let uname_result = ssh_exec(state.clone(), session_id.clone(), "uname -s".to_string()).await?;
  let os_name = uname_result.stdout.trim().to_lowercase();
  eprintln!("[ssh] detected OS: {}", os_name);
  
  // Choose the appropriate helper binary based on the OS
  let helper_binary = if os_name.contains("linux") {
    // Try to get Linux binary if available
    match crate::commands::helper::get_linux_helper_binary() {
      Some(linux_bin) => {
        eprintln!("[ssh] using Linux helper binary");
        linux_bin
      }
      None => {
        eprintln!("[ssh] Linux helper not available, using native binary");
        crate::commands::helper::get_helper_binary()
      }
    }
  } else {
    eprintln!("[ssh] using native helper binary for OS: {}", os_name);
    crate::commands::helper::get_helper_binary()
  };
  
  // Now open SFTP connection and deploy the binary
  let mut inner = state.inner.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  
  // Temporarily set to blocking mode for SFTP operations
  s.sess.set_blocking(true);
  let sftp = s.sess.sftp().map_err(|e| e.to_string())?;
  
  let total = helper_binary.len();
  let mut written = 0usize;
  let mut file = sftp.create(Path::new(&remote_path)).map_err(|e| {
    eprintln!("[ssh] sftp create failed: {}", e);
    // Return to non-blocking before error
    s.sess.set_blocking(false);
    e.to_string()
  })?;
  
  while written < total {
    let end = usize::min(written + 8192, total);
    let chunk = &helper_binary[written..end];
    // In blocking mode, no need for retry loop
    file.write_all(chunk).map_err(|e| {
      // Return to non-blocking before error
      s.sess.set_blocking(false);
      e.to_string()
    })?;
    written = end;
    let _ = app.emit(crate::events::SSH_UPLOAD_PROGRESS, &serde_json::json!({ "path": remote_path, "written": written, "total": total }));
    std::thread::sleep(Duration::from_millis(1));
  }
  
  // Return to non-blocking mode
  s.sess.set_blocking(false);
  
  eprintln!("[ssh] helper uploaded {} bytes", written);
  Ok(())
}

#[tauri::command]
pub async fn ssh_sftp_write(app: tauri::AppHandle, state: State<'_, crate::state::app_state::AppState>, session_id: String, remote_path: String, data_b64: String) -> Result<(), String> {
  eprintln!("[ssh] sftp_write session={} path={} size={}B", session_id, remote_path, data_b64.len());
  let mut inner = state.inner.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  
  // Temporarily set to blocking mode for SFTP operations
  s.sess.set_blocking(true);
  let sftp = s.sess.sftp().map_err(|e| e.to_string())?;
  let bytes = base64::engine::general_purpose::STANDARD.decode(data_b64).map_err(|e| e.to_string())?;
  let total = bytes.len();
  let mut written = 0usize;
  let mut file = sftp.create(Path::new(&remote_path)).map_err(|e| {
    eprintln!("[ssh] sftp create failed: {}", e);
    s.sess.set_blocking(false);
    e.to_string()
  })?;
  while written < total {
    let end = usize::min(written + 8192, total);
    let chunk = &bytes[written..end];
    // In blocking mode, no need for retry loop
    file.write_all(chunk).map_err(|e| {
      s.sess.set_blocking(false);
      e.to_string()
    })?;
    written = end;
    let _ = app.emit(crate::events::SSH_UPLOAD_PROGRESS, &serde_json::json!({ "path": remote_path, "written": written, "total": total }));
    std::thread::sleep(Duration::from_millis(1));
  }
  
  // Return to non-blocking mode
  s.sess.set_blocking(false);
  Ok(())
}

#[derive(Serialize)]
pub struct ExecResult { pub stdout: String, pub stderr: String, pub exit_code: i32 }

#[tauri::command]
pub async fn ssh_exec(state: State<'_, crate::state::app_state::AppState>, session_id: String, command: String) -> Result<ExecResult, String> {
  eprintln!("[ssh] exec session={} cmd={}", session_id, command);
  let mut inner = state.inner.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  let sess_lock = s.lock.clone();
  
  // Temporarily set to blocking mode for channel creation and exec
  s.sess.set_blocking(true);
  let mut chan = s.sess.channel_session().map_err(|e| e.to_string())?;
  // Keep stderr separate
  let _ = chan.handle_extended_data(ssh2::ExtendedData::Normal);
  // Execute command in blocking mode (no retry needed)
  chan.exec(&command).map_err(|e| format!("exec: {e}"))?;
  // Return to non-blocking mode for reading output
  s.sess.set_blocking(false);
  let mut out = Vec::new();
  let mut err = Vec::new();
  let mut stdout = chan.stream(0);
  let mut stderr = chan.stream(1);
  let mut buf_out = [0u8; 8192];
  let mut buf_err = [0u8; 4096];
  loop {
    let mut progressed = false;
    match { let _g = sess_lock.lock().unwrap(); stdout.read(&mut buf_out) } {
      Ok(0) => {}
      Ok(n) => { out.extend_from_slice(&buf_out[..n]); progressed = true; }
      Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
      Err(e) => return Err(e.to_string()),
    }
    match { let _g = sess_lock.lock().unwrap(); stderr.read(&mut buf_err) } {
      Ok(0) => {}
      Ok(n) => { err.extend_from_slice(&buf_err[..n]); progressed = true; }
      Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
      Err(e) => return Err(e.to_string()),
    }
    if chan.eof() { break; }
    if !progressed { std::thread::sleep(Duration::from_millis(10)); }
  }
  // Try to get exit status with a short retry loop
  let mut code = 0i32;
  for _ in 0..50 {
    let res = { let _g = sess_lock.lock().unwrap(); chan.exit_status() };
    match res {
      Ok(c) => { code = c; break; }
      Err(_) => std::thread::sleep(Duration::from_millis(10)),
    }
  }
  Ok(ExecResult { stdout: String::from_utf8_lossy(&out).to_string(), stderr: String::from_utf8_lossy(&err).to_string(), exit_code: code })
}

#[tauri::command]
pub async fn ssh_detect_ports(app: tauri::AppHandle, state: State<'_, crate::state::app_state::AppState>, session_id: String) -> Result<Vec<u16>, String> {
  // Get SSH session info
  let (host, port, user) = {
    let inner = state.inner.lock().map_err(|_| "lock")?;
    let session = inner.ssh.get(&session_id).ok_or("ssh session not found")?;
    (session.host.clone(), session.port, session.user.clone())
  };
  
  // Run port detection command
  let output = std::process::Command::new("ssh")
    .arg("-p")
    .arg(port.to_string())
    .arg("-o")
    .arg("StrictHostKeyChecking=no")
    .arg("-o")
    .arg("UserKnownHostsFile=/dev/null")
    .arg(format!("{}@{}", user, host))
    .arg("~/.jaterm-helper/jaterm-agent detect-ports 2>/dev/null || echo '[]'")
    .output()
    .map_err(|e| format!("Failed to run port detection: {}", e))?;
    
  let stdout = String::from_utf8_lossy(&output.stdout);
  let ports = serde_json::from_str::<Vec<u16>>(&stdout).unwrap_or_default();
  
  eprintln!("[ssh] Manual port detection found {} ports", ports.len());
  
  // Emit event with detected ports
  let _ = app.emit(
    "ssh_detected_ports",
    serde_json::json!({
      "sessionId": session_id,
      "ports": ports
    })
  );
  
  Ok(ports)
}

#[tauri::command]
pub async fn ssh_disconnect(state: State<'_, crate::state::app_state::AppState>, session_id: String) -> Result<(), String> {
  let mut inner = state.inner.lock().map_err(|_| "lock state")?;
  if let Some(s) = inner.ssh.remove(&session_id) {
    let _ = s.sess.disconnect(None, "bye", None);
  }
  Ok(())
}

#[tauri::command]
pub async fn ssh_open_forward(app: tauri::AppHandle, state: State<'_, crate::state::app_state::AppState>, session_id: String, forward: PortForward) -> Result<String, String> {
  let fid = format!("fwd_{}", nanoid::nanoid!(8));
  let mut inner = state.inner.lock().map_err(|_| "lock")?;
  
  // Get SSH session info
  let (host, port, user) = {
    let session = inner.ssh.get(&session_id).ok_or("ssh session not found")?;
    (session.host.clone(), session.port, session.user.clone())
  };
  
  let (src_host, src_port, dst_host, dst_port) = (forward.src_host.clone(), forward.src_port, forward.dst_host.clone(), forward.dst_port);
  
  match forward.r#type.as_str() {
    "L" => {
      // Use system SSH command for reliable port forwarding
      let ssh_cmd = format!(
        "ssh -N -L {}:{}:{}:{} -p {} {}@{}",
        src_host, src_port, dst_host, dst_port,
        port, user, host
      );
      
      eprintln!("[fwd] Starting SSH port forward: {}", ssh_cmd);
      
      let child = std::process::Command::new("ssh")
        .arg("-N")  // No command execution
        .arg("-L")
        .arg(format!("{}:{}:{}:{}", src_host, src_port, dst_host, dst_port))
        .arg("-p")
        .arg(port.to_string())
        .arg("-o")
        .arg("StrictHostKeyChecking=no")  // For simplicity
        .arg("-o")
        .arg("UserKnownHostsFile=/dev/null")  // For simplicity
        .arg("-o")
        .arg("ControlMaster=no")  // Don't use control master
        .arg("-o")
        .arg("ControlPath=none")
        .arg(format!("{}@{}", user, host))
        .spawn()
        .map_err(|e| format!("Failed to start SSH process: {}", e))?;
      
      eprintln!("[fwd] SSH process started with PID: {:?}", child.id());
      let _ = app.emit(crate::events::SSH_TUNNEL_STATE, &serde_json::json!({"forwardId": fid, "status":"active"}));
      
      inner.forwards.insert(
        fid.clone(),
        crate::state::app_state::SshForward {
          id: fid.clone(),
          session_id: session_id.clone(),
          ftype: crate::state::app_state::ForwardType::Local,
          src_host,
          src_port,
          dst_host,
          dst_port,
          backend: crate::state::app_state::ForwardBackend::SshProcess { child: Some(child) },
        },
      );
      
      Ok(fid)
    }
    "R" => {
      // Use system SSH for remote forwarding
      eprintln!("[fwd] Starting SSH remote forward: {}:{} -> {}:{}", 
                src_host, src_port, dst_host, dst_port);
      
      let child = std::process::Command::new("ssh")
        .arg("-N")  // No command execution
        .arg("-R")
        .arg(format!("{}:{}:{}:{}", src_host, src_port, dst_host, dst_port))
        .arg("-p")
        .arg(port.to_string())
        .arg("-o")
        .arg("StrictHostKeyChecking=no")
        .arg("-o")
        .arg("UserKnownHostsFile=/dev/null")
        .arg("-o")
        .arg("ControlMaster=no")
        .arg("-o")
        .arg("ServerAliveInterval=30")
        .arg("-o")
        .arg("ServerAliveCountMax=3")
        .arg(format!("{}@{}", user, host))
        .spawn()
        .map_err(|e| format!("Failed to start SSH process: {}", e))?;
      
      eprintln!("[fwd] SSH remote process started with PID: {:?}", child.id());
      let _ = app.emit(crate::events::SSH_TUNNEL_STATE, &serde_json::json!({"forwardId": fid, "status":"active"}));
      
      inner.forwards.insert(
        fid.clone(),
        crate::state::app_state::SshForward {
          id: fid.clone(),
          session_id: session_id.clone(),
          ftype: crate::state::app_state::ForwardType::Remote,
          src_host,
          src_port,
          dst_host,
          dst_port,
          backend: crate::state::app_state::ForwardBackend::SshProcess { child: Some(child) },
        },
      );
      
      Ok(fid)
    }
    _ => Err("unsupported forward type".into())
  }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortForward { 
    #[allow(dead_code)] pub id: Option<String>, 
    #[serde(rename="type")] pub r#type: String, 
    pub src_host: String, 
    pub src_port: u16, 
    pub dst_host: String, 
    pub dst_port: u16
}

#[tauri::command]
pub async fn ssh_close_forward(app: tauri::AppHandle, state: State<'_, crate::state::app_state::AppState>, forward_id: String) -> Result<(), String> {
  let mut inner = state.inner.lock().map_err(|_| "lock")?;
  if let Some(f) = inner.forwards.remove(&forward_id) {
    match f.backend {
      crate::state::app_state::ForwardBackend::LocalThread { shutdown, mut thread } => {
        shutdown.store(true, std::sync::atomic::Ordering::Relaxed);
        if let Some(th) = thread.take() { let _ = th.join(); }
      }
      crate::state::app_state::ForwardBackend::SshProcess { mut child } => {
        if let Some(ch) = child.as_mut() {
          let _ = ch.kill();
          let _ = ch.wait();
        }
      }
    }
    let _ = app.emit(crate::events::SSH_TUNNEL_STATE, &serde_json::json!({"forwardId": forward_id, "status":"closed"}));
  }
  Ok(())
}

#[tauri::command]
pub async fn ssh_open_shell(app: tauri::AppHandle, state: State<'_, crate::state::app_state::AppState>, session_id: String, cwd: Option<String>, cols: Option<u16>, rows: Option<u16>) -> Result<String, String> {
  // Access the session and create/configure the channel in blocking mode
  let chan = {
    let mut inner = state.inner.lock().map_err(|_| "lock")?;
    let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
    // Set to blocking for all channel setup operations
    s.sess.set_blocking(true);
    let mut chan = s.sess.channel_session().map_err(|e| format!("channel_session: {e}"))?;
    
    let term = "xterm-256color";
    let sz_cols = cols.unwrap_or(120);
    let sz_rows = rows.unwrap_or(30);
    // Request PTY with the desired initial size (in blocking mode)
    chan.request_pty(term, None, Some((sz_cols as u32, sz_rows as u32, 0, 0)))
      .map_err(|e| format!("request_pty: {e}"))?;
    // Merge STDERR into STDOUT so we don't miss prompts/messages
    let _ = chan.handle_extended_data(ssh2::ExtendedData::Merge);
    // Start the shell without echoing pre-commands. If a cwd is provided, exec a login shell after changing dir.
    if let Some(dir) = cwd {
      let esc = dir.replace("'", "'\\''");
      // Use bash -lc to change directory and exec user's login shell without printing pre-commands
      let cmd = format!("bash -lc 'cd \"{}\"; exec $SHELL -l'", esc);
      chan.exec(&cmd).map_err(|e| format!("exec(shell): {e}"))?;
    } else {
      chan.shell().map_err(|e| format!("shell: {e}"))?;
    }
    
    // Now switch back to non-blocking after all setup is done
    s.sess.set_blocking(false);
    chan
  };
  // Channel is ready; start a command-processing thread that also reads output
  let id = format!("chan_{}", nanoid::nanoid!(8));
  {
    let mut inner = state.inner.lock().map_err(|_| "lock")?;
    inner.ssh_channels.insert(
      id.clone(),
      crate::state::app_state::SshChannel { id: id.clone(), session_id: session_id.clone(), chan: std::sync::Arc::new(std::sync::Mutex::new(chan)) }
    );
  }
  // Switch the underlying session to non-blocking for better performance
  {
    let mut inner = state.inner.lock().map_err(|_| "lock")?;
    if let Some(sess) = inner.ssh.get_mut(&session_id) {
      sess.sess.set_blocking(false);
      // Also set TCP stream to non-blocking for consistency
      let _ = sess.tcp.set_nonblocking(true);
    }
  }
  let _ = app.emit(crate::events::SSH_OPENED, &serde_json::json!({"channelId": id}));
  std::thread::spawn({
    let app = app.clone();
    let sid = id.clone();
    move || {
      let mut buf = [0u8; 8192];
      loop {
        // Lock and read
        let n = {
          // Fetch channel Arc and session lock
          let inner = app.state::<crate::state::app_state::AppState>();
          let st1 = inner.inner.lock();
          if st1.is_err() { break; }
          let st = st1.unwrap();
          let ch = match st.ssh_channels.get(&sid) { Some(c) => c, None => break };
          let session_id = ch.session_id.clone();
          let arc = ch.chan.clone();
          drop(st);
          let st2 = inner.inner.lock();
          if st2.is_err() { break; }
          let st = st2.unwrap();
          let sess_lock = match st.ssh.get(&session_id) { Some(s) => s.lock.clone(), None => break };
          drop(st);
          // Serialize read with session lock
          let _g = sess_lock.lock().unwrap();
          let mut guard = arc.lock().unwrap();
          let read_result: Result<usize, std::io::Error> = guard.read(&mut buf);
          match read_result {
            Ok(0) => { eprintln!("[ssh] EOF channel {}", sid); let _ = app.emit(crate::events::SSH_EXIT, &serde_json::json!({"channelId": sid})); break; }
            Ok(n) => { eprintln!("[ssh] read {} bytes channel {}", n, sid); n },
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => { std::thread::sleep(std::time::Duration::from_millis(10)); continue; }
            Err(err) => { eprintln!("[ssh] read error channel {}: {}", sid, err); let _ = app.emit(crate::events::SSH_EXIT, &serde_json::json!({"channelId": sid})); break; }
          }
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
        let _ = app.emit(crate::events::SSH_OUTPUT, &serde_json::json!({"channelId": sid, "dataBytes": b64}));
      }
    }
  });
  Ok(id)
}

#[tauri::command]
pub async fn ssh_write(state: State<'_, crate::state::app_state::AppState>, channel_id: String, data: String) -> Result<(), String> {
  // Acquire both channel arc and session lock in a single lock operation
  let (chan_arc, sess_lock) = {
    let inner = state.inner.lock().map_err(|_| "lock")?;
    let ch = inner.ssh_channels.get(&channel_id).ok_or("channel not found")?;
    let session_id = &ch.session_id;
    let s = inner.ssh.get(session_id).ok_or("ssh session not found")?;
    (ch.chan.clone(), s.lock.clone())
  };
  
  // Try to acquire locks with timeout to avoid blocking
  let _sess_guard = match sess_lock.try_lock() {
    Ok(g) => g,
    Err(_) => {
      // If we can't get the lock immediately, wait a tiny bit and try again
      std::thread::sleep(std::time::Duration::from_micros(100));
      sess_lock.lock().map_err(|_| "sess lock")?
    }
  };
  
  let mut chan_guard = match chan_arc.try_lock() {
    Ok(g) => g,
    Err(_) => {
      // Brief retry if channel is locked
      std::thread::sleep(std::time::Duration::from_micros(100));
      chan_arc.lock().map_err(|_| "channel lock poisoned")?
    }
  };
  
  // Perform write - the channel should already be in non-blocking mode
  // Just use write_all since we're already handling locks efficiently
  chan_guard.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
  
  Ok(())
}

#[tauri::command]
pub async fn ssh_resize(state: State<'_, crate::state::app_state::AppState>, channel_id: String, cols: u16, rows: u16) -> Result<(), String> {
  // Acquire channel arc and session id
  let (session_id, chan_arc) = {
    let inner = state.inner.lock().map_err(|_| "lock")?;
    match inner.ssh_channels.get(&channel_id) {
      Some(ch) => (ch.session_id.clone(), ch.chan.clone()),
      None => return Err("channel not found".into()),
    }
  };
  // Acquire session lock separately
  let sess_lock = {
    let inner = state.inner.lock().map_err(|_| "lock")?;
    match inner.ssh.get(&session_id) { Some(s) => s.lock.clone(), None => return Err("ssh session not found".into()) }
  };
  // Perform resize under session lock
  let _g = sess_lock.lock().map_err(|_| "sess lock")?; // acquire session lock first
  let lock_res = chan_arc.lock();
  let mut guard = match lock_res { Ok(g) => g, Err(_) => return Err("channel lock poisoned".into()) };
  guard.request_pty_size(cols as u32, rows as u32, None, None).map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub async fn ssh_close_shell(state: State<'_, crate::state::app_state::AppState>, channel_id: String) -> Result<(), String> {
  // Acquire channel arc and session id without removing yet
  let (session_id, chan_arc) = {
    let inner = state.inner.lock().map_err(|_| "lock")?;
    match inner.ssh_channels.get(&channel_id) {
      Some(ch) => (ch.session_id.clone(), ch.chan.clone()),
      None => return Err("channel not found".into()),
    }
  };
  // Acquire session lock
  let sess_lock = {
    let inner = state.inner.lock().map_err(|_| "lock")?;
    match inner.ssh.get(&session_id) { Some(s) => s.lock.clone(), None => return Err("ssh session not found".into()) }
  };
  // Close channel under session lock
  {
    let _g = sess_lock.lock().map_err(|_| "sess lock")?;
    let _ = chan_arc.lock().map_err(|_| "lock chan")?.close();
  }
  // Now remove the channel from state
  {
    let mut inner = state.inner.lock().map_err(|_| "lock")?;
    let _ = inner.ssh_channels.remove(&channel_id);
  }
  Ok(())
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SshKeyInfo {
    pub path: String,
    pub name: String,
    pub key_type: String,
}

#[tauri::command]
pub async fn scan_ssh_keys() -> Result<Vec<SshKeyInfo>, String> {
    let mut keys = Vec::new();
    
    // Get the user's home directory
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Could not find home directory")?;
    
    let ssh_dir = std::path::Path::new(&home).join(".ssh");
    
    if !ssh_dir.exists() {
        return Ok(keys); // Return empty list if .ssh doesn't exist
    }
    
    // Common SSH key file patterns
    let key_patterns = vec![
        "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
        "identity", "id_rsa_*", "id_dsa_*", "id_ecdsa_*", "id_ed25519_*"
    ];
    
    // Read directory entries
    if let Ok(entries) = std::fs::read_dir(&ssh_dir) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            
            // Skip directories
            if path.is_dir() {
                continue;
            }
            
            let file_name = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            
            // Skip .pub files and known non-key files
            if file_name.ends_with(".pub") || 
               file_name == "known_hosts" || 
               file_name == "authorized_keys" ||
               file_name == "config" ||
               file_name.starts_with(".") {
                continue;
            }
            
            // Check if it matches common key patterns or has no extension
            let is_key = key_patterns.iter().any(|pattern| {
                if pattern.ends_with("*") {
                    let prefix = &pattern[..pattern.len()-1];
                    file_name.starts_with(prefix)
                } else {
                    file_name == *pattern
                }
            }) || !file_name.contains('.');
            
            if is_key {
                // Try to determine key type by reading first line
                let key_type = if let Ok(contents) = std::fs::read_to_string(&path) {
                    if contents.starts_with("-----BEGIN RSA PRIVATE KEY-----") {
                        "RSA".to_string()
                    } else if contents.starts_with("-----BEGIN DSA PRIVATE KEY-----") {
                        "DSA".to_string()
                    } else if contents.starts_with("-----BEGIN EC PRIVATE KEY-----") {
                        "ECDSA".to_string()
                    } else if contents.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----") {
                        // Could be Ed25519 or other modern key types
                        if file_name.contains("ed25519") {
                            "Ed25519".to_string()
                        } else if file_name.contains("ecdsa") {
                            "ECDSA".to_string()
                        } else if file_name.contains("rsa") {
                            "RSA".to_string()
                        } else {
                            "SSH".to_string()
                        }
                    } else if contents.starts_with("-----BEGIN PRIVATE KEY-----") {
                        "Private Key".to_string()
                    } else {
                        continue; // Not a private key file
                    }
                } else {
                    continue; // Can't read file, skip it
                };
                
                keys.push(SshKeyInfo {
                    path: path.to_string_lossy().to_string(),
                    name: file_name.to_string(),
                    key_type,
                });
            }
        }
    }
    
    // Sort by name for consistent ordering
    keys.sort_by(|a, b| a.name.cmp(&b.name));
    
    Ok(keys)
}
