use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use serde_json::Value;
use std::path::Path;

fn dir_name_from(app_name: Option<&str>) -> String {
  let from_env = std::env::var("JATERM_DIR_NAME").ok();
  let name = from_env.as_deref().or(app_name).unwrap_or("jaterm");
  if name.starts_with('.') { name.to_string() } else { format!(".{}", name) }
}

pub fn ensure_config_dir(app_name: Option<&str>) -> Result<PathBuf> {
  let home = dirs::home_dir().ok_or_else(|| anyhow!("Cannot resolve home directory"))?;
  let dir = home.join(dir_name_from(app_name));
  fs::create_dir_all(&dir)?;
  Ok(dir)
}

pub fn state_file_path(app_name: Option<&str>) -> Result<PathBuf> {
  Ok(ensure_config_dir(app_name)?.join("state.json"))
}

#[tauri::command]
pub async fn get_config_dir(app_name: Option<String>) -> Result<String, String> {
  ensure_config_dir(app_name.as_deref())
    .map_err(|e| e.to_string())
    .and_then(|p| p.to_str().map(|s| s.to_string()).ok_or_else(|| "Non-utf8 path".to_string()))
}

#[tauri::command]
pub async fn load_state(app_name: Option<String>) -> Result<Value, String> {
  let path = state_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;
  match fs::read(&path) {
    Ok(bytes) => {
      serde_json::from_slice::<Value>(&bytes).map_err(|e| e.to_string())
    }
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
pub async fn save_state(app_name: Option<String>, state: Value) -> Result<(), String> {
  let path = state_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;
  let tmp = path.with_extension("json.tmp");
  let data = serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?;
  fs::write(&tmp, data).map_err(|e| e.to_string())?;
  fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn expand_tilde(p: &str) -> Option<String> {
  if let Some(stripped) = p.strip_prefix("~") {
    if let Some(home) = dirs::home_dir() {
      let mut s = home.display().to_string();
      if !stripped.is_empty() {
        if !s.ends_with('/') { s.push('/'); }
        s.push_str(stripped.trim_start_matches('/'));
      }
      return Some(s);
    }
  }
  None
}

#[tauri::command]
pub async fn resolve_path_absolute(path: String) -> Result<String, String> {
  let mut p = path.clone();
  if path.starts_with('~') {
    if let Some(exp) = expand_tilde(&path) { p = exp; }
  }
  // if already absolute, try to canonicalize, else try joining with home
  let abs = if Path::new(&p).is_absolute() {
    std::fs::canonicalize(&p).unwrap_or_else(|_| PathBuf::from(&p))
  } else {
    let base = dirs::home_dir().ok_or_else(|| "Cannot resolve home".to_string())?;
    let joined = base.join(p);
    std::fs::canonicalize(&joined).unwrap_or(joined)
  };
  abs.to_str()
    .map(|s| s.to_string())
    .ok_or_else(|| "Non-utf8 path".to_string())
}
