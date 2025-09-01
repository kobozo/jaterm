use anyhow::Result;
use langchain_rust::language_models::llm::LLM;
use serde_json;

use super::{AiConfig, CommandSuggestion, SafetyLevel, context::CommandContext};

const DEFAULT_SYSTEM_PROMPT: &str = r#"You are a helpful terminal assistant that generates shell commands.
Your task is to convert natural language descriptions into executable shell commands.
Always provide safe, correct, and efficient commands.
Include explanations for what each command does.
Warn about potentially dangerous operations.
Output your response as a JSON array of command suggestions."#;

const COMMAND_GENERATION_TEMPLATE: &str = r#"System: {system_prompt}

Context:
{context}

User Request: {user_prompt}

Generate shell commands for this request. Return a JSON array with this structure:
[
  {{
    "command": "the actual command to execute",
    "explanation": "what this command does",
    "confidence": 0.0-1.0,
    "safety_level": "Safe|Caution|Dangerous",
    "warnings": ["any warnings about this command"]
  }}
]

Provide up to 3 alternative commands if applicable. Focus on correctness and safety."#;

pub async fn generate_command(
    llm: &dyn LLM,
    user_prompt: &str,
    context: Option<CommandContext>,
    config: &AiConfig,
) -> Result<Vec<CommandSuggestion>> {
    // Build the context string
    let context_str = if config.privacy.send_context {
        context.map(|c| c.to_prompt_context()).unwrap_or_default()
    } else {
        String::from("Context sharing disabled")
    };
    
    // Use custom system prompt if provided, otherwise use default
    let system_prompt = config.generation.system_prompt.as_ref()
        .map(|s| s.as_str())
        .unwrap_or(DEFAULT_SYSTEM_PROMPT);
    
    // Format the full prompt
    let prompt = COMMAND_GENERATION_TEMPLATE
        .replace("{system_prompt}", system_prompt)
        .replace("{context}", &context_str)
        .replace("{user_prompt}", user_prompt);
    
    // Generate response from LLM
    let response = llm.invoke(&prompt).await?;
    
    // Parse the response as JSON
    parse_command_suggestions(&response)
}

fn parse_command_suggestions(response: &str) -> Result<Vec<CommandSuggestion>> {
    // Try to extract JSON from the response
    // LLMs sometimes wrap JSON in markdown code blocks
    let json_str = if response.contains("```json") {
        response
            .split("```json")
            .nth(1)
            .and_then(|s| s.split("```").next())
            .unwrap_or(response)
    } else if response.contains("```") {
        response
            .split("```")
            .nth(1)
            .unwrap_or(response)
    } else {
        response
    };
    
    // Try to find JSON array in the response
    let json_str = json_str.trim();
    let start = json_str.find('[').unwrap_or(0);
    let end = json_str.rfind(']').map(|i| i + 1).unwrap_or(json_str.len());
    let json_str = &json_str[start..end];
    
    // Parse as JSON
    let suggestions: Vec<CommandSuggestion> = serde_json::from_str(json_str)
        .or_else(|_| -> Result<Vec<CommandSuggestion>> {
            // If parsing fails, try to create a single suggestion from the response
            Ok(vec![CommandSuggestion {
                command: extract_command_from_text(response),
                explanation: "Generated command".to_string(),
                confidence: 0.5,
                safety_level: SafetyLevel::Caution,
                warnings: vec!["Could not parse structured response".to_string()],
            }])
        })?;
    
    Ok(suggestions)
}

fn extract_command_from_text(text: &str) -> String {
    // Try to extract a command from unstructured text
    // Look for lines that look like commands (start with common command prefixes)
    let lines: Vec<&str> = text.lines()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty() && 
            !trimmed.starts_with('#') &&
            !trimmed.starts_with("//") &&
            (trimmed.starts_with("$") ||
             trimmed.starts_with(">") ||
             trimmed.starts_with("sudo") ||
             trimmed.starts_with("git") ||
             trimmed.starts_with("npm") ||
             trimmed.starts_with("cd") ||
             trimmed.starts_with("ls") ||
             trimmed.starts_with("find") ||
             trimmed.starts_with("grep") ||
             trimmed.starts_with("curl") ||
             trimmed.starts_with("wget") ||
             trimmed.starts_with("docker") ||
             trimmed.starts_with("kubectl") ||
             trimmed.contains('|') ||
             trimmed.contains("&&"))
        })
        .collect();
    
    if !lines.is_empty() {
        // Clean up the command (remove prompt characters)
        lines[0]
            .trim_start_matches('$')
            .trim_start_matches('>')
            .trim()
            .to_string()
    } else {
        text.lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("echo 'Could not generate command'")
            .to_string()
    }
}

pub fn analyze_safety(command: &str) -> SafetyLevel {
    let dangerous_patterns = [
        "rm -rf",
        "rm -fr",
        "dd if=",
        "mkfs",
        "format",
        "> /dev/",
        "fork bomb",
        ":(){ :|:",
    ];
    
    let caution_patterns = [
        "sudo",
        "rm ",
        "delete",
        "DROP ",
        "TRUNCATE",
        "chmod 777",
        "curl | sh",
        "wget | sh",
        "> /etc/",
    ];
    
    let lower_command = command.to_lowercase();
    
    for pattern in &dangerous_patterns {
        if lower_command.contains(pattern) {
            return SafetyLevel::Dangerous;
        }
    }
    
    for pattern in &caution_patterns {
        if lower_command.contains(pattern) {
            return SafetyLevel::Caution;
        }
    }
    
    SafetyLevel::Safe
}