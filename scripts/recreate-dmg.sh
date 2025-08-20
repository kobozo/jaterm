#!/bin/bash
# Recreate DMG with properly signed app bundle
# Usage: ./recreate-dmg.sh <target> <version>

set -e

TARGET=$1
VERSION=$2

if [ -z "$TARGET" ] || [ -z "$VERSION" ]; then
    echo "Usage: $0 <target> <version>"
    exit 1
fi

echo "Recreating DMG for target: $TARGET, version: $VERSION"

# Determine paths based on target
BUNDLE_DIR="src-tauri/target/$TARGET/release/bundle"
APP_PATH="$BUNDLE_DIR/macos/JaTerm.app"
DMG_DIR="$BUNDLE_DIR/dmg"

# Determine DMG filename based on target
if [[ "$TARGET" == "aarch64-apple-darwin" ]]; then
    DMG_NAME="JaTerm_${VERSION}_aarch64.dmg"
else
    DMG_NAME="JaTerm_${VERSION}_x64.dmg"
fi

DMG_PATH="$DMG_DIR/$DMG_NAME"

# Check if app exists
if [ ! -d "$APP_PATH" ]; then
    echo "Error: App bundle not found at $APP_PATH"
    exit 1
fi

# Remove old DMG if it exists
if [ -f "$DMG_PATH" ]; then
    echo "Removing old DMG: $DMG_PATH"
    rm -f "$DMG_PATH"
fi

# Create DMG directory if it doesn't exist
mkdir -p "$DMG_DIR"

# Create a temporary directory for DMG contents
TEMP_DIR=$(mktemp -d)
echo "Using temp directory: $TEMP_DIR"

# Copy the app to temp directory
echo "Copying app bundle..."
cp -R "$APP_PATH" "$TEMP_DIR/"

# Create Applications symlink
ln -s /Applications "$TEMP_DIR/Applications"

# Create the volume icon if it exists
ICON_PATH="src-tauri/icons/icon.icns"
if [ -f "$ICON_PATH" ]; then
    cp "$ICON_PATH" "$TEMP_DIR/.VolumeIcon.icns"
fi

# Calculate size needed (app size + 20% padding)
APP_SIZE=$(du -sm "$TEMP_DIR" | cut -f1)
DMG_SIZE=$(( APP_SIZE + APP_SIZE / 5 ))

echo "Creating DMG (size: ${DMG_SIZE}MB)..."

# Create DMG
hdiutil create -volname "JaTerm" \
    -srcfolder "$TEMP_DIR" \
    -ov \
    -format UDZO \
    -size "${DMG_SIZE}m" \
    "$DMG_PATH"

# Clean up
rm -rf "$TEMP_DIR"

echo "✓ DMG created: $DMG_PATH"

# Verify the DMG
echo "Verifying DMG..."
hdiutil verify "$DMG_PATH"

echo "✓ DMG recreation complete!"