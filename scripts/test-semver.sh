#!/bin/bash
# Test script to verify semver version formats

echo "Testing semver version formats..."

# Test dev version format
DEV_VERSION="0.0.0-dev$(date +%Y%m%d%H%M%S)"
echo "Dev version: $DEV_VERSION"

# Test nightly version format  
NIGHTLY_VERSION="0.0.0-nightly$(date +%Y%m%d%H%M%S)"
echo "Nightly version: $NIGHTLY_VERSION"

# Test regular version
RELEASE_VERSION="1.5.1"
echo "Release version: $RELEASE_VERSION"

# Verify with npm (which enforces semver)
echo ""
echo "Testing with npm semver validation..."

# Create a temp package.json
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

# Test each version format
for VERSION in "$DEV_VERSION" "$NIGHTLY_VERSION" "$RELEASE_VERSION"; do
    cat > package.json << EOF
{
  "name": "test-package",
  "version": "$VERSION"
}
EOF
    
    echo -n "Testing $VERSION: "
    if npm version 2>/dev/null | grep -q "$VERSION"; then
        echo "✅ Valid semver"
    else
        echo "❌ Invalid semver"
    fi
done

# Cleanup
cd - > /dev/null
rm -rf "$TEMP_DIR"

echo ""
echo "Test complete!"
