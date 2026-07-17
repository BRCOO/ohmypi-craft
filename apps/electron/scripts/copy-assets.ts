/**
 * Cross-platform asset copy script.
 *
 * Copies the resources/ directory to dist/resources/.
 * All bundled assets (docs, themes, permissions, tool-icons) now live in resources/
 * which electron-builder handles natively via directories.buildResources.
 *
 * At Electron startup, setBundledAssetsRoot(__dirname) is called, and then
 * getBundledAssetsDir('docs') resolves to <__dirname>/resources/docs/, etc.
 *
 * Run: bun scripts/copy-assets.ts
 */

import { cpSync, copyFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';

// Copy all resources (icons, themes, docs, permissions, tool-icons, etc.)
// The generated OMP executable and the local OMP cache are deliberately
// excluded: electron-builder copies the target runtime directly to
// resources/omp via extraResources, where the runtime resolver expects it.
// Keeping both out of dist/resources prevents duplicate 147 MB copies (and
// avoids shipping a developer cache in every release).
const generatedOmpRuntime = resolve('resources', 'omp');
const generatedOmpCache = resolve('resources', '.omp-cache');
const copiedOmpRuntime = resolve('dist', 'resources', 'omp');
const copiedOmpCache = resolve('dist', 'resources', '.omp-cache');
const generatedPlatformBins = [
  resolve('resources', 'bin', 'darwin-arm64'),
  resolve('resources', 'bin', 'darwin-x64'),
  resolve('resources', 'bin', 'linux-x64'),
  resolve('resources', 'bin', 'win32-x64'),
];
const copiedPlatformBins = generatedPlatformBins.map(platformDir =>
  resolve('dist', 'resources', 'bin', platformDir.split(/[\\/]/).at(-1)!));
rmSync(copiedOmpRuntime, { recursive: true, force: true });
rmSync(copiedOmpCache, { recursive: true, force: true });
for (const platformDir of copiedPlatformBins) {
  rmSync(platformDir, { recursive: true, force: true });
}
cpSync('resources', 'dist/resources', {
  recursive: true,
  filter: source => {
    const resolved = resolve(source);
    return resolved !== generatedOmpRuntime
      && resolved !== generatedOmpCache
      && !resolved.startsWith(`${generatedOmpCache}/`)
      && !resolved.startsWith(`${generatedOmpCache}\\`)
      && !generatedPlatformBins.some(platformDir => resolved === platformDir
        || resolved.startsWith(`${platformDir}/`)
        || resolved.startsWith(`${platformDir}\\`));
  },
});

console.log('✓ Copied resources/ → dist/resources/');

// Copy PowerShell parser script (for Windows command validation in Explore mode)
// Source: packages/shared/src/agent/powershell-parser.ps1
// Destination: dist/resources/powershell-parser.ps1
const psParserSrc = join('..', '..', 'packages', 'shared', 'src', 'agent', 'powershell-parser.ps1');
const psParserDest = join('dist', 'resources', 'powershell-parser.ps1');
try {
  copyFileSync(psParserSrc, psParserDest);
  console.log('✓ Copied powershell-parser.ps1 → dist/resources/');
} catch (err) {
  // Only warn - PowerShell validation is optional on non-Windows platforms
  console.log('⚠ powershell-parser.ps1 copy skipped (not critical on non-Windows)');
}
