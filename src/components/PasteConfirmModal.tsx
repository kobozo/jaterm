import React from 'react';

interface PasteConfirmModalProps {
  content: string;
  source: 'middle-click' | 'context-menu' | 'keyboard';
  onConfirm: () => void;
  onCancel: () => void;
  onDontAskAgain?: () => void;
}

export default function PasteConfirmModal({ 
  content, 
  source, 
  onConfirm, 
  onCancel,
  onDontAskAgain 
}: PasteConfirmModalProps) {
  const [dontAskAgain, setDontAskAgain] = React.useState(false);
  
  // Truncate content for preview if too long
  const MAX_PREVIEW_LENGTH = 200;
  const isLong = content.length > MAX_PREVIEW_LENGTH;
  const preview = isLong 
    ? content.substring(0, MAX_PREVIEW_LENGTH) + '...' 
    : content;
  
  // Count lines for additional context
  const lineCount = content.split('\n').length;
  const charCount = content.length;
  
  const handleConfirm = () => {
    if (dontAskAgain && onDontAskAgain) {
      onDontAskAgain();
    }
    onConfirm();
  };
  
  const sourceText = {
    'middle-click': 'middle mouse button',
    'context-menu': 'context menu',
    'keyboard': 'keyboard shortcut'
  }[source];
  
  return (
    <div style={{ 
      position: 'fixed', 
      inset: 0, 
      display: 'grid', 
      placeItems: 'center', 
      background: 'rgba(0,0,0,0.5)', 
      zIndex: 1000 
    }}>
      <div style={{ 
        background: '#1e1e1e', 
        color: '#eee', 
        padding: 24, 
        borderRadius: 8, 
        maxWidth: 600,
        minWidth: 400,
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
      }}>
        <h3 style={{ margin: '0 0 16px 0' }}>Confirm Paste</h3>
        
        <div style={{ marginBottom: 20 }}>
          <p style={{ margin: '0 0 12px 0', color: '#aaa', fontSize: 14 }}>
            Paste from {sourceText} • {charCount} characters • {lineCount} line{lineCount !== 1 ? 's' : ''}
          </p>
          
          <div style={{
            background: '#0d0d0d',
            border: '1px solid #333',
            borderRadius: 4,
            padding: 12,
            fontFamily: 'monospace',
            fontSize: 13,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 200,
            overflow: 'auto'
          }}>
            {preview}
          </div>
          
          {isLong && (
            <p style={{ 
              margin: '8px 0 0 0', 
              color: '#888', 
              fontSize: 12,
              fontStyle: 'italic'
            }}>
              Preview shows first {MAX_PREVIEW_LENGTH} characters of {charCount} total
            </p>
          )}
        </div>
        
        <div style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: 16
        }}>
          <input
            type="checkbox"
            id="dontAskAgain"
            checked={dontAskAgain}
            onChange={(e) => setDontAskAgain(e.target.checked)}
            style={{ marginRight: 8 }}
          />
          <label 
            htmlFor="dontAskAgain" 
            style={{ 
              fontSize: 14, 
              color: '#aaa',
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            Don't ask again (can be changed in settings)
          </label>
        </div>

        <div style={{ 
          display: 'flex', 
          gap: 12, 
          justifyContent: 'flex-end',
          borderTop: '1px solid #444',
          paddingTop: 16
        }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 20px',
              background: 'transparent',
              border: '1px solid #444',
              borderRadius: 4,
              color: '#aaa',
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            style={{
              padding: '8px 20px',
              background: '#0078d4',
              border: 'none',
              borderRadius: 4,
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500
            }}
          >
            Paste
          </button>
        </div>
      </div>
    </div>
  );
}