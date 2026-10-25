const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');

// Run the actual app repository code against SQLite, including its production schema and triggers.
// Only Expo's native transport is replaced; all queries, transaction boundaries, and merge logic
// are loaded directly from src/data/database.ts, so these tests catch real SQLite syntax/ordering
// failures that a JS map or copied implementation would miss.
function createRepository(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const wrapper = {
    async execAsync(sql) { sqlite.exec(sql); },
    async runAsync(sql, ...parameters) {
      const result = sqlite.prepare(sql).run(...parameters);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowid };
    },
    async getFirstAsync(sql, ...parameters) {
      return sqlite.prepare(sql).get(...parameters) ?? null;
    },
    async getAllAsync(sql, ...parameters) {
      return sqlite.prepare(sql).all(...parameters);
    },
    async withExclusiveTransactionAsync(task) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        await task(wrapper);
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    cache.set(filename, module.exports);
    const context = vm.createContext({
      module, exports: module.exports, console, Date, Math, Intl,
      require(name) {
        if (name === 'expo-sqlite') return { openDatabaseAsync: async () => wrapper };
        if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`));
        throw new Error(`Unexpected repository test import: ${name}`);
      },
    });
    vm.runInContext(code, context, { filename });
    cache.set(filename, module.exports);
    return module.exports;
  }
  return { api: load(path.join(__dirname, '../src/data/database.ts')), sqlite };
}

const day = '2026-10-25';
const minuteKey = (minute, date = day) => `minute:${date}:${minute}`;
const value = (minute, text = 'Read', extras = {}) => ({
  id: `remote-${minute}`, dateKey: day, minuteIndex: minute, text,
  categoryId: 'study', blockId: 'block-remote', source: 'manual',
  createdAt: '2026-10-25T12:00:00.000Z', updatedAt: '2026-10-25T12:01:00.000Z',
  ...extras,
});
const revision = (wall, counter = 0, device = 'remote') =>
  `${String(wall).padStart(16, '0')}:${String(counter).padStart(8, '0')}:${device}`;
const plain = (object) => JSON.parse(JSON.stringify(object));
const save = (api, minute, text, categoryId = 'study') =>
  api.saveMinuteEntry({ dateKey: day, minuteIndex: minute, text, categoryId });

test('initialization migrates legacy minutes into the journal without calendar side effects', async (t) => {
  const { api, sqlite } = createRepository(t);
  sqlite.exec(`CREATE TABLE minute_entries (
    id TEXT PRIMARY KEY, date_key TEXT NOT NULL, minute_index INTEGER NOT NULL,
    text TEXT NOT NULL, category_id TEXT NOT NULL, block_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(date_key, minute_index));
    INSERT INTO minute_entries VALUES (
      'old', '2026-10-25', 42, 'Legacy thought', 'study', 'old-block', 'manual',
      '2026-10-25T09:00:00.000Z', '2026-10-25T09:01:00.000Z');`);
  await api.initializeDatabase();
  await api.initializeDatabase();
  const documents = await api.getSyncDocuments('minute:');
  assert.equal(documents.length, 1);
  assert.equal(documents[0].value.text, 'Legacy thought');
  assert.match(documents[0].revision, /^\d{16}:\d{8}:[a-f0-9]{32}$/);
  assert.equal((await api.getDocumentsForUpload('google:user')).length, 1);
  assert.equal((await api.getPendingSyncDates()).length, 0);
});

test('local range mutations atomically capture a distinct ordered revision and deletion tombstone', async (t) => {
  const { api } = createRepository(t);
  await api.initializeDatabase();
  await api.saveMinuteRange({ dateKey: day, startMinute: 60, durationMinutes: 3,
    text: 'Breakfast', categoryId: 'physiological' });
  const documents = await api.getSyncDocuments('minute:');
  assert.equal(documents.length, 3);
  assert.equal(new Set(documents.map((document) => document.revision)).size, 3);
  assert.ok(documents[0].revision < documents[1].revision);
  assert.ok(documents[1].revision < documents[2].revision);
  const oldRevision = documents[1].revision;
  await api.deleteMinuteEntry(day, 61);
  const deletion = (await api.getSyncDocuments('minute:')).find((document) => document.key === minuteKey(61));
  assert.equal(deletion.value, null);
  assert.ok(deletion.revision > oldRevision);
  assert.equal((await api.getDayEntries(day)).length, 2);
  assert.equal((await api.getPendingSyncDates()).length, 1);
});

test('editing a first minute and bridging matching neighbors retains one calendar block', async (t) => {
  const { api } = createRepository(t);
  await api.initializeDatabase();
  await save(api, 100, 'Start');
  await save(api, 102, 'Finish');
  assert.equal((await api.getDaySegments(day)).length, 2);
  await save(api, 101, 'Continue');
  let segments = await api.getDaySegments(day);
  assert.equal(segments.length, 1);
  const blockId = segments[0].blockId;
  await save(api, 100, 'Corrected start');
  segments = await api.getDaySegments(day);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].blockId, blockId);
  assert.equal(segments[0].entries[0].text, 'Corrected start');
  assert.equal(new Set((await api.getSyncDocuments('minute:')).map((document) => document.value.blockId)).size, 1);
});

test('a cross-midnight range creates distinct dated segment keys and queues both days', async (t) => {
  const { api } = createRepository(t);
  await api.initializeDatabase();
  const dates = await api.saveMinuteRange({ dateKey: day, startMinute: 1438,
    durationMinutes: 5, text: 'Sleep', categoryId: 'sleep' });
  assert.deepEqual(plain(dates), [day, '2026-10-26']);
  const left = await api.getDaySegments(day);
  const right = await api.getDaySegments('2026-10-26');
  assert.equal(left[0].entries.length, 2);
  assert.equal(right[0].entries.length, 3);
  assert.equal(left[0].blockId, right[0].blockId);
  assert.match(left[0].segmentKey, /^2026-10-25:/);
  assert.match(right[0].segmentKey, /^2026-10-26:/);
  assert.equal((await api.getSyncDocuments('minute:')).length, 5);
  assert.equal((await api.getPendingSyncDates()).length, 2);
});

test('remote merge preserves incoming revisions without echo triggers, then a local edit causally wins', async (t) => {
  const { api, sqlite } = createRepository(t);
  await api.initializeDatabase();
  const futureWall = Date.now() + 86_400_000;
  const incoming = { key: minuteKey(80), revision: revision(futureWall, 50), value: value(80, 'From phone two') };
  assert.equal(await api.mergeSyncDocuments([incoming]), 1);
  assert.equal(await api.mergeSyncDocuments([incoming]), 0);
  let documents = await api.getSyncDocuments('minute:');
  assert.equal(documents[0].revision, incoming.revision);
  assert.equal((await api.getMinuteEntry(day, 80)).source, 'imported');
  assert.equal(sqlite.prepare('SELECT importing FROM ledger_clock').get().importing, 0);
  await save(api, 80, 'Edited after receiving phone two');
  documents = await api.getSyncDocuments('minute:');
  assert.ok(documents[0].revision > incoming.revision);
  assert.ok(Number(documents[0].revision.split(':')[1]) > 50);
});

test('remote stale updates and tombstones cannot resurrect a later local deletion', async (t) => {
  const { api } = createRepository(t);
  await api.initializeDatabase();
  await save(api, 90, 'Temporary note');
  const original = (await api.getSyncDocuments('minute:'))[0];
  await api.deleteMinuteEntry(day, 90);
  const tombstone = (await api.getSyncDocuments('minute:'))[0];
  assert.ok(tombstone.revision > original.revision);
  assert.equal(await api.mergeSyncDocuments([original]), 0);
  assert.equal(await api.getMinuteEntry(day, 90), null);
  const remoteDeletion = { key: minuteKey(91), revision: revision(Date.now() + 1000), value: null };
  await api.mergeSyncDocuments([remoteDeletion]);
  assert.equal((await api.getSyncDocuments('minute:')).find((document) => document.key === minuteKey(91)).value, null);
});

test('acknowledging an older uploaded revision leaves a newer edit pending independently per storage account', async (t) => {
  const { api, sqlite } = createRepository(t);
  await api.initializeDatabase();
  await save(api, 120, 'First draft');
  const uploaded = await api.getDocumentsForUpload('google:user');
  await save(api, 120, 'Second draft while upload was running');
  await api.acknowledgeUploaded('google:user', uploaded);
  const remaining = await api.getDocumentsForUpload('google:user');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].value.text, 'Second draft while upload was running');
  assert.equal(sqlite.prepare('SELECT local_pending FROM ledger_documents').get().local_pending, 1);
  await api.acknowledgeUploaded('google:user', remaining);
  assert.equal((await api.getDocumentsForUpload('google:user')).length, 0);
  assert.equal((await api.getDocumentsForUpload('microsoft:user')).length, 1);
});

test('a competing local version is recoverable and restoring it creates a new winning revision', async (t) => {
  const { api } = createRepository(t);
  await api.initializeDatabase();
  await save(api, 130, 'Offline thought on this phone');
  const local = (await api.getSyncDocuments('minute:'))[0];
  const remote = { key: local.key, revision: revision(Date.now() + 60_000, 9),
    value: value(130, 'Another phone version') };
  await api.mergeSyncDocuments([remote]);
  assert.equal((await api.getMinuteEntry(day, 130)).text, 'Another phone version');
  const conflicts = await api.getLedgerConflicts();
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].value.text, 'Offline thought on this phone');
  await api.restoreLedgerConflict(conflicts[0]);
  const restored = (await api.getSyncDocuments('minute:'))[0];
  assert.equal(restored.value.text, 'Offline thought on this phone');
  assert.ok(restored.revision > remote.revision);
  assert.equal((await api.getLedgerConflicts()).length, 0);
});

test('a malformed remote batch rolls back imported rows, journal, and clock suppression state', async (t) => {
  const { api, sqlite } = createRepository(t);
  await api.initializeDatabase();
  const beforeClock = plain(sqlite.prepare('SELECT * FROM ledger_clock').get());
  await assert.rejects(api.mergeSyncDocuments([
    { key: minuteKey(140), revision: revision(Date.now() + 60_000), value: value(140) },
    { key: minuteKey(141), revision: revision(Date.now() + 60_000, 1), value: { text: 'Missing required fields' } },
  ]), /Invalid synchronized minute/);
  assert.equal((await api.getDayEntries(day)).length, 0);
  assert.equal((await api.getSyncDocuments('minute:')).length, 0);
  assert.deepEqual(plain(sqlite.prepare('SELECT * FROM ledger_clock').get()), beforeClock);
  await save(api, 142, 'Triggers still enabled');
  assert.equal((await api.getSyncDocuments('minute:')).length, 1);
});

test('calendar import overlap rolls back both old-block deletion and journal tombstones', async (t) => {
  const { api } = createRepository(t);
  await api.initializeDatabase();
  await api.saveMinuteRange({ dateKey: day, startMinute: 200, durationMinutes: 2,
    text: 'Prayer', categoryId: 'prayer' });
  await save(api, 205, 'Another activity', 'work');
  const block = (await api.getMinuteEntry(day, 200)).blockId;
  const before = plain(await api.getSyncDocuments('minute:'));
  await assert.rejects(api.replaceProjectedMinutes({ blockId: block, previousDate: day,
    previousStart: 200, previousEnd: 201,
    entries: [{ dateKey: day, minuteIndex: 205, text: 'Moved prayer', categoryId: 'prayer' }],
  }), /overlaps another recorded activity/);
  assert.equal((await api.getMinuteEntry(day, 200)).text, 'Prayer');
  assert.equal((await api.getMinuteEntry(day, 201)).text, 'Prayer');
  assert.equal((await api.getMinuteEntry(day, 205)).text, 'Another activity');
  assert.deepEqual(plain(await api.getSyncDocuments('minute:')), before);
});

test('calendar movement records old-minute tombstones and new-minute text in the same transaction', async (t) => {
  const { api } = createRepository(t);
  await api.initializeDatabase();
  await api.saveMinuteRange({ dateKey: day, startMinute: 210, durationMinutes: 2,
    text: 'Prayer', categoryId: 'prayer' });
  const block = (await api.getMinuteEntry(day, 210)).blockId;
  await api.replaceProjectedMinutes({ blockId: block, previousDate: day,
    previousStart: 210, previousEnd: 211,
    entries: [
      { dateKey: day, minuteIndex: 220, text: 'Pray fardh', categoryId: 'prayer' },
      { dateKey: day, minuteIndex: 221, text: 'Supplicate', categoryId: 'prayer' },
    ],
  });
  assert.equal(await api.getMinuteEntry(day, 210), null);
  assert.equal((await api.getMinuteEntry(day, 220)).text, 'Pray fardh');
  assert.equal((await api.getMinuteEntry(day, 221)).text, 'Supplicate');
  const documents = await api.getSyncDocuments('minute:');
  assert.equal(documents.length, 4);
  assert.equal(documents.find((document) => document.key === minuteKey(210)).value, null);
  assert.equal(documents.find((document) => document.key === minuteKey(211)).value, null);
  assert.equal(documents.find((document) => document.key === minuteKey(220)).value.blockId, block);
});

test('a local edit after migration causally follows a legacy record with a fast device clock', async (t) => {
  const { api, sqlite } = createRepository(t);
  const future = new Date(Date.now() + 86_400_000).toISOString();
  sqlite.exec(`CREATE TABLE minute_entries (
    id TEXT PRIMARY KEY, date_key TEXT NOT NULL, minute_index INTEGER NOT NULL,
    text TEXT NOT NULL, category_id TEXT NOT NULL, block_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(date_key, minute_index));`);
  sqlite.prepare('INSERT INTO minute_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('legacy-fast', day, 10, 'Legacy fast-clock note', 'study', 'legacy-block', 'manual', future, future);
  await api.initializeDatabase();
  const before = (await api.getSyncDocuments('minute:'))[0];
  await save(api, 10, 'Correction after migration');
  const after = (await api.getSyncDocuments('minute:'))[0];
  assert.ok(after.revision > before.revision,
    'The new edit must follow the seeded revision even if the old installation clock was ahead');
});
