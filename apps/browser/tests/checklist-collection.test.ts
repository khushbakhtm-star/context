import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKLIST_FLOW_KEY, readChecklistCollection, type ChecklistTask } from '../shared/utils/checklist-flow';
import { browserChecklist, browserChecklistVersions, changeBrowserChecklist, createBrowserChecklistList, moveBrowserChecklistTask,
  renameBrowserChecklistList, replaceBrowserChecklistList, restoreBrowserChecklist } from '../src/checklist-flow';
import { emptyLedger, mergeLedger, undoEdit } from '../src/ledger';

const item = (id: string, text = id): ChecklistTask => ({ id, text, checked: false, parentId: null, format: {} });
const revision = (wall: number) => `${String(wall).padStart(16, '0')}:00000000:priority_browser`;
const v1 = { kind: 'checklistFlow', version: 1, items: [item('a')] };

test('browser V1 reads and no-op reset never rewrite the document until an actual edit', () => {
  const initial = mergeLedger(emptyLedger('priority_browser'), [{ key: CHECKLIST_FLOW_KEY, revision: revision(1), value: v1 }]);
  const before = structuredClone(initial); const read = browserChecklist(initial);
  assert.equal(read.collection.version, 2); assert.equal(read.listId, 'main'); assert.equal(read.lists[0]!.name, 'Priority');
  const noOp = changeBrowserChecklist(initial, read.revision, { type: 'reset' }, 100);
  assert.deepEqual(noOp.state, before); assert.deepEqual(noOp.undo.after, []);
  const edited = changeBrowserChecklist(initial, read.revision, { type: 'check', id: 'a', checked: true }, 101);
  assert.equal(edited.state.documents.find((doc) => doc.key === CHECKLIST_FLOW_KEY)!.value!.version, 2);
  assert.equal(browserChecklist(edited.state).flow.items[0]!.checked, true); assert.deepEqual(initial, before);
});

test('browser creation, rename and selected-list edits preserve every other list in the single atomic document', () => {
  let state = changeBrowserChecklist(emptyLedger('priority_browser'), undefined, { type: 'add', item: item('a') }, 10).state;
  state = createBrowserChecklistList(state, browserChecklist(state).revision, 'work', 'Work', 11).state;
  const main = structuredClone(browserChecklist(state).flow);
  state = changeBrowserChecklist(state, browserChecklist(state).revision, { type: 'add', item: item('b', 'Proposal') }, 12, 'work').state;
  state = renameBrowserChecklistList(state, browserChecklist(state).revision, 'work', 'Projects', 13).state;
  assert.deepEqual(browserChecklist(state).flow, main);
  assert.equal(browserChecklist(state, 'work').flow.items[0]!.text, 'Proposal');
  assert.deepEqual(browserChecklist(state).lists, [{ id: 'main', name: 'Priority', taskCount: 1 }, { id: 'work', name: 'Projects', taskCount: 1 }]);
  assert.deepEqual(state.documents.map((doc) => doc.key), [CHECKLIST_FLOW_KEY]);
});

test('browser selected-list Undo uses the exact whole revision and preserves other lists', () => {
  let state = changeBrowserChecklist(emptyLedger('priority_browser'), undefined, { type: 'add', item: item('a') }, 10).state;
  state = createBrowserChecklistList(state, browserChecklist(state).revision, 'work', 'Work', 11).state;
  const captured = browserChecklist(state, 'work');
  state = changeBrowserChecklist(state, captured.revision, { type: 'add', item: item('b') }, 12, 'work').state;
  const own = browserChecklist(state, 'work'); const mainBefore = browserChecklist(state).flow;
  const undone = replaceBrowserChecklistList(state, own.revision, 'work', captured.flow, 13).state;
  assert.deepEqual(browserChecklist(undone, 'work').flow, captured.flow);
  assert.deepEqual(browserChecklist(undone).flow, mainBefore);
  const peer = changeBrowserChecklist(state, own.revision, { type: 'edit', id: 'a', text: 'Changed elsewhere' }, 14).state;
  const before = structuredClone(peer);
  assert.throws(() => replaceBrowserChecklistList(peer, own.revision, 'work', captured.flow, 15), /changed/);
  assert.deepEqual(peer, before);
});

test('moving a browser task keeps its subtasks and Undo restores both checklists', () => {
  let state = changeBrowserChecklist(emptyLedger('priority_browser'), undefined, { type: 'add', item: item('a') }, 10).state;
  state = changeBrowserChecklist(state, browserChecklist(state).revision,
    { type: 'add', item: { ...item('child'), parentId: 'a', format: { bold: true } } }, 11).state;
  state = createBrowserChecklistList(state, browserChecklist(state).revision, 'work', 'Work', 12).state;
  const before = browserChecklist(state);
  assert.throws(() => moveBrowserChecklistTask(state, undefined, 'main', 'a', 'work', 13), /changed/);
  const moved = moveBrowserChecklistTask(state, before.revision, 'main', 'a', 'work', 13);
  assert.equal(browserChecklist(moved.state).flow.items.length, 0);
  assert.deepEqual(browserChecklist(moved.state, 'work').flow.items, before.flow.items);
  const undone = undoEdit(moved.state, moved.undo, 14);
  assert.deepEqual(browserChecklist(undone).collection, before.collection);
});

test('foreign list and task identities never retarget or damage another browser list', () => {
  let state = changeBrowserChecklist(emptyLedger('priority_browser'), undefined, { type: 'add', item: item('a') }, 10).state;
  state = createBrowserChecklistList(state, browserChecklist(state).revision, 'work', 'Work', 11).state;
  const before = structuredClone(state); const expected = browserChecklist(state).revision;
  assert.throws(() => browserChecklist(state, 'missing'), /no longer available/);
  assert.throws(() => changeBrowserChecklist(state, expected, { type: 'reset' }, 12, 'missing'), /no longer available/);
  assert.throws(() => changeBrowserChecklist(state, expected, { type: 'delete', id: 'a' }, 12, 'work'), /changed or was deleted/);
  assert.throws(() => renameBrowserChecklistList(state, expected, 'missing', 'Wrong', 12), /no longer available/);
  assert.throws(() => createBrowserChecklistList(state, expected, 'work', 'Duplicate', 12), /identity/);
  assert.deepEqual(state, before);
});

test('a losing browser version contains every list, and recovery restores that exact collection with CAS', () => {
  let state = changeBrowserChecklist(emptyLedger('priority_browser'), undefined, { type: 'add', item: item('a') }, 10).state;
  state = createBrowserChecklistList(state, browserChecklist(state).revision, 'work', 'Work', 11).state;
  state = changeBrowserChecklist(state, browserChecklist(state).revision, { type: 'add', item: item('b') }, 12, 'work').state;
  const before = browserChecklist(state).collection;
  const remote = readChecklistCollection(before); remote.lists[1]!.name = 'Renamed remotely';
  const merged = mergeLedger(state, [{ key: CHECKLIST_FLOW_KEY, revision: revision(100), value: remote as unknown as Record<string, unknown> }]);
  const versions = browserChecklistVersions(merged, 'work');
  assert.equal(versions.length, 1); assert.deepEqual(versions[0]!.collection, before);
  assert.equal(versions[0]!.listId, 'work'); assert.equal(versions[0]!.flow.items[0]!.id, 'b');
  assert.throws(() => restoreBrowserChecklist(merged, browserChecklist(state).revision, versions[0]!.collection, 101), /changed/);
  const restored = restoreBrowserChecklist(merged, browserChecklist(merged).revision, versions[0]!.collection, 101).state;
  assert.deepEqual(browserChecklist(restored).collection, before);
  assert.equal(browserChecklistVersions(merged, 'missing')[0]!.listId, 'main');
});

test('future or malformed browser collections remain stored and cannot be edited as an empty checklist', () => {
  const future = { kind: 'checklistFlow', version: 3, lists: [] };
  const state = mergeLedger(emptyLedger('priority_browser'), [{ key: CHECKLIST_FLOW_KEY, revision: revision(1), value: future }]);
  const before = structuredClone(state);
  assert.throws(() => browserChecklist(state), /invalid/);
  assert.throws(() => changeBrowserChecklist(state, revision(1), { type: 'reset' }), /invalid/);
  assert.deepEqual(state, before);
});

test('explicit browser recovery can replace an invalid current generation only with its exact revision', () => {
  const original = mergeLedger(emptyLedger('priority_browser'), [{ key: CHECKLIST_FLOW_KEY, revision: revision(1), value: v1 }]);
  const state = mergeLedger(original, [{ key: CHECKLIST_FLOW_KEY, revision: revision(2), value: { kind: 'checklistFlow', version: 99, lists: [] } }]);
  const versions = browserChecklistVersions(state); assert.equal(versions.length, 1);
  assert.throws(() => restoreBrowserChecklist(state, revision(1), versions[0]!.collection, 100), /changed/);
  const restored = restoreBrowserChecklist(state, revision(2), versions[0]!.collection, 100).state;
  assert.deepEqual(browserChecklist(restored).flow.items, v1.items);
});
