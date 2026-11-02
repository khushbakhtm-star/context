const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');

// Real app schema and search SQL against SQLite; only Expo's platform facade is
// replaced. Recorded reads verify an empty/invalid scope never becomes a query.
function repository(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  const reads = [];
  const native = {
    async execAsync(sql) { sqlite.exec(sql); },
    async runAsync(sql, ...values) { const result = sqlite.prepare(sql).run(...values); return { changes: result.changes, lastInsertRowId: result.lastInsertRowid }; },
    async getFirstAsync(sql, ...values) { reads.push({ sql, values }); return sqlite.prepare(sql).get(...values) ?? null; },
    async getAllAsync(sql, ...values) { reads.push({ sql, values }); return sqlite.prepare(sql).all(...values); },
    async withExclusiveTransactionAsync(operation) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await operation(native); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} }; cache.set(filename, module.exports);
    vm.runInNewContext(code, { module, exports: module.exports, console, Date, Math, Intl,
      require(name) {
        if (name === 'expo-sqlite') return { openDatabaseAsync: async () => native };
        if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`));
        throw new Error(`Unexpected search persistence import ${name}`);
      },
    }, { filename });
    cache.set(filename, module.exports); return module.exports;
  }
  const insert = () => sqlite.prepare(`INSERT INTO minute_entries
    (id, date_key, minute_index, text, category_id, block_id, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'study', 'fixture', 'manual', '2026-11-02T00:00:00Z', '2026-11-02T00:00:00Z')`);
  return { sqlite, reads, database: load(path.join(__dirname, '../src/data/database.ts')), insert };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('SQLite filters selected calendar dates before ORDER/LIMIT even when newer global matches fill the limit', async (t) => {
  const r = repository(t); await r.database.initializeDatabase(); const insert = r.insert();
  for (let minute = 0; minute < 160; minute++) insert.run(`new_${minute}`, '2026-11-03', minute, 'find newest');
  insert.run('selected', '2026-10-30', 500, 'find selected');
  insert.run('selected_two', '2026-10-29', 600, 'find selected older');
  const dates = ['2026-10-29', '2026-10-30', '2026-10-30'];
  const scoped = await r.database.searchEntries('find', 1, dates);
  assert.deepEqual(plain(scoped.map((entry) => entry.id)), ['selected']);
  assert.deepEqual(dates, ['2026-10-29', '2026-10-30', '2026-10-30']);
  const global = await r.database.searchEntries('find', 1);
  assert.deepEqual(plain(global.map((entry) => entry.id)), ['new_159']);
  const allScoped = await r.database.searchEntries('find', 10, dates);
  assert.deepEqual(plain(allScoped.map((entry) => entry.id)), ['selected', 'selected_two']);
  assert.equal(typeof scoped[0].categoryName, 'string'); assert.match(scoped[0].categoryColor, /^#[0-9A-F]{6}$/i);
});

test('SQLite LIKE escaping treats percent, underscore, backslash and quote text literally within the selected dates', async (t) => {
  const r = repository(t); await r.database.initializeDatabase(); const insert = r.insert();
  const entries = [['percent', '100% done'], ['not_percent', '1000 done'], ['underscore', 'todo_item'],
    ['not_underscore', 'todoXitem'], ['backslash', 'path\\folder'], ['not_backslash', 'pathfolder'],
    ['quote', "' OR 1=1 --"], ['other_date', '100% done']];
  entries.forEach(([id, text], minute) => insert.run(id, id === 'other_date' ? '2026-11-03' : '2026-11-02', minute, text));
  for (const [query, expected] of [['100%', 'percent'], ['todo_', 'underscore'], ['path\\', 'backslash'], ["' OR 1=1 --", 'quote']]) {
    const rows = await r.database.searchEntries(query, 100, ['2026-11-02']);
    assert.deepEqual(plain(rows.map((row) => row.id)), [expected]);
  }
});

test('empty and invalid SQLite scopes never fall back to unfiltered history or reach a SELECT', async (t) => {
  const r = repository(t); await r.database.initializeDatabase();
  r.insert().run('private', '2026-11-02', 10, 'Private note');
  r.reads.length = 0;
  assert.deepEqual(plain(await r.database.searchEntries('', 100, [])), []); assert.equal(r.reads.length, 0);
  for (const dates of [['2026-02-30'], ['2026-11-02', '2026-13-01'], ['2026-1-02'], ["2026-11-02') OR 1=1 --"],
    Array.from({ length: 367 }, () => '2026-11-02'), null])
    await assert.rejects(r.database.searchEntries('', 100, dates));
  assert.equal(r.reads.length, 0);
  assert.equal((await r.database.searchEntries('', 100, ['2026-11-02'])).length, 1);
});
