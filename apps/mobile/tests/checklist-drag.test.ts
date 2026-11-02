import assert from 'node:assert/strict';
import test from 'node:test';
import { checklistDragDestination, type ChecklistRowLayout } from '../src/utils/checklist-drag';
import { applyChecklistChange, readChecklistFlow } from '../src/utils/checklist-flow';

const flow = readChecklistFlow({ kind: 'checklistFlow', version: 1, items: [
  { id: 'first', text: 'First', checked: false, parentId: null, format: {} },
  { id: 'child', text: 'Child', checked: false, parentId: 'first', format: {} },
  { id: 'second', text: 'Second', checked: false, parentId: null, format: {} },
  { id: 'third', text: 'Third', checked: true, parentId: null, format: {} },
] });
const layouts = new Map<string, ChecklistRowLayout>([
  ['first', { y: 0, height: 60 }], ['child', { y: 60, height: 140 }],
  ['second', { y: 200, height: 80 }], ['third', { y: 280, height: 60 }],
]);
const visible = new Set(layouts.keys());

test('dragging a parent below a variable-height sibling moves its complete subtree', () => {
  const destination = checklistDragDestination(flow, 'first', layouts, visible, 270)!;
  assert.deepEqual(destination, { parentId: null, beforeId: 'third' });
  const moved = applyChecklistChange(flow, { type: 'move', id: 'first', ...destination });
  assert.deepEqual(moved.items.map(({ id }) => id), ['second', 'first', 'child', 'third']);
  assert.equal(moved.items[2]!.parentId, 'first');
});

test('dragging up targets a sibling boundary rather than an intervening child', () => {
  const destination = checklistDragDestination(flow, 'third', layouts, visible, 80)!;
  assert.deepEqual(destination, { parentId: null, beforeId: 'second' });
  const moved = applyChecklistChange(flow, { type: 'move', id: 'third', ...destination });
  assert.deepEqual(moved.items.map(({ id }) => id), ['first', 'child', 'third', 'second']);
});

test('a hidden completed task and stale hidden layout do not become a visible drop target', () => {
  const visibleWithoutThird = new Set(['first', 'child', 'second']);
  assert.deepEqual(checklistDragDestination(flow, 'first', layouts, visibleWithoutThird, 270), { parentId: null, beforeId: null });
});

test('a subtask remains nested when dragged over another parent', () => {
  assert.deepEqual(checklistDragDestination(flow, 'child', layouts, visible, 900), { parentId: 'first', beforeId: null });
});

test('missing source and invalid coordinates cancel instead of moving a different task', () => {
  assert.equal(checklistDragDestination(flow, 'deleted', layouts, visible, 30), null);
  assert.equal(checklistDragDestination(flow, 'first', layouts, visible, Number.NaN), null);
});

test('unmeasured rows are skipped and a drop above the first sibling reaches the list start', () => {
  const incomplete = new Map(layouts); incomplete.delete('second');
  assert.deepEqual(checklistDragDestination(flow, 'third', incomplete, visible, -30), { parentId: null, beforeId: 'first' });
});
