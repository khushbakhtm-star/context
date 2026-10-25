/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareReleaseNumbers, fetchReleaseManifest, httpsReleaseUrl, parseReleaseManifest,
  releaseNoticeKey, selectAvailableRelease, shouldCheckForUpdate, trustedReleaseLink,
  UPDATE_CHECK_INTERVAL_MS, type InstalledRelease, type ReleasedUpdate,
} from '../src/services/updates';

const installed: InstalledRelease = { platform: 'android', channel: 'google-play',
  applicationId: 'com.context.minuteledger', version: '0.1.0', buildNumber: '1' };
const next: ReleasedUpdate = { ...installed, version: '0.1.1', buildNumber: '2', released: true,
  publishedAt: '2026-01-01T00:00:00.000Z',
  url: 'https://play.google.com/store/apps/details?id=com.context.minuteledger' };
const manifest = (releases: unknown[]) => parseReleaseManifest({ schemaVersion: 1, releases }, Date.parse('2026-10-25T00:00:00.000Z'))!;

test('only an explicitly released, published update for the installed signing channel is offered', () => {
  const data = manifest([
    { ...next, released: false }, { ...next, publishedAt: '2027-01-01T00:00:00.000Z' },
    { ...next, channel: 'fdroid', url: 'https://f-droid.org/packages/com.context.minuteledger/' },
    { ...next, platform: 'ios', channel: 'apple-app-store', url: 'https://apps.apple.com/app/id123456789' },
    { ...next, applicationId: 'com.someone.else' }, next,
  ]);
  assert.equal(data.releases.length, 4);
  assert.deepEqual(selectAvailableRelease(data, installed), next);
  assert.equal(selectAvailableRelease(manifest([next]), { ...installed, channel: 'standalone' }), null);
  assert.equal(selectAvailableRelease(manifest([next]), { ...installed, applicationId: 'host.exp.exponent' }), null);
});

test('build ordering is numeric and rejects downgrades, equal builds, beta strings, and malformed manifests', () => {
  assert.equal(compareReleaseNumbers('10', '9'), 1);
  assert.equal(compareReleaseNumbers('1.10.0', '1.9.0', true), 1);
  assert.equal(compareReleaseNumbers('2.0', '2'), 0);
  assert.equal(compareReleaseNumbers('0.1.1-beta', '0.1.0', true), null);
  assert.equal(selectAvailableRelease(manifest([
    { ...next, version: '0.0.9', buildNumber: '100' },
    { ...next, buildNumber: '1' },
    { ...next, version: '0.1.0', buildNumber: '3' },
    { ...next, buildNumber: '10' },
  ]), installed)?.buildNumber, '10');
  assert.equal(selectAvailableRelease(manifest([{ ...next, version: '0.0.9', buildNumber: '100' }]), installed), null);
  assert.equal(parseReleaseManifest({ schemaVersion: 2, releases: [] }), null);
  assert.equal(parseReleaseManifest({ schemaVersion: 1, releases: new Array(101).fill(next) }), null);
  assert.equal(manifest([{ ...next, version: '0.2.0-beta' }, { ...next, buildNumber: 0 },
    { ...next, buildNumber: '1.2' }, { ...next, buildNumber: Number.MAX_SAFE_INTEGER },
    { ...next, publishedAt: '2026-02-31T00:00:00.000Z' }]).releases.length, 0);
});

test('each store link is tied to the real app identity, and standalone releases require an exact trusted URL', () => {
  assert.equal(trustedReleaseLink(next, {}), true);
  for (const url of ['http://play.google.com/store/apps/details?id=com.context.minuteledger',
    'https://play.google.com.evil.example/store/apps/details?id=com.context.minuteledger',
    'https://play.google.com/store/apps/details?id=com.other.app',
    'https://play.google.com/store/apps/details?id=com.context.minuteledger&redirect=evil',
    'https://user:password@play.google.com/store/apps/details?id=com.context.minuteledger',
    'https://play.google.com:8443/store/apps/details?id=com.context.minuteledger',
    'https://play.google.com/store/apps/details?id=com.context.minuteledger#fragment']) {
    assert.equal(trustedReleaseLink({ ...next, url }, {}), false, url);
  }
  const fdroid: ReleasedUpdate = { ...next, channel: 'fdroid', url: 'https://f-droid.org/packages/com.context.minuteledger/' };
  assert.equal(trustedReleaseLink(fdroid, {}), true);
  assert.equal(trustedReleaseLink({ ...fdroid, url: 'https://f-droid.org/packages/com.other.app/' }, {}), false);
  const apple: ReleasedUpdate = { ...next, platform: 'ios', channel: 'apple-app-store', url: 'https://apps.apple.com/us/app/context/id123456789' };
  assert.equal(trustedReleaseLink(apple, {}), false);
  assert.equal(trustedReleaseLink(apple, { appleAppStoreId: '123456789' }), true);
  assert.equal(trustedReleaseLink(apple, { appleAppStoreId: '987654321' }), false);
  const standalone: ReleasedUpdate = { ...next, channel: 'standalone', url: 'https://github.com/example/context/releases/latest' };
  assert.equal(trustedReleaseLink(standalone, {}), false);
  assert.equal(trustedReleaseLink(standalone, { standaloneReleaseUrl: standalone.url }), true);
  assert.equal(trustedReleaseLink({ ...standalone, url: standalone.url + '/untrusted' }, { standaloneReleaseUrl: standalone.url }), false);
});

test('iOS dotted build numbers are supported while incompatible platform/channel entries are ignored', () => {
  const apple: ReleasedUpdate = { ...next, platform: 'ios', channel: 'apple-app-store',
    buildNumber: '1.2.0', url: 'https://apps.apple.com/app/id123456789' };
  const current: InstalledRelease = { ...installed, platform: 'ios', channel: 'apple-app-store', buildNumber: '1.1.9' };
  assert.equal(selectAvailableRelease(manifest([apple]), current, { appleAppStoreId: '123456789' })?.buildNumber, '1.2.0');
  assert.equal(selectAvailableRelease(manifest([{ ...apple, buildNumber: '1' }]), current,
    { appleAppStoreId: '123456789' })?.version, '0.1.1');
  assert.equal(selectAvailableRelease(manifest([{ ...apple, version: '0.1.0', buildNumber: '1' }]), current,
    { appleAppStoreId: '123456789' }), null);
  assert.equal(manifest([{ ...next, platform: 'ios' }, { ...apple, platform: 'android' }]).releases.length, 0);
});

test('the manifest request sends no user payload or credentials and fails silently on network or response errors', async () => {
  const url = 'https://releases.example.org/context/latest.json';
  let requests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    requests += 1;
    assert.equal(input, url);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.body, undefined);
    assert.deepEqual(init?.headers, { Accept: 'application/json' });
    return new Response(JSON.stringify({ schemaVersion: 1, releases: [next] }), { status: 200 });
  };
  assert.equal((await fetchReleaseManifest(url, fetcher))?.releases[0]?.version, '0.1.1');
  assert.equal(requests, 1);
  assert.equal(await fetchReleaseManifest('http://releases.example.org/latest.json', fetcher), null);
  assert.equal(requests, 1);
  assert.equal(await fetchReleaseManifest(url, async () => { throw new Error('offline'); }), null);
  assert.equal(await fetchReleaseManifest(url, async () => new Response('{}', { status: 503 })), null);
  assert.equal(await fetchReleaseManifest(url, async () => new Response('not JSON')), null);
  assert.equal(await fetchReleaseManifest(url, async () => new Response('{}', { headers: { 'content-length': '9999999' } })), null);
  assert.equal(await fetchReleaseManifest(url, async () => new Response(' '.repeat(128 * 1024 + 1))), null);
  assert.equal(await fetchReleaseManifest(url, async () => new Response('€'.repeat(50 * 1024))), null);
  const redirected = new Response(JSON.stringify({ schemaVersion: 1, releases: [next] }));
  Object.defineProperty(redirected, 'url', { value: 'https://unrelated.example.org/latest.json' });
  assert.equal(await fetchReleaseManifest(url, async () => redirected), null);
});

test('automatic checks are throttled and dismissals are specific to version, build, and channel', () => {
  assert.equal(shouldCheckForUpdate(100, 101), false);
  assert.equal(shouldCheckForUpdate(100, 100 + UPDATE_CHECK_INTERVAL_MS), true);
  assert.equal(shouldCheckForUpdate(0, 100), true);
  assert.equal(shouldCheckForUpdate(1000, 100), true);
  assert.notEqual(releaseNoticeKey(next), releaseNoticeKey({ ...next, buildNumber: '3' }));
  assert.notEqual(releaseNoticeKey(next), releaseNoticeKey({ ...next, channel: 'fdroid' }));
  assert.equal(httpsReleaseUrl('https://localhost/latest.json'), null);
  assert.equal(httpsReleaseUrl('https://127.0.0.1/latest.json'), null);
});
