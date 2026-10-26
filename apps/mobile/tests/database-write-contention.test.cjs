const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { setImmediate } = require('node:timers/promises');
const ts = require('typescript');
const day = '2026-10-26';
const plain = (value) => JSON.parse(JSON.stringify(value));

// Model Expo's real topology: WAL primary reads/direct writes and a NEW connection
// for every exclusive transaction. A held transaction genuinely locks other writers.
function repository(t) {
  const temporary = fs.realpathSync(os.tmpdir());
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(temporary, 'context-sqlite-contention-')));
  const filename = path.join(directory, 'context.db');
  const primary = new DatabaseSync(filename);
  let afterWrite;
  const transactions = new Set();
  function native(connection, transaction = false) {
    return {
      async execAsync(sql) { connection.exec(sql); },
      async runAsync(sql, ...params) {
        const result = connection.prepare(sql).run(...params);
        if (afterWrite) await afterWrite(sql, params, transaction);
        return { changes: result.changes };
      },
      async getFirstAsync(sql, ...params) { return connection.prepare(sql).get(...params) ?? null; },
      async getAllAsync(sql, ...params) { return connection.prepare(sql).all(...params); },
      async withTransactionAsync(work) {
        try { connection.exec('BEGIN'); await work(); connection.exec('COMMIT'); }
        catch (error) { try { connection.exec('ROLLBACK'); } catch {} throw error; }
      },
      async withExclusiveTransactionAsync(work) {
        const other = new DatabaseSync(filename); transactions.add(other);
        try { other.exec('BEGIN'); await work(native(other, true)); other.exec('COMMIT'); }
        catch (error) { try { other.exec('ROLLBACK'); } catch {} throw error; }
        finally { transactions.delete(other); other.close(); }
      },
    };
  }
  const cache = new Map();
  const source = (file) => path.join(__dirname, '../src', file);
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} }; cache.set(filename, module.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, console, Date, Math, Intl,
      Map, Set, Promise, Error, TypeError, RangeError, TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout,
      require(name) {
        if (name === 'expo-sqlite') return { openDatabaseAsync: async () => native(primary) };
        if (name === 'expo-crypto') return { randomUUID: crypto.randomUUID };
        if (name.startsWith('@noble/')) return require(name);
        if (!name.startsWith('.')) throw Error(`Unexpected contention test import: ${name}`);
        const file = path.resolve(path.dirname(filename), `${name}.ts`);
        if (file === source('sync/engine.ts')) return { linkActualsToAccounts: async () => {}, requestAccountSynchronization: () => {} };
        if (file === source('sync/accounts.ts')) return { accountFetch: async () => { throw Error('No network in SQLite tests'); } };
        if (file === source('sync/providers.ts')) return { createCalendarAdapter: () => { throw Error('No calendar in SQLite tests'); } };
        return load(file);
      },
    }, { filename });
    cache.set(filename, module.exports); return module.exports;
  }
  const api = load(source('data/database.ts'));
  const sheet = load(source('services/spreadsheet.ts'));
  const inline = load(source('services/inline-minutes.ts'));
  t.after(async () => {
    try { await inline.flushInlineMinutes(); await inline.retryInlineMinuteLinks({ synchronize: false }); }
    finally {
      for (const connection of transactions) connection.close(); primary.close();
      const resolved = fs.realpathSync(directory);
      assert.equal(path.dirname(resolved), temporary); assert.match(path.basename(resolved), /^context-sqlite-contention-/);
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });
  return { api, sheet, inline, primary, openExternal: () => new DatabaseSync(filename),
    createFacade: () => load(source('data/sqlite-write-gate.ts')).serializeSQLiteWrites(native(primary)),
    set afterWrite(callback) { afterWrite = callback; } };
}
const range = { dateKey: day, startMinute: 90, endMinute: 90 };

test('Undo owns one writer lease while real competing connection writes wait; WAL reads stay available', async (t) => {
  const h = repository(t); await h.api.initializeDatabase();
  await h.api.saveMinuteEntry({ dateKey: day, minuteIndex: 90, text: 'Before edit', categoryId: 'study' });
  await h.sheet.spreadsheetEditor.clear(range);
  assert.equal(await h.api.getMinuteEntry(day, 90), null);
  let release; let entered;
  const held = new Promise((resolve) => { entered = resolve; });
  const unlock = new Promise((resolve) => { release = resolve; });
  let once = false;
  h.afterWrite = async (sql, _params, transaction) => {
    if (transaction && !once && /INSERT INTO minute_entries/.test(sql)) { once = true; entered(); await unlock; }
  };
  const undo = h.sheet.undoSpreadsheetEdit(); await held;
  let settingsDone = false; let metadataDone = false;
  const setting = h.api.setSetting('calendar.color-receipt.test.concurrent', { version: 1 }).then(() => { settingsDone = true; });
  const metadata = h.api.putSyncDocument('category:concurrent', { name: 'Concurrent' }).then(() => { metadataDone = true; });
  const outbox = h.api.markSyncFileSeen('storage', 'file');
  await setImmediate();
  assert.equal(settingsDone, false); assert.equal(metadataDone, false);
  assert.equal(await h.api.getMinuteEntry(day, 90), null, 'WAL primary read sees committed data without joining the held Undo transaction');
  release(); await Promise.all([undo, setting, metadata, outbox]);
  assert.equal((await h.api.getMinuteEntry(day, 90)).text, 'Before edit');
  assert.equal((await h.api.getSetting('calendar.color-receipt.test.concurrent', null)).version, 1);
  assert.equal(await h.api.hasSeenSyncFile('storage', 'file'), true);
  assert.equal(h.sheet.spreadsheetEditor.snapshot().canRedo, true);
});

test('a genuine transaction failure rolls back once and later edits and Undo still work on the same gate', async (t) => {
  const h = repository(t); await h.api.initializeDatabase();
  await h.api.saveMinuteEntry({ dateKey: day, minuteIndex: 90, text: 'Original note', categoryId: 'study' });
  h.primary.exec(`CREATE TRIGGER reject_test_edit BEFORE UPDATE ON minute_entries WHEN NEW.text = 'Reject this edit'
    BEGIN SELECT RAISE(ABORT, 'Simulated database write failure'); END;`);
  const original = plain(await h.api.getDayEntries(day));
  await assert.rejects(h.api.saveMinuteEntry({ dateKey: day, minuteIndex: 90, text: 'Reject this edit', categoryId: 'study' }), /Simulated database write failure/);
  assert.deepEqual(plain(await h.api.getDayEntries(day)), original);
  await h.api.setSetting('after.failure', true);
  await h.sheet.spreadsheetEditor.clear(range);
  await h.sheet.undoSpreadsheetEdit();
  assert.equal((await h.api.getMinuteEntry(day, 90)).text, 'Original note');
  assert.equal(await h.api.getSetting('after.failure', false), true);
  assert.equal(h.sheet.spreadsheetEditor.snapshot().busy, false);
});

test('SQLite error code 5 leaves Undo available and a later retry restores the note after the external writer releases', async (t) => {
  const h = repository(t); await h.api.initializeDatabase();
  await h.api.saveMinuteEntry({ dateKey: day, minuteIndex: 90, text: 'Keep this note', categoryId: 'study' });
  await h.sheet.spreadsheetEditor.clear(range);
  const external = h.openExternal();
  try {
    external.exec("BEGIN IMMEDIATE; INSERT INTO settings VALUES ('external.writer', 'true', 'external');");
    // The fixture's second connection is a genuinely independent writer. The
    // bounded native busy timeout may expire, but must not consume Undo history.
    await assert.rejects(h.sheet.undoSpreadsheetEdit(), (error) => {
      assert.match(error.message, /database is locked/);
      assert.equal(error.errcode, 5);
      return true;
    });
    assert.equal(h.sheet.spreadsheetEditor.snapshot().busy, false);
    assert.equal(h.sheet.spreadsheetEditor.snapshot().canUndo, true);
    external.exec('ROLLBACK');
    await h.sheet.undoSpreadsheetEdit();
    assert.equal((await h.api.getMinuteEntry(day, 90)).text, 'Keep this note');
    // The same editor remains usable after the rejected native transaction.
    await h.sheet.spreadsheetEditor.clear(range);
    await h.sheet.undoSpreadsheetEdit();
    assert.equal((await h.api.getMinuteEntry(day, 90)).text, 'Keep this note');
  } finally {
    try { external.exec('ROLLBACK'); } catch {}
    external.close();
  }
});

test('unsupported nonexclusive callbacks fail clearly without entering a transaction or poisoning later writes', async (t) => {
  const h = repository(t); await h.api.initializeDatabase();
  const facade = await h.createFacade(); let called = false;
  await assert.rejects(facade.withTransactionAsync(async () => { called = true; }), /Use withExclusiveTransactionAsync/);
  assert.equal(called, false);
  assert.equal(h.primary.isTransaction, false);
  await facade.runAsync("INSERT INTO settings VALUES ('nonexclusive.recovery', 'true', 'test')");
  assert.equal(await h.api.getSetting('nonexclusive.recovery', false), true);
});
