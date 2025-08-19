#!/bin/bash

# This script generates placeholder icons for JaTerm
# In production, you should replace these with professionally designed icons

ICONS_DIR="src-tauri/icons"
mkdir -p "$ICONS_DIR"

# Create a simple SVG icon as base
cat > "$ICONS_DIR/icon.svg" << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#1e1e1e" rx="32"/>
  <text x="128" y="140" font-family="monospace" font-size="120" font-weight="bold" text-anchor="middle" fill="#0dbc79">$_</text>
  <rect x="40" y="180" width="176" height="8" fill="#0dbc79" opacity="0.8"/>
</svg>
EOF

echo "Generated base SVG icon"

# For now, create placeholder PNG files
# In production, use a proper tool like ImageMagick or Inkscape to convert SVG to PNG

# Create placeholder files (you'll need to generate real icons)
touch "$ICONS_DIR/32x32.png"
touch "$ICONS_DIR/128x128.png"
touch "$ICONS_DIR/128x128@2x.png"
touch "$ICONS_DIR/icon.png"
touch "$ICONS_DIR/icon.icns"
touch "$ICONS_DIR/icon.ico"

echo "Created placeholder icon files in $ICONS_DIR"
echo "NOTE: You need to generate actual icon files from the SVG using a tool like:"
echo "  - ImageMagick: convert icon.svg -resize 32x32 32x32.png"
echo "  - Or use online tools to convert SVG to various formats"
echo "  - For .icns (macOS): Use 'iconutil' or online converters"
echo "  - For .ico (Windows): Use online converters or tools like ImageMagick"