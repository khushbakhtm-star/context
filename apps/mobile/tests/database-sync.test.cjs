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

test('source color import preserves minute identity, notes, groups, source and formatting while journaling only private-ledger changes', async (t) => {
  const { api, sqlite } = createRepository(t); await api.initializeDatabase();
  const sourceEntries = [value(100, 'Exact note\n  Keep spaces  ', { blockId: 'activity_color', source: 'imported' }),
    value(101, '', { blockId: 'activity_color', source: 'inherited-plan' })];
  await api.mergeSyncDocuments(sourceEntries.map((entry, index) => ({ key: minuteKey(entry.minuteIndex), revision: revision(100, index), value: entry })));
  const formatKey = `category:minuteFormat:${day}:100`;
  await api.putSyncDocument(formatKey, { kind: 'minuteFormat', format: { bold: true, underline: true, textColor: '#ABCDEF',
    activityGroup: { id: 'activity_color', title: 'Coffee' } } });
  await api.saveSyncBinding({ segmentKey: 'activity_color:100:101', blockId: 'activity_color', dateKey: day, calendarId: 'device', eventId: 'native-12' });
  sqlite.prepare('INSERT INTO sync_outbox (date_key, attempts, last_error, updated_at) VALUES (?, 3, ?, ?)').run(day, 'existing pending write', 'before');
  sqlite.prepare('INSERT OR REPLACE INTO inline_minute_link_outbox (date_key, minute_index, affected_dates_json, token) VALUES (?, ?, ?, ?)')
    .run(day, 100, JSON.stringify([day]), 'prior-link-token');
  const queues = plain({ native: sqlite.prepare('SELECT * FROM sync_outbox').all(), inline: sqlite.prepare('SELECT * FROM inline_minute_link_outbox').all() });
  const bindings = plain(await api.getSyncBindings(day));
  const before = plain(await api.getDayEntries(day));
  const formats = plain(await api.getSyncDocuments('category:minuteFormat:'));
  const revisions = new Map((await api.getSyncDocuments('minute:')).map((item) => [item.key, item.revision]));
  const receipt = { key: 'calendar.color-receipt.device.device.native-12', value: { version: 1, calendarId: 'device', eventId: 'native-12',
    remoteColor: '#123456', localColorHash: 'a'.repeat(64) } };
  assert.deepEqual(plain(await api.recolorExpectedMinuteEntries(before, 'source_color_new', receipt)), [day]);
  const after = plain(await api.getDayEntries(day));
  for (let index = 0; index < before.length; index++) {
    const { categoryId: _category, updatedAt: _updated, ...identity } = before[index];
    const { categoryId, updatedAt, ...changedIdentity } = after[index];
    assert.deepEqual(changedIdentity, identity);
    assert.equal(categoryId, 'source_color_new'); assert.notEqual(updatedAt, before[index].updatedAt);
  }
  assert.deepEqual(plain(await api.getSyncDocuments('category:minuteFormat:')), formats);
  assert.deepEqual(plain(await api.getSyncBindings(day)), bindings);
  assert.deepEqual(plain({ native: sqlite.prepare('SELECT * FROM sync_outbox').all(), inline: sqlite.prepare('SELECT * FROM inline_minute_link_outbox').all() }), queues);
  for (const document of await api.getSyncDocuments('minute:')) {
    assert.notEqual(document.revision, revisions.get(document.key));
    assert.equal(document.value.categoryId, 'source_color_new');
    assert.equal(sqlite.prepare('SELECT local_pending FROM ledger_documents WHERE key = ?').get(document.key).local_pending, 1);
  }
  assert.deepEqual(plain(await api.getSetting(receipt.key, null)), receipt.value);
  const settled = plain(await api.getSyncDocuments('minute:'));
  assert.deepEqual(plain(await api.recolorExpectedMinuteEntries(after, 'source_color_new', { ...receipt,
    value: { ...receipt.value, remoteColor: '#654321' } })), []);
  assert.deepEqual(plain(await api.getSyncDocuments('minute:')), settled, 'no-op color import must not create another revision');
  assert.equal((await api.getSetting(receipt.key, null)).remoteColor, '#654321');
});

test('source color imports reject every stale minute snapshot field before acknowledging or changing any reviewed row', async (t) => {
  const { api, sqlite } = createRepository(t); await api.initializeDatabase();
  await save(api, 100, 'First'); await save(api, 101, 'Second');
  const before = plain(await api.getDayEntries(day)); const documents = plain(await api.getSyncDocuments(''));
  const altered = { id: 'different-id', text: 'A concurrent note', categoryId: 'work', blockId: 'another-block', source: 'imported',
    createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z', dateKey: '2026-10-26', minuteIndex: 102 };
  for (const [field, different] of Object.entries(altered)) {
    const snapshot = plain(before); snapshot[1][field] = different;
    await assert.rejects(api.recolorExpectedMinuteEntries(snapshot, 'new_source_color', { key: 'calendar.color-receipt.test.stale', value: {} }),
      /changed|snapshot|valid|duplicate/);
    assert.deepEqual(plain(await api.getDayEntries(day)), before);
    assert.deepEqual(plain(await api.getSyncDocuments('')), documents);
  }
  assert.equal(await api.getSetting('calendar.color-receipt.test.stale', null), null);
  await assert.rejects(api.recolorExpectedMinuteEntries([before[0], before[0]], 'new_source_color'), /duplicate/);
  await assert.rejects(api.recolorExpectedMinuteEntries(before, 'new_source_color', { key: 'wear.receipt.wrong', value: {} }), /receipt/);
  assert.equal(sqlite.prepare('SELECT importing FROM ledger_clock').get().importing, 0);
});

test('source color import rolls back minute revisions and receipts on a late raw-draft guard or receipt failure', async (t) => {
  const { api, sqlite } = createRepository(t); await api.initializeDatabase();
  await save(api, 100, 'First'); await save(api, 101, 'Second');
  const before = plain(await api.getDayEntries(day)); const documents = plain(await api.getSyncDocuments(''));
  const clock = plain(sqlite.prepare('SELECT * FROM ledger_clock').get());
  const receipt = { key: 'calendar.color-receipt.test.late', value: { version: 1 } };
  await assert.rejects(api.recolorExpectedMinuteEntries(before, 'new_source_color', receipt, () => {
    if (sqlite.prepare('SELECT 1 FROM minute_entries WHERE category_id = ?').get('new_source_color')) throw Error('A raw draft changed during lookup');
  }), /raw draft changed/);
  assert.deepEqual(plain(await api.getDayEntries(day)), before);
  assert.deepEqual(plain(await api.getSyncDocuments('')), documents);
  assert.deepEqual(plain(sqlite.prepare('SELECT * FROM ledger_clock').get()), clock);
  assert.equal(await api.getSetting(receipt.key, null), null);
  await assert.rejects(api.recolorExpectedMinuteEntries(before, 'new_source_color', receipt, () => {
    if (sqlite.prepare('SELECT 1 FROM settings WHERE key = ?').get(receipt.key)) throw Error('A final draft changed');
  }), /final draft changed/);
  assert.deepEqual(plain(await api.getDayEntries(day)), before);
  assert.equal(await api.getSetting(receipt.key, null), null);
  sqlite.exec(`CREATE TRIGGER reject_color_receipt BEFORE INSERT ON settings WHEN NEW.key LIKE 'calendar.color-receipt.%'
    BEGIN SELECT RAISE(ABORT, 'Color receipt write failed'); END;`);
  await assert.rejects(api.recolorExpectedMinuteEntries(before, 'new_source_color', receipt), /receipt write failed/);
  assert.deepEqual(plain(await api.getDayEntries(day)), before);
  assert.deepEqual(plain(await api.getSyncDocuments('')), documents);
  assert.deepEqual(plain(sqlite.prepare('SELECT * FROM ledger_clock').get()), clock);
});

test('one-phone backup batches never latch a foreign ledger peer', async (t) => {
  const { api, sqlite } = createRepository(t); await api.initializeDatabase();
  await save(api, 20, 'Own note');
  assert.equal(await api.getHasSharedLedgerPeer(), false);
  const documents = plain(await api.getSyncDocuments(''));
  await api.mergeSyncDocuments(documents);
  assert.equal(await api.getHasSharedLedgerPeer(), false);
  assert.equal(sqlite.prepare(`SELECT value FROM settings WHERE key = ?`).get('calendar.native.shared-ledger-peer-seen.v1'), undefined);
});

test('foreign actor evidence latches even for losing same-value documents and survives later local edits and reinitialization', async (t) => {
  const { api, sqlite } = createRepository(t); await api.initializeDatabase();
  await save(api, 21, 'Same note');
  const original = (await api.getSyncDocuments('minute:'))[0];
  await api.mergeSyncDocuments([{ ...plain(original), revision: revision(1, 0, 'foreign-device') }]);
  assert.equal(await api.getHasSharedLedgerPeer(), true);
  assert.equal(sqlite.prepare(`SELECT value FROM settings WHERE key = ?`).get('calendar.native.shared-ledger-peer-seen.v1').value, 'true');
  await save(api, 21, 'Local edit after peer');
  sqlite.exec('DELETE FROM ledger_conflicts');
  const actor = sqlite.prepare('SELECT device FROM ledger_clock WHERE id = 1').get().device;
  assert.ok((await api.getSyncDocuments('')).every((document) => document.revision.endsWith(':' + actor)));
  await api.initializeDatabase();
  assert.equal(await api.getHasSharedLedgerPeer(), true);
});

test('the peer getter discovers existing foreign winning documents and conflict-only history during upgrade', async (t) => {
  for (const historyOnly of [false, true]) {
    const { api, sqlite } = createRepository(t); await api.initializeDatabase();
    await save(api, 22, 'Local');
    const document = (await api.getSyncDocuments('minute:'))[0];
    if (historyOnly) sqlite.prepare('INSERT INTO ledger_conflicts (key, revision, value_json) VALUES (?, ?, ?)')
      .run(document.key, revision(1, 0, 'prior-peer-device'), JSON.stringify(document.value));
    else sqlite.prepare('UPDATE ledger_documents SET revision = ? WHERE key = ?')
      .run(revision(1, 0, 'prior-peer-device'), document.key);
    assert.equal(await api.getHasSharedLedgerPeer(), true);
    assert.equal(sqlite.prepare(`SELECT value FROM settings WHERE key = ?`).get('calendar.native.shared-ledger-peer-seen.v1').value, 'true');
  }
});

test('a rejected foreign merge rolls back peer evidence, minute changes and importing state atomically', async (t) => {
  const { api, sqlite } = createRepository(t); await api.initializeDatabase();
  await save(api, 23, 'Original note');
  const documents = plain(await api.getSyncDocuments(''));
  await assert.rejects(api.mergeSyncDocuments([
    { key: minuteKey(24), revision: revision(Date.now() + 1000, 0, 'foreign-device'), value: value(24, 'Must roll back') },
    { key: 'unrecognized:metadata', revision: revision(Date.now() + 1000, 1, 'foreign-device'), value: {} },
  ]), /Unrecognized synchronization record/);
  assert.deepEqual(plain(await api.getSyncDocuments('')), documents);
  assert.equal(await api.getMinuteEntry(day, 24), null);
  assert.equal(await api.getHasSharedLedgerPeer(), false);
  assert.equal(sqlite.prepare('SELECT importing FROM ledger_clock WHERE id = 1').get().importing, 0);
});

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

test('explicit color-only minutes count in reports and round-trip through the cloud journal', async (t) => {
  const first = createRepository(t).api;
  const second = createRepository(t).api;
  await first.initializeDatabase();
  await second.initializeDatabase();
  assert.deepEqual(plain(await first.saveMinuteRange({ dateKey: day, startMinute: 300,
    durationMinutes: 1, text: '', categoryId: 'study' })), []);
  await first.saveMinuteRange({ dateKey: day, startMinute: 300, durationMinutes: 1,
    text: '', categoryId: 'study', allowEmptyText: true, queueInlineLink: true });
  assert.equal((await first.getMinuteEntry(day, 300)).text, '');
  assert.deepEqual(plain(await first.getCategoryTimeTotals(day, day)),
    [{ dateKey: day, categoryId: 'study', minutes: 1 }]);
  const documents = await first.getDocumentsForUpload('webdav:one');
  assert.equal(documents.length, 1);
  assert.equal(documents[0].value.text, '');
  assert.equal(await second.mergeSyncDocuments(documents), 1);
  assert.equal((await second.getMinuteEntry(day, 300)).text, '');
  assert.equal((await second.getCategoryTimeTotals(day, day))[0].minutes, 1);
  assert.equal((await second.getPendingInlineMinuteLinks()).length, 1,
    'A winning peer minute queues an exact account-link retry, without a native-calendar outbox');
  assert.equal((await second.getPendingSyncDates()).length, 0);
});

test('restoring a conflicting color-only minute retains its blank text and creates a winning revision', async (t) => {
  const { api } = createRepository(t);
  await api.initializeDatabase();
  await api.saveMinuteRange({ dateKey: day, startMinute: 310, durationMinutes: 1,
    text: '', categoryId: 'study', allowEmptyText: true });
  const local = (await api.getSyncDocuments('minute:'))[0];
  const remote = { key: local.key, revision: revision(Date.now() + 60_000, 12),
    value: value(310, 'Another phone text', { categoryId: 'work' }) };
  await api.mergeSyncDocuments([remote]);
  const conflict = (await api.getLedgerConflicts())[0];
  assert.equal(conflict.value.text, '');
  await api.restoreLedgerConflict(conflict);
  const restored = await api.getMinuteEntry(day, 310);
  assert.equal(restored.text, '');
  assert.equal(restored.categoryId, 'study');
  const document = (await api.getSyncDocuments('minute:'))[0];
  assert.equal(document.value.text, '');
  assert.ok(document.revision > remote.revision);
  assert.equal((await api.getLedgerConflicts()).length, 0);
});

test('only winning peer minutes and tombstones queue durable exact account links without native-calendar writes', async (t) => {
  const { api } = createRepository(t); await api.initializeDatabase();
  const incoming = { key: minuteKey(700), revision: revision(1000, 0, 'browser_actor'), value: value(700, 'Browser thought') };
  await api.mergeSyncDocuments([incoming]);
  let tickets = await api.getPendingInlineMinuteLinks(); assert.equal(tickets.length, 1);
  assert.equal(tickets[0].dateKey, day); assert.equal(tickets[0].minuteIndex, 700);
  assert.deepEqual(plain(tickets[0].affectedDates), [day]); assert.equal((await api.getPendingSyncDates()).length, 0);
  await api.acknowledgeInlineMinuteLink(tickets[0]);
  await api.mergeSyncDocuments([incoming]);
  await api.mergeSyncDocuments([{ ...incoming, revision: revision(999, 0, 'browser_actor'), value: value(700, 'Older peer thought') }]);
  await api.mergeSyncDocuments([{ key: 'category:browser_label', revision: revision(1001, 0, 'browser_actor'), value: { name: 'Label' } }]);
  assert.equal((await api.getPendingInlineMinuteLinks()).length, 0, 'identical, losing and metadata records cannot create new link intent');
  await api.mergeSyncDocuments([{ ...incoming, revision: revision(1002, 0, 'browser_actor'), value: null }]);
  tickets = await api.getPendingInlineMinuteLinks(); assert.equal(tickets.length, 1); assert.equal(tickets[0].minuteIndex, 700);
  assert.equal(await api.getMinuteEntry(day, 700), null); assert.equal((await api.getPendingSyncDates()).length, 0);
});

test('a rejected peer batch rolls back newly queued account links with its notes and journal', async (t) => {
  const { api, sqlite } = createRepository(t); await api.initializeDatabase();
  const documents = plain(await api.getSyncDocuments(''));
  await assert.rejects(api.mergeSyncDocuments([
    { key: minuteKey(710), revision: revision(1000, 0, 'browser_actor'), value: value(710, 'Must roll back') },
    { key: minuteKey(711), revision: revision(1000, 1, 'browser_actor'), value: value(712, 'Wrong coordinate') },
  ]), /Invalid synchronized minute/);
  assert.equal(await api.getMinuteEntry(day, 710), null); assert.equal((await api.getPendingInlineMinuteLinks()).length, 0);
  assert.equal((await api.getPendingSyncDates()).length, 0); assert.deepEqual(plain(await api.getSyncDocuments('')), documents);
  assert.equal(sqlite.prepare('SELECT importing FROM ledger_clock WHERE id=1').get().importing, 0);
});

test('legacy inline-ticket migration preserves local intent and imported-account requirements survive a coalesced local edit', async (t) => {
  const { api, sqlite } = createRepository(t);
  sqlite.exec(`CREATE TABLE inline_minute_link_outbox (date_key TEXT NOT NULL, minute_index INTEGER NOT NULL,
    affected_dates_json TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY(date_key,minute_index))`);
  sqlite.prepare('INSERT INTO inline_minute_link_outbox VALUES (?,?,?,?)').run(day, 100, JSON.stringify([day]), 'legacy-token');
  await api.initializeDatabase();
  let tickets = await api.getPendingInlineMinuteLinks(); assert.equal(tickets[0].token, 'legacy-token');
  assert.equal(tickets[0].requiresAccountWriter, undefined);
  await api.mergeSyncDocuments([{ key: minuteKey(720), revision: revision(Date.now() + 1000, 0, 'browser_actor'), value: value(720, 'Browser edit') }]);
  const imported = (await api.getPendingInlineMinuteLinks()).find((ticket) => ticket.minuteIndex === 720);
  assert.equal(imported.requiresAccountWriter, true);
  await api.saveMinuteRange({ dateKey: day, startMinute: 720, durationMinutes: 1, text: 'Latest local revision', categoryId: 'study', queueInlineLink: true });
  tickets = await api.getPendingInlineMinuteLinks(); const latest = tickets.find((ticket) => ticket.minuteIndex === 720);
  assert.equal(latest.requiresAccountWriter, true); assert.notEqual(latest.token, imported.token);
  assert.equal(await api.acknowledgeInlineMinuteLink(imported), false);
  assert.equal(await api.deferInlineMinuteLink(imported), false, 'a stale defer cannot rotate or replace newer intent');
  assert.equal(await api.deferInlineMinuteLink(latest), true);
  assert.equal((await api.getPendingInlineMinuteLinks()).find((ticket) => ticket.minuteIndex === 720).token, latest.token);
  await api.initializeDatabase(); assert.equal((await api.getPendingInlineMinuteLinks()).find((ticket) => ticket.minuteIndex === 720).requiresAccountWriter, true);
});

test('a page of native-review local tickets cannot starve newer local borders or peer work, and stays exactly retryable', async (t) => {
  const { api, sqlite } = createRepository(t); await api.initializeDatabase();
  const insert = sqlite.prepare(`INSERT INTO inline_minute_link_outbox
    (date_key, minute_index, affected_dates_json, token, requires_account_writer) VALUES (?, ?, ?, ?, ?)`);
  for (let minute = 0; minute < 100; minute++) {
    insert.run(day, minute, JSON.stringify([day, '2026-10-26']), `native-review-${minute}`, 0);
    await api.saveSyncBinding({ dateKey: day, segmentKey: `native-${minute}:0-0`, blockId: `native-${minute}`,
      calendarId: 'exact-native-calendar', eventId: `exact-native-event-${minute}` });
  }
  insert.run(day, 300, JSON.stringify([day]), 'peer-work', 1);
  insert.run(day, 400, JSON.stringify([day]), 'new-local-border', 0);
  const bindings = plain(await api.getSyncBindings(day));
  const blocked = await api.getPendingInlineMinuteLinks();
  assert.equal(blocked.length, 100); assert.ok(blocked.every((ticket) => ticket.minuteIndex < 100));
  assert.equal(await api.deferInlineMinuteLink(blocked[0]), false, 'ordinary failure deferral cannot promote a local edit');
  for (const ticket of blocked) assert.equal(await api.promoteInlineMinuteLinkForAccountReview(ticket), true);
  const next = await api.getPendingInlineMinuteLinks();
  assert.deepEqual(next.slice(0, 2).map((ticket) => ticket.minuteIndex), [400, 300]);
  const all = await api.getPendingInlineMinuteLinks(500);
  assert.equal(all.length, 102, 'review deferral acknowledges or drops no work');
  for (const previous of blocked) {
    const current = all.find((ticket) => ticket.minuteIndex === previous.minuteIndex);
    assert.equal(current.token, previous.token); assert.equal(current.requiresAccountWriter, true);
    assert.deepEqual(plain(current.affectedDates), [day, '2026-10-26']);
  }
  assert.deepEqual(plain(await api.getSyncBindings(day)), bindings);
  assert.equal((await api.getPendingSyncDates()).length, 0, 'review rotation never invents a native-calendar write');
  assert.equal((await api.getSyncDocuments('minute:')).length, 0);
});

test('native-review promotion is token guarded and a later coalesced edit retains its review requirement', async (t) => {
  const { api, sqlite } = createRepository(t); await api.initializeDatabase();
  await api.saveMinuteRange({ dateKey: day, startMinute: 210, durationMinutes: 1, text: 'Earlier thought', categoryId: 'study', queueInlineLink: true });
  const previous = (await api.getPendingInlineMinuteLinks())[0];
  await api.saveMinuteRange({ dateKey: day, startMinute: 210, durationMinutes: 1, text: 'Newer thought', categoryId: 'study', queueInlineLink: true });
  const before = plain(sqlite.prepare('SELECT rowid, * FROM inline_minute_link_outbox').all());
  assert.equal(await api.promoteInlineMinuteLinkForAccountReview(previous), false);
  assert.deepEqual(plain(sqlite.prepare('SELECT rowid, * FROM inline_minute_link_outbox').all()), before);
  const latest = (await api.getPendingInlineMinuteLinks())[0];
  assert.equal(await api.promoteInlineMinuteLinkForAccountReview(latest), true);
  await api.saveMinuteRange({ dateKey: day, startMinute: 210, durationMinutes: 1, text: 'Typed after review', categoryId: 'study', queueInlineLink: true });
  const current = (await api.getPendingInlineMinuteLinks())[0];
  assert.equal(current.requiresAccountWriter, true); assert.notEqual(current.token, latest.token);
  const row = plain(sqlite.prepare('SELECT rowid, * FROM inline_minute_link_outbox').all());
  assert.equal(await api.promoteInlineMinuteLinkForAccountReview(latest), false);
  assert.deepEqual(plain(sqlite.prepare('SELECT rowid, * FROM inline_minute_link_outbox').all()), row);
  assert.equal((await api.getMinuteEntry(day, 210)).text, 'Typed after review');
});

test('inline link tickets are scoped to explicit edits and stale acknowledgements retain newer work', async (t) => {
  const { api } = createRepository(t);
  await api.initializeDatabase();
  await save(api, 320, 'An older ordinary entry');
  assert.equal((await api.getPendingSyncDates()).length, 1);
  assert.equal((await api.getPendingInlineMinuteLinks()).length, 0);
  await api.saveMinuteRange({ dateKey: day, startMinute: 321, durationMinutes: 1,
    text: 'First inline text', categoryId: 'study', queueInlineLink: true });
  const first = (await api.getPendingInlineMinuteLinks())[0];
  await api.saveMinuteRange({ dateKey: day, startMinute: 321, durationMinutes: 1,
    text: 'Newer inline text', categoryId: 'study', queueInlineLink: true });
  const newer = (await api.getPendingInlineMinuteLinks())[0];
  assert.notEqual(newer.token, first.token);
  assert.equal(await api.acknowledgeInlineMinuteLink(first), false);
  assert.equal((await api.getPendingInlineMinuteLinks())[0].token, newer.token);
  assert.equal(await api.acknowledgeInlineMinuteLink(newer), true);
  await api.deleteMinuteEntry(day, 321, { queueInlineLink: true });
  const deletion = (await api.getPendingInlineMinuteLinks())[0];
  assert.equal(deletion.dateKey, day);
  assert.equal(deletion.minuteIndex, 321);
  assert.equal(await api.getMinuteEntry(day, 321), null);
  assert.equal((await api.getSyncDocuments('minute:')).find((item) => item.key === minuteKey(321)).value, null);
  assert.equal(await api.acknowledgeInlineMinuteLink(newer), false);
  assert.equal(await api.acknowledgeInlineMinuteLink(deletion), true);
  assert.equal((await api.getPendingInlineMinuteLinks()).length, 0);
});

test('newer inline tickets preserve dates touched by an unacknowledged cross-midnight merge', async (t) => {
  const { api } = createRepository(t);
  await api.initializeDatabase();
  const previous = '2026-10-24';
  await api.saveMinuteRange({ dateKey: previous, startMinute: 1438, durationMinutes: 1,
    text: 'Earlier', categoryId: 'study' });
  await save(api, 0, 'Following');
  const affected = await api.saveMinuteRange({ dateKey: previous, startMinute: 1439, durationMinutes: 1,
    text: 'Bridge midnight', categoryId: 'study', queueInlineLink: true });
  assert.deepEqual(plain(affected), [previous, day]);
  const before = (await api.getPendingInlineMinuteLinks())[0];
  await api.saveMinuteRange({ dateKey: previous, startMinute: 1439, durationMinutes: 1,
    text: 'Change only this minute', categoryId: 'work', queueInlineLink: true });
  const after = (await api.getPendingInlineMinuteLinks())[0];
  assert.deepEqual(plain(after.affectedDates), [previous, day]);
  assert.equal(await api.acknowledgeInlineMinuteLink(before), false);
  assert.equal((await api.getPendingInlineMinuteLinks())[0].token, after.token);
});

test('an inline link queue failure rolls back its minute, journal, and device outbox atomically', async (t) => {
  const { api, sqlite } = createRepository(t);
  await api.initializeDatabase();
  sqlite.exec(`CREATE TRIGGER reject_inline_link BEFORE INSERT ON inline_minute_link_outbox
    BEGIN SELECT RAISE(ABORT, 'inline link queue unavailable'); END;`);
  await assert.rejects(api.saveMinuteRange({ dateKey: day, startMinute: 330, durationMinutes: 1,
    text: 'Must be atomic', categoryId: 'study', queueInlineLink: true }), /inline link queue unavailable/);
  assert.equal(await api.getMinuteEntry(day, 330), null);
  assert.equal((await api.getSyncDocuments('minute:')).length, 0);
  assert.equal((await api.getPendingSyncDates()).length, 0);
  assert.equal((await api.getPendingInlineMinuteLinks()).length, 0);
  await save(api, 331, 'Keep this if deleting fails');
  const before = plain(await api.getSyncDocuments('minute:'));
  await assert.rejects(api.deleteMinuteEntry(day, 331, { queueInlineLink: true }), /inline link queue unavailable/);
  assert.equal((await api.getMinuteEntry(day, 331)).text, 'Keep this if deleting fails');
  assert.deepEqual(plain(await api.getSyncDocuments('minute:')), before);
});


test('source imports keep a legacy event title outside blank minute notes and preserve its ID through manual note/category changes', async(t)=>{
  const {api}=createRepository(t);await api.initializeDatabase();const block='legacy_dental';
  await api.replaceProjectedMinutes({blockId:block,previousDate:day,previousStart:530,previousEnd:532,activityTitle:'Dentist',
    entries:[530,531,532].map(minuteIndex=>({dateKey:day,minuteIndex,text:'',categoryId:'work'}))});
  assert.ok((await api.getDayEntries(day)).every(e=>e.text===''&&e.blockId===block));
  assert.equal((await api.getDaySegments(day))[0].activityTitle,'Dentist');
  await api.saveMinuteEntry({dateKey:day,minuteIndex:531,text:'Ask about filling',categoryId:'family'});
  assert.equal((await api.getMinuteEntry(day,531)).blockId,block);
  await api.saveMinuteRange({dateKey:day,startMinute:531,durationMinutes:1,text:'',categoryId:'family',allowEmptyText:true});
  assert.equal((await api.getMinuteEntry(day,531)).blockId,block);
  assert.equal(await api.getActivityTitleForEntries(await api.getEntriesForBlock(block)),'Dentist');
  await api.saveMinuteEntry({dateKey:day,minuteIndex:529,text:'Separate same-color note',categoryId:'work'});
  assert.notEqual((await api.getMinuteEntry(day,529)).blockId,block);
});

test('a moved source import atomically clears reviewed old styles, preserves destination style, remaps exact binding and receipts without calendar echo',async(t)=>{
  const {api,sqlite}=createRepository(t);await api.initializeDatabase();const block='legacy_dental';
  await api.replaceProjectedMinutes({blockId:block,previousDate:day,previousStart:530,previousEnd:531,activityTitle:'Dentist',
    entries:[530,531].map(minuteIndex=>({dateKey:day,minuteIndex,text:'',categoryId:'work'}))});
  const old=(await api.getSpreadsheetCells({dateKey:day,startMinute:530,endMinute:531}));
  await api.putSyncDocument(`category:minuteFormat:${day}:530`,{kind:'minuteFormat',format:{...old[0].format,bold:true,noFill:true}});
  await api.putSyncDocument(`category:minuteFormat:${day}:560`,{kind:'minuteFormat',format:{italic:true,noFill:true}});
  await api.saveSyncBinding({segmentKey:`${day}:${block}:530-531`,blockId:block,dateKey:day,calendarId:'cal',eventId:'exact'});
  const expectedBinding=(await api.getSyncBindings(day))[0];
  const snapshots=[...(await api.getSpreadsheetCells({dateKey:day,startMinute:530,endMinute:531})),...(await api.getSpreadsheetCells({dateKey:day,startMinute:560,endMinute:561}))]
    .map(cell=>({dateKey:day,...cell}));
  let guardCalls=0;
  await api.replaceProjectedMinutes({blockId:block,previousDate:day,previousStart:530,previousEnd:531,
    expectedEntries:await api.getEntriesForBlock(block),expectedActivityTitle:'Dentist',activityTitle:'Dental appointment',
    expectedFormats:snapshots,clearPreviousFormats:true,beforeCommitGuard:()=>{guardCalls++;},expectedBinding,
    nextBinding:{...expectedBinding,segmentKey:`${day}:${block}:560-561`},
    localReceipt:{key:'calendar.native-write.v1.cal.exact',value:{version:2,sourceTitle:'Dental appointment'}},
    entries:[560,561].map(minuteIndex=>({dateKey:day,minuteIndex,text:'',categoryId:'work'}))});
  assert.equal(guardCalls,3);assert.equal(await api.getMinuteEntry(day,530),null);
  const oldDoc=(await api.getSyncDocuments(`category:minuteFormat:${day}:530`))[0];assert.equal(oldDoc.value,null);
  const dest=(await api.getSpreadsheetCells({dateKey:day,startMinute:560,endMinute:560}))[0];
  assert.deepEqual(plain(dest.format),{italic:true,calendarEvent:{id:block,title:'Dental appointment'}});
  assert.equal(dest.entry.text,'');assert.equal((await api.getSyncBindings(day))[0].segmentKey,`${day}:${block}:560-561`);
  assert.equal((await api.getSetting('calendar.native-write.v1.cal.exact',null)).sourceTitle,'Dental appointment');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get().n,0);
  assert.equal((await api.getPendingInlineMinuteLinks()).length,0);
});

test('source import rejects formatting ABA, changed binding and late raw-draft edits without partial note/title/receipt changes',async(t)=>{
  for(const changed of ['format-aba','binding','late-draft']){
    const {api,sqlite}=createRepository(t);await api.initializeDatabase();const block='legacy_guard';
    await api.replaceProjectedMinutes({blockId:block,previousDate:day,previousStart:700,previousEnd:700,activityTitle:'Dentist',
      entries:[{dateKey:day,minuteIndex:700,text:'Original note',categoryId:'work'}]});
    await api.saveSyncBinding({segmentKey:`${day}:${block}:700-700`,blockId:block,dateKey:day,calendarId:'cal',eventId:'exact'});
    const expectedBinding=(await api.getSyncBindings(day))[0],expectedEntries=await api.getEntriesForBlock(block);
    const expectedFormats=[...(await api.getSpreadsheetCells({dateKey:day,startMinute:700,endMinute:701}))].map(cell=>({dateKey:day,...cell}));
    if(changed==='format-aba'){await api.putSyncDocument(`category:minuteFormat:${day}:701`,{kind:'minuteFormat',format:{bold:true}});await api.putSyncDocument(`category:minuteFormat:${day}:701`,null);}
    if(changed==='binding')sqlite.prepare('UPDATE sync_bindings SET event_id=?').run('new-owned-event');
    const before=plain(await api.getSyncDocuments(''));let calls=0;
    await assert.rejects(api.replaceProjectedMinutes({blockId:block,previousDate:day,previousStart:700,previousEnd:700,expectedEntries,
      expectedActivityTitle:'Dentist',activityTitle:'Renamed',expectedFormats,clearPreviousFormats:true,expectedBinding,
      nextBinding:{...expectedBinding,segmentKey:`${day}:${block}:701-701`},
      localReceipt:{key:'calendar.native-write.v1.cal.exact',value:{version:2}},beforeCommitGuard:()=>{if(changed==='late-draft'&&++calls===3)throw Error('Raw draft changed');},
      entries:[{dateKey:day,minuteIndex:701,text:'',categoryId:'work'}]}),/changed/);
    assert.deepEqual(plain(await api.getSyncDocuments('')),before);assert.equal((await api.getMinuteEntry(day,700)).text,'Original note');
    assert.equal(await api.getMinuteEntry(day,701),null);assert.equal(await api.getSetting('calendar.native-write.v1.cal.exact',null),null);
  }
});

test('late peer border metadata and its removal queue account-only linking after the minute ticket was already acknowledged',async(t)=>{
  const {api,sqlite}=createRepository(t);await api.initializeDatabase();const key=`category:minuteFormat:${day}:530`;
  await api.mergeSyncDocuments([{key:minuteKey(530),revision:revision(100),value:value(530,'Private note',{blockId:'legacy_border'})}]);
  for(const ticket of await api.getPendingInlineMinuteLinks())await api.acknowledgeInlineMinuteLink(ticket);
  await api.mergeSyncDocuments([{key,revision:revision(200),value:{kind:'minuteFormat',format:{calendarEvent:{id:'legacy_border',title:'Dental'}}}}]);
  let tickets=await api.getPendingInlineMinuteLinks();assert.equal(tickets.length,1);assert.equal(tickets[0].requiresAccountWriter,true);assert.equal(tickets[0].minuteIndex,530);
  await api.acknowledgeInlineMinuteLink(tickets[0]);
  await api.mergeSyncDocuments([{key,revision:revision(150),value:{kind:'minuteFormat',format:{calendarEvent:{id:'legacy_border',title:'Stale'}}}}]);
  assert.equal((await api.getPendingInlineMinuteLinks()).length,0);
  await api.mergeSyncDocuments([{key,revision:revision(300),value:{kind:'minuteFormat',format:{calendarEvent:{id:'legacy_border',title:'Dental'},bold:true}}}]);
  assert.equal((await api.getPendingInlineMinuteLinks()).length,0,'ordinary formatting does not reschedule a calendar event');
  await api.mergeSyncDocuments([{key,revision:revision(400),value:null}]);tickets=await api.getPendingInlineMinuteLinks();assert.equal(tickets.length,1);assert.equal(tickets[0].requiresAccountWriter,true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get().n,0);
});


test('one exact event border coalesces different minute colors while adjacent unbordered or differently titled legacy rows stay separate',async(t)=>{
 const {api}=createRepository(t);await api.initializeDatabase();const block='legacy_shared';
 const entries=[100,101,102,103,104].map((minuteIndex,i)=>({key:minuteKey(minuteIndex),revision:revision(500,i),value:value(minuteIndex,`Note ${minuteIndex}`,{blockId:block,categoryId:i%2?'family':'work'})}));
 await api.mergeSyncDocuments(entries);
 for(const [minute,title] of [[100,'Dentist'],[101,'Dentist'],[102,'Travel'],[103,'Travel']]){
  await api.putSyncDocument(`category:minuteFormat:${day}:${minute}`,{kind:'minuteFormat',format:{calendarEvent:{id:block,title}}});
 }
 const segments=await api.getDaySegments(day);assert.deepEqual(plain(segments.map(x=>[x.startMinute,x.endMinute,x.activityTitle??null])),[[100,101,'Dentist'],[102,103,'Travel'],[104,104,null]]);
 assert.deepEqual((await api.getDayEntries(day)).map(x=>x.categoryId),['work','family','work','family','work']);
 assert.deepEqual(plain(await api.getDayCalendarSegments(day)),plain(segments));
});
