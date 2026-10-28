/// <reference types="node" />
import assert from 'node:assert/strict';
import { createCipheriv, pbkdf2, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { clearLedgerKeyCache, configureNativeLedgerKeyDeriver, decryptBatch, encryptBatch } from '../src/sync/codec';
import type { NativeLedgerKeyDeriver } from '../src/sync/codec';
import type { SyncBatch } from '../src/sync/types';

const deriveReference = async (phrase: string, saltHex: string) =>
  (await promisify(pbkdf2)(phrase, Buffer.from(saltHex, 'hex'), 600_000, 32, 'sha256')).toString('hex');
const batch: SyncBatch = { version: 1, id: 'native_interop', documents: [{ key: 'minute:2026-10-25:371',
  revision: '0000000000000100:00000000:device00', value: { text: 'A note · مرحبا 📚', dateKey: '2026-10-25', minuteIndex: 371 } }] };
const phrase = 'Context private ledger unlock phrase';
const salt = new Uint8Array(16).fill(41);
const nonce = new Uint8Array(12).fill(72);
const fixedRandom = (length: number) => length === 16 ? salt : nonce;
async function referenceEnvelope(password: string) {
  const header = { version: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: 600_000,
    salt: Buffer.from(salt).toString('hex'), nonce: Buffer.from(nonce).toString('hex') };
  const key = Buffer.from(await deriveReference(password, header.salt), 'hex');
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(header).sort().map((name) =>
      [name, header[name as keyof typeof header]])))));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(batch), 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return JSON.stringify({ ...header, ciphertext: encrypted.toString('hex') });
  } finally { key.fill(0); }
}
async function withCrypto<T>(crypto: unknown, run: () => Promise<T>) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
  try { return await run(); }
  finally {
    configureNativeLedgerKeyDeriver(null); clearLedgerKeyCache();
    if (before) Object.defineProperty(globalThis, 'crypto', before);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
}

// Node/OpenSSL independently supplies real 600,000-round keys. Production
// encryption, UTF-8 encoding and cache behavior remain in the exercised path.
test('injected Android-compatible keys preserve the exact envelope for ASCII, Unicode and NUL passphrases', async () => withCrypto(undefined, async () => {
  let calls = 0;
  configureNativeLedgerKeyDeriver(async (password, hex) => { calls++; return deriveReference(password, hex); });
  for (const password of [phrase, 'Ledger مرحبا 📚 e\u0301 phrase', 'Ledger\u0000private\u0000phrase']) {
    clearLedgerKeyCache();
    const expected = await referenceEnvelope(password);
    assert.equal(await encryptBatch(batch, password, fixedRandom), expected);
    clearLedgerKeyCache();
    assert.deepEqual(await decryptBatch(expected, password), batch);
  }
  assert.equal(calls, 6);
}));

test('WebCrypto remains preferred to an installed mobile provider', async () => withCrypto(webcrypto, async () => {
  let calls = 0;
  configureNativeLedgerKeyDeriver(async () => { calls++; throw new Error('Native path must not be used'); });
  assert.equal(await encryptBatch(batch, phrase, fixedRandom), await referenceEnvelope(phrase));
  assert.equal(calls, 0);
}));

test('unsupported native availability and malformed UTF-16 keep the portable UTF-8 fallback', async () => withCrypto(undefined, async () => {
  let calls = 0;
  configureNativeLedgerKeyDeriver(async () => { calls++; return null; });
  assert.equal(await encryptBatch(batch, phrase, fixedRandom), await referenceEnvelope(phrase));
  for (const password of ['Malformed \uD800 ledger phrase', 'Malformed \uDC00 ledger phrase']) {
    clearLedgerKeyCache();
    assert.equal(await encryptBatch(batch, password, fixedRandom), await referenceEnvelope(password));
  }
  assert.equal(calls, 1, 'unpaired surrogates must never reach a platform-dependent password encoder');
}));

test('malformed native results and provider failures fail closed instead of silently changing derivation', async () => withCrypto(undefined, async () => {
  for (const invalid of ['', '00'.repeat(31), 'GG'.repeat(32), 'AA'.repeat(32), 42]) {
    configureNativeLedgerKeyDeriver(async () => invalid as string);
    await assert.rejects(encryptBatch(batch, phrase, fixedRandom), /key derivation failed/);
  }
  configureNativeLedgerKeyDeriver(async () => { throw new Error('Native derivation self-test failed'); });
  await assert.rejects(encryptBatch(batch, phrase, fixedRandom), /self-test failed/);
}));

test('native requests retain one queue, same-salt coalescing and independent cached key copies', async () => withCrypto(undefined, async () => {
  let release!: () => void; let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0; let active = 0; let maximum = 0;
  configureNativeLedgerKeyDeriver(async (password, hex) => {
    calls++; active++; maximum = Math.max(maximum, active); started();
    try { await gate; return await deriveReference(password, hex); } finally { active--; }
  });
  const first = encryptBatch(batch, phrase, fixedRandom);
  const second = encryptBatch(batch, phrase, fixedRandom);
  const anotherSalt = encryptBatch(batch, phrase, (length) => new Uint8Array(length).fill(84));
  await reached; assert.equal(calls, 1); release();
  const results = await Promise.all([first, second, anotherSalt]);
  assert.equal(results[0], results[1]); assert.notEqual(results[0], results[2]); assert.equal(maximum, 1); assert.equal(calls, 2);
  assert.deepEqual(await decryptBatch(results[0]!, phrase), batch);
  assert.deepEqual(await decryptBatch(results[1]!, phrase), batch);
  assert.equal(calls, 2, 'wiping one caller key must not poison the cached key used by another caller');
}));

test('locking while Android derives discards its late key, rejects queued work and requires a fresh unlock', async () => withCrypto(undefined, async () => {
  let release!: () => void; let started!: () => void; let gated = true; let calls = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { started = resolve; });
  configureNativeLedgerKeyDeriver(async (password, hex) => { calls++; started(); if (gated) await gate; return deriveReference(password, hex); });
  const results = Promise.allSettled([encryptBatch(batch, phrase, fixedRandom),
    encryptBatch(batch, phrase, (length) => new Uint8Array(length).fill(85))]);
  await reached; clearLedgerKeyCache(); gated = false; release();
  for (const result of await results) {
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.match(String(result.reason), /ledger was locked/);
  }
  assert.equal(calls, 1, 'the old queued salt must not start after locking');
  assert.equal(await encryptBatch(batch, phrase, fixedRandom), await referenceEnvelope(phrase));
  assert.equal(calls, 2);
}));

test('a lock between injected derivation resolution and cache insertion cannot resurrect an old-generation key', async () => withCrypto(undefined, async () => {
  let calls = 0;
  configureNativeLedgerKeyDeriver(async () => {
    calls++;
    if (calls === 1) queueMicrotask(() => queueMicrotask(clearLedgerKeyCache));
    return '1d'.repeat(32);
  });
  await assert.rejects(encryptBatch(batch, phrase, fixedRandom), /ledger was locked/);
  await encryptBatch(batch, phrase, fixedRandom);
  assert.equal(calls, 2);
}));

test('replacing the injected implementation invalidates active work before it can populate the new cache', async () => withCrypto(undefined, async () => {
  let release!: () => void; let started!: () => void; let replacementCalls = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { started = resolve; });
  configureNativeLedgerKeyDeriver(async () => { started(); await gate; return '2e'.repeat(32); });
  const old = encryptBatch(batch, phrase, fixedRandom);
  const observed = assert.rejects(old, /ledger was locked/);
  await reached;
  configureNativeLedgerKeyDeriver(async (password, hex) => { replacementCalls++; return deriveReference(password, hex); });
  release(); await observed;
  assert.equal(await encryptBatch(batch, phrase, fixedRandom), await referenceEnvelope(phrase));
  assert.equal(replacementCalls, 1);
}));

test('mobile bootstrap installs the optional bridge before mounting App and the portable codec has no native import', () => {
  const filename = path.join(import.meta.dirname, '../index.ts');
  const source = readFileSync(filename, 'utf8'); const events: string[] = [];
  const deriver: NativeLedgerKeyDeriver = async () => null; let configured: NativeLedgerKeyDeriver | null = null;
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(javascript, { exports: {}, require(name: string) {
    if (name === 'expo') return { registerRootComponent() { assert.equal(configured, deriver); events.push('mount'); } };
    if (name === './App') return { default: {} };
    if (name === './modules/context-ledger-crypto') return { deriveLedgerKeyAsync: deriver };
    if (name === './src/sync/codec') return { configureNativeLedgerKeyDeriver(value: NativeLedgerKeyDeriver) { configured = value; events.push('install'); } };
    throw new Error('Unexpected bootstrap dependency ' + name);
  } }, { filename });
  assert.deepEqual(events, ['install', 'mount']);
  const codec = readFileSync(path.join(import.meta.dirname, '../src/sync/codec.ts'), 'utf8');
  assert.equal(/(?:from|import\s*\()\s*['"][^'"]*(?:modules\/|expo-modules-core|react-native)/.test(codec), false);
});
