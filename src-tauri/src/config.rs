use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use serde_json::Value;

fn dir_name_from(app_name: Option<&str>) -> String {
    let from_env = std::env::var("JATERM_DIR_NAME").ok();
    let name = from_env.as_deref().or(app_name).unwrap_or("jaterm");
    if name.starts_with('.') {
        name.to_string()
    } else {
        format!(".{}", name)
    }
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
pub fn profiles_file_path(app_name: Option<&str>) -> Result<PathBuf> {
    Ok(ensure_config_dir(app_name)?.join("profiles.json"))
}
pub fn config_file_path(app_name: Option<&str>) -> Result<PathBuf> {
    Ok(ensure_config_dir(app_name)?.join("config.json"))
}

fn json_write_atomic(path: &Path, value: &Value) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_vec_pretty(value)?;
    fs::write(&tmp, data)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn json_read_or_empty(path: &Path) -> Result<Value> {
    match fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice::<Value>(&bytes)?),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(e.into()),
    }
}

const CURRENT_SCHEMA_VERSION: u32 = 1;

fn get_schema_version(cfg: &Value) -> u32 {
    cfg.get("schemaVersion")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .unwrap_or(0)
}

fn set_schema_version(cfg: &mut Value, v: u32) {
    match cfg {
        Value::Object(map) => {
            map.insert("schemaVersion".to_string(), Value::from(v));
        }
        _ => {
            let mut m = serde_json::Map::new();
            m.insert("schemaVersion".to_string(), Value::from(v));
            *cfg = Value::Object(m);
        }
    }
}

fn read_config_value(app_name: Option<&str>) -> Result<Value> {
    let path = config_file_path(app_name)?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    json_read_or_empty(&path)
}

fn write_config_value(app_name: Option<&str>, value: &Value) -> Result<()> {
    let path = config_file_path(app_name)?;
    json_write_atomic(&path, value)
}

fn migration_1_split_files(app_name: Option<&str>) -> Result<()> {
    let legacy_path = state_file_path(app_name)?;
    let profiles_path = profiles_file_path(app_name)?;
    let new_state_path = state_file_path(app_name)?; // reuse filename; semantics change
    let config_path = config_file_path(app_name)?;

    // If already migrated (profiles.json exists), ensure config exists
    if profiles_path.exists() {
        if !config_path.exists() {
            json_write_atomic(&config_path, &serde_json::json!({}))?;
        }
        if !new_state_path.exists() {
            json_write_atomic(&new_state_path, &serde_json::json!({}))?;
        }
        return Ok(());
    }

    // No legacy file: initialize empty files
    if !legacy_path.exists() {
        if !profiles_path.exists() {
            json_write_atomic(&profiles_path, &serde_json::json!({}))?;
        }
        if !config_path.exists() {
            json_write_atomic(&config_path, &serde_json::json!({}))?;
        }
        if !new_state_path.exists() {
            json_write_atomic(&new_state_path, &serde_json::json!({}))?;
        }
        return Ok(());
    }

    // Split legacy content
    let legacy = json_read_or_empty(&legacy_path)?;
    let mut legacy_obj = legacy.as_object().cloned().unwrap_or_default();

    let profiles_val = {
        let mut m = serde_json::Map::new();
        if let Some(v) = legacy_obj.remove("profiles") {
            m.insert("profiles".to_string(), v);
        }
        if let Some(v) = legacy_obj.remove("profilesTree") {
            m.insert("profilesTree".to_string(), v);
        }
        Value::Object(m)
    };

    let state_val = {
        let mut m = serde_json::Map::new();
        for k in [
            "recents",
            "recentSessions",
            "recentSshSessions",
            "lastOpenedPath",
            "workspace",
        ] {
            if let Some(v) = legacy_obj.remove(k) {
                m.insert(k.to_string(), v);
            }
        }
        Value::Object(m)
    };

    // Merge any unknown keys back into state to avoid data loss
    if let Value::Object(mut s_obj) = state_val.clone() {
        for (k, v) in legacy_obj.into_iter() {
            s_obj.insert(k, v);
        }
        let merged_state = Value::Object(s_obj);
        json_write_atomic(&profiles_path, &profiles_val)?;
        json_write_atomic(&new_state_path, &merged_state)?;
    } else {
        json_write_atomic(&profiles_path, &profiles_val)?;
        json_write_atomic(&new_state_path, &state_val)?;
    }

    if !config_path.exists() {
        json_write_atomic(&config_path, &serde_json::json!({}))?;
    }
    Ok(())
}

fn ensure_migrations(app_name: Option<&str>) -> Result<()> {
    ensure_config_dir(app_name)?; // make sure the directory exists
                                  // Detect version from config.json, default 0
    let mut cfg = read_config_value(app_name)?;
    let mut version = get_schema_version(&cfg);

    // Heuristic: if profiles.json exists but version is 0, bump to 1 later
    // by running migration 1 (which is idempotent) and then setting version
    while version < CURRENT_SCHEMA_VERSION {
        let next = version + 1;
        match next {
            1 => migration_1_split_files(app_name)?,
            _ => {}
        }
        version = next;
        set_schema_version(&mut cfg, version);
        write_config_value(app_name, &cfg)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_config_dir(app_name: Option<String>) -> Result<String, String> {
    ensure_config_dir(app_name.as_deref())
        .map_err(|e| e.to_string())
        .and_then(|p| {
            p.to_str()
                .map(|s| s.to_string())
                .ok_or_else(|| "Non-utf8 path".to_string())
        })
}

#[tauri::command]
pub async fn load_state(app_name: Option<String>) -> Result<Value, String> {
    ensure_migrations(app_name.as_deref()).map_err(|e| e.to_string())?;
    let path = state_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;
    json_read_or_empty(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_state(app_name: Option<String>, state: Value) -> Result<(), String> {
    ensure_migrations(app_name.as_deref()).map_err(|e| e.to_string())?;
    let path = state_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;
    json_write_atomic(&path, &state).map_err(|e| e.to_string())
}

fn expand_tilde(p: &str) -> Option<String> {
    if let Some(stripped) = p.strip_prefix("~") {
        if let Some(home) = dirs::home_dir() {
            let mut s = home.display().to_string();
            if !stripped.is_empty() {
                if !s.ends_with('/') {
                    s.push('/');
                }
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
        if let Some(exp) = expand_tilde(&path) {
            p = exp;
        }
    }
    // if already absolute, try to canonicalize, else try joining with home
    let abs = if Path::new(&p).is_absolute() {
        match std::fs::canonicalize(&p) {
            Ok(c) => c,
            Err(_) => {
                // Fallback: some shells might emit a path relative to home but prefixed with a slash (e.g., /Kobozo)
                if let Some(home) = dirs::home_dir() {
                    let home_str = home.to_string_lossy().to_string();
                    if !p.starts_with(&home_str) {
                        let candidate = home.join(p.trim_start_matches('/'));
                        if candidate.exists() {
                            std::fs::canonicalize(&candidate).unwrap_or(candidate)
                        } else {
                            PathBuf::from(&p)
                        }
                    } else {
                        PathBuf::from(&p)
                    }
                } else {
                    PathBuf::from(&p)
                }
            }
        }
    } else {
        let base = dirs::home_dir().ok_or_else(|| "Cannot resolve home".to_string())?;
        let joined = base.join(p);
        std::fs::canonicalize(&joined).unwrap_or(joined)
    };
    abs.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Non-utf8 path".to_string())
}

#[tauri::command]
pub async fn open_path_system(path: Option<String>) -> Result<(), String> {
    let target = if let Some(p) = path {
        PathBuf::from(p)
    } else {
        ensure_config_dir(None).map_err(|e| e.to_string())?
    };
    if !target.exists() {
        return Err("Path does not exist".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// New: profiles and config load/save
#[tauri::command]
pub async fn load_profiles(app_name: Option<String>) -> Result<Value, String> {
    ensure_migrations(app_name.as_deref()).map_err(|e| e.to_string())?;
    let path = profiles_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;
    json_read_or_empty(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_profiles(app_name: Option<String>, profiles: Value) -> Result<(), String> {
    ensure_migrations(app_name.as_deref()).map_err(|e| e.to_string())?;
    let path = profiles_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;
    json_write_atomic(&path, &profiles).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_config(app_name: Option<String>) -> Result<Value, String> {
    ensure_migrations(app_name.as_deref()).map_err(|e| e.to_string())?;
    let path = config_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;
    json_read_or_empty(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_config(app_name: Option<String>, config: Value) -> Result<(), String> {
    ensure_migrations(app_name.as_deref()).map_err(|e| e.to_string())?;
    let path = config_file_path(app_name.as_deref()).map_err(|e| e.to_string())?;
    json_write_atomic(&path, &config).map_err(|e| e.to_string())
}
