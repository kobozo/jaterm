use anyhow::Result;
use langchain_rust::{
    llm::{
        openai::{OpenAI, OpenAIConfig as LCOpenAIConfig},
        ollama::{Ollama, OllamaConfig as LCOllamaConfig},
        LLM,
    },
};
use reqwest;
use serde::{Deserialize, Serialize};

use super::{AiConfig, OpenAiConfig, AnthropicConfig, OllamaConfig, HuggingFaceConfig};

pub async fn create_llm(config: &AiConfig) -> Result<Box<dyn LLM>> {
    match config.default_provider.as_str() {
        "openai" => create_openai_llm(config).await,
        "anthropic" => create_anthropic_llm(config).await,
        "ollama" => create_ollama_llm(config).await,
        "huggingface" => create_huggingface_llm(config).await,
        "azure" => create_azure_llm(config).await,
        _ => Err(anyhow::anyhow!("Unknown provider: {}", config.default_provider)),
    }
}

async fn create_openai_llm(config: &AiConfig) -> Result<Box<dyn LLM>> {
    let openai_config = config.providers.openai.as_ref()
        .ok_or_else(|| anyhow::anyhow!("OpenAI configuration not found"))?;
    
    let mut lc_config = LCOpenAIConfig::default();
    lc_config.api_key = openai_config.api_key.clone();
    lc_config.model = openai_config.model.clone();
    
    if let Some(base_url) = &openai_config.base_url {
        lc_config.api_base = base_url.clone();
    }
    
    lc_config.temperature = config.generation.temperature;
    lc_config.max_tokens = Some(config.generation.max_tokens as i32);
    
    let openai = OpenAI::new(lc_config);
    Ok(Box::new(openai))
}

async fn create_anthropic_llm(config: &AiConfig) -> Result<Box<dyn LLM>> {
    let anthropic_config = config.providers.anthropic.as_ref()
        .ok_or_else(|| anyhow::anyhow!("Anthropic configuration not found"))?;
    
    // LangChain-rust doesn't have native Anthropic support yet,
    // but we can use OpenAI-compatible API with Anthropic's endpoint
    let mut lc_config = LCOpenAIConfig::default();
    lc_config.api_key = anthropic_config.api_key.clone();
    lc_config.model = anthropic_config.model.clone();
    lc_config.api_base = "https://api.anthropic.com/v1".to_string();
    lc_config.temperature = config.generation.temperature;
    lc_config.max_tokens = Some(config.generation.max_tokens as i32);
    
    let anthropic = OpenAI::new(lc_config);
    Ok(Box::new(anthropic))
}

async fn create_ollama_llm(config: &AiConfig) -> Result<Box<dyn LLM>> {
    let ollama_config = config.providers.ollama.as_ref()
        .ok_or_else(|| anyhow::anyhow!("Ollama configuration not found"))?;
    
    let mut lc_config = LCOllamaConfig::default();
    lc_config.base_url = ollama_config.base_url.clone();
    lc_config.model = ollama_config.model.clone();
    lc_config.temperature = Some(config.generation.temperature);
    
    if let Some(keep_alive) = &ollama_config.keep_alive {
        // LangChain-rust Ollama config doesn't directly support keep_alive,
        // but we can pass it as an option
        lc_config.options = Some(serde_json::json!({
            "keep_alive": keep_alive
        }));
    }
    
    let ollama = Ollama::new(lc_config);
    Ok(Box::new(ollama))
}

async fn create_huggingface_llm(config: &AiConfig) -> Result<Box<dyn LLM>> {
    let hf_config = config.providers.huggingface.as_ref()
        .ok_or_else(|| anyhow::anyhow!("HuggingFace configuration not found"))?;
    
    // HuggingFace can be accessed through OpenAI-compatible API
    let mut lc_config = LCOpenAIConfig::default();
    lc_config.api_key = hf_config.api_token.clone();
    lc_config.model = hf_config.model.clone();
    
    if let Some(endpoint) = &hf_config.endpoint {
        lc_config.api_base = endpoint.clone();
    } else {
        lc_config.api_base = format!("https://api-inference.huggingface.co/models/{}", hf_config.model);
    }
    
    lc_config.temperature = config.generation.temperature;
    lc_config.max_tokens = Some(config.generation.max_tokens as i32);
    
    let hf = OpenAI::new(lc_config);
    Ok(Box::new(hf))
}

async fn create_azure_llm(config: &AiConfig) -> Result<Box<dyn LLM>> {
    let azure_config = config.providers.azure.as_ref()
        .ok_or_else(|| anyhow::anyhow!("Azure configuration not found"))?;
    
    // Azure OpenAI uses OpenAI-compatible API
    let mut lc_config = LCOpenAIConfig::default();
    lc_config.api_key = azure_config.api_key.clone();
    lc_config.model = azure_config.deployment_name.clone();
    lc_config.api_base = format!(
        "{}/openai/deployments/{}", 
        azure_config.endpoint.trim_end_matches('/'),
        azure_config.deployment_name
    );
    lc_config.api_version = Some(azure_config.api_version.clone());
    lc_config.temperature = config.generation.temperature;
    lc_config.max_tokens = Some(config.generation.max_tokens as i32);
    
    let azure = OpenAI::new(lc_config);
    Ok(Box::new(azure))
}

#[derive(Debug, Deserialize)]
struct OllamaModelResponse {
    models: Vec<OllamaModel>,
}

#[derive(Debug, Deserialize)]
struct OllamaModel {
    name: String,
}

pub async fn list_ollama_models(base_url: &str) -> Result<Vec<String>> {
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    let response = reqwest::get(&url).await?;
    
    if response.status().is_success() {
        let model_response: OllamaModelResponse = response.json().await?;
        Ok(model_response.models.into_iter().map(|m| m.name).collect())
    } else {
        Err(anyhow::anyhow!("Failed to fetch Ollama models: {}", response.status()))
    }
}