const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');

function repository(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  const calls = []; let inside = false;
  const transport = {
    async execAsync(sql) { calls.push({ method: 'exec', sql, inside }); sqlite.exec(sql); },
    async runAsync(sql, ...parameters) {
      calls.push({ method: 'run', sql, parameters, inside }); const result = sqlite.prepare(sql).run(...parameters);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowid };
    },
    async getFirstAsync(sql, ...parameters) {
      calls.push({ method: 'first', sql, parameters, inside }); return sqlite.prepare(sql).get(...parameters) ?? null;
    },
    async getAllAsync(sql, ...parameters) {
      calls.push({ method: 'all', sql, parameters, inside }); return sqlite.prepare(sql).all(...parameters);
    },
    async withExclusiveTransactionAsync(task) {
      sqlite.exec('BEGIN IMMEDIATE'); inside = true;
      try { await task(transport); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      finally { inside = false; }
    },
  };
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const module = { exports: {} }; modules.set(filename, module.exports);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports, Date, Math, Intl, require(name) {
      if (name === 'expo-sqlite') return { openDatabaseAsync: async () => transport };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`));
      throw Error('Unexpected database read fixture import');
    } }, { filename });
    modules.set(filename, module.exports); return module.exports;
  }
  return { db: load(path.join(__dirname, '../src/data/database.ts')), sqlite, calls };
}
const day = '2026-10-25';
const entry = (minuteIndex, blockId = 'legacy_block', dateKey = day) => ({ dateKey, minuteIndex, blockId });
const formatKey = (point) => `category:minuteFormat:${point.dateKey}:${point.minuteIndex}`;
const plain = (value) => JSON.parse(JSON.stringify(value));
function putFormat(sqlite, point, format) {
  sqlite.prepare('INSERT OR REPLACE INTO ledger_documents(key,revision,value_json,local_pending) VALUES (?,?,?,0)')
    .run(formatKey(point), '0000000000000001:00000000:fixture_actor', JSON.stringify({ kind: 'minuteFormat', format }));
}
const titleReads = (calls) => calls.filter((call) => /SELECT key, value_json FROM ledger_documents WHERE key IN/.test(call.sql));

test('a full legacy unlabeled day resolves its absent title with three bounded exact-key reads', async (t) => {
  const { db, sqlite, calls } = repository(t); await db.initializeDatabase();
  const entries = Array.from({ length: 1440 }, (_, minute) => entry(minute));
  putFormat(sqlite, entry(0, 'another_block'), { calendarEvent: { id: 'another_block', title: 'Unrelated event' } });
  putFormat(sqlite, entry(1439), { bold: true });
  calls.length = 0;
  assert.equal(await db.getActivityTitleForEntries(entries), undefined);
  assert.equal(titleReads(calls).length, 3);
  assert.deepEqual(titleReads(calls).map((call) => call.parameters.length), [500, 500, 440]);
  assert.equal(calls.filter((call) => call.method === 'first').length, 0, 'there is no per-minute scalar lookup');
  assert.equal(new Set(titleReads(calls).flatMap((call) => call.parameters)).size, 1440);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM minute_entries').get().n, 0, 'title lookup never creates rows');
});

test('batched title lookup keeps caller order, exact block identity and the first valid label', async (t) => {
  const { db, sqlite, calls } = repository(t); await db.initializeDatabase();
  const wrong = entry(100, 'legacy_first'), selected = entry(700, 'legacy_selected', '2026-10-26'), earlier = entry(10, 'activity_earlier');
  putFormat(sqlite, wrong, { activityGroup: { id: 'activity_unrelated', title: 'Wrong membership' } });
  putFormat(sqlite, selected, { calendarEvent: { id: selected.blockId, title: ' First in caller order ' } });
  putFormat(sqlite, earlier, { activityGroup: { id: earlier.blockId, title: 'Earlier date is not first' } });
  const malformed = entry(900);
  sqlite.prepare('INSERT INTO ledger_documents(key,revision,value_json,local_pending) VALUES (?,?,?,0)')
    .run(formatKey(malformed), '0000000000000001:00000000:fixture_actor', '{malformed');
  calls.length = 0;
  assert.equal(await db.getActivityTitleForEntries([wrong, selected, earlier, malformed]), 'First in caller order');
  assert.equal(titleReads(calls).length, 1);
  assert.equal(await db.getActivityTitleForEntries([{ ...selected, blockId: 'different_block' }, earlier]), 'Earlier date is not first');
  assert.equal(await db.getActivityTitleForEntries([]), undefined);
});

test('optional block date bounds preserve inclusive endpoints, row content and the unbounded contract', async (t) => {
  const { db, sqlite, calls } = repository(t); await db.initializeDatabase();
  const insert = sqlite.prepare(`INSERT INTO minute_entries(id,date_key,minute_index,text,category_id,block_id,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const [index, point] of [entry(20, 'legacy_block', '2026-10-24'), entry(30), entry(5, 'legacy_block', '2026-10-26'),
    entry(40, 'legacy_block', '2026-10-27'), entry(31, 'unrelated')].entries()) {
    insert.run(`row_${index}`, point.dateKey, point.minuteIndex, `Note ${index}`, 'work', point.blockId, 'manual', 'before', 'after');
  }
  const all = plain(await db.getEntriesForBlock('legacy_block'));
  calls.length = 0;
  const ranged = plain(await db.getEntriesForBlock('legacy_block', { startDate: day, endDate: '2026-10-26' }));
  assert.deepEqual(ranged, all.filter((row) => row.dateKey >= day && row.dateKey <= '2026-10-26'));
  assert.deepEqual(ranged.map((row) => [row.dateKey, row.minuteIndex]), [[day, 30], ['2026-10-26', 5]]);
  const query = calls.find((call) => call.method === 'all');
  assert.deepEqual(query.parameters, ['legacy_block', day, '2026-10-26']);
  assert.ok(sqlite.prepare('EXPLAIN QUERY PLAN ' + query.sql).all(...query.parameters)
    .some((row) => /SEARCH.*minute_entries_block_idx/.test(row.detail)), 'the existing exact-block/date index is used');
  assert.deepEqual(plain(await db.getEntriesForBlock('legacy_block')), all);
  assert.deepEqual(plain(await db.getEntriesForBlock('legacy_block', { startDate: '2026-10-27', endDate: day })), []);
});

test('calendar import still checks the first exact activity title inside its atomic transaction', async (t) => {
  const { db, sqlite, calls } = repository(t); await db.initializeDatabase();
  await db.replaceProjectedMinutes({ blockId: 'legacy_bound', previousDate: day, previousStart: 600, previousEnd: 601,
    activityTitle: 'Original event', entries: [600, 601].map((minuteIndex) => ({ dateKey: day, minuteIndex, text: 'Local note', categoryId: 'work' })) });
  const expectedEntries = plain(await db.getEntriesForBlock('legacy_bound'));
  putFormat(sqlite, entry(600, 'legacy_bound'), { calendarEvent: { id: 'legacy_bound', title: 'Edited event title' } });
  const before = plain(await db.getSyncDocuments(''));
  calls.length = 0;
  await assert.rejects(db.replaceProjectedMinutes({ blockId: 'legacy_bound', previousDate: day, previousStart: 600, previousEnd: 601,
    expectedEntries, expectedActivityTitle: 'Original event', activityTitle: 'Remote title', entries: [
      { dateKey: day, minuteIndex: 700, text: 'Remote note', categoryId: 'work' },
    ] }), /title changed/);
  assert.equal(titleReads(calls).length, 1); assert.ok(titleReads(calls).every((call) => call.inside));
  assert.deepEqual(plain(await db.getEntriesForBlock('legacy_bound')), expectedEntries);
  assert.deepEqual(plain(await db.getSyncDocuments('')), before);
});
