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
  let sftp = s.sess.sftp().map_err(|e| e.to_string())?;
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
  let mut inner = state.0.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  let sftp = s.sess.sftp().map_err(|e| e.to_string())?;
  let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty() && *p != ".").collect();
  let mut cur = if path.starts_with('/') { String::from("/") } else { String::new() };
  for part in parts {
    if cur != "/" && !cur.is_empty() { cur.push('/'); }
    cur.push_str(part);
    let p = Path::new(&cur);
    // If exists and is dir, continue
    if let Ok(st) = sftp.stat(p) {
      if st.is_dir() { continue; }
    }
    // Try to create; if it fails, check again if it now exists (race) else error
    if let Err(e) = sftp.mkdir(p, 0o755) {
      if let Ok(st) = sftp.stat(p) {
        if st.is_dir() { continue; }
      }
      return Err(e.to_string());
    }
  }
  Ok(())
}

#[tauri::command]
pub async fn ssh_sftp_write(app: tauri::AppHandle, state: State<'_, crate::state::app_state::AppState>, session_id: String, remote_path: String, data_b64: String) -> Result<(), String> {
  let mut inner = state.0.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  let sftp = s.sess.sftp().map_err(|e| e.to_string())?;
  let bytes = base64::engine::general_purpose::STANDARD.decode(data_b64).map_err(|e| e.to_string())?;
  let total = bytes.len();
  let mut written = 0usize;
  let mut file = sftp.create(Path::new(&remote_path)).map_err(|e| e.to_string())?;
  while written < total {
    let end = usize::min(written + 8192, total);
    let chunk = &bytes[written..end];
    file.write_all(chunk).map_err(|e| e.to_string())?;
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
  let mut inner = state.0.lock().map_err(|_| "lock")?;
  let s = inner.ssh.get_mut(&session_id).ok_or("ssh session not found")?;
  let mut chan = s.sess.channel_session().map_err(|e| e.to_string())?;
  // Keep stderr separate
  let _ = chan.handle_extended_data(ssh2::ExtendedData::Normal);
  chan.exec(&command).map_err(|e| format!("exec: {e}"))?;
  let mut out = Vec::new();
  let mut err = Vec::new();
  // Read until EOF
  {
    let mut stdout = chan.stream(0);
    let mut buf = [0u8; 8192];
    loop {
      match stdout.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => out.extend_from_slice(&buf[..n]),
        Err(e) => return Err(e.to_string()),
      }
    }
  }
  {
    let mut stderr = chan.stream(1);
    let mut buf = [0u8; 4096];
    loop {
      match stderr.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => err.extend_from_slice(&buf[..n]),
        Err(e) => return Err(e.to_string()),
      }
    }
  }
  let _ = chan.wait_close();
  let code = chan.exit_status().unwrap_or_default();
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
  chan.shell().map_err(|e| format!("shell: {e}"))?;
  if let Some(dir) = cwd {
    let cmd = format!("cd '{}'\n", dir.replace("'", "'\\''"));
    chan.write_all(cmd.as_bytes()).map_err(|e| format!("cd: {e}"))?;
    let _ = chan.flush();
  }
  // Nudge the remote shell to emit a prompt in case it's waiting
  let _ = chan.write_all(b"\n");
  let _ = chan.flush();
  // Proactively emit OSC7 with current PWD to sync cwd in UI
  let _ = chan.write_all(b"printf '\x1b]7;file://%s%s\x07' \"$(hostname)\" \"$PWD\"\n");
  let _ = chan.flush();
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
