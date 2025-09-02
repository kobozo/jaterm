import React from 'react';
import { TerminalSettings, ShellSettings } from '@/store/persist';
import { getThemeList } from '@/config/themes';
import { getCachedConfig } from '@/services/settings';
import { DEFAULT_CONFIG } from '@/types/settings';

interface TerminalSettingsEditorProps {
  terminalSettings?: TerminalSettings;
  shellSettings?: ShellSettings;
  onTerminalChange: (settings: TerminalSettings) => void;
  onShellChange: (settings: ShellSettings) => void;
}

export function TerminalSettingsEditor({
  terminalSettings = {},
  shellSettings = {},
  onTerminalChange,
  onShellChange
}: TerminalSettingsEditorProps) {
  const themes = getThemeList();
  
  // Get global defaults from settings
  const globalConfig = getCachedConfig();
  const terminalDefaults = globalConfig?.terminal || DEFAULT_CONFIG.terminal;
  const shellDefaults = globalConfig?.shell || DEFAULT_CONFIG.shell;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Terminal Appearance */}
      <div>
        <h4 style={{ margin: '0 0 12px 0', color: '#ddd', fontSize: '14px', fontWeight: 600 }}>
          Terminal Appearance
        </h4>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '12px', color: '#999' }}>Font Size</span>
            <input
              type="number"
              min="8"
              max="32"
              value={terminalSettings.fontSize || ''}
              placeholder={terminalDefaults.fontSize.toString()}
              onChange={(e) => onTerminalChange({
                ...terminalSettings,
                fontSize: e.target.value ? parseInt(e.target.value) : undefined
              })}
              style={{ padding: '6px 8px', background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, color: '#fff' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '12px', color: '#999' }}>Font Family</span>
            <input
              type="text"
              value={terminalSettings.fontFamily || ''}
              placeholder={terminalDefaults.fontFamily}
              onChange={(e) => onTerminalChange({
                ...terminalSettings,
                fontFamily: e.target.value || undefined
              })}
              style={{ padding: '6px 8px', background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, color: '#fff' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '12px', color: '#999' }}>Line Height</span>
            <input
              type="number"
              min="1"
              max="3"
              step="0.1"
              value={terminalSettings.lineHeight || ''}
              placeholder={terminalDefaults.lineHeight.toString()}
              onChange={(e) => onTerminalChange({
                ...terminalSettings,
                lineHeight: e.target.value ? parseFloat(e.target.value) : undefined
              })}
              style={{ padding: '6px 8px', background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, color: '#fff' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '12px', color: '#999' }}>Theme</span>
            <select
              value={terminalSettings.theme || ''}
              onChange={(e) => onTerminalChange({
                ...terminalSettings,
                theme: e.target.value || undefined
              })}
              style={{ padding: '6px 8px', background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, color: '#fff' }}
            >
              <option value="">Default</option>
              {themes.map(theme => (
                <option key={theme.key} value={theme.key}>{theme.name}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '12px', color: '#999' }}>Cursor Style</span>
            <select
              value={terminalSettings.cursorStyle || ''}
              onChange={(e) => onTerminalChange({
                ...terminalSettings,
                cursorStyle: e.target.value as 'block' | 'underline' | 'bar' | undefined
              })}
              style={{ padding: '6px 8px', background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, color: '#fff' }}
            >
              <option value="">Default</option>
              <option value="block">Block</option>
              <option value="underline">Underline</option>
              <option value="bar">Bar</option>
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={terminalSettings.cursorBlink !== false}
              onChange={(e) => onTerminalChange({
                ...terminalSettings,
                cursorBlink: e.target.checked ? undefined : false
              })}
            />
            <span style={{ fontSize: '12px', color: '#999' }}>Cursor Blink</span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '12px', color: '#999' }}>Scrollback Lines</span>
            <input
              type="number"
              min="100"
              max="100000"
              value={terminalSettings.scrollback || ''}
              placeholder={terminalDefaults.scrollback.toString()}
              onChange={(e) => onTerminalChange({
                ...terminalSettings,
                scrollback: e.target.value ? parseInt(e.target.value) : undefined
              })}
              style={{ padding: '6px 8px', background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, color: '#fff' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '12px', color: '#999' }}>Bell Style</span>
            <select
              value={terminalSettings.bellStyle || ''}
              onChange={(e) => onTerminalChange({
                ...terminalSettings,
                bellStyle: e.target.value as 'none' | 'visual' | 'sound' | 'both' | undefined
              })}
              style={{ padding: '6px 8px', background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, color: '#fff' }}
            >
              <option value="">Default</option>
              <option value="none">None</option>
              <option value="visual">Visual</option>
              <option value="sound">Sound</option>
              <option value="both">Both</option>
            </select>
          </label>
        </div>
      </div>

      {/* Shell Configuration */}
      <div>
        <h4 style={{ margin: '0 0 12px 0', color: '#ddd', fontSize: '14px', fontWeight: 600 }}>
          Shell Configuration
        </h4>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '12px', color: '#999' }}>Shell Program</span>
            <input
              type="text"
              value={shellSettings.shell || ''}
              placeholder={shellDefaults.defaultShell || "/bin/bash, /bin/zsh, etc."}
              onChange={(e) => onShellChange({
                ...shellSettings,
                shell: e.target.value || undefined
              })}
              style={{ padding: '6px 8px', background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, color: '#fff' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '12px', color: '#999' }}>Working Directory Behavior</span>
            <select
              value={shellSettings.workingDir || ''}
              onChange={(e) => onShellChange({
                ...shellSettings,
                workingDir: e.target.value as 'remember' | 'default' | 'prompt' | undefined
              })}
              style={{ padding: '6px 8px', background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, color: '#fff' }}
            >
              <option value="">Default</option>
              <option value="remember">Remember Last</option>
              <option value="default">Always Default</option>
              <option value="prompt">Prompt Each Time</option>
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '12px', color: '#999' }}>Environment Variables (KEY=value, one per line)</span>
            <textarea
              value={shellSettings.env ? Object.entries(shellSettings.env).map(([k, v]) => `${k}=${v}`).join('\n') : ''}
              placeholder={shellDefaults.defaultEnv ? Object.entries(shellDefaults.defaultEnv).map(([k, v]) => `${k}=${v}`).join('\n') : "TERM=xterm-256color\nEDITOR=vim"}
              onChange={(e) => {
                const env: Record<string, string> = {};
                e.target.value.split('\n').forEach(line => {
                  const [key, ...valueParts] = line.split('=');
                  if (key && valueParts.length > 0) {
                    env[key.trim()] = valueParts.join('=').trim();
                  }
                });
                onShellChange({
                  ...shellSettings,
                  env: Object.keys(env).length > 0 ? env : undefined
                });
              }}
              rows={3}
              style={{ padding: '6px 8px', background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, color: '#fff', fontFamily: 'monospace', fontSize: '12px' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '12px', color: '#999' }}>Startup Commands (one per line)</span>
            <textarea
              value={shellSettings.initCommands?.join('\n') || ''}
              placeholder={shellDefaults.defaultInitCommands?.length ? shellDefaults.defaultInitCommands.join('\n') : "cd ~/projects\nsource ~/.bashrc"}
              onChange={(e) => {
                const commands = e.target.value.split('\n').filter(cmd => cmd.trim());
                onShellChange({
                  ...shellSettings,
                  initCommands: commands.length > 0 ? commands : undefined
                });
              }}
              rows={3}
              style={{ padding: '6px 8px', background: '#2a2a2a', border: '1px solid #444', borderRadius: 4, color: '#fff', fontFamily: 'monospace', fontSize: '12px' }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}