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
