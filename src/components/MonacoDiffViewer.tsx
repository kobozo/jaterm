import React, { useRef } from 'react';
import { DiffEditor, Monaco } from '@monaco-editor/react';
import { getCachedConfig } from '@/services/settings';
import { DEFAULT_CONFIG } from '@/types/settings';

interface MonacoDiffViewerProps {
  originalContent: string;
  modifiedContent: string;
  language?: string;
  fileName?: string;
  isInline?: boolean;
  onStage?: (content: string) => void;
  onUnstage?: () => void;
  isStaged?: boolean;
}

function MonacoDiffViewerBase({
  originalContent,
  modifiedContent,
  language = 'plaintext',
  fileName,
  isInline = false,
  onStage,
  onUnstage,
  isStaged,
  onToggleInline
}: MonacoDiffViewerProps & { onToggleInline?: () => void }) {
  const diffEditorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  
  // Get editor settings
  const config = getCachedConfig();
  const editorSettings = config?.editor || DEFAULT_CONFIG.editor;

  // Handle diff editor mount
  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    diffEditorRef.current = editor;
    monacoRef.current = monaco;
  };

  // Get language from file extension
  const getLanguageFromFile = (path: string | undefined) => {
    if (!path) return 'plaintext';
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

  const detectedLanguage = fileName ? getLanguageFromFile(fileName) : language;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header with file info and actions */}
      {fileName && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid #333',
          background: '#1e1e1e'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#888', fontSize: 13 }}>
              {fileName}
            </span>
            {isStaged !== undefined && (
              <span style={{
                fontSize: 11,
                padding: '2px 6px',
                borderRadius: 3,
                background: isStaged ? '#2b5e2b' : '#5e2b2b',
                color: isStaged ? '#90ee90' : '#ff9090'
              }}>
                {isStaged ? 'Staged' : 'Unstaged'}
              </span>
            )}
          </div>
          
          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            {onToggleInline && (
              <button
                onClick={onToggleInline}
                style={{
                  padding: '4px 8px',
                  background: '#333',
                  border: '1px solid #555',
                  borderRadius: 4,
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 12
                }}
                title="Toggle inline/side-by-side view"
              >
                {isInline ? '⊞ Side by Side' : '≡ Inline'}
              </button>
            )}
            
            {onStage && !isStaged && (
              <button
                onClick={() => onStage(modifiedContent)}
                style={{
                  padding: '4px 12px',
                  background: '#2b5e2b',
                  border: 'none',
                  borderRadius: 4,
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 12
                }}
              >
                + Stage
              </button>
            )}
            
            {onUnstage && isStaged && (
              <button
                onClick={onUnstage}
                style={{
                  padding: '4px 12px',
                  background: '#5e2b2b',
                  border: 'none',
                  borderRadius: 4,
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 12
                }}
              >
                - Unstage
              </button>
            )}
          </div>
        </div>
      )}

      {/* Monaco Diff Editor */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <DiffEditor
          original={originalContent}
          modified={modifiedContent}
          language={detectedLanguage}
          onMount={handleEditorDidMount}
          theme="vs-dark"
          options={{
            readOnly: true,
            renderSideBySide: !isInline,
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: editorSettings.wordWrap ? 'on' : 'off',
            lineNumbers: editorSettings.showLineNumbers ? 'on' : 'off',
            renderLineHighlight: editorSettings.highlightActiveLine ? 'all' : 'none',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            folding: true,
            glyphMargin: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 3,
            overviewRulerLanes: 0,
            diffWordWrap: 'inherit',
            diffCodeLens: false,
            renderOverviewRuler: false,
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

// Export wrapper with state management
export default function MonacoDiffViewer(props: MonacoDiffViewerProps) {
  const [isInlineView, setIsInlineView] = React.useState(props.isInline || false);
  
  return (
    <MonacoDiffViewerBase 
      {...props} 
      isInline={isInlineView}
      onToggleInline={() => setIsInlineView(!isInlineView)}
    />
  );
}