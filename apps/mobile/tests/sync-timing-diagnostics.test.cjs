const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeSyncDiagnostics, nativeSyncDiagnosticsText } = require('../src/utils/native-sync-diagnostics.ts');
const { createManualSyncTiming, advanceManualSyncTiming, finishManualSyncTiming,
  manualSyncDiagnosticsText } = require('../src/utils/manual-sync-diagnostics.ts');
const { accountSyncDiagnosticsText } = require('../src/utils/account-sync-diagnostics-text.ts');

test('native timing observes only resolved acknowledgements and preserves the exact result and failure', async () => {
  let now = 10; const diagnostic = createNativeSyncDiagnostics(() => now);
  const result = { color: '#123456', changed: true };
  assert.equal(await diagnostic.observe('color', async () => { now += 1500; return result; }), result);
  const failure = new Error('Synthetic transport failure');
  await assert.rejects(diagnostic.observe('content', async () => { now += 3000; throw failure; }), (error) => error === failure);
  assert.deepEqual(diagnostic.snapshot(), { content: { acknowledged: 0, totalMs: 0, lastMs: 0 },
    color: { acknowledged: 1, totalMs: 1500, lastMs: 1500 } });
});

test('overlapping native calls count their own SDK wait and snapshots cannot change counters', async () => {
  let now = 0, release; const diagnostic = createNativeSyncDiagnostics(() => now);
  const pending = diagnostic.observe('content', () => new Promise((done) => { release = done; }));
  now = 20; await diagnostic.observe('content', async () => { now = 30; return 'acknowledged'; });
  now = 60; release('first result'); assert.equal(await pending, 'first result');
  const snapshot = diagnostic.snapshot(); assert.equal(snapshot.content.acknowledged, 2);
  assert.equal(snapshot.content.totalMs, 70); snapshot.content.acknowledged = 100;
  assert.equal(diagnostic.snapshot().content.acknowledged, 2);
  const text = nativeSyncDiagnosticsText(diagnostic.snapshot());
  assert.match(text, /since app start/); assert.match(text, /not confirmation of upload to Google/);
  assert.equal(/eventId|calendarId|title|notes|account|passphrase|salt/i.test(JSON.stringify(snapshot)), false);
});

test('manual stages include current waits and remain live beyond the caller deadline until work settles', () => {
  const timing = createManualSyncTiming(0);
  advanceManualSyncTiming(timing, 'accounts', 50);
  let text = manualSyncDiagnosticsText(timing, 35_000);
  assert.match(text, /35.0 s \(still waiting\)/); assert.match(text, /Account API cycle wait: 35.0 s \(current wait\)/);
  text = manualSyncDiagnosticsText(timing, 111_000);
  assert.match(text, /111.0 s \(still waiting\)/);
  finishManualSyncTiming(timing, 111_000);
  text = manualSyncDiagnosticsText(timing, 150_000);
  assert.match(text, /Manual Sync elapsed: 111.0 s/); assert.equal(text.includes('still waiting'), false);
});

test('completed manual stages retain exact durations and cannot be extended by stale callbacks', () => {
  const timing = createManualSyncTiming(1000);
  advanceManualSyncTiming(timing, 'accounts', 1500);
  advanceManualSyncTiming(timing, 'phone-calendars', 2500);
  advanceManualSyncTiming(timing, 'linked-changes', 3000);
  advanceManualSyncTiming(timing, 'phone-updates', 5000);
  advanceManualSyncTiming(timing, 'complete', 5500);
  const before = JSON.stringify(timing);
  finishManualSyncTiming(timing, 20_000); advanceManualSyncTiming(timing, 'accounts', 25_000);
  assert.equal(JSON.stringify(timing), before);
  const text = manualSyncDiagnosticsText(timing, 50_000);
  assert.match(text, /elapsed: 4.5 s/); assert.match(text, /Local save: 0.5 s/);
  assert.match(text, /Account API cycle wait: 1.0 s/); assert.match(text, /Linked-source preflight: 2.0 s/);
  assert.match(text, /Local phone-provider update queue: 0.5 s/);
});

test('account details whitelist step/backend labels and freeze a completed cycle while showing actual crypto timings', () => {
  const timing = { startedAt: 1000, finishedAt: 11_000, active: null,
    steps: [{ step: 'calendar-event-read', calls: 86, elapsedMs: 9000 },
      { step: 'Private event title and account@example.test', calls: 1, elapsedMs: 1 }],
    crypto: { kdfByBackend: { native: { calls: 1, elapsedMs: 200 }, webcrypto: { calls: 0, elapsedMs: 0 },
      portableJs: { calls: 0, elapsedMs: 0 } }, keyQueueMs: 30, cacheHits: 2, coalescedKeys: 1,
      encryptCalls: 1, encryptMs: 20, decryptCalls: 2, decryptMs: 50 } };
  const text = accountSyncDiagnosticsText(timing, 50_000);
  assert.match(text, /elapsed: 10.0 s/); assert.match(text, /API event read: 86 calls, 9.0 s/);
  assert.match(text, /Android native\): 1 calls, 0.2 s/); assert.match(text, /cache hits: 2/);
  assert.equal(/Private event|example.test|Portable JavaScript|running/.test(text), false);
  timing.finishedAt = undefined; timing.active = { step: 'calendar-event-read', startedAt: 40_000 };
  assert.match(accountSyncDiagnosticsText(timing, 50_000), /Current: Calendar API event read, 10.0 s waiting/);
  assert.equal(accountSyncDiagnosticsText(undefined, 0), '');
});
