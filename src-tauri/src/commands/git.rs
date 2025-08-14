use serde::Serialize;

#[derive(Serialize)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub staged: u32,
    pub unstaged: u32,
}

#[tauri::command]
pub async fn git_status(_path: String) -> Result<GitStatus, String> {
    Ok(GitStatus { branch: "-".into(), ahead: 0, behind: 0, staged: 0, unstaged: 0 })
}

