import React, { useState, useCallback } from 'react';
import SplitView from '@/components/SplitView';
import LocalFilePanel from '@/components/LocalFilePanel';
import SftpPanel from '@/components/SftpPanel';
import TabbedEditor, { OpenFile } from '@/components/TabbedEditor';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { sshSftpRead, sshSftpWrite } from '@/types/ipc';
import { useToasts } from '@/store/toasts';

interface FileExplorerWithEditorProps {
  isLocal: boolean;
  sessionId?: string;
  cwd?: string | null;
  onCwdChange?: (next: string) => void;
  isActive?: boolean;
}

export default function FileExplorerWithEditor({
  isLocal,
  sessionId,
  cwd,
  onCwdChange,
  isActive = true
}: FileExplorerWithEditorProps) {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string>(cwd || '');
  const { show: showToast } = useToasts();

  // Load file content
  const loadFile = async (path: string): Promise<OpenFile> => {
    const file: OpenFile = {
      path,
      isLocal,
      sessionId,
      content: '',
      originalContent: '',
      modified: false,
      loading: true
    };

    try {
      let fileContent: string;
      if (isLocal) {
        fileContent = await readTextFile(path);
      } else if (sessionId) {
        const result = await sshSftpRead(sessionId, path);
        // Decode base64 response
        fileContent = atob(result);
      } else {
        throw new Error('Remote file requires session ID');
      }
      
      file.content = fileContent;
      file.originalContent = fileContent;
      file.loading = false;
    } catch (err) {
      file.error = String(err);
      file.loading = false;
    }

    return file;
  };

  // Handle opening a file
  const handleOpenFile = useCallback(async (path: string) => {
    // Check if already open
    const existing = openFiles.find(f => f.path === path);
    if (existing) {
      setActiveFile(path);
      return;
    }

    // Load and add file
    const file = await loadFile(path);
    setOpenFiles(prev => [...prev, file]);
    setActiveFile(path);
  }, [openFiles, isLocal, sessionId]);

  // Handle selecting a file tab
  const handleSelectFile = (path: string) => {
    setActiveFile(path);
  };

  // Handle closing a file
  const handleCloseFile = (path: string) => {
    setOpenFiles(prev => {
      const filtered = prev.filter(f => f.path !== path);
      // If closing active file, switch to another
      if (path === activeFile && filtered.length > 0) {
        setActiveFile(filtered[filtered.length - 1].path);
      } else if (filtered.length === 0) {
        setActiveFile(null);
      }
      return filtered;
    });
  };

  // Handle saving a file
  const handleSaveFile = async (file: OpenFile) => {
    try {
      if (file.isLocal) {
        await writeTextFile(file.path, file.content);
      } else if (file.sessionId) {
        // Encode content to base64
        const b64Content = btoa(file.content);
        await sshSftpWrite(file.sessionId, file.path, b64Content);
      }
      
      // Update original content
      setOpenFiles(prev => prev.map(f => 
        f.path === file.path 
          ? { ...f, originalContent: f.content, modified: false }
          : f
      ));
      
      showToast({ title: 'File saved', kind: 'success' });
    } catch (err) {
      showToast({ title: `Failed to save: ${err}`, kind: 'error' });
    }
  };

  // Handle content change
  const handleContentChange = (path: string, content: string) => {
    setOpenFiles(prev => prev.map(f => 
      f.path === path 
        ? { ...f, content, modified: content !== f.originalContent }
        : f
    ));
  };

  // Handle path change from explorer
  const handlePathChange = (next: string) => {
    setCurrentPath(next);
    onCwdChange?.(next);
  };

  // Get list of open and modified files for indicators
  const openFilePaths = openFiles.map(f => f.path);
  const modifiedFilePaths = openFiles.filter(f => f.modified).map(f => f.path);

  return (
    <div style={{ height: '100%', display: 'flex', background: '#1e1e1e' }}>
      <SplitView
        direction="row"
        size={30}
        minSize={200}
        maxSize={500}
      >
        {/* File Explorer Panel */}
        <div style={{ height: '100%', borderRight: '1px solid #333' }}>
          {isLocal ? (
            <LocalFilePanel
              cwd={currentPath}
              onCwdChange={handlePathChange}
              onOpenFile={handleOpenFile}
              isActive={isActive}
              openFiles={openFilePaths}
              activeFile={activeFile}
              modifiedFiles={modifiedFilePaths}
            />
          ) : (
            <SftpPanel
              sessionId={sessionId!}
              cwd={currentPath}
              onCwdChange={handlePathChange}
              onOpenFile={handleOpenFile}
              isActive={isActive}
              openFiles={openFilePaths}
              activeFile={activeFile}
              modifiedFiles={modifiedFilePaths}
            />
          )}
        </div>

        {/* Editor Panel */}
        <div style={{ height: '100%' }}>
          <TabbedEditor
            openFiles={openFiles}
            activeFile={activeFile}
            onSelectFile={handleSelectFile}
            onCloseFile={handleCloseFile}
            onSaveFile={handleSaveFile}
            onContentChange={handleContentChange}
          />
        </div>
      </SplitView>
    </div>
  );
}