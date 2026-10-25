import test from 'node:test';
import assert from 'node:assert/strict';
import { installedReleaseFromEmbeddedConfig } from '../src/services/installed-release';

const input = {
  platform: 'android', channel: 'standalone' as const,
  config: { version: '0.1.1', android: { package: 'com.context.minuteledger', versionCode: 2 },
    ios: { bundleIdentifier: 'com.context.minuteledger', buildNumber: '2' } },
  executionEnvironment: 'bare', development: false,
};

test('embedded release metadata identifies the source-controlled Android update version', () => {
  assert.deepEqual(installedReleaseFromEmbeddedConfig(input), {
    platform: 'android', channel: 'standalone', applicationId: 'com.context.minuteledger',
    version: '0.1.1', buildNumber: '2',
  });
});

test('Expo Go, development bundles, web, and foreign app identities do not offer Context updates', () => {
  assert.equal(installedReleaseFromEmbeddedConfig({ ...input, executionEnvironment: 'storeClient' }), null);
  assert.equal(installedReleaseFromEmbeddedConfig({ ...input, development: true }), null);
  assert.equal(installedReleaseFromEmbeddedConfig({ ...input, platform: 'web' }), null);
  assert.equal(installedReleaseFromEmbeddedConfig({ ...input, config: {
    ...input.config, android: { package: 'other.application', versionCode: 2 },
  } }), null);
});

test('invalid or missing embedded versions never announce an update for a guessed installation', () => {
  for (const version of ['', '0.1.1-beta', 'not-a-version']) {
    assert.equal(installedReleaseFromEmbeddedConfig({ ...input, config: { ...input.config, version } }), null);
  }
  for (const versionCode of [0, -1, 1.5, 2100000001]) {
    assert.equal(installedReleaseFromEmbeddedConfig({ ...input, config: {
      ...input.config, android: { package: 'com.context.minuteledger', versionCode },
    } }), null);
  }
  assert.equal(installedReleaseFromEmbeddedConfig({ ...input, config: null }), null);
});

test('iOS uses its installed Info.plist build number when supplied', () => {
  const release = installedReleaseFromEmbeddedConfig({ ...input, platform: 'ios',
    channel: 'apple-app-store', iosNativeBuildNumber: '3.2' });
  assert.equal(release?.buildNumber, '3.2');
  assert.equal(release?.channel, 'apple-app-store');
  assert.equal(installedReleaseFromEmbeddedConfig({ ...input, platform: 'ios',
    iosNativeBuildNumber: 'invalid' }), null);
});
