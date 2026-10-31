import test from 'node:test';
import assert from 'node:assert/strict';
import { hashValue, validateBatch } from '../shared/sync/codec';
import type { SyncDocument } from '../shared/sync/types';
import { cellFormatKey } from '../shared/utils/cell-format';
import { formatCells, groupSelection, transferCells, ungroupSelection } from '../src/formatting';
import { applyDocumentValues, editCells, emptyLedger, getMinute, mergeLedger, minuteKey, undoEdit, validateState } from '../src/ledger';

const day = '2026-10-30';
const blockId = 'activity_coffee';
const prefix = 'category:minuteFormat:activityEdit:';
const intentKey = (id = blockId) => `${prefix}${id}`;
const revision = (wall = 1000, counter = 0) => `${String(wall).padStart(16, '0')}:${String(counter).padStart(8, '0')}:phone_actor`;
const point = (minute: number) => ({ day, minute });
const document = (state: ReturnType<typeof initial>, key: string) => state.documents.find((item) => item.key === key);
const intent = (state: ReturnType<typeof initial>, id = blockId) => document(state, intentKey(id));
function initial() {
  const minutes: SyncDocument[] = [600, 601, 602, 603].flatMap((minute) => [{
    key: minuteKey(day, minute), revision: revision(1000, minute), value: { id: `minute_${minute}`,
      dateKey: day, minuteIndex: minute, text: `Original ${minute}`, blockId, categoryId: 'family',
      source: 'imported', createdAt: 'original', updatedAt: 'original', opaqueMinute: { keep: true } },
  }, { key: cellFormatKey(day, minute), revision: revision(1000, 1440 + minute),
    value: { kind: 'minuteFormat', opaqueEnvelope: { keep: true }, format: {
      italic: true, activityGroup: { id: blockId, title: 'Coffee' }, unknownStyle: { keep: true },
    } } }]);
  return mergeLedger(emptyLedger('browser_actor'), [...minutes,
    { key: 'projection:calendar_owner', revision: revision(), value: { blockId, sourceEventId: 'source-id',
      eventId: 'event-id', state: 'synced', opaqueProvider: { keep: true } } }]);
}

test('a user note in a titled activity commits its intent atomically without changing ownership or visible Undo counts', () => {
  const state = initial(); const original = hashValue(state);
  const edited = editCells(state, [{ ...point(601), text: 'Exact new note\n  keep spaces  ' }], 2000);
  assert.deepEqual(intent(edited.state)?.value, { kind: 'activityEdit', blockId,
    updatedAt: new Date(2000).toISOString(), deleted: false });
  assert.equal(edited.undo.after.length, 1);
  assert.ok(edited.undo.after.every((item) => !item.key.startsWith(prefix)));
  assert.equal(edited.state.pending[intentKey()], intent(edited.state)!.revision);
  assert.deepEqual(document(edited.state, 'projection:calendar_owner'), document(state, 'projection:calendar_owner'));
  assert.deepEqual(getMinute(edited.state, day, 601)!.value!.opaqueMinute, { keep: true });
  assert.equal(getMinute(edited.state, day, 601)!.value!.source, 'manual');
  assert.equal(hashValue(state), original);
  const noOp = editCells(edited.state, [{ ...point(601), text: 'Exact new note\n  keep spaces  ' }], 3000);
  assert.deepEqual(noOp.state, edited.state);
  assert.equal(noOp.undo.after.length, 0);
  validateState(edited.state);
});

test('plain standalone notes and blank-cell styles do not claim activity or calendar ownership', () => {
  const note = editCells(emptyLedger('browser_actor'), [{ ...point(500), text: 'Independent note' }], 2000);
  assert.equal(note.state.documents.some((item) => item.key.startsWith(prefix)), false);
  const styled = formatCells(note.state, [point(501)], { bold: true }, [], 3000);
  assert.equal(styled.state.documents.some((item) => item.key.startsWith(prefix)), false);
  assert.equal(styled.state.documents.some((item) => item.key.startsWith('projection:')), false);
});

test('formatting a titled activity advances intent even when the minute value does not change', () => {
  const state = initial();
  const styled = formatCells(state, [point(600)], { bold: true }, [], 2000);
  assert.deepEqual(getMinute(styled.state, day, 600), getMinute(state, day, 600));
  assert.equal(intent(styled.state)!.value!.updatedAt, new Date(2000).toISOString());
  assert.equal(intent(styled.state)!.value!.deleted, false);
  assert.equal(styled.undo.after.length, 1);
  assert.deepEqual(document(styled.state, cellFormatKey(day, 600))!.value!.opaqueEnvelope, { keep: true });
});

test('full Ungroup preserves notes and marks the old calendar group deleted while partial Ungroup remains active', () => {
  const state = initial();
  const complete = ungroupSelection(state, [600, 601, 602, 603].map(point), 2000);
  assert.equal(intent(complete.state)!.value!.deleted, true);
  assert.equal(intent(complete.state)!.value!.updatedAt, new Date(2000).toISOString());
  for (const minute of [600, 601, 602, 603]) {
    assert.equal(getMinute(complete.state, day, minute)!.value!.text, `Original ${minute}`);
    assert.notEqual(getMinute(complete.state, day, minute)!.value!.blockId, blockId);
  }
  assert.deepEqual(document(complete.state, 'projection:calendar_owner'), document(state, 'projection:calendar_owner'));
  const partial = ungroupSelection(state, [point(601)], 2000);
  assert.equal(intent(partial.state)!.value!.deleted, false);
  const tailId = String(getMinute(partial.state, day, 602)!.value!.blockId);
  assert.notEqual(tailId, blockId);
  assert.equal(intent(partial.state, tailId)!.value!.deleted, false);
  assert.equal(intent(partial.state, String(getMinute(partial.state, day, 601)!.value!.blockId)), undefined);
  assert.deepEqual(intent(partial.state)!.value!.detachedMembers, [{ dateKey: day, minuteIndex: 601,
    blockId: getMinute(partial.state, day, 601)!.value!.blockId }]);
  assert.deepEqual(intent(partial.state)!.value!.derivedMembers, [602, 603].map((minuteIndex) => ({ dateKey: day, minuteIndex, blockId: tailId })));
  assert.deepEqual(intent(mergeLedger(emptyLedger('phone_reader'), partial.state.documents)), intent(partial.state));
});

test('new Group and local activity Move retain active intent for the final activity', () => {
  const notes = editCells(emptyLedger('browser_actor'), [600, 601].map((minute) => ({ ...point(minute), text: `Note ${minute}` })), 1000);
  const grouped = groupSelection(notes.state, [point(600), point(601)], { title: 'New activity' }, [], 2000);
  const id = String(getMinute(grouped.state, day, 600)!.value!.blockId);
  assert.equal(intent(grouped.state, id)!.value!.deleted, false);
  assert.equal(intent(grouped.state, id)!.value!.updatedAt, new Date(2000).toISOString());
  const moved = transferCells(grouped.state, [point(600), point(601)], point(800), {}, 3000);
  assert.equal(getMinute(moved.state, day, 600)!.value, null);
  assert.equal(getMinute(moved.state, day, 800)!.value!.blockId, id);
  assert.equal(intent(moved.state, id)!.value!.deleted, false);
  assert.equal(intent(moved.state, id)!.value!.updatedAt, new Date(3000).toISOString());
  validateState(moved.state);
});

test('Undo produces fresh restoring intent and a later reapply produces fresh deletion intent', () => {
  const state = initial();
  const ungrouped = ungroupSelection(state, [600, 601, 602, 603].map(point), 2000);
  const undone = undoEdit(ungrouped.state, ungrouped.undo, 2000);
  assert.equal(intent(undone)!.value!.deleted, false);
  assert.equal(intent(undone)!.value!.updatedAt, new Date(2001).toISOString(), 'same-millisecond Undo is a newer user action');
  for (const minute of [600, 601, 602, 603]) assert.deepEqual(getMinute(undone, day, minute)!.value, getMinute(state, day, minute)!.value);
  const reapplied = applyDocumentValues(undone, ungrouped.undo.after.map((item) => ({ key: item.key, value: item.value })), 2000);
  assert.equal(intent(reapplied.state)!.value!.deleted, true);
  assert.equal(intent(reapplied.state)!.value!.updatedAt, new Date(2002).toISOString());
});

test('remote imports and projection acknowledgements preserve user intent without promoting its timestamp', () => {
  const edited = editCells(initial(), [{ ...point(600), text: 'Local user edit' }], 2000);
  const originalIntent = intent(edited.state)!;
  const remote = mergeLedger(edited.state, [{ ...getMinute(edited.state, day, 600)!, revision: revision(3000),
    value: { ...getMinute(edited.state, day, 600)!.value!, text: 'Imported remote text', source: 'imported' } },
  { ...document(edited.state, 'projection:calendar_owner')!, revision: revision(3000, 1),
    value: { ...document(edited.state, 'projection:calendar_owner')!.value!, baseLocalHash: 'provider-ack' } }]);
  assert.deepEqual(intent(remote), originalIntent);
  assert.equal(remote.documents.filter((item) => item.key.startsWith(prefix)).length, 1);
});

test('newer remote activity intent guards Undo, even before its minute batch arrives', () => {
  const edited = editCells(initial(), [{ ...point(600), text: 'Local user edit' }], 2000);
  const remote = mergeLedger(edited.state, [{ ...intent(edited.state)!, revision: revision(3000),
    value: { ...intent(edited.state)!.value!, updatedAt: new Date(3000).toISOString(), deleted: true } }]);
  const unchanged = hashValue(remote);
  assert.throws(() => undoEdit(remote, edited.undo, 4000), /activity changed|newer work/);
  assert.equal(hashValue(remote), unchanged);
});

test('opaque activity metadata survives strict local timestamp advancement and malformed commands remain atomic', () => {
  const imported = mergeLedger(initial(), [{ key: intentKey(), revision: revision(1000, 2500),
    value: { kind: 'activityEdit', blockId, updatedAt: new Date(5000).toISOString(), deleted: false,
      futureIntent: { keep: true } } }]);
  const edited = editCells(imported, [{ ...point(600), text: 'Newest user intent despite a slow device clock' }], 2000);
  assert.equal(intent(edited.state)!.value!.updatedAt, new Date(5001).toISOString());
  assert.deepEqual(intent(edited.state)!.value!.futureIntent, { keep: true });
  const before = hashValue(imported);
  assert.throws(() => applyDocumentValues(imported, [
    { key: minuteKey(day, 600), value: { ...getMinute(imported, day, 600)!.value!, text: 'Must roll back' } },
    { key: 'projection:not-editable', value: null },
  ], 3000), /editable/);
  assert.equal(hashValue(imported), before);
  assert.throws(() => applyDocumentValues(imported, [{ key: intentKey(), value: null }], 3000), /editable/);
  validateBatch({ version: 1, id: 'intent_compatible_batch', documents: edited.state.documents });
});

test('regrouping detached notes prunes former restoration rights without promoting the old event timestamp', () => {
  const notes = editCells(emptyLedger('browser_actor'), [600, 601].map((minute) => ({ ...point(minute), text: `Detached ${minute}` })), 1000);
  const oldId = 'activity_old';
  const detachedMembers = [600, 601].map((minute) => ({ dateKey: day, minuteIndex: minute,
    blockId: String(getMinute(notes.state, day, minute)!.value!.blockId) }));
  const old = { key: intentKey(oldId), revision: revision(1000, 2500),
    value: { kind: 'activityEdit', blockId: oldId, updatedAt: new Date(1500).toISOString(),
      deleted: true, detachedMembers, futureIntent: { keep: true } } };
  const imported = mergeLedger(notes.state, [old]);
  const grouped = groupSelection(imported, [point(600)], { title: 'New activity' }, [], 2000);
  const former = intent(grouped.state, oldId)!;
  assert.notEqual(former.revision, old.revision);
  assert.deepEqual(former.value, { ...old.value, detachedMembers: [detachedMembers[1]] });
  assert.ok(grouped.undo.activityEditGuards?.some((guard) => guard.key === old.key && guard.revision === former.revision));
  assert.ok(grouped.undo.after.every((item) => item.key !== old.key));
  const groupedAgain = groupSelection(grouped.state, [point(601)], { title: 'Another activity' }, [], 3000);
  assert.deepEqual(intent(groupedAgain.state, oldId)!.value, { kind: 'activityEdit', blockId: oldId,
    updatedAt: new Date(1500).toISOString(), deleted: true, futureIntent: { keep: true } });
  validateState(groupedAgain.state);
});

test('editing an imported detached note and Undo both carry fresh user authority across a phone round trip', () => {
  const notes = editCells(emptyLedger('browser_actor'), [{ ...point(600), text: 'Imported detached note' }], 1000);
  const minute = getMinute(notes.state, day, 600)!;
  const oldId = 'activity_old';
  const imported = mergeLedger(notes.state, [{ ...minute, revision: revision(1200),
    value: { ...minute.value!, source: 'imported', opaqueProvider: { keep: true } } },
  { key: intentKey(oldId), revision: revision(1500), value: { kind: 'activityEdit', blockId: oldId,
    updatedAt: new Date(1500).toISOString(), deleted: true,
    detachedMembers: [{ dateKey: day, minuteIndex: 600, blockId: minute.value!.blockId }] } }]);
  const edited = editCells(imported, [{ ...point(600), text: 'New user note' }], 3000);
  const roundTrip = mergeLedger(emptyLedger('phone_reader'), edited.state.documents);
  const restored = getMinute(roundTrip, day, 600)!.value!;
  assert.equal(restored.source, 'manual');
  assert.equal(restored.updatedAt, new Date(3000).toISOString());
  assert.deepEqual(restored.opaqueProvider, { keep: true });
  assert.equal(intent(roundTrip, oldId)!.value!.updatedAt, new Date(3000).toISOString());
  assert.ok(Date.parse(String(restored.updatedAt)) > 2500, 'a provider edit at 2500 cannot supersede this genuine user edit');
  assert.equal(intent(roundTrip, oldId)!.value!.deleted, true);
  const undone = undoEdit(edited.state, edited.undo, 4000);
  assert.equal(getMinute(undone, day, 600)!.value!.text, minute.value!.text);
  assert.equal(getMinute(undone, day, 600)!.value!.source, 'manual');
  assert.equal(getMinute(undone, day, 600)!.value!.updatedAt, new Date(4000).toISOString());
  assert.equal(intent(undone, oldId)!.value!.updatedAt, new Date(4000).toISOString());
  const styled = formatCells(undone, [point(600)], { italic: true }, [], 5000);
  assert.equal(intent(styled.state, oldId)!.value!.updatedAt, new Date(5000).toISOString());
  assert.equal(getMinute(styled.state, day, 600)!.value!.updatedAt, new Date(4000).toISOString(), 'formatting leaves note provenance alone');
  validateState(styled.state);
});

test('partial Ungroup alone captures fresh split siblings; unrelated Group cannot grant restoration rights', () => {
  const state = initial();
  const regrouped = groupSelection(state, [point(601)], { title: 'Independent activity' }, [], 2000);
  assert.equal(intent(regrouped.state)!.value!.derivedMembers, undefined);
  assert.equal(intent(regrouped.state)!.value!.detachedMembers, undefined);
  const partial = ungroupSelection(state, [point(601)], 2000);
  const undone = undoEdit(partial.state, partial.undo, 3000);
  assert.equal(intent(undone)!.value!.derivedMembers, undefined);
  assert.equal(intent(undone)!.value!.detachedMembers, undefined);
  assert.equal(intent(undone)!.value!.deleted, false);
});

test('a user edit of a claimed split sibling advances its own clock while preserving original provenance', () => {
  const partial = ungroupSelection(initial(), [point(601)], 2000);
  const siblingId = String(getMinute(partial.state, day, 602)!.value!.blockId);
  const original = intent(partial.state)!;
  const edited = editCells(partial.state, [{ ...point(602), text: 'Newer sibling note' }], 4000);
  assert.deepEqual(intent(edited.state), original, 'the original event clock is not fabricated from a sibling change');
  assert.equal(intent(edited.state, siblingId)!.value!.updatedAt, new Date(4000).toISOString());
  assert.deepEqual(intent(edited.state)!.value!.derivedMembers, original.value!.derivedMembers);
  const imported = mergeLedger(edited.state, [{ ...getMinute(edited.state, day, 602)!, revision: revision(5000),
    value: { ...getMinute(edited.state, day, 602)!.value!, text: 'Provider import', source: 'imported' } }]);
  assert.deepEqual(intent(imported), original);
  assert.equal(intent(imported, siblingId)!.value!.updatedAt, new Date(4000).toISOString(), 'remote imports do not promote sibling authority');
});

test('sibling ownership or outside membership changes prune its whole old claim without promoting the original event', () => {
  const partial = ungroupSelection(initial(), [point(601)], 2000);
  const siblingId = String(getMinute(partial.state, day, 602)!.value!.blockId);
  const regrouped = groupSelection(partial.state, [point(602)], { title: 'Different activity' }, [], 4000);
  assert.equal(intent(regrouped.state)!.value!.derivedMembers, undefined);
  assert.equal(intent(regrouped.state)!.value!.updatedAt, new Date(2000).toISOString());
  assert.deepEqual(intent(regrouped.state)!.value!.detachedMembers, intent(partial.state)!.value!.detachedMembers);
  const existing = getMinute(partial.state, day, 602)!.value!;
  const extended = applyDocumentValues(partial.state, [
    { key: minuteKey(day, 700), value: { ...existing, id: 'outside_member', dateKey: day, minuteIndex: 700 } },
    { key: cellFormatKey(day, 700), value: { kind: 'minuteFormat', format: { activityGroup: { id: siblingId, title: 'Coffee' } } } },
  ], 5000);
  assert.equal(intent(extended.state)!.value!.derivedMembers, undefined, 'an unmatched outside member revokes the whole sibling');
  assert.equal(intent(extended.state)!.value!.updatedAt, new Date(2000).toISOString());
  validateState(extended.state);
});
