# Profiles and Encryption

Master Key
- Set/Unlock via in-app dialog. We verify the key with Argon2 and load it in-memory.
- Status API: `encryption_status`; actions: `set_master_key`, `verify_master_key`, `clear_master_key`.

Storage
- Profiles saved in `profiles.json` wrapper with `encrypted_fields` markers.
- Sensitive fields (`auth.password`, `auth.passphrase`) stored as AES-256-GCM blobs when a key is set.

Runtime Decryption
- Frontend loads profiles via `load_profiles_encrypted`; backend decrypts fields if master key is loaded.
- On connect, we re-fetch the profile to ensure decrypted auth is present; if locked, we prompt to unlock.

Tips
- Never commit `profiles.json`. Keys are stored locally (keychain/fallback file).
- To migrate plain profiles, the app offers a migration path on first run.
