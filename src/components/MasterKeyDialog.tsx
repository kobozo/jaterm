import React, { useState, useEffect } from 'react';
import {
  encryptionStatus,
  setMasterKey,
  verifyMasterKey,
  migrateProfilesToEncrypted,
  EncryptionStatus,
} from '../types/ipc';

interface MasterKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  mode: 'setup' | 'unlock';
  isMigration?: boolean;
}

export function MasterKeyDialog({ isOpen, onClose, onSuccess, mode, isMigration = false }: MasterKeyDialogProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<EncryptionStatus | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    if (isOpen) {
      encryptionStatus().then(setStatus);
      setPassword('');
      setConfirmPassword('');
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'setup') {
        // Validate passwords match
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          setLoading(false);
          return;
        }

        // Validate password strength
        if (password.length < 8) {
          setError('Password must be at least 8 characters');
          setLoading(false);
          return;
        }

        // Set the master key or migrate
        if (isMigration) {
          // Migrate plain text profiles to encrypted
          await migrateProfilesToEncrypted(password, 'jaterm');
        } else {
          // Just set the master key
          await setMasterKey(password);
        }
        onSuccess();
      } else {
        // Verify the master key (this also loads it into memory)
        const valid = await verifyMasterKey(password);
        if (valid) {
          // No need to call setMasterKey - verify already loaded the key
          onSuccess();
        } else {
          setError('Invalid master key. Please check your password and try again.');
          setPassword(''); // Clear the password field for retry
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      style={{ 
        position: 'fixed', 
        top: 0, 
        left: 0, 
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999
      }}
    >
      <div 
        style={{
          backgroundColor: '#1f2937',
          borderRadius: '8px',
          padding: '32px',
          width: '90%',
          maxWidth: '400px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div className="nf-icon" style={{ fontSize: '32px', color: '#3b82f6', marginBottom: '12px' }}>
            {'\uf023'}
          </div>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: 'white', marginBottom: '8px' }}>
            {mode === 'setup' ? 'Set Master Key' : 'Unlock Profiles'}
          </h2>
          <p style={{ fontSize: '14px', color: '#9ca3af' }}>
            {mode === 'setup' 
              ? 'Create a master key to encrypt your passwords and sensitive data' 
              : 'Enter your master key to decrypt your profiles'}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '14px', color: '#d1d5db', marginBottom: '4px' }}>
              Master Key
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 40px 8px 12px',
                  backgroundColor: '#374151',
                  border: '1px solid #4b5563',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
                placeholder="Enter master key..."
                autoFocus
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="nf-icon"
                style={{
                  position: 'absolute',
                  right: '8px',
                  padding: '4px 8px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: '#9ca3af',
                  cursor: 'pointer',
                  fontSize: '18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '\uf070' : '\uf06e'}
              </button>
            </div>
          </div>

          {mode === 'setup' && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '14px', color: '#d1d5db', marginBottom: '4px' }}>
                Confirm Master Key
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 40px 8px 12px',
                    backgroundColor: '#374151',
                    border: '1px solid #4b5563',
                    borderRadius: '6px',
                    color: 'white',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                  placeholder="Confirm master key..."
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="nf-icon"
                  style={{
                    position: 'absolute',
                    right: '8px',
                    padding: '4px 8px',
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: '#9ca3af',
                    cursor: 'pointer',
                    fontSize: '18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? '\uf070' : '\uf06e'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div style={{
              padding: '8px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '4px',
              color: '#ef4444',
              fontSize: '14px',
              marginBottom: '16px'
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="submit"
              disabled={loading}
              style={{
                flex: 1,
                padding: '10px',
                backgroundColor: loading ? '#4b5563' : '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1
              }}
            >
              {loading ? 'Processing...' : mode === 'setup' ? 'Set Master Key' : 'Unlock'}
            </button>
          </div>
        </form>

        {status?.hardware_security_available && (
          <p style={{ 
            fontSize: '12px', 
            color: '#10b981', 
            marginTop: '16px',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}>
            <span className="nf-icon" style={{ fontSize: '14px' }}>{'\uf058'}</span>
            Hardware security module detected
          </p>
        )}
      </div>
    </div>
  );
}