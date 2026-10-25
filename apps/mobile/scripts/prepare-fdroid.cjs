const fs = require('node:fs');
const path = require('node:path');

const REMOVED_PACKAGES = ['@react-native-google-signin/google-signin', 'expo-dev-client'];

function createFossManifest(manifest) {
  const output = JSON.parse(JSON.stringify(manifest));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of REMOVED_PACKAGES) delete output[field]?.[name];
  }
  output.packageManager = 'pnpm@11.25.0';
  output.expo ??= {};
  output.expo.autolinking ??= {};
  output.expo.autolinking.exclude = [...new Set([
    ...(output.expo.autolinking.exclude ?? []), ...REMOVED_PACKAGES,
    'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface',
  ])];
  return output;
}

function createFossLock(lockfile) {
  const normalized = lockfile.replaceAll('\r\n', '\n');
  const packagesOffset = normalized.indexOf('\npackages:\n');
  if (packagesOffset < 0 || !normalized.includes('\n  .:\n')) {
    throw new Error('Unexpected pnpm lockfile layout. Review the F-Droid transform before building.');
  }
  let importer = normalized.slice(0, packagesOffset);
  for (const name of REMOVED_PACKAGES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    importer = importer.replace(new RegExp(`^      (?:'${escaped}'|${escaped}):\\n(?: {8}[^\\n]*\\n)*`, 'gm'), '');
  }
  // Preserve the locked package/snapshot graph verbatim. Unreferenced nodes are not installed;
  // the original source lock still pins every package the FOSS manifest can reach.
  return importer + normalized.slice(packagesOffset);
}

function unsignedGradle(source) {
  if (source.includes('// Context F-Droid: unsigned source-build artifact')) return source;
  if (!source.includes('com.android.application')) throw new Error('Unexpected Android application build file.');
  return `${source}\n// Context F-Droid: unsigned source-build artifact\nandroid {\n    buildTypes {\n        release {\n            signingConfig = null\n        }\n    }\n}\n`;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const requestedMode = process.argv[2];
  if (requestedMode === '--eas-pre-install' && process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION !== 'fdroid') {
    return;
  }
  if (process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION !== 'fdroid') {
    throw new Error('Set EXPO_PUBLIC_CONTEXT_DISTRIBUTION=fdroid for the entire preparation and build.');
  }
  const mode = requestedMode === '--eas-pre-install' ? '--apply' : requestedMode;
  if (mode === '--apply') {
    const ephemeralEasBuild = requestedMode === '--eas-pre-install' && process.env.EAS_BUILD === 'true';
    if (process.env.CONTEXT_FDROID_SOURCE_BUILD !== '1' && !ephemeralEasBuild) {
      throw new Error('Run this only in a clean source-build checkout with CONTEXT_FDROID_SOURCE_BUILD=1.');
    }
    const manifestPath = path.join(root, 'package.json');
    const lockPath = path.join(root, 'pnpm-lock.yaml');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== 'context-mobile') throw new Error('This is not the Context mobile package.');
    const lock = createFossLock(fs.readFileSync(lockPath, 'utf8'));
    fs.writeFileSync(manifestPath, `${JSON.stringify(createFossManifest(manifest), null, 2)}\n`);
    fs.writeFileSync(lockPath, lock);
    process.stdout.write('Prepared the F-Droid dependency manifest. Install with the frozen lockfile in this checkout.\n');
  } else if (mode === '--unsigned-android') {
    const gradle = path.join(root, 'android', 'app', 'build.gradle');
    fs.writeFileSync(gradle, unsignedGradle(fs.readFileSync(gradle, 'utf8')));
    process.stdout.write('Release APK signing is disabled. F-Droid or the release owner signs the resulting artifact separately.\n');
  } else {
    throw new Error('Use --apply before dependency installation, --eas-pre-install for the EAS hook, or --unsigned-android after Expo prebuild.');
  }
}

module.exports = { createFossManifest, createFossLock, unsignedGradle };
if (require.main === module) main();
