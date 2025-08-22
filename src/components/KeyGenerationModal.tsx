import React, { useState } from 'react';
import { generateSshKey, deployPublicKey, testKeyAuth, GeneratedKey } from '@/types/ipc';

interface KeyGenerationModalProps {
  sessionId: string;
  profileName: string;
  host: string;
  port: number;
  user: string;
  onSuccess: (keyPath: string, passphrase: string | null) => void;
  onCancel: () => void;
  onSkip: () => void;
}

export default function KeyGenerationModal({
  sessionId,
  profileName,
  host,
  port,
  user,
  onSuccess,
  onCancel,
  onSkip,
}: KeyGenerationModalProps) {
  const [step, setStep] = useState<'prompt' | 'generating' | 'deploying' | 'testing' | 'success' | 'error'>('prompt');
  const [algorithm, setAlgorithm] = useState<'ed25519' | 'rsa'>('ed25519');
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [usePassphrase, setUsePassphrase] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<GeneratedKey | null>(null);
  const [error, setError] = useState<string>('');

  const handleGenerate = async () => {
    // Validate passphrase
    if (usePassphrase) {
      if (!passphrase) {
        setError('Please enter a passphrase');
        return;
      }
      if (passphrase !== passphraseConfirm) {
        setError('Passphrases do not match');
        return;
      }
    }

    try {
      setStep('generating');
      setError('');

      // Generate the key
      const key = await generateSshKey(
        algorithm,
        usePassphrase ? passphrase : null,
        profileName
      );
      setGeneratedKey(key);

      // Deploy to server
      setStep('deploying');
      await deployPublicKey(sessionId, key.public_key_string);

      // Test the key
      setStep('testing');
      const success = await testKeyAuth(
        host,
        port,
        user,
        key.private_key_path,
        usePassphrase ? passphrase : null
      );

      if (success) {
        setStep('success');
        // Auto-close and apply after 2 seconds
        setTimeout(() => {
          onSuccess(key.private_key_path, usePassphrase ? passphrase : null);
        }, 2000);
      } else {
        throw new Error('Key authentication test failed');
      }
    } catch (err) {
      setError(String(err));
      setStep('error');
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
        maxWidth: 600,
        width: '90%',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
      }}>
        {step === 'prompt' && (
          <>
            <h3 style={{ margin: '0 0 16px 0' }}>Set Up SSH Key Authentication</h3>
            
            <div style={{ marginBottom: 20, lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 12px 0' }}>
                You're currently using password authentication. Would you like to set up more secure SSH key authentication?
              </p>
              
              <div style={{
                background: '#2d2d2d',
                padding: 12,
                borderRadius: 4,
                marginBottom: 12
              }}>
                <strong>Benefits of SSH Keys:</strong>
                <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                  <li>More secure than passwords</li>
                  <li>No need to enter password for each connection</li>
                  <li>Unique key for this profile</li>
                  <li>Can be protected with a passphrase</li>
                </ul>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8 }}>
                  Key Algorithm:
                </label>
                <div>
                  <label style={{ marginRight: 16 }}>
                    <input
                      type="radio"
                      checked={algorithm === 'ed25519'}
                      onChange={() => setAlgorithm('ed25519')}
                    />
                    {' '}ED25519 (Recommended - Fast & Secure)
                  </label>
                  <label>
                    <input
                      type="radio"
                      checked={algorithm === 'rsa'}
                      onChange={() => setAlgorithm('rsa')}
                    />
                    {' '}RSA 4096 (Compatible with older systems)
                  </label>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label>
                  <input
                    type="checkbox"
                    checked={usePassphrase}
                    onChange={(e) => setUsePassphrase(e.target.checked)}
                  />
                  {' '}Protect key with passphrase
                </label>
              </div>

              {usePassphrase && (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', marginBottom: 4 }}>
                      Passphrase:
                    </label>
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 8px',
                        background: '#2d2d2d',
                        border: '1px solid #444',
                        borderRadius: 4,
                        color: '#eee'
                      }}
                      placeholder="Enter passphrase"
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', marginBottom: 4 }}>
                      Confirm Passphrase:
                    </label>
                    <input
                      type="password"
                      value={passphraseConfirm}
                      onChange={(e) => setPassphraseConfirm(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 8px',
                        background: '#2d2d2d',
                        border: '1px solid #444',
                        borderRadius: 4,
                        color: '#eee'
                      }}
                      placeholder="Confirm passphrase"
                    />
                  </div>
                </>
              )}

              {error && (
                <div style={{
                  color: '#f44',
                  marginBottom: 12,
                  padding: 8,
                  background: 'rgba(255,68,68,0.1)',
                  borderRadius: 4
                }}>
                  {error}
                </div>
              )}
            </div>

            <div style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'flex-end',
              borderTop: '1px solid #444',
              paddingTop: 16,
              marginTop: 16
            }}>
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
              <button
                onClick={onSkip}
                style={{
                  padding: '8px 16px',
                  background: '#444',
                  border: 'none',
                  borderRadius: 4,
                  color: '#eee',
                  cursor: 'pointer',
                }}
              >
                Keep Using Password
              </button>
              <button
                onClick={handleGenerate}
                style={{
                  padding: '8px 16px',
                  background: '#0078d4',
                  border: 'none',
                  borderRadius: 4,
                  color: 'white',
                  cursor: 'pointer',
                }}
              >
                Generate & Deploy Key
              </button>
            </div>
          </>
        )}

        {step === 'generating' && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <h3>Generating SSH Key...</h3>
            <p style={{ color: '#aaa' }}>Creating {algorithm === 'ed25519' ? 'ED25519' : 'RSA 4096-bit'} key pair</p>
            <div style={{ marginTop: 20 }}>⏳</div>
          </div>
        )}

        {step === 'deploying' && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <h3>Deploying Public Key...</h3>
            <p style={{ color: '#aaa' }}>Adding key to ~/.ssh/authorized_keys on {host}</p>
            <div style={{ marginTop: 20 }}>📤</div>
          </div>
        )}

        {step === 'testing' && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <h3>Testing Key Authentication...</h3>
            <p style={{ color: '#aaa' }}>Verifying key works for {user}@{host}</p>
            <div style={{ marginTop: 20 }}>🔐</div>
          </div>
        )}

        {step === 'success' && generatedKey && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <h3 style={{ color: '#4a4' }}>✅ SSH Key Successfully Deployed!</h3>
            <div style={{
              background: '#2d2d2d',
              padding: 16,
              borderRadius: 4,
              marginTop: 20,
              textAlign: 'left'
            }}>
              <p style={{ margin: '0 0 8px 0' }}>
                <strong>Private Key:</strong><br />
                <code style={{ fontSize: 12 }}>{generatedKey.private_key_path}</code>
              </p>
              <p style={{ margin: '0 0 8px 0' }}>
                <strong>Fingerprint:</strong><br />
                <code style={{ fontSize: 12 }}>{generatedKey.fingerprint}</code>
              </p>
            </div>
            <p style={{ marginTop: 20, color: '#aaa' }}>
              Updating profile to use key authentication...
            </p>
          </div>
        )}

        {step === 'error' && (
          <div style={{ padding: 40 }}>
            <h3 style={{ color: '#f44' }}>❌ Key Setup Failed</h3>
            <div style={{
              background: 'rgba(255,68,68,0.1)',
              padding: 16,
              borderRadius: 4,
              marginTop: 20
            }}>
              <p style={{ margin: 0 }}>{error}</p>
            </div>
            <div style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'center',
              marginTop: 24
            }}>
              <button
                onClick={() => {
                  setStep('prompt');
                  setError('');
                }}
                style={{
                  padding: '8px 16px',
                  background: '#444',
                  border: 'none',
                  borderRadius: 4,
                  color: '#eee',
                  cursor: 'pointer',
                }}
              >
                Try Again
              </button>
              <button
                onClick={onSkip}
                style={{
                  padding: '8px 16px',
                  background: 'transparent',
                  border: '1px solid #444',
                  borderRadius: 4,
                  color: '#aaa',
                  cursor: 'pointer',
                }}
              >
                Continue with Password
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}