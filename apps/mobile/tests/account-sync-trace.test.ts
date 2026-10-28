import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountSyncTrace } from '../src/sync/diagnostics';
import type { LedgerCryptoDiagnostics } from '../src/sync/codec';

const metrics = (): LedgerCryptoDiagnostics => ({
  kdfByBackend: { webcrypto: { calls: 0, elapsedMs: 0 }, native: { calls: 0, elapsedMs: 0 }, portableJs: { calls: 0, elapsedMs: 0 } },
  keyQueueMs: 0, cacheHits: 0, coalescedKeys: 0, encryptCalls: 0, encryptMs: 0, decryptCalls: 0, decryptMs: 0,
});

test('account trace captures the actual active wait and inclusive nested timings without changing results', async () => {
  let now = 100;
  const trace = createAccountSyncTrace(undefined, () => now, metrics);
  const result = await trace.measure('calendar-local', async () => {
    now = 200;
    assert.equal(trace.snapshot().active?.step, 'calendar-local');
    return trace.measure('calendar-event-read', async () => {
      now = 300;
      assert.deepEqual(trace.snapshot().active, { step: 'calendar-event-read', startedAt: 200 });
      return 42;
    });
  });
  trace.finish();
  assert.equal(result, 42);
  assert.deepEqual(trace.snapshot().steps, [
    { step: 'calendar-local', calls: 1, elapsedMs: 200 },
    { step: 'calendar-event-read', calls: 1, elapsedMs: 100 },
  ]);
  now = 9_999;
  assert.equal(trace.snapshot().finishedAt, 300);
  assert.equal(trace.snapshot().active, null);
});

test('failed operations retain their original error and elapsed time even if the timing observer throws', async () => {
  let now = 0;
  const failure = new Error('Transport failure');
  const trace = createAccountSyncTrace(() => { throw Error('Observer failure'); }, () => now, metrics);
  await assert.rejects(trace.measure('ledger-upload', () => { now = 150; throw failure; }), (error) => error === failure);
  assert.deepEqual(trace.snapshot().steps, [{ step: 'ledger-upload', calls: 1, elapsedMs: 150 }]);
  assert.equal(trace.snapshot().active, null);
});

test('crypto timings are detached differences for this trace and contain no input or account fields', async () => {
  const counters = metrics();
  counters.cacheHits = 7;
  const trace = createAccountSyncTrace(undefined, () => 1, () => structuredClone(counters));
  counters.cacheHits += 2;
  counters.kdfByBackend.native.calls++;
  counters.kdfByBackend.native.elapsedMs += 250;
  counters.encryptCalls++;
  counters.encryptMs += 5;
  const snapshot = trace.snapshot();
  assert.equal(snapshot.crypto.cacheHits, 2);
  assert.deepEqual(snapshot.crypto.kdfByBackend.native, { calls: 1, elapsedMs: 250 });
  snapshot.crypto.kdfByBackend.native.calls = 500;
  assert.equal(trace.snapshot().crypto.kdfByBackend.native.calls, 1);
  assert.equal(snapshot.crypto.encryptMs, 5);
  assert.deepEqual(Object.keys(snapshot).sort(), ['active', 'crypto', 'startedAt', 'steps']);
  assert.doesNotMatch(JSON.stringify(snapshot), /passphrase|ciphertext|accountId|eventId|salt|https?:/);
});

test('overlapping work can finish out of order without losing the remaining active frame', async () => {
  let now = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const trace = createAccountSyncTrace(undefined, () => now, metrics);
  const held = trace.measure('activity-rank', async () => { await gate; return 'first'; });
  now = 20;
  const later = trace.measure('ledger-prepare', async () => {
    release(); await held;
    assert.equal(trace.snapshot().active?.step, 'ledger-prepare');
    now = 40;
    return 'second';
  });
  assert.equal(await later, 'second');
  assert.equal(trace.snapshot().active, null);
  assert.equal(trace.snapshot().steps.length, 2);
});
