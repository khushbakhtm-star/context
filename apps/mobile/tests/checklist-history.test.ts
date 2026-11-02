import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyChecklistFlow, applyChecklistChange } from '../src/utils/checklist-flow';
import { acknowledgeChecklistHistory, checklistHistoryTarget, emptyChecklistHistory, observeChecklistHistory,
  recordChecklistHistory } from '../src/utils/checklist-history';

const empty = emptyChecklistFlow();
const one = applyChecklistChange(empty, { type: 'add', item: { id: 'task_one', text: 'First', parentId: null, checked: false, format: {} } });
const two = applyChecklistChange(one, { type: 'edit', id: 'task_one', text: 'Second' });
const first = () => recordChecklistHistory(emptyChecklistHistory('main', null), 'main',
  { flow: empty, revision: null }, { flow: one, revision: 'own-1' });

test('Priority Undo and Redo target the complete original list including task structure and formatting', () => {
  const history = first();
  assert.deepEqual(checklistHistoryTarget(history, 'undo', 'main', 'own-1'), empty);
  const undone = acknowledgeChecklistHistory(history, 'undo', 'own-1', 'own-2');
  assert.equal(undone.undo.length, 0); assert.equal(undone.redo.length, 1);
  assert.deepEqual(checklistHistoryTarget(undone, 'redo', 'main', 'own-2'), one);
  const redone = acknowledgeChecklistHistory(undone, 'redo', 'own-2', 'own-3');
  assert.equal(redone.undo.length, 1); assert.equal(redone.redo.length, 0); assert.equal(redone.revision, 'own-3');
});

test('Priority history rejects a peer generation and another selected list before returning an Undo target', () => {
  const history = first();
  assert.throws(() => checklistHistoryTarget(history, 'undo', 'main', 'peer-2'), /changed/);
  assert.throws(() => checklistHistoryTarget(history, 'undo', 'other', 'own-1'), /changed/);
  assert.equal(history.revision, 'own-1'); assert.equal(history.undo.length, 1);
});

test('Priority peer refresh and list switching clear stale history instead of refreshing its write baseline', () => {
  const history = first();
  assert.equal(observeChecklistHistory(history, 'main', 'own-1'), history);
  assert.deepEqual(observeChecklistHistory(history, 'main', 'peer-2'), emptyChecklistHistory('main', 'peer-2'));
  assert.deepEqual(observeChecklistHistory(history, 'other', 'own-1'), emptyChecklistHistory('other', 'own-1'));
});

test('A failed or stale Priority acknowledgement does not consume the pending Undo entry', () => {
  const history = first();
  assert.throws(() => acknowledgeChecklistHistory(history, 'undo', 'peer-2', 'own-3'), /acknowledgement/);
  assert.throws(() => acknowledgeChecklistHistory(history, 'undo', 'own-1', null), /acknowledgement/);
  assert.equal(history.undo.length, 1); assert.equal(history.redo.length, 0);
});

test('A new Priority edit after Undo invalidates Redo and retains the new exact acknowledgement', () => {
  const undone = acknowledgeChecklistHistory(first(), 'undo', 'own-1', 'own-2');
  const next = recordChecklistHistory(undone, 'main', { flow: empty, revision: 'own-2' }, { flow: two, revision: 'own-3' });
  assert.equal(next.redo.length, 0); assert.equal(next.undo.length, 1);
  assert.equal(next.revision, 'own-3'); assert.deepEqual(checklistHistoryTarget(next, 'undo', 'main', 'own-3'), empty);
});

test('Priority history snapshots cannot be changed by later mutation of inputs or returned targets', () => {
  const mutable = structuredClone(one);
  const history = recordChecklistHistory(emptyChecklistHistory('main', null), 'main',
    { flow: empty, revision: null }, { flow: mutable, revision: 'own-1' });
  mutable.items[0]!.text = 'Changed outside history';
  const undone = acknowledgeChecklistHistory(history, 'undo', 'own-1', 'own-2');
  const target = checklistHistoryTarget(undone, 'redo', 'main', 'own-2');
  assert.equal(target.items[0]!.text, 'First'); target.items[0]!.text = 'Changed target';
  assert.equal(checklistHistoryTarget(undone, 'redo', 'main', 'own-2').items[0]!.text, 'First');
});

test('Priority edit history is bounded while preserving the newest complete edits', () => {
  let history = emptyChecklistHistory('main', null);
  let flow = empty; let revision: string | null = null;
  for (let index = 0; index < 40; index++) {
    const next = index ? applyChecklistChange(flow, { type: 'edit', id: 'task_one', text: `Edit ${index}` }) : one;
    history = recordChecklistHistory(history, 'main', { flow, revision }, { flow: next, revision: `own-${index}` });
    flow = next; revision = `own-${index}`;
  }
  assert.equal(history.undo.length, 24);
  assert.equal(checklistHistoryTarget(history, 'undo', 'main', revision).items[0]!.text, 'Edit 38');
});
