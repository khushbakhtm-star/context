import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChecklistChange, checklistRows, checklistSubtreeIds, CHECKLIST_FLOW_KEY, emptyChecklistFlow,
  readChecklistFlow, MAX_CHECKLIST_DEPTH, type ChecklistFlow, type ChecklistTask } from '../src/utils/checklist-flow';
import { decryptBatch, encryptBatch, mergeDocuments, validateBatch } from '../src/sync/codec';

const item = (id: string, parentId: string | null = null, text = id): ChecklistTask => ({ id, text, parentId, checked: false, format: {} });
const flow = (...items: ChecklistTask[]): ChecklistFlow => readChecklistFlow({ kind: 'checklistFlow', version: 1, items });
const ids = (value: ChecklistFlow) => value.items.map((task) => task.id);
const revision = (wall: number) => `${String(wall).padStart(16, '0')}:00000000:checklist_tests`;

test('the complete checklist including many minute references stays below one atomic encrypted-upload payload', () => {
  const ranges = Array.from({ length: 31 }, () => ({ dateKey: '2026-11-02', startMinute: 0, endMinute: 1439 }));
  const items = Array.from({ length: 1000 }, (_, index) => ({ ...item(`task_${index}`), source: { ranges } }));
  assert.throws(() => readChecklistFlow({ kind: 'checklistFlow', version: 1, items }), /too large to synchronize/);
  const ordinary = flow(...items.slice(0, 4));
  assert.equal(ordinary.items.length, 4);
  assert.equal(readChecklistFlow(ordinary).items[0]!.source!.ranges.length, 31);
});

test('checklist operations preserve original minute snapshots and format plain text without interpreting HTML', () => {
  const source = { ranges: [{ dateKey: '2026-11-02', startMinute: 10, endMinute: 10 }], selection: { start: 2, end: 15 } };
  const initial = emptyChecklistFlow();
  const added = applyChecklistChange(initial, { type: 'add', item: { ...item('task_first', null, '<img src=x> selected words'), source } });
  assert.deepEqual(initial, emptyChecklistFlow());
  const updated = applyChecklistChange(added, { type: 'edit', id: 'task_first', text: 'Call Mum', format: { bold: true, italic: true, underline: true, textColor: '#a1b2c3' } });
  assert.equal(updated.items[0]!.text, 'Call Mum');
  assert.equal(updated.items[0]!.format.textColor, '#A1B2C3');
  assert.deepEqual(updated.items[0]!.source, source);
  assert.equal(added.items[0]!.text, '<img src=x> selected words');
});

test('moving or reparenting a task carries every nested descendant as one contiguous block', () => {
  const initial = flow(item('a'), item('a1', 'a'), item('a11', 'a1'), item('b'), item('c'));
  const moved = applyChecklistChange(initial, { type: 'moveRelative', id: 'a', direction: 'down' });
  assert.deepEqual(ids(moved), ['b', 'a', 'a1', 'a11', 'c']);
  assert.deepEqual(checklistSubtreeIds(moved, 'a'), ['a', 'a1', 'a11']);
  const nested = applyChecklistChange(moved, { type: 'move', id: 'a', parentId: 'c' });
  assert.deepEqual(ids(nested), ['b', 'c', 'a', 'a1', 'a11']);
  assert.deepEqual(checklistRows(nested).map((row) => row.depth), [0, 0, 1, 2, 3]);
  assert.deepEqual(ids(initial), ['a', 'a1', 'a11', 'b', 'c']);
});

test('drag-before, indent, and outdent retain sibling priority order and reject subtree cycles', () => {
  const initial = flow(item('a'), item('b'), item('b1', 'b'), item('c'));
  const moved = applyChecklistChange(initial, { type: 'move', id: 'c', parentId: null, beforeId: 'a' });
  assert.deepEqual(ids(moved), ['c', 'a', 'b', 'b1']);
  const nested = applyChecklistChange(initial, { type: 'indent', id: 'b' });
  assert.deepEqual(checklistRows(nested).map((row) => row.depth), [0, 1, 2, 0]);
  const restored = applyChecklistChange(nested, { type: 'outdent', id: 'b' });
  assert.deepEqual(restored, initial);
  assert.throws(() => applyChecklistChange(initial, { type: 'move', id: 'b', parentId: 'b1' }), /inside itself/);
  assert.throws(() => applyChecklistChange(initial, { type: 'move', id: 'a', parentId: null, beforeId: 'b1' }), /nesting level/);
  assert.throws(() => applyChecklistChange(initial, { type: 'move', id: 'b', parentId: null, beforeId: 'b1' }), /outside/);
});

test('completing a parent completes its descendants, hidden rows disappear together, reset removes all checks only', () => {
  const initial = flow(item('a'), { ...item('a1', 'a'), format: { bold: true } }, item('a11', 'a1'), item('b'));
  const completed = applyChecklistChange(initial, { type: 'check', id: 'a', checked: true });
  assert.deepEqual(completed.items.map((task) => task.checked), [true, true, true, false]);
  assert.deepEqual(checklistRows(completed, true).map((row) => row.task.id), ['b']);
  const reopened = applyChecklistChange(completed, { type: 'check', id: 'a11', checked: false });
  assert.deepEqual(reopened.items.map((task) => task.checked), [false, false, false, false]);
  const reset = applyChecklistChange(completed, { type: 'reset' });
  assert.deepEqual(reset, initial);
  assert.equal(checklistRows(completed, false).length, 4);
});

test('adding or moving an unfinished subtask reopens a completed parent, deleting a parent deletes exactly its subtree', () => {
  const initial = flow({ ...item('a'), checked: true }, item('b'), item('b1', 'b'), item('c'));
  const added = applyChecklistChange(initial, { type: 'add', item: item('new_child', 'a') });
  assert.equal(added.items[0]!.checked, false);
  assert.deepEqual(ids(added), ['a', 'new_child', 'b', 'b1', 'c']);
  const removed = applyChecklistChange(added, { type: 'delete', id: 'b' });
  assert.deepEqual(ids(removed), ['a', 'new_child', 'c']);
  const moved = applyChecklistChange(initial, { type: 'move', id: 'b', parentId: 'a' });
  assert.equal(moved.items[0]!.checked, false);
});

test('deleting an erased row promotes only its direct subtasks without changing their order or content', () => {
  const source = { ranges: [{ dateKey: '2026-11-02', startMinute: 22, endMinute: 25 }] };
  const initial = flow(item('a'), item('before', 'a'), item('erase', 'a'),
    { ...item('first', 'erase'), checked: true, format: { bold: true }, source },
    item('nested', 'first'), item('second', 'erase'), item('after', 'a'), item('b'));
  const deleted = applyChecklistChange(initial, { type: 'deleteRow', id: 'erase' });
  assert.deepEqual(ids(deleted), ['a', 'before', 'first', 'nested', 'second', 'after', 'b']);
  assert.deepEqual(deleted.items[2], { ...initial.items[3], parentId: 'a' });
  assert.deepEqual(deleted.items[3], initial.items[4]);
  assert.equal(deleted.items[4]!.parentId, 'a');
  assert.equal(initial.items[3]!.parentId, 'erase');

  const promoted = applyChecklistChange(deleted, { type: 'deleteRow', id: 'a' });
  assert.deepEqual(checklistRows(promoted).map(({ depth }) => depth), [0, 0, 1, 0, 0, 0]);
  assert.deepEqual(ids(applyChecklistChange(promoted, { type: 'deleteRow', id: 'b' })), ['before', 'first', 'nested', 'second', 'after']);
  assert.throws(() => applyChecklistChange(deleted, { type: 'deleteRow', id: 'erase' }), /changed or was deleted/);
  assert.deepEqual(ids(applyChecklistChange(initial, { type: 'delete', id: 'erase' })), ['a', 'before', 'after', 'b']);
});

test('blank editable rows and boundary moves are stable; adding after a sibling skips its whole subtree', () => {
  const initial = flow(item('a'), item('a1', 'a'), item('b'));
  const added = applyChecklistChange(initial, { type: 'add', item: item('new_row', null, ''), afterId: 'a' });
  assert.deepEqual(ids(added), ['a', 'a1', 'new_row', 'b']);
  assert.deepEqual(applyChecklistChange(initial, { type: 'moveRelative', id: 'a', direction: 'up' }), initial);
  assert.deepEqual(applyChecklistChange(initial, { type: 'moveRelative', id: 'b', direction: 'down' }), initial);
  assert.deepEqual(applyChecklistChange(initial, { type: 'outdent', id: 'a' }), initial);
  assert.throws(() => applyChecklistChange(initial, { type: 'add', item: item('a') }), /already exists/);
});

test('malformed, duplicate, orphaned, noncontiguous, unsafe style and invalid minute-source metadata fail closed', () => {
  for (const bad of [
    { kind: 'checklistFlow', version: 2, items: [] },
    { kind: 'checklistFlow', version: 1, items: [item('x'), item('x')] },
    { kind: 'checklistFlow', version: 1, items: [item('x', 'missing')] },
    { kind: 'checklistFlow', version: 1, items: [item('a'), item('b'), item('a1', 'a')] },
    { kind: 'checklistFlow', version: 1, items: [{ ...item('a'), format: { textColor: 'url(javascript:x)' } }] },
    { kind: 'checklistFlow', version: 1, items: [{ ...item('a'), source: { ranges: [{ dateKey: '2026-02-30', startMinute: 0, endMinute: 10 }] } }] },
    { kind: 'checklistFlow', version: 1, items: [{ ...item('a'), source: { ranges: [{ dateKey: '2026-11-02', startMinute: 10, endMinute: 9 }] } }] },
    { kind: 'checklistFlow', version: 1, items: [{ ...item('a'), source: { ranges: [{ dateKey: '2026-11-02', startMinute: 10, endMinute: 10 }], selection: { start: 10, end: 1 } } }] },
    { kind: 'checklistFlow', version: 1, items: [{ ...item('a'), text: 4 }] },
  ]) assert.throws(() => readChecklistFlow(bad));
  assert.deepEqual(readChecklistFlow(null), emptyChecklistFlow());
});

test('list/text/depth bounds reject excessive input before any original list changes', () => {
  assert.throws(() => flow(...Array.from({ length: 1001 }, (_, index) => item(`task_${index}`))));
  assert.throws(() => flow(item('oversize', null, 'x'.repeat(50001))));
  assert.throws(() => flow(...Array.from({ length: 6 }, (_, index) => item(`task_${index}`, null, 'x'.repeat(50000)))));
  const nested = flow(...Array.from({ length: MAX_CHECKLIST_DEPTH }, (_, index) => item(`depth_${index}`, index ? `depth_${index - 1}` : null)));
  const before = JSON.stringify(nested);
  assert.throws(() => applyChecklistChange(nested, { type: 'add', item: item('too_deep', `depth_${MAX_CHECKLIST_DEPTH - 1}`) }), /nested/);
  assert.equal(JSON.stringify(nested), before);
});

test('existing category-compatible encrypted transport retains hierarchy, styles, checked state and source snapshots', async () => {
  const original = flow(item('parent'), { ...item('child', 'parent'), checked: true, format: { underline: true, textColor: '#123456' },
    source: { ranges: [{ dateKey: '2026-11-02', startMinute: 22, endMinute: 25 }] } });
  const document = { key: CHECKLIST_FLOW_KEY, revision: revision(1), value: original };
  const batch = validateBatch({ version: 1, id: 'checklist_roundtrip', documents: [document] });
  const passphrase = 'checklist synthetic test passphrase';
  const encrypted = await encryptBatch(batch, passphrase);
  const decoded = await decryptBatch(encrypted, passphrase);
  assert.deepEqual(readChecklistFlow(decoded.documents[0]!.value), original);
  const later = { ...document, revision: revision(2), value: applyChecklistChange(original, { type: 'reset' }) };
  assert.deepEqual(mergeDocuments([document], [later]), [later]);
  // Top-level category identity/name/color are deliberately absent.
  assert.equal('id' in original || 'name' in original || 'color' in original, false);
});
