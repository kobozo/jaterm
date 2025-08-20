# GitHub Actions Apple Code Signing Setup

This guide will help you set up proper code signing for macOS builds in GitHub Actions.

## Prerequisites

1. **Apple Developer Account** ($99/year)
   - Sign up at: https://developer.apple.com/programs/
   
2. **Developer ID Application Certificate**
   - This is different from a regular development certificate
   - Required for distributing apps outside the Mac App Store

## Step 1: Create Your Certificate

1. Go to [Apple Developer Certificates](https://developer.apple.com/account/resources/certificates/list)
2. Click the "+" button to create a new certificate
3. Select **"Developer ID Application"** (under Production)
4. Follow the instructions to create a Certificate Signing Request (CSR)
5. Download the certificate when complete

## Step 2: Export Certificate from Keychain

1. Double-click the downloaded certificate to add it to Keychain Access
2. Open **Keychain Access** app
3. Find your certificate: "Developer ID Application: Your Name (TEAMID)"
4. Right-click on the certificate
5. Select **"Export..."**
6. Save as `.p12` format
7. **Set a strong password** (you'll need this for GitHub secrets)
8. Save the file (e.g., `developer_id.p12`)

## Step 3: Generate GitHub Secrets

Run the helper script with your certificate:

```bash
./generate_apple_secrets.sh path/to/your/developer_id.p12
```

This will create `github_secrets.txt` with your base64-encoded certificate.

## Step 4: Find Your Signing Identity

Run this command to find your exact signing identity:

```bash
security find-identity -v -p codesigning
```

Look for a line like:
```
1) ABCDEF1234... "Developer ID Application: Your Name (TEAMID)"
```

The signing identity is the quoted part: `"Developer ID Application: Your Name (TEAMID)"`

## Step 5: Create App-Specific Password

For notarization, you need an app-specific password:

1. Go to [Apple ID Account](https://appleid.apple.com/account/manage)
2. Sign in with your Apple ID
3. In the Security section, under "App-Specific Passwords", click "Generate Password..."
4. Enter a label like "JaTerm GitHub Actions"
5. Save the generated password

## Step 6: Add Secrets to GitHub

Go to your repository's Settings → Secrets and variables → Actions

Add these repository secrets:

| Secret Name | Value | Where to Find |
|------------|-------|---------------|
| `APPLE_CERTIFICATE` | Base64 encoded .p12 file | From `github_secrets.txt` |
| `APPLE_CERTIFICATE_PASSWORD` | Your .p12 export password | Password you set in Step 2 |
| `APPLE_SIGNING_IDENTITY` | e.g., "Developer ID Application: Name (TEAM)" | From Step 4 |
| `APPLE_ID` | your@email.com | Your Apple ID email |
| `APPLE_PASSWORD` | xxxx-xxxx-xxxx-xxxx | App-specific password from Step 5 |
| `APPLE_TEAM_ID` | ABCDEF1234 | From developer.apple.com/account/#/membership |

## Step 7: Test the Build

1. Push to your repository
2. Check the Actions tab
3. The macOS build should now properly sign the app

## Troubleshooting

### "Certificate not trusted" error
- Make sure you're using a **Developer ID Application** certificate, not a development certificate

### "Unable to build chain to self-signed root" error
- Install Apple Worldwide Developer Relations Intermediate Certificate
- Download from: https://developer.apple.com/certificationauthority/AppleWWDRCA.cer

### Notarization fails
- Ensure your app-specific password is correct
- Check that your Apple ID has accepted the latest developer agreements
- Visit: https://developer.apple.com/account/

### Local Testing

To test signing locally:
```bash
codesign --force --deep --sign "Developer ID Application: Your Name (TEAMID)" /path/to/JaTerm.app
```

To verify signature:
```bash
codesign -dv --verbose=4 /path/to/JaTerm.app
spctl -a -vvv -t execute /path/to/JaTerm.app
```

## Additional Notes

- The certificate expires after 5 years
- You can have multiple Developer ID certificates
- Keep your .p12 file and password secure
- The app will be automatically notarized during the build process (if credentials are correct)

## Security Warning

**NEVER commit**:
- Your .p12 certificate file
- Any passwords
- The `github_secrets.txt` file

These files are in `.gitignore` to prevent accidental commits.