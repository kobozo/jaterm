# Security Documentation

## Overview

JaTerm takes security seriously. This document outlines our security practices, how we handle sensitive data, and recommendations for secure usage.

## Profile Storage Locations

Your connection profiles and application data are stored locally on your machine:

- **Windows**: `%APPDATA%\kobozo.jaterm\` or `%USERPROFILE%\.jaterm\`
- **macOS**: `~/Library/Application Support/kobozo.jaterm/` or `~/.jaterm/`
- **Linux**: `~/.config/kobozo.jaterm/` or `~/.jaterm/`

Files stored:
- `profiles.json` - SSH connection profiles (encrypted when master key is set)
- `state.json` - Application state and recent sessions
- `config.json` - Application configuration

## Password Security

### Encryption at Rest

**With Master Key (Recommended)**:
- Passwords and sensitive data are encrypted using AES-256-GCM
- Master key is derived using Argon2 (memory-hard key derivation)
- Encryption keys are stored in system keychain when available:
  - macOS: Keychain
  - Windows: Windows Credential Manager
  - Linux: Secret Service API (GNOME Keyring, KWallet)

**Without Master Key**:
- Passwords are stored in plain text in `profiles.json`
- ⚠️ **Not recommended for production use**

### Master Key Setup

On first launch or when creating profiles with passwords:
1. You'll be prompted to set a master key
2. Enter a strong password (minimum 8 characters)
3. The key is used to encrypt all sensitive data
4. The key itself is never stored in plain text

### Hardware Security Module Support

When available, JaTerm uses platform-specific secure storage:
- **macOS**: Secure Enclave (Apple Silicon) or T2 chip
- **Windows**: TPM (Trusted Platform Module)
- **Linux**: TPM if available via `/dev/tpm0`

## SSH Security Best Practices

### Recommended: SSH Keys over Passwords

1. **Use SSH keys instead of passwords**:
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   ```

2. **Protect private keys**:
   - Store in `~/.ssh/` with permissions `600`
   - Use passphrase protection for private keys

3. **SSH Agent**:
   - JaTerm supports SSH agent authentication
   - Keys loaded in ssh-agent are used automatically

### Port Forwarding Security

- Local forwards (L): Expose remote services locally
- Remote forwards (R): Expose local services remotely
- Dynamic SOCKS proxy (D): Route traffic through SSH tunnel

⚠️ **Warning**: Be cautious with remote forwards as they expose local services

## File Permissions

Ensure proper permissions on configuration files:

```bash
# macOS/Linux
chmod 700 ~/.jaterm
chmod 600 ~/.jaterm/*.json

# Check permissions
ls -la ~/.jaterm/
```

## Data Privacy

### What Data Stays Local

- All connection profiles
- SSH passwords and keys
- Session history
- Terminal output
- Git repository information

### What Data Leaves Your Machine

- **SSH connections**: Direct connection to your SSH servers
- **Auto-updates**: Version check to GitHub releases API
- **No telemetry**: JaTerm does not collect usage statistics
- **No analytics**: No tracking or analytics services

### Update Security

- Updates are fetched from official GitHub releases
- Each update is cryptographically signed
- Signature verification before installation
- Public key embedded in application

## Security Considerations

### Known Limitations

1. **Terminal output**: Not encrypted in memory
2. **Process memory**: Sensitive data may be swapped to disk
3. **Clipboard**: Copied passwords are in system clipboard

### Recommendations

1. **Always use master key encryption** for profiles with passwords
2. **Prefer SSH keys** over password authentication
3. **Use SSH agent** for key management
4. **Enable 2FA** on your SSH servers when possible
5. **Regularly update** JaTerm for security patches
6. **Review permissions** on configuration files

## Reporting Security Issues

If you discover a security vulnerability:

1. **Do not** open a public issue
2. Email security concerns to: security@kobozo.com
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We aim to respond within 48 hours and provide updates on the fix.

## Compliance

JaTerm is designed with security in mind but is not certified for:
- HIPAA compliance
- PCI DSS compliance  
- SOC 2 compliance

For regulated environments, please consult your security team.

## Version History

- **v1.2.0**: Added master key encryption for sensitive data
- **v1.1.0**: Added auto-updater with signature verification
- **v1.0.0**: Initial release

## Further Reading

- [SSH Best Practices](https://www.ssh.com/academy/ssh/keygen)
- [Port Forwarding Guide](https://www.ssh.com/academy/ssh/tunneling)
- [Argon2 Specification](https://github.com/P-H-C/phc-winner-argon2)
- [AES-GCM Encryption](https://en.wikipedia.org/wiki/Galois/Counter_Mode)