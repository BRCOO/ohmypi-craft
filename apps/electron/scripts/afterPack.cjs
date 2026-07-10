/**
 * electron-builder afterPack hook
 *
 * Copies the optional macOS 26+ Liquid Glass icon (Assets.car) into the
 * app bundle. The Assets.car file can be compiled locally using actool with
 * the macOS 26 SDK (not available in CI). If it is absent, the app falls back
 * to icon.icns.
 *
 * To regenerate Assets.car after icon changes:
 *   cd apps/electron
 *   xcrun actool "resources/icon.icon" --compile "resources" \
 *     --app-icon AppIcon --minimum-deployment-target 26.0 \
 *     --platform macosx --output-partial-info-plist /dev/null
 *
 * For older macOS versions, the app falls back to icon.icns which is
 * included separately by electron-builder.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

function warnOrFailWindowsIcon(message) {
  if (process.env.CRAFT_DEV_RUNTIME === '1') {
    console.log(`Warning: ${message}`);
    return;
  }
  throw new Error(message);
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') {
    const productFilename = context.packager.appInfo.productFilename || context.packager.appInfo.productName || 'Oh My Pi';
    const productName = context.packager.appInfo.productName || 'Oh My Pi';
    const version = context.packager.appInfo.version || '0.0.0';
    const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
    const iconPath = path.join(context.packager.projectDir, 'resources', 'icon.ico');
    const rceditPath = path.join(context.packager.projectDir, '..', '..', 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');

    // Local Windows dev packaging disables electron-builder's winCodeSign/rcedit
    // path to avoid extracting symlinks that require Developer Mode/admin rights.
    // Re-apply the app icon explicitly so the installed executable and shortcuts
    // still use the Oh My Pi identity instead of Electron's default icon.
    if (!fs.existsSync(exePath)) {
      warnOrFailWindowsIcon(`Windows app executable not found for icon update: ${exePath}`);
      return;
    }
    if (!fs.existsSync(iconPath)) {
      warnOrFailWindowsIcon(`Windows app icon not found: ${iconPath}`);
      return;
    }
    if (!fs.existsSync(rceditPath)) {
      warnOrFailWindowsIcon(`rcedit not found; Windows app exe icon was not updated: ${rceditPath}`);
      return;
    }

    try {
      execFileSync(rceditPath, [
        exePath,
        '--set-icon', iconPath,
        '--set-version-string', 'FileDescription', productName,
        '--set-version-string', 'ProductName', productName,
        '--set-version-string', 'CompanyName', 'Oh My Pi',
        '--set-file-version', version,
        '--set-product-version', version,
      ], { stdio: 'inherit' });
      console.log(`Windows app exe icon updated: ${exePath}`);
    } catch (err) {
      warnOrFailWindowsIcon(`Could not update Windows app exe icon: ${err.message}`);
    }
    return;
  }

  // Only process macOS builds
  if (context.electronPlatformName !== 'darwin') {
    console.log('Skipping Liquid Glass icon (not macOS)');
    return;
  }

  const appPath = context.appOutDir;
  const productFilename = context.packager.appInfo.productFilename || context.packager.appInfo.productName || 'Oh My Pi';
  const resourcesDir = path.join(appPath, `${productFilename}.app`, 'Contents', 'Resources');
  const precompiledAssets = path.join(context.packager.projectDir, 'resources', 'Assets.car');

  console.log(`afterPack: projectDir=${context.packager.projectDir}`);
  console.log(`afterPack: looking for Assets.car at ${precompiledAssets}`);

  // Check if pre-compiled Assets.car exists
  if (!fs.existsSync(precompiledAssets)) {
    console.log('Warning: Pre-compiled Assets.car not found in resources/');
    console.log('The app will use the fallback icon.icns on all macOS versions');
    return;
  }

  // Copy pre-compiled Assets.car to the app bundle
  const destAssetsCar = path.join(resourcesDir, 'Assets.car');
  try {
    fs.copyFileSync(precompiledAssets, destAssetsCar);
    console.log(`Liquid Glass icon copied: ${destAssetsCar}`);
  } catch (err) {
    // Don't fail the build if Assets.car can't be copied - app will use fallback icon.icns
    console.log(`Warning: Could not copy Assets.car: ${err.message}`);
    console.log('The app will use the fallback icon.icns on all macOS versions');
  }
};
