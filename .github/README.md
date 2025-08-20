# GitHub Actions CI/CD

This directory contains GitHub Actions workflows for JaTerm's continuous integration and deployment.

## Workflows

### CI (`ci.yml`)
- **Triggers**: On push to main/develop, on pull requests
- **Purpose**: Run tests, linting, and build checks
- **Platforms**: Ubuntu, macOS, Windows
- **Actions**:
  - TypeScript linting and type checking
  - Rust formatting and clippy checks
  - Run all tests
  - Build verification

### Build & Release (`build-release.yml`)
- **Triggers**: 
  - Push to main branch
  - Git tags starting with 'v'
  - Manual workflow dispatch
- **Purpose**: Create installers for all platforms
- **Outputs**:
  - **Windows**: `.msi` installer and `.exe` NSIS installer
  - **macOS**: `.dmg` disk image (Intel and Apple Silicon)
  - **Linux**: `.AppImage` (portable) and `.deb` package
- **Features**:
  - Automatic version management
  - Draft release creation
  - Code signing support (when secrets configured)

### Nightly Build (`nightly.yml`)
- **Triggers**: Daily at 2 AM UTC, manual dispatch
- **Purpose**: Create development builds
- **Retention**: Artifacts kept for 7 days

## Setup Scripts

Before deploying, run these setup scripts:

1. **Generate Updater Keys**:
   ```bash
   ./scripts/generate-updater-keys.sh
   ```
   This creates the Ed25519 key pair for update signing.

2. **Setup GitHub Secrets**:
   ```bash
   ./scripts/setup-github-secrets.sh
   ```
   This helps configure all required GitHub secrets.

3. **Generate Icons**:
   ```bash
   ./scripts/generate-icons-full.sh
   ```
   This creates all required icon formats from SVG.

## Required Secrets

For full functionality, configure these GitHub secrets:

### Apple (macOS) Code Signing
- `APPLE_CERTIFICATE`: Base64 encoded .p12 certificate
- `APPLE_CERTIFICATE_PASSWORD`: Certificate password
- `APPLE_SIGNING_IDENTITY`: Developer ID Application
- `APPLE_ID`: Apple Developer account email
- `APPLE_PASSWORD`: App-specific password
- `APPLE_TEAM_ID`: Apple Developer Team ID

### Windows Code Signing
- `WINDOWS_CERTIFICATE`: Base64 encoded .pfx certificate
- `WINDOWS_CERTIFICATE_PASSWORD`: Certificate password

### Tauri Updater (Optional)
- `TAURI_SIGNING_PRIVATE_KEY`: Private key for update signatures
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Private key password

## Creating a Release

### Automatic Release
1. Push to main branch → Creates draft release
2. Tag with version (e.g., `git tag v1.0.0`) → Creates release

### Manual Release
1. Go to Actions → Build and Release
2. Click "Run workflow"
3. Enter version number
4. Installers will be built and attached to release

## Platform-Specific Notes

### Windows
- Creates MSI installer (recommended)
- Optional NSIS installer for custom installation
- Requires Windows code signing certificate for trusted installation

### macOS
- Builds universal binary (Intel + Apple Silicon)
- Creates DMG installer
- Requires Apple Developer certificate for notarization
- Minimum macOS version: 10.15 (Catalina)

### Linux
- AppImage: Portable, no installation required
- DEB: For Debian/Ubuntu systems
- Dependencies: WebKit2GTK, GTK3, AppIndicator

## Development

To test workflows locally, use [act](https://github.com/nektos/act):

```bash
# Test CI workflow
act -j test

# Test build (without secrets)
act -j build --secret-file .env.secrets
```

## Troubleshooting

### Build Failures
- Check Rust/Node versions match workflow requirements
- Ensure helper binary builds before Tauri
- Verify icon files exist in `src-tauri/icons/`

### Release Issues
- Verify version in `tauri.conf.json` and `Cargo.toml`
- Check GitHub token has appropriate permissions
- Ensure secrets are properly configured

### Platform-Specific Issues
- **Linux**: Install required system dependencies
- **macOS**: Xcode Command Line Tools required
- **Windows**: Visual Studio Build Tools required