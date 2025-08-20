#!/bin/bash
# Build script for macOS with proper ad-hoc signing

set -e

echo "Building JaTerm for macOS..."

# Build the app
pnpm tauri build

# Fix the signatures
./scripts/fix-macos-signature.sh

echo ""
echo "✅ Build complete!"
echo ""
echo "The DMG file is located at:"
find src-tauri/target/*/release/bundle/dmg -name "*.dmg" -type f 2>/dev/null | head -1

echo ""
echo "The app should now work properly with the 'Open Anyway' option in System Settings."
echo ""
echo "To install:"
echo "1. Open the DMG file"
echo "2. Drag JaTerm to Applications"
echo "3. Right-click JaTerm in Applications and select 'Open'"
echo "4. Click 'Open' in the security dialog"
echo ""
echo "Or from System Settings → Privacy & Security → click 'Open Anyway' after first launch attempt."