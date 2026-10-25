const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { STATE, digest, writeDetached, assertPrepared, prepareInstalledSources, sourceGradleProperties } = require('./fdroid-source-inputs.cjs');
const { pruneWearSources } = require('./prune-wear-sources.cjs');

const REMOVED_PACKAGES = ['@react-native-google-signin/google-signin', 'expo-dev-client'];

function createFossManifest(manifest) {
  const output = JSON.parse(JSON.stringify(manifest));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of REMOVED_PACKAGES) delete output[field]?.[name];
  }
  // Typecheck/test runners are not used by Expo's native release build. In particular tsx's
  // esbuild host binary must not be installed merely to compile the Android application.
  delete output.devDependencies;
  output.packageManager = 'pnpm@11.25.0';
  output.expo ??= {};
  output.expo.autolinking ??= {};
  output.expo.autolinking.exclude = [...new Set([
    ...(output.expo.autolinking.exclude ?? []), ...REMOVED_PACKAGES,
    'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface', 'context-wear',
  ])];
  output.expo.autolinking.android ??= {};
  output.expo.autolinking.android.buildFromSource = ['.*'];
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
  importer = importer.replace(/^    devDependencies:\n(?: {6}[^\n]*\n|[ ]*\n)*/gm, '');
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
  const root = fs.realpathSync(path.resolve(__dirname, '..'));
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
    const statePath = path.join(root, STATE);
    if (fs.existsSync(statePath)) {
      assertPrepared(root);
      pruneWearSources(root);
      process.stdout.write('This locked F-Droid build checkout is already prepared.\n');
      return;
    }
    if (!ephemeralEasBuild) {
      const clean = spawnSync('git', ['status', '--porcelain', '--untracked-files=no', '--', '.'], { cwd: root, encoding: 'utf8' });
      if (clean.status !== 0 || clean.stdout.trim()) {
        throw new Error('F-Droid source preparation requires a clean Git checkout; use a separate release checkout.');
      }
    }
    const manifestPath = path.join(root, 'package.json');
    const lockPath = path.join(root, 'pnpm-lock.yaml');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== 'context-mobile') throw new Error('This is not the Context mobile package.');
    const lock = createFossLock(fs.readFileSync(lockPath, 'utf8'));
    const wearRemoved = pruneWearSources(root);
    writeDetached(root, manifestPath, `${JSON.stringify(createFossManifest(manifest), null, 2)}\n`);
    writeDetached(root, lockPath, lock);
    writeDetached(root, statePath, `${JSON.stringify({ schemaVersion: 1, root,
      mode: ephemeralEasBuild ? 'eas' : 'source', lockSha256: digest(Buffer.from(lock)), wearRemoved }, null, 2)}\n`);
    process.stdout.write('Prepared the F-Droid dependency manifest. Install with the frozen lockfile in this checkout.\n');
  } else if (mode === '--unsigned-android') {
    assertPrepared(root);
    if (process.env.CONTEXT_FDROID_SOURCE_BUILD !== '1') throw new Error('Unsigned mode requires the explicit official source-build flag.');
    const gradle = path.join(root, 'android', 'app', 'build.gradle');
    writeDetached(root, gradle, unsignedGradle(fs.readFileSync(gradle, 'utf8')));
    const properties = path.join(root, 'android', 'gradle.properties');
    writeDetached(root, properties, sourceGradleProperties(fs.readFileSync(properties, 'utf8')));
    prepareInstalledSources(root, { removeTemplate: true });
    process.stdout.write('Release APK signing is disabled. F-Droid or the release owner signs the resulting artifact separately.\n');
  } else if (mode === '--sanitize') {
    const audit = prepareInstalledSources(root, { removeTemplate: true });
    process.stdout.write(`Reviewed ${audit.removed.length} removed input files and ${audit.patched.length} source patches.\n`);
  } else {
    throw new Error('Use --apply before installation, --sanitize after prebuild, or --unsigned-android only for the official source APK.');
  }
}

module.exports = { createFossManifest, createFossLock, unsignedGradle };
if (require.main === module) main();
