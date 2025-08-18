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
  #[serde(default)] pub timeout_ms: Option<u64>,
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
            eprintln!("[ssh] known_hosts: host not found for {} (continuing)", hostport);
          }
          ssh2::CheckResult::Mismatch => {
            return Err(format!("known_hosts mismatch for {}", hostport));
          }
          ssh2::CheckResult::Failure => {
            eprintln!("[ssh] known_hosts: check failure for {} (continuing)", hostport);
          }
        }
      }
    }
  }
  // Auth
  if let Some(auth) = &profile.auth {
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
  
  // Ensure blocking mode is set initially
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
    let mut inner = state.0.lock().map_err(|_| "lock state")?;
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
  let mut inner = state.0.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  let sftp = s.sess.sftp().map_err(|e| e.to_string())?;
  let path = sftp.realpath(Path::new(".")).map_err(|e| e.to_string())?;
  path.to_str().map(|s| s.to_string()).ok_or_else(|| "non-utf8 path".to_string())
}

#[derive(Serialize)]
pub struct SftpEntry { pub name: String, pub path: String, pub is_dir: bool }

use std::path::Path;
use std::time::Duration;

#[tauri::command]
pub async fn ssh_sftp_list(state: State<'_, crate::state::app_state::AppState>, session_id: String, path: String) -> Result<Vec<SftpEntry>, String> {
  let mut inner = state.0.lock().map_err(|_| "lock")?;
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
  let entries = sftp.readdir(Path::new(&path)).map_err(|e| e.to_string())?;
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
pub async fn ssh_sftp_mkdirs(state: State<'_, crate::state::app_state::AppState>, session_id: String, path: String) -> Result<(), String> {
  eprintln!("[ssh] mkdirs session={} path={}", session_id, path);
  let mut inner = state.0.lock().map_err(|_| "lock")?;
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
  let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty() && *p != ".").collect();
  let mut cur = if path.starts_with('/') { String::from("/") } else { String::new() };
  for part in parts {
    if cur != "/" && !cur.is_empty() { cur.push('/'); }
    cur.push_str(part);
    let p = Path::new(&cur);
    // If exists and is dir, continue
    if let Ok(st) = loop { match sftp.stat(p) { Ok(st) => break Ok(st), Err(e) => { if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; } else { break Err(e);} } } } {
      if st.is_dir() { continue; }
    }
    // Try to create; if it fails, check again if it now exists (race) else error
    if let Err(e) = loop { match sftp.mkdir(p, 0o755) { Ok(_) => break Ok(()), Err(e) => { if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; } else { break Err(e);} } } } {
      eprintln!("[ssh] mkdir failed: {}", e);
      if let Ok(st) = loop { match sftp.stat(p) { Ok(st) => break Ok(st), Err(e2) => { if matches!(e2.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; } else { break Err(e2);} } } } {
        if st.is_dir() { continue; }
      }
      return Err(e.to_string());
    }
  }
  Ok(())
}

#[tauri::command]
pub async fn ssh_sftp_write(app: tauri::AppHandle, state: State<'_, crate::state::app_state::AppState>, session_id: String, remote_path: String, data_b64: String) -> Result<(), String> {
  eprintln!("[ssh] sftp_write session={} path={} size={}B", session_id, remote_path, data_b64.len());
  let mut inner = state.0.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  let sftp = loop { match s.sess.sftp() { Ok(h) => break h, Err(e) => { if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; } else { return Err(e.to_string()); } } } };
  let bytes = base64::engine::general_purpose::STANDARD.decode(data_b64).map_err(|e| e.to_string())?;
  let total = bytes.len();
  let mut written = 0usize;
  let mut file = loop { match sftp.create(Path::new(&remote_path)) { Ok(f) => break f, Err(e) => { eprintln!("[ssh] sftp create failed: {}", e); if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; } else { return Err(e.to_string()); } } } };
  while written < total {
    let end = usize::min(written + 8192, total);
    let chunk = &bytes[written..end];
    loop {
      match file.write_all(chunk) {
        Ok(_) => break,
        Err(e) => {
          if e.kind() == std::io::ErrorKind::WouldBlock { std::thread::sleep(Duration::from_millis(10)); continue; }
          else { return Err(e.to_string()); }
        }
      }
    }
    written = end;
    let _ = app.emit(crate::events::SSH_UPLOAD_PROGRESS, &serde_json::json!({ "path": remote_path, "written": written, "total": total }));
    std::thread::sleep(Duration::from_millis(1));
  }
  Ok(())
}

#[derive(Serialize)]
pub struct ExecResult { pub stdout: String, pub stderr: String, pub exit_code: i32 }

#[tauri::command]
pub async fn ssh_exec(state: State<'_, crate::state::app_state::AppState>, session_id: String, command: String) -> Result<ExecResult, String> {
  eprintln!("[ssh] exec session={} cmd={}", session_id, command);
  let mut inner = state.0.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  let sess_lock = s.lock.clone();
  let mut chan = loop {
    let _g = sess_lock.lock().unwrap();
    match s.sess.channel_session() {
      Ok(c) => break c,
      Err(e) => {
        if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) {
          std::thread::sleep(Duration::from_millis(10));
          continue;
        } else { return Err(e.to_string()); }
      }
    }
  };
  // Keep stderr separate
  let _ = chan.handle_extended_data(ssh2::ExtendedData::Normal);
  // Try exec with retry on WouldBlock
  {
    let mut attempts = 0;
    loop {
      let _g = sess_lock.lock().unwrap();
      match chan.exec(&command) {
        Ok(_) => break,
        Err(e) => {
          if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) && attempts < 50 {
            std::thread::sleep(Duration::from_millis(10));
            attempts += 1;
            continue;
          }
          return Err(format!("exec: {e}"));
        }
      }
    }
  }
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
    let inner = state.0.lock().map_err(|_| "lock")?;
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
  let mut inner = state.0.lock().map_err(|_| "lock state")?;
  if let Some(s) = inner.ssh.remove(&session_id) {
    let _ = s.sess.disconnect(None, "bye", None);
  }
  Ok(())
}

#[tauri::command]
pub async fn ssh_open_forward(app: tauri::AppHandle, state: State<'_, crate::state::app_state::AppState>, session_id: String, forward: PortForward) -> Result<String, String> {
  let fid = format!("fwd_{}", nanoid::nanoid!(8));
  let mut inner = state.0.lock().map_err(|_| "lock")?;
  
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
    pub id: Option<String>, 
    #[serde(rename="type")] pub r#type: String, 
    pub src_host: String, 
    pub src_port: u16, 
    pub dst_host: String, 
    pub dst_port: u16
}

#[tauri::command]
pub async fn ssh_close_forward(app: tauri::AppHandle, state: State<'_, crate::state::app_state::AppState>, forward_id: String) -> Result<(), String> {
  let mut inner = state.0.lock().map_err(|_| "lock")?;
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
  // Access the session and create the channel (blocking)
  let mut chan = {
    let mut inner = state.0.lock().map_err(|_| "lock")?;
    let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
    s.sess.channel_session().map_err(|e| format!("channel_session: {e}"))?
  };
  let term = "xterm-256color";
  let sz_cols = cols.unwrap_or(120);
  let sz_rows = rows.unwrap_or(30);
  // Request PTY with the desired initial size
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
  // Channel is ready; start a command-processing thread that also reads output
  let id = format!("chan_{}", nanoid::nanoid!(8));
  {
    let mut inner = state.0.lock().map_err(|_| "lock")?;
    inner.ssh_channels.insert(
      id.clone(),
      crate::state::app_state::SshChannel { id: id.clone(), session_id: session_id.clone(), chan: std::sync::Arc::new(std::sync::Mutex::new(chan)) }
    );
  }
  // Switch the underlying session to non-blocking so reads return WouldBlock
  {
    let mut inner = state.0.lock().map_err(|_| "lock")?;
    if let Some(sess) = inner.ssh.get_mut(&session_id) {
      let _ = sess.sess.set_blocking(false);
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
          let st1 = inner.0.lock();
          if st1.is_err() { break; }
          let st = st1.unwrap();
          let ch = match st.ssh_channels.get(&sid) { Some(c) => c, None => break };
          let session_id = ch.session_id.clone();
          let arc = ch.chan.clone();
          drop(st);
          let st2 = inner.0.lock();
          if st2.is_err() { break; }
          let st = st2.unwrap();
          let sess_lock = match st.ssh.get(&session_id) { Some(s) => s.lock.clone(), None => break };
          drop(st);
          // Serialize read with session lock
          let _g = sess_lock.lock().unwrap();
          let mut guard = arc.lock().unwrap();
          match guard.read(&mut buf) {
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
  // Acquire channel arc and session id
  let (session_id, chan_arc) = {
    let inner = state.0.lock().map_err(|_| "lock")?;
    let st = inner;
    match st.ssh_channels.get(&channel_id) {
      Some(ch) => (ch.session_id.clone(), ch.chan.clone()),
      None => return Err("channel not found".into()),
    }
  };
  // Acquire session lock separately
  let sess_lock = {
    let inner = state.0.lock().map_err(|_| "lock")?;
    match inner.ssh.get(&session_id) { Some(s) => s.lock.clone(), None => return Err("ssh session not found".into()) }
  };
  // Perform write under session lock
  let _g = sess_lock.lock().map_err(|_| "sess lock")?; // acquire session lock first
  let lock_res = chan_arc.lock();
  let mut guard = match lock_res { Ok(g) => g, Err(_) => return Err("channel lock poisoned".into()) };
  guard.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub async fn ssh_resize(state: State<'_, crate::state::app_state::AppState>, channel_id: String, cols: u16, rows: u16) -> Result<(), String> {
  // Acquire channel arc and session id
  let (session_id, chan_arc) = {
    let inner = state.0.lock().map_err(|_| "lock")?;
    match inner.ssh_channels.get(&channel_id) {
      Some(ch) => (ch.session_id.clone(), ch.chan.clone()),
      None => return Err("channel not found".into()),
    }
  };
  // Acquire session lock separately
  let sess_lock = {
    let inner = state.0.lock().map_err(|_| "lock")?;
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
    let inner = state.0.lock().map_err(|_| "lock")?;
    match inner.ssh_channels.get(&channel_id) {
      Some(ch) => (ch.session_id.clone(), ch.chan.clone()),
      None => return Err("channel not found".into()),
    }
  };
  // Acquire session lock
  let sess_lock = {
    let inner = state.0.lock().map_err(|_| "lock")?;
    match inner.ssh.get(&session_id) { Some(s) => s.lock.clone(), None => return Err("ssh session not found".into()) }
  };
  // Close channel under session lock
  {
    let _g = sess_lock.lock().map_err(|_| "sess lock")?;
    let _ = chan_arc.lock().map_err(|_| "lock chan")?.close();
  }
  // Now remove the channel from state
  {
    let mut inner = state.0.lock().map_err(|_| "lock")?;
    let _ = inner.ssh_channels.remove(&channel_id);
  }
  Ok(())
}
