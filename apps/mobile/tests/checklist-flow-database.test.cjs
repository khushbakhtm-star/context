const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');

// Actual app persistence, schema, SQL, journal and transaction queue against
// SQLite. Expo's platform transports alone are replaced.
function repository(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  const hooks = { afterCommit: null };
  const native = {
    async execAsync(sql) { sqlite.exec(sql); },
    async runAsync(sql, ...values) { const result = sqlite.prepare(sql).run(...values); return { changes: result.changes, lastInsertRowId: result.lastInsertRowid }; },
    async getFirstAsync(sql, ...values) { return sqlite.prepare(sql).get(...values) ?? null; },
    async getAllAsync(sql, ...values) { return sqlite.prepare(sql).all(...values); },
    async withExclusiveTransactionAsync(operation) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await operation(native); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      const afterCommit = hooks.afterCommit; hooks.afterCommit = null;
      if (afterCommit) await afterCommit();
    },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} }; cache.set(file, module.exports);
    vm.runInNewContext(code, { module, exports: module.exports, console, Date, Math, Intl,
      require(name) {
        if (name === 'expo-sqlite') return { openDatabaseAsync: async () => native };
        if (name === 'expo-crypto') return { randomUUID: crypto.randomUUID };
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), `${name}.ts`));
        throw Error(`Unexpected checklist persistence import ${name}`);
      },
    }, { filename: file });
    cache.set(file, module.exports); return module.exports;
  }
  return { sqlite, hooks, database: load(path.join(__dirname, '../src/data/database.ts')),
    tasks: load(path.join(__dirname, '../src/data/checklist-flow.ts')),
    model: load(path.join(__dirname, '../src/utils/checklist-flow.ts')) };
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const key = 'category:checklistFlow:main';
const task = (id, text = id, parentId = null) => ({ id, text, checked: false, parentId, format: {} });
const flow = (...items) => ({ kind: 'checklistFlow', version: 1, items });
const rev = (wall) => `${String(wall).padStart(16, '0')}:00000000:checklist_remote`;
function state(sqlite) {
  return plain({ clock: sqlite.prepare('SELECT * FROM ledger_clock').all(), docs: sqlite.prepare('SELECT * FROM ledger_documents').all(),
    uploads: sqlite.prepare('SELECT * FROM ledger_uploads').all(), native: sqlite.prepare('SELECT * FROM sync_outbox').all(),
    inline: sqlite.prepare('SELECT * FROM inline_minute_link_outbox').all() });
}

test('checklist insert/update compare-and-swap is inside the actual SQLite transaction and stale failures mutate nothing', async (t) => {
  const r = repository(t); await r.database.initializeDatabase();
  await r.database.putSyncDocument(key, flow(task('a')), { expectedRevision: null });
  const original = (await r.database.getSyncDocuments(key))[0];
  await r.database.putSyncDocument(key, flow(task('a', 'newest')), { expectedRevision: original.revision });
  const before = state(r.sqlite);
  await assert.rejects(r.database.putSyncDocument(key, flow(task('a', 'stale')), { expectedRevision: original.revision }), /changed/i);
  assert.deepEqual(state(r.sqlite), before);
  await assert.rejects(r.database.putSyncDocument(key, flow(task('a', 'wrong null')), { expectedRevision: null }), /changed/i);
  assert.deepEqual(state(r.sqlite), before);
  assert.equal(before.native.length, 0); assert.equal(before.inline.length, 0);
  assert.equal((await r.database.getDocumentsForUpload('private_storage')).filter((document) => document.key === key).length, 1);
});

test('task edits, subtree reorder and reset journal only the checklist; original minutes and queues stay unchanged', async (t) => {
  const r = repository(t); await r.database.initializeDatabase();
  await r.database.saveMinuteEntry({ dateKey: '2026-11-02', minuteIndex: 500, text: 'Original source words', categoryId: 'study' });
  const beforeMinute = plain(await r.database.getDayEntries('2026-11-02'));
  const beforeNative = plain(r.sqlite.prepare('SELECT * FROM sync_outbox').all());
  const beforeInline = plain(r.sqlite.prepare('SELECT * FROM inline_minute_link_outbox').all());
  const added = await r.tasks.addChecklistTask('source words', { ranges: [{ dateKey: '2026-11-02', startMinute: 500, endMinute: 500 }], selection: { start: 9, end: 21 } });
  let snapshot = await r.tasks.changeChecklistFlow({ type: 'add', item: task('child', 'Call mum', added.taskId) }, added.revision);
  snapshot = await r.tasks.changeChecklistFlow({ type: 'check', id: added.taskId, checked: true }, snapshot.revision);
  assert.equal(snapshot.flow.items.every((item) => item.checked), true);
  snapshot = await r.tasks.changeChecklistFlow({ type: 'reset' }, snapshot.revision);
  assert.equal(snapshot.flow.items.every((item) => !item.checked), true);
  snapshot = await r.tasks.changeChecklistFlow({ type: 'edit', id: 'child', format: { bold: true, textColor: '#abcdef' } }, snapshot.revision);
  assert.deepEqual(plain(snapshot.flow.items[1].format), { bold: true, textColor: '#ABCDEF' });
  assert.deepEqual(plain(await r.database.getDayEntries('2026-11-02')), beforeMinute);
  assert.deepEqual(plain(r.sqlite.prepare('SELECT * FROM sync_outbox').all()), beforeNative);
  assert.deepEqual(plain(r.sqlite.prepare('SELECT * FROM inline_minute_link_outbox').all()), beforeInline);
  const before = state(r.sqlite);
  await assert.rejects(r.tasks.changeChecklistFlow({ type: 'delete', id: 'child' }, added.revision), /changed/i);
  assert.deepEqual(state(r.sqlite), before);
});

test('peer lists merge without minute writes, losing checklist versions remain recoverable with guarded restore', async (t) => {
  const r = repository(t); await r.database.initializeDatabase();
  await r.database.mergeSyncDocuments([{ key, revision: rev(1), value: flow(task('remote_first')) }]);
  await r.database.mergeSyncDocuments([{ key, revision: rev(2), value: flow(task('remote_newer')) }]);
  const snapshot = await r.tasks.getChecklistFlow();
  assert.equal(snapshot.flow.items[0].id, 'remote_newer');
  const versions = await r.tasks.getChecklistFlowConflicts();
  assert.equal(versions.length, 1); assert.equal(versions[0].value.items[0].id, 'remote_first');
  assert.deepEqual(plain(await r.database.getLedgerConflicts()), [], 'existing default remains minute conflicts only');
  const before = state(r.sqlite);
  await assert.rejects(r.tasks.restoreChecklistFlowConflict(versions[0], rev(1)), /changed/i);
  assert.deepEqual(state(r.sqlite), before);
  assert.equal((await r.tasks.getChecklistFlowConflicts()).length, 1);
  const restored = await r.tasks.restoreChecklistFlowConflict(versions[0], snapshot.revision);
  assert.equal(restored.flow.items[0].id, 'remote_first');
  assert.equal((await r.tasks.getChecklistFlowConflicts()).length, 0);
  assert.equal(r.sqlite.prepare('SELECT COUNT(*) AS n FROM minute_entries').get().n, 0);
  assert.equal(r.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get().n, 0);
  assert.equal(r.sqlite.prepare('SELECT COUNT(*) AS n FROM inline_minute_link_outbox').get().n, 0);
});

test('malformed remote checklist cannot become an editable empty list or be restored over a valid list', async (t) => {
  const r = repository(t); await r.database.initializeDatabase();
  await r.database.mergeSyncDocuments([{ key, revision: rev(1), value: flow(task('a')) }]);
  await r.database.mergeSyncDocuments([{ key, revision: rev(2), value: { kind: 'checklistFlow', version: 1, items: [task('bad', 'bad', 'missing')] } }]);
  const before = state(r.sqlite);
  await assert.rejects(r.tasks.getChecklistFlow(), /invalid/);
  await assert.rejects(r.tasks.changeChecklistFlow({ type: 'reset' }, rev(2)), /invalid/);
  assert.deepEqual(state(r.sqlite), before);
  const versions = await r.tasks.getChecklistFlowConflicts();
  assert.equal(versions.length, 1);
  const restored = await r.tasks.restoreChecklistFlowConflict(versions[0], rev(2));
  assert.equal(restored.flow.items[0].id, 'a');
});

test('V1 reads and no-op actions do not migrate persistence; the first real edit atomically preserves tasks in V2', async (t) => {
  const r = repository(t); await r.database.initializeDatabase();
  const original = flow({ ...task('a'), checked: false, format: { italic: true },
    source: { ranges: [{ dateKey: '2026-11-02', startMinute: 500, endMinute: 500 }] } });
  await r.database.putSyncDocument(key, original, { expectedRevision: null });
  const before = state(r.sqlite); const read = await r.tasks.getChecklistFlow();
  assert.equal(read.collection.version, 2); assert.equal(read.lists[0].name, 'Priority');
  assert.deepEqual(state(r.sqlite), before);
  const noOp = await r.tasks.changeChecklistFlow({ type: 'reset' }, read.revision);
  assert.equal(noOp.revision, read.revision); assert.deepEqual(state(r.sqlite), before);
  const edited = await r.tasks.changeChecklistFlow({ type: 'check', id: 'a', checked: true }, read.revision);
  const stored = (await r.database.getSyncDocuments(key))[0];
  assert.equal(stored.value.version, 2); assert.equal(stored.value.lists.length, 1);
  assert.deepEqual(plain(edited.flow.items[0].source), original.items[0].source);
  assert.deepEqual(plain(edited.flow.items[0].format), original.items[0].format);
  assert.deepEqual((await r.database.getSyncDocuments(key)).map((doc) => doc.key), [key]);
});

test('selected-list writes and history preserve every other checklist and stale global revisions reject all writes', async (t) => {
  const r = repository(t); await r.database.initializeDatabase();
  const first = await r.tasks.addChecklistTask('First priority');
  const created = await r.tasks.createChecklistList('Work', first.revision); const workId = created.listId;
  const second = await r.tasks.addChecklistTask('Proposal', undefined, { bold: true }, workId);
  assert.equal(second.flow.items[0].text, 'Proposal');
  assert.equal((await r.tasks.getChecklistFlow()).flow.items[0].text, 'First priority');
  const originalMain = plain(second.collection.lists.find((list) => list.id === 'main'));
  const oldWork = plain(second.flow);
  const renamed = await r.tasks.renameChecklistList(workId, 'Projects', second.revision);
  const edited = await r.tasks.changeChecklistFlow({ type: 'check', id: second.taskId, checked: true }, renamed.revision, workId);
  assert.deepEqual(plain(edited.collection.lists.find((list) => list.id === 'main')), originalMain);
  const undo = await r.tasks.replaceChecklistList(workId, oldWork, edited.revision);
  assert.equal(undo.flow.items[0].checked, false); assert.equal(undo.lists.find((list) => list.id === workId).name, 'Projects');
  assert.deepEqual(plain(undo.collection.lists.find((list) => list.id === 'main')), originalMain);
  const before = state(r.sqlite);
  await assert.rejects(r.tasks.changeChecklistFlow({ type: 'reset' }, first.revision, workId), /changed/);
  await assert.rejects(r.tasks.renameChecklistList(workId, 'Stale', second.revision), /changed/);
  await assert.rejects(r.tasks.replaceChecklistList(workId, oldWork, edited.revision), /changed/);
  await assert.rejects(r.tasks.addChecklistTask('Wrong list', undefined, {}, 'missing'), /no longer available/);
  await assert.rejects(r.tasks.changeChecklistFlow({ type: 'delete', id: first.taskId }, undo.revision, workId), /changed or was deleted/);
  assert.deepEqual(state(r.sqlite), before);
  assert.equal(before.native.length, 0); assert.equal(before.inline.length, 0);
});

test('whole-collection conflict restore recovers all list names and rows and only explicitly falls back when selection is absent', async (t) => {
  const r = repository(t); await r.database.initializeDatabase();
  const older = r.model.createChecklistListInCollection(r.model.readChecklistCollection(flow(task('a'))), 'work', 'Work');
  older.lists[1].items.push(task('b'));
  const newer = r.model.renameChecklistListInCollection(older, 'work', 'Projects');
  newer.lists[0].items[0].text = 'Newer priority';
  await r.database.mergeSyncDocuments([{ key, revision: rev(1), value: older }]);
  await r.database.mergeSyncDocuments([{ key, revision: rev(2), value: newer }]);
  const versions = await r.tasks.getChecklistFlowConflicts(); assert.equal(versions.length, 1);
  assert.deepEqual(plain(versions[0].value), plain(older));
  const restored = await r.tasks.restoreChecklistFlowConflict(versions[0], rev(2), 'work');
  assert.equal(restored.listId, 'work'); assert.deepEqual(plain(restored.collection), plain(older));
  assert.equal(restored.flow.items[0].id, 'b');
  await r.database.mergeSyncDocuments([{ key, revision: rev(Date.now() + 1000), value: flow(task('only_main')) }]);
  const all = await r.tasks.getChecklistFlowConflicts();
  const previousCollection = all.find((version) => version.value.version === 2);
  assert.ok(previousCollection);
  // A missing selection is an explicit recovery result, not a mutation fallback.
  const v1 = all.find((version) => version.value.version === 1);
  if (v1) assert.equal(v1.value.kind, 'checklistFlow');
  const current = await r.tasks.getChecklistFlow();
  const kept = await r.tasks.restoreChecklistFlowConflict(previousCollection, current.revision, 'no_longer_selected');
  assert.equal(kept.listId, 'main'); assert.equal(kept.collection.lists.length, 2);
});

test('a checklist transfer commits one exact revision and moves a nested task with its descendants', async (t) => {
  const r = repository(t); await r.database.initializeDatabase();
  const source = { ranges: [{ dateKey: '2026-11-02', startMinute: 500, endMinute: 500 }] };
  const before = await r.database.putSyncDocument(key, { kind: 'checklistFlow', version: 2, lists: [
    { id: 'main', name: 'Priority', items: [task('parent'), { ...task('moving', 'Move me', 'parent'), source, format: { bold: true } },
      { ...task('subtask', 'Subtask', 'moving'), checked: true }] },
    { id: 'work', name: 'Work', items: [task('existing')] },
  ] }, { expectedRevision: null });
  const initialState = state(r.sqlite);
  await assert.rejects(r.tasks.transferChecklistTask('main', 'moving', 'missing', before.revision), /no longer available/);
  assert.deepEqual(state(r.sqlite), initialState);
  const moved = await r.tasks.transferChecklistTask('main', 'moving', 'work', before.revision);
  assert.deepEqual(plain(moved.collection.lists[0].items), [task('parent')]);
  assert.deepEqual(plain(moved.collection.lists[1].items), [task('existing'),
    { ...task('moving', 'Move me'), source, format: { bold: true } },
    { ...task('subtask', 'Subtask', 'moving'), checked: true }]);
  assert.equal((await r.database.getSyncDocuments(key)).length, 1);
  const movedState = state(r.sqlite);
  await assert.rejects(r.tasks.transferChecklistTask('main', 'moving', 'work', before.revision), /changed on another device/);
  assert.deepEqual(state(r.sqlite), movedState);
  await r.tasks.replaceChecklistCollection('main', before.value, moved.revision);
  assert.deepEqual(plain((await r.tasks.getChecklistFlow()).collection), plain(before.value));
  assert.deepEqual(state(r.sqlite).native, initialState.native);
  assert.deepEqual(state(r.sqlite).inline, initialState.inline);
});

test('the returned commit receipt cannot adopt a peer write that lands immediately after the transaction', async (t) => {
  const r = repository(t); await r.database.initializeDatabase();
  const first = await r.tasks.addChecklistTask('My task');
  let peerRevision;
  r.hooks.afterCommit = async () => {
    peerRevision = rev(Date.now() + 10000);
    const peer = r.model.applyChecklistListChange(first.collection, 'main', { type: 'edit', id: first.taskId, text: 'Peer words' });
    // A second SQLite connection can commit once COMMIT releases the lock,
    // before this caller's promise resumes. Inject that external row directly;
    // invoking the same app's serialized write queue here would deadlock it.
    r.sqlite.prepare('UPDATE ledger_documents SET revision = ?, value_json = ?, local_pending = 0 WHERE key = ?')
      .run(peerRevision, JSON.stringify(peer), key);
  };
  const own = await r.tasks.changeChecklistFlow({ type: 'edit', id: first.taskId, text: 'My words' }, first.revision);
  assert.equal(own.flow.items[0].text, 'My words'); assert.notEqual(own.revision, peerRevision);
  const actual = await r.tasks.getChecklistFlow();
  assert.equal(actual.revision, peerRevision); assert.equal(actual.flow.items[0].text, 'Peer words');
  const before = state(r.sqlite);
  await assert.rejects(r.tasks.replaceChecklistList('main', first.flow, own.revision), /changed/);
  assert.deepEqual(state(r.sqlite), before);
});
