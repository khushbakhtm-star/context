const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const plain = (value) => JSON.parse(JSON.stringify(value));
const day = '2026-10-25';
const { setImmediate } = require('node:timers/promises');

function harness(t) {
  const sqlite = new DatabaseSync(':memory:');
  let onRunAsync;
  const linkCalls = [];
  t.after(() => sqlite.close());
  const native = {
    async execAsync(sql) { sqlite.exec(sql); },
    async runAsync(sql, ...params) { if (onRunAsync) await onRunAsync(sql, params);
      const result = sqlite.prepare(sql).run(...params); return { changes: result.changes }; },
    async getFirstAsync(sql, ...params) { return sqlite.prepare(sql).get(...params) ?? null; },
    async getAllAsync(sql, ...params) { return sqlite.prepare(sql).all(...params); },
    async withExclusiveTransactionAsync(work) { sqlite.exec('BEGIN IMMEDIATE'); try { await work(native); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
  };
  const cache = new Map();
  const source = (file) => path.join(__dirname, '../src', file);
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    cache.set(filename, module.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInContext(code, vm.createContext({ module, exports: module.exports, console, Date, Math, Intl,
      Map, Set, Promise, Error, TypeError, RangeError, TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout,
      require(name) {
        if (name === 'expo-sqlite') return { openDatabaseAsync: async () => native };
        if (name === 'expo-crypto') return { randomUUID: crypto.randomUUID };
        if (name.startsWith('@noble/')) return require(name);
        if (!name.startsWith('.')) throw new Error(`Unexpected sheet import: ${name}`);
        const file = path.resolve(path.dirname(filename), `${name}.ts`);
        if (file === source('sync/engine.ts')) return { linkActualsToAccounts: async (...args) => { linkCalls.push(args); }, synchronizeAccounts: async () => {} };
        if (file === source('sync/accounts.ts')) return { accountFetch: async () => { throw new Error('Unexpected account request'); } };
        if (file === source('sync/providers.ts')) return { createCalendarAdapter: () => { throw new Error('Unexpected calendar request'); } };
        return load(file);
      },
    }), { filename });
    cache.set(filename, module.exports);
    return module.exports;
  }
  const api = load(source('data/database.ts'));
  const sheet = load(source('services/spreadsheet.ts'));
  const inline = load(source('services/inline-minutes.ts'));
  t.after(async () => { await inline.flushInlineMinutes(); });
  return { api, sheet, inline, sqlite, load, source, linkCalls, set onRunAsync(callback) { onRunAsync = callback; } };
}
const range = (startMinute, endMinute = startMinute, dateKey = day) => ({ dateKey, startMinute, endMinute });
async function save(api, minuteIndex, text, categoryId = 'study') {
  await api.saveMinuteEntry({ dateKey: day, minuteIndex, text, categoryId });
}
function activate(inline, minuteIndex, text, categoryId = 'study') {
  inline.inlineMinuteDrafts.activate({ dateKey: day, minuteIndex, text, categoryId, keepColor: false });
}

test('format-only blank cells do not record time and pass the released encrypted-ledger whitelist', async (t) => {
  const a = harness(t); const b = harness(t);
  await a.api.initializeDatabase(); await b.api.initializeDatabase();
  await a.sheet.applyCellFormat(range(30, 32), { bold: true, italic: true, textColor: '#aabbcc' });
  assert.equal((await a.api.getDayEntries(day)).length, 0);
  assert.equal((await a.api.getCategoryTimeTotals(day, day)).length, 0);
  const docs = await a.api.getSyncDocuments('category:minuteFormat:');
  assert.equal(docs.length, 3);
  const codec = a.load(a.source('sync/codec.ts'));
  codec.validateBatch({ version: 1, id: 'format_batch', documents: plain(docs) });
  await b.api.mergeSyncDocuments(plain(docs));
  assert.deepEqual(plain((await b.sheet.getDayCellFormats(day)).get(31)), { bold: true, italic: true, textColor: '#AABBCC' });
  assert.equal((await b.api.getDayEntries(day)).length, 0);
  const categories = b.load(b.source('services/categories.ts'));
  const listed = await categories.listCategories();
  assert.ok(listed.length >= 9, 'format metadata alone must not prevent default activity seeding');
  assert.equal(listed.some((item) => item.kind === 'minuteFormat'), false);
});

test('typing Undo flushes the latest raw draft, restores it, and invalidates Redo after a new edit', async (t) => {
  const { api, sheet, inline } = harness(t); await api.initializeDatabase();
  await save(api, 60, 'Original'); activate(inline, 60, 'Original');
  sheet.editInlineMinute(day, 60, { text: 'First ' });
  sheet.editInlineMinute(day, 60, { text: 'Latest thought  ' });
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 60)).text, 'Original');
  assert.equal(inline.inlineMinuteDrafts.get(day, 60).text, 'Original');
  await sheet.redoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 60)).text, 'Latest thought');
  assert.equal(inline.inlineMinuteDrafts.get(day, 60).text, 'Latest thought  ');
  await sheet.undoSpreadsheetEdit();
  sheet.editInlineMinute(day, 60, { text: 'New branch' });
  assert.equal(sheet.spreadsheetEditor.snapshot().canRedo, false);
  await inline.flushInlineMinutes();
  assert.equal((await api.getMinuteEntry(day, 60)).text, 'New branch');
});

test('repeated typing and Undo on a planned-but-unrecorded minute never invents a recorded plan', async (t) => {
  const { api, sheet, inline } = harness(t); await api.initializeDatabase();
  activate(inline, 75, 'Planned title');
  sheet.editInlineMinute(day, 75, { text: 'What happened' });
  await sheet.undoSpreadsheetEdit();
  assert.equal(await api.getMinuteEntry(day, 75), null);
  assert.equal(inline.inlineMinuteDrafts.get(day, 75).text, 'Planned title');
  sheet.editInlineMinute(day, 75, { text: 'Another actual' });
  await sheet.undoSpreadsheetEdit();
  assert.equal(await api.getMinuteEntry(day, 75), null);
});

test('fill copies content, activity color and format; Undo restores blank and occupied cells without touching another date', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 100, 'Source', 'work'); await save(api, 101, 'Keep old note', 'study'); await save(api, 103, 'Outside');
  await api.saveMinuteEntry({ dateKey: '2026-10-26', minuteIndex: 101, text: 'Tomorrow', categoryId: 'family' });
  await sheet.applyCellFormat(range(100), { bold: true, textColor: '#551122' });
  await sheet.applyCellFormat(range(102), { italic: true });
  await sheet.fillMinuteRange(range(100, 102), 100);
  const entries = (await api.getDayEntries(day)).filter((entry) => entry.minuteIndex <= 102);
  assert.equal(entries.length, 3);
  assert.equal(new Set(entries.map((entry) => entry.blockId)).size, 1, 'fill keeps the original source block ownership');
  assert.ok(entries.every((entry) => entry.text === 'Source' && entry.categoryId === 'work'));
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(102)), { bold: true, textColor: '#551122' });
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 101)).text, 'Keep old note');
  assert.equal(await api.getMinuteEntry(day, 102), null);
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(102)), { italic: true });
  assert.equal((await api.getMinuteEntry(day, 103)).text, 'Outside');
  assert.equal((await api.getMinuteEntry('2026-10-26', 101)).text, 'Tomorrow');
  await sheet.redoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 102)).text, 'Source');
});

test('a format write failure rolls back the entire fill, journal and calendar-link queue', async (t) => {
  const { api, sheet, sqlite } = harness(t); await api.initializeDatabase();
  await save(api, 200, 'Source', 'work'); await save(api, 201, 'Original', 'study');
  sqlite.exec(`CREATE TRIGGER reject_sheet_format BEFORE INSERT ON ledger_documents
    WHEN NEW.key = 'category:minuteFormat:2026-10-25:201' BEGIN SELECT RAISE(ABORT, 'injected format failure'); END;`);
  const before = plain(await api.getSyncDocuments(''));
  await assert.rejects(sheet.fillMinuteRange(range(200, 202), 200), /injected format failure/);
  assert.equal((await api.getMinuteEntry(day, 201)).text, 'Original');
  assert.equal(await api.getMinuteEntry(day, 202), null);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before);
  assert.equal((await api.getPendingInlineMinuteLinks()).length, 0);
});

test('drag Auto fill copies the current 17:19 anchor downward and upward without changing its activity color', async (t) => {
  for (const selection of [
    { direction: 'downward', start: 1039, end: 1042, occupied: 1040 },
    { direction: 'upward', start: 1036, end: 1039, occupied: 1037 },
  ]) {
    const { api, sheet, inline } = harness(t);
    await api.initializeDatabase();
    await save(api, 1039, 'Previous anchor text', 'work');
    await save(api, selection.occupied, 'Keep this separate thought', 'family');
    await save(api, 1043, 'Outside the selection', 'study');
    activate(inline, 1039, 'Previous anchor text', 'work');
    sheet.editInlineMinute(day, 1039, { text: 'Read Codex' });
    assert.equal((await api.getMinuteEntry(day, 1039)).text, 'Previous anchor text',
      `${selection.direction}: the newest anchor text starts as an uncommitted draft`);

    // The original 17:19 source remains fixed even when the selected range is
    // normalized to 17:16–17:19 after dragging upward. No color choice is supplied.
    await sheet.fillMinuteRange(range(selection.start, selection.end), 1039);
    const filled = (await api.getDayEntries(day)).filter((entry) =>
      entry.minuteIndex >= selection.start && entry.minuteIndex <= selection.end);
    assert.equal(filled.length, 4, selection.direction);
    assert.ok(filled.every((entry) => entry.text === 'Read Codex'), selection.direction);
    assert.ok(filled.every((entry) => entry.categoryId === 'work'),
      `${selection.direction}: Auto fill keeps the anchor activity without requesting a new color`);
    assert.equal((await api.getMinuteEntry(day, 1043)).text, 'Outside the selection');

    await sheet.undoSpreadsheetEdit();
    for (let minute = selection.start; minute <= selection.end; minute += 1) {
      const restored = await api.getMinuteEntry(day, minute);
      if (minute === 1039) {
        assert.equal(restored.text, 'Read Codex', 'Undoing the fill retains the separately committed anchor edit');
        assert.equal(restored.categoryId, 'work');
      } else if (minute === selection.occupied) {
        assert.equal(restored.text, 'Keep this separate thought');
        assert.equal(restored.categoryId, 'family');
      } else {
        assert.equal(restored, null, `${selection.direction}: minute ${minute} is blank again`);
      }
    }
  }
});

test('an explicit Google color fills source notes and formats, preserving legacy two-argument behavior and Undo', async (t) => {
  const device = harness(t); const { api, sheet } = device;
  await api.initializeDatabase();
  const categories = device.load(device.source('services/categories.ts'));
  await categories.listCategories();
  await api.putSyncDocument('category:legacy', { id: 'legacy', name: 'Old color', color: '#112233' });
  await save(api, 220, 'Make coffee', 'legacy'); await save(api, 221, 'Original note', 'study');
  await save(api, 223, 'Outside range', 'family');
  await sheet.applyCellFormat(range(220), { bold: true, textColor: '#551122' });
  await assert.rejects(sheet.fillMinuteRange(range(220, 222), 220, 'legacy'), /Google Calendar color/);
  assert.equal((await api.getMinuteEntry(day, 221)).text, 'Original note');
  await sheet.fillMinuteRange(range(220, 222), 220, 'prayer');
  const filled = (await api.getDayEntries(day)).filter((entry) => entry.minuteIndex >= 220 && entry.minuteIndex <= 222);
  assert.equal(filled.length, 3);
  assert.ok(filled.every((entry) => entry.text === 'Make coffee' && entry.categoryId === 'prayer'));
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(222)), { bold: true, textColor: '#551122' });
  assert.equal((await api.getMinuteEntry(day, 223)).text, 'Outside range');
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 220)).categoryId, 'legacy');
  assert.equal((await api.getMinuteEntry(day, 221)).text, 'Original note');
  assert.equal(await api.getMinuteEntry(day, 222), null);
  await sheet.fillMinuteRange(range(220, 222), 220);
  assert.ok((await api.getDayEntries(day)).filter((entry) => entry.minuteIndex <= 222)
    .every((entry) => entry.categoryId === 'legacy'), 'existing callers still copy the saved source color');
});

test('an explicit Google color on an empty fill source retains notes and records color-only blank minutes', async (t) => {
  const { api, sheet } = harness(t); await api.initializeDatabase();
  await save(api, 231, 'Keep this thought', 'family');
  await sheet.applyCellFormat(range(230), { italic: true });
  await sheet.fillMinuteRange(range(230, 232), 230, 'prayer');
  const filled = await api.getDayEntries(day);
  assert.deepEqual(filled.map((entry) => entry.text), ['', 'Keep this thought', '']);
  assert.ok(filled.every((entry) => entry.categoryId === 'prayer'));
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(232)), { italic: true });
  await sheet.undoSpreadsheetEdit();
  assert.equal(await api.getMinuteEntry(day, 230), null);
  assert.equal((await api.getMinuteEntry(day, 231)).text, 'Keep this thought');
  assert.equal((await api.getMinuteEntry(day, 231)).categoryId, 'family');
  assert.equal(await api.getMinuteEntry(day, 232), null);
  await api.saveMinuteRange({ dateKey: day, startMinute: 230, durationMinutes: 1,
    text: '', categoryId: 'family', allowEmptyText: true });
  await sheet.fillMinuteRange(range(230, 232), 230, 'prayer');
  assert.deepEqual((await api.getDayEntries(day)).map((entry) => entry.text), ['', 'Keep this thought', ''],
    'an explicitly colored but empty source also preserves occupied target notes');
});

test('grouping requires a selectable Google color without changing historical notes or Undo', async (t) => {
  const device = harness(t); const { api, sheet } = device; await api.initializeDatabase();
  await device.load(device.source('services/categories.ts')).listCategories();
  await api.putSyncDocument('category:legacy', { id: 'legacy', name: 'Historical color', color: '#112233' });
  await save(api, 240, 'Keep original note', 'legacy');
  await assert.rejects(sheet.groupMinuteRange(range(240, 242), { title: 'New activity', categoryId: 'legacy' }),
    /Google Calendar color/);
  assert.equal((await api.getMinuteEntry(day, 240)).text, 'Keep original note');
  assert.equal((await api.getMinuteEntry(day, 240)).categoryId, 'legacy');
  assert.equal(await api.getMinuteEntry(day, 241), null);
  await sheet.groupMinuteRange(range(240, 242), { title: 'New activity', categoryId: 'prayer' });
  assert.equal((await api.getMinuteEntry(day, 240)).categoryId, 'prayer');
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 240)).text, 'Keep original note');
  assert.equal((await api.getMinuteEntry(day, 240)).categoryId, 'legacy');
  assert.equal(await api.getMinuteEntry(day, 241), null);
});

test('Undo refuses an externally changed text or source block rather than overwrite it', async (t) => {
  const { api, sheet, inline, sqlite } = harness(t); await api.initializeDatabase();
  await save(api, 300, 'Before'); activate(inline, 300, 'Before');
  sheet.editInlineMinute(day, 300, { text: 'Local edit' });
  await inline.flushInlineMinutes();
  sqlite.prepare('UPDATE minute_entries SET block_id = ? WHERE date_key = ? AND minute_index = ?')
    .run('externally-rebound-source', day, 300);
  await assert.rejects(sheet.undoSpreadsheetEdit(), /selected minute changed/i);
  assert.equal((await api.getMinuteEntry(day, 300)).text, 'Local edit');
  assert.equal((await api.getMinuteEntry(day, 300)).blockId, 'externally-rebound-source');
});

test('clear and Undo restore text and formats, while formatting an empty source fills only formatting', async (t) => {
  const { api, sheet, inline, linkCalls } = harness(t); await api.initializeDatabase();
  await save(api, 400, 'Retain');
  await sheet.applyCellFormat(range(401), { italic: true });
  await sheet.fillMinuteRange(range(400, 402), 401);
  assert.equal((await api.getMinuteEntry(day, 400)).text, 'Retain');
  assert.equal(await api.getMinuteEntry(day, 402), null);
  await sheet.clearMinuteRange(range(400, 402));
  assert.equal((await api.getDayEntries(day)).length, 0);
  assert.equal((await sheet.getDayCellFormats(day)).size, 0);
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 400)).text, 'Retain');
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(400)), { italic: true });
  await inline.flushInlineMinutes();
  assert.ok(linkCalls.length > 0);
  assert.ok(linkCalls.every((args) => args[1] === null), 'sheet commands use ordinary permission-gated linking, never select a new source occurrence');
});

test('a late native typing callback is retained while a formatting transaction is busy', async (t) => {
  const device = harness(t); const { api, sheet, inline } = device;
  await api.initializeDatabase(); await save(api, 450, 'Before'); activate(inline, 450, 'Before');
  let release; const blocked = new Promise((resolve) => { release = resolve; });
  let reached = false;
  device.onRunAsync = async (sql, params) => {
    if (sql.includes('INSERT INTO ledger_documents') && params[0] === 'category:minuteFormat:2026-10-25:450') {
      reached = true; await blocked;
    }
  };
  const formatting = sheet.applyCellFormat(range(450), { bold: true });
  while (!reached) await setImmediate();
  assert.equal(sheet.spreadsheetEditor.snapshot().busy, true);
  sheet.editInlineMinute(day, 450, { text: 'Late keyboard thought' });
  release(); await formatting; device.onRunAsync = undefined;
  await inline.flushInlineMinutes();
  assert.equal((await api.getMinuteEntry(day, 450)).text, 'Late keyboard thought');
  assert.deepEqual(plain((await sheet.getDayCellFormats(day)).get(450)), { bold: true });
});

test('a failed pending text save blocks a range command until the draft can be saved', async (t) => {
  const { api, sheet, inline, sqlite } = harness(t); await api.initializeDatabase();
  await save(api, 500, 'Before'); activate(inline, 500, 'Before');
  sqlite.exec(`CREATE TRIGGER reject_sheet_text BEFORE INSERT ON minute_entries
    WHEN NEW.minute_index = 500 BEGIN SELECT RAISE(ABORT, 'local write unavailable'); END;`);
  sheet.editInlineMinute(day, 500, { text: 'Pending actual' });
  await assert.rejects(sheet.applyCellFormat(range(500, 501), { bold: true }), /has not saved/i);
  assert.equal((await api.getMinuteEntry(day, 500)).text, 'Before');
  assert.equal((await sheet.getDayCellFormats(day)).size, 0);
  assert.equal(inline.inlineMinuteDrafts.get(day, 500).text, 'Pending actual');
  sqlite.exec('DROP TRIGGER reject_sheet_text');
  await inline.flushInlineMinutes();
  await sheet.applyCellFormat(range(500), { textColor: '#123456' });
  assert.equal((await api.getMinuteEntry(day, 500)).text, 'Pending actual');
});

test('an activity groups distinct minute notes and blank members, retaining identity during inline typing and note clearing', async (t) => {
  const { api, sheet, inline } = harness(t); await api.initializeDatabase();
  await save(api, 600, 'Prepare kettle', 'work'); await save(api, 602, 'Drink tea', 'family');
  await sheet.groupMinuteRange(range(600, 602), { title: 'Breakfast', categoryId: 'physiological' });
  let entries = await api.getDayEntries(day);
  assert.deepEqual(entries.map((entry) => entry.text), ['Prepare kettle', '', 'Drink tea']);
  assert.ok(entries.every((entry) => entry.categoryId === 'physiological'));
  const blockId = entries[0].blockId;
  assert.ok(blockId.startsWith('activity_'));
  assert.ok(entries.every((entry) => entry.blockId === blockId));
  activate(inline, 601, '', 'physiological'); sheet.editInlineMinute(day, 601, { text: 'Pour water' });
  await inline.flushInlineMinutes();
  assert.equal((await api.getMinuteEntry(day, 601)).blockId, blockId);
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 601)).text, '');
  assert.equal((await api.getMinuteEntry(day, 601)).blockId, blockId);
  await sheet.redoSpreadsheetEdit();
  sheet.editInlineMinute(day, 601, { text: '' }); await inline.flushInlineMinutes();
  assert.equal((await api.getMinuteEntry(day, 601)).text, '');
  assert.equal((await api.getMinuteEntry(day, 601)).blockId, blockId);
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 601)).text, 'Pour water');
  await sheet.undoSpreadsheetEdit();
  assert.equal((await api.getMinuteEntry(day, 601)).text, '');
  assert.equal((await api.getMinuteEntry(day, 601)).blockId, blockId);
  assert.deepEqual(plain(await sheet.getDayActivityGroups(day)), [{ blockId, dateKey: day,
    startMinute: 600, endMinute: 602, title: 'Breakfast', categoryId: 'physiological' }]);
  assert.equal((await api.getCategoryTimeTotals(day, day)).find((item) => item.categoryId === 'physiological').minutes, 3);
});

test('grouping is undoable, preserves formatting and travels through the released encrypted ledger without becoming a category', async (t) => {
  const a = harness(t); const b = harness(t); await a.api.initializeDatabase(); await b.api.initializeDatabase();
  await save(a.api, 650, 'A thought'); await a.sheet.applyCellFormat(range(650), { italic: true });
  await a.sheet.groupMinuteRange(range(650, 652), { title: 'Reflect', categoryId: 'study' });
  const documents = plain(await a.api.getSyncDocuments(''));
  const codec = a.load(a.source('sync/codec.ts')); codec.validateBatch({ version: 1, id: 'group_batch', documents });
  await b.api.mergeSyncDocuments(documents);
  assert.equal((await b.sheet.getDayActivityGroups(day))[0].title, 'Reflect');
  assert.deepEqual((await b.api.getDayEntries(day)).map((entry) => entry.text), ['A thought', '', '']);
  const categories = b.load(b.source('services/categories.ts'));
  assert.ok((await categories.listCategories()).every((item) => !item.activityGroup));
  await a.sheet.undoSpreadsheetEdit();
  assert.equal((await a.sheet.getDayActivityGroups(day)).length, 0);
  assert.equal((await a.api.getDayEntries(day)).length, 1);
  assert.deepEqual(plain((await a.sheet.getDayCellFormats(day)).get(650)), { italic: true });
  await a.sheet.redoSpreadsheetEdit();
  assert.equal((await a.sheet.getDayActivityGroups(day))[0].title, 'Reflect');
});

test('same-color neighbors stay separate, partial regrouping splits activities, and title-only rename retains identity and queues calendar work', async (t) => {
  const { api, sheet, inline, linkCalls } = harness(t); await api.initializeDatabase();
  await sheet.groupMinuteRange(range(700, 704), { title: 'Study', categoryId: 'study' });
  const originalId = (await api.getMinuteEntry(day, 700)).blockId;
  await save(api, 699, 'Outside before'); await save(api, 705, 'Outside after');
  assert.notEqual((await api.getMinuteEntry(day, 699)).blockId, originalId);
  assert.notEqual((await api.getMinuteEntry(day, 705)).blockId, originalId);
  await sheet.groupMinuteRange(range(701, 703), { title: 'Read paper', categoryId: 'study' });
  let groups = await sheet.getDayActivityGroups(day);
  assert.deepEqual(plain(groups.map((group) => [group.startMinute, group.endMinute, group.title])),
    [[700, 700, 'Study'], [701, 703, 'Read paper'], [704, 704, 'Study']]);
  const middleId = groups[1].blockId;
  await inline.flushInlineMinutes(); const beforeCalls = linkCalls.length;
  await sheet.groupMinuteRange(range(701, 703), { title: 'Read revised paper', categoryId: 'study' });
  await inline.flushInlineMinutes();
  groups = await sheet.getDayActivityGroups(day);
  assert.equal(groups[1].blockId, middleId); assert.equal(groups[1].title, 'Read revised paper');
  assert.ok(linkCalls.length > beforeCalls, 'renaming only the activity must update its calendar event');
  await sheet.undoSpreadsheetEdit();
  assert.equal((await sheet.getDayActivityGroups(day))[1].title, 'Read paper');
  assert.equal((await sheet.getDayActivityGroups(day))[1].blockId, middleId);
});

test('recoloring one grouped minute preserves its note and activity identity while producing separate color segments', async (t) => {
  const { api, sheet, inline } = harness(t); await api.initializeDatabase();
  await sheet.groupMinuteRange(range(800, 804), { title: 'Sleep', categoryId: 'sleep' });
  const blockId = (await api.getMinuteEntry(day, 800)).blockId;
  activate(inline, 802, '', 'sleep');
  sheet.editInlineMinute(day, 802, { text: 'Bathroom break', categoryId: 'physiological', keepColor: true });
  await inline.flushInlineMinutes();
  assert.equal((await api.getMinuteEntry(day, 802)).blockId, blockId);
  assert.deepEqual(plain((await sheet.getDayActivityGroups(day)).map((group) => [group.startMinute, group.endMinute, group.categoryId])),
    [[800, 801, 'sleep'], [802, 802, 'physiological'], [803, 804, 'sleep']]);
  assert.equal((await api.getMinuteEntry(day, 802)).text, 'Bathroom break');
});

test('group metadata and entries commit atomically and group operations reject stale note ownership', async (t) => {
  const device = harness(t); const { api, sheet, sqlite } = device; await api.initializeDatabase();
  await device.load(device.source('services/categories.ts')).listCategories();
  await save(api, 850, 'Keep this');
  sqlite.exec(`CREATE TRIGGER reject_group_label BEFORE INSERT ON ledger_documents
    WHEN NEW.key = 'category:minuteFormat:2026-10-25:851' BEGIN SELECT RAISE(ABORT, 'group label unavailable'); END;`);
  const before = plain(await api.getSyncDocuments(''));
  await assert.rejects(sheet.groupMinuteRange(range(850, 852), { title: 'Group', categoryId: 'work' }), /group label unavailable/);
  assert.deepEqual(plain(await api.getSyncDocuments('')), before);
  assert.equal((await api.getDayEntries(day)).length, 1);
  assert.equal((await api.getMinuteEntry(day, 850)).text, 'Keep this');
  assert.equal((await api.getPendingInlineMinuteLinks()).length, 0);
});

test('clearing a grouped note then immediately recoloring it preserves its blank membership through both Undo steps', async (t) => {
  const { api, sheet, inline } = harness(t); await api.initializeDatabase();
  await save(api, 880, 'Initial note', 'study');
  await sheet.groupMinuteRange(range(880, 882), { title: 'Reading', categoryId: 'study' });
  const blockId = (await api.getMinuteEntry(day, 880)).blockId;
  activate(inline, 880, 'Initial note');
  sheet.editInlineMinute(day, 880, { text: '' });
  sheet.editInlineMinute(day, 880, { categoryId: 'family' });
  await sheet.undoSpreadsheetEdit();
  const blank = await api.getMinuteEntry(day, 880);
  assert.equal(blank.text, ''); assert.equal(blank.categoryId, 'study'); assert.equal(blank.blockId, blockId);
  await sheet.undoSpreadsheetEdit();
  const restored = await api.getMinuteEntry(day, 880);
  assert.equal(restored.text, 'Initial note'); assert.equal(restored.categoryId, 'study'); assert.equal(restored.blockId, blockId);
});
