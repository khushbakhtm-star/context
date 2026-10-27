import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { decryptBatch, encryptBatch, hashValue, validateBatch } from '../shared/sync/codec';
import type { SyncDocument } from '../shared/sync/types';
import { editCells, emptyLedger, getMinute, mergeLedger, pastedChanges, undoEdit, validateState } from '../src/ledger';

const day = '2026-10-25';
const passphrase = 'Context browser compatibility passphrase';
const revision = (wall: number, counter = 0, actor = 'phone_actor') =>
  `${String(wall).padStart(16, '0')}:${String(counter).padStart(8, '0')}:${actor}`;
const minute = (text = 'Phone note', wall = 1000): SyncDocument => ({ key: `minute:${day}:600`, revision: revision(wall), value: {
  id: 'phone-minute', dateKey: day, minuteIndex: 600, text, categoryId: 'basil-source', blockId: 'activity_prayer', source: 'inherited-plan',
  createdAt: '2026-10-25T10:00:00.000Z', updatedAt: '2026-10-25T10:01:00.000Z',
} });
const metadata = (): SyncDocument[] => [
  { key: 'category:basil-source', revision: revision(1000, 1), value: { id: 'basil-source', name: 'Prayer', color: '#0B8043', provider: 'google', providerColorId: '10' } },
  { key: `category:minuteFormat:${day}:600`, revision: revision(1000, 2), value: { kind: 'minuteFormat',
    format: { bold: true, underline: true, textColor: '#FFFFFF', activityGroup: { id: 'activity_prayer', title: 'Prayer' } } } },
  { key: 'projection:approved_owner', revision: revision(1000, 3), value: { id: 'approved_owner', blockId: 'activity_prayer',
    accountId: 'google:person', calendarId: 'personal', sourceEventId: 'original_prayer', eventId: 'original_prayer',
    dateKey: day, startMinute: 600, endMinute: 601, state: 'synced', baseEvent: null, baseLocalHash: null } },
];

async function nativeDecrypt(text: string) {
  const envelope = JSON.parse(text); const { ciphertext, ...header } = envelope;
  const data = new TextEncoder();
  const imported = await webcrypto.subtle.importKey('raw', data.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(header.salt, 'hex'),
    iterations: header.iterations, hash: 'SHA-256' }, imported, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const aad = JSON.stringify(Object.fromEntries(Object.keys(header).sort().map((key) => [key, header[key]])));
  const decoded = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(header.nonce, 'hex'),
    additionalData: data.encode(aad), tagLength: 128 }, key, Buffer.from(ciphertext, 'hex'));
  return validateBatch(JSON.parse(new TextDecoder().decode(decoded)));
}

test('phone→browser→phone encryption preserves the exact authorized minute identity and opaque metadata', async () => {
  const originals = [minute(), ...metadata()];
  const phoneCiphertext = await encryptBatch({ version: 1, id: 'phone_batch', documents: originals }, passphrase);
  const browser = mergeLedger(emptyLedger('browser_actor'), (await decryptBatch(phoneCiphertext, passphrase)).documents);
  const edited = editCells(browser, [{ day, minute: 600, text: 'Browser note\n  Keep exact spaces  ' }], 2000).state;
  const current = getMinute(edited, day, 600)!;
  for (const field of ['id', 'categoryId', 'blockId', 'source', 'createdAt']) assert.equal(current.value![field], originals[0]!.value![field]);
  for (const doc of metadata()) assert.deepEqual(edited.documents.find((item) => item.key === doc.key), doc);
  assert.deepEqual(Object.keys(edited.pending), [`minute:${day}:600`]);
  const browserCiphertext = await encryptBatch({ version: 1, id: 'browser_batch', documents: [current] }, passphrase);
  assert.equal(browserCiphertext.includes('Browser note'), false);
  const returned = await decryptBatch(browserCiphertext, passphrase);
  assert.equal(returned.documents[0]!.value!.text, 'Browser note\n  Keep exact spaces  ');
  assert.deepEqual(await nativeDecrypt(browserCiphertext), returned,
    'independent WebCrypto decrypt confirms phone PBKDF2, nonce/tag layout and authenticated header bytes');
});

test('browser HLC causally follows imported future clocks, equal-wall counters and counter rollover', () => {
  const future = 9_000_000_000_000;
  const imported = mergeLedger(emptyLedger('browser_actor'), [{ ...minute(), revision: revision(future, 17) }]);
  const first = editCells(imported, [{ day, minute: 600, text: 'Later causally' }], 1).state;
  assert.equal(getMinute(first, day, 600)!.revision, revision(future, 18, 'browser_actor'));
  const nearRollover = mergeLedger(first, [{ ...minute('Remote later'), revision: revision(future, 99_999_999) }]);
  const second = editCells(nearRollover, [{ day, minute: 600, text: 'After rollover' }], 2).state;
  assert.equal(getMinute(second, day, 600)!.revision, revision(future + 1, 0, 'browser_actor'));
  validateBatch({ version: 1, id: 'clock_result', documents: second.documents });
  assert.throws(() => mergeLedger(emptyLedger('browser_actor'), [{ ...minute(), revision: '9999999999999999:00000000:phone_actor' }]), /clock|bounds/);
});

test('same-revision corruption is rejected atomically and losing edits/tombstones remain recoverable', () => {
  const initial = mergeLedger(emptyLedger('browser_actor'), [minute()]); const original = structuredClone(initial);
  assert.throws(() => mergeLedger(initial, [minute('Different bytes')]), /same revision/);
  assert.deepEqual(initial, original);
  const newer = mergeLedger(initial, [{ ...minute('A new remote note'), revision: revision(2000) }]);
  assert.ok(newer.conflicts.some((doc) => doc.value?.text === 'Phone note'));
  const deleted = mergeLedger(newer, [{ ...minute(), revision: revision(3000), value: null }]);
  assert.equal(getMinute(deleted, day, 600)!.value, null);
  const stale = mergeLedger(deleted, [minute('Stale resurrection', 2500)]);
  assert.equal(getMinute(stale, day, 600)!.value, null);
  assert.ok(stale.conflicts.some((doc) => doc.value?.text === 'Stale resurrection'));
});

test('empty and unchanged edits cannot invent Unaccounted minutes or upload new metadata', () => {
  const empty = emptyLedger('browser_actor');
  const untouched = editCells(empty, [{ day, minute: 600, text: '' }, { day, minute: 601, text: '' }], 1000);
  assert.deepEqual(untouched.state, empty); assert.equal(untouched.undo.after.length, 0);
  const imported = mergeLedger(empty, [minute(), ...metadata()]);
  const noOp = editCells(imported, [{ day, minute: 600, text: 'Phone note' }], 2000);
  assert.deepEqual(noOp.state, imported); assert.equal(noOp.undo.after.length, 0);
  const cleared = editCells(imported, [{ day, minute: 600, text: '' }], 2000).state;
  assert.equal(getMinute(cleared, day, 600)!.value!.text, '');
  assert.equal(getMinute(cleared, day, 600)!.value!.categoryId, 'basil-source');
  assert.equal(getMinute(cleared, day, 600)!.value!.blockId, 'activity_prayer');
  assert.equal(cleared.documents.filter((doc) => doc.key.startsWith('projection:')).length, 1);
});

test('new browser minutes never infer category/source/calendar ownership and Undo emits causal tombstones', () => {
  const initial = emptyLedger('browser_actor');
  const changed = editCells(initial, [{ day, minute: 500, text: 'Read' }, { day, minute: 501, text: 'Read' }], 1000);
  const first = getMinute(changed.state, day, 500)!, second = getMinute(changed.state, day, 501)!;
  assert.equal(first.value!.categoryId, 'unaccounted'); assert.notEqual(first.value!.blockId, second.value!.blockId);
  assert.equal(changed.state.documents.some((doc) => /^(?:projection|category):/.test(doc.key)), false);
  const undone = undoEdit(changed.state, changed.undo, 2000);
  assert.equal(getMinute(undone, day, 500)!.value, null); assert.equal(getMinute(undone, day, 501)!.value, null);
  assert.ok(getMinute(undone, day, 500)!.revision > first.revision);
  validateBatch({ version: 1, id: 'undo_result', documents: undone.documents });
});

test('Undo refuses an imported newer edit instead of overwriting it, without changing either input', () => {
  const base = mergeLedger(emptyLedger('browser_actor'), [minute()]);
  const changed = editCells(base, [{ day, minute: 600, text: 'Browser edit' }], 2000);
  const remote = mergeLedger(changed.state, [minute('New phone edit', 3000)]); const before = hashValue(remote);
  assert.throws(() => undoEdit(remote, changed.undo, 4000), /changed.*Undo|overwrite newer/);
  assert.equal(hashValue(remote), before); assert.equal(getMinute(remote, day, 600)!.value!.text, 'New phone edit');
});

test('cached browser state validates conflict records, pending revision references and coordinate consistency', () => {
  const state = mergeLedger(emptyLedger('browser_actor'), [minute()]); validateState(state);
  const badConflict = structuredClone(state); badConflict.conflicts = [{ ...minute(), revision: 'invalid' }];
  assert.throws(() => validateState(badConflict));
  const badPending = structuredClone(state); badPending.pending['minute:2026-10-25:600'] = revision(9999);
  assert.throws(() => validateState(badPending), /pending/);
  const badCoordinate = structuredClone(state); badCoordinate.documents[0]!.value!.minuteIndex = 601;
  assert.throws(() => validateState(badCoordinate), /minute content/);
});

test('quoted spreadsheet cells preserve multiline text and map columns to consecutive real dates without rollover', () => {
  assert.deepEqual(pastedChanges('"First\nline"\tSecond\r\nThird\tFourth', '2026-12-31', 600), [
    { day: '2026-12-31', minute: 600, text: 'First\nline' }, { day: '2027-01-01', minute: 600, text: 'Second' },
    { day: '2026-12-31', minute: 601, text: 'Third' }, { day: '2027-01-01', minute: 601, text: 'Fourth' },
  ]);
  assert.throws(() => pastedChanges('A\nB', day, 1439), /minute range|day|past/);
  assert.throws(() => pastedChanges('A\tB', '9999-12-31', 600), /date|range|year/);
});
