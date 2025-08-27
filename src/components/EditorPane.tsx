import React, { useEffect, useRef, useState } from 'react';
import Editor, { Monaco } from '@monaco-editor/react';
import { getCachedConfig } from '@/services/settings';
import { DEFAULT_CONFIG } from '@/types/settings';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { sshSftpRead, sshSftpWrite } from '@/types/ipc';

interface EditorPaneProps {
  filePath: string;
  sessionId?: string; // SSH session ID if editing remote file
  isLocal?: boolean;
  onModified?: (modified: boolean) => void;
  onSave?: () => void;
  onClose?: () => void;
}

export default function EditorPane({ 
  filePath, 
  sessionId, 
  isLocal = true,
  onModified,
  onSave,
  onClose
}: EditorPaneProps) {
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modified, setModified] = useState(false);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);

  // Get editor settings
  const config = getCachedConfig();
  const editorSettings = config?.editor || DEFAULT_CONFIG.editor;

  // Load file content
  useEffect(() => {
    async function loadFile() {
      try {
        setLoading(true);
        setError(null);
        
        let fileContent: string;
        if (isLocal) {
          // Load local file
          fileContent = await readTextFile(filePath);
        } else if (sessionId) {
          // Load remote file via SSH
          const result = await sshSftpRead(sessionId, filePath);
          // Decode base64 response
          fileContent = atob(result);
        } else {
          throw new Error('Remote file requires session ID');
        }
        
        setContent(fileContent);
        setOriginalContent(fileContent);
        setModified(false);
      } catch (err) {
        setError(`Failed to load file: ${err}`);
        console.error('Failed to load file:', err);
      } finally {
        setLoading(false);
      }
    }

    loadFile();
  }, [filePath, sessionId, isLocal]);

  // Save file
  const saveFile = async () => {
    try {
      if (isLocal) {
        // Save local file
        await writeTextFile(filePath, content);
      } else if (sessionId) {
        // Save remote file via SSH
        // Encode content to base64
        const b64Content = btoa(content);
        await sshSftpWrite(sessionId, filePath, b64Content);
      }
      
      setOriginalContent(content);
      setModified(false);
      onModified?.(false);
      onSave?.();
    } catch (err) {
      setError(`Failed to save file: ${err}`);
      console.error('Failed to save file:', err);
    }
  };

  // Handle editor mount
  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Set up keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveFile();
    });

    // Focus the editor
    editor.focus();
  };

  // Handle content change
  const handleChange = (value: string | undefined) => {
    const newContent = value || '';
    setContent(newContent);
    const isModified = newContent !== originalContent;
    setModified(isModified);
    onModified?.(isModified);
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

  if (loading) {
    return (
      <div style={{ 
        height: '100%', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        color: '#888'
      }}>
        Loading {filePath}...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        height: '100%', 
        padding: 20,
        color: '#ff6666'
      }}>
        <div>{error}</div>
        <button 
          onClick={() => window.location.reload()}
          style={{
            marginTop: 10,
            padding: '5px 10px',
            background: '#333',
            border: '1px solid #555',
            borderRadius: 4,
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid #333',
        background: '#1e1e1e'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#888', fontSize: 12 }}>
            {isLocal ? '📁' : '🌐'} {filePath}
          </span>
          {modified && <span style={{ color: '#ffaa00', fontSize: 12 }}>● Modified</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={saveFile}
            disabled={!modified}
            style={{
              padding: '4px 12px',
              background: modified ? '#0078d4' : '#333',
              border: 'none',
              borderRadius: 4,
              color: modified ? '#fff' : '#666',
              cursor: modified ? 'pointer' : 'not-allowed',
              fontSize: 12
            }}
          >
            Save (⌘S)
          </button>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                padding: '4px 12px',
                background: '#333',
                border: '1px solid #555',
                borderRadius: 4,
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Monaco Editor */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          value={content}
          onChange={handleChange}
          onMount={handleEditorDidMount}
          language={getLanguage(filePath)}
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
      </div>
    </div>
  );
}