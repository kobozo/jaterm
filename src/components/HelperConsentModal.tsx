import React from 'react';
import { open } from '@tauri-apps/plugin-shell';

interface HelperConsentModalProps {
  profileName: string;
  host: string;
  onConsent: (consent: 'yes' | 'no') => void;
  onCancel?: () => void;
}

export default function HelperConsentModal({ profileName, host, onConsent, onCancel }: HelperConsentModalProps) {
  const handleLearnMore = async () => {
    try {
      await open('https://github.com/kobozo/jaterm/wiki');
    } catch (err) {
      console.error('Failed to open wiki:', err);
    }
  };

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
        maxWidth: 500,
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
      }}>
        <h3 style={{ margin: '0 0 16px 0' }}>Helper Deployment Consent</h3>
        
        <div style={{ marginBottom: 20, lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 12px 0' }}>
            JaTerm wants to deploy a helper agent to <strong>{host}</strong> 
            {profileName && <> for profile "<strong>{profileName}</strong>"</>}.
          </p>
          
          <p style={{ margin: '0 0 12px 0' }}>
            The jaterm-helper enables:
          </p>
          <ul style={{ margin: '0 0 12px 0', paddingLeft: 24 }}>
            <li>Git repository status detection</li>
            <li>Working directory tracking</li>
            <li>Port detection for forwarding</li>
            <li>Enhanced terminal features</li>
          </ul>
          
          <p style={{ margin: '0 0 12px 0' }}>
            The helper is a small binary (~2MB) installed in <code>~/.jaterm-helper/</code> on the remote machine.
            It will auto-update when new versions are available.
          </p>
          
          <button
            onClick={handleLearnMore}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#0078d4',
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline',
              fontSize: 14,
            }}
          >
            Learn more about jaterm-helper →
          </button>
        </div>

        <div style={{ 
          display: 'flex', 
          gap: 12, 
          justifyContent: 'flex-end',
          borderTop: '1px solid #444',
          paddingTop: 16,
          marginTop: 16
        }}>
          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid #444',
                borderRadius: 4,
                color: '#aaa',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}
          <button
            onClick={() => onConsent('no')}
            style={{
              padding: '8px 16px',
              background: '#444',
              border: 'none',
              borderRadius: 4,
              color: '#eee',
              cursor: 'pointer',
            }}
          >
            Don't Deploy
          </button>
          <button
            onClick={() => onConsent('yes')}
            style={{
              padding: '8px 16px',
              background: '#0078d4',
              border: 'none',
              borderRadius: 4,
              color: 'white',
              cursor: 'pointer',
            }}
          >
            Allow & Deploy
          </button>
        </div>
      </div>
    </div>
  );
}