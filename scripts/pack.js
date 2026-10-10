const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const stagingDir = path.join(rootDir, 'dist_staging');

function copyDirRecursive(src, dest, filterFn) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (filterFn && !filterFn(srcPath, entry.name)) {
            continue;
        }
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath, filterFn);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

try {
    console.log('[Pack] Starting extension packaging...');

    // 1. Ensure build/popup.html and build/options.html exist
    const rootPopup = path.join(rootDir, 'popup.html');
    const buildPopup = path.join(rootDir, 'build', 'popup.html');
    if (fs.existsSync(rootPopup)) {
        fs.mkdirSync(path.join(rootDir, 'build'), { recursive: true });
        fs.copyFileSync(rootPopup, buildPopup);
        console.log('[Pack] Synchronized popup.html into build/');
    }

    const rootOptions = path.join(rootDir, 'options.html');
    const buildOptions = path.join(rootDir, 'build', 'options.html');
    if (fs.existsSync(rootOptions)) {
        fs.mkdirSync(path.join(rootDir, 'build'), { recursive: true });
        fs.copyFileSync(rootOptions, buildOptions);
        console.log('[Pack] Synchronized options.html into build/');
    }

    // 2. Build browser-specific packages so Firefox 109 can use scripts while Chrome uses a service worker
    for (const browser of ['firefox', 'chrome']) {
        if (fs.existsSync(stagingDir)) {
            fs.rmSync(stagingDir, { recursive: true, force: true });
        }
        fs.mkdirSync(stagingDir, { recursive: true });

        const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
        if (browser === 'firefox') {
            delete manifest.background.service_worker;
        } else {
            delete manifest.background.scripts;
            delete manifest.browser_specific_settings;
        }
        fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

        // 4. Copy build/
        copyDirRecursive(path.join(rootDir, 'build'), path.join(stagingDir, 'build'));

        // 5. Copy assets/ (exclude screenshot.gif)
        copyDirRecursive(
            path.join(rootDir, 'assets'),
            path.join(stagingDir, 'assets'),
            (_fullPath, name) => !name.toLowerCase().endsWith('.gif')
        );

        // 6. Delete old zip if exists
        const outputZip = path.join(rootDir, `netflix-ratings-${browser}.zip`);
        if (fs.existsSync(outputZip)) {
            fs.unlinkSync(outputZip);
        }

        // 7. Compress into .zip
        console.log(`[Pack] Compressing ${browser} package...`);
        if (process.platform === 'win32') {
            // Use PowerShell Compress-Archive
            const psCommand = `powershell -NoProfile -Command "Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${outputZip}' -Force"`;
            execSync(psCommand, { stdio: 'inherit' });
        } else {
            execSync(`cd "${stagingDir}" && zip -r "${outputZip}" ./*`, { stdio: 'inherit' });
        }

        // 8. Clean up staging directory
        fs.rmSync(stagingDir, { recursive: true, force: true });

        const stats = fs.statSync(outputZip);
        const sizeKb = (stats.size / 1024).toFixed(1);
        console.log(`[Pack] SUCCESS! Package created at: ${outputZip} (${sizeKb} KB)`);
    }
} catch (err) {
    console.error('[Pack] Failed to create extension package:', err);
    if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    process.exit(1);
}
