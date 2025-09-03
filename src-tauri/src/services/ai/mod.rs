pub mod command_generator;
pub mod providers;
pub mod context;

use anyhow::Result;
use langchain_rust::{
    language_models::llm::LLM,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub enabled: bool,
    pub default_provider: String,
    pub providers: ProvidersConfig,
    pub generation: GenerationConfig,
    pub privacy: PrivacyConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvidersConfig {
    pub openai: Option<OpenAiConfig>,
    pub anthropic: Option<AnthropicConfig>,
    pub azure: Option<AzureConfig>,
    pub ollama: Option<OllamaConfig>,
    pub huggingface: Option<HuggingFaceConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiConfig {
    pub api_key: String,
    pub model: String,
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnthropicConfig {
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AzureConfig {
    pub api_key: String,
    pub endpoint: String,
    pub deployment_name: String,
    pub api_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaConfig {
    pub base_url: String,
    pub model: String,
    pub keep_alive: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HuggingFaceConfig {
    pub api_token: String,
    pub model: String,
    pub endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationConfig {
    pub temperature: f32,
    pub max_tokens: u32,
    pub system_prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyConfig {
    pub send_context: bool,
    pub store_history: bool,
    pub offline_only: bool,
}

#[derive(Clone)]
pub struct AiService {
    config: Arc<RwLock<Option<AiConfig>>>,
    llm: Arc<RwLock<Option<Arc<Box<dyn LLM>>>>>,
}

impl AiService {
    pub fn new() -> Self {
        Self {
            config: Arc::new(RwLock::new(None)),
            llm: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn initialize(&self, config: AiConfig) -> Result<()> {
        if !config.enabled {
            return Ok(());
        }

        // Initialize the appropriate LLM provider
        let llm = providers::create_llm(&config).await?;
        
        *self.config.write().await = Some(config);
        *self.llm.write().await = Some(Arc::new(llm));
        
        Ok(())
    }

    pub async fn is_initialized(&self) -> bool {
        self.llm.read().await.is_some()
    }

    pub async fn generate_command(&self, prompt: &str, context: Option<context::CommandContext>) -> Result<Vec<CommandSuggestion>> {
        let llm_guard = self.llm.read().await;
        let llm = llm_guard.as_ref().ok_or_else(|| anyhow::anyhow!("AI service not initialized"))?;
        
        let config_guard = self.config.read().await;
        let config = config_guard.as_ref().ok_or_else(|| anyhow::anyhow!("AI config not loaded"))?;
        
        command_generator::generate_command(llm.as_ref().as_ref(), prompt, context, config).await
    }

    pub async fn test_connection(&self) -> Result<bool> {
        let llm_guard = self.llm.read().await;
        let llm = llm_guard.as_ref().ok_or_else(|| anyhow::anyhow!("AI service not initialized"))?;
        
        // Simple test prompt
        let test_prompt = "Say 'OK' if you can read this.";
        let response = llm.invoke(test_prompt).await?;
        
        Ok(!response.is_empty())
    }

    pub async fn list_ollama_models(&self) -> Result<Vec<String>> {
        let config_guard = self.config.read().await;
        let config = config_guard.as_ref().ok_or_else(|| anyhow::anyhow!("AI config not loaded"))?;
        
        if let Some(ollama_config) = &config.providers.ollama {
            providers::list_ollama_models(&ollama_config.base_url).await
        } else {
            Ok(Vec::new())
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandSuggestion {
    pub command: String,
    pub explanation: String,
    pub confidence: f32,
    pub safety_level: SafetyLevel,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SafetyLevel {
    Safe,
    Caution,
    Dangerous,
}