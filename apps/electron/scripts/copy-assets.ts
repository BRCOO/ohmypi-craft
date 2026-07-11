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
// The generated OMP executable is deliberately excluded: electron-builder copies
// it directly to resources/omp via extraResources, where the runtime resolver
// expects it. Keeping it out of dist/resources prevents a second 147 MB copy.
const generatedOmpRuntime = resolve('resources', 'omp');
const copiedOmpRuntime = resolve('dist', 'resources', 'omp');
rmSync(copiedOmpRuntime, { recursive: true, force: true });
cpSync('resources', 'dist/resources', {
  recursive: true,
  filter: source => resolve(source) !== generatedOmpRuntime,
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
