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

fn bash_snippet() -> &'static str {
  r#"
# >>> jaterm cwd tracking >>>
__jaterm_osc7() { printf '\033]7;file://%s%s\007' "$(hostname)" "$PWD"; }
case ":$PROMPT_COMMAND:" in
  *:"__jaterm_osc7":*) ;;
  *) PROMPT_COMMAND="__jaterm_osc7;${PROMPT_COMMAND}";;
esac
# <<< jaterm cwd tracking <<<
"#
}

fn fish_snippet() -> &'static str {
  r#"
# >>> jaterm cwd tracking >>>
function __jaterm_osc7 --on-event fish_prompt
  printf '\e]7;file://%s%s\e\\' (hostname) $PWD
end
# <<< jaterm cwd tracking <<<
"#
}

#[tauri::command]
pub async fn install_bash_osc7() -> Result<bool, String> {
  (|| -> Result<bool> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("no home"))?;
    // Choose bashrc or bash_profile
    let candidates = [home.join(".bashrc"), home.join(".bash_profile")];
    let path = candidates.iter().find(|p| p.exists()).cloned().unwrap_or(candidates[0].clone());
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let block = bash_snippet();
    if existing.contains("jaterm cwd tracking") {
      // replace block
      let start = existing.find("# >>> jaterm cwd tracking >>>");
      let end = existing.find("# <<< jaterm cwd tracking <<<");
      if let (Some(s), Some(e)) = (start, end) {
        let mut new_content = String::new();
        new_content.push_str(&existing[..s]);
        new_content.push_str(block);
        new_content.push_str(&existing[e + "# <<< jaterm cwd tracking <<<".len()..]);
        fs::write(&path, new_content)?;
        return Ok(true);
      }
      return Ok(false);
    }
    // ensure parent exists
    if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
    let new_content = if existing.is_empty() { block.to_string() } else { format!("{}\n{}\n", existing.trim_end(), block) };
    fs::write(&path, new_content)?;
    Ok(true)
  })()
  .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn install_fish_osc7() -> Result<bool, String> {
  (|| -> Result<bool> {
    let config = dirs::home_dir().ok_or_else(|| anyhow!("no home"))?.join(".config/fish/config.fish");
    let existing = fs::read_to_string(&config).unwrap_or_default();
    let block = fish_snippet();
    if existing.contains("jaterm cwd tracking") {
      // replace block
      let start = existing.find("# >>> jaterm cwd tracking >>>");
      let end = existing.find("# <<< jaterm cwd tracking <<<");
      if let (Some(s), Some(e)) = (start, end) {
        let mut new_content = String::new();
        new_content.push_str(&existing[..s]);
        new_content.push_str(block);
        new_content.push_str(&existing[e + "# <<< jaterm cwd tracking <<<".len()..]);
        fs::write(&config, new_content)?;
        return Ok(true);
      }
      return Ok(false);
    }
    if let Some(parent) = config.parent() { fs::create_dir_all(parent)?; }
    let new_content = if existing.is_empty() { block.to_string() } else { format!("{}\n{}\n", existing.trim_end(), block) };
    fs::write(&config, new_content)?;
    Ok(true)
  })()
  .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn install_zsh_osc7() -> Result<bool, String> {
  (|| -> Result<bool> {
    let path = zshrc_path()?;
    let existing = fs::read_to_string(&path).unwrap_or_default();
    if existing.contains("jaterm cwd tracking") {
      // Replace existing block to ensure it uses absolute %d (upgrade from older %~)
      let start = existing.find("# >>> jaterm cwd tracking >>>");
      let end = existing.find("# <<< jaterm cwd tracking <<<");
      if let (Some(s), Some(e)) = (start, end) {
        let mut new_content = String::new();
        new_content.push_str(&existing[..s]);
        new_content.push_str(snippet());
        new_content.push_str(&existing[e + "# <<< jaterm cwd tracking <<<".len()..]);
        fs::write(&path, new_content).with_context(|| format!("update {}", path.display()))?;
        return Ok(true);
      } else {
        return Ok(false);
      }
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
