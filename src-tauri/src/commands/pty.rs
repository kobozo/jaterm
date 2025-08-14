use std::io::Read;
use std::sync::Arc;
use std::thread;

use portable_pty::{CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn pty_open(
    app: AppHandle,
    state: State<'_, crate::state::app_state::AppState>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    let cols = cols.unwrap_or(120);
    let rows = rows.unwrap_or(30);

    let system = NativePtySystem::default();
    let pair: PtyPair = system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {e}"))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "windows") {
            "powershell.exe".into()
        } else {
            "/bin/zsh".into()
        }
    });

    let mut cmd = CommandBuilder::new(shell);
    if let Some(c) = cwd.clone() {
        cmd.cwd(c);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn: {e}"))?;
    drop(pair.slave);

    let id = format!("pty_{}", nanoid::nanoid!(8));
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer: {e}"))?;
    let master_for_state = pair.master; // move master into state

    {
        let mut inner = state.0.lock().map_err(|_| "lock state")?;
        inner.insert(crate::state::app_state::PtySession {
            id: id.clone(),
            master: master_for_state,
            child,
            writer: std::sync::Mutex::new(writer),
        });
    }

    // Read loop
    let app_clone = app.clone();
    let id_clone = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    let _ = app_clone.emit("PTY_EXIT", &serde_json::json!({"ptyId": id_clone}));
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit("PTY_OUTPUT", &serde_json::json!({"ptyId": id_clone, "data": data}));
                }
                Err(_) => break,
            }
        }
    });

    Ok(id)
}

#[tauri::command]
pub async fn pty_write(
    state: State<'_, crate::state::app_state::AppState>,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "lock state")?;
    if let Some(sess) = inner.get(&pty_id) {
        if let Ok(mut w) = sess.writer.lock() {
            use std::io::Write;
            w.write_all(data.as_bytes())
                .map_err(|e| format!("write: {e}"))?;
            return Ok(());
        } else {
            return Err("writer lock poisoned".into());
        }
    }
    Err("pty not found".into())
}

#[tauri::command]
pub async fn pty_resize(
    state: State<'_, crate::state::app_state::AppState>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "lock state")?;
    inner.resize(&pty_id, cols, rows);
    Ok(())
}

#[tauri::command]
pub async fn pty_kill(state: State<'_, crate::state::app_state::AppState>, pty_id: String) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "lock state")?;
    if let Some(mut sess) = inner.remove(&pty_id) {
        let _ = sess.child.kill();
    }
    Ok(())
}
