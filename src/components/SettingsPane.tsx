import React, { useState, useEffect } from 'react';
import { 
  loadGlobalConfig, 
  saveGlobalConfig, 
  resetSection, 
  resetAllSettings,
  exportConfig,
  importConfig
} from '@/services/settings';
import { GlobalConfig, DEFAULT_CONFIG } from '@/types/settings';
import { getThemeList, themes } from '@/config/themes';
import { useToasts } from '@/store/toasts';
import { getAvailableShells, ShellInfo } from '@/types/ipc';

interface SettingsPaneProps {
  onClose?: () => void;
}

export const SettingsPane: React.FC<SettingsPaneProps> = ({ onClose }) => {
  const { show } = useToasts();
  const [activeTab, setActiveTab] = useState<'general' | 'terminal' | 'editor' | 'ssh' | 'advanced'>('general');
  const [config, setConfig] = useState<GlobalConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [availableShells, setAvailableShells] = useState<ShellInfo[]>([]);
  const [showCustomShell, setShowCustomShell] = useState(false);

  useEffect(() => {
    loadSettings();
    loadShells();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const loaded = await loadGlobalConfig();
      setConfig(loaded);
      setIsDirty(false);
      // Check if the current shell is a custom one
      if (loaded.general.defaultShell && 
          availableShells.length > 0 &&
          !availableShells.some(s => s.path === loaded.general.defaultShell)) {
        setShowCustomShell(true);
      }
    } catch (error) {
      show({ title: 'Failed to load settings', message: String(error), kind: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const loadShells = async () => {
    try {
      const shells = await getAvailableShells();
      setAvailableShells(shells);
    } catch (error) {
      console.warn('Failed to load available shells:', error);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    try {
      await saveGlobalConfig(config);
      setIsDirty(false);
      show({ title: 'Settings saved', kind: 'success' });
    } catch (error) {
      show({ title: 'Failed to save settings', message: String(error), kind: 'error' });
    }
  };

  const handleReset = async (section?: keyof GlobalConfig) => {
    const confirmed = window.confirm(
      section 
        ? `Reset ${section} settings to defaults?` 
        : 'Reset all settings to defaults?'
    );
    if (!confirmed) return;

    try {
      if (section) {
        await resetSection(section);
      } else {
        await resetAllSettings();
      }
      await loadSettings();
      show({ title: 'Settings reset', kind: 'success' });
    } catch (error) {
      show({ title: 'Failed to reset settings', message: String(error), kind: 'error' });
    }
  };

  const handleExport = async () => {
    try {
      const json = await exportConfig();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'jaterm-settings.json';
      a.click();
      URL.revokeObjectURL(url);
      show({ title: 'Settings exported', kind: 'success' });
    } catch (error) {
      show({ title: 'Failed to export settings', message: String(error), kind: 'error' });
    }
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        await importConfig(text);
        await loadSettings();
        show({ title: 'Settings imported', kind: 'success' });
      } catch (error) {
        show({ title: 'Failed to import settings', message: String(error), kind: 'error' });
      }
    };
    input.click();
  };

  const updateConfig = (updater: (draft: GlobalConfig) => void) => {
    if (!config) return;
    const newConfig = { ...config };
    updater(newConfig);
    setConfig(newConfig);
    setIsDirty(true);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
        Loading settings...
      </div>
    );
  }

  if (!config) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
        Failed to load settings
      </div>
    );
  }

  const tabButtonStyle = (isActive: boolean) => ({
    padding: '8px 16px',
    background: isActive ? '#333' : 'transparent',
    border: 'none',
    borderBottom: isActive ? '2px solid #0078d4' : '2px solid transparent',
    color: isActive ? '#fff' : '#aaa',
    cursor: 'pointer',
    fontSize: '14px'
  });

  const inputStyle = {
    background: '#2a2a2a',
    border: '1px solid #444',
    color: '#fff',
    padding: '6px 8px',
    borderRadius: 4,
    fontSize: '14px',
    width: '100%',
    maxWidth: '500px'
  };

  const labelStyle = {
    display: 'block',
    marginBottom: '4px',
    fontSize: '13px',
    color: '#ccc'
  };

  const sectionStyle = {
    marginBottom: '20px'
  };

  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      background: '#1e1e1e',
      color: '#eee'
    }}>
      {/* Header */}
      <div style={{ 
        padding: '16px 20px',
        borderBottom: '1px solid #333',
        background: '#252525'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 500 }}>Settings</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleExport}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                border: '1px solid #444',
                color: '#aaa',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              Export
            </button>
            <button
              onClick={handleImport}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                border: '1px solid #444',
                color: '#aaa',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              Import
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ 
        display: 'flex', 
        gap: 0,
        borderBottom: '1px solid #333',
        background: '#252525'
      }}>
        <button onClick={() => setActiveTab('general')} style={tabButtonStyle(activeTab === 'general')}>
          General
        </button>
        <button onClick={() => setActiveTab('terminal')} style={tabButtonStyle(activeTab === 'terminal')}>
          Terminal
        </button>
        <button onClick={() => setActiveTab('editor')} style={tabButtonStyle(activeTab === 'editor')}>
          Editor
        </button>
        <button onClick={() => setActiveTab('ssh')} style={tabButtonStyle(activeTab === 'ssh')}>
          SSH
        </button>
        <button onClick={() => setActiveTab('advanced')} style={tabButtonStyle(activeTab === 'advanced')}>
          Advanced
        </button>
      </div>

      {/* Content */}
      <div style={{ 
        flex: 1, 
        overflow: 'auto',
        padding: '20px 40px 20px 20px'
      }}>
        {activeTab === 'general' && (
          <div style={{ maxWidth: '800px' }}>
            <div style={sectionStyle}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config.general.autoCheckUpdates}
                  onChange={(e) => updateConfig(c => { c.general.autoCheckUpdates = e.target.checked; })}
                />
                <span>Automatically check for updates</span>
              </label>

              <label style={labelStyle}>Default Shell</label>
              <select
                style={{ ...inputStyle, marginBottom: showCustomShell ? '8px' : '12px' }}
                value={showCustomShell ? 'custom' : (config.general.defaultShell || '')}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === 'custom') {
                    setShowCustomShell(true);
                  } else {
                    setShowCustomShell(false);
                    updateConfig(c => { 
                      c.general.defaultShell = value || undefined; 
                    });
                  }
                }}
              >
                <option value="">System Default</option>
                {availableShells.map(shell => (
                  <option key={shell.path} value={shell.path}>
                    {shell.name}
                  </option>
                ))}
                <option value="custom">Custom...</option>
              </select>
              
              {showCustomShell && (
                <>
                  <input
                    style={{ ...inputStyle, marginBottom: '12px' }}
                    value={config.general.defaultShell || ''}
                    onChange={(e) => updateConfig(c => { 
                      c.general.defaultShell = e.target.value || undefined; 
                    })}
                    placeholder="Enter custom shell path (e.g., /usr/local/bin/fish)"
                  />
                </>
              )}

              <label style={labelStyle}>Default Working Directory</label>
              <select
                style={{ ...inputStyle, marginBottom: '12px' }}
                value={config.general.defaultWorkingDir}
                onChange={(e) => updateConfig(c => { c.general.defaultWorkingDir = e.target.value as any; })}
              >
                <option value="home">Home Directory</option>
                <option value="lastUsed">Last Used</option>
                <option value="custom">Custom</option>
              </select>

              {config.general.defaultWorkingDir === 'custom' && (
                <>
                  <label style={labelStyle}>Custom Working Directory</label>
                  <input
                    style={{ ...inputStyle, marginBottom: '12px' }}
                    value={config.general.customWorkingDir || ''}
                    onChange={(e) => updateConfig(c => { c.general.customWorkingDir = e.target.value || undefined; })}
                    placeholder="/path/to/directory"
                  />
                </>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config.general.autoSaveState}
                  onChange={(e) => updateConfig(c => { c.general.autoSaveState = e.target.checked; })}
                />
                <span>Auto-save application state</span>
              </label>

              {config.general.autoSaveState && (
                <>
                  <label style={labelStyle}>State Save Interval (seconds)</label>
                  <input
                    type="number"
                    style={{ ...inputStyle, marginBottom: '12px' }}
                    value={config.general.stateInterval}
                    onChange={(e) => updateConfig(c => { c.general.stateInterval = parseInt(e.target.value) || 60; })}
                    min="10"
                    max="600"
                  />
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === 'terminal' && (
          <div style={{ maxWidth: '800px' }}>
            <div style={sectionStyle}>
              <label style={labelStyle}>Font Size</label>
              <input
                type="number"
                style={{ ...inputStyle, marginBottom: '12px' }}
                value={config.terminal.fontSize}
                onChange={(e) => updateConfig(c => { c.terminal.fontSize = parseInt(e.target.value) || 14; })}
                min="8"
                max="32"
              />

              <label style={labelStyle}>Font Family</label>
              <input
                style={{ ...inputStyle, marginBottom: '12px' }}
                value={config.terminal.fontFamily}
                onChange={(e) => updateConfig(c => { c.terminal.fontFamily = e.target.value; })}
                placeholder="monospace"
              />

              <label style={labelStyle}>Line Height</label>
              <input
                type="number"
                step="0.1"
                style={{ ...inputStyle, marginBottom: '12px' }}
                value={config.terminal.lineHeight}
                onChange={(e) => updateConfig(c => { c.terminal.lineHeight = parseFloat(e.target.value) || 1.2; })}
                min="1"
                max="2"
              />

              <label style={labelStyle}>Cursor Style</label>
              <select
                style={{ ...inputStyle, marginBottom: '12px' }}
                value={config.terminal.cursorStyle}
                onChange={(e) => updateConfig(c => { c.terminal.cursorStyle = e.target.value as any; })}
              >
                <option value="block">Block</option>
                <option value="underline">Underline</option>
                <option value="bar">Bar</option>
              </select>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config.terminal.cursorBlink}
                  onChange={(e) => updateConfig(c => { c.terminal.cursorBlink = e.target.checked; })}
                />
                <span>Cursor Blink</span>
              </label>

              <label style={labelStyle}>Theme</label>
              <select
                style={{ ...inputStyle, marginBottom: '12px' }}
                value={config.terminal.theme}
                onChange={(e) => updateConfig(c => { c.terminal.theme = e.target.value; })}
              >
                {getThemeList().map(theme => (
                  <option key={theme.id} value={theme.id}>{theme.name}</option>
                ))}
              </select>

              <label style={labelStyle}>Scrollback Lines</label>
              <input
                type="number"
                style={{ ...inputStyle, marginBottom: '12px' }}
                value={config.terminal.scrollback}
                onChange={(e) => updateConfig(c => { c.terminal.scrollback = parseInt(e.target.value) || 1000; })}
                min="100"
                max="50000"
              />

              <label style={labelStyle}>Bell Style</label>
              <select
                style={{ ...inputStyle, marginBottom: '12px' }}
                value={config.terminal.bellStyle}
                onChange={(e) => updateConfig(c => { c.terminal.bellStyle = e.target.value as any; })}
              >
                <option value="none">None</option>
                <option value="visual">Visual</option>
                <option value="sound">Sound</option>
                <option value="both">Both</option>
              </select>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config.terminal.copyOnSelect}
                  onChange={(e) => updateConfig(c => { c.terminal.copyOnSelect = e.target.checked; })}
                />
                <span>Copy on Select</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config.terminal.rightClickSelectsWord}
                  onChange={(e) => updateConfig(c => { c.terminal.rightClickSelectsWord = e.target.checked; })}
                />
                <span>Right Click Selects Word</span>
              </label>

              {/* Preview */}
              <div style={{ marginTop: '20px' }}>
                <label style={labelStyle}>Preview</label>
                <div style={{
                  padding: '12px',
                  borderRadius: '4px',
                  border: '1px solid #444',
                  fontFamily: config.terminal.fontFamily,
                  fontSize: config.terminal.fontSize + 'px',
                  lineHeight: config.terminal.lineHeight,
                  background: themes[config.terminal.theme]?.colors.background || '#1e1e1e',
                  color: themes[config.terminal.theme]?.colors.foreground || '#ccc'
                }}>
                  <div>$ echo "Terminal preview"</div>
                  <div style={{ 
                    display: 'inline-block',
                    width: config.terminal.cursorStyle === 'bar' ? '2px' : '0.6em',
                    height: config.terminal.cursorStyle === 'underline' ? '2px' : '1em',
                    background: themes[config.terminal.theme]?.colors.cursor || '#fff',
                    marginTop: config.terminal.cursorStyle === 'underline' ? '-2px' : 0,
                    animation: config.terminal.cursorBlink ? 'blink 1s infinite' : 'none'
                  }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'editor' && (
          <div style={{ maxWidth: '800px' }}>
            <div style={sectionStyle}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config.editor.wordWrap}
                  onChange={(e) => updateConfig(c => { c.editor.wordWrap = e.target.checked; })}
                />
                <span>Word Wrap</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config.editor.showLineNumbers}
                  onChange={(e) => updateConfig(c => { c.editor.showLineNumbers = e.target.checked; })}
                />
                <span>Show Line Numbers</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config.editor.highlightActiveLine}
                  onChange={(e) => updateConfig(c => { c.editor.highlightActiveLine = e.target.checked; })}
                />
                <span>Highlight Active Line</span>
              </label>
            </div>
          </div>
        )}

        {activeTab === 'ssh' && (
          <div style={{ maxWidth: '800px' }}>
            <div style={sectionStyle}>
              <label style={labelStyle}>Default Port</label>
              <input
                type="number"
                style={{ ...inputStyle, marginBottom: '12px' }}
                value={config.ssh.defaultPort}
                onChange={(e) => updateConfig(c => { c.ssh.defaultPort = parseInt(e.target.value) || 22; })}
                min="1"
                max="65535"
              />

              <label style={labelStyle}>Keepalive Interval (seconds)</label>
              <input
                type="number"
                style={{ ...inputStyle, marginBottom: '12px' }}
                value={config.ssh.keepaliveInterval}
                onChange={(e) => updateConfig(c => { c.ssh.keepaliveInterval = parseInt(e.target.value) || 30; })}
                min="0"
                max="300"
              />

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config.ssh.compression}
                  onChange={(e) => updateConfig(c => { c.ssh.compression = e.target.checked; })}
                />
                <span>Enable Compression</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config.ssh.x11Forwarding}
                  onChange={(e) => updateConfig(c => { c.ssh.x11Forwarding = e.target.checked; })}
                />
                <span>X11 Forwarding</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config.ssh.agentForwarding}
                  onChange={(e) => updateConfig(c => { c.ssh.agentForwarding = e.target.checked; })}
                />
                <span>Agent Forwarding</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config.ssh.autoReconnect}
                  onChange={(e) => updateConfig(c => { c.ssh.autoReconnect = e.target.checked; })}
                />
                <span>Auto Reconnect</span>
              </label>

              {config.ssh.autoReconnect && (
                <>
                  <label style={labelStyle}>Reconnect Delay (seconds)</label>
                  <input
                    type="number"
                    style={{ ...inputStyle, marginBottom: '12px' }}
                    value={config.ssh.reconnectDelay}
                    onChange={(e) => updateConfig(c => { c.ssh.reconnectDelay = parseInt(e.target.value) || 5; })}
                    min="1"
                    max="60"
                  />
                </>
              )}

              <label style={labelStyle}>Helper Auto Consent</label>
              <select
                style={{ ...inputStyle, marginBottom: '12px' }}
                value={config.ssh.helperAutoConsent}
                onChange={(e) => updateConfig(c => { c.ssh.helperAutoConsent = e.target.value as any; })}
              >
                <option value="ask">Ask Every Time</option>
                <option value="always">Always Deploy</option>
                <option value="never">Never Deploy</option>
              </select>
            </div>
          </div>
        )}

        {activeTab === 'advanced' && (
          <div style={{ maxWidth: '800px' }}>
            <div style={sectionStyle}>
              <label style={labelStyle}>Log Level</label>
              <select
                style={{ ...inputStyle, marginBottom: '12px' }}
                value={config.advanced.logLevel}
                onChange={(e) => updateConfig(c => { c.advanced.logLevel = e.target.value as any; })}
              >
                <option value="error">Error</option>
                <option value="warn">Warning</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
              </select>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config.advanced.enableTelemetry}
                  onChange={(e) => updateConfig(c => { c.advanced.enableTelemetry = e.target.checked; })}
                />
                <span>Enable Telemetry</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="checkbox"
                  checked={config.advanced.experimentalFeatures}
                  onChange={(e) => updateConfig(c => { c.advanced.experimentalFeatures = e.target.checked; })}
                />
                <span>Enable Experimental Features</span>
              </label>

              <div style={{ marginTop: '30px' }}>
                <button
                  onClick={() => handleReset()}
                  style={{
                    padding: '8px 16px',
                    background: '#d32f2f',
                    border: 'none',
                    color: '#fff',
                    borderRadius: 4,
                    cursor: 'pointer'
                  }}
                >
                  Reset All Settings to Defaults
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '16px 20px',
        borderTop: '1px solid #333',
        background: '#252525',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <button
          onClick={() => handleReset(activeTab)}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            border: '1px solid #444',
            color: '#aaa',
            borderRadius: 4,
            cursor: 'pointer'
          }}
        >
          Reset {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
        </button>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid #444',
                color: '#aaa',
                borderRadius: 4,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!isDirty}
            style={{
              padding: '8px 16px',
              background: isDirty ? '#0078d4' : '#444',
              border: 'none',
              color: '#fff',
              borderRadius: 4,
              cursor: isDirty ? 'pointer' : 'not-allowed',
              opacity: isDirty ? 1 : 0.5
            }}
          >
            Apply
          </button>
        </div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
};