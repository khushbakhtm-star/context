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
  const native = {
    async execAsync(sql) { sqlite.exec(sql); },
    async runAsync(sql, ...values) { const result = sqlite.prepare(sql).run(...values); return { changes: result.changes, lastInsertRowId: result.lastInsertRowid }; },
    async getFirstAsync(sql, ...values) { return sqlite.prepare(sql).get(...values) ?? null; },
    async getAllAsync(sql, ...values) { return sqlite.prepare(sql).all(...values); },
    async withExclusiveTransactionAsync(operation) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await operation(native); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
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
  return { sqlite, database: load(path.join(__dirname, '../src/data/database.ts')),
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
