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
  sqlite.prepare('INSERT INTO inline_minute_link_outbox VALUES (?, ?, ?, ?)').run(day, 100, JSON.stringify([day]), 'prior-link-token');
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
  assert.equal((await second.getPendingInlineMinuteLinks()).length, 0,
    'Importing another phone does not invent a new local inline-link intent');
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
