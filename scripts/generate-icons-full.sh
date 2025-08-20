#!/bin/bash

# Full icon generation script for JaTerm
# Creates all required icon formats from SVG

set -e

ICONS_DIR="src-tauri/icons"
mkdir -p "$ICONS_DIR"

echo "🎨 Generating JaTerm Icons"
echo "=========================="

# Create a better SVG icon with gradient
cat > "$ICONS_DIR/icon.svg" << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a1a;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#2d2d2d;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="text-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0dbc79;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#0fa968;stop-opacity:1" />
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="512" height="512" fill="url(#bg-gradient)" rx="64" ry="64"/>
  <!-- Terminal prompt -->
  <text x="80" y="280" font-family="'Courier New', monospace" font-size="200" font-weight="bold" fill="url(#text-gradient)">$_</text>
  <!-- Cursor blink -->
  <rect x="320" y="200" width="80" height="120" fill="#0dbc79" opacity="0.9">
    <animate attributeName="opacity" values="0.9;0;0.9" dur="1s" repeatCount="indefinite"/>
  </rect>
  <!-- Bottom line decoration -->
  <rect x="80" y="380" width="352" height="16" fill="#0dbc79" opacity="0.6" rx="8"/>
</svg>
EOF

echo "✓ Created base SVG icon"

# Check if ImageMagick is installed
if command -v convert &> /dev/null; then
    echo "✓ ImageMagick found, generating PNG icons..."
    
    # Generate PNG files at different sizes
    convert "$ICONS_DIR/icon.svg" -resize 32x32 "$ICONS_DIR/32x32.png"
    echo "  ✓ 32x32.png"
    
    convert "$ICONS_DIR/icon.svg" -resize 128x128 "$ICONS_DIR/128x128.png"
    echo "  ✓ 128x128.png"
    
    convert "$ICONS_DIR/icon.svg" -resize 256x256 "$ICONS_DIR/128x128@2x.png"
    echo "  ✓ 128x128@2x.png (256x256)"
    
    convert "$ICONS_DIR/icon.svg" -resize 512x512 "$ICONS_DIR/icon.png"
    echo "  ✓ icon.png (512x512)"
    
    # Generate Windows ICO (multiple sizes in one file)
    if command -v convert &> /dev/null; then
        convert "$ICONS_DIR/icon.svg" -define icon:auto-resize=256,128,64,48,32,16 "$ICONS_DIR/icon.ico"
        echo "  ✓ icon.ico (Windows)"
    fi
    
    # Generate macOS ICNS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # Create iconset directory
        ICONSET="$ICONS_DIR/icon.iconset"
        mkdir -p "$ICONSET"
        
        # Generate all required sizes for macOS
        convert "$ICONS_DIR/icon.svg" -resize 16x16     "$ICONSET/icon_16x16.png"
        convert "$ICONS_DIR/icon.svg" -resize 32x32     "$ICONSET/icon_16x16@2x.png"
        convert "$ICONS_DIR/icon.svg" -resize 32x32     "$ICONSET/icon_32x32.png"
        convert "$ICONS_DIR/icon.svg" -resize 64x64     "$ICONSET/icon_32x32@2x.png"
        convert "$ICONS_DIR/icon.svg" -resize 128x128   "$ICONSET/icon_128x128.png"
        convert "$ICONS_DIR/icon.svg" -resize 256x256   "$ICONSET/icon_128x128@2x.png"
        convert "$ICONS_DIR/icon.svg" -resize 256x256   "$ICONSET/icon_256x256.png"
        convert "$ICONS_DIR/icon.svg" -resize 512x512   "$ICONSET/icon_256x256@2x.png"
        convert "$ICONS_DIR/icon.svg" -resize 512x512   "$ICONSET/icon_512x512.png"
        convert "$ICONS_DIR/icon.svg" -resize 1024x1024 "$ICONSET/icon_512x512@2x.png"
        
        # Convert to ICNS
        iconutil -c icns "$ICONSET" -o "$ICONS_DIR/icon.icns"
        
        # Clean up iconset
        rm -rf "$ICONSET"
        
        echo "  ✓ icon.icns (macOS)"
    else
        echo "  ⚠ Skipping ICNS generation (requires macOS)"
        # Create placeholder
        touch "$ICONS_DIR/icon.icns"
    fi
    
    echo ""
    echo "✅ All icons generated successfully!"
    
elif command -v rsvg-convert &> /dev/null; then
    echo "✓ librsvg found, generating PNG icons..."
    
    # Use rsvg-convert as alternative
    rsvg-convert -w 32 -h 32 "$ICONS_DIR/icon.svg" -o "$ICONS_DIR/32x32.png"
    rsvg-convert -w 128 -h 128 "$ICONS_DIR/icon.svg" -o "$ICONS_DIR/128x128.png"
    rsvg-convert -w 256 -h 256 "$ICONS_DIR/icon.svg" -o "$ICONS_DIR/128x128@2x.png"
    rsvg-convert -w 512 -h 512 "$ICONS_DIR/icon.svg" -o "$ICONS_DIR/icon.png"
    
    echo "  ✓ PNG files generated"
    echo "  ⚠ ICO and ICNS files need manual generation"
    
    # Create placeholders
    touch "$ICONS_DIR/icon.ico"
    touch "$ICONS_DIR/icon.icns"
    
else
    echo "⚠️  No image conversion tool found!"
    echo ""
    echo "Please install one of the following:"
    echo "  - ImageMagick: brew install imagemagick (macOS) or apt-get install imagemagick (Linux)"
    echo "  - librsvg: brew install librsvg (macOS) or apt-get install librsvg2-bin (Linux)"
    echo ""
    echo "Creating placeholder files for now..."
    
    # Create placeholder files
    touch "$ICONS_DIR/32x32.png"
    touch "$ICONS_DIR/128x128.png"
    touch "$ICONS_DIR/128x128@2x.png"
    touch "$ICONS_DIR/icon.png"
    touch "$ICONS_DIR/icon.ico"
    touch "$ICONS_DIR/icon.icns"
fi

echo ""
echo "📁 Icons location: $ICONS_DIR/"
ls -la "$ICONS_DIR/"