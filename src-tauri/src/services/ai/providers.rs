use anyhow::Result;
use langchain_rust::{
    language_models::llm::LLM,
    llm::openai::{OpenAI, OpenAIConfig},
};
use reqwest;
use serde::Deserialize;

use super::AiConfig;

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
    
    // Create OpenAI configuration
    let lc_config = OpenAIConfig::new(openai_config.api_key.clone());
    
    // Create OpenAI client with the configuration
    let openai = OpenAI::new(lc_config);
    
    Ok(Box::new(openai))
}

async fn create_anthropic_llm(_config: &AiConfig) -> Result<Box<dyn LLM>> {
    let anthropic_config = _config.providers.anthropic.as_ref()
        .ok_or_else(|| anyhow::anyhow!("Anthropic configuration not found"))?;
    
    // Create configuration for Anthropic
    let lc_config = OpenAIConfig::new(anthropic_config.api_key.clone());
    let anthropic = OpenAI::new(lc_config);
    
    Ok(Box::new(anthropic))
}

async fn create_ollama_llm(_config: &AiConfig) -> Result<Box<dyn LLM>> {
    let _ollama_config = _config.providers.ollama.as_ref()
        .ok_or_else(|| anyhow::anyhow!("Ollama configuration not found"))?;
    
    // Use a dummy API key for Ollama (it doesn't require one)
    let lc_config = OpenAIConfig::new("ollama".to_string());
    let ollama = OpenAI::new(lc_config);
    
    Ok(Box::new(ollama))
}

async fn create_huggingface_llm(_config: &AiConfig) -> Result<Box<dyn LLM>> {
    let hf_config = _config.providers.huggingface.as_ref()
        .ok_or_else(|| anyhow::anyhow!("HuggingFace configuration not found"))?;
    
    // Use HuggingFace API token
    let lc_config = OpenAIConfig::new(hf_config.api_token.clone());
    let hf = OpenAI::new(lc_config);
    
    Ok(Box::new(hf))
}

async fn create_azure_llm(_config: &AiConfig) -> Result<Box<dyn LLM>> {
    let azure_config = _config.providers.azure.as_ref()
        .ok_or_else(|| anyhow::anyhow!("Azure configuration not found"))?;
    
    // Use Azure API key
    let lc_config = OpenAIConfig::new(azure_config.api_key.clone());
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