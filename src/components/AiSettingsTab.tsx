import React, { useState, useEffect } from 'react';
import { AiSettings } from '@/types/settings';
import { useToasts } from '@/store/toasts';

interface AiSettingsTabProps {
  settings: AiSettings;
  onChange: (settings: AiSettings) => void;
}

const providerNames = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  azure: 'Azure OpenAI',
  ollama: 'Ollama (Local)',
  huggingface: 'Hugging Face'
};

const openAiModels = ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'];
const anthropicModels = ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'];
const ollamaModels = ['llama2', 'codellama', 'mistral', 'mixtral', 'neural-chat', 'starling-lm', 'phi'];

export function AiSettingsTab({ settings, onChange }: AiSettingsTabProps) {
  const { show } = useToasts();
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});

  const handleProviderChange = (provider: typeof settings.defaultProvider) => {
    onChange({ ...settings, defaultProvider: provider });
  };

  const handleProviderConfig = <P extends keyof typeof settings.providers>(
    provider: P,
    config: typeof settings.providers[P]
  ) => {
    onChange({
      ...settings,
      providers: {
        ...settings.providers,
        [provider]: config
      }
    });
  };

  const testConnection = async (provider: typeof settings.defaultProvider) => {
    // This will be implemented when we add the backend
    show({
      type: 'info',
      title: 'Testing Connection',
      message: `Testing connection to ${providerNames[provider]}...`
    });
  };

  const toggleApiKeyVisibility = (provider: string) => {
    setShowApiKey(prev => ({ ...prev, [provider]: !prev[provider] }));
  };

  return (
    <div style={{ padding: '16px', maxWidth: '800px' }}>
      {/* Enable AI */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => onChange({ ...settings, enabled: e.target.checked })}
          />
          <span>Enable AI Features</span>
        </label>
        <div style={{ marginTop: '4px', fontSize: '12px', color: '#999' }}>
          Enable AI-powered command generation and terminal assistance
        </div>
      </div>

      {settings.enabled && (
        <>
          {/* Default Provider */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
              Default AI Provider
            </label>
            <select
              value={settings.defaultProvider}
              onChange={(e) => handleProviderChange(e.target.value as typeof settings.defaultProvider)}
              style={{
                width: '100%',
                padding: '8px',
                background: '#2a2a2a',
                border: '1px solid #444',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '14px'
              }}
            >
              {Object.entries(providerNames).map(([key, name]) => (
                <option key={key} value={key}>{name}</option>
              ))}
            </select>
          </div>

          {/* Provider Configurations */}
          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ marginBottom: '16px', fontSize: '14px', fontWeight: 600 }}>
              Provider Configuration
            </h4>

            {/* OpenAI */}
            <details style={{ marginBottom: '16px' }}>
              <summary style={{ cursor: 'pointer', padding: '8px', background: '#2a2a2a', borderRadius: '4px' }}>
                OpenAI Configuration
              </summary>
              <div style={{ padding: '16px', background: '#1a1a1a', borderRadius: '4px', marginTop: '8px' }}>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#999' }}>
                    API Key
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type={showApiKey.openai ? 'text' : 'password'}
                      value={settings.providers.openai?.apiKey || ''}
                      onChange={(e) => handleProviderConfig('openai', {
                        ...settings.providers.openai,
                        apiKey: e.target.value,
                        model: settings.providers.openai?.model || 'gpt-4'
                      })}
                      placeholder="sk-..."
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        background: '#2a2a2a',
                        border: '1px solid #444',
                        borderRadius: '4px',
                        color: '#fff'
                      }}
                    />
                    <button
                      onClick={() => toggleApiKeyVisibility('openai')}
                      style={{
                        padding: '6px 12px',
                        background: '#333',
                        border: '1px solid #444',
                        borderRadius: '4px',
                        color: '#fff',
                        cursor: 'pointer'
                      }}
                    >
                      {showApiKey.openai ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#999' }}>
                    Model
                  </label>
                  <select
                    value={settings.providers.openai?.model || 'gpt-4'}
                    onChange={(e) => handleProviderConfig('openai', {
                      ...settings.providers.openai,
                      apiKey: settings.providers.openai?.apiKey || '',
                      model: e.target.value
                    })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      background: '#2a2a2a',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#fff'
                    }}
                  >
                    {openAiModels.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => testConnection('openai')}
                  style={{
                    padding: '6px 12px',
                    background: '#0066cc',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                >
                  Test Connection
                </button>
              </div>
            </details>

            {/* Anthropic */}
            <details style={{ marginBottom: '16px' }}>
              <summary style={{ cursor: 'pointer', padding: '8px', background: '#2a2a2a', borderRadius: '4px' }}>
                Anthropic Configuration
              </summary>
              <div style={{ padding: '16px', background: '#1a1a1a', borderRadius: '4px', marginTop: '8px' }}>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#999' }}>
                    API Key
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type={showApiKey.anthropic ? 'text' : 'password'}
                      value={settings.providers.anthropic?.apiKey || ''}
                      onChange={(e) => handleProviderConfig('anthropic', {
                        ...settings.providers.anthropic,
                        apiKey: e.target.value,
                        model: settings.providers.anthropic?.model || 'claude-3-opus-20240229'
                      })}
                      placeholder="sk-ant-..."
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        background: '#2a2a2a',
                        border: '1px solid #444',
                        borderRadius: '4px',
                        color: '#fff'
                      }}
                    />
                    <button
                      onClick={() => toggleApiKeyVisibility('anthropic')}
                      style={{
                        padding: '6px 12px',
                        background: '#333',
                        border: '1px solid #444',
                        borderRadius: '4px',
                        color: '#fff',
                        cursor: 'pointer'
                      }}
                    >
                      {showApiKey.anthropic ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#999' }}>
                    Model
                  </label>
                  <select
                    value={settings.providers.anthropic?.model || 'claude-3-opus-20240229'}
                    onChange={(e) => handleProviderConfig('anthropic', {
                      ...settings.providers.anthropic,
                      apiKey: settings.providers.anthropic?.apiKey || '',
                      model: e.target.value
                    })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      background: '#2a2a2a',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#fff'
                    }}
                  >
                    {anthropicModels.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => testConnection('anthropic')}
                  style={{
                    padding: '6px 12px',
                    background: '#0066cc',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                >
                  Test Connection
                </button>
              </div>
            </details>

            {/* Ollama */}
            <details style={{ marginBottom: '16px' }}>
              <summary style={{ cursor: 'pointer', padding: '8px', background: '#2a2a2a', borderRadius: '4px' }}>
                Ollama Configuration (Local)
              </summary>
              <div style={{ padding: '16px', background: '#1a1a1a', borderRadius: '4px', marginTop: '8px' }}>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#999' }}>
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={settings.providers.ollama?.baseUrl || 'http://localhost:11434'}
                    onChange={(e) => handleProviderConfig('ollama', {
                      ...settings.providers.ollama,
                      baseUrl: e.target.value,
                      model: settings.providers.ollama?.model || 'llama2'
                    })}
                    placeholder="http://localhost:11434"
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      background: '#2a2a2a',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#fff'
                    }}
                  />
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#999' }}>
                    Model
                  </label>
                  <select
                    value={settings.providers.ollama?.model || 'llama2'}
                    onChange={(e) => handleProviderConfig('ollama', {
                      ...settings.providers.ollama,
                      baseUrl: settings.providers.ollama?.baseUrl || 'http://localhost:11434',
                      model: e.target.value
                    })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      background: '#2a2a2a',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#fff'
                    }}
                  >
                    {ollamaModels.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => testConnection('ollama')}
                    style={{
                      padding: '6px 12px',
                      background: '#0066cc',
                      border: 'none',
                      borderRadius: '4px',
                      color: '#fff',
                      cursor: 'pointer'
                    }}
                  >
                    Test Connection
                  </button>
                  <button
                    onClick={() => show({ type: 'info', title: 'Fetching Models', message: 'Fetching available models from Ollama...' })}
                    style={{
                      padding: '6px 12px',
                      background: '#555',
                      border: 'none',
                      borderRadius: '4px',
                      color: '#fff',
                      cursor: 'pointer'
                    }}
                  >
                    Fetch Available Models
                  </button>
                </div>
              </div>
            </details>

            {/* Hugging Face */}
            <details style={{ marginBottom: '16px' }}>
              <summary style={{ cursor: 'pointer', padding: '8px', background: '#2a2a2a', borderRadius: '4px' }}>
                Hugging Face Configuration
              </summary>
              <div style={{ padding: '16px', background: '#1a1a1a', borderRadius: '4px', marginTop: '8px' }}>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#999' }}>
                    API Token
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type={showApiKey.huggingface ? 'text' : 'password'}
                      value={settings.providers.huggingface?.apiToken || ''}
                      onChange={(e) => handleProviderConfig('huggingface', {
                        ...settings.providers.huggingface,
                        apiToken: e.target.value,
                        model: settings.providers.huggingface?.model || 'codellama/CodeLlama-7b-Instruct-hf'
                      })}
                      placeholder="hf_..."
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        background: '#2a2a2a',
                        border: '1px solid #444',
                        borderRadius: '4px',
                        color: '#fff'
                      }}
                    />
                    <button
                      onClick={() => toggleApiKeyVisibility('huggingface')}
                      style={{
                        padding: '6px 12px',
                        background: '#333',
                        border: '1px solid #444',
                        borderRadius: '4px',
                        color: '#fff',
                        cursor: 'pointer'
                      }}
                    >
                      {showApiKey.huggingface ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#999' }}>
                    Model ID
                  </label>
                  <input
                    type="text"
                    value={settings.providers.huggingface?.model || 'codellama/CodeLlama-7b-Instruct-hf'}
                    onChange={(e) => handleProviderConfig('huggingface', {
                      ...settings.providers.huggingface,
                      apiToken: settings.providers.huggingface?.apiToken || '',
                      model: e.target.value
                    })}
                    placeholder="organization/model-name"
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      background: '#2a2a2a',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#fff'
                    }}
                  />
                </div>
                <button
                  onClick={() => testConnection('huggingface')}
                  style={{
                    padding: '6px 12px',
                    background: '#0066cc',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                >
                  Test Connection
                </button>
              </div>
            </details>
          </div>

          {/* Generation Settings */}
          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ marginBottom: '16px', fontSize: '14px', fontWeight: 600 }}>
              Generation Settings
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#999' }}>
                  Temperature (0.0 - 1.0)
                </label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  value={settings.generation.temperature}
                  onChange={(e) => onChange({
                    ...settings,
                    generation: {
                      ...settings.generation,
                      temperature: parseFloat(e.target.value)
                    }
                  })}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    background: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: '4px',
                    color: '#fff'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#999' }}>
                  Max Tokens
                </label>
                <input
                  type="number"
                  min="100"
                  max="8000"
                  step="100"
                  value={settings.generation.maxTokens}
                  onChange={(e) => onChange({
                    ...settings,
                    generation: {
                      ...settings.generation,
                      maxTokens: parseInt(e.target.value)
                    }
                  })}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    background: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: '4px',
                    color: '#fff'
                  }}
                />
              </div>
            </div>
            <div style={{ marginTop: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#999' }}>
                System Prompt (Optional)
              </label>
              <textarea
                value={settings.generation.systemPrompt || ''}
                onChange={(e) => onChange({
                  ...settings,
                  generation: {
                    ...settings.generation,
                    systemPrompt: e.target.value || undefined
                  }
                })}
                placeholder="You are a helpful terminal assistant that generates shell commands..."
                rows={3}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  background: '#2a2a2a',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  color: '#fff',
                  fontFamily: 'monospace',
                  fontSize: '12px'
                }}
              />
            </div>
          </div>

          {/* Privacy Settings */}
          <div>
            <h4 style={{ marginBottom: '16px', fontSize: '14px', fontWeight: 600 }}>
              Privacy Settings
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                <input
                  type="checkbox"
                  checked={settings.privacy.sendContext}
                  onChange={(e) => onChange({
                    ...settings,
                    privacy: {
                      ...settings.privacy,
                      sendContext: e.target.checked
                    }
                  })}
                />
                <span>Send context (current directory, shell type)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                <input
                  type="checkbox"
                  checked={settings.privacy.storeHistory}
                  onChange={(e) => onChange({
                    ...settings,
                    privacy: {
                      ...settings.privacy,
                      storeHistory: e.target.checked
                    }
                  })}
                />
                <span>Store command generation history</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                <input
                  type="checkbox"
                  checked={settings.privacy.offlineOnly}
                  onChange={(e) => onChange({
                    ...settings,
                    privacy: {
                      ...settings.privacy,
                      offlineOnly: e.target.checked
                    }
                  })}
                />
                <span>Offline only (use only local models like Ollama)</span>
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  );
}