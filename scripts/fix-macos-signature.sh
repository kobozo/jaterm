#!/bin/bash
# Fix macOS app signature for distribution without Apple Developer Program
# This creates a proper ad-hoc signature that allows "Open Anyway" option

set -e

if [ "$1" == "--ci" ]; then
    # In CI, only process on macOS
    if [[ "$RUNNER_OS" != "macOS" ]]; then
        echo "Skipping macOS signature fix on $RUNNER_OS"
        exit 0
    fi
fi

echo "Fixing macOS app signatures..."

# Find all .app bundles in the release directory
find src-tauri/target/*/release/bundle/macos -name "*.app" -type d 2>/dev/null | while read -r app; do
    if [ -d "$app" ]; then
        echo "Processing: $app"
        
        # Remove any existing signature and extended attributes
        codesign --remove-signature "$app" 2>/dev/null || true
        xattr -cr "$app" 2>/dev/null || true
        
        # Sign with ad-hoc signature, deep signing all components with sealed resources
        codesign --force --deep --sign - --options runtime "$app" 2>/dev/null || \
        codesign --force --deep --sign - "$app"
        
        echo "✓ Signed: $app"
        
        # Verify the signature
        if codesign -vv "$app" 2>&1 | grep -q "satisfies its Designated Requirement"; then
            echo "✓ Signature verified"
        else
            echo "⚠ Warning: Signature verification had issues, but continuing..."
        fi
    fi
done

# Skip DMG processing in CI - DMG contents are read-only after creation
# The app bundle inside was already signed before DMG creation
if [ "$1" != "--ci" ]; then
    # Also process DMG contents if they exist (local builds only)
    find src-tauri/target/*/release/bundle/dmg -name "*.dmg" -type f 2>/dev/null | while read -r dmg; do
        if [ -f "$dmg" ]; then
            echo "Processing DMG: $dmg"
            
            # Create a temporary mount point
            MOUNT_POINT=$(mktemp -d)
            
            # Mount the DMG
            hdiutil attach "$dmg" -mountpoint "$MOUNT_POINT" -nobrowse -quiet
            
            # Find and sign the app inside
            find "$MOUNT_POINT" -name "*.app" -type d | while read -r app; do
                echo "Signing app in DMG: $app"
                codesign --remove-signature "$app" 2>/dev/null || true
                codesign --force --deep --sign - "$app"
            done
            
            # Unmount
            hdiutil detach "$MOUNT_POINT" -quiet
            rmdir "$MOUNT_POINT"
            
            echo "✓ DMG processed: $dmg"
        fi
    done
fi

echo "macOS signature fix complete!"