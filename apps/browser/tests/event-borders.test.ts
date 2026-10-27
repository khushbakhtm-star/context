import test from 'node:test';
import assert from 'node:assert/strict';
import { cellEventLabel, cellFormatKey, formatFromDocument } from '../shared/utils/cell-format';
import { mergeLedger, emptyLedger, getMinute, undoEdit } from '../src/ledger';
import { eventSelectionFingerprint, formatCells, groupSelection, resetCellsSelection, ungroupSelection } from '../src/formatting';
import { minuteCellPresentation } from '../src/cell-presentation';

const day = '2026-10-25';
const revision = (counter: number) => `0000000000001000:${String(counter).padStart(8, '0')}:phone_actor`;
function source() {
  const entries = Array.from({ length: 5 }, (_, index) => ({ key: `minute:${day}:${600 + index}`, revision: revision(index),
    value: { id: `entry_${index}`, dateKey: day, minuteIndex: 600 + index, text: ['First', '', 'A thought', '', 'Last'][index]!,
      categoryId: 'google_palette_2952a3', blockId: 'source_original', source: 'imported', createdAt: 'original', updatedAt: 'original' } }));
  const labels = entries.map((entry, index) => ({ key: cellFormatKey(day, 600 + index), revision: revision(10 + index),
    value: { kind: 'minuteFormat', format: { calendarEvent: { id: 'source_original', title: 'Study' }, italic: true } } }));
  return mergeLedger(emptyLedger('browser_actor'), [...entries, ...labels,
    { key: 'projection:source', revision: revision(20), value: { blockId: 'source_original', sourceEventId: 'unchanged-provider-event', eventId: 'unchanged-provider-event' } }]);
}
const selected = (start: number, end = start) => Array.from({ length: end - start + 1 }, (_, index) => ({ day, minute: start + index }));
const format = (state: ReturnType<typeof source>, minute: number) => formatFromDocument(state.documents.find((doc) => doc.key === cellFormatKey(day, minute))?.value);

test('partial Reset cells preserves the first exact source identity, splits the later border and atomically undoes every changed cell', () => {
  const state = source(); const result = resetCellsSelection(state, selected(601, 602), 2000);
  assert.equal(getMinute(result.state, day, 601)!.value, null); assert.equal(getMinute(result.state, day, 602)!.value, null);
  assert.deepEqual(format(result.state, 601), { noFill: true });
  assert.equal(getMinute(result.state, day, 600)!.value!.blockId, 'source_original');
  const tail = getMinute(result.state, day, 603)!.value!.blockId;
  assert.notEqual(tail, 'source_original'); assert.equal(getMinute(result.state, day, 604)!.value!.blockId, tail);
  assert.equal(cellEventLabel(format(result.state, 600), 'source_original')!.title, 'Study');
  assert.equal(cellEventLabel(format(result.state, 603), String(tail))!.title, 'Study');
  assert.equal(getMinute(result.state, day, 604)!.value!.text, 'Last');
  assert.deepEqual(result.state.documents.find((doc) => doc.key === 'projection:source'), state.documents.find((doc) => doc.key === 'projection:source'));
  const undo = undoEdit(result.state, result.undo, 3000);
  for (const doc of state.documents) assert.deepEqual(undo.documents.find((item) => item.key === doc.key)!.value, doc.value);
});

test('partial Ungroup keeps selected words/fill/styles private while retaining source identity on the first remainder', () => {
  const state = source(); const result = ungroupSelection(state, selected(602), 2000);
  const detached = getMinute(result.state, day, 602)!.value!;
  assert.equal(detached.text, 'A thought'); assert.equal(detached.categoryId, 'google_palette_2952a3');
  assert.notEqual(detached.blockId, 'source_original'); assert.deepEqual(format(result.state, 602), { italic: true });
  assert.equal(getMinute(result.state, day, 600)!.value!.blockId, 'source_original');
  assert.equal(getMinute(result.state, day, 601)!.value!.blockId, 'source_original');
  assert.notEqual(getMinute(result.state, day, 603)!.value!.blockId, 'source_original');
  const changed = mergeLedger(result.state, [{ ...getMinute(result.state, day, 600)!, revision: '0000000000004000:00000050:phone_actor',
    value: { ...getMinute(result.state, day, 600)!.value!, text: 'New phone thought' } }]);
  assert.throws(() => undoEdit(changed, result.undo, 3000), /newer work/);
});

test('Group can redefine one source minute and records a new blank one-minute event without inventing note text', () => {
  const state = source(); const shortened = groupSelection(state, selected(602), { title: 'New title' }, [], 2000);
  assert.equal(getMinute(shortened.state, day, 602)!.value!.blockId, 'source_original');
  assert.equal(format(shortened.state, 602).calendarEvent!.title, 'New title');
  assert.notEqual(getMinute(shortened.state, day, 600)!.value!.blockId, 'source_original');
  assert.notEqual(getMinute(shortened.state, day, 603)!.value!.blockId, 'source_original');
  const grouped = groupSelection(emptyLedger('browser_actor'), selected(700), { title: 'One minute', fill: { color: '#2952A3' } }, ['#2952A3'], 2000);
  assert.equal(getMinute(grouped.state, day, 700)!.value!.text, '');
  assert.equal(format(grouped.state, 700).activityGroup!.title, 'One minute');
  assert.equal(getMinute(undoEdit(grouped.state, grouped.undo, 3000), day, 700)!.value, null);
});

test('event membership guards reject a newly arrived outside member before Undo and change the queued-command fingerprint', () => {
  const state = source(); const result = resetCellsSelection(state, selected(602), 2000);
  const extra = { ...getMinute(result.state, day, 600)!, key: `minute:${day}:610`, revision: revision(60),
    value: { ...getMinute(result.state, day, 600)!.value!, minuteIndex: 610 } };
  const changed = mergeLedger(result.state, [extra]);
  assert.throws(() => undoEdit(changed, result.undo, 3000), /activity changed/);
  assert.notEqual(eventSelectionFingerprint(result.state, selected(600)), eventSelectionFingerprint(changed, selected(600)));
});

test('ordinary fill Reset preserves a blank source-linked event rather than performing Reset cells', () => {
  const state = source(); const result = formatCells(state, selected(601), { fill: null }, [], 2000);
  assert.equal(getMinute(result.state, day, 601)!.value!.text, '');
  assert.equal(getMinute(result.state, day, 601)!.value!.blockId, 'source_original');
  assert.equal(format(result.state, 601).calendarEvent!.title, 'Study');
  assert.equal(format(result.state, 601).noFill, true);
});

test('calendar titles appear once as a separate border label and never populate empty minute notes', () => {
  const docs = new Map(source().documents.map((doc) => [doc.key, doc]));
  const noPlan = () => undefined;
  assert.equal(minuteCellPresentation(docs, day, 600, noPlan).first, true);
  assert.equal(minuteCellPresentation(docs, day, 601, noPlan).first, false);
  assert.equal(minuteCellPresentation(docs, day, 601, noPlan).text, '');
  assert.equal(minuteCellPresentation(docs, day, 604, noPlan).last, true);
  const plan = (date: string, minute: number) => date === day && minute >= 700 && minute < 705 ? { id: 'plan', title: 'Future activity' } : undefined;
  const blank = new Map();
  assert.equal(minuteCellPresentation(blank, day, 700, plan).first, true);
  assert.equal(minuteCellPresentation(blank, day, 701, plan).first, false);
  assert.equal(minuteCellPresentation(blank, day, 704, plan).last, true);
  for (let minute = 700; minute < 705; minute++) assert.equal(minuteCellPresentation(blank, day, minute, plan).text, '');
});

test('a legacy source border split leaves unlabeled and differently titled neighbors with the same block ID untouched', () => {
  const initial = source();
  const state = mergeLedger(initial, [
    { key: cellFormatKey(day, 603), revision: '0000000000001500:00000050:phone_actor', value: null },
    { key: cellFormatKey(day, 604), revision: '0000000000001500:00000051:phone_actor',
      value: { kind: 'minuteFormat', format: { calendarEvent: { id: 'source_original', title: 'Separate activity' } } } },
  ]);
  const result = resetCellsSelection(state, selected(601), 2000);
  for (const minute of [603, 604]) {
    assert.deepEqual(getMinute(result.state, day, minute), getMinute(state, day, minute));
    assert.deepEqual(result.state.documents.find((doc) => doc.key === cellFormatKey(day, minute)),
      state.documents.find((doc) => doc.key === cellFormatKey(day, minute)));
  }
  const docs = new Map(state.documents.map((doc) => [doc.key, doc]));
  assert.equal(minuteCellPresentation(docs, day, 604, () => undefined).first, true);
});
