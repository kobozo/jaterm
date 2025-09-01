use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandContext {
    pub current_directory: String,
    pub shell_type: String,
    pub os: String,
    pub recent_commands: Vec<String>,
    pub git_branch: Option<String>,
    pub git_status: Option<String>,
}

impl CommandContext {
    pub fn gather() -> Self {
        let current_directory = env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| String::from("~"));
        
        let shell_type = env::var("SHELL")
            .unwrap_or_else(|_| String::from("/bin/sh"))
            .split('/')
            .last()
            .unwrap_or("sh")
            .to_string();
        
        let os = if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else if cfg!(target_os = "linux") {
            "linux"
        } else {
            "unknown"
        }.to_string();
        
        // Git information would be gathered from the git service if available
        let git_branch = None;
        let git_status = None;
        
        Self {
            current_directory,
            shell_type,
            os,
            recent_commands: Vec::new(),
            git_branch,
            git_status,
        }
    }
    
    pub fn to_prompt_context(&self) -> String {
        let mut context_parts = vec![
            format!("Operating System: {}", self.os),
            format!("Shell: {}", self.shell_type),
            format!("Current Directory: {}", self.current_directory),
        ];
        
        if let Some(branch) = &self.git_branch {
            context_parts.push(format!("Git Branch: {}", branch));
        }
        
        if !self.recent_commands.is_empty() {
            context_parts.push(format!(
                "Recent Commands: {}",
                self.recent_commands.join(", ")
            ));
        }
        
        context_parts.join("\n")
    }
}