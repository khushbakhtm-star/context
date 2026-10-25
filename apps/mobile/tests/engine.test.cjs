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
const iso = (minute) => new Date(2026, 9, 25, Math.floor(minute / 60), minute % 60).toISOString();
const consent = () => ({ ledgerStorage: false, calendarRead: true, calendarWrite: true,
  replaceOccurrences: true, importCalendarEdits: true,
  editInvitations: false, editSeries: false, categoryRead: false });
const account = (grants = {}) => ({ id: 'google:person', provider: 'google', subject: 'person',
  label: 'Personal Google', consent: { ...consent(), ...grants } });

function cloud() {
  const events = new Map();
  const files = new Map();
  const calls = [];
  const adapterAccounts = [];
  let serial = 1;
  let onGet = null;
  let onWriteFile = null;
  const key = (calendar, id) => `${calendar}:${id}`;
  const copy = (value) => value ? plain(value) : null;
  return {
    events, files, calls, adapterAccounts,
    set onGet(callback) { onGet = callback; },
    set onWriteFile(callback) { onWriteFile = callback; },
    seed(event) { events.set(key(event.calendarId, event.id), copy(event)); },
    edit(calendarId, id, changes) {
      const current = events.get(key(calendarId, id));
      if (!current) throw new Error('Cannot edit a missing test event.');
      events.set(key(calendarId, id), { ...current, ...changes, version: `v${++serial}` });
    },
    adapter: {
      async listCalendars() { return [{ id: 'personal', title: 'Personal', color: '#667B69', writable: true }]; },
      async listEvents(calendarId, start, end) {
        return [...events.values()].filter((event) => event.calendarId === calendarId &&
          event.start < end && event.end > start).map(copy);
      },
      async getEvent(calendarId, id) {
        calls.push({ type: 'get', calendarId, id });
        if (onGet) await onGet();
        return copy(events.get(key(calendarId, id)));
      },
      async createEvent(calendarId, write) {
        calls.push({ type: 'create', calendarId, write: copy(write) });
        const existing = [...events.values()].find((event) =>
          event.calendarId === calendarId && event.projectionId === write.projectionId);
        if (existing) return copy(existing);
        const event = { ...write, id: `actual-${write.projectionId}`, calendarId,
          allDay: false, version: `v${++serial}`, isSeriesMaster: false, deleted: false };
        events.set(key(calendarId, event.id), event);
        return copy(event);
      },
      async updateEvent(event, write) {
        calls.push({ type: 'update', id: event.id, write: copy(write) });
        const current = events.get(key(event.calendarId, event.id));
        if (current.version !== event.version) throw Object.assign(new Error('Precondition failed'), { status: 412 });
        if (current.isSeriesMaster) throw new Error('Series master mutation rejected');
        const saved = { ...current, ...write, version: `v${++serial}` };
        events.set(key(event.calendarId, event.id), saved);
        return copy(saved);
      },
      async deleteEvent(event) {
        calls.push({ type: 'delete', id: event.id });
        const current = events.get(key(event.calendarId, event.id));
        if (current?.version !== event.version) throw Object.assign(new Error('Precondition failed'), { status: 412 });
        events.delete(key(event.calendarId, event.id));
      },
      async getSeries(event) {
        calls.push({ type: 'getSeries', id: event.id, seriesId: event.seriesId });
        return copy(events.get(key(event.calendarId, event.seriesId ?? event.id)));
      },
      async updateSeries(event, write) {
        calls.push({ type: 'updateSeries', id: event.id, seriesId: event.seriesId, write: copy(write) });
        const masterKey = key(event.calendarId, event.seriesId ?? event.id);
        const master = events.get(masterKey);
        if (!master?.isSeriesMaster) throw new Error('The series master is unavailable.');
        const saved = { ...master, title: write.title, description: write.description,
          sourceOperationId: write.sourceOperationId, version: `v${++serial}` };
        events.set(masterKey, saved);
        return copy(saved);
      },
    },
    storage: {
      async listFiles() { return [...files.keys()].map((name) => ({ id: name, name })); },
      async readFile(file) { return files.get(file.name); },
      async writeFile(name, content) {
        if (onWriteFile) await onWriteFile(name, content);
        if (files.has(name) && files.get(name) !== content) throw new Error('Immutable file changed');
        files.set(name, content);
      },
    },
  };
}

// This loads the production engine, codec, and repository in isolated phone runtimes. Only native
// device APIs, OAuth, and HTTP transports are replaced; SQLite journal/merge/transactions and the
// actual encryption code remain in the exercised path.
function phone(t, remote, initialAccount = account()) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const secure = new Map();
  const accounts = [plain(initialAccount)];
  const nativeDb = {
    async execAsync(sql) { sqlite.exec(sql); },
    async runAsync(sql, ...parameters) {
      const result = sqlite.prepare(sql).run(...parameters);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowid };
    },
    async getFirstAsync(sql, ...parameters) { return sqlite.prepare(sql).get(...parameters) ?? null; },
    async getAllAsync(sql, ...parameters) { return sqlite.prepare(sql).all(...parameters); },
    async withExclusiveTransactionAsync(task) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await task(nativeDb); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
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
      module, exports: module.exports, console, Date, Math, Intl, TextEncoder, TextDecoder,
      Error, TypeError, RangeError, SyntaxError, Response, Headers, URL,
      Uint8Array, crypto: crypto.webcrypto, setTimeout, clearTimeout,
      require(name) {
        if (name === 'expo-sqlite') return { openDatabaseAsync: async () => nativeDb };
        if (name === 'expo-crypto') return { randomUUID: crypto.randomUUID,
          getRandomBytesAsync: async (count) => new Uint8Array(crypto.randomBytes(count)) };
        if (name === 'expo-secure-store') return {
          getItemAsync: async (key) => secure.get(key) ?? null,
          setItemAsync: async (key, value) => { secure.set(key, value); },
          deleteItemAsync: async (key) => { secure.delete(key); },
          WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'native-unlocked-only',
        };
        if (name.startsWith('.')) {
          const resolved = path.resolve(path.dirname(filename), `${name}.ts`);
          const syncFile = (file) => path.join(__dirname, '../src/sync', file);
          if (resolved === syncFile('accounts.ts')) return {
            getAccounts: async () => plain(accounts),
            accountFetch: async (selectedAccount, url, init) => {
              if (remote.accountFetch) return remote.accountFetch(selectedAccount, url, init);
              throw new Error(`Unexpected category network request in engine test: ${url}`);
            },
          };
          if (resolved === syncFile('providers.ts')) return {
            createCalendarAdapter: (selectedAccount) => {
              remote.adapterAccounts.push(plain(selectedAccount));
              return remote.adapter;
            },
          };
          if (resolved === syncFile('storage.ts')) return { createLedgerStorage: () => remote.storage };
          return load(resolved);
        }
        if (name.startsWith('@noble/')) return require(name);
        throw new Error(`Unexpected engine test import: ${name}`);
      },
    });
    vm.runInContext(code, context, { filename });
    cache.set(filename, module.exports);
    return module.exports;
  }
  const db = load(path.join(__dirname, '../src/data/database.ts'));
  const engine = load(path.join(__dirname, '../src/sync/engine.ts'));
  return { db, engine, accounts, secure, sqlite,
    codec: load(path.join(__dirname, '../src/sync/codec.ts')),
    categories: load(path.join(__dirname, '../src/services/categories.ts')) };
}

async function prepare(phone, storage = false) {
  await phone.db.initializeDatabase();
  await phone.engine.setAccountPreferences('google:person', {
    selectedCalendarIds: ['personal'], writeCalendarId: 'personal',
  });
  if (storage) await phone.engine.setLedgerPassphrase('Context shared private ledger passphrase');
}
const saveRange = (phone, start, duration, text = 'Pray fardh', categoryId = 'prayer') =>
  phone.db.saveMinuteRange({ dateKey: day, startMinute: start, durationMinutes: duration, text, categoryId });

function originalPrayer() {
  return { id: 'prayer-instance-20261025', calendarId: 'personal', title: 'Pray Maghrib',
    description: 'Original prayer notes', start: iso(1125), end: iso(1145),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, allDay: false, version: 'v1',
    seriesId: 'prayer-series', originalStart: iso(1125), isSeriesMaster: false, deleted: false };
}
function planned(event) {
  return { id: `google:person:${event.id}`, calendarId: event.calendarId, title: event.title,
    notes: event.description, color: '#667B69', startDate: new Date(event.start),
    endDate: new Date(event.end), allDay: event.allDay,
    accountEvent: { accountId: 'google:person', event: plain(event) } };
}
async function linkedPrayer(t, remote = cloud()) {
  const device = phone(t, remote);
  await prepare(device);
  const original = originalPrayer();
  remote.seed(original);
  await saveRange(device, 1135, 10);
  await device.engine.linkActualsToAccounts([day], planned(original));
  await device.engine.synchronizeAccounts();
  return { device, remote, original };
}

test('confirming a recurring plan updates only its concrete occurrence and preserves source notes', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  const updates = remote.calls.filter((call) => call.type === 'update');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, original.id);
  assert.notEqual(updates[0].id, original.seriesId);
  assert.equal(updates[0].write.start, iso(1135));
  assert.equal(updates[0].write.end, iso(1145));
  assert.match(updates[0].write.description, /Original prayer notes/);
  assert.match(updates[0].write.description, /6:55 PM  Pray fardh/);
  assert.equal(remote.calls.filter((call) => call.type === 'create').length, 0);
  const projection = (await device.engine.listProjections())[0];
  assert.equal(projection.sourceSeriesId, original.seriesId);
  assert.equal(projection.eventId, original.id);
  assert.equal(projection.state, 'synced');
});

test('an explicitly selected recurring-series change delegates to the series adapter then updates the selected instance', async (t) => {
  const remote = cloud();
  const device = phone(t, remote, account({ editSeries: true }));
  await prepare(device);
  const original = originalPrayer();
  remote.seed(original);
  remote.seed({ ...original, id: original.seriesId, isSeriesMaster: true });
  await saveRange(device, 1135, 10);
  await device.engine.linkActualsToAccounts([day], planned(original),
    { dateKey: day, minuteIndex: 1135 }, 'series');
  await device.engine.synchronizeAccounts();
  const seriesIndex = remote.calls.findIndex((call) => call.type === 'updateSeries');
  const instanceIndex = remote.calls.findIndex((call) => call.type === 'update');
  assert.ok(seriesIndex >= 0);
  assert.ok(instanceIndex > seriesIndex);
  assert.equal(remote.calls[seriesIndex].seriesId, original.seriesId);
  assert.equal(remote.calls[instanceIndex].id, original.id);
  assert.ok(remote.calls[seriesIndex].write.sourceOperationId);
  const projection = (await device.engine.listProjections())[0];
  assert.equal(projection.state, 'synced');
  assert.equal(projection.pendingSourceScope, undefined);
  assert.equal(projection.pendingSourceOperationId, undefined);
  await device.engine.synchronizeAccounts();
  assert.equal(remote.calls.filter((call) => call.type === 'updateSeries').length, 1);
});

test('recurring-series changes remain pending until their separate account permission is granted', async (t) => {
  const remote = cloud();
  const device = phone(t, remote, account({ editSeries: false }));
  await prepare(device);
  const original = originalPrayer();
  remote.seed(original);
  remote.seed({ ...original, id: original.seriesId, isSeriesMaster: true });
  await saveRange(device, 1135, 10);
  await device.engine.linkActualsToAccounts([day], planned(original),
    { dateKey: day, minuteIndex: 1135 }, 'series');
  const status = await device.engine.synchronizeAccounts();
  assert.match(status.message, /Allow recurring-series changes/);
  assert.equal(remote.calls.filter((call) => call.type === 'updateSeries' || call.type === 'update').length, 0);
  assert.equal((await device.engine.listProjections())[0].pendingSourceScope, 'series');
  device.accounts[0].consent.editSeries = true;
  await device.engine.synchronizeAccounts();
  assert.equal(remote.calls.filter((call) => call.type === 'updateSeries').length, 1);
  assert.equal((await device.engine.listProjections())[0].state, 'synced');
});

test('revoking source-occurrence permission blocks pending source mutations while calendar writes remain enabled', async (t) => {
  const remote = cloud();
  const device = phone(t, remote);
  await prepare(device);
  const original = originalPrayer();
  remote.seed(original);
  await saveRange(device, 1135, 10);
  await device.engine.linkActualsToAccounts([day], planned(original));
  device.accounts[0].consent.replaceOccurrences = false;
  await device.engine.synchronizeAccounts();
  assert.equal(remote.calls.filter((call) => call.type === 'update').length, 0);
  assert.equal((await device.engine.listProjections())[0].state, 'pending');
  device.accounts[0].consent.replaceOccurrences = true;
  device.accounts[0].consent.editInvitations = true;
  await device.engine.synchronizeAccounts();
  assert.equal(remote.calls.filter((call) => call.type === 'update').length, 1);
  assert.equal(remote.adapterAccounts.at(-1).consent.replaceOccurrences, true);
  assert.equal(remote.adapterAccounts.at(-1).consent.editInvitations, true);
});

test('a selected recurring prayer is never bound to an unrelated earlier activity on the same date', async (t) => {
  const remote = cloud();
  const device = phone(t, remote);
  await prepare(device);
  const original = originalPrayer();
  remote.seed(original);
  await saveRange(device, 0, 60, 'Sleep', 'sleep');
  await saveRange(device, 1135, 10, 'Prayer', 'prayer');
  await device.engine.linkActualsToAccounts([day], planned(original), { dateKey: day, minuteIndex: 1135 });
  await device.engine.synchronizeAccounts();
  const update = remote.calls.find((call) => call.type === 'update' && call.id === original.id);
  assert.ok(update);
  assert.equal(update.write.start, iso(1135));
  assert.ok(!update.write.description.includes('Sleep'));
  const sourceProjection = (await device.engine.listProjections()).find((projection) =>
    projection.sourceEventId === original.id);
  assert.equal(sourceProjection.startMinute, 1135);
});

test('calendar description edits import into their corresponding minute and title', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  const current = remote.events.get(`personal:${original.id}`);
  remote.edit('personal', original.id, {
    title: 'Maghrib actual',
    description: current.description.replace('6:55 PM  Pray fardh', '6:55 PM  Begin fardh'),
  });
  const beforeUpdates = remote.calls.filter((call) => call.type === 'update').length;
  await device.engine.synchronizeAccounts();
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Begin fardh');
  assert.equal((await device.engine.listProjections())[0].title, 'Maghrib actual');
  assert.equal(remote.calls.filter((call) => call.type === 'update').length, beforeUpdates);
});

test('moving an event with unchanged minute notes shifts imported rows and tombstones old coordinates', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  remote.edit('personal', original.id, { start: iso(1140), end: iso(1150) });
  await device.engine.synchronizeAccounts();
  assert.equal(await device.db.getMinuteEntry(day, 1135), null);
  assert.equal((await device.db.getMinuteEntry(day, 1140)).text, 'Pray fardh');
  assert.equal((await device.db.getMinuteEntry(day, 1149)).text, 'Pray fardh');
  const document = (await device.db.getSyncDocuments('minute:')).find((item) => item.key === `minute:${day}:1135`);
  assert.equal(document.value, null);
  assert.equal((await device.engine.listProjections())[0].state, 'synced');
});

test('concurrent calendar and Context edits pause writes until the Context version is chosen', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 1135, text: 'Local changed thought', categoryId: 'prayer' });
  const current = remote.events.get(`personal:${original.id}`);
  remote.edit('personal', original.id, {
    description: current.description.replace('6:55 PM  Pray fardh', '6:55 PM  Calendar changed thought'),
  });
  const beforeUpdates = remote.calls.filter((call) => call.type === 'update').length;
  await device.engine.synchronizeAccounts();
  let projection = (await device.engine.listProjections())[0];
  assert.equal(projection.state, 'conflict');
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Local changed thought');
  assert.equal(remote.calls.filter((call) => call.type === 'update').length, beforeUpdates);
  await device.engine.resolveProjectionConflict(projection.id, 'context');
  await device.engine.synchronizeAccounts();
  projection = (await device.engine.listProjections())[0];
  assert.equal(projection.state, 'synced');
  assert.match(remote.events.get(`personal:${original.id}`).description, /Local changed thought/);
});

test('a local edit committed while the provider read awaits is reread before calendar import', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  const current = remote.events.get(`personal:${original.id}`);
  remote.edit('personal', original.id, {
    description: current.description.replace('6:55 PM  Pray fardh', '6:55 PM  Remote correction'),
  });
  remote.onGet = async () => {
    remote.onGet = null;
    await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 1135,
      text: 'Local thought captured during network read', categoryId: 'prayer' });
  };
  await device.engine.synchronizeAccounts();
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Local thought captured during network read');
  assert.equal((await device.engine.listProjections())[0].state, 'conflict');
  assert.match(remote.events.get(`personal:${original.id}`).description, /Remote correction/);
});

test('the SQLite import precondition rejects a local mutation after the import snapshot', async (t) => {
  const { device } = await linkedPrayer(t);
  const projection = (await device.engine.listProjections())[0];
  const expectedEntries = (await device.db.getDayEntries(day)).filter((entry) =>
    entry.blockId === projection.blockId);
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 1135,
    text: 'Last-moment local edit', categoryId: 'prayer' });
  await assert.rejects(device.db.replaceProjectedMinutes({
    blockId: projection.blockId, previousDate: day,
    previousStart: 1135, previousEnd: 1144, expectedEntries,
    entries: [{ dateKey: day, minuteIndex: 1135, text: 'Stale remote import', categoryId: 'prayer' }],
  }), /local activity changed during calendar import/);
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Last-moment local edit');
  assert.equal((await device.db.getDayEntries(day)).length, 10);
});

test('choosing the calendar conflict version imports the remote text without writing over it', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 1135, text: 'Local thought', categoryId: 'prayer' });
  const current = remote.events.get(`personal:${original.id}`);
  remote.edit('personal', original.id, {
    description: current.description.replace('6:55 PM  Pray fardh', '6:55 PM  Remote thought'),
  });
  await device.engine.synchronizeAccounts();
  const projection = (await device.engine.listProjections())[0];
  assert.equal(projection.state, 'conflict');
  await device.engine.resolveProjectionConflict(projection.id, 'calendar');
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Remote thought');
  assert.equal((await device.engine.listProjections())[0].state, 'synced');
});

test('revoking calendar-write or calendar-import consent prevents that direction of synchronization', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  device.accounts[0].consent.calendarWrite = false;
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 1135, text: 'Only on phone', categoryId: 'prayer' });
  const beforeUpdates = remote.calls.filter((call) => call.type === 'update').length;
  await device.engine.synchronizeAccounts();
  assert.equal(remote.calls.filter((call) => call.type === 'update').length, beforeUpdates);
  assert.ok(!remote.events.get(`personal:${original.id}`).description.includes('Only on phone'));

  device.accounts[0].consent.importCalendarEdits = false;
  remote.edit('personal', original.id, { title: 'Changed externally after revoke' });
  const status = await device.engine.synchronizeAccounts();
  assert.match(status.message, /Allow calendar edit import/);
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Only on phone');
});

test('revoking calendar-edit import while the provider read is in flight stops the later local import', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  const current = remote.events.get(`personal:${original.id}`);
  remote.edit('personal', original.id, {
    description: current.description.replace('6:55 PM  Pray fardh', '6:55 PM  Edit after permission revoked'),
  });
  remote.onGet = async () => { device.accounts[0].consent.importCalendarEdits = false; };
  await device.engine.synchronizeAccounts();
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Pray fardh');
});

test('provider conditional-write conflicts become an explicit review state', async (t) => {
  const { device, remote } = await linkedPrayer(t);
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 1135, text: 'Local correction', categoryId: 'prayer' });
  remote.adapter.updateEvent = async () => {
    throw Object.assign(new Error('Changed during conditional write'), { status: 412 });
  };
  await device.engine.synchronizeAccounts();
  const projection = (await device.engine.listProjections())[0];
  assert.equal(projection.state, 'conflict');
  assert.match(projection.conflict, /changed during synchronization/);
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Local correction');
});

test('external calendar deletion imports minute tombstones and retires the linked projection', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  remote.events.delete(`personal:${original.id}`);
  await device.engine.synchronizeAccounts();
  assert.equal((await device.db.getDayEntries(day)).length, 0);
  assert.equal((await device.engine.listProjections())[0].state, 'deleted');
  assert.ok((await device.db.getSyncDocuments('minute:')).every((document) => document.value === null));
});

test('overlapping calendar moves become review conflicts and preserve both local activities', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  await saveRange(device, 1160, 3, 'Study session', 'study');
  remote.edit('personal', original.id, { start: iso(1160), end: iso(1170) });
  await device.engine.synchronizeAccounts();
  assert.equal((await device.engine.listProjections())[0].state, 'conflict');
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Pray fardh');
  assert.equal((await device.db.getMinuteEntry(day, 1160)).text, 'Study session');
});

test('a categorized interruption never gives two projections ownership of the same recurring occurrence', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  const projectedEvent = plain(remote.events.get(`personal:${original.id}`));
  await saveRange(device, 1138, 2, 'Print for mum', 'family');
  await device.engine.linkActualsToAccounts([day], planned(projectedEvent),
    { dateKey: day, minuteIndex: 1138 });
  const projections = await device.engine.listProjections();
  assert.equal(projections.filter((projection) => projection.state !== 'deleted' &&
    projection.sourceEventId === original.id).length, 1);
});

test('an interrupted block projects every surviving segment and a later merge retires the child events', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  const projectedEvent = plain(remote.events.get(`personal:${original.id}`));
  await saveRange(device, 1138, 2, 'Print for mum', 'family');
  await device.engine.linkActualsToAccounts([day], planned(projectedEvent),
    { dateKey: day, minuteIndex: 1138 });
  await device.engine.synchronizeAccounts();
  const segments = [...remote.events.values()].map((event) => ({
    start: (Date.parse(event.start) - Date.parse(iso(0))) / 60000,
    end: (Date.parse(event.end) - Date.parse(iso(0))) / 60000,
    category: event.categoryId,
  })).sort((left, right) => left.start - right.start);
  assert.deepEqual(segments, [
    { start: 1135, end: 1138, category: 'prayer' },
    { start: 1138, end: 1140, category: 'family' },
    { start: 1140, end: 1145, category: 'prayer' },
  ]);
  assert.ok(remote.events.has(`personal:${original.id}`));

  await saveRange(device, 1138, 2, 'Pray fardh', 'prayer');
  await device.engine.linkActualsToAccounts([day], null, { dateKey: day, minuteIndex: 1138 });
  await device.engine.synchronizeAccounts();
  assert.equal(remote.events.size, 1);
  const merged = remote.events.get(`personal:${original.id}`);
  assert.ok(merged);
  assert.equal(merged.start, iso(1135));
  assert.equal(merged.end, iso(1145));
  assert.equal((await device.engine.listProjections()).filter((projection) => projection.state !== 'deleted').length, 1);
});

test('a cross-midnight activity remains one event and calendar movement imports both dates atomically', async (t) => {
  const remote = cloud();
  const device = phone(t, remote);
  await prepare(device);
  await saveRange(device, 1438, 5, 'Sleep', 'sleep');
  await device.engine.linkActualsToAccounts([day, '2026-10-26'], null,
    { dateKey: day, minuteIndex: 1438 });
  await device.engine.synchronizeAccounts();
  const projections = await device.engine.listProjections();
  assert.equal(projections.length, 1);
  assert.equal(projections[0].dateKey, day);
  assert.equal(projections[0].endDateKey, '2026-10-26');
  assert.equal(remote.calls.filter((call) => call.type === 'create').length, 1);
  const event = [...remote.events.values()][0];
  assert.equal(Date.parse(event.end) - Date.parse(event.start), 5 * 60000);
  assert.equal(event.start, iso(1438));
  assert.equal(event.end, iso(1443));
  remote.edit('personal', event.id, { start: iso(1448), end: iso(1453) });
  await device.engine.synchronizeAccounts();
  assert.equal((await device.db.getDayEntries(day)).length, 0);
  assert.equal(await device.db.getMinuteEntry('2026-10-26', 0), null);
  assert.equal((await device.db.getMinuteEntry('2026-10-26', 8)).text, 'Sleep');
  assert.equal((await device.db.getMinuteEntry('2026-10-26', 12)).text, 'Sleep');
  assert.equal((await device.engine.listProjections())[0].state, 'synced');
});

test('a phone timezone change preserves the original projection instants when its minute text is edited', async (t) => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const { device, remote, original } = await linkedPrayer(t);
    const before = plain(remote.events.get(`personal:${original.id}`));
    process.env.TZ = 'America/Los_Angeles';
    await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 1135,
      text: 'Edited while traveling', categoryId: 'prayer' });
    await device.engine.synchronizeAccounts();
    const after = remote.events.get(`personal:${original.id}`);
    assert.equal(after.start, before.start);
    assert.equal(after.end, before.end);
    assert.equal(after.timeZone, 'America/New_York');
    assert.match(after.description, /Edited while traveling/);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('an acknowledged winning ledger value still retains an older remote value for recovery', async (t) => {
  const remote = cloud();
  const device = phone(t, remote);
  await prepare(device);
  await saveRange(device, 510, 1, 'Acknowledged current thought', 'study');
  const current = (await device.db.getSyncDocuments('minute:'))[0];
  await device.db.acknowledgeUploaded('google:person', [current]);
  assert.equal((await device.db.getDocumentsForUpload('google:person')).length, 0);
  const loser = { ...plain(current), revision: '0000000000000001:00000000:otherdev',
    value: { ...plain(current.value), text: 'Previously unseen offline thought' } };
  await device.db.mergeSyncDocuments([loser]);
  assert.equal((await device.db.getMinuteEntry(day, 510)).text, 'Acknowledged current thought');
  const conflicts = await device.db.getLedgerConflicts();
  assert.ok(conflicts.some((document) => document.value?.text === 'Previously unseen offline thought'));
});

test('two independent phones exchange encrypted minute updates and deletion tombstones', async (t) => {
  const remote = cloud();
  const storageAccount = account({ ledgerStorage: true, calendarRead: false, calendarWrite: false,
    replaceOccurrences: false, importCalendarEdits: false });
  const first = phone(t, remote, storageAccount);
  const second = phone(t, remote, storageAccount);
  await prepare(first, true);
  await prepare(second, true);
  const customCategory = await first.categories.createCategory({ name: 'Research & reflection', color: '#123456' });
  await saveRange(first, 500, 1, 'Private thought from Android', customCategory.id);
  await first.engine.synchronizeAccounts();
  assert.ok(remote.files.size > 0);
  for (const ciphertext of remote.files.values()) {
    assert.ok(!ciphertext.includes('Private thought'));
    assert.equal(JSON.parse(ciphertext).cipher, 'AES-256-GCM');
  }
  await second.engine.synchronizeAccounts();
  assert.equal((await second.db.getMinuteEntry(day, 500)).text, 'Private thought from Android');
  const receivedCategory = (await second.categories.listCategories()).find((item) => item.id === customCategory.id);
  assert.equal(receivedCategory.name, 'Research & reflection');
  assert.equal(receivedCategory.color, '#123456');
  assert.equal((await second.db.getMinuteEntry(day, 500)).categoryId, receivedCategory.id);
  await second.categories.updateCategory(customCategory.id, { name: 'Private reflection', archived: true });
  await second.db.deleteMinuteEntry(day, 500);
  await second.engine.synchronizeAccounts();
  await first.engine.synchronizeAccounts();
  assert.equal(await first.db.getMinuteEntry(day, 500), null);
  const firstDocs = await first.db.getSyncDocuments('minute:');
  const secondDocs = await second.db.getSyncDocuments('minute:');
  assert.deepEqual(plain(firstDocs), plain(secondDocs));
  assert.equal(firstDocs[0].value, null);
  const updatedCategory = (await first.categories.listCategories()).find((item) => item.id === customCategory.id);
  assert.equal(updatedCategory.name, 'Private reflection');
  assert.equal(updatedCategory.archived, true);
});

test('wrong ledger passphrase is checked against already-seen encrypted files before upload', async (t) => {
  const remote = cloud();
  const storageAccount = account({ ledgerStorage: true, calendarRead: false, calendarWrite: false });
  const first = phone(t, remote, storageAccount);
  await prepare(first, true);
  await saveRange(first, 505, 1, 'Account-protected note');
  await first.engine.synchronizeAccounts();
  const initialFileCount = remote.files.size;
  assert.equal(await first.db.hasSeenSyncFile('google:person', [...remote.files.keys()][0]), true);
  await first.engine.setLedgerPassphrase('Incorrect ledger passphrase');
  await saveRange(first, 506, 1, 'Unsent thought');
  const result = await first.engine.synchronizeAccounts();
  assert.match(result.message, /Cannot unlock/);
  assert.equal(remote.files.size, initialFileCount);
  assert.equal(await first.engine.hasLedgerPassphrase(), false);
});

test('an existing pending encrypted upload is authenticated with the current passphrase before retry', async (t) => {
  const remote = cloud();
  const device = phone(t, remote, account({ ledgerStorage: true,
    calendarRead: false, calendarWrite: false }));
  await prepare(device, true);
  await saveRange(device, 520, 1, 'Pending upload note', 'study');
  const documents = await device.db.getDocumentsForUpload('google:person');
  const batch = { version: 1, id: 'pending-test', documents: plain(documents) };
  const ciphertext = await device.codec.encryptBatch(batch, 'Context shared private ledger passphrase');
  await device.db.setSetting('account.pendingBatch.google:person', {
    name: 'context-pending-test.json', ciphertext, batch,
  });
  await device.engine.setLedgerPassphrase('Incorrect pending-upload passphrase');
  const result = await device.engine.synchronizeAccounts();
  assert.match(result.message, /Cannot unlock/);
  assert.equal(remote.files.size, 0);
  assert.equal((await device.db.getDocumentsForUpload('google:person'))
    .filter((document) => document.key.startsWith('minute:')).length, 1);
});
