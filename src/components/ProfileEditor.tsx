import React, { useState } from 'react';
import { TerminalProfile } from '@/types/terminalProfile';
import { Dialog } from '@/components/Dialog';

interface ProfileEditorProps {
  profile: TerminalProfile;
  onSave: (profile: TerminalProfile) => void;
  onCancel: () => void;
}

export default function ProfileEditor({ profile, onSave, onCancel }: ProfileEditorProps) {
  const [editedProfile, setEditedProfile] = useState<TerminalProfile>({ ...profile });
  const [activeTab, setActiveTab] = useState<'general' | 'shell' | 'appearance' | 'behavior' | 'startup' | 'autodetect'>('general');

  const handleSave = () => {
    onSave(editedProfile);
  };

  const updateProfile = (updates: Partial<TerminalProfile>) => {
    setEditedProfile(prev => ({ ...prev, ...updates }));
  };

  const updateShell = (updates: Partial<TerminalProfile['shell']>) => {
    setEditedProfile(prev => ({
      ...prev,
      shell: { ...prev.shell, ...updates }
    }));
  };

  const updateAppearance = (updates: Partial<TerminalProfile['appearance']>) => {
    setEditedProfile(prev => ({
      ...prev,
      appearance: { ...prev.appearance, ...updates }
    }));
  };

  const updateBehavior = (updates: Partial<TerminalProfile['behavior']>) => {
    setEditedProfile(prev => ({
      ...prev,
      behavior: { ...prev.behavior, ...updates }
    }));
  };

  const updateStartup = (updates: Partial<TerminalProfile['startup']>) => {
    setEditedProfile(prev => ({
      ...prev,
      startup: { ...prev.startup, ...updates }
    }));
  };

  const updateAutoDetect = (updates: Partial<TerminalProfile['autoDetect']>) => {
    setEditedProfile(prev => ({
      ...prev,
      autoDetect: { ...prev.autoDetect, ...updates }
    }));
  };

  return (
    <Dialog
      isOpen={true}
      onClose={onCancel}
      title={editedProfile.id ? 'Edit Profile' : 'New Profile'}
      className="max-w-3xl"
    >
      <div className="flex h-[500px]">
        {/* Tabs */}
        <div className="w-48 border-r border-gray-200 dark:border-gray-700">
          <nav className="space-y-1 p-2">
            {[
              { id: 'general', label: 'General' },
              { id: 'shell', label: 'Shell' },
              { id: 'appearance', label: 'Appearance' },
              { id: 'behavior', label: 'Behavior' },
              { id: 'startup', label: 'Startup' },
              { id: 'autodetect', label: 'Auto-Detect' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`w-full text-left px-3 py-2 rounded text-sm ${
                  activeTab === tab.id
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 overflow-y-auto">
          {activeTab === 'general' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name *</label>
                <input
                  type="text"
                  value={editedProfile.name || ''}
                  onChange={e => updateProfile({ name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                  placeholder="Profile name"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Icon (Emoji)</label>
                <input
                  type="text"
                  value={editedProfile.icon || ''}
                  onChange={e => updateProfile({ icon: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                  placeholder="🖥️"
                  maxLength={2}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Color</label>
                <input
                  type="color"
                  value={editedProfile.color || '#000000'}
                  onChange={e => updateProfile({ color: e.target.value })}
                  className="w-full h-10 border border-gray-300 dark:border-gray-600 rounded"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={editedProfile.description || ''}
                  onChange={e => updateProfile({ description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                  rows={3}
                  placeholder="Profile description"
                />
              </div>
            </div>
          )}

          {activeTab === 'shell' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Shell Program</label>
                <input
                  type="text"
                  value={editedProfile.shell?.program || ''}
                  onChange={e => updateShell({ program: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 font-mono text-sm"
                  placeholder="/bin/bash"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Arguments</label>
                <input
                  type="text"
                  value={editedProfile.shell?.args?.join(' ') || ''}
                  onChange={e => updateShell({ args: e.target.value ? e.target.value.split(' ') : [] })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 font-mono text-sm"
                  placeholder="--login"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Working Directory</label>
                <input
                  type="text"
                  value={editedProfile.shell?.cwd || ''}
                  onChange={e => updateShell({ cwd: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 font-mono text-sm"
                  placeholder="~"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Environment Variables</label>
                <textarea
                  value={Object.entries(editedProfile.shell?.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
                  onChange={e => {
                    const env: Record<string, string> = {};
                    e.target.value.split('\n').forEach(line => {
                      const [key, ...valueParts] = line.split('=');
                      if (key) env[key] = valueParts.join('=');
                    });
                    updateShell({ env });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 font-mono text-sm"
                  rows={5}
                  placeholder="KEY=value"
                />
              </div>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Font Size</label>
                <input
                  type="number"
                  value={editedProfile.appearance?.fontSize || 14}
                  onChange={e => updateAppearance({ fontSize: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                  min={8}
                  max={72}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Font Family</label>
                <input
                  type="text"
                  value={editedProfile.appearance?.fontFamily || ''}
                  onChange={e => updateAppearance({ fontFamily: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 font-mono text-sm"
                  placeholder="monospace"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Line Height</label>
                <input
                  type="number"
                  value={editedProfile.appearance?.lineHeight || 1.2}
                  onChange={e => updateAppearance({ lineHeight: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                  min={0.5}
                  max={3}
                  step={0.1}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Cursor Style</label>
                <select
                  value={editedProfile.appearance?.cursorStyle || 'block'}
                  onChange={e => updateAppearance({ cursorStyle: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                >
                  <option value="block">Block</option>
                  <option value="underline">Underline</option>
                  <option value="bar">Bar</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Theme</label>
                <input
                  type="text"
                  value={editedProfile.appearance?.theme || ''}
                  onChange={e => updateAppearance({ theme: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                  placeholder="default"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Scrollback Lines</label>
                <input
                  type="number"
                  value={editedProfile.appearance?.scrollback || 1000}
                  onChange={e => updateAppearance({ scrollback: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                  min={100}
                  max={100000}
                />
              </div>
            </div>
          )}

          {activeTab === 'behavior' && (
            <div className="space-y-4">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="copyOnSelect"
                  checked={editedProfile.behavior?.copyOnSelect || false}
                  onChange={e => updateBehavior({ copyOnSelect: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="copyOnSelect" className="text-sm">Copy on select</label>
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="rightClickSelectsWord"
                  checked={editedProfile.behavior?.rightClickSelectsWord || false}
                  onChange={e => updateBehavior({ rightClickSelectsWord: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="rightClickSelectsWord" className="text-sm">Right click selects word</label>
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="pasteOnMiddleClick"
                  checked={editedProfile.behavior?.pasteOnMiddleClick || false}
                  onChange={e => updateBehavior({ pasteOnMiddleClick: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="pasteOnMiddleClick" className="text-sm">Paste on middle click</label>
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="confirmPaste"
                  checked={editedProfile.behavior?.confirmPaste || false}
                  onChange={e => updateBehavior({ confirmPaste: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="confirmPaste" className="text-sm">Confirm paste (for multi-line)</label>
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="wordWrap"
                  checked={editedProfile.behavior?.wordWrap || false}
                  onChange={e => updateBehavior({ wordWrap: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="wordWrap" className="text-sm">Word wrap</label>
              </div>
            </div>
          )}

          {activeTab === 'startup' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Startup Commands</label>
                <textarea
                  value={editedProfile.startup?.commands?.join('\n') || ''}
                  onChange={e => updateStartup({ 
                    commands: e.target.value ? e.target.value.split('\n').filter(cmd => cmd.trim()) : [] 
                  })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 font-mono text-sm"
                  rows={5}
                  placeholder="One command per line"
                />
                <p className="text-xs text-gray-500 mt-1">Commands to run when the terminal starts</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Startup Script</label>
                <input
                  type="text"
                  value={editedProfile.startup?.script || ''}
                  onChange={e => updateStartup({ script: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 font-mono text-sm"
                  placeholder="/path/to/script.sh"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Startup Delay (ms)</label>
                <input
                  type="number"
                  value={editedProfile.startup?.delay || 0}
                  onChange={e => updateStartup({ delay: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                  min={0}
                  max={10000}
                  step={100}
                />
              </div>
            </div>
          )}

          {activeTab === 'autodetect' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Directory Patterns</label>
                <textarea
                  value={editedProfile.autoDetect?.patterns?.join('\n') || ''}
                  onChange={e => updateAutoDetect({ 
                    patterns: e.target.value ? e.target.value.split('\n').filter(p => p.trim()) : [] 
                  })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 font-mono text-sm"
                  rows={4}
                  placeholder="**/package.json&#10;**/node_modules"
                />
                <p className="text-xs text-gray-500 mt-1">Glob patterns to match directories</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Git Branch Patterns</label>
                <input
                  type="text"
                  value={editedProfile.autoDetect?.gitBranch?.join(', ') || ''}
                  onChange={e => updateAutoDetect({ 
                    gitBranch: e.target.value ? e.target.value.split(',').map(b => b.trim()).filter(Boolean) : [] 
                  })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 font-mono text-sm"
                  placeholder="feature/*, develop"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Environment Variable Patterns</label>
                <textarea
                  value={Object.entries(editedProfile.autoDetect?.environment || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
                  onChange={e => {
                    const env: Record<string, string> = {};
                    e.target.value.split('\n').forEach(line => {
                      const [key, ...valueParts] = line.split('=');
                      if (key) env[key] = valueParts.join('=');
                    });
                    updateAutoDetect({ environment: env });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 font-mono text-sm"
                  rows={3}
                  placeholder="NODE_ENV=development"
                />
                <p className="text-xs text-gray-500 mt-1">Environment variables that trigger this profile</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Save Profile
        </button>
      </div>
    </Dialog>
  );
}