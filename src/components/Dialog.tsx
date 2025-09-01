import React, { useEffect, useRef } from 'react';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ isOpen, onClose, title, children, className = '' }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Focus trap
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ 
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(2px)'
        }}
        onClick={onClose}
      />
      
      {/* Dialog */}
      <div 
        ref={dialogRef}
        className={className}
        style={{
          position: 'relative',
          backgroundColor: '#1a1a1a',
          borderRadius: '8px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          width: '90%',
          maxWidth: className?.includes('max-w-') ? undefined : '800px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid #333'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #333',
          padding: '16px 24px'
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#fff' }}>{title}</h2>
          <button
            onClick={onClose}
            style={{ 
              fontSize: '24px', 
              lineHeight: '20px',
              padding: '4px 8px',
              background: 'transparent',
              border: 'none',
              color: '#999',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#333'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>
        
        {/* Content */}
        <div style={{ 
          flex: 1,
          overflowY: 'auto',
          color: '#ddd',
          padding: '24px'
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}