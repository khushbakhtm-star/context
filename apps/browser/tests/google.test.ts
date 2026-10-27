import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptBatch, decryptBatch } from '../shared/sync/codec';
import { GoogleConnection } from '../src/google';
import { emptyLedger, editCells, mergeLedger } from '../src/ledger';

const phrase = 'synthetic browser fixture passphrase';
const identity = { subject: 'synthetic_subject', email: 'fixture@example.invalid' };
const base = { key: 'minute:2026-10-27:779', revision: '0001793100000000:00000001:phone_fixture', value: {
  id: 'fixture_minute', dateKey: '2026-10-27', minuteIndex: 779, text: 'Synthetic coffee fixture', categoryId: 'coffee',
  blockId: 'existing_activity', source: 'manual', createdAt: '2026-10-27T12:59:00.000Z', updatedAt: '2026-10-27T12:59:00.000Z' } };
const batch = { version: 1 as const, id: 'phone_fixture', documents: [base] };
let ciphertext: string;
test.before(async () => { ciphertext = await encryptBatch(batch, phrase); });
function connection() {
  const client = new GoogleConnection('fixture.apps.googleusercontent.com');
  Object.assign(client as any, { identity, token: 'synthetic_memory_token', expires: Date.now() + 3600_000 }); return client;
}
function store() {
  return { subject: identity.subject, state: emptyLedger('browser_fixture'), update(change: any) { this.state = change(structuredClone(this.state)); return Promise.resolve(this.state); } };
}
function response(value: unknown, status = 200) { return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status }); }
test('phone encrypted batches download into the browser before any upload, keeping linked group metadata', async () => {
  const original = globalThis.fetch; const calls: string[] = []; const cache = store();
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url)); assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic_memory_token');
    if (String(url).includes('?alt=media')) return response(ciphertext);
    return response({ files: [{ id: 'remote_fixture', name: 'context-phone_fixture.json' }] });
  }) as typeof fetch;
  try { const result = await connection().sync(cache as any, phrase);
    assert.deepEqual(result, { downloaded: 1, uploaded: 0 }); assert.equal(cache.state.documents[0]!.value!.blockId, 'existing_activity');
    assert.deepEqual(cache.state.seen, ['remote_fixture']); assert.equal(calls.length, 2); }
  finally { globalThis.fetch = original; }
});
test('wrong passphrase and an empty remote ledger never upload or invent a new ledger', async () => {
  const original = globalThis.fetch; const methods: string[] = [];
  try {
    globalThis.fetch = (async (url: any, init?: RequestInit) => { methods.push(init?.method ?? 'GET'); return String(url).includes('?alt=media') ? response(ciphertext) : response({ files: [{ id: 'fixture', name: 'context-phone_fixture.json' }] }); }) as typeof fetch;
    await assert.rejects(connection().sync(store() as any, 'incorrect synthetic passphrase'), /Cannot unlock/);
    globalThis.fetch = (async (_url: any, init?: RequestInit) => { methods.push(init?.method ?? 'GET'); return response({ files: [] }); }) as typeof fetch;
    await assert.rejects(connection().sync(store() as any, phrase), /No phone ledger/);
    assert.ok(methods.every((method) => method === 'GET'));
  } finally { globalThis.fetch = original; }
});
test('upload uses the phone envelope and preallocated ID; lost-response retry preserves the immutable batch', async () => {
  const original = globalThis.fetch; const cache = store(); cache.state = mergeLedger(cache.state, [base]);
  cache.state = editCells(cache.state, [{ day: '2026-10-27', minute: 779, text: 'Synthetic browser edit' }], 1793200000000).state;
  let attempts = 0; let allocations = 0; let posted = '';
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const target = String(url);
    if (target.includes('generateIds')) { allocations++; return response({ ids: ['reserved_fixture_id'] }); }
    if (target.includes('/upload/')) { attempts++; posted = String(init?.body); if (attempts === 1) throw new Error('Synthetic lost HTTP response'); return response({}, 409); }
    if (target.includes('reserved_fixture_id')) return response(cache.state.upload!.ciphertext);
    if (target.includes('?alt=media')) return response(ciphertext);
    return response({ files: [{ id: 'remote_fixture', name: 'context-phone_fixture.json' }] });
  }) as typeof fetch;
  try {
    await assert.rejects(connection().sync(cache as any, phrase), /Synthetic lost/); const pending = structuredClone(cache.state.upload!);
    assert.equal(pending.driveId, 'reserved_fixture_id'); assert.ok(posted.includes('"id":"reserved_fixture_id"'));
    const decoded = await decryptBatch(pending.ciphertext, phrase); assert.equal(decoded.documents[0]!.value!.text, 'Synthetic browser edit');
    const result = await connection().sync(cache as any, phrase); assert.equal(result.uploaded, 1); assert.equal(allocations, 1); assert.equal(attempts, 2);
    assert.equal(cache.state.upload, null); assert.deepEqual(cache.state.pending, {});
  } finally { globalThis.fetch = original; }
});
test('subject mismatch, expired access, and an unapproved host fail before sending the bearer token', async () => {
  const original = globalThis.fetch; let requests = 0; globalThis.fetch = (async () => { requests++; throw new Error('Should not fetch'); }) as typeof fetch;
  try {
    const client = connection(); await assert.rejects(client.sync({ ...store(), subject: 'different_account' } as any, phrase), /account changed/);
    await assert.rejects((client as any).request('https://attacker.invalid/drive/v3/files'), /Unsupported Google request/);
    Object.assign(client as any, { expires: 0 }); await assert.rejects(client.listFiles(), /expired/); assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});
test('locking during a download prevents applying the decrypted batch', async () => {
  const original = globalThis.fetch; const cache = store(); const client = connection();
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes('?alt=media')) { client.lock(); return response(ciphertext); }
    return response({ files: [{ id: 'remote_fixture', name: 'context-phone_fixture.json' }] });
  }) as typeof fetch;
  try { await assert.rejects(client.sync(cache as any, phrase), /connection changed|account changed/); assert.deepEqual(cache.state.documents, []); }
  finally { globalThis.fetch = original; }
});
