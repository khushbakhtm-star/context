const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const { assertGoogleOAuthBuildConfiguration, GOOGLE_PHONE_PROFILES } = require('../scripts/google-oauth-preflight.cjs');

// Synthetic identifiers are test data only, never application/build configuration.
const WEB = '123456789012-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.apps.googleusercontent.com';
const IOS = '123456789012-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.apps.googleusercontent.com';
const root = path.resolve(__dirname, '..');
const phone = { EAS_BUILD_PROFILE: 'preview', EAS_BUILD_PLATFORM: 'android' };

function appConfig(env) {
  const filename = path.join(root, 'app.config.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, process: { env },
    require(name) {
      assert.equal(name, './scripts/google-oauth-preflight.cjs');
      return require('../scripts/google-oauth-preflight.cjs');
    },
  }, { filename });
  return module.exports.default({ config: { name: 'Context', slug: 'context', plugins: [] } });
}

test('every Google-enabled phone release profile fails before configuration without its Web client', () => {
  for (const profile of GOOGLE_PHONE_PROFILES) {
    assert.throws(() => assertGoogleOAuthBuildConfiguration({ ...phone, EAS_BUILD_PROFILE: profile }),
      /EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID/, profile);
  }
  assert.throws(() => appConfig(phone), /EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID/,
    'the real Expo app config must invoke the preflight');
});

test('Android phone builds accept a Web client without requiring iOS configuration', () => {
  const env = { ...phone, EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB };
  assert.deepEqual(assertGoogleOAuthBuildConfiguration(env), { required: true, platform: 'android' });
  assert.doesNotThrow(() => appConfig(env));
  assert.equal(env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID, undefined);
});

test('iOS requires both client IDs and retains the reversed native callback scheme', () => {
  const env = { ...phone, EAS_BUILD_PROFILE: 'apple-app-store', EAS_BUILD_PLATFORM: 'ios',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB };
  assert.throws(() => assertGoogleOAuthBuildConfiguration(env), /EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID/);
  const configured = { ...env, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: IOS };
  const result = appConfig(configured);
  const plugin = result.plugins.find((entry) => Array.isArray(entry) && entry[0] === '@react-native-google-signin/google-signin');
  assert.equal(plugin[1].iosUrlScheme, 'com.googleusercontent.apps.123456789012-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
});

test('malformed, placeholder, and whitespace client IDs cannot ship', () => {
  for (const value of ['', ' ', ` ${WEB}`, `${WEB}\n`, 'not-a-client-id',
    '123-example.apps.googleusercontent.com', '123-YOUR_CLIENT_ID.apps.googleusercontent.com',
    '123-placeholder.apps.googleusercontent.com', 'https://' + WEB, WEB + '.invalid']) {
    assert.throws(() => assertGoogleOAuthBuildConfiguration({ ...phone, EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: value }),
      /Google OAuth build preflight/, JSON.stringify(value));
  }
  assert.throws(() => assertGoogleOAuthBuildConfiguration({ ...phone, EAS_BUILD_PLATFORM: 'ios',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: '123-example.apps.googleusercontent.com' }),
  /EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID/);
});

test('F-Droid and the pure watch APK stay exempt even when a phone profile or opt-in flag is present', () => {
  const requested = { ...phone, CONTEXT_REQUIRE_GOOGLE_OAUTH: '1' };
  assert.deepEqual(assertGoogleOAuthBuildConfiguration({ ...requested, EXPO_PUBLIC_CONTEXT_DISTRIBUTION: 'fdroid' }),
    { required: false });
  assert.deepEqual(assertGoogleOAuthBuildConfiguration({ ...requested, CONTEXT_WEAR_BUILD: '1' }), { required: false });
  assert.doesNotThrow(() => appConfig({ ...requested, EXPO_PUBLIC_CONTEXT_DISTRIBUTION: 'fdroid' }));
  assert.doesNotThrow(() => appConfig({ ...requested, CONTEXT_WEAR_BUILD: '1' }));
});

test('source exports and development work remain available, with explicit preflight for custom builds', () => {
  for (const env of [{}, { EAS_BUILD: 'true' }, { EAS_BUILD_PROFILE: 'development' }, { EAS_BUILD_PROFILE: 'custom' }]) {
    assert.deepEqual(assertGoogleOAuthBuildConfiguration(env), { required: false });
    assert.doesNotThrow(() => appConfig(env));
  }
  assert.throws(() => assertGoogleOAuthBuildConfiguration({ CONTEXT_REQUIRE_GOOGLE_OAUTH: '1' }),
    /EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID/);
  assert.throws(() => assertGoogleOAuthBuildConfiguration({ CONTEXT_REQUIRE_GOOGLE_OAUTH: '1',
    EAS_BUILD_PLATFORM: 'ios', EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB }), /EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID/);
});

test('local EAS discovery works before cloud variables arrive and the worker remains strict', () => {
  // EAS does not expose its built-in profile/platform during local app.config reads.
  assert.doesNotThrow(() => appConfig({ EXPO_PUBLIC_CONTEXT_DISTRIBUTION: 'store' }));
  assert.doesNotThrow(() => appConfig({ EXPO_PUBLIC_CONTEXT_DISTRIBUTION: 'store',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB }));
  assert.throws(() => appConfig({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'preview',
    EAS_BUILD_PLATFORM: 'android' }), /EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID/);
  assert.throws(() => appConfig({ EAS_BUILD_PROFILE: 'preview' }), /EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID/);
  assert.doesNotThrow(() => appConfig({ EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB }));
  assert.throws(() => appConfig({ EAS_BUILD_PROFILE: 'apple-app-store', EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB }),
    /EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID/);
});

test('CLI fails with an actionable variable name without logging the supplied identifier', () => {
  const supplied = 'mistaken-sensitive-value';
  const script = path.join(root, 'scripts/google-oauth-preflight.cjs');
  const env = { ...process.env, ...phone, EXPO_PUBLIC_CONTEXT_DISTRIBUTION: 'store', CONTEXT_WEAR_BUILD: '',
    CONTEXT_REQUIRE_GOOGLE_OAUTH: '', EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: supplied };
  const rejected = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID/);
  assert.ok(!rejected.stderr.includes(supplied));
  const accepted = spawnSync(process.execPath, [script], { env: { ...env, EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB }, encoding: 'utf8' });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /passed for android/);
  assert.ok(!accepted.stdout.includes(WEB));
});

test('phone preview and production profiles select their explicit EAS environments', () => {
  const profiles = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8')).build;
  assert.equal(profiles.preview.environment, 'preview');
  assert.equal(profiles['wear-phone-preview'].environment, 'preview');
  assert.equal(profiles.production.environment, 'production');
  for (const name of ['google-play', 'apple-app-store']) {
    assert.equal(profiles[name].environment ?? profiles[profiles[name].extends].environment, 'production');
  }
});
