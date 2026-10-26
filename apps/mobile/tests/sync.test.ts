/// <reference types="node" />

import assert from 'node:assert/strict';
import { randomBytes, webcrypto } from 'node:crypto';
import test from 'node:test';

import {
  compareRevisions,
  decryptBatch,
  encryptBatch,
  hashValue,
  mergeDocuments,
  parseProjectedMinutes,
  validateBatch,
} from '../src/sync/codec';
import type { SyncBatch, SyncDocument } from '../src/sync/types';

const revision = (time: number, device = 'device00', counter = 0) =>
  `${String(time).padStart(16, '0')}:${String(counter).padStart(8, '0')}:${device}`;
const makeDocument = (time: number, text: string | null, device = 'device00'): SyncDocument => ({
  key: 'minute:2026-10-25:371',
  revision: revision(time, device),
  value: text === null ? null : { dateKey: '2026-10-25', minuteIndex: 371, text },
});
const batch: SyncBatch = {
  version: 1,
  id: 'batch001',
  documents: [makeDocument(100, 'Mum asks me to print. \u0645\u0631\u062d\u0628\u0627 \ud83d\udcda')],
};
const passphrase = 'Context private ledger unlock phrase';
const secureRandom = (length: number) => new Uint8Array(randomBytes(length));

test('encrypted ledger round trip preserves UTF-8, hides text, and authenticates ciphertext', async () => {
  const encoded = await encryptBatch(batch, passphrase, secureRandom);
  assert.ok(!encoded.includes('Mum'));
  assert.deepEqual(await decryptBatch(encoded, passphrase), batch);

  const envelope = JSON.parse(encoded) as { ciphertext: string; nonce: string };
  const bytes = Buffer.from(envelope.ciphertext, 'hex');
  bytes[0] = bytes[0]! ^ 1;
  envelope.ciphertext = bytes.toString('hex');
  await assert.rejects(decryptBatch(JSON.stringify(envelope), passphrase), /Cannot unlock/);
  await assert.rejects(decryptBatch(encoded, 'Wrong but long enough passphrase'), /Cannot unlock/);
});

test('independent random salts and nonces produce different encrypted files for the same content', async () => {
  const first = await encryptBatch(batch, passphrase, secureRandom);
  const second = await encryptBatch(batch, passphrase, secureRandom);
  assert.notEqual(first, second);
  const firstEnvelope = JSON.parse(first) as Record<string, unknown>;
  const secondEnvelope = JSON.parse(second) as Record<string, unknown>;
  assert.notEqual(firstEnvelope.salt, secondEnvelope.salt);
  assert.notEqual(firstEnvelope.nonce, secondEnvelope.nonce);
});

test('wire envelope interoperates with WebCrypto AES-GCM and PBKDF2', async () => {
  const encoded = await encryptBatch(batch, passphrase, secureRandom);
  const envelope = JSON.parse(encoded) as {
    salt: string; nonce: string; ciphertext: string; iterations: number;
  };
  const { ciphertext, ...header } = envelope;
  const aad = JSON.stringify(
    Object.fromEntries(Object.keys(header).sort().map((key) => [key, header[key as keyof typeof header]])),
  );
  const secret = await webcrypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  const key = await webcrypto.subtle.deriveKey(
    {
      name: 'PBKDF2', hash: 'SHA-256', iterations: envelope.iterations,
      salt: Buffer.from(envelope.salt, 'hex'),
    },
    secret, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plaintext = await webcrypto.subtle.decrypt(
    {
      name: 'AES-GCM', iv: Buffer.from(envelope.nonce, 'hex'),
      additionalData: new TextEncoder().encode(aad), tagLength: 128,
    },
    key, Buffer.from(ciphertext, 'hex'),
  );
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plaintext)), batch);
});

test('cloud merge converges regardless of phone upload order and deletion cannot resurrect', () => {
  const old = makeDocument(100, 'Original');
  const phoneA = makeDocument(200, 'Phone A', 'phoneAAA');
  const phoneB = makeDocument(200, 'Phone B', 'phoneBBB');
  const deleted = makeDocument(300, null);
  assert.deepEqual(mergeDocuments([old, phoneA], [phoneB]), mergeDocuments([phoneB], [phoneA, old]));
  assert.deepEqual(mergeDocuments([deleted], [old, phoneA, phoneB]), [deleted]);
  assert.deepEqual(mergeDocuments([old], [deleted], [old]), [deleted]);
  assert.equal(compareRevisions(phoneA.revision, phoneB.revision), -1);
});

test('duplicate revisions with contradictory payloads are rejected rather than diverging', () => {
  assert.throws(
    () => mergeDocuments([makeDocument(100, 'A')], [makeDocument(100, 'B')]),
    /same revision/,
  );
});

test('validation rejects malformed identifiers, revisions, duplicate records and unsafe object fields', () => {
  assert.deepEqual(validateBatch(batch), batch);
  assert.throws(() => validateBatch({ ...batch, version: 2 }), /not supported/);
  assert.throws(() => validateBatch({ ...batch, documents: [batch.documents[0], batch.documents[0]] }), /duplicate/);
  assert.throws(
    () => validateBatch({ ...batch, documents: [{ ...batch.documents[0], key: 'minute:2026-02-30:0' }] }),
    /invalid record identifier/,
  );
  assert.throws(
    () => validateBatch({ ...batch, documents: [{ ...batch.documents[0], key: 'minute:2026-10-25:1440' }] }),
    /invalid record identifier/,
  );
  assert.throws(
    () => validateBatch({ ...batch, documents: [{ ...batch.documents[0], revision: 'yesterday' }] }),
    /Invalid ledger revision/,
  );
  const polluted = JSON.parse('{"__proto__":{"isAdmin":true}}') as unknown;
  assert.throws(
    () => validateBatch({ ...batch, documents: [{ ...batch.documents[0], value: polluted }] }),
    /Invalid ledger field/,
  );
  assert.throws(() => validateBatch({ ...batch, extra: true }), /unsupported data field/);
});

test('KDF work is bounded before decryption, and short passphrases are refused', async () => {
  await assert.rejects(encryptBatch(batch, 'short', secureRandom), /12 to 1,024/);
  await assert.rejects(
    decryptBatch(JSON.stringify({
      version: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: 99_999_999,
      salt: '00'.repeat(16), nonce: '00'.repeat(12), ciphertext: '00'.repeat(16),
    }), passphrase),
    /format is not supported/,
  );
});

test('canonical projection hashes ignore property insertion order', () => {
  assert.equal(hashValue({ title: 'Sleep', start: 1 }), hashValue({ start: 1, title: 'Sleep' }));
  assert.notEqual(hashValue({ title: 'Sleep' }), hashValue({ title: 'Prayer' }));
});

test('calendar timestamp parser handles AM/PM, 24-hour labels and multiline text', () => {
  assert.deepEqual(parseProjectedMinutes([
    'Family & people', '', '6:51 PM  Mum asks for printing', 'A second line',
    '18:52  Send print command', '12:00 AM  Sleep', 'Context block: block_1',
    'Context projection: projection_1', 'Full minute record available in Context.',
  ].join('\n')), [
    { minuteIndex: 1131, text: 'Mum asks for printing\nA second line' },
    { minuteIndex: 1132, text: 'Send print command' },
    { minuteIndex: 0, text: 'Sleep' },
  ]);
  assert.throws(
    () => parseProjectedMinutes('6:51 PM  First\n18:51  Second'),
    /duplicate minute timestamps/,
  );
});

test('clean minute logs retain literal Context-like continuation text and validate synchronized ownership metadata', () => {
  assert.deepEqual(parseProjectedMinutes('12:39 PM Make coffee\nContext block: a note I typed\nFull minute record available in Context.',
    { legacyMetadata: false }), [{ minuteIndex: 759, text: 'Make coffee\nContext block: a note I typed\nFull minute record available in Context.' }]);
  const value = { version: 1, offset: 0, prefixHash: 'a'.repeat(64), logHash: 'b'.repeat(64) };
  const projection: SyncBatch = { version: 1, id: 'projectionmeta', documents: [{ key: 'projection:one', revision: revision(100),
    value: { baseEvent: { descriptionLog: value } } }] };
  assert.deepEqual(validateBatch(projection), projection);
  for (const invalid of [{ ...value, offset: -1 }, { ...value, prefixHash: 'not-a-hash' }, { ...value, version: 3 }]) {
    assert.throws(() => validateBatch({ ...projection, documents: [{ ...projection.documents[0],
      value: { baseEvent: { descriptionLog: invalid } } }] }), /description metadata/);
  }
});
