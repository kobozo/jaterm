use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String, // "user", "assistant", "system"
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct ChatSession {
    pub id: String,
    pub messages: Vec<ChatMessage>,
    pub context: String, // Terminal output or other context
}

pub struct ChatManager {
    sessions: Arc<RwLock<HashMap<String, ChatSession>>>,
}

impl ChatManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn create_session(&self, terminal_output: &str) -> Result<(String, String, bool)> {
        let session_id = Uuid::new_v4().to_string();
        
        // Initial system message with terminal output
        let system_message = ChatMessage {
            role: "system".to_string(),
            content: format!(
                "You are an AI assistant helping to analyze terminal output and solve issues. \
                Here is the terminal output to analyze:\n\n{}\n\n\
                Provide a clear analysis of what's happening, identify any errors or issues, \
                and suggest solutions if applicable.",
                terminal_output
            ),
        };

        let session = ChatSession {
            id: session_id.clone(),
            messages: vec![system_message],
            context: terminal_output.to_string(),
        };

        let mut sessions = self.sessions.write().await;
        sessions.insert(session_id.clone(), session);

        // For now, return a placeholder analysis
        // In production, this would call the LLM
        let analysis = self.analyze_terminal_output(terminal_output).await?;
        let has_cli_solution = self.check_cli_solution(&analysis);

        Ok((session_id, analysis, has_cli_solution))
    }

    pub async fn send_message(
        &self,
        session_id: &str,
        message: &str,
    ) -> Result<(String, bool)> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("Chat session not found"))?;

        // Add user message
        session.messages.push(ChatMessage {
            role: "user".to_string(),
            content: message.to_string(),
        });

        // Generate AI response (placeholder for now)
        let response = self.generate_response(&session.messages, &session.context).await?;
        let has_cli_solution = self.check_cli_solution(&response);

        // Add assistant message
        session.messages.push(ChatMessage {
            role: "assistant".to_string(),
            content: response.clone(),
        });

        Ok((response, has_cli_solution))
    }

    pub async fn generate_cli_solution(&self, session_id: &str) -> Result<(String, String)> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Chat session not found"))?;

        // Generate CLI solution based on the conversation
        let solution = self.create_cli_solution(&session.messages, &session.context).await?;
        
        Ok(solution)
    }

    // Helper methods (these would integrate with the actual LLM)
    async fn analyze_terminal_output(&self, output: &str) -> Result<String> {
        // This is a placeholder. In production, this would call the LLM
        // to analyze the terminal output
        Ok(format!(
            "I've analyzed the terminal output. Here's what I found:\n\n\
            The output shows {} lines of terminal activity. \
            I can help you understand any errors or issues present.",
            output.lines().count()
        ))
    }

    async fn generate_response(&self, messages: &[ChatMessage], context: &str) -> Result<String> {
        // Placeholder for LLM response generation
        Ok("I understand your question. Based on the terminal output and our conversation, \
            here's my analysis...".to_string())
    }

    async fn create_cli_solution(&self, messages: &[ChatMessage], context: &str) -> Result<(String, String)> {
        // Placeholder for CLI solution generation
        let command = "echo 'This is a placeholder command'".to_string();
        let explanation = "This command will help resolve the issue by...".to_string();
        Ok((command, explanation))
    }

    fn check_cli_solution(&self, text: &str) -> bool {
        // Simple heuristic to check if a CLI solution might be available
        // In production, this would be more sophisticated
        text.to_lowercase().contains("error") 
            || text.to_lowercase().contains("failed")
            || text.to_lowercase().contains("issue")
            || text.to_lowercase().contains("problem")
    }

    pub async fn get_session(&self, session_id: &str) -> Result<Option<ChatSession>> {
        let sessions = self.sessions.read().await;
        Ok(sessions.get(session_id).cloned())
    }
}

// Integration with the AI service
impl super::AiService {
    pub async fn start_chat_session(
        &self,
        terminal_output: &str,
    ) -> Result<(String, String, bool)> {
        // This would integrate with the actual LLM provider
        // For now, we'll create a basic implementation
        
        let prompt = format!(
            "Analyze this terminal output and provide insights:\n\n{}",
            terminal_output
        );

        // Call the LLM to get initial analysis
        let suggestions = self.generate_command(&prompt, None).await?;
        
        let analysis = suggestions
            .first()
            .map(|s| s.explanation.clone())
            .unwrap_or_else(|| "Unable to analyze terminal output".to_string());

        // Check if there's a potential CLI solution
        let has_cli_solution = terminal_output.contains("error") 
            || terminal_output.contains("failed")
            || terminal_output.contains("Error");

        // Generate a session ID
        let session_id = Uuid::new_v4().to_string();

        Ok((session_id, analysis, has_cli_solution))
    }

    pub async fn send_chat_message(
        &self,
        _session_id: &str,
        message: &str,
    ) -> Result<(String, bool)> {
        // Generate response using LLM
        let prompt = format!("User question about terminal output: {}", message);
        
        let suggestions = self.generate_command(&prompt, None).await?;
        
        let response = suggestions
            .first()
            .map(|s| s.explanation.clone())
            .unwrap_or_else(|| "I couldn't generate a response".to_string());

        let has_cli_solution = response.contains("command") 
            || response.contains("run")
            || response.contains("execute");

        Ok((response, has_cli_solution))
    }

    pub async fn generate_cli_solution_for_chat(
        &self,
        _session_id: &str,
    ) -> Result<(String, String)> {
        // Generate a CLI solution
        let prompt = "Generate a command line solution for the discussed issue";
        
        let suggestions = self.generate_command(prompt, None).await?;
        
        if let Some(suggestion) = suggestions.first() {
            Ok((suggestion.command.clone(), suggestion.explanation.clone()))
        } else {
            Ok((
                "# No specific command available".to_string(),
                "Unable to generate a specific command for this issue".to_string(),
            ))
        }
    }
}