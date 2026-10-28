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

function runtime(t, overrides = {}) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  const events = new Map(); const calls = []; let serial = 0; let failUpdate = null; let failCreateAfterSave = false;
  const nativeDb = {
    async execAsync(sql) { sqlite.exec(sql); },
    async runAsync(sql, ...params) { const result = sqlite.prepare(sql).run(...params); return { changes: result.changes }; },
    async getFirstAsync(sql, ...params) { return sqlite.prepare(sql).get(...params) ?? null; },
    async getAllAsync(sql, ...params) { return sqlite.prepare(sql).all(...params); },
    async withExclusiveTransactionAsync(work) { sqlite.exec('BEGIN IMMEDIATE');
      try { await work(nativeDb); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
  };
  const nativeCalendar = {
    EntityTypes: { EVENT: 'event' },
    async getCalendarsAsync() { return [{ id: 'personal', title: 'Personal', color: '#2952A3', allowsModifications: true,
      source: { name: 'On device' } }]; },
    async getCalendarPermissionsAsync() { await overrides.beforePermissionRead?.(); return { status: overrides.permission ?? 'granted' }; },
    async getEventsAsync(ids, start, end) { await overrides.beforeNativeRead?.(); return [...events.values()].filter((event) => ids.includes(event.calendarId) &&
      new Date(event.startDate) < end && new Date(event.endDate) > start).map(plain); },
    async createEventAsync(calendarId, details) { const id = `event-${++serial}`; calls.push({ type: 'create', id });
      events.set(id, { id, calendarId, ...plain(details) });
      if (failCreateAfterSave) throw new Error('Create response was lost');
      return id; },
    async updateEventAsync(id, details) { calls.push({ type: 'update', id });
      await overrides.beforeUpdate?.(id);
      if (failUpdate === id) throw new Error('Provider temporarily unavailable');
      const event = events.get(id); if (!event) throw Object.assign(new Error('Missing'), { code: 'E_EVENT_NOT_FOUND' });
      events.set(id, { ...event, ...plain(details) }); return id; },
    async getEventAsync(id) {
      await overrides.beforeBoundRead?.(id);
      if (overrides.failLegacyReads) throw Object.assign(new Error('Legacy empty RRULE conversion failed'), { code: 'E_BAD_RECURRENCE' });
      if (!events.has(id)) throw Object.assign(new Error('Missing'), { code: 'E_EVENT_NOT_FOUND' }); return plain(events.get(id)); },
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
        if (name === 'expo-calendar') return overrides.modernBoundReads ? { ExpoCalendarEvent: {
          get: async (id) => Object.create(events.get(id) ?? {}) } } : {};
        if (name === '../../modules/context-calendar-colors') return { getEventColorsAsync: async () => ({}) };
        if (name.startsWith('@noble/')) return require(name);
        if (!name.startsWith('.')) throw new Error(`Unexpected native activity import ${name}`);
        const target = path.resolve(path.dirname(filename), `${name}.ts`);
        if (target === source('sync/engine.ts')) return { linkActualsToAccounts: async () => {}, requestAccountSynchronization: () => {}, synchronizeAccounts: async () => {},
          getAccountPreferences: async (accountId) => overrides.accountPreferences?.[accountId] ?? { selectedCalendarIds: [], writeCalendarId: null },
          listProjections: async () => (await load(source('data/database.ts')).getSyncDocuments('projection:'))
            .flatMap((document) => document.value ? [document.value] : []),
          requireCalendarColorImportCurrent(entries) { overrides.colorGuard?.(entries); }, notifyCalendarColorImported() {},
          localActivityColorHash(entries) { return load(source('sync/codec.ts')).hashValue([...new Set(entries.map((entry) =>
            `${entry.categoryId}:${load(source('theme.ts')).categoryById(entry.categoryId).color.toUpperCase()}`))].sort()); } };
        if (target === source('sync/accounts.ts')) return { getAccounts: async () => overrides.accounts ?? [],
          accountFetch: async () => { throw Error('Unexpected account call'); } };
        if (target === source('sync/providers.ts')) return { createCalendarAdapter: () => { throw Error('Unexpected account call'); } };
        return load(target);
      },
    }), { filename });
    cache.set(filename, module.exports); return module.exports;
  }
  const db = load(source('data/database.ts')); const sheet = load(source('services/spreadsheet.ts'));
  const calendar = load(source('services/calendar.ts'));
  return { db, sheet, calendar, events, calls, sqlite, set failUpdate(id) { failUpdate = id; },
    categories: load(source('services/categories.ts')),
    codec: load(source('sync/codec.ts')),
    set failCreateAfterSave(value) { failCreateAfterSave = value; } };
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

async function oneMinute(r, text = 'Make coffee') {
  await r.db.initializeDatabase();
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text, categoryId: 'unaccounted' });
  await r.sheet.groupMinuteRange({ dateKey: day, startMinute: 100, endMinute: 100 },
    { title: text.split('\n')[0].slice(0, 200) || 'Activity', categoryId: 'unaccounted' });
  return (await r.db.getDaySegments(day))[0];
}

async function nativeColorPlans(r, color) {
  const calendar = { id: 'personal', title: 'Personal', color: '#2952A3', allowsModifications: true, sourceName: 'Device', isPrimary: true };
  for (const event of r.events.values()) event.displayColor = color;
  return { calendar, plans: (await r.calendar.loadPlannedEventsResult(['personal'], day, [calendar])).plans };
}

const googleWriter = { id: 'google', provider: 'google', subject: 'personal', label: 'Personal',
  consent: { ledgerStorage: false, calendarRead: true, calendarWrite: true, replaceOccurrences: true, importCalendarEdits: true } };
const boundOnly = { existingBindingsOnly: true };
function directWriterOptions() {
  return { accounts: [googleWriter], accountPreferences: { google: { selectedCalendarIds: [], writeCalendarId: null } } };
}
function accountProjection(segment, state = 'pending') {
  return { id: 'account-owner', accountId: 'google', calendarId: 'google-calendar', eventId: 'google-event',
    sourceEventId: 'google-event', blockId: segment.blockId, dateKey: segment.dateKey,
    startMinute: segment.startMinute, endMinute: segment.endMinute, title: 'Pray',
    baseEvent: null, baseLocalHash: null, state };
}

test('calendarWrite permission without an account destination keeps native note writeback and the exact Basil color available', async (t) => {
  const r = runtime(t, { accounts: [googleWriter] }); await oneMinute(r, 'Prayed');
  await r.calendar.syncActualDay(day, 'personal');
  const read = await nativeColorPlans(r, '#0B8043');
  await r.calendar.reconcileLinkedNativeColors(day, read.plans, [read.calendar]);
  const entry = await r.db.getMinuteEntry(day, 100);
  assert.equal((await r.categories.listCategories()).find((category) => category.id === entry.categoryId).color, '#0B8043');
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text: 'Prayed and supplicated', categoryId: entry.categoryId });
  const result = await r.calendar.syncActualDay(day, 'personal');
  assert.equal(result.updated, 1); assert.equal(result.deferred, undefined);
  const event = [...r.events.values()][0];
  assert.equal(event.title, 'Prayed'); assert.match(event.notes, /Prayed and supplicated/);
  assert.equal(event.displayColor, '#0B8043');
  assert.equal((await r.db.getMinuteEntry(day, 100)).categoryId, entry.categoryId);
});

test('a configured account destination pauses native creation and leaves its durable outbox pending', async (t) => {
  const r = runtime(t, { accounts: [googleWriter], accountPreferences: { google: { selectedCalendarIds: [], writeCalendarId: 'google-calendar' } } });
  await oneMinute(r, 'Prayed');
  assert.deepEqual(plain(await r.calendar.syncActualDay(day, 'personal')), { created: 0, updated: 0, removed: 0, deferred: true });
  r.calendar.configureCalendarProjection('personal');
  const result = await r.calendar.flushPendingActuals('personal', [day]);
  assert.equal(result.attempted, 0); assert.equal(result.succeeded, 0); assert.equal(result.failed, 0); assert.equal(result.remaining, 1);
  assert.equal(result.deferred, true);
  assert.equal(r.calls.length, 0); assert.equal((await r.db.getSyncBindings(day)).length, 0);
  assert.equal((await r.db.getPendingSyncDates()).length, 1); assert.equal((await r.db.getMinuteEntry(day, 100)).text, 'Prayed');
});

test('bound-only coexistence writes exact existing notes with a configured account writer and never creates an unbound border', async (t) => {
  const options = directWriterOptions(); const r = runtime(t, options); await oneMinute(r, 'Initial note');
  await r.calendar.syncActualDay(day, 'personal'); const id = [...r.events.keys()][0]; const binding = plain((await r.db.getSyncBindings(day))[0]);
  r.calendar.configureCalendarProjection('personal'); options.accountPreferences.google.writeCalendarId = 'google-calendar';
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text: 'Exact note sent through existing binding', categoryId: 'unaccounted' });
  r.calls.length = 0;
  const result = await r.calendar.flushPendingActuals('personal', [day], 90, boundOnly);
  assert.equal(result.succeeded, 1); assert.equal(result.failed, 0); assert.equal(result.remaining, 0);
  assert.deepEqual(r.calls, [{ type: 'update', id }]); assert.match(r.events.get(id).notes, /Exact note sent/);
  assert.deepEqual(plain((await r.db.getSyncBindings(day))[0]), binding);
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 200, text: 'New private border', categoryId: 'work' });
  await r.sheet.groupMinuteRange({ dateKey: day, startMinute: 200, endMinute: 200 }, { title: 'Unbound activity', categoryId: 'work' });
  r.calls.length = 0;
  const deferred = await r.calendar.flushPendingActuals('personal', [day], 90, boundOnly);
  assert.equal(deferred.deferred, true); assert.equal(deferred.remaining, 1); assert.equal(deferred.failed, 0);
  assert.deepEqual(r.calls, [], 'an unchanged binding must not churn while unbound work remains deferred');
  assert.equal(r.events.size, 1); assert.equal((await r.db.getSyncBindings(day)).length, 1);
});

test('bound-only coexistence keeps missing originals and changed local shapes deferred without replacement or remapping', async (t) => {
  for (const reason of ['missing', 'shape']) {
    const options = directWriterOptions(); const r = runtime(t, options); const segment = await oneMinute(r); await r.calendar.syncActualDay(day, 'personal');
    const id = [...r.events.keys()][0]; const bindings = plain(await r.db.getSyncBindings(day));
    options.accountPreferences.google.writeCalendarId = 'google-calendar'; r.calendar.configureCalendarProjection('personal');
    if (reason === 'missing') { r.events.delete(id); await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text: 'Later text', categoryId: 'unaccounted' }); }
    else await r.sheet.groupMinuteRange({ dateKey: day, startMinute: 100, endMinute: 101 }, { title: 'Make coffee', categoryId: 'unaccounted' });
    r.calls.length = 0;
    const result = await r.calendar.syncActualDay(day, 'personal', () => true, boundOnly);
    assert.equal(result.deferred, true); assert.equal(result.created, 0); assert.deepEqual(r.calls, []);
    assert.deepEqual(plain(await r.db.getSyncBindings(day)), bindings);
  }
});

test('bound-only coexistence never touches an account-owned block or another calendar and leaves their outbox pending', async (t) => {
  const options = directWriterOptions(); const r = runtime(t, options); const segment = await oneMinute(r); await r.calendar.syncActualDay(day, 'personal');
  const bindings = plain(await r.db.getSyncBindings(day)); const event = plain([...r.events.values()][0]);
  await r.db.putSyncDocument('projection:account-owner', accountProjection(segment));
  options.accountPreferences.google.writeCalendarId = 'google-calendar'; r.calendar.configureCalendarProjection('personal');
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text: 'Account-owned pending note', categoryId: 'unaccounted' });
  r.calls.length = 0;
  const owned = await r.calendar.flushPendingActuals('personal', [day], 90, boundOnly);
  assert.equal(owned.deferred, true); assert.equal(owned.remaining, 1); assert.equal(r.calls.length, 0);
  assert.deepEqual(plain([...r.events.values()][0]), event); assert.deepEqual(plain(await r.db.getSyncBindings(day)), bindings);
  await r.db.putSyncDocument('projection:account-owner', { ...accountProjection(segment), state: 'deleted' });
  r.calendar.configureCalendarProjection('other-calendar');
  const other = await r.calendar.syncActualDay(day, 'other-calendar', () => true, boundOnly);
  assert.equal(other.deferred, true); assert.equal(r.calls.length, 0); assert.deepEqual(plain([...r.events.values()][0]), event);
});

test('bound-only preflight imports external title/time/cleared notes and preserves location before later note writeback', async (t) => {
  const options = directWriterOptions(); const r = runtime(t, options); await oneMinute(r, 'Original note'); await r.calendar.syncActualDay(day, 'personal');
  const id = [...r.events.keys()][0]; const event = r.events.get(id); event.title = 'External event title'; event.notes = '';
  event.startDate = new Date(2026, 9, 25, 3, 20).toISOString(); event.endDate = new Date(2026, 9, 25, 3, 23).toISOString(); event.location = 'External location';
  options.accountPreferences.google.writeCalendarId = 'google-calendar'; r.calendar.configureCalendarProjection('personal'); r.calls.length = 0;
  await r.calendar.flushPendingActuals('personal', [day], 90, boundOnly);
  assert.equal((await r.db.getMinuteEntry(day, 100)), null); assert.equal((await r.db.getMinuteEntry(day, 201)).text, '');
  assert.equal(r.events.get(id).title, 'External event title'); assert.equal(r.events.get(id).location, 'External location');
  assert.equal(r.calls.filter((call) => call.type === 'create' || call.type === 'delete').length, 0);
  const entry = await r.db.getMinuteEntry(day, 201);
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 201, text: 'A separate minute thought', categoryId: entry.categoryId });
  await r.calendar.flushPendingActuals('personal', [day], 90, boundOnly);
  assert.equal(r.events.size, 1); assert.match(r.events.get(id).notes, /A separate minute thought/);
  assert.equal(r.events.get(id).title, 'External event title'); assert.equal(r.events.get(id).location, 'External location');
});

test('bound-only mutation rechecks exact binding, account owner and selected-target generation after provider awaits', async (t) => {
  for (const change of ['binding', 'account-owner', 'opt-out']) {
    const options = directWriterOptions(); const r = runtime(t, options); const segment = await oneMinute(r); await r.calendar.syncActualDay(day, 'personal');
    const binding = (await r.db.getSyncBindings(day))[0]; const before = plain([...r.events.values()][0]);
    options.accountPreferences.google.writeCalendarId = 'google-calendar'; r.calendar.configureCalendarProjection('personal');
    await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text: 'Pending local note', categoryId: 'unaccounted' });
    options.beforeBoundRead = async () => {
      options.beforeBoundRead = undefined;
      if (change === 'binding') await r.db.saveSyncBinding({ ...binding, eventId: 'changed-exact-binding' });
      else if (change === 'account-owner') await r.db.putSyncDocument('projection:account-owner', accountProjection(segment));
      else r.calendar.configureCalendarProjection(null);
    };
    r.calls.length = 0;
    await assert.rejects(r.calendar.syncActualDay(day, 'personal', () => true, boundOnly));
    assert.deepEqual(r.calls, []); assert.deepEqual(plain([...r.events.values()][0]), before);
    assert.equal((await r.db.getMinuteEntry(day, 100)).text, 'Pending local note');
  }
});

test('bound-only full Reset removes only its verified original event and a disappearing update never creates a replacement', async (t) => {
  for (const action of ['reset', 'missing-during-update']) {
    const options = directWriterOptions(); const r = runtime(t, options); await oneMinute(r); await r.calendar.syncActualDay(day, 'personal');
    const id = [...r.events.keys()][0]; options.accountPreferences.google.writeCalendarId = 'google-calendar'; r.calendar.configureCalendarProjection('personal');
    if (action === 'reset') {
      await r.sheet.resetMinuteCells({ dateKey: day, startMinute: 100, endMinute: 100 }); r.calls.length = 0;
      const result = await r.calendar.flushPendingActuals('personal', [day], 90, boundOnly);
      assert.equal(result.succeeded, 1); assert.deepEqual(r.calls, [{ type: 'delete', id }]);
      assert.equal(r.events.size, 0); assert.equal((await r.db.getSyncBindings(day)).length, 0);
    } else {
      await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text: 'Pending text', categoryId: 'unaccounted' });
      options.beforeUpdate = async () => { r.events.delete(id); }; r.calls.length = 0;
      const result = await r.calendar.flushPendingActuals('personal', [day], 90, boundOnly);
      assert.equal(result.failed, 1); assert.deepEqual(r.calls, [{ type: 'update', id }]);
      assert.equal((await r.db.getSyncBindings(day))[0].eventId, id); assert.equal(result.remaining, 1);
    }
  }
});

test('durable account source ownership pauses native color, update and cleanup even after consent is revoked or disconnected', async (t) => {
  for (const state of ['pending', 'synced', 'conflict']) {
    const r = runtime(t); const segment = await oneMinute(r, 'Prayed');
    await r.calendar.syncActualDay(day, 'personal');
    const basil = await nativeColorPlans(r, '#0B8043'); await r.calendar.reconcileLinkedNativeColors(day, basil.plans, [basil.calendar]);
    const before = await r.db.getMinuteEntry(day, 100); const bindings = plain(await r.db.getSyncBindings(day));
    await r.db.putSyncDocument('projection:account-owner', accountProjection(segment, state));
    await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text: 'More exact prayer notes', categoryId: before.categoryId });
    const otherGreen = await nativeColorPlans(r, '#33B679'); r.calls.length = 0;
    assert.deepEqual(plain(await r.calendar.reconcileLinkedNativeColors(day, otherGreen.plans, [otherGreen.calendar])), []);
    assert.equal((await r.db.getMinuteEntry(day, 100)).categoryId, before.categoryId, 'the account owner has sole color authority');
    assert.equal((await r.calendar.syncActualDay(day, 'personal')).deferred, true);
    r.calendar.configureCalendarProjection('personal');
    const queued = await r.calendar.flushPendingActuals('personal', [day]);
    assert.equal(queued.succeeded, 0); assert.equal(queued.failed, 0); assert.equal(queued.remaining, 1);
    assert.equal(queued.deferred, true);
    assert.deepEqual(plain(await r.db.getSyncBindings(day)), bindings); assert.equal(r.calls.length, 0);
    assert.equal([...r.events.values()][0].title, 'Prayed');
    await r.db.deleteMinuteEntry(day, 100); await r.calendar.syncActualDay(day, 'personal');
    assert.equal(r.events.size, 1, 'native cleanup cannot delete an event retained by a source-specific account link');
    assert.deepEqual(plain(await r.db.getSyncBindings(day)), bindings);
  }
});

test('account ownership of one block does not stop unrelated native notes, and explicit deleted ownership releases it', async (t) => {
  const r = runtime(t); const segment = await oneMinute(r, 'Prayed'); await r.calendar.syncActualDay(day, 'personal');
  const ownedId = [...r.events.keys()][0];
  await r.db.putSyncDocument('projection:account-owner', accountProjection(segment));
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 200, text: 'Unrelated local activity', categoryId: 'work' });
  await r.sheet.groupMinuteRange({ dateKey: day, startMinute: 200, endMinute: 200 }, { title: 'Unrelated activity', categoryId: 'work' });
  r.calls.length = 0; const result = await r.calendar.syncActualDay(day, 'personal');
  assert.equal(result.created, 1); assert.equal(result.updated, 0); assert.equal(result.deferred, true);
  assert.ok(r.events.has(ownedId)); assert.equal(r.calls.filter((call) => call.id === ownedId).length, 0);
  await r.db.putSyncDocument('projection:account-owner', accountProjection(segment, 'deleted'));
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text: 'Explicitly returned to device sync', categoryId: segment.categoryId });
  const resumed = await r.calendar.syncActualDay(day, 'personal');
  assert.equal(resumed.deferred, undefined); assert.equal(r.events.get(ownedId).title, 'Prayed');
  assert.match(r.events.get(ownedId).notes, /Explicitly returned to device sync/);
});

test('account ownership or configured routing appearing during native preparation cancels before provider mutation or an uncertain intent', async (t) => {
  for (const reason of ['ownership', 'destination']) {
    const options = { accounts: [googleWriter], accountPreferences: { google: { selectedCalendarIds: [], writeCalendarId: null } } };
    const r = runtime(t, options); const segment = await oneMinute(r, 'Prayed');
    options.beforeNativeRead = async () => {
      options.beforeNativeRead = undefined;
      if (reason === 'ownership') await r.db.putSyncDocument('projection:account-owner', accountProjection(segment));
      else options.accountPreferences.google.writeCalendarId = 'google-calendar';
    };
    await assert.rejects(r.calendar.syncActualDay(day, 'personal'));
    assert.equal(r.calls.length, 0); assert.equal(r.events.size, 0); assert.equal((await r.db.getSyncBindings(day)).length, 0);
    const intent = `calendar.create-intent:personal:${encodeURIComponent(segment.blockId)}`;
    assert.equal(await r.db.getSetting(intent, null), null, 'canceling before create must not leave a falsely uncertain create journal');
    assert.equal((await r.calendar.syncActualDay(day, 'personal')).deferred, true);
  }
});

test('an account owner arriving during the native color permission read prevents the later local recolor', async (t) => {
  const options = {}; const r = runtime(t, options); const segment = await oneMinute(r, 'Prayed');
  await r.calendar.syncActualDay(day, 'personal');
  const read = await nativeColorPlans(r, '#0B8043');
  options.beforePermissionRead = async () => {
    options.beforePermissionRead = undefined; await r.db.putSyncDocument('projection:account-owner', accountProjection(segment));
  };
  assert.deepEqual(plain(await r.calendar.reconcileLinkedNativeColors(day, read.plans, [read.calendar])), []);
  assert.equal((await r.db.getMinuteEntry(day, 100)).categoryId, 'unaccounted');
});

test('delegated native outbox work retains its flag without hiding a separate real provider failure', async (t) => {
  const r = runtime(t); const segment = await oneMinute(r, 'Account-owned prayer'); await r.calendar.syncActualDay(day, 'personal');
  await r.db.putSyncDocument('projection:account-owner', accountProjection(segment));
  const tomorrow = '2026-10-26';
  await r.db.saveMinuteEntry({ dateKey: tomorrow, minuteIndex: 100, text: 'Unrelated device note', categoryId: 'work' });
  await r.sheet.groupMinuteRange({ dateKey: tomorrow, startMinute: 100, endMinute: 100 }, { title: 'Unrelated device activity', categoryId: 'work' });
  await r.calendar.syncActualDay(tomorrow, 'personal');
  const deviceEvent = [...r.events.values()].find((event) => event.startDate.startsWith(tomorrow)); r.failUpdate = deviceEvent.id;
  r.calendar.configureCalendarProjection('personal');
  const result = await r.calendar.flushPendingActuals('personal', [day, tomorrow]);
  assert.equal(result.deferred, true); assert.equal(result.attempted, 2); assert.equal(result.succeeded, 0);
  assert.equal(result.failed, 1, 'a provider failure remains visible even when another date is delegated');
  assert.equal(result.remaining, 1);
  const queued = await r.db.getPendingSyncDates();
  assert.equal(queued.find((item) => item.dateKey === day).attempts, 0);
  assert.equal(queued.find((item) => item.dateKey === tomorrow).attempts, 1);
});

test('externally renamed, moved and resized native events survive stale blank-slot sync and Reset cleanup, including legacy links', async (t) => {
  for (const legacy of [false, true]) {
    const options = {}; const r = runtime(t, options); await r.db.initializeDatabase();
    for (const minuteIndex of [100, 200]) await r.db.saveMinuteEntry({ dateKey: day, minuteIndex, text: `gibberish-${minuteIndex}`, categoryId: 'unaccounted' });
    for (const minuteIndex of [100, 200]) await r.sheet.groupMinuteRange({ dateKey: day, startMinute: minuteIndex, endMinute: minuteIndex },
      { title: `Activity-${minuteIndex}`, categoryId: 'unaccounted' });
    await r.calendar.syncActualDay(day, 'personal');
    const orderedEvents = [...r.events.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const prayer = orderedEvents[0], doctor = orderedEvents[1];
    if (legacy) for (const event of orderedEvents) await r.db.setSetting(`calendar.native-write.v1.personal.${encodeURIComponent(event.id)}`, null);
    prayer.title = 'Prayed'; prayer.startDate = new Date(2026, 9, 25, 6, 30).toISOString();
    prayer.endDate = new Date(2026, 9, 25, 6, 40).toISOString(); prayer.displayColor = '#0B8043';
    doctor.title = 'Mum doctor appointment'; doctor.startDate = new Date(2026, 9, 25, 14, 0).toISOString();
    doctor.endDate = new Date(2026, 9, 25, 15, 0).toISOString(); doctor.displayColor = '#F4511E'; doctor.location = 'Doctor office';
    const external = plain([...r.events.values()]); const bindings = plain(await r.db.getSyncBindings(day));
    for (const startMinute of [100, 200]) await r.db.saveMinuteRange({ dateKey: day, startMinute, durationMinutes: 1,
      text: '', categoryId: 'unaccounted', allowEmptyText: true });
    options.accounts = [{ ...googleWriter, consent: { ...googleWriter.consent, ledgerStorage: true, editInvitations: true, editSeries: true, categoryRead: true } }];
    r.calls.length = 0;
    await assert.rejects(r.calendar.syncActualDay(day, 'personal'), /edited in your calendar|moved or changed duration/);
    assert.deepEqual(plain([...r.events.values()]), external); assert.equal(r.calls.length, 0);
    const calendar = { id: 'personal', title: 'Personal', color: '#2952A3', allowsModifications: true, sourceName: 'Device', isPrimary: true };
    const read = await r.calendar.loadPlannedEventsResult(['personal'], day, [calendar]);
    await assert.rejects(r.calendar.reconcileLinkedNativeColors(day, read.plans, [calendar]), /edited in your calendar|moved or changed duration/);
    for (const minute of [100, 200]) await r.db.deleteMinuteEntry(day, minute);
    await assert.rejects(r.calendar.syncActualDay(day, 'personal'), /edited in your calendar|moved or changed duration/);
    assert.deepEqual(plain([...r.events.values()]), external, 'Reset of the old blank cells cannot delete the moved Google events');
    assert.deepEqual(plain(await r.db.getSyncBindings(day)), bindings); assert.equal(r.calls.length, 0);
    assert.equal((await r.db.getPendingSyncDates()).length, 1);
  }
});

test('new native write receipts protect external title/description edits even when event times are unchanged', async (t) => {
  for (const field of ['title', 'notes']) {
    const r = runtime(t); await oneMinute(r, 'Original Context label'); await r.calendar.syncActualDay(day, 'personal');
    const event = [...r.events.values()][0]; event[field] = field === 'title' ? 'Prayer' : 'External doctor instructions';
    await r.db.saveMinuteRange({ dateKey: day, startMinute: 100, durationMinutes: 1, text: '', categoryId: 'unaccounted', allowEmptyText: true });
    const external = plain(event); r.calls.length = 0;
    await assert.rejects(r.calendar.syncActualDay(day, 'personal'), /edited in your calendar/);
    assert.deepEqual(plain(r.events.get(event.id)), external); assert.equal(r.calls.length, 0);
  }
});

test('external color and location changes alone survive an otherwise authorized native note update', async (t) => {
  const r = runtime(t); await oneMinute(r, 'Original label'); await r.calendar.syncActualDay(day, 'personal');
  const event = [...r.events.values()][0]; event.location = 'Doctor office'; event.displayColor = '#F4511E';
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text: 'New minute description', categoryId: 'unaccounted' });
  assert.equal((await r.calendar.syncActualDay(day, 'personal')).updated, 1);
  assert.equal(r.events.get(event.id).location, 'Doctor office'); assert.equal(r.events.get(event.id).displayColor, '#F4511E');
  assert.match(r.events.get(event.id).notes, /New minute description/);
});

test('bound-event protection uses modern Android shared getters rather than the failing legacy empty-RRULE mapper', async (t) => {
  const r = runtime(t, { modernBoundReads: true, failLegacyReads: true }); await oneMinute(r, 'Original native note');
  await r.calendar.syncActualDay(day, 'personal');
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text: 'Authorized new note', categoryId: 'unaccounted' });
  assert.equal((await r.calendar.syncActualDay(day, 'personal')).updated, 1);
  const event = [...r.events.values()][0]; event.title = 'Renamed in Google Calendar';
  r.calls.length = 0;
  await assert.rejects(r.calendar.syncActualDay(day, 'personal'), /edited in your calendar/);
  assert.equal(r.calls.length, 0); assert.equal(r.events.get(event.id).title, 'Renamed in Google Calendar');
});

test('known native event recolor fills linked minutes only and preserves notes, identity, grouping and formatting without source writes', async (t) => {
  const r = runtime(t); await r.db.initializeDatabase();
  await r.db.saveMinuteRange({ dateKey: day, startMinute: 100, durationMinutes: 3, text: 'Make coffee', categoryId: 'study' });
  await r.sheet.groupMinuteRange({ dateKey: day, startMinute: 100, endMinute: 102 }, { title: 'Coffee', categoryId: 'study' });
  await r.sheet.applyCellFormat({ dateKey: day, startMinute: 101, endMinute: 101 }, { bold: true, underline: true });
  await r.calendar.syncActualDay(day, 'personal');
  const seed = await nativeColorPlans(r, '#2952A3');
  await r.calendar.reconcileLinkedNativeColors(day, seed.plans, [seed.calendar]);
  const before = plain(await r.db.getSpreadsheetCells({ dateKey: day, startMinute: 100, endMinute: 102 }));
  const pending = plain(await r.db.getPendingSyncDates()); r.calls.length = 0;
  const read = await nativeColorPlans(r, '#123456');
  assert.deepEqual(plain(await r.calendar.reconcileLinkedNativeColors(day, read.plans, [read.calendar])), [day]);
  const after = plain(await r.db.getSpreadsheetCells({ dateKey: day, startMinute: 100, endMinute: 102 }));
  for (let index = 0; index < before.length; index++) {
    const old = before[index]; const next = after[index];
    assert.equal((await r.categories.listCategories()).find((item) => item.id === next.entry.categoryId).color, '#123456');
    for (const field of ['id', 'text', 'blockId', 'source', 'createdAt']) assert.equal(next.entry[field], old.entry[field]);
    assert.deepEqual(next.format, old.format);
  }
  assert.deepEqual(plain(await r.db.getPendingSyncDates()), pending);
  assert.equal(r.calls.length, 0);
  const unrelated = { ...read.plans[0], id: 'same-title-time-unowned', color: '#654321' };
  await r.calendar.reconcileLinkedNativeColors(day, [unrelated], [read.calendar]);
  assert.equal((await r.db.getMinuteEntry(day, 100)).categoryId, after[0].entry.categoryId);
  for (const event of r.events.values()) delete event.displayColor;
  const fallbackOnly = await r.calendar.loadPlannedEventsResult(['personal'], day, [read.calendar]);
  await r.calendar.reconcileLinkedNativeColors(day, fallbackOnly.plans, [read.calendar]);
  assert.equal((await r.db.getMinuteEntry(day, 100)).categoryId, after[0].entry.categoryId,
    'An unavailable exact color read must not turn calendar-default display fallback into an imported recolor');
});

test('native unchanged source color preserves local choice; simultaneous remote/local color edits require review', async (t) => {
  const r = runtime(t); await oneMinute(r); await r.calendar.syncActualDay(day, 'personal');
  const seed = await nativeColorPlans(r, '#2952A3');
  await r.calendar.reconcileLinkedNativeColors(day, seed.plans, [seed.calendar]);
  await r.sheet.colorMinuteRange({ dateKey: day, startMinute: 100, endMinute: 100 }, 'google_palette_2952a3');
  const selected = (await r.db.getMinuteEntry(day, 100)).categoryId;
  await r.calendar.reconcileLinkedNativeColors(day, seed.plans, [seed.calendar]);
  assert.equal((await r.db.getMinuteEntry(day, 100)).categoryId, selected);
  const read = await nativeColorPlans(r, '#123456');
  await assert.rejects(r.calendar.reconcileLinkedNativeColors(day, read.plans, [read.calendar]), /changed in Context and the calendar/);
  assert.equal((await r.db.getMinuteEntry(day, 100)).categoryId, selected);
});

test('native first-read explicit source color can classify an unaccounted note, but a dirty raw draft blocks recoloring', async (t) => {
  let blocked = false;
  const r = runtime(t, { colorGuard() { if (blocked) throw new Error('Finish raw draft'); } });
  await oneMinute(r); await r.calendar.syncActualDay(day, 'personal');
  const read = await nativeColorPlans(r, '#123456'); blocked = true;
  await assert.rejects(r.calendar.reconcileLinkedNativeColors(day, read.plans, [read.calendar]), /Finish raw draft/);
  assert.equal((await r.db.getMinuteEntry(day, 100)).categoryId, 'unaccounted');
  blocked = false;
  await r.calendar.reconcileLinkedNativeColors(day, read.plans, [read.calendar]);
  assert.equal((await r.categories.listCategories()).find((category) => category.id ===
    (r.sqlite.prepare('SELECT category_id FROM minute_entries WHERE minute_index=100').get().category_id)).color, '#123456');
});

test('new and bound device projections contain only exact timestamped notes, including literal Context-like user text', async (t) => {
  const r = runtime(t);
  await oneMinute(r, 'Unaccounted is a word I typed\nContext block: literal note\nFull minute record available in Context.');
  await r.calendar.syncActualDay(day, 'personal');
  const event = ordered(r)[0];
  assert.equal(event.notes, '1:40 AM  Unaccounted is a word I typed\n    Context block: literal note\n    Full minute record available in Context.');
  assert.doesNotMatch(event.notes, /Context projection:/);
  await r.calendar.syncActualDay(day, 'personal');
  assert.equal(r.events.size, 1);
  assert.equal(ordered(r)[0].notes, event.notes);
});

test('a lost native create response pauses safely and never retries by title, time or description similarity', async (t) => {
  const r = runtime(t); await oneMinute(r);
  r.failCreateAfterSave = true;
  await assert.rejects(r.calendar.syncActualDay(day, 'personal'), /response was lost/);
  assert.equal(r.events.size, 1);
  r.failCreateAfterSave = false;
  await assert.rejects(r.calendar.syncActualDay(day, 'personal'), /uncertain result[\s\S]*account/i);
  assert.equal(r.events.size, 1);
  assert.equal(r.calls.filter((call) => call.type === 'create').length, 1);
});

test('a returned native event ID survives an interrupted binding save and recovers without another create', async (t) => {
  const r = runtime(t); await oneMinute(r);
  const save = r.db.saveSyncBinding;
  r.db.saveSyncBinding = async () => { throw Error('Binding save interrupted'); };
  await assert.rejects(r.calendar.syncActualDay(day, 'personal'), /Binding save interrupted/);
  r.db.saveSyncBinding = save;
  await r.calendar.syncActualDay(day, 'personal');
  assert.equal(r.events.size, 1);
  assert.equal(r.calls.filter((call) => call.type === 'create').length, 1);
  assert.equal((await r.db.getSyncBindings(day))[0].eventId, ordered(r)[0].id);
});

test('actual shared-ledger peers block only unbound fresh native creates; own backup and bound updates stay available', async (t) => {
  const accounts = [{ consent: { ledgerStorage: true } }];
  const r = runtime(t, { accounts }); await oneMinute(r);
  r.db.getHasSharedLedgerPeer = async () => false;
  await r.calendar.syncActualDay(day, 'personal');
  r.db.getHasSharedLedgerPeer = async () => true;
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text: 'Changed coffee note', categoryId: 'unaccounted' });
  await r.calendar.syncActualDay(day, 'personal');
  assert.equal(r.events.size, 1);
  assert.match(ordered(r)[0].notes, /Changed coffee note/);
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 200, text: 'A new activity', categoryId: 'unaccounted' });
  await r.sheet.groupMinuteRange({ dateKey: day, startMinute: 200, endMinute: 200 }, { title: 'A new activity', categoryId: 'unaccounted' });
  await assert.rejects(r.calendar.syncActualDay(day, 'personal'), /shared ledger[\s\S]*account calendar editing/);
  assert.equal(r.events.size, 1);
});

test('legacy markers without a verified write baseline cannot overwrite or clean provider text', async (t) => {
  const r = runtime(t, { accounts: [{ consent: { ledgerStorage: true } }] });
  const segment = await oneMinute(r);
  r.db.getHasSharedLedgerPeer = async () => true;
  r.events.set('legacy-owned', { id: 'legacy-owned', calendarId: 'personal',
    startDate: new Date(2026, 9, 25, 1, 40).toISOString(), endDate: new Date(2026, 9, 25, 1, 41).toISOString(),
    notes: `Unaccounted\n\n1:40 AM Make coffee\nContext block: ${segment.blockId}\nContext projection: ${segment.segmentKey}\nFull minute record available in Context.` });
  const original = plain(r.events.get('legacy-owned'));
  await assert.rejects(r.calendar.syncActualDay(day, 'personal'), /no verified write baseline/);
  assert.equal(r.events.size, 1);
  assert.equal(r.calls.some((call) => call.type === 'create'), false);
  assert.deepEqual(plain(r.events.get('legacy-owned')), original);
  assert.equal(r.calls.length, 0);
});

test('overlapping two-color whole-border move rekeys the one event atomically and Undo restores its original time', async (t) => {
  const r = runtime(t); const group = await namedTwoColorActivity(r); const initial = ordered(r);
  assert.equal(initial.length, 1);
  const startCalls = r.calls.length;
  await r.sheet.moveActivityGroup(group, { dateKey: day, startMinute: 105 });
  await r.calendar.syncActualDay(day, 'personal');
  const moved = ordered(r);
  assert.deepEqual(moved.map((event) => event.id), initial.map((event) => event.id));
  assert.match(moved[0].notes, /A0[\s\S]*A4[\s\S]*B0[\s\S]*B4/);
  assert.equal(r.calls.slice(startCalls).filter((call) => call.type === 'create' || call.type === 'delete').length, 0);
  assert.equal((await r.db.getSyncBindings(day)).length, 1);
  await r.sheet.undoSpreadsheetEdit(); await r.calendar.syncActualDay(day, 'personal');
  assert.deepEqual(ordered(r).map((event) => [event.id, event.startDate]), initial.map((event) => [event.id, event.startDate]));
});

test('old-source-first cleanup defers deletion; cross-day border move, provider failure, retry and Undo retain the original event ID', async (t) => {
  const r = runtime(t); const group = await namedTwoColorActivity(r); const initial = ordered(r);
  const destination = { dateKey: '2026-11-07', startMinute: 600 };
  await r.sheet.moveActivityGroup(group, destination);
  const cleanup = await r.calendar.syncActualDay(day, 'personal');
  assert.equal(cleanup.removed, 0); assert.equal(r.events.size, 1);
  r.failUpdate = initial[0].id;
  await assert.rejects(r.calendar.syncActualDay(destination.dateKey, 'personal'), /Provider temporarily unavailable/);
  assert.equal((await r.db.getSyncBindings(day)).length, 0);
  assert.equal((await r.db.getSyncBindings(destination.dateKey)).length, 1, 'the ID mapping survives a later provider failure');
  assert.deepEqual([...r.events.keys()].sort(), initial.map((event) => event.id).sort());
  r.failUpdate = null;
  await r.calendar.syncActualDay(destination.dateKey, 'personal');
  assert.deepEqual(ordered(r).map((event) => event.id), initial.map((event) => event.id));
  await r.sheet.undoSpreadsheetEdit();
  await r.calendar.syncActualDay(destination.dateKey, 'personal');
  assert.equal(r.events.size, 1);
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
  assert.equal(r.events.size, 1);
});

test('ordinary unbordered minute notes stay private; explicit bordered activities create one calendar event', async (t) => {
  const r = runtime(t); await r.db.initializeDatabase();
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 600, text: 'Private thought', categoryId: 'study' });
  assert.deepEqual(plain(await r.calendar.syncActualDay(day, 'personal')), { created: 0, updated: 0, removed: 0 });
  assert.equal(r.events.size, 0); assert.equal(r.calls.length, 0);
  await r.sheet.groupMinuteRange({ dateKey: day, startMinute: 600, endMinute: 605 }, { title: 'Dentist', categoryId: 'study' });
  assert.equal((await r.calendar.syncActualDay(day, 'personal')).created, 1);
  assert.equal(r.events.size, 1); assert.equal(ordered(r)[0].title, 'Dentist');
  assert.equal(ordered(r)[0].notes, '10:00 AM  Private thought');
});

test('v1 exact legacy event imports remote dental move, rename, resize, cleared notes and color without old-slot residue or duplicate', async (t) => {
  const r = runtime(t); await r.db.initializeDatabase();
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 26, text: 'Placeholder', categoryId: 'study' });
  await r.sheet.applyCellFormat({ dateKey: day, startMinute: 26, endMinute: 26 }, { bold: true, textColor: '#123456' });
  const segment = (await r.db.getDaySegments(day))[0];
  const event = { id: 'exact-legacy-event', calendarId: 'personal', title: 'Placeholder',
    startDate: new Date(2026, 9, 25, 0, 26).toISOString(), endDate: new Date(2026, 9, 25, 0, 27).toISOString(),
    notes: '12:26 AM  Placeholder' };
  r.events.set(event.id, event);
  await r.db.saveSyncBinding({ segmentKey: segment.segmentKey, blockId: segment.blockId, dateKey: day, calendarId: 'personal', eventId: event.id });
  await r.db.setSetting(`calendar.native-write.v1.personal.${event.id}`, { version: 1, calendarId: 'personal', eventId: event.id,
    contentHash: r.codec.hashValue({ title: event.title, notes: event.notes, start: new Date(event.startDate).getTime(),
      end: new Date(event.endDate).getTime(), allDay: false, recurring: false }) });
  Object.assign(event, { title: 'Dental appointment', notes: '', startDate: new Date(2026, 9, 25, 9, 0).toISOString(),
    endDate: new Date(2026, 9, 25, 10, 20).toISOString(), displayColor: '#0B8043', location: 'Dental office' });
  const read = await nativeColorPlans(r, '#0B8043'); r.calls.length = 0;
  assert.deepEqual(plain(await r.calendar.reconcileLinkedNativeColors(day, read.plans, [read.calendar])), [day]);
  assert.equal(r.calls.length, 0, 'importing a source edit never writes the source calendar');
  assert.equal(await r.db.getMinuteEntry(day, 26), null);
  assert.deepEqual(plain((await r.db.getSpreadsheetCells({ dateKey: day, startMinute: 26, endMinute: 26 }))[0].format), {});
  const imported = await r.db.getEntriesForBlock(segment.blockId);
  assert.equal(imported.length, 80); assert.ok(imported.every((entry) => entry.text === ''));
  assert.equal(imported[0].minuteIndex, 540); assert.equal(imported.at(-1).minuteIndex, 619);
  assert.equal((await r.db.getDaySegments(day))[0].activityTitle, 'Dental appointment');
  assert.equal((await r.categories.listCategories()).find((category) => category.id === imported[0].categoryId).color, '#0B8043');
  const binding = (await r.db.getSyncBindings(day))[0];
  assert.equal(binding.eventId, event.id); assert.equal(binding.segmentKey, `${day}:${segment.blockId}:540-619`);
  await r.calendar.syncActualDay(day, 'personal');
  assert.equal(r.events.size, 1); assert.equal(r.calls.filter((call) => call.type === 'create' || call.type === 'delete').length, 0);
  assert.equal(r.events.get(event.id).title, 'Dental appointment'); assert.equal(r.events.get(event.id).notes, '');
  assert.equal(r.events.get(event.id).location, 'Dental office');
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 551, text: 'Talked with front desk', categoryId: imported[0].categoryId });
  await r.calendar.syncActualDay(day, 'personal');
  assert.equal(r.events.get(event.id).title, 'Dental appointment');
  assert.equal(r.events.get(event.id).notes, '9:11 AM  Talked with front desk');
  assert.equal(r.events.get(event.id).location, 'Dental office');
});

test('exact native binding reads a remote-only move on another date even when the old-day query returns no plan', async (t) => {
  const r = runtime(t); const original = await oneMinute(r, 'Original note'); await r.calendar.syncActualDay(day, 'personal');
  const event = ordered(r)[0]; Object.assign(r.events.get(event.id), { title: 'Tomorrow appointment', notes: '',
    startDate: new Date(2026, 9, 26, 9, 0).toISOString(), endDate: new Date(2026, 9, 26, 9, 3).toISOString(), displayColor: '#123456' });
  const read = await nativeColorPlans(r, '#123456'); assert.equal(read.plans.length, 0); r.calls.length = 0;
  assert.deepEqual(plain(await r.calendar.reconcileLinkedNativeColors(day, read.plans, [read.calendar])), [day, '2026-10-26']);
  assert.equal(await r.db.getMinuteEntry(day, 100), null);
  assert.equal((await r.db.getEntriesForBlock(original.blockId)).length, 3);
  assert.equal((await r.db.getDaySegments('2026-10-26'))[0].activityTitle, 'Tomorrow appointment');
  assert.equal((await r.db.getSyncBindings('2026-10-26'))[0].eventId, event.id);
  assert.equal(r.calls.length, 0);
});

test('compact native logs preserve consecutive repeats and blank minute gaps during remote prose edits', async (t) => {
  const r = runtime(t); await r.db.initializeDatabase();
  await r.db.saveMinuteRange({ dateKey: day, startMinute: 600, durationMinutes: 3, text: 'Wait', categoryId: 'study' });
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 604, text: 'Talk to dentist', categoryId: 'study' });
  await r.sheet.groupMinuteRange({ dateKey: day, startMinute: 600, endMinute: 605 }, { title: 'Dentist', categoryId: 'study' });
  await r.calendar.syncActualDay(day, 'personal');
  const event = r.events.get(ordered(r)[0].id);
  assert.equal(event.notes, '10:00 AM  Wait\n10:04 AM  Talk to dentist');
  event.notes = event.notes.replace('Wait', 'Waiting room'); const read = await nativeColorPlans(r, '#2952A3'); r.calls.length = 0;
  await r.calendar.reconcileLinkedNativeColors(day, read.plans, [read.calendar]);
  assert.deepEqual((await r.db.getDayEntries(day)).map((entry) => entry.text), ['Waiting room', 'Waiting room', 'Waiting room', '', 'Talk to dentist', '']);
  assert.equal(r.calls.length, 0);
});

test('unselected calendars do not import a bound event merely because the device still lists that calendar', async (t) => {
  const r = runtime(t); await oneMinute(r, 'Original note'); await r.calendar.syncActualDay(day, 'personal');
  const event = r.events.get(ordered(r)[0].id); event.title = 'Changed in an unselected calendar'; event.notes = '';
  const calendar = { id: 'personal', title: 'Personal', color: '#2952A3', allowsModifications: true, sourceName: 'Device', isPrimary: true };
  const read = await r.calendar.loadPlannedEventsResult([], day, [calendar]); r.calls.length = 0;
  assert.deepEqual(plain(await r.calendar.reconcileLinkedNativeColors(day, read.plans, [calendar])), []);
  assert.equal((await r.db.getMinuteEntry(day, 100)).text, 'Original note'); assert.equal(r.calls.length, 0);
});

test('a raw draft in an empty move destination blocks native import before old notes or binding can move', async (t) => {
  const options = {}; const r = runtime(t, options); await oneMinute(r, 'Original note'); await r.calendar.syncActualDay(day, 'personal');
  const event = r.events.get(ordered(r)[0].id); Object.assign(event, { title: 'Dental appointment', notes: '',
    startDate: new Date(2026, 9, 25, 9, 0).toISOString(), endDate: new Date(2026, 9, 25, 9, 2).toISOString() });
  options.colorGuard = (entries) => { if (entries.some((entry) => entry.minuteIndex === 540 && entry.text === '')) throw new Error('Destination raw draft'); };
  const binding = plain(await r.db.getSyncBindings(day)); const read = await nativeColorPlans(r, '#0B8043'); r.calls.length = 0;
  await assert.rejects(r.calendar.reconcileLinkedNativeColors(day, read.plans, [read.calendar]), /Destination raw draft/);
  assert.equal((await r.db.getMinuteEntry(day, 100)).text, 'Original note'); assert.equal(await r.db.getMinuteEntry(day, 540), null);
  assert.deepEqual(plain(await r.db.getSyncBindings(day)), binding); assert.equal(r.calls.length, 0);
});

test('a second provider edit while preparing native import leaves the current ledger untouched for retry', async (t) => {
  const options = {}; const r = runtime(t, options); await oneMinute(r, 'Original note'); await r.calendar.syncActualDay(day, 'personal');
  const event = r.events.get(ordered(r)[0].id); event.title = 'Dental appointment'; event.notes = '';
  options.beforePermissionRead = async () => { options.beforePermissionRead = undefined; event.title = 'Later provider edit'; };
  const read = await nativeColorPlans(r, '#0B8043'); r.calls.length = 0;
  await assert.rejects(r.calendar.reconcileLinkedNativeColors(day, read.plans, [read.calendar]), /changed again/);
  assert.equal((await r.db.getMinuteEntry(day, 100)).text, 'Original note'); assert.equal(event.title, 'Later provider edit'); assert.equal(r.calls.length, 0);
});

test('resizing one native event over another bordered activity pauses instead of overwriting its minute notes', async (t) => {
  const r = runtime(t); await r.db.initializeDatabase();
  await r.db.saveMinuteRange({ dateKey: day, startMinute: 100, durationMinutes: 5, text: 'First notes', categoryId: 'study' });
  await r.sheet.groupMinuteRange({ dateKey: day, startMinute: 100, endMinute: 104 }, { title: 'First event', categoryId: 'study' });
  await r.db.saveMinuteRange({ dateKey: day, startMinute: 105, durationMinutes: 5, text: 'Second notes', categoryId: 'work' });
  await r.sheet.groupMinuteRange({ dateKey: day, startMinute: 105, endMinute: 109 }, { title: 'Second event', categoryId: 'work' });
  await r.calendar.syncActualDay(day, 'personal');
  const before = plain(await r.db.getDayEntries(day)); const first = r.events.get(ordered(r)[0].id);
  first.endDate = new Date(2026, 9, 25, 1, 48).toISOString(); first.notes = '';
  const read = await nativeColorPlans(r, '#123456'); r.calls.length = 0;
  await assert.rejects(r.calendar.reconcileLinkedNativeColors(day, read.plans, [read.calendar]), /overlaps another/);
  assert.deepEqual(plain(await r.db.getDayEntries(day)), before); assert.equal(r.events.size, 2); assert.equal(r.calls.length, 0);
});

test('one bordered event keeps one native ID when its individual minute fill colors differ or change', async (t) => {
  const r = runtime(t); await namedTwoColorActivity(r);
  assert.equal(r.events.size, 1); const id = ordered(r)[0].id;
  assert.equal(new Set((await r.db.getDayEntries(day)).map((entry) => entry.categoryId)).size, 2);
  await r.sheet.colorMinuteRange({ dateKey: day, startMinute: 102, endMinute: 103 }, 'sleep');
  r.calls.length = 0;
  assert.deepEqual(plain(await r.calendar.syncActualDay(day, 'personal')), { created: 0, updated: 1, removed: 0 });
  assert.equal(r.events.size, 1); assert.equal(ordered(r)[0].id, id);
  assert.match(ordered(r)[0].notes, /A0[\s\S]*A4[\s\S]*B0[\s\S]*B4/);
  assert.equal(new Set((await r.db.getDayEntries(day)).map((entry) => entry.categoryId)).size, 3);
  assert.equal((await r.db.getSyncBindings(day)).length, 1);
  assert.equal(r.calls.filter((call) => call.type === 'create' || call.type === 'delete').length, 0);
});

test('receipt-less same-time external rename or cleared description requires review without a provider write', async (t) => {
  for (const field of ['title', 'notes']) {
    const r = runtime(t); await oneMinute(r, 'Original note'); await r.calendar.syncActualDay(day, 'personal');
    const event = r.events.get(ordered(r)[0].id);
    await r.db.setSetting(`calendar.native-write.v1.personal.${event.id}`, null);
    event[field] = field === 'title' ? 'External appointment title' : '';
    const before = plain(event); r.calls.length = 0;
    await assert.rejects(r.calendar.syncActualDay(day, 'personal'), /no verified write baseline/);
    assert.deepEqual(plain(r.events.get(event.id)), before); assert.equal(r.calls.length, 0);
    assert.equal(await r.db.getSetting(`calendar.native-write.v1.personal.${event.id}`, null), null);
  }
});

test('receipt-less exact current compact content may bootstrap its baseline before later authorized edits', async (t) => {
  const r = runtime(t); await oneMinute(r, 'Original note'); await r.calendar.syncActualDay(day, 'personal');
  const event = r.events.get(ordered(r)[0].id);
  await r.db.setSetting(`calendar.native-write.v1.personal.${event.id}`, null);
  await r.calendar.syncActualDay(day, 'personal');
  assert.equal((await r.db.getSetting(`calendar.native-write.v1.personal.${event.id}`, null)).version, 2);
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text: 'Later exact minute note', categoryId: 'unaccounted' });
  assert.equal((await r.calendar.syncActualDay(day, 'personal')).updated, 1);
  assert.equal(r.events.get(event.id).title, 'Original note'); assert.match(r.events.get(event.id).notes, /Later exact minute note/);
});
