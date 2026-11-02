import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChecklistListChange, checklistListFlow, checklistListSummaries,
  createChecklistListInCollection, emptyChecklistCollection, readChecklistCollection,
  readChecklistFlow, renameChecklistListInCollection, replaceChecklistListInCollection,
  type ChecklistTask } from '../src/utils/checklist-flow';
import { decryptBatch, encryptBatch, mergeDocuments } from '../src/sync/codec';

const task = (id: string, text = id, parentId: string | null = null): ChecklistTask =>
  ({ id, text, parentId, checked: false, format: {} });
const collection = (...lists: { id: string; name: string; items: ChecklistTask[] }[]) =>
  readChecklistCollection({ kind: 'checklistFlow', version: 2, lists });
const sample = () => collection({ id: 'main', name: 'Priority', items: [task('a'), task('child', 'Call mum', 'a')] },
  { id: 'work', name: 'Work', items: [task('b', 'Review proposal')] });

test('an absent collection has one stable Priority list and V1 migrates without mutating source snapshots', () => {
  assert.deepEqual(readChecklistCollection(null), emptyChecklistCollection());
  const original = { kind: 'checklistFlow', version: 1, items: [{ ...task('a'), checked: true,
    format: { bold: true, textColor: '#aabbcc' }, source: { ranges: [{ dateKey: '2026-11-02', startMinute: 500, endMinute: 500 }],
      selection: { start: 2, end: 7 } } }, task('child', 'Nested', 'a')] };
  const before = structuredClone(original); const migrated = readChecklistCollection(original);
  assert.equal(migrated.version, 2); assert.equal(migrated.lists[0]!.id, 'main');
  assert.equal(migrated.lists[0]!.name, 'Priority');
  assert.deepEqual(checklistListFlow(migrated).items, readChecklistFlow(original).items);
  migrated.lists[0]!.items[0]!.source!.ranges[0]!.startMinute = 501;
  assert.deepEqual(original, before);
});

test('V1 clients reject the entire V2 document instead of discarding unseen lists', () => {
  assert.throws(() => readChecklistFlow(sample()), /invalid/);
  assert.throws(() => readChecklistCollection({ ...sample(), version: 3 }), /invalid/);
  assert.throws(() => readChecklistCollection({ ...sample(), future: true }), /invalid/);
});

test('creating and renaming lists preserves stable identities, task order, and every other list', () => {
  const original = sample(); const before = structuredClone(original);
  const created = createChecklistListInCollection(original, 'family', '  Family  ');
  assert.deepEqual(created.lists.slice(0, 2), original.lists);
  assert.deepEqual(created.lists[2], { id: 'family', name: 'Family', items: [] });
  const renamed = renameChecklistListInCollection(created, 'work', 'Projects');
  assert.equal(renamed.lists[1]!.id, 'work'); assert.equal(renamed.lists[1]!.name, 'Projects');
  assert.deepEqual(renamed.lists[1]!.items, original.lists[1]!.items);
  assert.deepEqual(renamed.lists.filter((list) => list.id !== 'work'), created.lists.filter((list) => list.id !== 'work'));
  assert.deepEqual(original, before);
});

test('list names and identities are bounded, while duplicate display names remain separate lists', () => {
  assert.equal(createChecklistListInCollection(sample(), 'other', 'Work').lists.length, 3);
  for (const name of ['', ' ', 'x'.repeat(81), 'Line\nBreak', 'Bad\u0000name'])
    assert.throws(() => renameChecklistListInCollection(sample(), 'work', name), /name/);
  for (const id of ['work', '', 'with/slash']) assert.throws(() => createChecklistListInCollection(sample(), id, 'New'), /identity/);
  const maximum = collection(...Array.from({ length: 100 }, (_, i) => ({ id: i ? `list_${i}` : 'main', name: `List ${i}`, items: [] })));
  assert.throws(() => createChecklistListInCollection(maximum, 'overflow', 'Too many'), /100/);
});

test('malformed list collections and missing default identity fail closed', () => {
  for (const value of [[], {}, { kind: 'checklistFlow', version: 2, lists: [] },
    { kind: 'checklistFlow', version: 2, lists: [{ id: 'other', name: 'Other', items: [] }] },
    { kind: 'checklistFlow', version: 2, lists: [{ id: 'main', name: 'One', items: [] }, { id: 'main', name: 'Two', items: [] }] },
    { kind: 'checklistFlow', version: 2, lists: [{ id: 'main', name: 'One', items: [], unknown: 1 }] }])
    assert.throws(() => readChecklistCollection(value), /invalid/);
});

test('task identities are unique across lists and parents cannot cross checklist boundaries', () => {
  assert.throws(() => collection({ id: 'main', name: 'One', items: [task('same')] },
    { id: 'other', name: 'Two', items: [task('same')] }), /invalid/);
  assert.throws(() => collection({ id: 'main', name: 'One', items: [task('parent')] },
    { id: 'other', name: 'Two', items: [task('child', 'Child', 'parent')] }), /invalid/);
  const original = sample();
  assert.throws(() => applyChecklistListChange(original, 'work', { type: 'delete', id: 'a' }), /changed or was deleted/);
  assert.throws(() => applyChecklistListChange(original, 'work', { type: 'add', item: task('a') }), /invalid/);
  assert.deepEqual(original, sample());
});

test('selected-list checking, nested reset, formatting and subtree moves preserve other lists exactly', () => {
  const original = sample();
  let edited = applyChecklistListChange(original, 'main', { type: 'check', id: 'a', checked: true });
  assert.ok(edited.lists[0]!.items.every((item) => item.checked));
  edited = applyChecklistListChange(edited, 'main', { type: 'reset' });
  edited = applyChecklistListChange(edited, 'main', { type: 'edit', id: 'child', format: { underline: true } });
  edited = applyChecklistListChange(edited, 'main', { type: 'add', item: task('next') });
  edited = applyChecklistListChange(edited, 'main', { type: 'moveRelative', id: 'a', direction: 'down' });
  assert.deepEqual(edited.lists[0]!.items.map((item) => item.id), ['next', 'a', 'child']);
  assert.deepEqual(edited.lists[1], original.lists[1]); assert.deepEqual(original, sample());
});

test('Undo replaces only its captured list and rejects duplicate task identities from a different list', () => {
  const original = sample(); const before = checklistListFlow(original, 'main');
  const edited = applyChecklistListChange(original, 'main', { type: 'delete', id: 'a' });
  const restored = replaceChecklistListInCollection(edited, 'main', before);
  assert.deepEqual(restored, original);
  assert.throws(() => replaceChecklistListInCollection(original, 'main', checklistListFlow(original, 'work')), /invalid/);
  assert.throws(() => replaceChecklistListInCollection(original, 'main', original as unknown as ReturnType<typeof checklistListFlow>), /invalid/);
});

test('unknown list IDs never fall back to the default list for reads, writes, rename or history', () => {
  const original = sample(); const before = structuredClone(original);
  for (const operation of [() => checklistListFlow(original, 'missing'),
    () => applyChecklistListChange(original, 'missing', { type: 'reset' }),
    () => renameChecklistListInCollection(original, 'missing', 'New'),
    () => replaceChecklistListInCollection(original, 'missing', checklistListFlow(original))])
    assert.throws(operation, /no longer available/);
  assert.deepEqual(original, before);
  assert.deepEqual(checklistListSummaries(original), [{ id: 'main', name: 'Priority', taskCount: 2 }, { id: 'work', name: 'Work', taskCount: 1 }]);
});

test('the 1,000-task and text limits bound the whole collection rather than each list separately', () => {
  const lists = [{ id: 'main', name: 'One', items: Array.from({ length: 500 }, (_, i) => task(`a_${i}`)) },
    { id: 'other', name: 'Two', items: Array.from({ length: 500 }, (_, i) => task(`b_${i}`)) }];
  const maximum = collection(...lists); assert.equal(maximum.lists.length, 2);
  assert.throws(() => applyChecklistListChange(maximum, 'other', { type: 'add', item: task('overflow') }), /1000/);
  const textLists = [{ id: 'main', name: 'One', items: Array.from({ length: 3 }, (_, i) => task(`a_${i}`, 'x'.repeat(50_000))) },
    { id: 'other', name: 'Two', items: Array.from({ length: 2 }, (_, i) => task(`b_${i}`, 'x'.repeat(50_000))) }];
  collection(...textLists);
  textLists[1]!.items.push(task('overflow', 'x'));
  assert.throws(() => collection(...textLists), /too much text/);
});

test('the complete aggregate UTF-8 payload includes every list and minute-source reference', () => {
  const ranges = Array.from({ length: 31 }, () => ({ dateKey: '2026-11-02', startMinute: 0, endMinute: 1439 }));
  const make = (prefix: string) => Array.from({ length: 300 }, (_, i) => ({ ...task(`${prefix}_${i}`), source: { ranges } }));
  const first = make('a'); const second = make('b');
  readChecklistFlow({ kind: 'checklistFlow', version: 1, items: first });
  readChecklistFlow({ kind: 'checklistFlow', version: 1, items: second });
  assert.throws(() => collection({ id: 'main', name: 'One', items: first }, { id: 'other', name: 'Two', items: second }), /too large to synchronize/);
});

test('multiple lists survive encrypted transport and last-write-wins keeps the whole winning collection', async () => {
  const original = sample(); const updated = renameChecklistListInCollection(original, 'work', 'Projects');
  const key = 'category:checklistFlow:main';
  const earlier = { key, revision: '0000000000000001:00000000:collection_tests', value: original as unknown as Record<string, unknown> };
  const latest = { key, revision: '0000000000000002:00000000:collection_tests', value: updated as unknown as Record<string, unknown> };
  const envelope = await encryptBatch({ version: 1, id: 'collection_transport', documents: [latest] }, 'synthetic-collection-passphrase');
  const decoded = await decryptBatch(envelope, 'synthetic-collection-passphrase');
  assert.deepEqual(readChecklistCollection(decoded.documents[0]!.value), updated);
  const merged = mergeDocuments([earlier], decoded.documents);
  assert.deepEqual(readChecklistCollection(merged[0]!.value), updated);
});
