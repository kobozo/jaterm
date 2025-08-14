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

    // Branch name
    let mut branch_name = "-".to_string();
    if let Ok(head) = repo.head() {
        if head.is_branch() {
            if let Some(name) = head.shorthand() { branch_name = name.to_string(); }
        } else if head.is_detached() {
            branch_name = "DETACHED".into();
        }
    }

    // Ahead/behind vs upstream if configured
    let (mut ahead, mut behind) = (0u32, 0u32);
    if let Ok(mut branch_iter) = repo.branches(Some(BranchType::Local)) {
        while let Some(Ok((branch, _))) = branch_iter.next() {
            if let Ok(name) = branch.name() {
                if name == Some(branch_name.as_str()) {
                    if let Ok(upstream) = branch.upstream() {
                        if let (Ok(local_oid), Ok(upstream_oid)) = (branch.get().target(), upstream.into_reference().target()) {
                            if let Ok((a, b)) = repo.graph_ahead_behind(local_oid, upstream_oid) {
                                ahead = a as u32;
                                behind = b as u32;
                            }
                        }
                    }
                    break;
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
