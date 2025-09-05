use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::services::ai::{AiConfig, AiService, CommandSuggestion, context::CommandContext};
use crate::state::app_state::AppState;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiGenerateRequest {
    pub prompt: String,
    pub include_context: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiGenerateResponse {
    pub suggestions: Vec<CommandSuggestion>,
}

#[tauri::command]
pub async fn ai_initialize(
    config: AiConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let ai_service = AiService::new();
    
    // Decrypt API keys if they're encrypted
    let decrypted_config = config.clone();
    
    // TODO: Decrypt API keys using the encryption service
    // For now, we'll use them as-is
    
    ai_service.initialize(decrypted_config).await
        .map_err(|e| format!("Failed to initialize AI service: {}", e))?;
    
    // Store the AI service in app state
    state.set_ai_service(ai_service);
    
    Ok(())
}

#[tauri::command]
pub async fn ai_generate_command(
    request: AiGenerateRequest,
    state: State<'_, AppState>,
) -> Result<AiGenerateResponse, String> {
    let ai_service = state.get_ai_service()
        .ok_or_else(|| "AI service not initialized".to_string())?;
    
    // Gather context if requested
    let context = if request.include_context {
        Some(CommandContext::gather())
    } else {
        None
    };
    
    // Generate command suggestions
    let suggestions = ai_service
        .generate_command(&request.prompt, context)
        .await
        .map_err(|e| format!("Failed to generate command: {}", e))?;
    
    Ok(AiGenerateResponse { suggestions })
}

#[tauri::command]
pub async fn ai_test_connection(
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let ai_service = state.get_ai_service()
        .ok_or_else(|| "AI service not initialized".to_string())?;
    
    ai_service.test_connection().await
        .map_err(|e| format!("Connection test failed: {}", e))
}

#[tauri::command]
pub async fn ai_list_ollama_models(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let ai_service = state.get_ai_service()
        .ok_or_else(|| "AI service not initialized".to_string())?;
    
    ai_service.list_ollama_models().await
        .map_err(|e| format!("Failed to list Ollama models: {}", e))
}

#[tauri::command]
pub async fn ai_explain_command(
    command: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let ai_service = state.get_ai_service()
        .ok_or_else(|| "AI service not initialized".to_string())?;
    
    let prompt = format!(
        "Explain what this command does in simple terms:\n\n{}",
        command
    );
    
    let suggestions = ai_service
        .generate_command(&prompt, None)
        .await
        .map_err(|e| format!("Failed to explain command: {}", e))?;
    
    Ok(suggestions.first()
        .map(|s| s.explanation.clone())
        .unwrap_or_else(|| "Could not generate explanation".to_string()))
}