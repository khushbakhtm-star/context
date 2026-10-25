const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const { createHash } = require('node:crypto');
const { createFossManifest, createFossLock, unsignedGradle } = require('../scripts/prepare-fdroid.cjs');
const { STATE, digest, writeDetached, prepareInstalledSources, sourcePatches, sourceGradleProperties } = require('../scripts/fdroid-source-inputs.cjs');

const root = path.resolve(__dirname, '..');

function appConfig(env) {
  const filename = path.join(root, 'app.config.ts');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInContext(js, vm.createContext({ module, exports: module.exports, process: { env } }), { filename });
  return module.exports.default;
}

test('store builds preserve native Google sign-in with its registered reversed iOS scheme', () => {
  const config = appConfig({ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: '123-example.apps.googleusercontent.com' })({
    config: { name: 'Context', slug: 'context', plugins: ['expo-dev-client', '@react-native-google-signin/google-signin'] },
  });
  const plugin = config.plugins.find((entry) => Array.isArray(entry) && entry[0] === '@react-native-google-signin/google-signin');
  assert.equal(plugin[1].iosUrlScheme, 'com.googleusercontent.apps.123-example');
  assert.ok(config.plugins.includes('expo-dev-client'));
});

test('F-Droid configuration removes Google and dev-client plugins regardless of registered client IDs', () => {
  const config = appConfig({ EXPO_PUBLIC_CONTEXT_DISTRIBUTION: 'fdroid',
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: '123-example.apps.googleusercontent.com' })({
    config: { name: 'Context', slug: 'context', plugins: ['expo-dev-client', 'expo-sqlite',
      ['@react-native-google-signin/google-signin', { iosUrlScheme: 'old' }]] },
  });
  assert.equal(config.extra.distribution, 'fdroid');
  assert.deepEqual(JSON.parse(JSON.stringify(config.plugins)), ['expo-sqlite', './plugins/with-fdroid-source.cjs']);
});

test('F-Droid disables native Google autolinking and Metro resolves its import to a local source stub', () => {
  const env = { EXPO_PUBLIC_CONTEXT_DISTRIBUTION: 'fdroid' };
  const rnModule = { exports: {} };
  vm.runInContext(fs.readFileSync(path.join(root, 'react-native.config.js'), 'utf8'),
    vm.createContext({ module: rnModule, process: { env } }));
  assert.equal(rnModule.exports.dependencies['@react-native-google-signin/google-signin'].platforms.android, null);
  let defaultCalls = 0;
  const metroModule = { exports: {} };
  vm.runInContext(fs.readFileSync(path.join(root, 'metro.config.js'), 'utf8'), vm.createContext({
    module: metroModule, process: { env }, __dirname: root,
    require(name) {
      if (name === 'node:path') return path;
      if (name === 'expo/metro-config') return { getDefaultConfig: () => ({ resolver: {} }) };
      throw new Error(`Unexpected distribution test import: ${name}`);
    },
  }));
  const resolver = metroModule.exports.resolver.resolveRequest;
  const context = { resolveRequest: () => { defaultCalls += 1; return { type: 'sourceFile', filePath: 'normal' }; } };
  const google = resolver(context, '@react-native-google-signin/google-signin', 'android');
  assert.equal(google.filePath, path.join(root, 'src/sync/google-signin-unavailable.js'));
  assert.equal(defaultCalls, 0);
  assert.equal(resolver(context, 'expo-sqlite', 'android').filePath, 'normal');
  assert.equal(defaultCalls, 1);
});

test('F-Droid account code can load and disconnect old Google settings without loading a missing native module', async () => {
  let accounts = [{ id: 'google:user', provider: 'google', subject: 'user', label: 'User',
    consent: { ledgerStorage: true, calendarRead: true, calendarWrite: false,
      replaceOccurrences: false, importCalendarEdits: true } }];
  let nativeLoads = 0;
  const filename = path.join(root, 'src/sync/accounts.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInContext(code, vm.createContext({
    module, exports: module.exports, Headers, URL,
    require(name) {
      if (name === 'react-native') return { Platform: { OS: 'android' } };
      if (name === 'expo-auth-session') return {};
      if (name === 'expo-web-browser') return { maybeCompleteAuthSession() {} };
      if (name === 'expo-secure-store') return { deleteItemAsync: async () => {}, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' };
      if (name === 'expo-crypto') return { CryptoDigestAlgorithm: { SHA256: 'SHA256' },
        digestStringAsync: async (_algorithm, value) => createHash('sha256').update(value).digest('hex') };
      if (name === '../data/database') return { getSetting: async () => accounts,
        setSetting: async (_key, value) => { accounts = value; } };
      if (name === './config') return { accountConfig: { distribution: 'fdroid' },
        assertGoogleConfiguration() { throw new Error('F-Droid Google connection is disabled'); } };
      if (name === './webdav') return {};
      if (name === '@react-native-google-signin/google-signin') {
        nativeLoads += 1;
        throw new Error('Native SDK intentionally absent');
      }
      throw new Error(`Unexpected accounts test import: ${name}`);
    },
  }), { filename });
  assert.equal(nativeLoads, 0);
  assert.equal((await module.exports.getAccounts()).length, 1);
  await module.exports.disconnectAccount('google:user');
  assert.equal(accounts.length, 0);
  assert.equal(nativeLoads, 0);
  const consent = module.exports.normalizedConsent({ ledgerStorage: true, calendarRead: true,
    calendarWrite: true, replaceOccurrences: true, importCalendarEdits: true,
    editInvitations: true, editSeries: true, categoryRead: true });
  assert.equal(consent.editInvitations, true);
  assert.equal(consent.editSeries, true);
  assert.equal(consent.categoryRead, true);
});

test('source-build manifest excludes proprietary sign-in and development client without editing store dependencies', () => {
  const original = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const foss = createFossManifest(original);
  assert.equal(foss.dependencies['@react-native-google-signin/google-signin'], undefined);
  assert.equal(foss.dependencies['expo-dev-client'], undefined);
  assert.equal(foss.devDependencies, undefined);
  assert.ok(original.dependencies['@react-native-google-signin/google-signin']);
  assert.equal(foss.dependencies.expo, original.dependencies.expo);
  assert.equal(foss.packageManager, 'pnpm@11.25.0');
  assert.ok(foss.expo.autolinking.exclude.includes('@react-native-google-signin/google-signin'));
  assert.deepEqual(foss.expo.autolinking.android.buildFromSource, ['.*']);
  const lock = createFossLock(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
  const importer = lock.slice(0, lock.indexOf('\npackages:\n'));
  assert.doesNotMatch(importer, /google-signin|expo-dev-client/);
  assert.doesNotMatch(importer, /devDependencies:|tsx:|typescript:/);
  assert.match(importer, /expo-calendar:/);
  assert.match(lock, /lockfileVersion: '9.0'/);
  assert.equal(createFossLock(lock), lock);
});

test('F-Droid source recipe produces unsigned output and keeps metadata disabled until a real source release exists', () => {
  const original = 'plugins { id "com.android.application" }\nandroid { buildTypes { release { signingConfig signingConfigs.debug } } }';
  const unsigned = unsignedGradle(original);
  assert.match(unsigned, /signingConfig = null/);
  assert.equal(unsignedGradle(unsigned), unsigned);
  const metadata = fs.readFileSync(path.join(root, 'fdroid/com.context.minuteledger.yml.template'), 'utf8');
  assert.match(metadata, /License: MIT/);
  assert.match(metadata, /disable: Public source URL/);
  assert.match(metadata, /OWNER_IMMUTABLE_RELEASE_COMMIT/);
  assert.match(metadata, /app-release-unsigned\.apk/);
});

test('Google Play and Apple profiles build store artifacts and only stage internal/draft submissions', () => {
  const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
  assert.equal(eas.build.production.distribution, 'store');
  assert.equal(eas.build.production.android.buildType, 'app-bundle');
  assert.equal(eas.build.production.ios.simulator, false);
  assert.equal(eas.build['google-play'].extends, 'production');
  assert.equal(eas.build['apple-app-store'].extends, 'production');
  assert.equal(eas.submit['google-play'].android.track, 'internal');
  assert.equal(eas.submit['google-play'].android.releaseStatus, 'draft');
  assert.equal(eas.build['fdroid-preview'].env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION, 'fdroid');
});

test('EAS pre-install hook skips store builds and refuses a local F-Droid invocation without explicit build authority', () => {
  const script = path.join(root, 'scripts/prepare-fdroid.cjs');
  const store = spawnSync(process.execPath, [script, '--eas-pre-install'], {
    env: { ...process.env, EXPO_PUBLIC_CONTEXT_DISTRIBUTION: 'store', EAS_BUILD: '', CONTEXT_FDROID_SOURCE_BUILD: '' },
    encoding: 'utf8',
  });
  assert.equal(store.status, 0);
  const local = spawnSync(process.execPath, [script, '--eas-pre-install'], {
    env: { ...process.env, EXPO_PUBLIC_CONTEXT_DISTRIBUTION: 'fdroid', EAS_BUILD: '', CONTEXT_FDROID_SOURCE_BUILD: '' },
    encoding: 'utf8',
  });
  assert.notEqual(local.status, 0);
  assert.match(local.stderr, /clean source-build checkout/);
});

test('F-Droid EAS hook prunes only the temporary build checkout and preserves its locked graph', (t) => {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'context-fdroid-hook-'));
  t.after(() => fs.rmSync(staging, { recursive: true, force: true }));
  fs.mkdirSync(path.join(staging, 'scripts'));
  const script = path.join(staging, 'scripts/prepare-fdroid.cjs');
  fs.copyFileSync(path.join(root, 'scripts/prepare-fdroid.cjs'), script);
  fs.copyFileSync(path.join(root, 'scripts/fdroid-source-inputs.cjs'), path.join(staging, 'scripts/fdroid-source-inputs.cjs'));
  fs.copyFileSync(path.join(root, 'scripts/prune-wear-sources.cjs'), path.join(staging, 'scripts/prune-wear-sources.cjs'));
  fs.mkdirSync(path.join(staging, 'fdroid'));
  fs.writeFileSync(path.join(staging, 'fdroid/wear-source-inputs.json'), JSON.stringify({ schemaVersion: 1, files: [] }));
  fs.copyFileSync(path.join(root, 'package.json'), path.join(staging, 'package.json'));
  fs.copyFileSync(path.join(root, 'pnpm-lock.yaml'), path.join(staging, 'pnpm-lock.yaml'));
  const result = spawnSync(process.execPath, [script, '--eas-pre-install'], {
    env: { ...process.env, EXPO_PUBLIC_CONTEXT_DISTRIBUTION: 'fdroid', EAS_BUILD: 'true', CONTEXT_FDROID_SOURCE_BUILD: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies['@react-native-google-signin/google-signin'], undefined);
  assert.equal(manifest.dependencies['expo-dev-client'], undefined);
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies['@react-native-google-signin/google-signin']);
});

test('F-Droid source flags select Expo core compilation and keep optional vector binaries disabled', () => {
  const properties = sourceGradleProperties('expo.core.buildFromSource=false\nexpo.sqlite.withSQLiteVecExtension=true\n');
  assert.match(properties, /expo\.core\.buildFromSource=true/);
  assert.match(properties, /expo\.sqlite\.withSQLiteVecExtension=false/);
  assert.match(properties, /expo\.sqlite\.useSQLCipher=false/);
  assert.equal(sourceGradleProperties(properties), properties);
});

test('reviewed source sanitation is hash checked, deferred until prebuild, and detaches pnpm hardlinks', (t) => {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'context-fdroid-inputs-'));
  t.after(() => fs.rmSync(staging, { recursive: true, force: true }));
  const real = fs.realpathSync(staging);
  const beforeEnv = { distribution: process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION, source: process.env.CONTEXT_FDROID_SOURCE_BUILD };
  process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION = 'fdroid';
  process.env.CONTEXT_FDROID_SOURCE_BUILD = '1';
  t.after(() => {
    if (beforeEnv.distribution === undefined) delete process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION;
    else process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION = beforeEnv.distribution;
    if (beforeEnv.source === undefined) delete process.env.CONTEXT_FDROID_SOURCE_BUILD;
    else process.env.CONTEXT_FDROID_SOURCE_BUILD = beforeEnv.source;
  });
  fs.writeFileSync(path.join(real, 'package.json'), JSON.stringify({ name: 'context-mobile', expo: { autolinking: { android: { buildFromSource: ['.*'] } } } }));
  fs.writeFileSync(path.join(real, 'pnpm-lock.yaml'), 'locked\n');
  fs.writeFileSync(path.join(real, STATE), JSON.stringify({ root: real, lockSha256: digest(Buffer.from('locked\n')) }));
  const directory = path.join(real, 'node_modules/.pnpm/reviewed@1.0.0/node_modules/reviewed');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'reviewed', version: '1.0.0' }));
  fs.writeFileSync(path.join(directory, 'unused.aar'), 'unused publication');
  fs.writeFileSync(path.join(directory, 'template.tgz'), 'extracted template');
  const original = '    repositories {\n        maven {\n            name = "mavenTempLocal"\n            url = mavenTempLocalUrl\n        }\n    }';
  const cache = path.join(real, 'simulated-pnpm-store-source.gradle');
  fs.writeFileSync(cache, original);
  fs.linkSync(cache, path.join(directory, 'publish.gradle'));
  const hermes = path.join(real, 'node_modules/.pnpm/hermes-compiler@1.0.0/node_modules/hermes-compiler');
  fs.mkdirSync(path.join(hermes, 'hermesc/linux64-bin'), { recursive: true });
  fs.writeFileSync(path.join(hermes, 'package.json'), JSON.stringify({ name: 'hermes-compiler', version: '1.0.0' }));
  fs.writeFileSync(path.join(hermes, 'hermesc/linux64-bin/hermesc'), 'official compiler fixture');
  const inventory = { packages: [{ name: 'reviewed', version: '1.0.0', remove: [
    { path: 'unused.aar', sha256: digest(Buffer.from('unused publication')) },
    { path: 'template.tgz', sha256: digest(Buffer.from('extracted template')), afterPrebuild: true }],
    patch: [{ id: 'react-native-local-publication', path: 'publish.gradle', beforeSha256: digest(Buffer.from(original)),
      afterSha256: digest(Buffer.from(sourcePatches['react-native-local-publication'](original))) }] }],
    hermes: { package: 'hermes-compiler', version: '1.0.0', path: 'hermesc/linux64-bin/hermesc', sha256: digest(Buffer.from('official compiler fixture')) } };
  prepareInstalledSources(real, { inventory });
  assert.equal(fs.existsSync(path.join(directory, 'unused.aar')), false);
  assert.equal(fs.existsSync(path.join(directory, 'template.tgz')), true);
  assert.equal(fs.readFileSync(cache, 'utf8'), original, 'the shared cache inode must retain its original bytes');
  assert.doesNotMatch(fs.readFileSync(path.join(directory, 'publish.gradle'), 'utf8'), /url = mavenTempLocalUrl/);
  prepareInstalledSources(real, { inventory, removeTemplate: true });
  assert.equal(fs.existsSync(path.join(directory, 'template.tgz')), false);
  assert.throws(() => writeDetached(real, path.join(real, '..', 'outside-fdroid-checkout.txt'), 'blocked'), /leaves/);
  fs.writeFileSync(path.join(directory, 'unused.aar'), 'unexpected changed binary');
  assert.throws(() => prepareInstalledSources(real, { inventory }), /Unreviewed F-Droid removal input/);
});
