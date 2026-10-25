const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const STATE = '.context-fdroid-prepared.json';

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function safeFile(root, file) {
  const resolvedRoot = fs.realpathSync(root);
  const absolute = path.resolve(file);
  if (!inside(resolvedRoot, absolute)) throw new Error(`F-Droid path leaves its build checkout: ${file}`);
  if (fs.existsSync(absolute)) {
    if (!inside(resolvedRoot, fs.realpathSync(absolute)) || !fs.lstatSync(absolute).isFile()) {
      throw new Error(`F-Droid input must be an ordinary file inside its checkout: ${file}`);
    }
  } else {
    const parent = fs.realpathSync(path.dirname(absolute));
    if (parent !== resolvedRoot && !inside(resolvedRoot, parent)) {
      throw new Error(`F-Droid parent leaves its build checkout: ${file}`);
    }
  }
  return absolute;
}

function writeDetached(root, file, bytes) {
  const absolute = safeFile(root, file);
  const mode = fs.existsSync(absolute) ? fs.statSync(absolute).mode : 0o644;
  // pnpm files can be hardlinks to its global store. Unlink before writing any changed bytes.
  if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
  fs.writeFileSync(absolute, bytes, { flag: 'wx', mode });
}

function assertPrepared(root) {
  const real = fs.realpathSync(root);
  if (process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION !== 'fdroid' ||
    (process.env.CONTEXT_FDROID_SOURCE_BUILD !== '1' && process.env.EAS_BUILD !== 'true')) {
    throw new Error('F-Droid sanitation is restricted to an explicitly authorized clean source/EAS build checkout.');
  }
  const state = JSON.parse(fs.readFileSync(path.join(real, STATE), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(real, 'package.json'), 'utf8'));
  if (state.root !== real || manifest.name !== 'context-mobile' ||
    !manifest.expo?.autolinking?.android?.buildFromSource?.includes('.*') ||
    digest(fs.readFileSync(path.join(real, 'pnpm-lock.yaml'))) !== state.lockSha256) {
    throw new Error('This is not the prepared, locked Context F-Droid build checkout.');
  }
  return state;
}

function replaceOnce(source, from, to) {
  if (!source.includes(from) || source.indexOf(from) !== source.lastIndexOf(from)) {
    throw new Error('A reviewed F-Droid source patch no longer matches exactly once.');
  }
  return source.replace(from, to);
}

const sourcePatches = {
  'safe-area-obsolete-local-repository': (source) => replaceOnce(source,
    '    maven {\n        // All of React Native (JS, Obj-C sources, Android binaries) is installed from npm\n        url "$rootDir/../node_modules/react-native/android"\n    }\n',
    '    // Context F-Droid: RN 0.88 has no legacy npm Android Maven directory; use the trusted repositories below.\n'),
  'expo-core-local-publication': (source) => replaceOnce(source,
    '      repositories {\n        maven {\n          url = mavenLocal().url\n        }\n      }',
    '      // Context F-Droid: APK assembly does not publish artifacts to a local Maven repository.'),
  'react-native-local-publication': (source) => replaceOnce(source,
    '    repositories {\n        maven {\n            name = "mavenTempLocal"\n            url = mavenTempLocalUrl\n        }\n    }',
    '    // Context F-Droid: APK assembly does not publish React Native artifacts.'),
  'application-referrer-dependency': (source) => replaceOnce(source,
    "  implementation 'com.android.installreferrer:installreferrer:2.2'\n",
    '  // Context F-Droid: Play Install Referrer is not linked.\n'),
  'application-referrer-source': (input) => {
    let source = input;
    for (const line of ['import android.os.RemoteException\n',
      'import com.android.installreferrer.api.InstallReferrerClient\n',
      'import com.android.installreferrer.api.InstallReferrerStateListener\n',
      'import kotlinx.coroutines.suspendCancellableCoroutine\n', 'import kotlin.coroutines.resume\n',
      'import kotlin.coroutines.resumeWithException\n']) source = replaceOnce(source, line, '');
    const start = source.indexOf('  @JS\n  suspend fun getInstallReferrerAsync(): String = suspendCancellableCoroutine');
    const end = source.indexOf('\n  }\n}', start);
    if (start < 0 || end < start) throw new Error('The reviewed Install Referrer implementation changed.');
    return source.slice(0, start) + '  @JS\n  suspend fun getInstallReferrerAsync(): String =\n' +
      '    throw UnsupportedOperationException("Install referrer is unavailable in Context F-Droid.")\n' +
      source.slice(end + 4);
  },
};

function packageRoots(root, name, version) {
  const store = path.join(root, 'node_modules', '.pnpm');
  if (!fs.existsSync(store)) throw new Error('Install the frozen F-Droid dependencies before sanitizing their source inputs.');
  const prefix = `${name.replace('/', '+')}@${version}`;
  const roots = new Set();
  for (const entry of fs.readdirSync(store)) {
    if (entry !== prefix && !entry.startsWith(`${prefix}_`)) continue;
    const location = path.join(store, entry, 'node_modules', name);
    if (!fs.existsSync(path.join(location, 'package.json'))) continue;
    const real = fs.realpathSync(location);
    if (!inside(fs.realpathSync(root), real)) throw new Error('Package virtual store leaves the build checkout.');
    const manifest = JSON.parse(fs.readFileSync(path.join(real, 'package.json'), 'utf8'));
    if (manifest.name !== name || manifest.version !== version) throw new Error('Reviewed package identity changed.');
    roots.add(real);
  }
  return [...roots];
}

function prepareInstalledSources(root, { removeTemplate = false, inventory } = {}) {
  assertPrepared(root);
  inventory ??= JSON.parse(fs.readFileSync(path.join(__dirname, '../fdroid/source-inputs.json'), 'utf8'));
  const auditPath = path.join(root, '.context-fdroid-input-audit.json');
  const audit = fs.existsSync(auditPath) ? JSON.parse(fs.readFileSync(auditPath, 'utf8')) :
    { schemaVersion: 1, sourceCompilation: { modules: '.*', core: true, sqliteVector: false }, removed: [], patched: [], retainedTools: [] };
  for (const pkg of inventory.packages) {
    for (const location of packageRoots(root, pkg.name, pkg.version)) {
      for (const item of pkg.remove) {
        if (item.afterPrebuild && !removeTemplate) continue;
        const file = path.join(location, item.path);
        if (!fs.existsSync(file)) continue;
        safeFile(root, file);
        const actual = digest(fs.readFileSync(file));
        if (actual !== item.sha256) throw new Error(`Unreviewed F-Droid removal input: ${pkg.name}/${item.path}`);
        fs.unlinkSync(file);
        audit.removed.push({ package: pkg.name, version: pkg.version, path: item.path,
          sha256: actual, reason: item.reason });
      }
      for (const item of pkg.patch ?? []) {
        const file = safeFile(root, path.join(location, item.path));
        const source = fs.readFileSync(file, 'utf8');
        const actual = digest(Buffer.from(source));
        if (actual === item.afterSha256) continue;
        if (actual !== item.beforeSha256) throw new Error(`Unreviewed F-Droid patch input: ${pkg.name}/${item.path}`);
        const changed = sourcePatches[item.id](source);
        if (digest(Buffer.from(changed)) !== item.afterSha256) throw new Error('F-Droid patch output differs from the reviewed transform.');
        writeDetached(root, file, changed);
        audit.patched.push({ package: pkg.name, version: pkg.version, path: item.path, id: item.id,
          beforeSha256: actual, afterSha256: item.afterSha256 });
      }
    }
  }
  const tool = inventory.hermes;
  const roots = packageRoots(root, tool.package, tool.version);
  if (roots.length === 0) throw new Error('The official pinned Hermes compiler package is missing.');
  for (const location of roots) {
    const file = safeFile(root, path.join(location, tool.path));
    if (digest(fs.readFileSync(file)) !== tool.sha256) throw new Error('The approved official Hermes compiler hash changed.');
  }
  audit.retainedTools = [tool];
  writeDetached(root, auditPath, `${JSON.stringify(audit, null, 2)}\n`);
  return audit;
}

function sourceGradleProperties(source) {
  let output = source;
  for (const [name, value] of [['expo.core.buildFromSource', 'true'],
    ['expo.sqlite.withSQLiteVecExtension', 'false'], ['expo.sqlite.useSQLCipher', 'false']]) {
    const expression = new RegExp(`^${name.replaceAll('.', '\\.')}=.*$`, 'gm');
    output = expression.test(output) ? output.replace(expression, `${name}=${value}`) : `${output.trimEnd()}\n${name}=${value}\n`;
  }
  return output;
}

module.exports = { STATE, digest, inside, safeFile, writeDetached, assertPrepared, sourcePatches,
  packageRoots, prepareInstalledSources, sourceGradleProperties };
