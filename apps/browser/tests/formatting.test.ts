import test from 'node:test';
import assert from 'node:assert/strict';
import { hashValue, validateBatch } from '../shared/sync/codec';
import type { SyncDocument } from '../shared/sync/types';
import { cellFormatKey, formatFromDocument } from '../shared/utils/cell-format';
import { formatCells, groupSelection, ungroupSelection } from '../src/formatting';
import { applyDocumentValues, emptyLedger, getMinute, mergeLedger, minuteKey, undoEdit } from '../src/ledger';

const day = '2026-10-27';
const revision = (wall = 1000) => `${String(wall).padStart(16, '0')}:00000000:phone_actor`;
const minute = (index = 600, text = 'Read instructions', blockId = 'activity_read'): SyncDocument => ({
  key: minuteKey(day, index), revision: revision(), value: { id: `phone_${index}`, dateKey: day, minuteIndex: index,
    text, categoryId: 'basil', blockId, source: 'inherited-plan', createdAt: '2026-10-27T10:00:00.000Z',
    updatedAt: '2026-10-27T10:01:00.000Z', opaqueOrigin: { preserved: true } },
});
const metadata: SyncDocument[] = [
  { key: 'category:basil', revision: revision(), value: { id: 'basil', name: 'Prayer', color: '#0B8043',
    provider: 'google', accountId: 'google:person', providerColorId: '10', opaqueProvider: 'keep' } },
  { key: cellFormatKey(day, 600), revision: revision(), value: { kind: 'minuteFormat', extraEnvelope: 'keep', format: {
    bold: true, underline: true, noFill: true, textColor: '#FFFFFF', futureFormat: { value: 'keep' },
    activityGroup: { id: 'activity_read', title: 'Reading' },
  } } },
  { key: 'projection:owned', revision: revision(), value: { id: 'owned', blockId: 'activity_read',
    sourceEventId: 'google-original', eventId: 'google-original', opaqueOwnership: 'keep' } },
];
const initial = () => mergeLedger(emptyLedger('browser_actor'), [minute(), ...metadata]);
const document = (state: ReturnType<typeof initial>, key: string) => state.documents.find((item) => item.key === key);

test('browser styles preserve exact note, source/group identity and opaque metadata; one causal Undo restores the format', () => {
  const state = initial(); const before = structuredClone(state);
  const result = formatCells(state, [{ day, minute: 600 }], { bold: false, italic: true, textColor: '#aa11cc' }, [], 2000);
  assert.deepEqual(getMinute(result.state, day, 600), getMinute(state, day, 600));
  const value = document(result.state, cellFormatKey(day, 600))!.value!;
  const expectedFormat = { ...metadata[1]!.value!.format as Record<string, unknown>, italic: true, textColor: '#AA11CC' };
  delete expectedFormat.bold;
  assert.deepEqual(value, { ...metadata[1]!.value, format: expectedFormat });
  assert.equal('bold' in (value.format as object), false);
  assert.equal(formatFromDocument(value).italic, true);
  assert.deepEqual((value.format as Record<string, unknown>).futureFormat, { value: 'keep' });
  assert.deepEqual(document(result.state, 'projection:owned'), metadata[2]);
  assert.deepEqual(document(result.state, 'category:basil'), metadata[0]);
  assert.deepEqual(Object.keys(result.state.pending), [cellFormatKey(day, 600)]);
  const undone = undoEdit(result.state, result.undo, 3000);
  assert.deepEqual(document(undone, cellFormatKey(day, 600))!.value, metadata[1]!.value);
  assert.deepEqual(state, before);
});

test('explicit approved fill records blank minutes, clears Reset fill and reuses exact Google category without altering notes', () => {
  const state = initial();
  const result = formatCells(state, [{ day, minute: 600 }, { day, minute: 601 }], {
    fill: { categoryId: 'basil', color: '#0b8043', name: 'Ignored rename' },
  }, ['#0B8043'], 2000);
  assert.deepEqual(getMinute(result.state, day, 600), getMinute(state, day, 600), 'same category leaves all original minute bytes/revision intact');
  assert.equal(formatFromDocument(document(result.state, cellFormatKey(day, 600))?.value).noFill, undefined);
  const blank = getMinute(result.state, day, 601)!;
  assert.equal(blank.value!.text, ''); assert.equal(blank.value!.categoryId, 'basil');
  assert.equal(blank.value!.source, 'manual'); assert.notEqual(blank.value!.blockId, 'activity_read');
  assert.deepEqual(document(result.state, 'category:basil'), metadata[0]);
  assert.deepEqual(document(result.state, 'projection:owned'), metadata[2]);
  const undone = undoEdit(result.state, result.undo, 3000);
  assert.equal(getMinute(undone, day, 601)!.value, null);
  assert.deepEqual(document(undone, cellFormatKey(day, 600))!.value, metadata[1]!.value);
});

test('new Google colors retain exact scoped provider metadata and category creation participates in Undo', () => {
  const state = emptyLedger('browser_actor');
  const result = formatCells(state, [{ day, minute: 700 }], { fill: { color: '#F4511E', name: 'Orange',
    providerColorId: '6', accountId: 'google:person' } }, ['#F4511E'], 2000);
  const cell = getMinute(result.state, day, 700)!; const category = document(result.state, `category:${cell.value!.categoryId}`)!;
  assert.deepEqual({ ...category.value, id: 'dynamic' }, { id: 'dynamic', name: 'Orange', color: '#F4511E',
    updatedAt: new Date(2000).toISOString(), provider: 'google', accountId: 'google:person', providerColorId: '6',
    googleColorVerified: true, providerOriginalColor: '#F4511E', providerOriginalName: 'Orange' });
  const again = formatCells(result.state, [{ day, minute: 700 }], { fill: { color: '#F4511E', name: 'Orange',
    providerColorId: '6', accountId: 'google:person' } }, ['#F4511E'], 3000);
  assert.equal(again.undo.after.length, 0); assert.deepEqual(again.state, result.state);
  const undone = undoEdit(result.state, result.undo, 4000);
  assert.equal(document(undone, category.key)!.value, null); assert.equal(getMinute(undone, day, 700)!.value, null);
  validateBatch({ version: 1, id: 'formatted_result', documents: result.state.documents });
});

test('Reset fill preserves notes and named activity membership, removes empty nongroup actuals and suppresses plan fill', () => {
  const state = mergeLedger(initial(), [minute(601, '', 'sheet_blank'), minute(602, '', 'activity_read')]);
  const result = formatCells(state, [600, 601, 602, 603].map((index) => ({ day, minute: index })), { fill: null }, [], 2000);
  assert.equal(getMinute(result.state, day, 600)!.value!.text, 'Read instructions');
  assert.equal(getMinute(result.state, day, 600)!.value!.categoryId, 'unaccounted');
  assert.equal(getMinute(result.state, day, 600)!.value!.blockId, 'activity_read');
  assert.equal(getMinute(result.state, day, 601)!.value, null);
  assert.equal(getMinute(result.state, day, 602)!.value!.categoryId, 'unaccounted');
  assert.equal(getMinute(result.state, day, 602)!.value!.blockId, 'activity_read');
  assert.equal(getMinute(result.state, day, 603), undefined);
  for (let index = 600; index <= 603; index++) assert.equal(formatFromDocument(document(result.state, cellFormatKey(day, index))?.value).noFill, true);
  const undone = undoEdit(result.state, result.undo, 3000);
  for (let index = 600; index <= 602; index++) assert.deepEqual(getMinute(undone, day, index)!.value, getMinute(state, day, index)!.value);
  assert.deepEqual(document(result.state, 'projection:owned'), metadata[2]);
});

test('format-only blank cells stay unrecorded and default removals do not queue phantom revisions', () => {
  const state = emptyLedger('browser_actor');
  const removed = formatCells(state, [{ day, minute: 10 }], { bold: false, textColor: null }, [], 2000);
  assert.deepEqual(removed.state, state); assert.equal(removed.undo.after.length, 0);
  const styled = formatCells(state, [{ day, minute: 10 }], { bold: true, underline: true }, [], 2000);
  assert.equal(getMinute(styled.state, day, 10), undefined);
  assert.deepEqual(Object.keys(styled.state.pending), [cellFormatKey(day, 10)]);
  const undone = undoEdit(styled.state, styled.undo, 3000);
  assert.equal(document(undone, cellFormatKey(day, 10))!.value, null);
  const futureEnvelope = mergeLedger(state, [{ key: cellFormatKey(day, 10), revision: revision(),
    value: { kind: 'minuteFormat', format: { bold: true }, futureEnvelope: { preserved: true } } }]);
  const unstyled = formatCells(futureEnvelope, [{ day, minute: 10 }], { bold: false }, [], 3000);
  assert.deepEqual(document(unstyled.state, cellFormatKey(day, 10))!.value,
    { kind: 'minuteFormat', format: {}, futureEnvelope: { preserved: true } });
});

test('formatting guards unsupported colors/metadata/coordinates atomically and never permits projection writes', () => {
  const state = initial(); const before = hashValue(state);
  for (const patch of [{ fill: { color: '#123456' } }, { fill: { color: '#0B8043', categoryId: 'missing' } },
    { fill: { color: '#0B8043', providerColorId: '10' } }, { textColor: 'red' }, { bold: 'yes' }, { fill: false }]) {
    assert.throws(() => formatCells(state, [{ day, minute: 600 }], patch as never, ['#0B8043'], 2000));
    assert.equal(hashValue(state), before);
  }
  assert.throws(() => formatCells(state, [{ day, minute: 600 }, { day, minute: 600 }], { italic: true }, [], 2000), /once/);
  assert.throws(() => formatCells(state, [{ day: '2026-02-30', minute: 0 }], { italic: true }, [], 2000), /identifier/);
  assert.throws(() => formatCells(state, Array.from({ length: 10001 }, () => ({ day, minute: 0 })), { italic: true }, [], 2000), /10,000/);
  assert.throws(() => applyDocumentValues(state, [{ key: 'projection:owned', value: null }], 2000), /editable/);
  assert.equal(hashValue(state), before);
});

test('format Undo refuses a newer remote minute or category, including a changed-and-restored value', () => {
  const state = initial();
  const result = formatCells(state, [{ day, minute: 600 }], { fill: { color: '#F4511E', name: 'Orange' } }, ['#F4511E'], 2000);
  const category = result.undo.after.find((doc) => doc.key.startsWith('category:') && !doc.key.startsWith('category:minuteFormat:'))!;
  const remote = mergeLedger(result.state, [{ ...category, revision: revision(4000) }]);
  const before = hashValue(remote);
  assert.throws(() => undoEdit(remote, result.undo, 5000), /newer work/);
  assert.equal(hashValue(remote), before);
  const changed = mergeLedger(result.state, [{ ...getMinute(result.state, day, 600)!, revision: revision(4000),
    value: { ...getMinute(result.state, day, 600)!.value!, text: 'New phone note' } }]);
  assert.throws(() => undoEdit(changed, result.undo, 5000), /newer work/);
});

test('deliberate Group retains each minute note/identity/style, records selected blanks, and Undo restores all documents', () => {
  const state = mergeLedger(emptyLedger('browser_actor'), [minute(600, 'Make coffee', 'old_first'), minute(602, 'Talk to mum', 'old_last'), metadata[0]!,
    { key: cellFormatKey(day, 600), revision: revision(), value: { kind: 'minuteFormat', futureEnvelope: true,
      format: { italic: true, noFill: true, textColor: '#445566', futureStyle: 'keep' } } }, metadata[2]!]);
  const original = structuredClone(state);
  const result = groupSelection(state, [602, 600, 601].map((index) => ({ day, minute: index })), { title: '  Make coffee  ' }, [], 2000);
  const first = getMinute(result.state, day, 600)!; const middle = getMinute(result.state, day, 601)!;
  assert.match(String(first.value!.blockId), /^activity_/); assert.equal(middle.value!.blockId, first.value!.blockId);
  assert.equal(getMinute(result.state, day, 602)!.value!.blockId, first.value!.blockId);
  assert.equal(first.value!.text, 'Make coffee'); assert.equal(getMinute(result.state, day, 602)!.value!.text, 'Talk to mum');
  for (const field of ['id', 'source', 'createdAt', 'opaqueOrigin']) assert.deepEqual(first.value![field], getMinute(state, day, 600)!.value![field]);
  assert.equal(middle.value!.text, ''); assert.equal(middle.value!.categoryId, 'basil');
  const formatted = document(result.state, cellFormatKey(day, 600))!.value!;
  assert.deepEqual(formatted, { kind: 'minuteFormat', futureEnvelope: true, format: { italic: true, textColor: '#445566',
    futureStyle: 'keep', activityGroup: { id: first.value!.blockId, title: 'Make coffee' } } });
  assert.deepEqual(document(result.state, 'projection:owned'), metadata[2]);
  const undone = undoEdit(result.state, result.undo, 3000);
  for (const doc of state.documents) assert.deepEqual(document(undone, doc.key)!.value, doc.value);
  assert.equal(getMinute(undone, day, 601)!.value, null);
  assert.deepEqual(state, original);
});

test('browser Group/Ungroup reject partial existing groups and nonconsecutive/cross-day selections atomically', () => {
  const state = initial(); const before = hashValue(state);
  assert.throws(() => groupSelection(state, [{ day, minute: 600 }], { title: 'New' }, []), /Ungroup.*whole/);
  const distant = mergeLedger(state, [{ ...minute(700), key: 'minute:2026-10-28:700', value: {
    ...minute(700).value!, dateKey: '2026-10-28' } }]);
  assert.throws(() => ungroupSelection(distant, [{ day, minute: 600 }], 2000), /whole activity/);
  for (const coords of [[{ day, minute: 600 }, { day, minute: 602 }],
    [{ day, minute: 600 }, { day: '2026-10-28', minute: 601 }], [{ day, minute: 600 }, { day, minute: 600 }]]) {
    assert.throws(() => groupSelection(emptyLedger('browser_actor'), coords, { title: 'Test' }, [], 2000), /consecutive/);
  }
  assert.equal(hashValue(state), before);
});

test('complete browser Ungroup retains content, fill and styling with independent identities and one guarded Undo', () => {
  const base = mergeLedger(emptyLedger('browser_actor'), [minute(600, 'Read', 'old_first'), minute(601, '', 'old_second'), metadata[0]!]);
  const grouped = groupSelection(base, [{ day, minute: 600 }, { day, minute: 601 }], { title: 'Read' }, [], 2000);
  const result = ungroupSelection(grouped.state, [{ day, minute: 601 }, { day, minute: 600 }], 3000);
  const first = getMinute(result.state, day, 600)!; const second = getMinute(result.state, day, 601)!;
  assert.notEqual(first.value!.blockId, second.value!.blockId);
  for (const index of [600, 601]) {
    const before = getMinute(grouped.state, day, index)!.value!; const after = getMinute(result.state, day, index)!.value!;
    for (const field of ['id', 'text', 'categoryId', 'source', 'createdAt', 'opaqueOrigin']) assert.deepEqual(after[field], before[field]);
    assert.equal(formatFromDocument(document(result.state, cellFormatKey(day, index))?.value).activityGroup, undefined);
  }
  const undone = undoEdit(result.state, result.undo, 4000);
  for (const doc of grouped.state.documents) assert.deepEqual(document(undone, doc.key)!.value, doc.value);
  const changed = mergeLedger(result.state, [{ ...first, revision: revision(5000), value: { ...first.value!, text: 'Phone edit' } }]);
  assert.throws(() => undoEdit(changed, result.undo, 6000), /newer work/);
  validateBatch({ version: 1, id: 'group_and_ungroup', documents: result.state.documents });
});
