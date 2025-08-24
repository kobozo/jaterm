use std::io::Read;
// use std::sync::Arc;
use std::thread;
use std::path::Path;
use std::fs;

use portable_pty::{CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};
use tauri::{AppHandle, Emitter, State};
use base64::Engine; // for .encode on base64 engines
use serde::Serialize;

#[derive(Serialize)]
pub struct ShellInfo {
    pub path: String,
    pub name: String,
}

#[tauri::command]
pub async fn get_available_shells() -> Result<Vec<ShellInfo>, String> {
    let mut shells = Vec::new();
    
    #[cfg(unix)]
    {
        // Read /etc/shells on Unix-like systems
        if let Ok(contents) = fs::read_to_string("/etc/shells") {
            for line in contents.lines() {
                let line = line.trim();
                // Skip comments and empty lines
                if line.starts_with('#') || line.is_empty() {
                    continue;
                }
                
                // Check if the shell actually exists
                if Path::new(line).exists() {
                    let name = Path::new(line)
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or(line)
                        .to_string();
                    
                    shells.push(ShellInfo {
                        path: line.to_string(),
                        name: format!("{} ({})", friendly_shell_name(&name), line),
                    });
                }
            }
        }
        
        // Check for additional common shells not in /etc/shells
        let additional_shells = [
            ("/usr/local/bin/fish", "fish"),
            ("/opt/homebrew/bin/fish", "fish"),
            ("/usr/bin/fish", "fish"),
            ("/usr/local/bin/nu", "nu"),
            ("/opt/homebrew/bin/nu", "nu"),
        ];
        
        for (path, name) in additional_shells {
            if Path::new(path).exists() && !shells.iter().any(|s| s.path == path) {
                shells.push(ShellInfo {
                    path: path.to_string(),
                    name: format!("{} ({})", friendly_shell_name(name), path),
                });
            }
        }
    }
    
    #[cfg(windows)]
    {
        // Common Windows shells
        let windows_shells = [
            ("powershell.exe", "PowerShell"),
            ("pwsh.exe", "PowerShell Core"),
            ("cmd.exe", "Command Prompt"),
            (r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe", "PowerShell"),
            (r"C:\Program Files\PowerShell\7\pwsh.exe", "PowerShell 7"),
            (r"C:\Windows\System32\cmd.exe", "Command Prompt"),
            (r"C:\Program Files\Git\bin\bash.exe", "Git Bash"),
            (r"C:\Windows\System32\bash.exe", "WSL Bash"),
        ];
        
        for (path, name) in windows_shells {
            // Check both by path and in PATH
            if Path::new(path).exists() || which::which(path).is_ok() {
                shells.push(ShellInfo {
                    path: path.to_string(),
                    name: format!("{} ({})", name, path),
                });
            }
        }
    }
    
    // Sort shells by name for consistent ordering
    shells.sort_by(|a, b| a.name.cmp(&b.name));
    
    Ok(shells)
}

fn friendly_shell_name(shell: &str) -> &str {
    match shell {
        "bash" => "Bash",
        "zsh" => "Zsh", 
        "fish" => "Fish",
        "sh" => "Sh",
        "dash" => "Dash",
        "ksh" => "Ksh",
        "tcsh" => "Tcsh",
        "csh" => "Csh",
        "pwsh" | "pwsh-preview" => "PowerShell",
        "nu" => "Nushell",
        _ => shell,
    }
}

#[tauri::command]
pub async fn pty_open(
    app: AppHandle,
    state: State<'_, crate::state::app_state::AppState>,
    cwd: Option<String>,
    shell: Option<String>,
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

    let shell = shell.unwrap_or_else(|| {
        std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "windows") {
                "powershell.exe".into()
            } else {
                "/bin/zsh".into()
            }
        })
    });

    let mut cmd = CommandBuilder::new(shell.clone());
    // On macOS, start the shell as a login shell so that
    // user PATH customizations (e.g., Homebrew/Node via .zprofile)
    // are applied. This mirrors how Terminal.app/iTerm launch shells.
    #[cfg(target_os = "macos")]
    {
        let shell_name = Path::new(&shell)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        match shell_name {
            // zsh and bash accept -l for login shell
            "zsh" | "bash" => {
                cmd.arg("-l");
            }
            // fish also supports -l/--login
            "fish" => {
                cmd.arg("-l");
            }
            _ => {}
        }
    }
    if let Some(c) = cwd.clone() {
        cmd.cwd(c);
    }
    // Ensure reasonable terminal env for colors and width-sensitive tools
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

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
        let mut inner = state.inner.lock().map_err(|_| "lock state")?;
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
                    let _ = app_clone.emit(crate::events::PTY_EXIT, &serde_json::json!({"ptyId": id_clone}));
                    break;
                }
                Ok(n) => {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app_clone.emit(
                        crate::events::PTY_OUTPUT,
                        &serde_json::json!({"ptyId": id_clone, "dataBytes": b64}),
                    );
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
    let mut inner = state.inner.lock().map_err(|_| "lock state")?;
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
    let mut inner = state.inner.lock().map_err(|_| "lock state")?;
    inner.resize(&pty_id, cols, rows);
    Ok(())
}

#[tauri::command]
pub async fn pty_kill(state: State<'_, crate::state::app_state::AppState>, pty_id: String) -> Result<(), String> {
    let mut inner = state.inner.lock().map_err(|_| "lock state")?;
    if let Some(mut sess) = inner.remove(&pty_id) {
        let _ = sess.child.kill();
    }
    Ok(())
}
