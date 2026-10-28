/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearLedgerKeyCache, configureNativeLedgerKeyDeriver, decryptBatch, encryptBatch, getLedgerCryptoDiagnostics,
} from '../src/sync/codec';
import type { LedgerCryptoDiagnostics } from '../src/sync/codec';
import type { SyncBatch } from '../src/sync/types';

const phrase = 'Synthetic private diagnostic passphrase';
const batch: SyncBatch = { version: 1, id: 'diagnostic_fixture', documents: [{
  key: 'minute:2026-10-25:371', revision: '0000000000000100:00000000:device00',
  value: { text: 'Private synthetic text must never enter counters', dateKey: '2026-10-25', minuteIndex: 371 },
}] };
const key = '17'.repeat(32);
const fixed = (length: number) => new Uint8Array(length).fill(31);

async function runtime(run: (clock: { now: number }) => Promise<void>, crypto?: unknown) {
  const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const previousPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  const clock = { now: 0 };
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock.now } });
  clearLedgerKeyCache();
  try { await run(clock); }
  finally {
    configureNativeLedgerKeyDeriver(null); clearLedgerKeyCache();
    if (previousCrypto) Object.defineProperty(globalThis, 'crypto', previousCrypto);
    else Reflect.deleteProperty(globalThis, 'crypto');
    if (previousPerformance) Object.defineProperty(globalThis, 'performance', previousPerformance);
    else Reflect.deleteProperty(globalThis, 'performance');
  }
}

function backendDelta(before: LedgerCryptoDiagnostics, after: LedgerCryptoDiagnostics, backend: 'native' | 'webcrypto' | 'portableJs') {
  return { calls: after.kdfByBackend[backend].calls - before.kdfByBackend[backend].calls,
    elapsedMs: after.kdfByBackend[backend].elapsedMs - before.kdfByBackend[backend].elapsedMs };
}

test('crypto diagnostics report actual native work, cache hits and operation counts without retaining any payload or key material', async () => runtime(async (clock) => {
  configureNativeLedgerKeyDeriver(async () => { clock.now += 25; return key; });
  const before = getLedgerCryptoDiagnostics();
  const encoded = await encryptBatch(batch, phrase, fixed);
  assert.deepEqual(await decryptBatch(encoded, phrase), batch);
  const after = getLedgerCryptoDiagnostics();
  assert.deepEqual(backendDelta(before, after, 'native'), { calls: 1, elapsedMs: 25 });
  assert.deepEqual(backendDelta(before, after, 'webcrypto'), { calls: 0, elapsedMs: 0 });
  assert.deepEqual(backendDelta(before, after, 'portableJs'), { calls: 0, elapsedMs: 0 });
  assert.equal(after.cacheHits - before.cacheHits, 1);
  assert.equal(after.encryptCalls - before.encryptCalls, 1); assert.equal(after.decryptCalls - before.decryptCalls, 1);
  assert.ok(after.encryptMs >= before.encryptMs && after.decryptMs >= before.decryptMs);
  assert.deepEqual(Object.keys(after).sort(), ['cacheHits', 'coalescedKeys', 'decryptCalls', 'decryptMs',
    'encryptCalls', 'encryptMs', 'kdfByBackend', 'keyQueueMs'].sort());
  const serialized = JSON.stringify(after);
  for (const sensitive of [phrase, key, Buffer.from(fixed(16)).toString('hex'), batch.id, batch.documents[0]!.key,
    'Private synthetic text', 'salt', 'passphrase', 'ciphertext']) assert.equal(serialized.includes(sensitive), false);
  for (const value of Object.values(after)) if (typeof value === 'number') assert.ok(Number.isFinite(value) && value >= 0);
  after.kdfByBackend.native.calls = -1; after.cacheHits = -1;
  const detached = getLedgerCryptoDiagnostics(); assert.ok(detached.kdfByBackend.native.calls >= 1 && detached.cacheHits >= 1);
}));

test('diagnostics identify the preferred WebCrypto implementation instead of a merely installed native hook', async () => {
  let clockRef: { now: number };
  await runtime(async (clock) => {
    clockRef = clock;
    configureNativeLedgerKeyDeriver(async () => { throw Error('Unused installed bridge'); });
    const before = getLedgerCryptoDiagnostics(); await encryptBatch(batch, phrase, fixed);
    const after = getLedgerCryptoDiagnostics();
    assert.deepEqual(backendDelta(before, after, 'webcrypto'), { calls: 1, elapsedMs: 10 });
    assert.deepEqual(backendDelta(before, after, 'native'), { calls: 0, elapsedMs: 0 });
  }, { subtle: {
    importKey: async () => { clockRef.now += 3; return {}; },
    deriveBits: async () => { clockRef.now += 7; return new Uint8Array(32).fill(17).buffer; },
  } });
});

test('a null native capability is reported as portable work rather than a successful native derivation', async () => runtime(async () => {
  configureNativeLedgerKeyDeriver(async () => null);
  const before = getLedgerCryptoDiagnostics();
  const encoded = await encryptBatch(batch, phrase, fixed);
  assert.deepEqual(await decryptBatch(encoded, phrase), batch);
  const after = getLedgerCryptoDiagnostics();
  assert.deepEqual(backendDelta(before, after, 'portableJs'), { calls: 1, elapsedMs: 0 });
  assert.deepEqual(backendDelta(before, after, 'native'), { calls: 0, elapsedMs: 0 });
}));

test('diagnostics distinguish queued time and coalesced callers from actual KDF work', async () => runtime(async (clock) => {
  let release!: () => void, started!: () => void, calls = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { started = resolve; });
  configureNativeLedgerKeyDeriver(async () => {
    calls++;
    if (calls === 1) { started(); await gate; clock.now += 30; }
    else clock.now += 5;
    return key;
  });
  const before = getLedgerCryptoDiagnostics();
  const first = encryptBatch(batch, phrase, fixed);
  const shared = encryptBatch(batch, phrase, fixed);
  const queued = encryptBatch(batch, phrase, (length) => new Uint8Array(length).fill(32));
  await reached; assert.equal(calls, 1); release();
  await Promise.all([first, shared, queued]);
  const after = getLedgerCryptoDiagnostics();
  assert.deepEqual(backendDelta(before, after, 'native'), { calls: 2, elapsedMs: 35 });
  assert.equal(after.coalescedKeys - before.coalescedKeys, 1);
  assert.equal(after.keyQueueMs - before.keyQueueMs, 30);
  assert.equal(after.encryptCalls - before.encryptCalls, 3);
}));

test('AES and JSON timing covers its synchronous sections separately from key derivation and queue wait', async () => runtime(async (clock) => {
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => ++clock.now } });
  configureNativeLedgerKeyDeriver(async () => key);
  const before = getLedgerCryptoDiagnostics();
  const encoded = await encryptBatch(batch, phrase, fixed);
  assert.deepEqual(await decryptBatch(encoded, phrase), batch);
  const after = getLedgerCryptoDiagnostics();
  assert.equal(after.encryptMs - before.encryptMs, 2, 'input validation and AES/envelope serialization are measured');
  assert.equal(after.decryptMs - before.decryptMs, 2, 'envelope parsing and AES/plaintext validation are measured');
  assert.deepEqual(backendDelta(before, after, 'native'), { calls: 1, elapsedMs: 1 });
  assert.equal(after.keyQueueMs - before.keyQueueMs, 1);
}));

test('failed or lock-discarded native work remains visible in numeric diagnostics without poisoning a later unlock', async () => runtime(async (clock) => {
  let fail = true;
  configureNativeLedgerKeyDeriver(async () => { clock.now += fail ? 17 : 3; if (fail) throw Error('Synthetic native failure'); return key; });
  const before = getLedgerCryptoDiagnostics();
  await assert.rejects(encryptBatch(batch, phrase, fixed), /Synthetic native failure/);
  fail = false;
  const encoded = await encryptBatch(batch, phrase, fixed); assert.deepEqual(await decryptBatch(encoded, phrase), batch);
  let after = getLedgerCryptoDiagnostics(); assert.deepEqual(backendDelta(before, after, 'native'), { calls: 2, elapsedMs: 20 });
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { started = resolve; });
  configureNativeLedgerKeyDeriver(async () => { started(); await gate; clock.now += 11; return key; });
  const stale = encryptBatch(batch, phrase, fixed);
  const rejection = assert.rejects(stale, /ledger was locked/);
  await reached; clearLedgerKeyCache(); release(); await rejection;
  after = getLedgerCryptoDiagnostics(); assert.deepEqual(backendDelta(before, after, 'native'), { calls: 3, elapsedMs: 31 });
  assert.equal(after.encryptCalls - before.encryptCalls, 3);
  assert.ok(after.cacheHits >= before.cacheHits, 'locking clears secret keys, not aggregate timing counters');
}));
