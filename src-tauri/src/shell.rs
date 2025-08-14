use std::fs;
use std::path::PathBuf;

use anyhow::{anyhow, Context, Result};

fn zshrc_path() -> Result<PathBuf> {
  // Respect ZDOTDIR if set, else use home
  if let Ok(zdotdir) = std::env::var("ZDOTDIR") {
    let p = PathBuf::from(zdotdir).join(".zshrc");
    return Ok(p);
  }
  let home = dirs::home_dir().ok_or_else(|| anyhow!("Cannot resolve home directory"))?;
  Ok(home.join(".zshrc"))
}

fn snippet() -> &'static str {
  r#"
# >>> jaterm cwd tracking >>>
autoload -Uz add-zsh-hook
function _jaterm_osc7_precmd() { print -Pn '\e]7;file://%m%d\e\\' }
function _jaterm_osc7_chpwd()  { print -Pn '\e]7;file://%m%d\e\\' }
add-zsh-hook precmd _jaterm_osc7_precmd
add-zsh-hook chpwd  _jaterm_osc7_chpwd
# <<< jaterm cwd tracking <<<
"#
}

#[tauri::command]
pub async fn install_zsh_osc7() -> Result<bool, String> {
  (|| -> Result<bool> {
    let path = zshrc_path()?;
    let existing = fs::read_to_string(&path).unwrap_or_default();
    if existing.contains("jaterm cwd tracking") {
      return Ok(false);
    }
    // Make a backup alongside
    let backup = path.with_extension("zshrc.jaterm.bak");
    if path.exists() {
      fs::copy(&path, &backup).with_context(|| format!("backup {}", backup.display()))?;
    } else {
      // ensure parent exists
      if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
    }
    let new_content = if existing.is_empty() {
      snippet().to_string()
    } else {
      format!("{}\n{}\n", existing.trim_end(), snippet())
    };
    fs::write(&path, new_content).with_context(|| format!("write {}", path.display()))?;
    Ok(true)
  })()
  .map_err(|e| e.to_string())
}
