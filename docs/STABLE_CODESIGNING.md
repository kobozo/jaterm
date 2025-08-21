# Stable Code Signing for macOS (Without Apple Developer Account)

## Problem
Currently, every release build uses ad-hoc signing with a different identity, causing macOS to prompt "Allow this app to run?" on every update. This happens because:
- `signingIdentity` is set to `null` in tauri.conf.json
- No certificate is configured in GitHub Actions
- Each build gets a unique ad-hoc signature

## Solution: Self-Signed Certificate

### Step 1: Create a Self-Signed Certificate on macOS

1. Open **Keychain Access** app
2. Go to **Keychain Access > Certificate Assistant > Create a Certificate**
3. Fill in:
   - Name: `JaTerm Self-Signed`
   - Identity Type: `Self Signed Root`
   - Certificate Type: `Code Signing`
   - Check "Let me override defaults"
4. Click Continue through all screens, accepting defaults
5. On the "Specify a Location" screen, choose **Keychain: login**

### Step 2: Export the Certificate

1. In Keychain Access, find your `JaTerm Self-Signed` certificate
2. Right-click > Export "JaTerm Self-Signed"
3. Save as `JaTerm.p12` with a strong password
4. Convert to base64 for GitHub:
   ```bash
   base64 -i JaTerm.p12 -o JaTerm.p12.base64
   ```

### Step 3: Add to GitHub Secrets

Go to your repository Settings > Secrets and variables > Actions, add:

- `APPLE_CERTIFICATE`: Contents of `JaTerm.p12.base64`
- `APPLE_CERTIFICATE_PASSWORD`: The password you used when exporting
- `APPLE_SIGNING_IDENTITY`: `JaTerm Self-Signed` (the certificate name)

### Step 4: Update GitHub Workflow

Update `.github/workflows/build-release.yml` to add certificate import for macOS builds:

```yaml
- name: Import macOS certificate
  if: matrix.os == 'macos-latest'
  env:
    APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
    APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
  run: |
    # Create temporary keychain
    KEYCHAIN_PASSWORD=$(openssl rand -base64 32)
    KEYCHAIN_PATH=$RUNNER_TEMP/app-signing.keychain-db
    
    # Create keychain
    security create-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
    security set-keychain-settings -lut 21600 $KEYCHAIN_PATH
    security unlock-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
    
    # Import certificate
    echo "$APPLE_CERTIFICATE" | base64 --decode > certificate.p12
    security import certificate.p12 -k $KEYCHAIN_PATH -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
    security list-keychain -d user -s $KEYCHAIN_PATH
    
    # Allow codesign to access keychain
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
```

### Step 5: Update tauri.conf.json

Update the macOS section to use the signing identity:

```json
"macOS": {
  "frameworks": [],
  "signingIdentity": "JaTerm Self-Signed",
  "providerShortName": null,
  "entitlements": null,
  "minimumSystemVersion": "10.15",
  "hardenedRuntime": false
}
```

Or better, use environment variable in the workflow:

```json
"macOS": {
  "frameworks": [],
  "signingIdentity": "-",  // Use environment variable
  "providerShortName": null,
  "entitlements": null,
  "minimumSystemVersion": "10.15",
  "hardenedRuntime": false
}
```

Then set in workflow:
```yaml
env:
  APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
```

## Benefits

1. **Stable identity**: Same certificate used for all builds
2. **Fewer prompts**: macOS will remember your approval
3. **No Apple Developer account needed**: Free solution
4. **Works with auto-updater**: Updates won't trigger new security prompts

## Limitations

1. **First run warning**: Users will still see "unidentified developer" on first install
2. **No notarization**: Can't be notarized without Apple Developer account
3. **Gatekeeper**: Users need to right-click > Open on first launch
4. **Manual trust**: Each user must approve the certificate once

## Alternative: Local Signing for Releases

If you prefer to sign releases locally:

1. Build the release locally: `pnpm tauri build`
2. Sign with your certificate:
   ```bash
   codesign --force --deep --sign "JaTerm Self-Signed" \
     src-tauri/target/release/bundle/macos/JaTerm.app
   ```
3. Create DMG and upload to GitHub

## Testing

After implementing:
1. Build a release with the new signing
2. Install on a test Mac
3. Approve the app once
4. Install an update - should NOT prompt again
5. The signature should remain stable across updates

## Note on Keychain Issues in Development

This stable signing also helps with the keychain access issues in development, as the app identity will be consistent. Consider using the same certificate for local development builds.