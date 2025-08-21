# Encryption System Migration Guide

## Overview

We've upgraded the encryption system to provide seamless, automatic decryption while maintaining security and portability. The new system uses:

1. **Data Encryption Key (DEK)**: A randomly generated 256-bit key stored in your OS keychain
2. **Master Password**: Used to encrypt the DEK for backup/recovery purposes
3. **Automatic Decryption**: No password prompts after initial setup

## Benefits

- ✅ **No more password prompts** on every app start
- ✅ **Automatic decryption** using OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- ✅ **Emergency recovery** - Your master password can recover data if keychain is lost
- ✅ **Portable backups** - Export encrypted DEK for transferring to another machine
- ✅ **Same security level** - Files remain encrypted with AES-256-GCM

## How It Works

```
┌─────────────┐
│ First Setup │
└─────┬───────┘
      ↓
┌─────────────────────────┐
│ User sets master password│
└─────┬───────────────────┘
      ↓
┌─────────────────────────────────┐
│ Generate random 256-bit DEK     │
└─────┬───────────────────────────┘
      ↓
      ├─→ Store DEK in OS Keychain (for automatic access)
      └─→ Encrypt DEK with master password (for recovery)
      
┌──────────────┐
│ Normal Usage │
└──────┬───────┘
       ↓
┌──────────────────────────────────┐
│ App starts                       │
│ → Load DEK from OS keychain     │
│ → Decrypt profiles automatically │
│ → No password needed!            │
└──────────────────────────────────┘

┌────────────────┐
│ Recovery Mode  │
└────────┬───────┘
         ↓
┌──────────────────────────────────┐
│ Keychain unavailable?            │
│ → Prompt for master password     │
│ → Decrypt DEK with password      │
│ → Re-store in keychain if possible│
└──────────────────────────────────┘
```

## Migration Steps

### For Users with Existing Encrypted Profiles

1. **Backup your current profiles** (optional but recommended):
   ```bash
   cp ~/.jaterm/profiles.json.enc ~/.jaterm/profiles.json.enc.backup
   ```

2. **Start the app** - It will detect the old encryption and prompt for migration

3. **Enter your current master password** - This will:
   - Decrypt your existing profiles
   - Generate a new DEK
   - Store the DEK in your OS keychain
   - Re-encrypt profiles with the new system

4. **That's it!** Future app launches won't need your password

### For New Users

1. **Start the app** - You'll be prompted to set a master password

2. **Choose a strong password** - This is for emergency recovery only

3. **Confirm the password**

4. **Done!** The app will handle encryption automatically

## Emergency Recovery

If you lose access to your OS keychain (e.g., after OS reinstall):

1. **Locate your recovery file**:
   ```
   ~/.jaterm/.encryption_recovery
   ```

2. **Start the app** - It will detect missing keychain access

3. **Enter your master password** - The app will:
   - Decrypt the DEK from the recovery file
   - Re-establish keychain access
   - Resume normal operation

## Exporting for Backup/Transfer

To backup or transfer your encryption keys to another machine:

1. **Export the encrypted DEK**:
   ```javascript
   // In the app console or via API
   const backup = await exportEncryptionKey();
   // Save this JSON to a secure location
   ```

2. **On the new machine**, import the backup:
   ```javascript
   await importEncryptionKey(backup, masterPassword);
   ```

## Security Considerations

- **OS Keychain Security**: The DEK is protected by your OS login
- **Master Password**: Only needed for initial setup and recovery
- **Recovery File**: Contains encrypted DEK (safe to backup)
- **profiles.json.enc**: Encrypted with DEK using AES-256-GCM

## Troubleshooting

### "Keychain access denied"
- **macOS**: Check System Preferences → Security & Privacy → Privacy → Files and Folders
- **Windows**: Run as administrator if needed
- **Linux**: Ensure secret-service/gnome-keyring is running

### "Invalid master key"
- Your master password is incorrect
- Check caps lock and keyboard layout
- Use the recovery file if you've forgotten the password

### "No DEK found"
- First time setup needed
- Or keychain was cleared - use recovery mode

## Technical Details

- **Encryption**: AES-256-GCM
- **Key Derivation**: Argon2id
- **DEK Storage**: OS-native secure storage via `keyring` crate
- **File Format**: JSON with base64-encoded encrypted data
- **Atomic Writes**: Temp file + rename for crash safety

## Rollback (if needed)

To revert to the old system:

1. Keep using the old encryption commands:
   - `load_profiles_encrypted` instead of `load_profiles_v2`
   - `save_profiles_encrypted` instead of `save_profiles_v2`

2. Your old encrypted files remain compatible

## Questions?

The new system is designed to be transparent and maintenance-free. If you encounter issues:

1. Check this guide
2. Look for `.encryption_recovery` file for emergency recovery
3. Report issues with encryption logs from the console