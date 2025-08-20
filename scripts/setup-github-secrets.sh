#!/bin/bash

# Script to help set up GitHub secrets for CI/CD
# This generates commands to set secrets via GitHub CLI

set -e

echo "🔐 GitHub Secrets Setup Helper for JaTerm"
echo "========================================="
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "⚠️  GitHub CLI (gh) is not installed."
    echo "   Install it with: brew install gh (macOS) or see https://cli.github.com"
    echo ""
    echo "Alternatively, add these secrets manually in:"
    echo "  https://github.com/Kobozo/jaterm/settings/secrets/actions"
    echo ""
fi

echo "This script will help you set up the required GitHub secrets."
echo ""

# Function to set a secret
set_secret() {
    local SECRET_NAME=$1
    local SECRET_VALUE=$2
    local DESCRIPTION=$3
    
    echo "📝 $SECRET_NAME"
    echo "   $DESCRIPTION"
    
    if command -v gh &> /dev/null; then
        echo "   Setting secret..."
        echo "$SECRET_VALUE" | gh secret set "$SECRET_NAME" 2>/dev/null && echo "   ✅ Set successfully" || echo "   ❌ Failed to set"
    else
        echo "   Manual command:"
        echo "   echo '$SECRET_VALUE' | gh secret set $SECRET_NAME"
    fi
    echo ""
}

echo "=== REQUIRED SECRETS ==="
echo ""

# 1. Tauri Updater Keys
echo "1️⃣ TAURI UPDATER KEYS"
echo "----------------------"

if [ -f "$HOME/.tauri/jaterm-keys/updater.key" ]; then
    echo "✓ Found existing updater keys"
    PRIVATE_KEY=$(cat "$HOME/.tauri/jaterm-keys/updater.key")
    PUBLIC_KEY=$(cat "$HOME/.tauri/jaterm-keys/updater.key.pub")
    PRIVATE_KEY_BASE64=$(echo -n "$PRIVATE_KEY" | base64)
    
    set_secret "TAURI_SIGNING_PRIVATE_KEY" "$PRIVATE_KEY_BASE64" "Base64 encoded private key for updater"
    set_secret "TAURI_SIGNING_PRIVATE_KEY_PASSWORD" "" "Password for private key (empty if not encrypted)"
    set_secret "TAURI_UPDATER_PUBKEY" "$PUBLIC_KEY" "Public key for updater verification"
else
    echo "❌ No updater keys found. Run: ./scripts/generate-updater-keys.sh"
fi

echo ""
echo "=== OPTIONAL SECRETS (for signed builds) ==="
echo ""

echo "2️⃣ APPLE CODE SIGNING (macOS)"
echo "------------------------------"
echo "Required for notarized macOS builds:"
echo ""
echo "  APPLE_CERTIFICATE         - Base64 encoded .p12 certificate"
echo "  APPLE_CERTIFICATE_PASSWORD - Certificate password"
echo "  APPLE_SIGNING_IDENTITY    - Developer ID Application: Your Name"
echo "  APPLE_ID                  - Your Apple ID email"
echo "  APPLE_PASSWORD            - App-specific password"
echo "  APPLE_TEAM_ID            - Your Apple Developer Team ID"
echo ""
echo "To encode certificate: base64 -i certificate.p12 | pbcopy"
echo ""

echo "3️⃣ WINDOWS CODE SIGNING"
echo "------------------------"
echo "Required for trusted Windows installers:"
echo ""
echo "  WINDOWS_CERTIFICATE       - Base64 encoded .pfx certificate"
echo "  WINDOWS_CERTIFICATE_PASSWORD - Certificate password"
echo ""
echo "To encode certificate: base64 -i certificate.pfx | pbcopy"
echo ""

echo "=== SETUP VERIFICATION ==="
echo ""

if command -v gh &> /dev/null; then
    echo "Current secrets in repository:"
    gh secret list 2>/dev/null || echo "Unable to list secrets (check permissions)"
else
    echo "Install GitHub CLI to verify: brew install gh"
fi

echo ""
echo "=== NEXT STEPS ==="
echo ""
echo "1. Ensure all required secrets are set"
echo "2. Update src-tauri/tauri.conf.json with the public key"
echo "3. Commit and push changes"
echo "4. Create a tag to trigger release: git tag v0.1.0 && git push --tags"
echo "5. Check Actions tab on GitHub for build status"
echo ""
echo "📚 Documentation: .github/README.md"
echo ""