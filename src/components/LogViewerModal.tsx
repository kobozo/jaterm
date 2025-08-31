import React from 'react';
import { logger } from '@/services/logger';

interface LogViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LogViewerModal: React.FC<LogViewerModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const logs = logger.getLogBuffer();
  const logText = logs.map(log => {
    const timestamp = new Date(log.timestamp).toLocaleString();
    const level = log.level.toUpperCase().padEnd(5);
    const source = log.source ? `[${log.source}]` : '';
    const data = log.data ? `\n  Data: ${JSON.stringify(log.data, null, 2)}` : '';
    return `${timestamp} ${level} ${source} ${log.message}${data}`;
  }).join('\n');

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#1e1e1e',
          borderRadius: '8px',
          width: '80%',
          maxWidth: '1200px',
          height: '80%',
          maxHeight: '800px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #333',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>
            Application Logs ({logs.length} entries)
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#999',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 8px',
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Log content */}
        <div style={{ flex: 1, padding: '20px', overflow: 'hidden' }}>
          {logs.length === 0 ? (
            <div style={{ 
              textAlign: 'center', 
              color: '#666',
              marginTop: '40px',
              fontSize: '14px'
            }}>
              No logs in buffer. Logs will appear here as the application runs.
            </div>
          ) : (
            <textarea
              readOnly
              value={logText}
              style={{
                width: '100%',
                height: '100%',
                backgroundColor: '#0d0d0d',
                color: '#e0e0e0',
                border: '1px solid #333',
                borderRadius: '4px',
                padding: '12px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '12px',
                lineHeight: '1.5',
                resize: 'none',
                outline: 'none',
              }}
              onFocus={(e) => {
                // Select all text when focused for easy copying
                e.target.select();
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid #333',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: '12px', color: '#666' }}>
            Tip: Click in the text area and press Ctrl/Cmd+A to select all, then Ctrl/Cmd+C to copy
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => {
                logger.clearBuffer();
                onClose();
              }}
              style={{
                padding: '8px 16px',
                background: '#666',
                border: 'none',
                color: '#fff',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Clear Logs
            </button>
            <button
              onClick={async () => {
                try {
                  const { save } = await import('@tauri-apps/plugin-dialog');
                  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
                  
                  const filename = `jaterm-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
                  const filePath = await save({
                    defaultPath: filename,
                    filters: [{
                      name: 'Text Files',
                      extensions: ['txt']
                    }]
                  });
                  
                  if (filePath) {
                    await writeTextFile(filePath, logText);
                  }
                } catch (error) {
                  console.error('Failed to export logs:', error);
                }
              }}
              style={{
                padding: '8px 16px',
                background: '#1976d2',
                border: 'none',
                color: '#fff',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Export to File
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px',
                background: '#4caf50',
                border: 'none',
                color: '#fff',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};