use serde::Serialize;
use git2::{BranchType, Repository, Status, StatusOptions};

#[derive(Serialize)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub staged: u32,
    pub unstaged: u32,
}

#[tauri::command]
pub async fn git_status(path: String) -> Result<GitStatus, String> {
    // Try to discover a repo from given path; if not a repo, return defaults
    let repo = match Repository::discover(&path) {
        Ok(r) => r,
        Err(_) => {
            return Ok(GitStatus { branch: "-".into(), ahead: 0, behind: 0, staged: 0, unstaged: 0 });
        }
    };

    // Branch name (or DETACHED / -)
    let branch_name = if let Ok(head) = repo.head() {
        if head.is_branch() {
            head.shorthand().unwrap_or("-").to_string()
        } else {
            "DETACHED".to_string()
        }
    } else { "-".to_string() };

    // Ahead/behind vs upstream if configured
    let (mut ahead, mut behind) = (0u32, 0u32);
    if let Ok(local_branch) = repo.find_branch(&branch_name, BranchType::Local) {
        if let Ok(upstream) = local_branch.upstream() {
            let local_oid = local_branch.get().target();
            let upstream_oid = upstream.get().target();
            if let (Some(lo), Some(up)) = (local_oid, upstream_oid) {
                if let Ok((a, b)) = repo.graph_ahead_behind(lo, up) {
                    ahead = a as u32;
                    behind = b as u32;
                }
            }
        }
    }

    // Staged/unstaged counts via status
    let mut staged = 0u32;
    let mut unstaged = 0u32;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true).renames_head_to_index(true);
    if let Ok(statuses) = repo.statuses(Some(&mut opts)) {
        for s in statuses.iter() {
            let st = s.status();
            let is_staged = st.intersects(Status::INDEX_NEW | Status::INDEX_MODIFIED | Status::INDEX_DELETED | Status::INDEX_RENAMED | Status::INDEX_TYPECHANGE);
            let is_unstaged = st.intersects(Status::WT_NEW | Status::WT_MODIFIED | Status::WT_DELETED | Status::WT_RENAMED | Status::WT_TYPECHANGE);
            if is_staged { staged += 1; }
            if is_unstaged { unstaged += 1; }
        }
    }

    Ok(GitStatus { branch: branch_name, ahead, behind, staged, unstaged })
}
