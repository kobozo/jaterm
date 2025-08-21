#!/bin/bash

# Generate latest.json for Tauri updater
# This script should be run after all platform builds are complete

set -e

VERSION="${1:-}"
NOTES="${2:-}"
REPO="Kobozo/JaTerm"

if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version> [notes]"
    echo "Example: $0 1.1.0 'Bug fixes and improvements'"
    exit 1
fi

# Remove 'v' prefix if present
VERSION="${VERSION#v}"

# Default notes if not provided
if [ -z "$NOTES" ]; then
    NOTES="JaTerm v${VERSION} is now available!"
fi

# Get current date in RFC 3339 format
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Function to read signature file content
read_signature() {
    local sig_file="$1"
    if [ -f "$sig_file" ]; then
        cat "$sig_file"
    else
        echo ""
    fi
}

# Start building the JSON
cat > latest.json <<EOF
{
  "version": "${VERSION}",
  "notes": "${NOTES}",
  "pub_date": "${PUB_DATE}",
  "platforms": {
EOF

# Track if we need a comma
NEED_COMMA=false

# Windows x64
WINDOWS_MSI="dist/JaTerm_${VERSION}_x64.msi"
WINDOWS_SIG="dist/JaTerm_${VERSION}_x64.msi.sig"
if [ -f "$WINDOWS_MSI" ]; then
    if [ "$NEED_COMMA" = true ]; then echo "," >> latest.json; fi
    SIGNATURE=$(read_signature "$WINDOWS_SIG")
    cat >> latest.json <<EOF
    "windows-x86_64": {
      "signature": "${SIGNATURE}",
      "url": "https://github.com/${REPO}/releases/download/v${VERSION}/JaTerm_${VERSION}_x64.msi"
    }
EOF
    NEED_COMMA=true
fi

# macOS Intel
MACOS_X64_TAR="dist/JaTerm_${VERSION}_x64.app.tar.gz"
MACOS_X64_SIG="dist/JaTerm_${VERSION}_x64.app.tar.gz.sig"
if [ -f "$MACOS_X64_TAR" ]; then
    if [ "$NEED_COMMA" = true ]; then echo "," >> latest.json; fi
    SIGNATURE=$(read_signature "$MACOS_X64_SIG")
    cat >> latest.json <<EOF
    "darwin-x86_64": {
      "signature": "${SIGNATURE}",
      "url": "https://github.com/${REPO}/releases/download/v${VERSION}/JaTerm_${VERSION}_x64.app.tar.gz"
    }
EOF
    NEED_COMMA=true
fi

# macOS Apple Silicon
MACOS_AARCH64_TAR="dist/JaTerm_${VERSION}_aarch64.app.tar.gz"
MACOS_AARCH64_SIG="dist/JaTerm_${VERSION}_aarch64.app.tar.gz.sig"
if [ -f "$MACOS_AARCH64_TAR" ]; then
    if [ "$NEED_COMMA" = true ]; then echo "," >> latest.json; fi
    SIGNATURE=$(read_signature "$MACOS_AARCH64_SIG")
    cat >> latest.json <<EOF
    "darwin-aarch64": {
      "signature": "${SIGNATURE}",
      "url": "https://github.com/${REPO}/releases/download/v${VERSION}/JaTerm_${VERSION}_aarch64.app.tar.gz"
    }
EOF
    NEED_COMMA=true
fi

# Linux x64
LINUX_APPIMAGE="dist/JaTerm_${VERSION}_amd64.AppImage"
LINUX_SIG="dist/JaTerm_${VERSION}_amd64.AppImage.sig"
if [ -f "$LINUX_APPIMAGE" ]; then
    if [ "$NEED_COMMA" = true ]; then echo "," >> latest.json; fi
    SIGNATURE=$(read_signature "$LINUX_SIG")
    cat >> latest.json <<EOF
    "linux-x86_64": {
      "signature": "${SIGNATURE}",
      "url": "https://github.com/${REPO}/releases/download/v${VERSION}/JaTerm_${VERSION}_amd64.AppImage"
    }
EOF
    NEED_COMMA=true
fi

# Close the JSON
cat >> latest.json <<EOF

  }
}
EOF

echo "Generated latest.json for version ${VERSION}"
echo "Content:"
cat latest.json

# Move to dist directory if it exists
if [ -d "dist" ]; then
    mv latest.json dist/
    echo "Moved latest.json to dist/"
fi