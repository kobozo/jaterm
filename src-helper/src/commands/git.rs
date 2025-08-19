use anyhow::{Context, Result};
use git2::{Repository, StatusOptions};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: usize,
    pub behind: usize,
    pub staged: usize,
    pub unstaged: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitChange {
    pub path: String,
    pub x: String,
    pub y: String,
    pub staged: bool,
}

/// Expand tilde in path
fn expand_tilde(path: &str) -> String {
    if path.starts_with("~") {
        if let Some(home) = dirs::home_dir() {
            return path.replacen("~", &home.to_string_lossy(), 1);
        }
    }
    path.to_string()
}

pub fn status(dir: &str) -> Result<GitStatus> {
    let dir = expand_tilde(dir);
    let path = Path::new(&dir);
    
    // Try to open repository
    let repo = match Repository::open(path) {
        Ok(r) => r,
        Err(_) => {
            // Not a git repo
            return Ok(GitStatus {
                branch: "-".to_string(),
                ahead: 0,
                behind: 0,
                staged: 0,
                unstaged: 0,
            });
        }
    };
    
    // Get current branch
    let head = repo.head().context("Failed to get HEAD")?;
    let branch = if let Some(name) = head.shorthand() {
        name.to_string()
    } else {
        "DETACHED".to_string()
    };
    
    // Get ahead/behind counts
    let (ahead, behind) = if let Ok(upstream) = repo.branch_upstream_name(head.name().unwrap_or("HEAD")) {
        let upstream_str = upstream.as_str().unwrap_or("");
        if let Ok(upstream_oid) = repo.revparse_single(upstream_str).map(|o| o.id()) {
            if let Some(head_oid) = head.target() {
                let (a, b) = repo.graph_ahead_behind(head_oid, upstream_oid)?;
                (a, b)
            } else {
                (0, 0)
            }
        } else {
            (0, 0)
        }
    } else {
        (0, 0)
    };
    
    // Count staged and unstaged files
    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    
    let mut staged = 0;
    let mut unstaged = 0;
    
    for entry in statuses.iter() {
        let status = entry.status();
        
        // Check if file is untracked (counts as unstaged)
        if status.contains(git2::Status::WT_NEW) {
            unstaged += 1;
        } else {
            // Check if staged
            if status.intersects(
                git2::Status::INDEX_NEW |
                git2::Status::INDEX_MODIFIED |
                git2::Status::INDEX_DELETED |
                git2::Status::INDEX_RENAMED |
                git2::Status::INDEX_TYPECHANGE
            ) {
                staged += 1;
            }
            
            // Check if unstaged (working tree changes)
            if status.intersects(
                git2::Status::WT_MODIFIED |
                git2::Status::WT_DELETED |
                git2::Status::WT_TYPECHANGE |
                git2::Status::WT_RENAMED
            ) {
                unstaged += 1;
            }
        }
    }
    
    Ok(GitStatus {
        branch,
        ahead,
        behind,
        staged,
        unstaged,
    })
}

pub fn changes(dir: &str) -> Result<Vec<GitChange>> {
    let dir = expand_tilde(dir);
    let path = Path::new(&dir);
    
    // Try to open repository
    let repo = match Repository::open(path) {
        Ok(r) => r,
        Err(_) => {
            // Not a git repo
            return Ok(vec![]);
        }
    };
    
    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    opts.include_ignored(false);
    let statuses = repo.statuses(Some(&mut opts))?;
    
    let mut changes = Vec::new();
    
    for entry in statuses.iter() {
        let status = entry.status();
        if status.contains(git2::Status::IGNORED) {
            continue;
        }
        
        let path = entry.path().unwrap_or("").to_string();
        
        // Map git2 status to porcelain-like format
        let (x, y) = status_to_xy(status);
        let staged = x != " " && x != "?";
        
        changes.push(GitChange {
            path,
            x: x.to_string(),
            y: y.to_string(),
            staged,
        });
    }
    
    Ok(changes)
}

fn status_to_xy(status: git2::Status) -> (&'static str, &'static str) {
    // Map git2::Status to git porcelain XY format
    let x = if status.contains(git2::Status::INDEX_NEW) {
        "A"
    } else if status.contains(git2::Status::INDEX_MODIFIED) {
        "M"
    } else if status.contains(git2::Status::INDEX_DELETED) {
        "D"
    } else if status.contains(git2::Status::INDEX_RENAMED) {
        "R"
    } else if status.contains(git2::Status::INDEX_TYPECHANGE) {
        "T"
    } else {
        " "
    };
    
    let y = if status.contains(git2::Status::WT_NEW) {
        "?"
    } else if status.contains(git2::Status::WT_MODIFIED) {
        "M"
    } else if status.contains(git2::Status::WT_DELETED) {
        "D"
    } else if status.contains(git2::Status::WT_TYPECHANGE) {
        "T"
    } else if status.contains(git2::Status::WT_RENAMED) {
        "R"
    } else {
        " "
    };
    
    // Handle untracked files
    if status == git2::Status::WT_NEW {
        return ("?", "?");
    }
    
    (x, y)
}

// For commands that need to shell out to git (diff, commit, etc.)
// We'll use the git CLI directly to match existing behavior

pub fn diff(dir: &str, file: &str, mode: &str) -> Result<String> {
    let dir = expand_tilde(dir);
    let mut cmd = Command::new("git");
    cmd.current_dir(&dir);
    
    if mode == "staged" {
        cmd.args(&["diff", "--cached", "--", file]);
    } else {
        cmd.args(&["diff", "--", file]);
    }
    
    let output = cmd.output()?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn commit(dir: &str, message: &str) -> Result<String> {
    let dir = expand_tilde(dir);
    let output = Command::new("git")
        .current_dir(&dir)
        .args(&["commit", "-m", message])
        .output()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(format!("{}{}", stdout, stderr))
}

pub fn sync(dir: &str) -> Result<String> {
    let dir = expand_tilde(dir);
    
    // Pull with rebase
    let pull_output = Command::new("git")
        .current_dir(&dir)
        .args(&["pull", "--rebase"])
        .output()?;
    
    if !pull_output.status.success() {
        let stderr = String::from_utf8_lossy(&pull_output.stderr);
        return Ok(stderr.to_string());
    }
    
    // Push
    let push_output = Command::new("git")
        .current_dir(&dir)
        .arg("push")
        .output()?;
    
    let pull_str = String::from_utf8_lossy(&pull_output.stdout);
    let push_str = String::from_utf8_lossy(&push_output.stdout);
    Ok(format!("{}{}", pull_str, push_str))
}

pub fn stage(dir: &str, file: &str) -> Result<String> {
    let dir = expand_tilde(dir);
    let output = Command::new("git")
        .current_dir(&dir)
        .args(&["add", "--", file])
        .output()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(format!("{}{}", stdout, stderr))
}

pub fn unstage(dir: &str, file: &str) -> Result<String> {
    let dir = expand_tilde(dir);
    let output = Command::new("git")
        .current_dir(&dir)
        .args(&["restore", "--staged", "--", file])
        .output()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(format!("{}{}", stdout, stderr))
}

pub fn discard(dir: &str, file: &str) -> Result<String> {
    let dir = expand_tilde(dir);
    
    // Try to restore from HEAD
    let output = Command::new("git")
        .current_dir(&dir)
        .args(&["restore", "--source=HEAD", "--staged", "--worktree", "--", file])
        .output()?;
    
    if !output.status.success() {
        // If that fails, try to remove the file (for untracked files)
        let rm_output = Command::new("rm")
            .current_dir(&dir)
            .args(&["-f", "--", file])
            .output()?;
        
        let stdout = String::from_utf8_lossy(&rm_output.stdout);
        let stderr = String::from_utf8_lossy(&rm_output.stderr);
        return Ok(format!("{}{}", stdout, stderr));
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(format!("{}{}", stdout, stderr))
}

pub fn stage_all(dir: &str) -> Result<String> {
    let dir = expand_tilde(dir);
    let output = Command::new("git")
        .current_dir(&dir)
        .args(&["add", "-A"])
        .output()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(format!("{}{}", stdout, stderr))
}

pub fn unstage_all(dir: &str) -> Result<String> {
    let dir = expand_tilde(dir);
    let output = Command::new("git")
        .current_dir(&dir)
        .args(&["reset", "HEAD", "--", "."])
        .output()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(format!("{}{}", stdout, stderr))
}

pub fn pull(dir: &str) -> Result<String> {
    let dir = expand_tilde(dir);
    let output = Command::new("git")
        .current_dir(&dir)
        .args(&["pull", "--rebase"])
        .output()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(format!("{}{}", stdout, stderr))
}

pub fn push(dir: &str) -> Result<String> {
    let dir = expand_tilde(dir);
    let output = Command::new("git")
        .current_dir(&dir)
        .arg("push")
        .output()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(format!("{}{}", stdout, stderr))
}