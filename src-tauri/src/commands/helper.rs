use serde::Serialize;
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

// Include the generated helper module from build.rs
include!(concat!(env!("OUT_DIR"), "/helper_generated.rs"));

#[derive(Serialize)]
pub struct HelperStatus { pub ok: bool, pub version: Option<String>, pub path: Option<String> }

fn local_helper_path() -> Result<PathBuf, String> {
  let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
  let dir = home.join(HELPER_REL_DIR);
  Ok(dir.join(HELPER_NAME))
}

#[tauri::command]
pub async fn helper_local_ensure() -> Result<HelperStatus, String> {
  let path = local_helper_path()?;
  // If exists and reports healthy with matching version, return
  if path.exists() {
    if let Ok(res) = helper_local_exec_internal(&path, &["health"]) {
      if res.exit_code == 0 {
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&res.stdout) {
          if j.get("ok").and_then(|v| v.as_bool()).unwrap_or(false)
            && j.get("version").and_then(|v| v.as_str()) == Some(HELPER_VERSION)
          {
            return Ok(HelperStatus { ok: true, version: Some(HELPER_VERSION.to_string()), path: Some(path.to_string_lossy().to_string()) });
          }
        }
      }
    }
  }
  // (Re)install
  if let Some(dir) = path.parent() { fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
  {
    let mut f = fs::File::create(&path).map_err(|e| e.to_string())?;
    f.write_all(HELPER_CONTENT.as_bytes()).map_err(|e| e.to_string())?;
  }
  let mut perms = fs::metadata(&path).map_err(|e| e.to_string())?.permissions();
  perms.set_mode(0o755);
  fs::set_permissions(&path, perms).map_err(|e| e.to_string())?;

  // Verify health
  let res = helper_local_exec_internal(&path, &["health"]).map_err(|e| e)?;
  if res.exit_code != 0 { return Ok(HelperStatus { ok: false, version: None, path: Some(path.to_string_lossy().to_string()) }); }
  let ver = serde_json::from_str::<serde_json::Value>(&res.stdout)
    .ok()
    .and_then(|j| j.get("version").and_then(|v| v.as_str()).map(|s| s.to_string()));
  Ok(HelperStatus { ok: true, version: ver.or_else(|| Some(HELPER_VERSION.to_string())), path: Some(path.to_string_lossy().to_string()) })
}

#[derive(Serialize)]
pub struct ExecResult { pub stdout: String, pub stderr: String, pub exit_code: i32 }

fn helper_local_exec_internal(path: &std::path::Path, args: &[&str]) -> Result<ExecResult, String> {
  use std::process::Command;
  let output = Command::new(path)
    .args(args)
    .output()
    .map_err(|e| e.to_string())?;
  Ok(ExecResult {
    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    exit_code: output.status.code().unwrap_or(-1),
  })
}

#[tauri::command]
pub async fn helper_local_exec(command: String, args: Option<Vec<String>>) -> Result<ExecResult, String> {
  let path = local_helper_path()?;
  if !path.exists() { return Err("helper not installed".into()); }
  let mut all = Vec::new();
  all.push(command);
  if let Some(rest) = args { for a in rest { all.push(a); } }
  let refs: Vec<&str> = all.iter().map(|s| s.as_str()).collect();
  helper_local_exec_internal(&path, &refs)
}
