# Generate Tauri Updater Keys

## 1. Generate the Keys

Run this command in your project root:

```bash
pnpm tauri signer generate -w ~/.tauri/jaterm.key
```

Or if you prefer to store it locally (NOT recommended for production):

```bash
pnpm tauri signer generate -w ./jaterm.key
```

This will:
- Prompt you for a password to protect the private key
- Generate a private key file at the specified location
- Output the **public key** to the console

## 2. Save the Keys

After running the command, you'll see output like:

```
Please enter a password to protect the secret key.
Password: [enter a strong password]
Password (one more time): [confirm password]

Keypair generated successfully
Public key: dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDE5QzMxNjYwMzU1OEUwRGl3UUJqOFhLM0U5TkdjeEE4K3psVEVDOXduUjdSOTc4WWFQT1JTeXpzQwo=

Secret key stored at: /Users/username/.tauri/jaterm.key
```

## 3. Set Up GitHub Secrets and Variables

### Secrets (Settings → Secrets and variables → Actions → Secrets)

#### TAURI_SIGNING_PRIVATE_KEY
```bash
# Read the private key file content
cat ~/.tauri/jaterm.key
```
Copy the entire content (including the header/footer) and add it as a secret.

#### TAURI_SIGNING_PRIVATE_KEY_PASSWORD
The password you entered when generating the key.

### Variables (Settings → Secrets and variables → Actions → Variables)

#### TAURI_UPDATER_PUBKEY
The public key string that was output when you generated the keys (the long base64 string).
This is stored as a variable (not a secret) since it's public information.

## 4. Update tauri.conf.json

Replace the placeholder in `src-tauri/tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "pubkey": "YOUR_PUBLIC_KEY_HERE",
      "endpoints": [
        "https://github.com/Kobozo/JaTerm/releases/latest/download/latest.json"
      ]
    }
  }
}
```

## 5. Test Locally

To test signing locally:

```bash
# Set environment variables
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/jaterm.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-password"

# Build with signing
pnpm tauri build
```

After building, you should see `.sig` files next to your bundles:
- `JaTerm.app.tar.gz.sig`
- `JaTerm.msi.sig`
- `JaTerm.AppImage.sig`

## Security Notes

1. **NEVER commit the private key** to your repository
2. **Use a strong password** for the private key
3. **Store the private key securely** (preferably in a password manager)
4. **Backup the private key** - if you lose it, you'll need to generate new keys and all users will need to reinstall the app
5. **The public key can be public** - it's safe to commit to the repository

## Verification

To verify a signature manually:

```bash
# Install minisign (if needed)
brew install minisign  # macOS
# or
apt-get install minisign  # Linux

# Verify a signed bundle
minisign -Vm JaTerm.AppImage -P "YOUR_PUBLIC_KEY_HERE"
```

## Troubleshooting

If you get errors about missing signatures:
1. Make sure the environment variables are set correctly
2. Check that the private key file exists and is readable
3. Verify the password is correct
4. Ensure Tauri is configured with `"updater": { "active": true }`

## Alternative: Using Existing Keys

If you already have keys from a previous setup:

1. Place the private key file at `~/.tauri/jaterm.key`
2. Use the existing public key in `tauri.conf.json`
3. Add the same secrets to GitHub with the existing values