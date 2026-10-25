const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlan, validateEasReleaseConfig, compareVersion, verifyIncreasingBuilds, summarizeBuild } = require('./release-tools.cjs');

const plan = { schemaVersion: 1, version: '0.1.0', sourceAndroidVersionCode: 1, sourceIosBuildNumber: '1',
  nativeVerification: { android: false, ios: false, fdroid: false }, notes: 'Source prerelease.' };
const app = { version: '0.1.0', android: { package: 'com.context.minuteledger', versionCode: 1 },
  ios: { bundleIdentifier: 'com.context.minuteledger', buildNumber: '1' } };
const pkg = { version: '0.1.0' };
const commit = 'a'.repeat(40);
const build = { id: '11111111-2222-3333-4444-555555555555', platform: 'ANDROID', status: 'FINISHED',
  gitCommitHash: commit, appVersion: '0.1.0', appBuildVersion: '1',
  artifacts: { buildUrl: 'https://private.example.invalid/token' }, secret: 'do-not-publish' };

test('release checks reject arbitrary tags and inconsistent source version identities', () => {
  assert.equal(validatePlan(plan, app, pkg, 'v0.1.0'), plan);
  for (const tag of ['main', 'v0.1.0; echo bad', 'v0.1.0-rc.1', 'v01.1.0']) {
    assert.throws(() => validatePlan(plan, app, pkg, tag));
  }
  assert.throws(() => validatePlan({ ...plan, sourceAndroidVersionCode: 2 }, app, pkg, 'v0.1.0'));
  assert.throws(() => validatePlan({ ...plan, sourceIosBuildNumber: '2' }, app, pkg, 'v0.1.0'));
  assert.throws(() => validatePlan(plan, app, { version: '0.2.0' }, 'v0.1.0'));
});

test('store staging refuses public tracks and mutable remote version counters', () => {
  const eas = { cli: { appVersionSource: 'local' }, build: {
    production: { autoIncrement: false, distribution: 'store', android: { buildType: 'app-bundle' }, ios: { simulator: false } },
    'google-play': { extends: 'production' }, 'apple-app-store': { extends: 'production' },
    'fdroid-preview': { distribution: 'internal', env: { EXPO_PUBLIC_CONTEXT_DISTRIBUTION: 'fdroid' } },
  }, submit: { 'google-play': { android: { track: 'internal', releaseStatus: 'draft' } } } };
  validateEasReleaseConfig(eas);
  assert.throws(() => validateEasReleaseConfig({ ...eas, cli: { appVersionSource: 'remote' } }));
  eas.submit['google-play'].android.track = 'production';
  assert.throws(() => validateEasReleaseConfig(eas));
});

test('release history compares numeric versions and requires increasing native build numbers', () => {
  assert.equal(compareVersion('v0.10.0', 'v0.2.0'), 1);
  assert.equal(compareVersion('v0.1.0', 'v0.1.0'), 0);
  assert.throws(() => verifyIncreasingBuilds(plan, app));
  verifyIncreasingBuilds({ ...plan, sourceAndroidVersionCode: 2, sourceIosBuildNumber: '2' }, app);
});

test('only exact finished EAS builds with matching source/native versions can be staged', () => {
  const summary = summarizeBuild([build], 'google-play', commit, plan);
  assert.equal(summary.buildId, build.id);
  for (const changed of [{ status: 'ERRORED' }, { platform: 'IOS' }, { gitCommitHash: 'b'.repeat(40) },
    { appVersion: '0.0.9' }, { appBuildVersion: '2' }, { id: 'latest' }]) {
    assert.throws(() => summarizeBuild([{ ...build, ...changed }], 'google-play', commit, plan));
  }
  assert.throws(() => summarizeBuild([build, build], 'google-play', commit, plan));
});

test('published build summaries omit artifact URLs, arbitrary server fields, and credentials', () => {
  const summary = summarizeBuild([build], 'google-play', commit, plan);
  assert.equal(Object.hasOwn(summary, 'artifacts'), false);
  assert.equal(Object.hasOwn(summary, 'secret'), false);
  assert.doesNotMatch(JSON.stringify(summary), /private\.example|do-not-publish/);
});
