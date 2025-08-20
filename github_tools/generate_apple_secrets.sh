#!/bin/bash
# Script to help generate Apple certificate secrets for GitHub Actions

set -e

echo "========================================="
echo "Apple Certificate Setup for GitHub Actions"
echo "========================================="
echo ""
echo "This script will help you prepare the secrets needed for GitHub Actions."
echo "Make sure you have your Apple Developer certificate (.p12 file) ready."
echo ""

# Check if certificate file is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <path-to-certificate.p12>"
    echo ""
    echo "You need to export your Developer ID Application certificate from Keychain Access:"
    echo "1. Open Keychain Access"
    echo "2. Find your 'Developer ID Application' certificate"
    echo "3. Right-click and select 'Export...'"
    echo "4. Save as .p12 format with a password"
    echo ""
    exit 1
fi

CERT_PATH="$1"

if [ ! -f "$CERT_PATH" ]; then
    echo "Error: Certificate file not found: $CERT_PATH"
    exit 1
fi

echo "Using certificate: $CERT_PATH"
echo ""

# Generate base64 encoded certificate
echo "Generating base64 encoded certificate..."
CERT_BASE64=$(base64 < "$CERT_PATH")

# Create output file with all secrets
OUTPUT_FILE="github_tools/github_secrets.txt"

echo "=========================================" > "$OUTPUT_FILE"
echo "GitHub Secrets - Add these to your repository" >> "$OUTPUT_FILE"
echo "Settings → Secrets and variables → Actions" >> "$OUTPUT_FILE"
echo "=========================================" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "APPLE_CERTIFICATE:" >> "$OUTPUT_FILE"
echo "$CERT_BASE64" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "----------------------------------------" >> "$OUTPUT_FILE"
echo "You also need to add these secrets manually:" >> "$OUTPUT_FILE"
echo "----------------------------------------" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "APPLE_CERTIFICATE_PASSWORD:" >> "$OUTPUT_FILE"
echo "[Enter the password you used when exporting the .p12 file]" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "APPLE_SIGNING_IDENTITY:" >> "$OUTPUT_FILE"
echo "[Enter your signing identity, e.g., 'Developer ID Application: Your Name (TEAMID)']" >> "$OUTPUT_FILE"
echo "You can find this by running: security find-identity -v -p codesigning" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "APPLE_ID:" >> "$OUTPUT_FILE"
echo "[Your Apple ID email address]" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "APPLE_PASSWORD:" >> "$OUTPUT_FILE"
echo "[App-specific password for notarization]" >> "$OUTPUT_FILE"
echo "Generate at: https://appleid.apple.com/account/manage" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "APPLE_TEAM_ID:" >> "$OUTPUT_FILE"
echo "[Your Apple Developer Team ID]" >> "$OUTPUT_FILE"
echo "Find at: https://developer.apple.com/account/#/membership" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "=========================================" >> "$OUTPUT_FILE"

echo ""
echo "✅ Secrets file generated: $OUTPUT_FILE"
echo ""
echo "To find your signing identity, run:"
echo "  security find-identity -v -p codesigning"
echo ""
echo "Next steps:"
echo "1. Review the generated file: $OUTPUT_FILE"
echo "2. Add each secret to your GitHub repository"
echo "3. Fill in the manual values (password, identity, etc.)"
echo ""