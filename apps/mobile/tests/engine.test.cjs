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
    sheet: load(path.join(__dirname, '../src/services/spreadsheet.ts')),
    inline: load(path.join(__dirname, '../src/services/inline-minutes.ts')),
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

test('a color-only minute projects its activity name without inventing ledger text', async (t) => {
  const remote = cloud();
  const device = phone(t, remote);
  await prepare(device);
  await device.db.saveMinuteRange({ dateKey: day, startMinute: 600, durationMinutes: 1,
    text: '', categoryId: 'sleep', allowEmptyText: true });
  await device.engine.linkActualsToAccounts([day], null, { dateKey: day, minuteIndex: 600 });
  await device.engine.synchronizeAccounts();
  const created = remote.calls.find((call) => call.type === 'create');
  assert.ok(created);
  assert.equal(created.write.title, 'Sleep');
  assert.equal(created.write.start, iso(600));
  assert.equal(created.write.end, iso(601));
  assert.match(created.write.description, /10:00 AM  \n/);
  assert.equal((await device.db.getMinuteEntry(day, 600)).text, '');
});

async function separateActualBeforeReplacement(t, grants = {}, sourceChanges = {}) {
  const remote = cloud();
  const device = phone(t, remote, account(grants));
  await prepare(device);
  const original = { ...originalPrayer(), ...sourceChanges };
  remote.seed(original);
  await saveRange(device, 1135, 1);
  await device.engine.linkActualsToAccounts([day], null, { dateKey: day, minuteIndex: 1135 });
  await device.engine.synchronizeAccounts();
  const copy = (await device.engine.listProjections()).find((item) => !item.sourceEventId && item.state === 'synced');
  assert.ok(copy);
  return { device, remote, original, copy };
}

test('explicit plan replacement after inline autosave updates the original and retires its generated copy', async (t) => {
  const { device, remote, original, copy } = await separateActualBeforeReplacement(t);
  await device.engine.linkActualsToAccounts([day], planned(original), { dateKey: day, minuteIndex: 1135 });
  await device.engine.synchronizeAccounts();
  const updated = remote.events.get(`personal:${original.id}`);
  assert.equal(updated.start, iso(1135));
  assert.equal(updated.end, iso(1136));
  assert.match(updated.description, /Original prayer notes/);
  assert.match(updated.description, /6:55 PM  Pray fardh/);
  assert.equal(remote.events.has(`personal:${copy.eventId}`), false);
  assert.ok(remote.calls.some((call) => call.type === 'delete' && call.id === copy.eventId));
  assert.ok(remote.calls.some((call) => call.type === 'update' && call.id === original.id));
  assert.equal(remote.calls.some((call) => call.type === 'updateSeries'), false);
  const projections = await device.engine.listProjections();
  assert.equal(projections.find((item) => item.id === copy.id).state, 'deleted');
  const active = projections.filter((item) => item.state !== 'deleted');
  assert.equal(active.length, 1);
  assert.equal(active[0].sourceEventId, original.id);
  assert.equal(active[0].sourceSeriesId, original.seriesId);
});

test('denied replacement permissions retain the existing inline copy and leave the source untouched', async (t) => {
  const cases = [
    { grants: { replaceOccurrences: false }, source: {}, scope: 'occurrence' },
    { grants: { editInvitations: false }, source: { isInvitation: true }, scope: 'occurrence' },
    { grants: { editSeries: false }, source: {}, scope: 'series' },
    { grants: {}, source: { canEdit: false }, scope: 'occurrence' },
  ];
  for (const item of cases) {
    const { device, remote, original, copy } = await separateActualBeforeReplacement(t, item.grants, item.source);
    const mutationsBefore = remote.calls.filter((call) => ['create', 'update', 'delete', 'updateSeries'].includes(call.type)).length;
    await device.engine.linkActualsToAccounts([day], planned(original),
      { dateKey: day, minuteIndex: 1135 }, item.scope);
    await device.engine.synchronizeAccounts();
    assert.equal(remote.calls.filter((call) => ['create', 'update', 'delete', 'updateSeries'].includes(call.type)).length,
      mutationsBefore);
    assert.equal(remote.events.get(`personal:${original.id}`).version, 'v1');
    assert.ok(remote.events.has(`personal:${copy.eventId}`));
    const active = (await device.engine.listProjections()).filter((projection) => projection.state !== 'deleted');
    assert.equal(active.length, 1);
    assert.equal(active[0].sourceEventId, null);
    assert.equal(active[0].eventId, copy.eventId);
  }
});

test('explicit selection cannot take a block already owned by a different source occurrence', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  const another = { ...original, id: 'different-prayer-instance', description: 'Another original', version: 'other-v1' };
  remote.seed(another);
  const mutationsBefore = remote.calls.filter((call) => ['create', 'update', 'delete'].includes(call.type)).length;
  await device.engine.linkActualsToAccounts([day], planned(another), { dateKey: day, minuteIndex: 1135 });
  await device.engine.synchronizeAccounts();
  assert.equal(remote.calls.filter((call) => ['create', 'update', 'delete'].includes(call.type)).length, mutationsBefore);
  const active = (await device.engine.listProjections()).filter((item) => item.state !== 'deleted');
  assert.equal(active.length, 1);
  assert.equal(active[0].sourceEventId, original.id);
  assert.equal(remote.events.get(`personal:${another.id}`).description, 'Another original');
});

test('replacing a plan preserves an externally edited generated copy as a review conflict', async (t) => {
  const { device, remote, original, copy } = await separateActualBeforeReplacement(t);
  remote.edit('personal', copy.eventId, { title: 'Changed directly in calendar', description: 'Keep this external note' });
  await device.engine.linkActualsToAccounts([day], planned(original), { dateKey: day, minuteIndex: 1135 });
  await device.engine.synchronizeAccounts();
  assert.equal(remote.events.get(`personal:${copy.eventId}`).description, 'Keep this external note');
  assert.equal(remote.calls.some((call) => call.type === 'delete' && call.id === copy.eventId), false);
  const retired = (await device.engine.listProjections()).find((item) => item.id === copy.id);
  assert.equal(retired.state, 'conflict');
  assert.equal(remote.events.get(`personal:${original.id}`).start, iso(1135));
});

test('a failed replacement-owner save cannot retire the existing generated copy', async (t) => {
  const { device, remote, original, copy } = await separateActualBeforeReplacement(t);
  const writeDocument = device.db.putSyncDocument;
  device.db.putSyncDocument = async (key, value) => {
    if (key.startsWith('projection:') && value?.sourceEventId === original.id) throw new Error('Replacement database write failed');
    return writeDocument(key, value);
  };
  await assert.rejects(device.engine.linkActualsToAccounts([day], planned(original),
    { dateKey: day, minuteIndex: 1135 }), /Replacement database write failed/);
  device.db.putSyncDocument = writeDocument;
  await device.engine.synchronizeAccounts();
  const remaining = (await device.engine.listProjections()).find((item) => item.id === copy.id);
  assert.equal(remaining.state, 'synced');
  assert.equal(remaining.blockId, copy.blockId);
  assert.ok(remote.events.has(`personal:${copy.eventId}`));
  assert.equal(remote.events.get(`personal:${original.id}`).version, 'v1');
  assert.equal(remote.calls.some((call) => call.type === 'delete'), false);
});

test('selecting the generated copy itself cannot retire or claim it as an original plan', async (t) => {
  const { device, remote, copy } = await separateActualBeforeReplacement(t);
  const copiedEvent = remote.events.get(`personal:${copy.eventId}`);
  await device.engine.linkActualsToAccounts([day], planned(copiedEvent), { dateKey: day, minuteIndex: 1135 });
  await device.engine.synchronizeAccounts();
  const active = (await device.engine.listProjections()).filter((item) => item.state !== 'deleted');
  assert.equal(active.length, 1);
  assert.equal(active[0].id, copy.id);
  assert.equal(active[0].sourceEventId, null);
  assert.ok(remote.events.has(`personal:${copy.eventId}`));
  assert.equal(remote.calls.some((call) => call.type === 'delete'), false);
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
  const customCategory = await first.categories.createCategory({ name: 'Research & reflection', color: '#2952A3' });
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
  assert.equal(receivedCategory.color, '#2952A3');
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

async function explicitGroup(device, start, notes, title = 'Study activity', categoryId = 'study', blockId = 'activity_provider_test') {
  const existing = new Map((await device.db.getDayEntries(day)).map((entry) => [entry.minuteIndex, entry]));
  const before = notes.map((_text, index) => ({ minuteIndex: start + index,
    entry: existing.get(start + index) ?? null, format: {} }));
  const target = notes.map((text, index) => ({ minuteIndex: start + index,
    entry: { text, categoryId, blockId }, format: { activityGroup: { id: blockId, title }, ...(index === 0 ? { italic: true } : {}) } }));
  await device.db.applySpreadsheetCells(day, target, before, { textChanged: true, formatChanged: true });
  await device.engine.linkActualsToAccounts([day], null, { dateKey: day, minuteIndex: start });
  await device.engine.synchronizeAccounts();
  return blockId;
}

test('a titled activity includes both selected endpoints, preserves minute notes, and imports calendar title/time edits atomically', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const start = 16 * 60 + 30;
  const blockId = await explicitGroup(device, start, ['', 'Read introduction', 'Take notes', 'Check source', 'Finish'], 'Read a paper');
  assert.equal((await device.db.getDayEntries(day)).length, 5);
  assert.equal(remote.events.size, 1);
  const event = [...remote.events.values()][0];
  assert.equal(event.title, 'Read a paper'); assert.equal(event.start, iso(start)); assert.equal(event.end, iso(start + 5));
  assert.match(event.description, /4:31 PM  Read introduction/);
  assert.match(event.description, /4:34 PM  Finish/);
  const movedStart = start + 10;
  remote.edit('personal', event.id, { title: 'Review revised paper', start: iso(movedStart), end: iso(movedStart + 5) });
  await device.engine.synchronizeAccounts();
  const moved = await device.db.getDayEntries(day);
  assert.equal(moved.length, 5);
  assert.deepEqual(moved.map((entry) => entry.minuteIndex), [movedStart, movedStart + 1, movedStart + 2, movedStart + 3, movedStart + 4]);
  assert.deepEqual(moved.map((entry) => entry.text), ['', 'Read introduction', 'Take notes', 'Check source', 'Finish']);
  assert.ok(moved.every((entry) => entry.blockId === blockId));
  const segments = await device.db.getDaySegments(day);
  assert.equal(segments.length, 1); assert.equal(segments[0].activityTitle, 'Review revised paper');
  const oldStyle = (await device.db.getSyncDocuments(`category:minuteFormat:${day}:${start}`))[0];
  assert.deepEqual(plain(oldStyle.value), { kind: 'minuteFormat', format: { italic: true } });
  const newLabel = (await device.db.getSyncDocuments(`category:minuteFormat:${day}:${movedStart}`))[0];
  assert.equal(newLabel.value.format.activityGroup.title, 'Review revised paper');
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: movedStart + 2, text: 'A further thought', categoryId: moved[2].categoryId });
  await device.engine.linkActualsToAccounts([day], null, { dateKey: day, minuteIndex: movedStart + 2 });
  await device.engine.synchronizeAccounts();
  assert.equal(remote.events.size, 1);
  assert.equal([...remote.events.values()][0].title, 'Review revised paper');
  assert.match([...remote.events.values()][0].description, /4:42 PM  A further thought/);
});

test('a differently colored minute inside an activity projects separately and imports its own title without retitling neighboring segments', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const start = 900;
  const blockId = await explicitGroup(device, start, ['', '', '', '', ''], 'Sleep', 'sleep', 'activity_color_split');
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: start + 2, text: 'Bathroom break', categoryId: 'physiological' });
  assert.equal((await device.db.getMinuteEntry(day, start + 2)).blockId, blockId);
  await device.engine.linkActualsToAccounts([day], null, { dateKey: day, minuteIndex: start + 2 });
  await device.engine.synchronizeAccounts();
  const events = [...remote.events.values()].sort((a, b) => a.start.localeCompare(b.start));
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((event) => [event.start, event.end, event.categoryId]), [
    [iso(start), iso(start + 2), 'sleep'], [iso(start + 2), iso(start + 3), 'physiological'], [iso(start + 3), iso(start + 5), 'sleep'],
  ]);
  remote.edit('personal', events[1].id, { title: 'Brief bathroom visit' });
  await device.engine.synchronizeAccounts();
  const segments = await device.db.getDaySegments(day);
  assert.deepEqual(plain(segments.map((segment) => segment.activityTitle)), ['Sleep', 'Brief bathroom visit', 'Sleep']);
  assert.equal([...remote.events.values()].find((event) => event.id === events[0].id).title, 'Sleep');
  assert.equal([...remote.events.values()].find((event) => event.id === events[2].id).title, 'Sleep');
});

test('whole named group moves and Undo reschedule the original approved event across hours and distant dates without replacing its identity', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const original = originalPrayer(); remote.seed(original);
  await explicitGroup(device, 1135, ['Kettle', 'Talk to Mum', 'Pour', 'Drink'], 'Make coffee');
  await device.engine.linkActualsToAccounts([day], planned(original), { dateKey: day, minuteIndex: 1135 });
  await device.engine.synchronizeAccounts();
  assert.equal(remote.events.size, 1); assert.equal([...remote.events.values()][0].id, original.id);
  const ids = () => [...remote.events.values()].map((event) => event.id);
  for (const destination of [{ dateKey: day, startMinute: 200 }, { dateKey: '2026-11-05', startMinute: 700 }]) {
    const currentProjection = (await device.engine.listProjections()).find((projection) => projection.sourceEventId === original.id && projection.state !== 'deleted');
    const group = await device.sheet.getMovableActivityGroup(currentProjection.dateKey, currentProjection.startMinute);
    const beforeCalls = remote.calls.length;
    await device.sheet.moveActivityGroup(group, destination); await device.inline.flushInlineMinutes(); await device.engine.synchronizeAccounts();
    assert.deepEqual(ids(), [original.id]);
    const saved = [...remote.events.values()][0];
    const start = new Date(`${destination.dateKey}T12:00:00`); start.setHours(Math.floor(destination.startMinute / 60), destination.startMinute % 60, 0, 0);
    assert.equal(saved.start, start.toISOString());
    assert.match(saved.description, /Kettle/); assert.match(saved.description, /Talk to Mum/); assert.match(saved.description, /Pour/); assert.match(saved.description, /Drink/);
    assert.equal(remote.calls.slice(beforeCalls).filter((call) => ['delete', 'create', 'updateSeries'].includes(call.type)).length, 0);
    await device.sheet.undoSpreadsheetEdit(); await device.inline.flushInlineMinutes(); await device.engine.synchronizeAccounts();
    assert.deepEqual(ids(), [original.id]); assert.equal([...remote.events.values()][0].start, iso(1135));
  }
});

test('multicolor overlapping and cross-day activity moves preserve every original calendar event ID and minute description through Undo', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const original = originalPrayer(); remote.seed(original);
  await explicitGroup(device, 1135, ['A1', 'A2', 'B1', 'B2'], 'Coffee');
  await device.sheet.colorMinuteRange({ dateKey: day, startMinute: 1137, endMinute: 1138 }, 'work');
  await device.inline.flushInlineMinutes();
  await device.engine.linkActualsToAccounts([day], planned(original), { dateKey: day, minuteIndex: 1135 });
  await device.engine.synchronizeAccounts();
  const initial = [...remote.events.values()].sort((a, b) => a.start.localeCompare(b.start));
  assert.equal(initial.length, 2); assert.equal(initial[0].id, original.id);
  const originalIds = initial.map((event) => event.id);
  for (const destination of [{ dateKey: day, startMinute: 1137 }, { dateKey: '2026-11-06', startMinute: 500 }]) {
    const group = await device.sheet.getMovableActivityGroup(day, 1135);
    const preview = await device.sheet.prepareActivityGroupMove(group, destination);
    await device.sheet.moveActivityGroup(group, destination, { previewToken: preview.token });
    await device.inline.flushInlineMinutes(); const result = await device.engine.synchronizeAccounts();
    assert.equal(result.message, 'Accounts synchronized');
    const current = [...remote.events.values()].sort((a, b) => a.start.localeCompare(b.start));
    assert.deepEqual(current.map((event) => event.id), originalIds);
    assert.match(current[0].description, /A1[\s\S]*A2/); assert.doesNotMatch(current[0].description, /B1/);
    assert.match(current[1].description, /B1[\s\S]*B2/); assert.doesNotMatch(current[1].description, /A1/);
    await device.sheet.undoSpreadsheetEdit(); await device.inline.flushInlineMinutes(); await device.engine.synchronizeAccounts();
    const undone = [...remote.events.values()].sort((a, b) => a.start.localeCompare(b.start));
    assert.deepEqual(undone.map((event) => event.id), originalIds);
    assert.deepEqual(undone.map((event) => event.start), initial.map((event) => event.start));
  }
});

test('moving a linked activity does not bypass a revoked calendar-write permission', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  await explicitGroup(device, 1000, ['A', 'B'], 'Read');
  const original = [...remote.events.values()][0];
  device.accounts[0].consent.calendarWrite = false;
  const before = remote.calls.length;
  const group = await device.sheet.getMovableActivityGroup(day, 1000);
  await device.sheet.moveActivityGroup(group, { dateKey: '2026-11-08', startMinute: 600 });
  await device.inline.flushInlineMinutes(); await device.engine.synchronizeAccounts();
  assert.equal(remote.events.get(`personal:${original.id}`).start, original.start);
  assert.equal(remote.calls.slice(before).filter((call) => ['create', 'update', 'delete', 'updateSeries'].includes(call.type)).length, 0);
  device.accounts[0].consent.calendarWrite = true;
  await device.engine.synchronizeAccounts();
  assert.equal(remote.events.size, 1); assert.notEqual(remote.events.get(`personal:${original.id}`).start, original.start);
});

test('a provider failure after atomic multicolor reanchoring can retry without changing source IDs or deleting original events', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  await explicitGroup(device, 1000, ['A1', 'A2', 'B1', 'B2'], 'Coffee');
  await device.sheet.colorMinuteRange({ dateKey: day, startMinute: 1002, endMinute: 1003 }, 'work');
  await device.inline.flushInlineMinutes(); await device.engine.synchronizeAccounts();
  const initial = [...remote.events.values()].sort((a, b) => a.start.localeCompare(b.start));
  assert.equal(initial.length, 2);
  remote.onGet = () => { if (remote.calls.at(-1).id === initial[1].id) throw new Error('Temporary provider failure'); };
  const startCalls = remote.calls.length;
  const group = await device.sheet.getMovableActivityGroup(day, 1000);
  await device.sheet.moveActivityGroup(group, { dateKey: '2026-11-05', startMinute: 700 });
  await device.inline.flushInlineMinutes();
  const failed = await device.engine.synchronizeAccounts();
  assert.match(failed.message, /Temporary provider failure/);
  assert.deepEqual([...remote.events.values()].map((event) => event.id).sort(), initial.map((event) => event.id).sort());
  remote.onGet = null;
  const retried = await device.engine.synchronizeAccounts(); assert.equal(retried.message, 'Accounts synchronized');
  const moved = [...remote.events.values()].sort((a, b) => a.start.localeCompare(b.start));
  assert.deepEqual(moved.map((event) => event.id), initial.map((event) => event.id));
  assert.match(moved[0].description, /A1[\s\S]*A2/); assert.match(moved[1].description, /B1[\s\S]*B2/);
  await device.sheet.undoSpreadsheetEdit(); await device.inline.flushInlineMinutes(); await device.engine.synchronizeAccounts();
  assert.deepEqual([...remote.events.values()].sort((a, b) => a.start.localeCompare(b.start)).map((event) => [event.id, event.start]),
    initial.map((event) => [event.id, event.start]));
  assert.equal(remote.calls.slice(startCalls).filter((call) => ['create', 'delete', 'updateSeries'].includes(call.type)).length, 0);
});

test('ambiguous moved named-group geometry preserves existing calendar events for review instead of deleting them', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  await explicitGroup(device, 1000, ['A1', 'A2', 'B1', 'B2'], 'Coffee');
  await device.sheet.colorMinuteRange({ dateKey: day, startMinute: 1002, endMinute: 1003 }, 'work');
  await device.inline.flushInlineMinutes(); await device.engine.synchronizeAccounts();
  const initial = plain([...remote.events.values()]);
  const group = await device.sheet.getMovableActivityGroup(day, 1000);
  const sourceCells = await device.db.getSpreadsheetCells({ dateKey: day, startMinute: 1000, endMinute: 1003 });
  const targetCells = await device.db.getSpreadsheetCells({ dateKey: '2026-11-06', startMinute: 500, endMinute: 503 });
  // A merged ledger may contain a simultaneous color edit and move; its changed
  // run geometry is not a provable translation of either existing source event.
  await device.db.applySpreadsheetTransaction([
    { day, expected: sourceCells, target: sourceCells.map((cell) => ({ minuteIndex: cell.minuteIndex, entry: null, format: {} })) },
    { day: '2026-11-06', expected: targetCells, target: sourceCells.map((cell, index) => ({ minuteIndex: 500 + index,
      entry: { text: cell.entry.text, categoryId: index === 1 ? 'work' : cell.entry.categoryId, blockId: group.blockId }, format: cell.format })) },
  ], { textChanged: true, formatChanged: true });
  const beforeCalls = remote.calls.length;
  const result = await device.engine.synchronizeAccounts();
  assert.match(result.message, /ambiguous calendar shape/);
  assert.deepEqual(plain([...remote.events.values()]), initial);
  assert.equal(remote.calls.slice(beforeCalls).filter((call) => ['create', 'update', 'delete', 'updateSeries'].includes(call.type)).length, 0);
  assert.equal((await device.db.getDayEntries('2026-11-06')).length, 4);
});
