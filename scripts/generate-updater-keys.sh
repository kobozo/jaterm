#!/bin/bash

# Script to generate Tauri updater signing keys
# Run this once and save the keys securely

set -e

echo "🔑 Generating Tauri Updater Signing Keys"
echo "========================================="
echo ""

# Check if pnpm and tauri are available
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed. Please install it first."
    exit 1
fi

# Create keys directory
KEYS_DIR="$HOME/.tauri/jaterm-keys"
mkdir -p "$KEYS_DIR"

# Generate the key pair
echo "📝 Generating Ed25519 key pair..."
cd src-tauri
npx @tauri-apps/cli signer generate -w "$KEYS_DIR/updater.key" || pnpm tauri signer generate -w "$KEYS_DIR/updater.key"

# Read the keys
PRIVATE_KEY=$(cat "$KEYS_DIR/updater.key")
PUBLIC_KEY=$(cat "$KEYS_DIR/updater.key.pub")

# Create base64 encoded version for GitHub secrets
PRIVATE_KEY_BASE64=$(echo -n "$PRIVATE_KEY" | base64)

echo ""
echo "✅ Keys generated successfully!"
echo ""
echo "📁 Keys saved to: $KEYS_DIR"
echo ""
echo "=================================================================================="
echo "IMPORTANT: Save these values securely!"
echo "=================================================================================="
echo ""
echo "1. PUBLIC KEY (add to tauri.conf.json):"
echo "   -----------------------------------"
echo "   $PUBLIC_KEY"
echo ""
echo "2. PRIVATE KEY (keep secret, never commit!):"
echo "   -----------------------------------------"
echo "   Location: $KEYS_DIR/updater.key"
echo ""
echo "3. GITHUB SECRET - TAURI_SIGNING_PRIVATE_KEY (base64):"
echo "   ---------------------------------------------------"
echo "   $PRIVATE_KEY_BASE64"
echo ""
echo "4. GITHUB SECRET - TAURI_SIGNING_PRIVATE_KEY_PASSWORD:"
echo "   ---------------------------------------------------"
echo "   (Leave empty or set your own password if you encrypted the key)"
echo ""
echo "=================================================================================="
echo ""
echo "📋 Next steps:"
echo "   1. Copy the PUBLIC KEY and update src-tauri/tauri.conf.json"
echo "   2. Go to GitHub repo Settings > Secrets > Actions"
echo "   3. Add TAURI_SIGNING_PRIVATE_KEY with the base64 value above"
echo "   4. Add TAURI_SIGNING_PRIVATE_KEY_PASSWORD (empty or your password)"
echo "   5. Commit the updated tauri.conf.json (with public key only!)"
echo ""
echo "⚠️  NEVER commit the private key or its base64 version!"
echo ""

# Save instructions to file
cat > "$KEYS_DIR/README.md" << EOF
# Tauri Updater Keys for JaTerm

Generated on: $(date)

## Public Key
\`\`\`
$PUBLIC_KEY
\`\`\`

## Usage

1. The public key has been added to \`src-tauri/tauri.conf.json\`
2. The private key is stored in: \`$KEYS_DIR/updater.key\`
3. GitHub secrets needed:
   - TAURI_SIGNING_PRIVATE_KEY: (base64 encoded private key)
   - TAURI_SIGNING_PRIVATE_KEY_PASSWORD: (empty or your password)

## Security

- NEVER commit the private key
- Keep the private key backup in a secure location
- The public key is safe to commit and share
EOF

echo "📄 Instructions saved to: $KEYS_DIR/README.md"