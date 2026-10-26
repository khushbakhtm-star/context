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

function runtime(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  const events = new Map(); const calls = []; let serial = 0; let failUpdate = null;
  const nativeDb = {
    async execAsync(sql) { sqlite.exec(sql); },
    async runAsync(sql, ...params) { const result = sqlite.prepare(sql).run(...params); return { changes: result.changes }; },
    async getFirstAsync(sql, ...params) { return sqlite.prepare(sql).get(...params) ?? null; },
    async getAllAsync(sql, ...params) { return sqlite.prepare(sql).all(...params); },
    async withExclusiveTransactionAsync(work) { sqlite.exec('BEGIN IMMEDIATE');
      try { await work(nativeDb); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
  };
  const nativeCalendar = {
    async getEventsAsync(ids, start, end) { return [...events.values()].filter((event) => ids.includes(event.calendarId) &&
      new Date(event.startDate) < end && new Date(event.endDate) > start).map(plain); },
    async createEventAsync(calendarId, details) { const id = `event-${++serial}`; calls.push({ type: 'create', id });
      events.set(id, { id, calendarId, ...plain(details) }); return id; },
    async updateEventAsync(id, details) { calls.push({ type: 'update', id });
      if (failUpdate === id) throw new Error('Provider temporarily unavailable');
      const event = events.get(id); if (!event) throw Object.assign(new Error('Missing'), { code: 'E_EVENT_NOT_FOUND' });
      events.set(id, { ...event, ...plain(details) }); return id; },
    async getEventAsync(id) { if (!events.has(id)) throw Object.assign(new Error('Missing'), { code: 'E_EVENT_NOT_FOUND' }); return plain(events.get(id)); },
    async deleteEventAsync(id) { calls.push({ type: 'delete', id }); events.delete(id); },
  };
  const cache = new Map(); const source = (name) => path.join(__dirname, '../src', name);
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} }; cache.set(filename, module.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInContext(code, vm.createContext({ module, exports: module.exports, console, Date, Math, Intl,
      Map, Set, Promise, Error, TypeError, RangeError, TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout,
      require(name) {
        if (name === 'expo-sqlite') return { openDatabaseAsync: async () => nativeDb };
        if (name === 'expo-crypto') return { randomUUID: crypto.randomUUID };
        if (name === 'react-native') return { Platform: { OS: 'android' } };
        if (name === 'expo-calendar/legacy') return nativeCalendar;
        if (name === 'expo-calendar') return {};
        if (name.startsWith('@noble/')) return require(name);
        if (!name.startsWith('.')) throw new Error(`Unexpected native activity import ${name}`);
        const target = path.resolve(path.dirname(filename), `${name}.ts`);
        if (target === source('sync/engine.ts')) return { linkActualsToAccounts: async () => {}, synchronizeAccounts: async () => {} };
        if (target === source('sync/accounts.ts')) return { accountFetch: async () => { throw Error('Unexpected account call'); } };
        if (target === source('sync/providers.ts')) return { createCalendarAdapter: () => { throw Error('Unexpected account call'); } };
        return load(target);
      },
    }), { filename });
    cache.set(filename, module.exports); return module.exports;
  }
  const db = load(source('data/database.ts')); const sheet = load(source('services/spreadsheet.ts'));
  const calendar = load(source('services/calendar.ts'));
  return { db, sheet, calendar, events, calls, sqlite, set failUpdate(id) { failUpdate = id; } };
}
async function namedTwoColorActivity(r) {
  await r.db.initializeDatabase();
  for (let minuteIndex = 100; minuteIndex < 110; minuteIndex++) await r.db.saveMinuteEntry({
    dateKey: day, minuteIndex, text: `${minuteIndex < 105 ? 'A' : 'B'}${minuteIndex % 5}`, categoryId: 'study' });
  await r.sheet.groupMinuteRange({ dateKey: day, startMinute: 100, endMinute: 109 }, { title: 'Activity', categoryId: 'study' });
  await r.sheet.colorMinuteRange({ dateKey: day, startMinute: 105, endMinute: 109 }, 'work');
  await r.calendar.syncActualDay(day, 'personal');
  return r.sheet.getMovableActivityGroup(day, 100);
}
const ordered = (r) => [...r.events.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));

test('overlapping two-color whole move rekeys links atomically without swapping or losing original native event IDs', async (t) => {
  const r = runtime(t); const group = await namedTwoColorActivity(r); const initial = ordered(r);
  assert.equal(initial.length, 2);
  const startCalls = r.calls.length;
  await r.sheet.moveActivityGroup(group, { dateKey: day, startMinute: 105 });
  await r.calendar.syncActualDay(day, 'personal');
  const moved = ordered(r);
  assert.deepEqual(moved.map((event) => event.id), initial.map((event) => event.id));
  assert.match(moved[0].notes, /A0[\s\S]*A4/); assert.doesNotMatch(moved[0].notes, /B0/);
  assert.match(moved[1].notes, /B0[\s\S]*B4/); assert.doesNotMatch(moved[1].notes, /A0/);
  assert.equal(r.calls.slice(startCalls).filter((call) => call.type === 'create' || call.type === 'delete').length, 0);
  assert.equal((await r.db.getSyncBindings(day)).length, 2);
  await r.sheet.undoSpreadsheetEdit(); await r.calendar.syncActualDay(day, 'personal');
  assert.deepEqual(ordered(r).map((event) => [event.id, event.startDate]), initial.map((event) => [event.id, event.startDate]));
});

test('old-source-first cleanup defers deletion; cross-day move, partial provider failure, retry and Undo retain both native IDs', async (t) => {
  const r = runtime(t); const group = await namedTwoColorActivity(r); const initial = ordered(r);
  const destination = { dateKey: '2026-11-07', startMinute: 600 };
  await r.sheet.moveActivityGroup(group, destination);
  const cleanup = await r.calendar.syncActualDay(day, 'personal');
  assert.equal(cleanup.removed, 0); assert.equal(r.events.size, 2);
  r.failUpdate = initial[1].id;
  await assert.rejects(r.calendar.syncActualDay(destination.dateKey, 'personal'), /Provider temporarily unavailable/);
  assert.equal((await r.db.getSyncBindings(day)).length, 0);
  assert.equal((await r.db.getSyncBindings(destination.dateKey)).length, 2, 'all ID mappings survive a later provider failure');
  assert.deepEqual([...r.events.keys()].sort(), initial.map((event) => event.id).sort());
  r.failUpdate = null;
  await r.calendar.syncActualDay(destination.dateKey, 'personal');
  assert.deepEqual(ordered(r).map((event) => event.id), initial.map((event) => event.id));
  await r.sheet.undoSpreadsheetEdit();
  await r.calendar.syncActualDay(destination.dateKey, 'personal');
  assert.equal(r.events.size, 2);
  await r.calendar.syncActualDay(day, 'personal');
  assert.deepEqual(ordered(r).map((event) => [event.id, event.startDate]), initial.map((event) => [event.id, event.startDate]));
});

test('a concurrent category change invalidates planned binding rekey before provider writes or binding loss', async (t) => {
  const r = runtime(t); const group = await namedTwoColorActivity(r); const beforeBindings = plain(await r.db.getSyncBindings(day));
  await r.sheet.moveActivityGroup(group, { dateKey: day, startMinute: 200 });
  const real = r.db.remapActivitySyncBindings;
  r.db.remapActivitySyncBindings = async (...args) => {
    r.db.remapActivitySyncBindings = real;
    await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 202, text: 'Concurrent note', categoryId: 'work' });
    return real(...args);
  };
  const beforeCalls = r.calls.length;
  await assert.rejects(r.calendar.syncActualDay(day, 'personal'), /activity changed/);
  assert.deepEqual(plain(await r.db.getSyncBindings(day)), beforeBindings);
  assert.equal(r.calls.length, beforeCalls);
  assert.equal(r.events.size, 2);
});
