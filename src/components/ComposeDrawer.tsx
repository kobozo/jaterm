import React, { useCallback, useEffect, useState } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
};

export default function ComposeDrawer({ open, onClose, onSend }: Props) {
  const [text, setText] = useState('');

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (text.trim().length > 0) {
        onSend(text.endsWith('\n') ? text : text + '\n');
        setText('');
      }
    }
  }, [text, onSend]);

  useEffect(() => {
    const onGlobal = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (open) onClose();
      }
    };
    window.addEventListener('keydown', onGlobal);
    return () => window.removeEventListener('keydown', onGlobal);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 32, padding: 8, background: 'rgba(0,0,0,0.6)', borderTop: '1px solid #333' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Compose command… Shift+Enter for newline, Cmd/Ctrl+Enter to send"
          rows={4}
          style={{ flex: 1, width: '100%', background: '#111', color: '#ddd', border: '1px solid #333', borderRadius: 4, padding: 8 }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button onClick={onClose}>Close</button>
          <button onClick={() => { if (text.trim().length) { onSend(text.endsWith('\n') ? text : text + '\n'); setText(''); } }}>Send (Cmd/Ctrl+Enter)</button>
        </div>
      </div>
    </div>
  );
}

