# JaTerm Auto-Updater Setup Guide

## Current Status
The auto-updater is configured but requires additional setup in the GitHub Actions workflow to function properly.

## Requirements for Auto-Updates

### 1. Update Artifacts
For Tauri's auto-updater to work, the following files must be generated and uploaded to GitHub releases:

#### Windows
- **Update bundle**: `.msi` file (currently being generated ✅)
- **Signature**: `.msi.sig` file (needs to be generated ❌)

#### macOS  
- **Update bundle**: `.app.tar.gz` file (needs to be generated ❌)
- **Signature**: `.app.tar.gz.sig` file (needs to be generated ❌)
- Note: The `.dmg` files currently being generated are for manual installation only

#### Linux
- **Update bundle**: `.AppImage` file (currently being generated ✅)
- **Signature**: `.AppImage.sig` file (needs to be generated ❌)

### 2. Signature Generation
All update bundles must be signed using the Tauri updater keys:
```bash
# Generate keys (one-time setup, already done)
pnpm tauri signer generate

# Sign artifacts during build
TAURI_SIGNING_PRIVATE_KEY="your-private-key" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-password" \
pnpm tauri build --target <target>
```

### 3. latest.json File
A `latest.json` file must be generated and uploaded with each release:

```json
{
  "version": "1.1.0",
  "notes": "Release notes here",
  "pub_date": "2025-08-20T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contents of .app.tar.gz.sig>",
      "url": "https://github.com/Kobozo/JaTerm/releases/download/v1.1.0/JaTerm_1.1.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "<contents of .app.tar.gz.sig>",
      "url": "https://github.com/Kobozo/JaTerm/releases/download/v1.1.0/JaTerm_1.1.0_x64.app.tar.gz"
    },
    "linux-x86_64": {
      "signature": "<contents of .AppImage.sig>",
      "url": "https://github.com/Kobozo/JaTerm/releases/download/v1.1.0/JaTerm_1.1.0_amd64.AppImage"
    },
    "windows-x86_64": {
      "signature": "<contents of .msi.sig>",
      "url": "https://github.com/Kobozo/JaTerm/releases/download/v1.1.0/JaTerm_1.1.0_x64.msi"
    }
  }
}
```

## GitHub Actions Workflow Changes Needed

### 1. Enable Updater Artifact Generation
Modify the build command in `.github/workflows/build-release.yml`:
```yaml
- name: Build Tauri application
  env:
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
  run: |
    # Build with updater enabled
    pnpm tauri build --target ${{ matrix.target }} --bundles updater
```

### 2. Generate macOS Update Bundle
After building the `.app`, create the `.app.tar.gz`:
```bash
cd src-tauri/target/*/release/bundle/macos/
tar czf JaTerm.app.tar.gz JaTerm.app
```

### 3. Generate latest.json
Add a job to generate the `latest.json` file after all builds complete:
```yaml
generate-latest-json:
  needs: build
  runs-on: ubuntu-latest
  steps:
    - name: Generate latest.json
      run: |
        # Script to generate latest.json from release assets
        # This should read the .sig files and construct the JSON
```

### 4. Upload Update Artifacts
Ensure all update bundles and signatures are uploaded:
- `JaTerm_*_x64.msi` + `.sig`
- `JaTerm_*_x64.app.tar.gz` + `.sig`
- `JaTerm_*_aarch64.app.tar.gz` + `.sig`
- `JaTerm_*_amd64.AppImage` + `.sig`
- `latest.json`

## Testing Auto-Updates

1. Install a previous version of JaTerm
2. The app should check for updates on startup
3. Click "Check for Updates" in the Help menu
4. If an update is available, it should download and install automatically

## Current Workaround
Until the workflow is updated, users can:
1. Check for updates manually via Help → Check for Updates
2. Click "View Releases on GitHub" to download installers manually
3. Install the new version manually

## References
- [Tauri Updater Documentation](https://v2.tauri.app/plugin/updater/)
- [Tauri GitHub Actions](https://github.com/tauri-apps/tauri-action)