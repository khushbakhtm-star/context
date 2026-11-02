import test from 'node:test';
import assert from 'node:assert/strict';
import { searchDateKeys, searchPriorityLists } from '../src/utils/search-scope';
import { checklistRows, type ChecklistTask } from '../src/utils/checklist-flow';

const task = (id: string, text: string, checked = false, parentId: string | null = null): ChecklistTask =>
  ({ id, text, checked, parentId, format: {} });
const lists = () => [
  { id: 'main', name: 'Priority', items: [task('a', 'Call Mum'), task('done', 'Call dentist', true), task('blank', ' \n ')] },
  { id: 'work', name: 'Work projects', items: [task('b', 'Write proposal')] },
];

test('search dates sort and deduplicate without modifying the displayed date selection', () => {
  const dates = ['2026-11-02', '2024-02-29', '2026-11-02']; const before = [...dates];
  assert.deepEqual(searchDateKeys(dates), ['2024-02-29', '2026-11-02']);
  assert.deepEqual(dates, before); assert.deepEqual(searchDateKeys([]), []);
});

test('search dates reject malformed, impossible, non-date and excessive selections instead of becoming global', () => {
  for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-11-00',
    '2026-11-02T00:00:00Z', '11/02/2026', '2026-1-02', ' 2026-11-02', '', "2026-11-02') OR 1=1 --"])
    assert.throws(() => searchDateKeys([value]), /dates changed/);
  assert.throws(() => searchDateKeys(Array.from({ length: 367 }, () => '2026-11-02')), /one year/);
  assert.throws(() => searchDateKeys(null as unknown as string[]), /one year/);
  const leapYear = Array.from({ length: 366 }, (_, i) => new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10));
  assert.equal(searchDateKeys(leapYear).length, 366);
});

test('global Priority search includes every list and completed rows but omits empty rows', () => {
  const original = lists(); const before = structuredClone(original);
  assert.deepEqual(searchPriorityLists(original, '').map((hit) => [hit.listId, hit.task.id]),
    [['main', 'a'], ['main', 'done'], ['work', 'b']]);
  assert.deepEqual(searchPriorityLists(original, '  CALL ').map((hit) => hit.task.id), ['a', 'done']);
  assert.deepEqual(searchPriorityLists(original, 'work').map((hit) => hit.task.id), ['b']);
  assert.deepEqual(original, before);
});

test('current Priority scope limits search to the selected list and its completion visibility', () => {
  assert.deepEqual(searchPriorityLists(lists(), 'call', { kind: 'priority', listId: 'main', hideCompleted: true }).map((hit) => hit.task.id), ['a']);
  assert.deepEqual(searchPriorityLists(lists(), 'call', { kind: 'priority', listId: 'main', hideCompleted: false }).map((hit) => hit.task.id), ['a', 'done']);
  assert.deepEqual(searchPriorityLists(lists(), 'work', { kind: 'priority', listId: 'work' }), [], 'scoped search matches row text, not the list title');
  assert.throws(() => searchPriorityLists(lists(), '', { kind: 'priority', listId: 'deleted' }), /checklist changed/);
});

test('current Priority search hides descendants hidden by a completed ancestor, just like the visible list', () => {
  const items = [task('parent', 'Finished project', true), task('child', 'Child imported unchecked', false, 'parent'), task('visible', 'Visible task')];
  // The transport decoder accepts independent checked states; the current view
  // hides a completed parent and all descendants even with a legacy mixed state.
  const visible = checklistRows({ kind: 'checklistFlow', version: 1, items }, true).map((row) => row.task.id);
  assert.deepEqual(searchPriorityLists([{ id: 'main', name: 'Priority', items }], '',
    { kind: 'priority', listId: 'main', hideCompleted: true }).map((hit) => hit.task.id), visible);
});

test('Priority matching treats markup and punctuation as literal text and returns stable task identities', () => {
  const items = [task('literal', '<b>100%_done</b>'), task('other', 'ordinary text')];
  const hits = searchPriorityLists([{ id: 'custom', name: 'Personal', items }], '%_');
  assert.equal(hits.length, 1); assert.deepEqual(hits[0]!.task, items[0]);
  assert.equal(hits[0]!.listId, 'custom'); assert.equal(hits[0]!.listName, 'Personal');
  assert.equal(searchPriorityLists([{ id: 'custom', name: 'Personal', items }], '<b>')[0]!.task.text, '<b>100%_done</b>');
});
