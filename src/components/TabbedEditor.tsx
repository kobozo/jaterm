import React, { useEffect, useRef, useState } from 'react';
import Editor, { Monaco } from '@monaco-editor/react';
import { getCachedConfig } from '@/services/settings';
import { DEFAULT_CONFIG } from '@/types/settings';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { sshSftpRead, sshSftpWrite } from '@/types/ipc';

export interface OpenFile {
  path: string;
  isLocal: boolean;
  sessionId?: string;
  content: string;
  originalContent: string;
  modified: boolean;
  language?: string;
  loading?: boolean;
  error?: string;
}

interface TabbedEditorProps {
  openFiles: OpenFile[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  onSaveFile: (file: OpenFile) => Promise<void>;
  onContentChange: (path: string, content: string) => void;
}

export default function TabbedEditor({
  openFiles,
  activeFile,
  onSelectFile,
  onCloseFile,
  onSaveFile,
  onContentChange
}: TabbedEditorProps) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  
  // Get editor settings
  const config = getCachedConfig();
  const editorSettings = config?.editor || DEFAULT_CONFIG.editor;

  // Get current file
  const currentFile = openFiles.find(f => f.path === activeFile);

  // Handle editor mount
  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Set up keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      if (currentFile && currentFile.modified) {
        await onSaveFile(currentFile);
      }
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
      if (activeFile) {
        handleCloseTab(activeFile);
      }
    });

    // Focus the editor
    editor.focus();
  };

  // Handle content change
  const handleChange = (value: string | undefined) => {
    if (activeFile && value !== undefined) {
      onContentChange(activeFile, value);
    }
  };

  // Handle close tab with save prompt
  const handleCloseTab = async (path: string) => {
    const file = openFiles.find(f => f.path === path);
    if (file?.modified) {
      if (confirm(`Save changes to ${path.split('/').pop()}?`)) {
        await onSaveFile(file);
      }
    }
    onCloseFile(path);
  };

  // Get file language from extension
  const getLanguage = (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js': return 'javascript';
      case 'jsx': return 'javascript';
      case 'ts': return 'typescript';
      case 'tsx': return 'typescript';
      case 'py': return 'python';
      case 'rs': return 'rust';
      case 'go': return 'go';
      case 'java': return 'java';
      case 'c': return 'c';
      case 'cpp':
      case 'cc':
      case 'cxx': return 'cpp';
      case 'h':
      case 'hpp': return 'cpp';
      case 'cs': return 'csharp';
      case 'php': return 'php';
      case 'rb': return 'ruby';
      case 'swift': return 'swift';
      case 'kt': return 'kotlin';
      case 'scala': return 'scala';
      case 'r': return 'r';
      case 'sql': return 'sql';
      case 'sh':
      case 'bash': return 'shell';
      case 'yaml':
      case 'yml': return 'yaml';
      case 'toml': return 'toml';
      case 'json': return 'json';
      case 'xml': return 'xml';
      case 'html': return 'html';
      case 'css': return 'css';
      case 'scss':
      case 'sass': return 'scss';
      case 'less': return 'less';
      case 'md': return 'markdown';
      case 'dockerfile': return 'dockerfile';
      case 'makefile': return 'makefile';
      default: return 'plaintext';
    }
  };

  // Get filename from path
  const getFilename = (path: string) => {
    return path.split('/').pop() || path;
  };

  if (openFiles.length === 0) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#888',
        flexDirection: 'column',
        gap: 12
      }}>
        <div style={{ fontSize: 48 }}>📝</div>
        <div>No files open</div>
        <div style={{ fontSize: 12 }}>
          Select a file from the explorer to start editing
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1e1e1e' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #333',
        background: '#252526',
        minHeight: 35,
        overflowX: 'auto'
      }}>
        {openFiles.map(file => (
          <div
            key={file.path}
            onClick={() => onSelectFile(file.path)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRight: '1px solid #333',
              background: file.path === activeFile ? '#1e1e1e' : '#2d2d30',
              color: file.path === activeFile ? '#fff' : '#969696',
              cursor: 'pointer',
              minWidth: 0,
              position: 'relative'
            }}
            title={file.path}
          >
            <span style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 6,
              maxWidth: 200,
              overflow: 'hidden'
            }}>
              {file.modified && (
                <span style={{ color: '#ffaa00', fontSize: 16 }}>●</span>
              )}
              <span style={{ 
                textOverflow: 'ellipsis', 
                overflow: 'hidden', 
                whiteSpace: 'nowrap' 
              }}>
                {getFilename(file.path)}
              </span>
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCloseTab(file.path);
              }}
              style={{
                padding: '0 2px',
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                opacity: 0.6
              }}
              title="Close"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Editor */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {currentFile ? (
          currentFile.loading ? (
            <div style={{ 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: '#888'
            }}>
              Loading {getFilename(currentFile.path)}...
            </div>
          ) : currentFile.error ? (
            <div style={{ 
              height: '100%', 
              padding: 20,
              color: '#ff6666'
            }}>
              <div>Error loading file: {currentFile.error}</div>
            </div>
          ) : (
            <Editor
              value={currentFile.content}
              onChange={handleChange}
              onMount={handleEditorDidMount}
              language={currentFile.language || getLanguage(currentFile.path)}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                wordWrap: editorSettings.wordWrap ? 'on' : 'off',
                lineNumbers: editorSettings.showLineNumbers ? 'on' : 'off',
                renderLineHighlight: editorSettings.highlightActiveLine ? 'all' : 'none',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                insertSpaces: true,
                folding: true,
                glyphMargin: false,
                lineDecorationsWidth: 0,
                lineNumbersMinChars: 3,
                overviewRulerLanes: 0,
                scrollbar: {
                  vertical: 'auto',
                  horizontal: 'auto',
                  useShadows: false,
                  verticalScrollbarSize: 10,
                  horizontalScrollbarSize: 10
                }
              }}
            />
          )
        ) : null}
      </div>
    </div>
  );
}