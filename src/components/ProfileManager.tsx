import React, { useState, useEffect } from 'react';
import { TerminalProfile, validateProfile } from '@/types/terminalProfile';
import { profileManager } from '@/services/profileManager';
import { show } from '@/components/notifications';
import { Dialog } from '@/components/Dialog';
import ProfileEditor from './ProfileEditor';

interface ProfileManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProfile?: (profile: TerminalProfile) => void;
}

export default function ProfileManager({ isOpen, onClose, onSelectProfile }: ProfileManagerProps) {
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [groupedProfiles, setGroupedProfiles] = useState<Map<string, TerminalProfile[]>>(new Map());
  const [selectedProfile, setSelectedProfile] = useState<TerminalProfile | null>(null);
  const [editingProfile, setEditingProfile] = useState<TerminalProfile | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [defaultProfileId, setDefaultProfileId] = useState<string>('default');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      loadProfiles();
    }
  }, [isOpen]);

  const loadProfiles = async () => {
    try {
      setLoading(true);
      await profileManager.initialize();
      const allProfiles = profileManager.getAllProfiles();
      const grouped = profileManager.getGroupedProfiles();
      const defaultProfile = profileManager.getDefaultProfile();
      
      setProfiles(allProfiles);
      setGroupedProfiles(grouped);
      setDefaultProfileId(defaultProfile.id);
      
      if (!selectedProfile && allProfiles.length > 0) {
        setSelectedProfile(defaultProfile);
      }
    } catch (error) {
      console.error('Failed to load profiles:', error);
      show({ title: 'Error', message: 'Failed to load profiles', kind: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProfile = () => {
    setEditingProfile({
      id: crypto.randomUUID(),
      name: 'New Profile',
      description: '',
    } as TerminalProfile);
    setShowEditor(true);
  };

  const handleEditProfile = (profile: TerminalProfile) => {
    if (profile.isBuiltIn) {
      // Clone built-in profile
      handleDuplicateProfile(profile);
    } else {
      setEditingProfile(profile);
      setShowEditor(true);
    }
  };

  const handleSaveProfile = async (profile: TerminalProfile) => {
    try {
      const errors = validateProfile(profile);
      if (errors.length > 0) {
        show({ 
          title: 'Validation Error', 
          message: errors.join(', '), 
          kind: 'error' 
        });
        return;
      }

      if (profiles.find(p => p.id === profile.id)) {
        // Update existing
        await profileManager.updateProfile(profile.id, profile);
        show({ 
          title: 'Profile Updated', 
          message: `${profile.name} has been updated`, 
          kind: 'success' 
        });
      } else {
        // Create new
        await profileManager.createProfile(profile);
        show({ 
          title: 'Profile Created', 
          message: `${profile.name} has been created`, 
          kind: 'success' 
        });
      }

      setShowEditor(false);
      setEditingProfile(null);
      await loadProfiles();
    } catch (error) {
      console.error('Failed to save profile:', error);
      show({ 
        title: 'Error', 
        message: `Failed to save profile: ${error}`, 
        kind: 'error' 
      });
    }
  };

  const handleDeleteProfile = async (profile: TerminalProfile) => {
    if (profile.isBuiltIn) {
      show({ 
        title: 'Cannot Delete', 
        message: 'Built-in profiles cannot be deleted', 
        kind: 'warning' 
      });
      return;
    }

    if (confirm(`Are you sure you want to delete "${profile.name}"?`)) {
      try {
        await profileManager.deleteProfile(profile.id);
        show({ 
          title: 'Profile Deleted', 
          message: `${profile.name} has been deleted`, 
          kind: 'success' 
        });
        
        if (selectedProfile?.id === profile.id) {
          setSelectedProfile(null);
        }
        
        await loadProfiles();
      } catch (error) {
        console.error('Failed to delete profile:', error);
        show({ 
          title: 'Error', 
          message: `Failed to delete profile: ${error}`, 
          kind: 'error' 
        });
      }
    }
  };

  const handleDuplicateProfile = async (profile: TerminalProfile) => {
    try {
      const newProfile = await profileManager.duplicateProfile(profile.id);
      show({ 
        title: 'Profile Duplicated', 
        message: `Created "${newProfile.name}"`, 
        kind: 'success' 
      });
      await loadProfiles();
      setSelectedProfile(newProfile);
    } catch (error) {
      console.error('Failed to duplicate profile:', error);
      show({ 
        title: 'Error', 
        message: `Failed to duplicate profile: ${error}`, 
        kind: 'error' 
      });
    }
  };

  const handleSetDefault = async (profile: TerminalProfile) => {
    try {
      await profileManager.setDefaultProfile(profile.id);
      setDefaultProfileId(profile.id);
      show({ 
        title: 'Default Profile Set', 
        message: `${profile.name} is now the default profile`, 
        kind: 'success' 
      });
    } catch (error) {
      console.error('Failed to set default profile:', error);
      show({ 
        title: 'Error', 
        message: `Failed to set default profile: ${error}`, 
        kind: 'error' 
      });
    }
  };

  const handleExport = async () => {
    try {
      const json = profileManager.exportProfiles(false);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'terminal-profiles.json';
      a.click();
      URL.revokeObjectURL(url);
      
      show({ 
        title: 'Profiles Exported', 
        message: 'Custom profiles have been exported', 
        kind: 'success' 
      });
    } catch (error) {
      console.error('Failed to export profiles:', error);
      show({ 
        title: 'Error', 
        message: 'Failed to export profiles', 
        kind: 'error' 
      });
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
        const count = await profileManager.importProfiles(text, false);
        
        show({ 
          title: 'Profiles Imported', 
          message: `Imported ${count} profile${count !== 1 ? 's' : ''}`, 
          kind: 'success' 
        });
        
        await loadProfiles();
      } catch (error) {
        console.error('Failed to import profiles:', error);
        show({ 
          title: 'Error', 
          message: `Failed to import profiles: ${error}`, 
          kind: 'error' 
        });
      }
    };
    
    input.click();
  };

  const handleSelectAndClose = (profile: TerminalProfile) => {
    if (onSelectProfile) {
      onSelectProfile(profile);
      onClose();
    }
  };

  if (loading) {
    return (
      <Dialog isOpen={isOpen} onClose={onClose} title="Terminal Profiles">
        <div className="flex items-center justify-center p-8">
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading profiles...</div>
        </div>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog 
        isOpen={isOpen && !showEditor} 
        onClose={onClose} 
        title="Terminal Profiles"
        className="max-w-4xl"
      >
        <div className="flex h-[500px]">
          {/* Profile List */}
          <div className="w-1/3 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCreateProfile}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                <span className="nf-icon" style={{ fontSize: '14px' }}>{'\uf067'}</span>
                New Profile
              </button>
            </div>
            
            {Array.from(groupedProfiles.entries()).map(([group, groupProfiles]) => (
              <div key={group} className="mb-4">
                <div className="px-3 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                  {group}
                </div>
                {groupProfiles.map(profile => (
                  <button
                    key={profile.id}
                    onClick={() => setSelectedProfile(profile)}
                    onDoubleClick={() => handleSelectAndClose(profile)}
                    className={`w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2 ${
                      selectedProfile?.id === profile.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    <span className="text-lg">{profile.icon || '🖥️'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{profile.name}</div>
                      {profile.description && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {profile.description}
                        </div>
                      )}
                    </div>
                    {profile.id === defaultProfileId && (
                      <span className="nf-icon" style={{ fontSize: '14px', color: '#10b981' }} title="Default">{'\uf00c'}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Profile Details */}
          <div className="flex-1 p-4 overflow-y-auto">
            {selectedProfile ? (
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <span className="text-2xl">{selectedProfile.icon || '🖥️'}</span>
                      {selectedProfile.name}
                      {selectedProfile.isBuiltIn && (
                        <span className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded">
                          Built-in
                        </span>
                      )}
                    </h3>
                    {selectedProfile.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {selectedProfile.description}
                      </p>
                    )}
                  </div>
                  
                  <div className="flex gap-2">
                    {selectedProfile.id !== defaultProfileId && (
                      <button
                        onClick={() => handleSetDefault(selectedProfile)}
                        className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title="Set as default"
                      >
                        <span className="nf-icon" style={{ fontSize: '16px' }}>{'\uf00c'}</span>
                      </button>
                    )}
                    <button
                      onClick={() => handleDuplicateProfile(selectedProfile)}
                      className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                      title="Duplicate"
                    >
                      <span className="nf-icon" style={{ fontSize: '16px' }}>{'\uf0c5'}</span>
                    </button>
                    <button
                      onClick={() => handleEditProfile(selectedProfile)}
                      className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                      title={selectedProfile.isBuiltIn ? "Customize" : "Edit"}
                    >
                      <span className="nf-icon" style={{ fontSize: '16px' }}>{'\uf044'}</span>
                    </button>
                    {!selectedProfile.isBuiltIn && (
                      <button
                        onClick={() => handleDeleteProfile(selectedProfile)}
                        className="p-2 text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title="Delete"
                      >
                        <span className="nf-icon" style={{ fontSize: '16px' }}>{'\uf1f8'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Profile Configuration Display */}
                <div className="space-y-4">
                  {selectedProfile.shell && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Shell Configuration</h4>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded p-3 text-sm space-y-1">
                        {selectedProfile.shell.program && (
                          <div><span className="text-gray-500">Program:</span> {selectedProfile.shell.program}</div>
                        )}
                        {selectedProfile.shell.args && selectedProfile.shell.args.length > 0 && (
                          <div><span className="text-gray-500">Arguments:</span> {selectedProfile.shell.args.join(' ')}</div>
                        )}
                        {selectedProfile.shell.cwd && (
                          <div><span className="text-gray-500">Working Directory:</span> {selectedProfile.shell.cwd}</div>
                        )}
                        {selectedProfile.shell.env && Object.keys(selectedProfile.shell.env).length > 0 && (
                          <div>
                            <span className="text-gray-500">Environment:</span>
                            <div className="ml-4 mt-1">
                              {Object.entries(selectedProfile.shell.env).map(([key, value]) => (
                                <div key={key} className="font-mono text-xs">
                                  {key}={value}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedProfile.appearance && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Appearance</h4>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded p-3 text-sm grid grid-cols-2 gap-2">
                        {selectedProfile.appearance.fontSize && (
                          <div><span className="text-gray-500">Font Size:</span> {selectedProfile.appearance.fontSize}px</div>
                        )}
                        {selectedProfile.appearance.fontFamily && (
                          <div className="col-span-2"><span className="text-gray-500">Font:</span> {selectedProfile.appearance.fontFamily}</div>
                        )}
                        {selectedProfile.appearance.theme && (
                          <div><span className="text-gray-500">Theme:</span> {selectedProfile.appearance.theme}</div>
                        )}
                        {selectedProfile.appearance.cursorStyle && (
                          <div><span className="text-gray-500">Cursor:</span> {selectedProfile.appearance.cursorStyle}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedProfile.startup && (selectedProfile.startup.commands || selectedProfile.startup.script) && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Startup</h4>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded p-3 text-sm space-y-1">
                        {selectedProfile.startup.commands && selectedProfile.startup.commands.length > 0 && (
                          <div>
                            <span className="text-gray-500">Commands:</span>
                            <div className="ml-4 mt-1 font-mono text-xs">
                              {selectedProfile.startup.commands.map((cmd, i) => (
                                <div key={i}>{cmd}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        {selectedProfile.startup.script && (
                          <div><span className="text-gray-500">Script:</span> {selectedProfile.startup.script}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedProfile.autoDetect && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Auto-Detection Rules</h4>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded p-3 text-sm space-y-1">
                        {selectedProfile.autoDetect.patterns && selectedProfile.autoDetect.patterns.length > 0 && (
                          <div>
                            <span className="text-gray-500">Path Patterns:</span>
                            <div className="ml-4 mt-1 font-mono text-xs">
                              {selectedProfile.autoDetect.patterns.map((p, i) => (
                                <div key={i}>{p}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        {selectedProfile.autoDetect.gitBranch && selectedProfile.autoDetect.gitBranch.length > 0 && (
                          <div>
                            <span className="text-gray-500">Git Branches:</span> {selectedProfile.autoDetect.gitBranch.join(', ')}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Use Profile Button */}
                {onSelectProfile && (
                  <div className="mt-6">
                    <button
                      onClick={() => handleSelectAndClose(selectedProfile)}
                      className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      Use This Profile
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
                Select a profile to view details
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 flex justify-between">
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
            >
              <span className="nf-icon" style={{ fontSize: '14px' }}>{'\uf019'}</span>
              Export
            </button>
            <button
              onClick={handleImport}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
            >
              <span className="nf-icon" style={{ fontSize: '14px' }}>{'\uf093'}</span>
              Import
            </button>
          </div>
          
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            Close
          </button>
        </div>
      </Dialog>

      {/* Profile Editor Dialog */}
      {showEditor && editingProfile && (
        <ProfileEditor
          profile={editingProfile}
          onSave={handleSaveProfile}
          onCancel={() => {
            setShowEditor(false);
            setEditingProfile(null);
          }}
        />
      )}
    </>
  );
}