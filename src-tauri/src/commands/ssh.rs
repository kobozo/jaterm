use std::io::{Read, Write};
use std::net::TcpStream;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;
use base64::Engine;
use serde::Serialize;

#[derive(serde::Deserialize)]
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
pub struct SshProfile {
  pub host: String,
  #[serde(default = "default_port")] pub port: u16,
  pub user: String,
  #[serde(default)] pub auth: Option<SshAuth>,
  #[serde(default)] pub timeout_ms: Option<u64>,
}

fn default_port() -> u16 { 22 }

#[tauri::command]
pub async fn ssh_connect(state: State<'_, crate::state::app_state::AppState>, profile: SshProfile) -> Result<String, String> {
  let addr = format!("{}:{}", profile.host, profile.port);
  let tcp = TcpStream::connect(&addr).map_err(|e| format!("tcp connect: {e}"))?;
  tcp.set_read_timeout(profile.timeout_ms.map(|ms| std::time::Duration::from_millis(ms))).ok();
  tcp.set_write_timeout(profile.timeout_ms.map(|ms| std::time::Duration::from_millis(ms))).ok();
  let mut sess = ssh2::Session::new().map_err(|e| format!("session: {e}"))?;
  sess.set_tcp_stream(tcp.try_clone().map_err(|e| e.to_string())?);
  sess.handshake().map_err(|e| format!("handshake: {e}"))?;
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
  let id = format!("ssh_{}", nanoid::nanoid!(8));
  {
    let mut inner = state.0.lock().map_err(|_| "lock state")?;
    inner.ssh.insert(id.clone(), crate::state::app_state::SshSession { id: id.clone(), tcp, sess });
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
  let mut chan = loop { match s.sess.channel_session() { Ok(c) => break c, Err(e) => { if matches!(e.code(), ssh2::ErrorCode::Session(code) if code == -37) { std::thread::sleep(Duration::from_millis(10)); continue; } else { return Err(e.to_string()); } } } };
  // Keep stderr separate
  let _ = chan.handle_extended_data(ssh2::ExtendedData::Normal);
  // Try exec with retry on WouldBlock
  {
    let mut attempts = 0;
    loop {
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
    match stdout.read(&mut buf_out) {
      Ok(0) => {}
      Ok(n) => { out.extend_from_slice(&buf_out[..n]); progressed = true; }
      Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
      Err(e) => return Err(e.to_string()),
    }
    match stderr.read(&mut buf_err) {
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
    match chan.exit_status() {
      Ok(c) => { code = c; break; }
      Err(_) => std::thread::sleep(Duration::from_millis(10)),
    }
  }
  Ok(ExecResult { stdout: String::from_utf8_lossy(&out).to_string(), stderr: String::from_utf8_lossy(&err).to_string(), exit_code: code })
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
pub async fn ssh_open_tunnel(_opts: serde_json::Value) -> Result<String, String> {
  // TODO: implement local/remote/reverse forwarders
  Ok("ssh_tunnel_stub".into())
}

#[tauri::command]
pub async fn ssh_close_tunnel(_id: String) -> Result<(), String> {
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
          let inner = app.state::<crate::state::app_state::AppState>();
          let mut st = inner.0.lock().unwrap();
          let ch = st.ssh_channels.get_mut(&sid);
          if ch.is_none() { break; }
          let arc = ch.unwrap().chan.clone();
          drop(st);
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
  let mut inner = state.0.lock().map_err(|_| "lock")?;
  if let Some(ch) = inner.ssh_channels.get_mut(&channel_id) {
    if let Ok(mut guard) = ch.chan.lock() {
      guard.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
      return Ok(());
    }
    Err("channel lock poisoned".into())
  } else {
    Err("channel not found".into())
  }
}

#[tauri::command]
pub async fn ssh_resize(state: State<'_, crate::state::app_state::AppState>, channel_id: String, cols: u16, rows: u16) -> Result<(), String> {
  let mut inner = state.0.lock().map_err(|_| "lock")?;
  if let Some(ch) = inner.ssh_channels.get_mut(&channel_id) {
    if let Ok(mut guard) = ch.chan.lock() {
      guard.request_pty_size(cols as u32, rows as u32, None, None).map_err(|e| e.to_string())?;
      return Ok(());
    }
    Err("channel lock poisoned".into())
  } else {
    Err("channel not found".into())
  }
}

#[tauri::command]
pub async fn ssh_close_shell(state: State<'_, crate::state::app_state::AppState>, channel_id: String) -> Result<(), String> {
  let mut inner = state.0.lock().map_err(|_| "lock")?;
  if let Some(ch) = inner.ssh_channels.remove(&channel_id) {
    let _ = ch.chan.lock().map_err(|_| "lock chan")?.close();
    Ok(())
  } else {
    Err("channel not found".into())
  }
}
