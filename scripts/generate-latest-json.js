#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const version = (args[0] || '').replace(/^v/, ''); // Remove 'v' prefix if present
const notes = args[1] || `JaTerm v${version} is now available!`;
const repo = process.env.GITHUB_REPOSITORY || 'Kobozo/JaTerm';

if (!version) {
    console.error('Usage: node generate-latest-json.js <version> [notes]');
    console.error('Example: node generate-latest-json.js 1.1.0 "Bug fixes and improvements"');
    process.exit(1);
}

// Configuration for each platform
const platforms = [
    {
        key: 'windows-x86_64',
        bundle: `JaTerm_${version}_x64.msi`,
        sigFile: `JaTerm_${version}_x64.msi.sig`
    },
    {
        key: 'darwin-x86_64',
        bundle: `JaTerm_${version}_x64.app.tar.gz`,
        sigFile: `JaTerm_${version}_x64.app.tar.gz.sig`
    },
    {
        key: 'darwin-aarch64',
        bundle: `JaTerm_${version}_aarch64.app.tar.gz`,
        sigFile: `JaTerm_${version}_aarch64.app.tar.gz.sig`
    },
    {
        key: 'linux-x86_64',
        bundle: `JaTerm_${version}_amd64.AppImage`,
        sigFile: `JaTerm_${version}_amd64.AppImage.sig`
    }
];

// Build the latest.json structure
const latest = {
    version: version,
    notes: notes,
    pub_date: new Date().toISOString(),
    platforms: {}
};

// Check dist directory
const distDir = path.join(process.cwd(), 'dist');
if (!fs.existsSync(distDir)) {
    console.warn('Warning: dist directory not found. Looking in current directory.');
}

// Process each platform
for (const platform of platforms) {
    const bundlePath = path.join(distDir, platform.bundle);
    const sigPath = path.join(distDir, platform.sigFile);
    
    // Check if bundle exists
    if (fs.existsSync(bundlePath)) {
        console.log(`Found bundle for ${platform.key}: ${platform.bundle}`);
        
        // Read signature if it exists
        let signature = '';
        if (fs.existsSync(sigPath)) {
            signature = fs.readFileSync(sigPath, 'utf8').trim();
            console.log(`  Found signature: ${platform.sigFile}`);
        } else {
            console.warn(`  Warning: Signature not found: ${platform.sigFile}`);
            // For testing/development, generate a placeholder signature
            if (process.env.GENERATE_PLACEHOLDER_SIG === 'true') {
                signature = crypto.randomBytes(64).toString('base64');
                console.log('  Generated placeholder signature for testing');
            }
        }
        
        // Add platform to manifest
        latest.platforms[platform.key] = {
            signature: signature,
            url: `https://github.com/${repo}/releases/download/v${version}/${platform.bundle}`
        };
    } else {
        console.log(`Bundle not found for ${platform.key}: ${bundlePath}`);
    }
}

// Check if we have at least one platform
if (Object.keys(latest.platforms).length === 0) {
    console.error('Error: No platform bundles found!');
    console.error('Make sure to run this script after building all platforms.');
    process.exit(1);
}

// Write the latest.json file
const outputPath = path.join(distDir, 'latest.json');
fs.writeFileSync(outputPath, JSON.stringify(latest, null, 2));

console.log(`\nGenerated latest.json for version ${version}`);
console.log(`Output: ${outputPath}`);
console.log('\nContent:');
console.log(JSON.stringify(latest, null, 2));

// Also write to current directory for CI
fs.writeFileSync('latest.json', JSON.stringify(latest, null, 2));
console.log('\nAlso saved to: ./latest.json');