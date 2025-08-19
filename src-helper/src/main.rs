use anyhow::Result;
use clap::{Parser, Subcommand};

mod commands;
mod version;
use commands::{git, ports};
use version::HELPER_VERSION;

/// Detect the operating system
fn detect_os() -> String {
    #[cfg(target_os = "linux")]
    {
        // Try to detect specific Linux distribution
        if let Ok(contents) = std::fs::read_to_string("/etc/os-release") {
            for line in contents.lines() {
                if line.starts_with("ID=") {
                    let id = line.trim_start_matches("ID=").trim_matches('"');
                    return format!("linux-{}", id);
                }
            }
        }
        "linux".to_string()
    }
    #[cfg(target_os = "macos")]
    {
        "macos".to_string()
    }
    #[cfg(target_os = "windows")]
    {
        "windows".to_string()
    }
    #[cfg(target_os = "freebsd")]
    {
        "freebsd".to_string()
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows", target_os = "freebsd")))]
    {
        std::env::consts::OS.to_string()
    }
}

#[derive(Parser)]
#[command(name = "jaterm-agent")]
#[command(about = "JaTerm helper agent for git and system operations")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Check health and version
    Health,
    
    /// Get git repository status
    #[command(name = "git-status")]
    GitStatus {
        /// Directory to check (defaults to current)
        #[arg(default_value = ".")]
        dir: String,
    },
    
    /// Get git changed files
    #[command(name = "git-changes")]
    GitChanges {
        /// Directory to check (defaults to current)
        #[arg(default_value = ".")]
        dir: String,
    },
    
    /// Get git diff
    #[command(name = "git-diff")]
    GitDiff {
        /// Directory to check
        #[arg(default_value = ".")]
        dir: String,
        /// File to diff
        file: String,
        /// Mode (staged or unstaged)
        #[arg(default_value = "unstaged")]
        mode: String,
    },
    
    /// Commit changes
    #[command(name = "git-commit")]
    GitCommit {
        /// Directory to commit in
        #[arg(default_value = ".")]
        dir: String,
        /// Commit message
        message: Vec<String>,
    },
    
    /// Sync with remote (pull and push)
    #[command(name = "git-sync")]
    GitSync {
        /// Directory to sync
        #[arg(default_value = ".")]
        dir: String,
    },
    
    /// Stage a file
    #[command(name = "git-stage")]
    GitStage {
        /// Directory
        #[arg(default_value = ".")]
        dir: String,
        /// File to stage
        file: String,
    },
    
    /// Unstage a file
    #[command(name = "git-unstage")]
    GitUnstage {
        /// Directory
        #[arg(default_value = ".")]
        dir: String,
        /// File to unstage
        file: String,
    },
    
    /// Discard changes to a file
    #[command(name = "git-discard")]
    GitDiscard {
        /// Directory
        #[arg(default_value = ".")]
        dir: String,
        /// File to discard
        file: String,
    },
    
    /// Stage all changes
    #[command(name = "git-stage-all")]
    GitStageAll {
        /// Directory
        #[arg(default_value = ".")]
        dir: String,
    },
    
    /// Unstage all changes
    #[command(name = "git-unstage-all")]
    GitUnstageAll {
        /// Directory
        #[arg(default_value = ".")]
        dir: String,
    },
    
    /// Pull from remote
    #[command(name = "git-pull")]
    GitPull {
        /// Directory
        #[arg(default_value = ".")]
        dir: String,
    },
    
    /// Push to remote
    #[command(name = "git-push")]
    GitPush {
        /// Directory
        #[arg(default_value = ".")]
        dir: String,
    },
    
    /// Detect listening ports
    #[command(name = "detect-ports")]
    DetectPorts,
    
    /// Combined watchdog (git status + ports)
    Watchdog {
        /// Directory to watch
        #[arg(default_value = ".")]
        dir: String,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    
    match cli.command {
        Commands::Health => {
            let os = detect_os();
            println!(r#"{{"ok":true,"version":"{}","os":"{}"}}"#, HELPER_VERSION, os);
        }
        
        Commands::GitStatus { dir } => {
            let status = git::status(&dir)?;
            println!("{}", serde_json::to_string(&status)?);
        }
        
        Commands::GitChanges { dir } => {
            let changes = git::changes(&dir)?;
            println!("{}", serde_json::to_string(&changes)?);
        }
        
        Commands::GitDiff { dir, file, mode } => {
            let diff = git::diff(&dir, &file, &mode)?;
            print!("{}", diff);
        }
        
        Commands::GitCommit { dir, message } => {
            let msg = message.join(" ");
            let output = git::commit(&dir, &msg)?;
            print!("{}", output);
        }
        
        Commands::GitSync { dir } => {
            let output = git::sync(&dir)?;
            print!("{}", output);
        }
        
        Commands::GitStage { dir, file } => {
            let output = git::stage(&dir, &file)?;
            print!("{}", output);
        }
        
        Commands::GitUnstage { dir, file } => {
            let output = git::unstage(&dir, &file)?;
            print!("{}", output);
        }
        
        Commands::GitDiscard { dir, file } => {
            let output = git::discard(&dir, &file)?;
            print!("{}", output);
        }
        
        Commands::GitStageAll { dir } => {
            let output = git::stage_all(&dir)?;
            print!("{}", output);
        }
        
        Commands::GitUnstageAll { dir } => {
            let output = git::unstage_all(&dir)?;
            print!("{}", output);
        }
        
        Commands::GitPull { dir } => {
            let output = git::pull(&dir)?;
            print!("{}", output);
        }
        
        Commands::GitPush { dir } => {
            let output = git::push(&dir)?;
            print!("{}", output);
        }
        
        Commands::DetectPorts => {
            let ports = ports::detect()?;
            println!("{}", serde_json::to_string(&ports)?);
        }
        
        Commands::Watchdog { dir } => {
            let git_status = git::status(&dir)?;
            let ports = ports::detect()?;
            let result = serde_json::json!({
                "git": git_status,
                "ports": ports
            });
            println!("{}", serde_json::to_string(&result)?);
        }
    }
    
    Ok(())
}