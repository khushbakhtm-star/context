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
  t.after(async () => {
    await inline.inlineMinuteDrafts.flushAll();
    await inline.retryInlineMinuteLinks();
    await engine.synchronizeAccounts();
    sqlite.close();
  });
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
            createCalendarMetadataReadCache: () => Object.freeze({}),
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
  const inline = load(path.join(__dirname, '../src/services/inline-minutes.ts'));
  return { db, engine, accounts, secure, sqlite,
    sheet: load(path.join(__dirname, '../src/services/spreadsheet.ts')),
    inline,
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

test('account plan display uses raw provider colors, then provider-original category colors, then calendar fallback', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  await device.db.putSyncDocument('category:source_color', { id: 'source_color', name: 'Google color', color: '#AB8B00',
    provider: 'google', accountId: 'google:person', providerColorId: '7', providerOriginalColor: '#123456' });
  await device.categories.listCategories();
  const original = { ...originalPrayer(), googleColorId: '7' }; remote.seed(original);
  assert.equal((await device.engine.loadAccountPlans(day))[0].color, '#123456');
  remote.edit('personal', original.id, { displayColor: '#aBcDeF' });
  assert.equal((await device.engine.loadAccountPlans(day))[0].color, '#aBcDeF');
  remote.edit('personal', original.id, { displayColor: undefined, googleColorId: undefined });
  const fallback = (await device.engine.loadAccountPlans(day))[0];
  assert.equal(fallback.color, '#667B69'); assert.equal(fallback.sourceProvider, 'google');
  assert.equal(remote.calls.filter((call) => ['create', 'update', 'delete', 'updateSeries'].includes(call.type)).length, 0);
});

test('a newly recorded source-colored note survives SQLite reload and an explicit chosen color overrides it', async (t) => {
  const device = phone(t, cloud()); await prepare(device);
  const source = await device.categories.ensureSourceColorCategory({ color: '#123456', name: 'Personal calendar Â· #123456',
    calendarId: 'personal', provider: 'device' });
  device.inline.inlineMinuteDrafts.activate({ dateKey: day, minuteIndex: 759, text: 'Make coffee', categoryId: source.id, keepColor: false });
  device.sheet.editInlineMinute(day, 759, { text: 'Talk to Mum while making coffee' });
  await device.inline.flushInlineMinutes(); await device.inline.retryInlineMinuteLinks();
  assert.equal((await device.db.getMinuteEntry(day, 759)).categoryId, source.id);
  assert.equal((await device.categories.listCategories()).find((item) => item.id === source.id).color, '#123456');
  await device.sheet.colorMinuteRange({ dateKey: day, startMinute: 759, endMinute: 759 }, 'google_palette_2952a3');
  assert.equal((await device.db.getMinuteEntry(day, 759)).categoryId, 'google_palette_2952a3');
  assert.equal((await device.db.getMinuteEntry(day, 759)).text, 'Talk to Mum while making coffee');
});
// Calendar-export fixtures explicitly have a border/title. Plain ledger notes
// deliberately do not become events merely because calendar writing is enabled.
async function borderRange(phone, date, start, end, title) {
  for (const entry of (await phone.db.getDayEntries(date)).filter((entry) => entry.minuteIndex >= start && entry.minuteIndex <= end)) {
    await phone.db.putSyncDocument(`category:minuteFormat:${date}:${entry.minuteIndex}`, {
      kind: 'minuteFormat', format: { calendarEvent: { id: entry.blockId, title } },
    });
  }
}
async function saveRange(phone, start, duration, text = 'Pray fardh', categoryId = 'prayer', title = text) {
  await phone.db.saveMinuteRange({ dateKey: day, startMinute: start, durationMinutes: duration, text, categoryId });
  for (const date of [day, '2026-10-26']) {
    const from = date === day ? start : 0; const through = date === day ? Math.min(1439, start + duration - 1) : start + duration - 1441;
    if (through >= from) await borderRange(phone, date, from, through, title);
  }
}

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
  await saveRange(device, 1135, 10, 'Pray fardh', 'prayer', original.title);
  await device.engine.linkActualsToAccounts([day], planned(original));
  await device.engine.synchronizeAccounts();
  return { device, remote, original };
}

test('source note writeback preserves its original prayer title and exact Google color without a sync echo', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const original = { ...originalPrayer(), title: 'Pray', googleColorId: '10', displayColor: '#51B749' };
  remote.seed(original);
  await saveRange(device, 1135, 2, 'Prayed fardh and supplicated', 'unaccounted', original.title);
  await device.engine.linkActualsToAccounts([day], planned(original));
  await device.engine.synchronizeAccounts();
  const written = remote.calls.filter((call) => call.type === 'update');
  assert.equal(written.length, 1);
  assert.equal(written[0].write.title, 'Pray');
  assert.equal(written[0].write.googleColorId, '10');
  assert.match(written[0].write.description, /Prayed fardh and supplicated/);
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Prayed fardh and supplicated');
  await device.engine.synchronizeAccounts(); await device.engine.synchronizeAccounts();
  assert.equal(remote.calls.filter((call) => call.type === 'update').length, 1);
  assert.equal(remote.calls.filter((call) => call.type === 'create').length, 0);
});

test('an explicit activity title can rename its approved source without clearing an unmapped source label', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const original = { ...originalPrayer(), googleEventLabelId: 'label-prayer', displayColor: '#0B8043' };
  remote.seed(original);
  await explicitGroup(device, 1135, ['Prayed fardh', 'Supplicated'], 'Prayed Maghrib', 'unaccounted');
  await device.engine.linkActualsToAccounts([day], planned(original));
  await device.engine.synchronizeAccounts();
  const write = remote.calls.find((call) => call.type === 'update').write;
  assert.equal(write.title, 'Prayed Maghrib'); assert.equal(write.googleEventLabelId, 'label-prayer');
});

test('a new native-colored actual uses only an exact account Google palette identity', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  await device.db.putSyncDocument('category:google_api_basil', { id: 'google_api_basil', name: 'Basil',
    color: '#51B749', provider: 'google', accountId: 'google:person', providerColorId: '10', providerOriginalColor: '#51B749' });
  const exact = await device.categories.ensureSourceColorCategory({ color: '#51B749', name: 'Native exact', calendarId: 'native-1', provider: 'device' });
  const nativeDisplay = await device.categories.ensureSourceColorCategory({ color: '#0B8043', name: 'Native display', calendarId: 'native-1', provider: 'device' });
  await saveRange(device, 600, 1, 'Exact color', exact.id);
  await saveRange(device, 610, 1, 'Display color', nativeDisplay.id);
  await device.engine.linkActualsToAccounts([day]); await device.engine.synchronizeAccounts();
  const creates = remote.calls.filter((call) => call.type === 'create');
  assert.equal(creates.find((call) => call.write.title === 'Exact color').write.googleColorId, '10');
  assert.equal(creates.some((call) => call.write.title === 'Display color'), false,
    'an unsupported native Basil shade is reviewed rather than falsely acknowledged as a default-color event');
  assert.equal(device.engine.getAccountSyncStatus().outcome, 'error');
  assert.match(device.engine.getAccountSyncStatus().message, /no verified Google event or label mapping/);
});

test('prior source-title/color baselines import a real remote edit without a normalization conflict', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const original = { ...originalPrayer(), googleColorId: '10', displayColor: '#51B749' };
  remote.seed(original); await saveRange(device, 1135, 2, 'Pray fardh', 'unaccounted');
  await device.engine.linkActualsToAccounts([day], planned(original)); await device.engine.synchronizeAccounts();
  const projection = (await device.engine.listProjections())[0];
  const oldWrite = { ...remote.calls.find((call) => call.type === 'update').write, title: 'Pray fardh' };
  delete oldWrite.googleColorId; delete oldWrite.googleEventLabelId; delete oldWrite.microsoftCategories;
  delete oldWrite.sourceOperationId;
  await device.db.putSyncDocument(`projection:${projection.id}`, { ...projection, baseLocalHash: device.codec.hashValue(oldWrite) });
  remote.edit('personal', original.id, { title: 'User renamed prayer' });
  await device.engine.synchronizeAccounts();
  const saved = (await device.engine.listProjections())[0];
  assert.equal(saved.state, 'synced'); assert.equal(saved.title, 'User renamed prayer');
  assert.equal(remote.calls.filter((call) => call.type === 'update').length, 1);
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Pray fardh');
});

test('a user calendar rename to Unaccounted is not guessed to be historical corruption', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  remote.edit('personal', original.id, { title: 'Unaccounted' });
  await device.engine.synchronizeAccounts(); await device.engine.synchronizeAccounts();
  assert.equal(remote.events.get(`personal:${original.id}`).title, 'Unaccounted');
  assert.equal((await device.engine.listProjections())[0].title, 'Unaccounted');
  assert.equal(remote.calls.filter((call) => call.type === 'update').length, 1);
});

function editFirstPrayerMinute(description, text) {
  const range = '6:55 PM â€“ 7:05 PM  Pray fardh';
  if (description.includes(range)) return description.replace(range, `6:55 PM  ${text}\n6:56 PM â€“ 7:05 PM  Pray fardh`);
  assert.ok(description.includes('6:55 PM  Pray fardh'), 'the external-edit fixture must change a real compact start');
  return description.replace('6:55 PM  Pray fardh', `6:55 PM  ${text}`);
}

test('many synchronization requests during a gated read drain in at most two passes and retain the newest local edit', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  let release; let started;
  const gate = new Promise((resolve) => { release = resolve; });
  const reached = new Promise((resolve) => { started = resolve; });
  let reads = 0;
  remote.onGet = async () => { reads++; if (reads === 1) { started(); await gate; } };
  remote.calls.length = 0;
  const first = device.engine.synchronizeAccounts();
  await reached;
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 1135, text: 'Newest thought during network read', categoryId: 'prayer' });
  const pending = Array.from({ length: 80 }, () => device.engine.synchronizeAccounts());
  release();
  const results = await Promise.all([first, ...pending]);
  assert.ok(reads >= 1 && reads <= 2, `${reads} provider read passes should be bounded at two`);
  assert.ok(results.every((result) => !result.running));
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Newest thought during network read');
  assert.ok(remote.events.get(`personal:${original.id}`).description.includes('Newest thought during network read'));
  remote.onGet = null;
});

test('shared account sync callers observe one exact completion cycle and safe phases across the follow-up pass', async (t) => {
  const { device, remote } = await linkedPrayer(t); const before = device.engine.getAccountSyncStatus();
  const events = []; const unsubscribe = device.engine.subscribeAccountSync((next) => events.push(plain(next))); t.after(unsubscribe);
  let started, release; const reached = new Promise((resolve) => { started = resolve; }); const gate = new Promise((resolve) => { release = resolve; });
  let reads = 0; remote.onGet = async () => { if (++reads === 1) { started(); await gate; } };
  const first = device.engine.synchronizeAccounts(); await reached;
  const active = device.engine.getAccountSyncStatus();
  assert.equal(active.running, true); assert.equal(active.outcome, 'running'); assert.equal(active.phase, 'calendar');
  assert.equal(active.cycleComplete, false); assert.ok(active.cycleId > before.cycleId);
  assert.equal(active.nativeWriteReady, false);
  assert.equal(device.engine.synchronizeAccounts(), first, 'joining callers share the same exact account promise');
  device.engine.requestAccountSynchronization(); // Actual work, rather than an observer, requests the follow-up pass.
  release(); const final = await first;
  assert.equal(final.outcome, 'success'); assert.equal(final.cycleComplete, true); assert.equal(final.running, false);
  assert.equal(final.cycleId, active.cycleId);
  assert.equal(final.nativeWriteReady, true);
  const completed = events.filter((event) => event.cycleComplete);
  assert.equal(completed.length, 1, 'the intermediate pass cannot masquerade as completion');
  assert.ok(events.every((event) => event.cycleId === final.cycleId));
  assert.ok(events.filter((event) => !event.cycleComplete).every((event) => event.running));
  assert.ok(events.filter((event) => event.outcome === 'running').every((event) => !/person|Pray|prayer/i.test(event.message)));
  remote.onGet = null;
  const next = await device.engine.synchronizeAccounts(); assert.ok(next.cycleId > final.cycleId); assert.equal(next.cycleComplete, true);
});

test('a native-bound legacy block cannot become a stale account copy while an unrelated new border still publishes', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const source = { ...originalPrayer(), id: 'legacy-provider-id', title: 'Externally changed activity', description: '', start: iso(700), end: iso(710) };
  remote.seed(source); await saveRange(device, 600, 3, 'Private earlier note', 'study', 'Earlier activity');
  const legacy = await device.db.getMinuteEntry(day, 600);
  await device.db.saveSyncBinding({ dateKey: day, segmentKey: `${day}:${legacy.blockId}:600-602`, blockId: legacy.blockId,
    calendarId: 'opaque-native-calendar', eventId: 'opaque-native-event' });
  const binding = plain((await device.db.getSyncBindingsForBlock(legacy.blockId))[0]);
  await device.db.saveMinuteRange({ dateKey: day, startMinute: 600, durationMinutes: 1,
    text: 'A newer private thought', categoryId: 'study', queueInlineLink: true });
  await saveRange(device, 800, 2, 'New note', 'work', 'New explicit border');
  await assert.rejects(device.engine.linkActualsToAccounts([day]), /phone-calendar activity needs review/);
  const result = await device.engine.synchronizeAccounts();
  assert.equal(result.outcome, 'continuing'); assert.equal(result.nativePendingCount, 1); assert.equal(result.nativeWriteReady, true);
  assert.match(result.message, /waiting for their original calendar connection/);
  assert.equal(remote.events.size, 2); assert.deepEqual(plain(remote.events.get(`personal:${source.id}`)), source);
  assert.equal(remote.calls.filter((call) => call.type === 'create').length, 1);
  assert.equal(remote.calls.find((call) => call.type === 'create').write.title, 'New explicit border');
  assert.equal((await device.engine.listProjections()).some((projection) => projection.blockId === legacy.blockId), false);
  assert.deepEqual(plain((await device.db.getSyncBindingsForBlock(legacy.blockId))[0]), binding);
  assert.equal((await device.db.getMinuteEntry(day, 600)).text, 'A newer private thought');
  assert.ok((await device.db.getPendingInlineMinuteLinks()).some((ticket) => ticket.minuteIndex === 600 && ticket.requiresAccountWriter),
    'the unapproved ticket stays retryable without starving later eligible local or imported work');
});

test('explicit permitted account source selection can take authority over an exact native-bound block without guessing its provider ID', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const source = { ...originalPrayer(), id: 'explicit-provider-id', title: 'Chosen activity', description: '', start: iso(600), end: iso(605) };
  remote.seed(source); await saveRange(device, 600, 3, 'Minute thought', 'study', source.title);
  const legacy = await device.db.getMinuteEntry(day, 600);
  await device.db.saveSyncBinding({ dateKey: day, segmentKey: `${day}:${legacy.blockId}:600-602`, blockId: legacy.blockId,
    calendarId: 'opaque-native-calendar', eventId: 'different-opaque-native-id' });
  await device.engine.linkActualsToAccounts([day], planned(source), { dateKey: day, minuteIndex: 600 });
  await device.engine.synchronizeAccounts();
  assert.equal(remote.events.size, 1); assert.equal(remote.calls.filter((call) => call.type === 'create').length, 0);
  const projection = (await device.engine.listProjections())[0]; assert.equal(projection.sourceEventId, source.id); assert.equal(projection.eventId, source.id);
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 601, text: 'Later exact note', categoryId: 'study' });
  await device.engine.linkActualsToAccounts([day]); const result = await device.engine.synchronizeAccounts();
  assert.equal(result.outcome, 'success'); assert.equal(remote.events.size, 1);
  assert.match(remote.events.get(`personal:${source.id}`).description, /Later exact note/);
  assert.equal((await device.db.getSyncBindingsForBlock(legacy.blockId)).length, 1, 'the account guard never deletes a native binding');
});

test('simultaneous source-link requests for the same coordinate establish only one projection owner', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const original = originalPrayer(); remote.seed(original); await saveRange(device, 1135, 3);
  await Promise.all(Array.from({ length: 30 }, () => device.engine.linkActualsToAccounts([day], planned(original),
    { dateKey: day, minuteIndex: 1135 })));
  const owners = (await device.engine.listProjections()).filter((projection) => projection.state !== 'deleted');
  assert.equal(owners.length, 1); assert.equal(owners[0].sourceEventId, original.id);
  await device.engine.synchronizeAccounts();
  assert.equal(remote.events.size, 1);
  assert.equal(remote.calls.filter((call) => call.type === 'update').length, 1);
  assert.equal(remote.calls.filter((call) => call.type === 'create').length, 0);
});

async function useVersionOneProjection(device, remote) {
  const { makeCalendarDescription, readCalendarDescription } = require('../src/utils/calendar-description.ts');
  const { minuteLabel } = require('../src/utils/time.ts');
  const projection = (await device.engine.listProjections())[0];
  const entries = await device.db.getEntriesForBlock(projection.blockId);
  const preserved = readCalendarDescription(projection.baseEvent, projection.id).preserved;
  const legacy = makeCalendarDescription(preserved, entries.map((entry) => `${minuteLabel(entry.minuteIndex, true)}  ${entry.text}`).join('\n'), 1);
  const acknowledged = { ...remote.calls.filter((call) => call.type === 'update').at(-1).write, ...legacy };
  delete acknowledged.sourceOperationId;
  const baseEvent = { ...projection.baseEvent, ...legacy };
  await device.db.putSyncDocument(`projection:${projection.id}`, { ...projection, baseEvent,
    baseLocalHash: device.codec.hashValue(acknowledged) });
  remote.seed(baseEvent);
  return baseEvent;
}

test('upgrading an untouched v1 projection imports an external minute edit without a formatter-only conflict', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  const base = await useVersionOneProjection(device, remote);
  const updates = remote.calls.filter((call) => call.type === 'update').length;
  remote.edit('personal', original.id, { description: base.description.replace('Pray fardh', 'Changed in Google Calendar') });
  const result = await device.engine.synchronizeAccounts();
  assert.equal(result.conflicts, 0);
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Changed in Google Calendar');
  assert.equal((await device.db.getMinuteEntry(day, 1136)).text, 'Pray fardh');
  assert.equal(remote.calls.filter((call) => call.type === 'update').length, updates);
});

test('v1 formatter compatibility does not hide a genuine simultaneous local and remote minute edit', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  const base = await useVersionOneProjection(device, remote);
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 1135, text: 'Local edited thought', categoryId: 'prayer' });
  remote.edit('personal', original.id, { description: base.description.replace('Pray fardh', 'Remote edited thought') });
  const result = await device.engine.synchronizeAccounts();
  assert.equal(result.conflicts, 1);
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Local edited thought');
  assert.ok(remote.events.get(`personal:${original.id}`).description.includes('Remote edited thought'));
});

async function linkedColoredActivity(t) {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const original = { ...originalPrayer(), displayColor: '#112233' }; remote.seed(original);
  await saveRange(device, 1135, 3, 'Make coffee', 'study');
  await device.sheet.groupMinuteRange({ dateKey: day, startMinute: 1135, endMinute: 1137 }, { title: 'Coffee', categoryId: 'study' });
  await device.sheet.applyCellFormat({ dateKey: day, startMinute: 1136, endMinute: 1136 }, { bold: true, italic: true });
  await device.engine.linkActualsToAccounts([day], planned(original));
  await device.engine.synchronizeAccounts();
  return { device, remote, original };
}

test('renaming, recoloring and moving two Context-created events imports without writing Unaccounted back', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  await saveRange(device, 24, 1, 'asdf', 'unaccounted');
  await saveRange(device, 26, 1, 'qwer', 'unaccounted');
  await device.engine.linkActualsToAccounts([day]); await device.engine.synchronizeAccounts();
  const projections = await device.engine.listProjections();
  const prayer = projections.find((item) => item.startMinute === 24);
  const doctor = projections.find((item) => item.startMinute === 26);
  assert.ok(prayer?.eventId && doctor?.eventId);
  remote.edit('personal', prayer.eventId, { title: 'Prayer', start: iso(389), end: iso(390),
    googleColorId: '10', displayColor: '#51B749' });
  remote.edit('personal', doctor.eventId, { title: 'Mum doctor appointment', start: iso(600), end: iso(660),
    googleColorId: '6', displayColor: '#FFB878', location: 'Clinic' });
  device.accounts[0].consent.importCalendarEdits = false; remote.calls.length = 0;
  await device.engine.synchronizeAccounts();
  assert.equal(remote.calls.filter((call) => ['update', 'create', 'delete'].includes(call.type)).length, 0);
  device.accounts[0].consent.importCalendarEdits = true;
  device.accounts[0].consent.editInvitations = true; device.accounts[0].consent.editSeries = true;
  await device.engine.synchronizeAccounts();
  assert.equal(await device.db.getMinuteEntry(day, 24), null); assert.equal(await device.db.getMinuteEntry(day, 26), null);
  assert.ok(await device.db.getMinuteEntry(day, 389)); assert.ok(await device.db.getMinuteEntry(day, 659));
  const categories = await device.categories.listCategories();
  const prayerEntry = await device.db.getMinuteEntry(day, 389); const doctorEntry = await device.db.getMinuteEntry(day, 600);
  assert.equal(categories.find((item) => item.id === prayerEntry.categoryId).color.toUpperCase(), '#51B749');
  assert.equal(categories.find((item) => item.id === doctorEntry.categoryId).color.toUpperCase(), '#FFB878');
  await device.engine.synchronizeAccounts(); await device.engine.synchronizeAccounts();
  assert.equal(remote.events.get(`personal:${prayer.eventId}`).title, 'Prayer');
  assert.equal(remote.events.get(`personal:${doctor.eventId}`).title, 'Mum doctor appointment');
  assert.equal(remote.events.get(`personal:${doctor.eventId}`).location, 'Clinic');
  assert.equal(remote.calls.filter((call) => ['update', 'create', 'delete'].includes(call.type)).length, 0);
  assert.ok((await device.engine.listProjections()).every((item) => item.state === 'synced'));
});

test('a renamed, moved and resized actual with its calendar description cleared imports blank notes and retains the provider title through later edits', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  await saveRange(device, 26, 1, 'Old scratch note', 'unaccounted');
  await device.engine.linkActualsToAccounts([day]); await device.engine.synchronizeAccounts();
  const original = (await device.engine.listProjections())[0];
  const targetDay = '2026-10-26';
  const instant = (minute) => new Date(2026, 9, 26, Math.floor(minute / 60), minute % 60).toISOString();
  remote.edit('personal', original.eventId, { title: 'Mum dentist appointment', description: '',
    start: instant(600), end: instant(660), googleColorId: '6', displayColor: '#FFB878', location: 'Dental clinic' });
  remote.calls.length = 0;
  device.accounts[0].consent.calendarWrite = false;
  await device.engine.synchronizeAccounts();
  assert.equal(await device.db.getMinuteEntry(day, 26), null);
  assert.deepEqual(plain((await device.db.getSpreadsheetCells({ dateKey: day, startMinute: 26, endMinute: 26 }))[0].format), {});
  const rows = await device.db.getDayEntries(targetDay);
  assert.equal(rows.length, 60); assert.ok(rows.every((entry) => entry.text === '' && entry.blockId === original.blockId));
  const colors = await device.categories.listCategories();
  assert.ok(rows.every((entry) => colors.find((color) => color.id === entry.categoryId).color === '#FFB878'));
  let projection = (await device.engine.listProjections())[0];
  assert.equal(projection.state, 'synced'); assert.equal(projection.title, 'Mum dentist appointment');
  assert.equal(projection.eventId, original.eventId);
  assert.equal((await device.db.getDaySegments(targetDay))[0].activityTitle, 'Mum dentist appointment');
  Object.assign(device.accounts[0].consent, { calendarWrite: true, replaceOccurrences: true, importCalendarEdits: true,
    editInvitations: true, editSeries: true, categoryRead: true });
  await device.engine.synchronizeAccounts(); await device.engine.synchronizeAccounts();
  assert.equal(remote.calls.filter((call) => ['create', 'update', 'delete', 'updateSeries'].includes(call.type)).length, 0);
  const current = remote.events.get(`personal:${original.eventId}`);
  assert.equal(current.title, 'Mum dentist appointment'); assert.equal(current.description, ''); assert.equal(current.location, 'Dental clinic');
  await device.db.saveMinuteEntry({ dateKey: targetDay, minuteIndex: 611, text: 'Speak with the front desk', categoryId: rows[0].categoryId });
  await device.engine.linkActualsToAccounts([targetDay], null, { dateKey: targetDay, minuteIndex: 611 });
  await device.engine.synchronizeAccounts();
  const after = remote.events.get(`personal:${original.eventId}`);
  assert.equal(remote.events.size, 1); assert.equal(after.title, 'Mum dentist appointment'); assert.equal(after.location, 'Dental clinic');
  assert.match(after.description, /10:11 AM  Speak with the front desk/);
  assert.doesNotMatch(after.description, /Unaccounted|12:26 AM|Old scratch note|10:00 AM\s*$/);
  assert.equal(remote.calls.filter((call) => call.type === 'update').length, 1);
  assert.equal(remote.calls.filter((call) => ['create', 'delete', 'updateSeries'].includes(call.type)).length, 0);
});

test('clearing a linked description removes its old visible prefix and minute log even when private suffix offsets remain', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  const before = remote.events.get(`personal:${original.id}`);
  assert.ok(before.descriptionLog.offset > 0);
  remote.edit('personal', original.id, { title: 'Dental visit', description: '', start: iso(600), end: iso(620) });
  remote.calls.length = 0;
  await device.engine.synchronizeAccounts();
  const rows = await device.db.getDayEntries(day);
  assert.equal(rows.length, 20); assert.ok(rows.every((entry) => entry.minuteIndex >= 600 && entry.minuteIndex < 620 && entry.text === ''));
  assert.equal((await device.engine.listProjections())[0].state, 'synced');
  assert.equal(remote.calls.filter((call) => ['create', 'update', 'delete'].includes(call.type)).length, 0);
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 611, text: 'Front desk', categoryId: rows[0].categoryId });
  await device.engine.synchronizeAccounts();
  const after = remote.events.get(`personal:${original.id}`);
  assert.equal(after.title, 'Dental visit');
  assert.match(after.description, /10:11 AM  Front desk/);
  assert.doesNotMatch(after.description, /Original prayer notes|Pray fardh|Unaccounted/);
});

test('clearing the last note of an existing generated event keeps its independent title and publishes no empty timestamps', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  await saveRange(device, 600, 3, 'Make coffee', 'unaccounted');
  await device.engine.linkActualsToAccounts([day]); await device.engine.synchronizeAccounts();
  const original = [...remote.events.values()][0];
  await device.sheet.clearTextMinuteRange({ dateKey: day, startMinute: 600, endMinute: 602 });
  await device.inline.retryInlineMinuteLinks({ synchronize: false }); await device.engine.synchronizeAccounts();
  const after = remote.events.get(`personal:${original.id}`);
  assert.equal(remote.events.size, 1); assert.equal(after.title, 'Make coffee'); assert.equal(after.description, '');
  assert.ok((await device.db.getDayEntries(day)).every((entry) => entry.text === ''));
});

test('missing timestamped minute notes remain blank instead of receiving the calendar activity title', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  await saveRange(device, 600, 5, 'Original', 'study');
  await device.engine.linkActualsToAccounts([day]); await device.engine.synchronizeAccounts();
  const original = [...remote.events.values()][0];
  remote.edit('personal', original.id, { title: 'Dental visit',
    description: '10:00 AM  Arrive\n10:04 AM  Leave', descriptionLog: { version: 2,
      offset: original.descriptionLog.offset, prefixHash: original.descriptionLog.prefixHash, logHash: original.descriptionLog.logHash } });
  await device.engine.synchronizeAccounts();
  assert.deepEqual((await device.db.getDayEntries(day)).map((entry) => entry.text), ['Arrive', '', '', '', 'Leave']);
  assert.equal((await device.engine.listProjections())[0].title, 'Dental visit');
});

test('a full account event import pauses for raw drafts at either its old coordinates or its destination', async (t) => {
  for (const draftMinute of [26, 611]) {
    const remote = cloud(); const device = phone(t, remote); await prepare(device);
    await saveRange(device, 26, 1, 'Saved original', 'unaccounted');
    await device.engine.linkActualsToAccounts([day]); await device.engine.synchronizeAccounts();
    const projection = (await device.engine.listProjections())[0];
    remote.edit('personal', projection.eventId, { title: 'Dental visit', description: '', start: iso(600), end: iso(620) });
    const checked = [];
    device.engine.configureCalendarColorImports({ canImport: (entries) => {
      checked.push(...entries.map((entry) => entry.minuteIndex));
      return entries.every((entry) => entry.minuteIndex !== draftMinute);
    } });
    remote.calls.length = 0;
    await device.engine.synchronizeAccounts();
    assert.ok(checked.includes(26) && checked.includes(611));
    assert.equal((await device.db.getMinuteEntry(day, 26)).text, 'Saved original');
    assert.equal(await device.db.getMinuteEntry(day, 611), null);
    assert.equal((await device.engine.listProjections())[0].state, 'conflict');
    assert.equal(remote.calls.filter((call) => ['create', 'update', 'delete'].includes(call.type)).length, 0);
    device.engine.configureCalendarColorImports(null);
  }
});

test('a committed account move notifies clean draft rebasing for both blank old coordinates and every imported note', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  await saveRange(device, 26, 1, 'Old scratch note', 'study');
  await device.engine.linkActualsToAccounts([day]); await device.engine.synchronizeAccounts();
  const projection = (await device.engine.listProjections())[0]; const notifications = [];
  device.engine.configureCalendarColorImports({ canImport: () => true,
    onImported: (entries, replaceText) => notifications.push({ entries: plain(entries), replaceText }) });
  remote.edit('personal', projection.eventId, { title: 'Dental visit', description: '', start: iso(600), end: iso(603) });
  await device.engine.synchronizeAccounts();
  const notice = notifications.find((item) => item.replaceText);
  assert.ok(notice); assert.deepEqual(notice.entries.map((entry) => entry.minuteIndex), [26, 600, 601, 602]);
  assert.equal(notice.entries[0].text, ''); assert.equal(notice.entries[0].blockId, '');
  assert.ok(notice.entries.slice(1).every((entry) => entry.text === '' && entry.blockId === projection.blockId));
  device.engine.configureCalendarColorImports(null);
});

test('a provider recolor fills exact linked account minutes without rewriting notes, group formatting or the source', async (t) => {
  const { device, remote, original } = await linkedColoredActivity(t);
  const before = plain(await device.db.getSpreadsheetCells({ dateKey: day, startMinute: 1135, endMinute: 1137 }));
  const pending = plain(await device.db.getPendingSyncDates()); remote.calls.length = 0;
  remote.edit('personal', original.id, { displayColor: '#123456' });
  assert.deepEqual(plain(await device.engine.reconcileLinkedAccountColors([day])), [day]);
  const after = plain(await device.db.getSpreadsheetCells({ dateKey: day, startMinute: 1135, endMinute: 1137 }));
  for (let index = 0; index < after.length; index++) {
    const category = (await device.categories.listCategories()).find((item) => item.id === after[index].entry.categoryId);
    assert.equal(category.color, '#123456');
    for (const field of ['id', 'text', 'blockId', 'source', 'createdAt']) assert.equal(after[index].entry[field], before[index].entry[field]);
    assert.deepEqual(after[index].format, before[index].format);
  }
  assert.deepEqual(plain(await device.db.getPendingSyncDates()), pending);
  await device.engine.synchronizeAccounts();
  assert.equal(remote.calls.filter((call) => ['update', 'create', 'delete', 'updateSeries'].includes(call.type)).length, 0);
});

test('unchanged account color preserves a local selection and simultaneous color changes retain local cells as a conflict', async (t) => {
  const { device, remote, original } = await linkedColoredActivity(t);
  await device.sheet.colorMinuteRange({ dateKey: day, startMinute: 1135, endMinute: 1137 }, 'google_palette_2952a3');
  const local = plain(await device.db.getDayEntries(day)); remote.calls.length = 0;
  await device.engine.reconcileLinkedAccountColors([day]);
  assert.deepEqual(plain(await device.db.getDayEntries(day)), local);
  remote.edit('personal', original.id, { displayColor: '#123456' });
  await assert.rejects(device.engine.reconcileLinkedAccountColors([day]), /changed in Context and the calendar/);
  assert.deepEqual(plain(await device.db.getDayEntries(day)), local);
  assert.ok((await device.engine.listProjections()).some((projection) => projection.state === 'conflict'));
  assert.equal(remote.calls.filter((call) => ['update', 'create', 'delete'].includes(call.type)).length, 0);
});

test('a color-only account import preserves pending local text for a later authorized write', async (t) => {
  const { device, remote, original } = await linkedColoredActivity(t);
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 1136, text: 'Talk to Mum about the doctor', categoryId: 'study' });
  remote.edit('personal', original.id, { displayColor: '#123456' }); remote.calls.length = 0;
  await device.engine.reconcileLinkedAccountColors([day]);
  assert.equal((await device.db.getMinuteEntry(day, 1136)).text, 'Talk to Mum about the doctor');
  assert.equal(remote.calls.filter((call) => call.type === 'update').length, 0);
  assert.ok((await device.engine.listProjections()).some((projection) => projection.state === 'pending'));
  await device.engine.synchronizeAccounts();
  assert.ok(remote.calls.some((call) => call.type === 'update' && call.write.description.includes('Talk to Mum about the doctor')));
});

test('account color import respects consent and the global uncommitted-draft guard', async (t) => {
  const { device, remote, original } = await linkedColoredActivity(t);
  const before = plain(await device.db.getDayEntries(day));
  remote.edit('personal', original.id, { displayColor: '#123456' });
  device.accounts[0].consent.importCalendarEdits = false;
  await device.engine.reconcileLinkedAccountColors([day]);
  assert.deepEqual(plain(await device.db.getDayEntries(day)), before);
  device.accounts[0].consent.importCalendarEdits = true;
  device.engine.configureCalendarColorImports({ canImport: () => false });
  await assert.rejects(device.engine.reconcileLinkedAccountColors([day]), /being edited/);
  assert.deepEqual(plain(await device.db.getDayEntries(day)), before);
  device.engine.configureCalendarColorImports(null);
  await device.engine.reconcileLinkedAccountColors([day]);
  assert.notEqual((await device.db.getMinuteEntry(day, 1135)).categoryId, before[0].categoryId);
});

test('identical normalized account-color bursts share one remote pass and retry freshly after it completes', async (t) => {
  const { device, remote, original } = await linkedColoredActivity(t);
  remote.edit('personal', original.id, { displayColor: '#123456' });
  let release, started; const gate = new Promise((resolve) => { release = resolve; }); const reached = new Promise((resolve) => { started = resolve; });
  let reads = 0; remote.onGet = async () => { reads++; started(); await gate; };
  const bursts = Array.from({ length: 40 }, (_, index) => device.engine.reconcileLinkedAccountColors(index % 2 ? [day] : [day, day]));
  await reached; release(); const results = await Promise.all(bursts);
  assert.equal(reads, 1); assert.ok(results.every((dates) => JSON.stringify(dates) === JSON.stringify([day])));
  remote.onGet = async () => { reads++; };
  assert.deepEqual(plain(await device.engine.reconcileLinkedAccountColors([day])), []);
  assert.equal(reads, 2, 'completed results are not retained as a permanent color cache'); remote.onGet = null;
});

test('an older color read cannot delay or undo a newer source write and its acknowledged projection', async (t) => {
  const { device, remote, original } = await linkedColoredActivity(t);
  const isOriginal = (projection) => projection.state !== 'deleted' && projection.eventId === original.id &&
    projection.sourceEventId === original.id && projection.calendarId === original.calendarId;
  remote.edit('personal', original.id, { displayColor: '#123456' });
  const get = remote.adapter.getEvent; let first = true, release, started;
  const gate = new Promise((resolve) => { release = resolve; }); const reached = new Promise((resolve) => { started = resolve; });
  remote.adapter.getEvent = async (...args) => { const event = await get(...args); if (first) { first = false; started(); await gate; } return event; };
  const old = device.engine.reconcileLinkedAccountColors([day]); await reached;
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 1136, text: 'Newest exact source note', categoryId: 'study' });
  remote.edit('personal', original.id, { displayColor: '#654321' });
  let timeout; try {
    await Promise.race([(async () => { await device.engine.synchronizeAccounts(); await device.engine.synchronizeAccounts(); })(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('A held color read blocked the core writer')), 4000); })]);
    const before = plain(await device.db.getDayEntries(day));
    const owners = (await device.engine.listProjections()).filter(isOriginal);
    assert.equal(owners.length, 1); const projection = plain(owners[0]);
    assert.match(remote.events.get(`personal:${original.id}`).description, /Newest exact source note/);
    const category = (await device.categories.listCategories()).find((item) => item.id === before[0].categoryId);
    assert.equal(category.color, '#654321'); release();
    assert.deepEqual(plain(await old), []); assert.deepEqual(plain(await device.db.getDayEntries(day)), before);
    const after = (await device.engine.listProjections()).filter(isOriginal);
    assert.equal(after.length, 1); assert.deepEqual(plain(after[0]), projection);
  } finally { clearTimeout(timeout); release(); await old.catch(() => {}); }
});

test('permission, calendar selection and account removal during a color read prevent its later local commit', async (t) => {
  for (const revoke of ['import', 'selection', 'account']) {
    const { device, remote, original } = await linkedColoredActivity(t); const before = plain(await device.db.getDayEntries(day));
    remote.edit('personal', original.id, { displayColor: '#123456' });
    let release, started; const gate = new Promise((resolve) => { release = resolve; }); const reached = new Promise((resolve) => { started = resolve; });
    remote.onGet = async () => { started(); await gate; };
    const read = device.engine.reconcileLinkedAccountColors([day]); await reached;
    if (revoke === 'import') device.accounts[0].consent.importCalendarEdits = false;
    else if (revoke === 'selection') await device.engine.setAccountPreferences('google:person', { selectedCalendarIds: [], writeCalendarId: 'personal' });
    else device.accounts.splice(0);
    release(); assert.deepEqual(plain(await read), []); remote.onGet = null;
    assert.deepEqual(plain(await device.db.getDayEntries(day)), before);
  }
});

test('a failing independent color read rejects without holding the core writer or poisoning later reads', async (t) => {
  const { device, remote, original } = await linkedColoredActivity(t); const get = remote.adapter.getEvent;
  let first = true, fail, started; const pending = new Promise((_, reject) => { fail = reject; }); const reached = new Promise((resolve) => { started = resolve; });
  remote.adapter.getEvent = async (...args) => { if (first) { first = false; started(); await pending; } return get(...args); };
  const read = device.engine.reconcileLinkedAccountColors([day]); const failed = assert.rejects(read, /Synthetic color read failed/); await reached;
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 1136, text: 'Core writer remains available', categoryId: 'study' });
  let timeout; try {
    await Promise.race([device.engine.synchronizeAccounts(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('The color failure held the core reconciliation queue')), 4000);
    })]);
    assert.match(remote.events.get(`personal:${original.id}`).description, /Core writer remains available/);
  } finally { clearTimeout(timeout); fail(new Error('Synthetic color read failed')); await failed; }
  assert.deepEqual(plain(await device.engine.reconcileLinkedAccountColors([day])), []);
});

test('pending and locally changed calendar projections run before unchanged synced projections with stable identity order', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  for (const start of [600, 700, 800]) await saveRange(device, start, 2, `Synthetic note ${start}`, 'study', `Activity ${start}`);
  await device.engine.linkActualsToAccounts([day]); await device.engine.synchronizeAccounts();
  const projections = (await device.engine.listProjections()).sort((left, right) => left.id.localeCompare(right.id));
  const changed = projections.at(-1), pending = projections[1];
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: changed.startMinute, text: 'Newest priority note', categoryId: 'study' });
  await device.db.putSyncDocument(`projection:${pending.id}`, { ...pending, state: 'pending' }); remote.calls.length = 0;
  await device.engine.synchronizeAccounts();
  const firstPass = remote.calls.filter((call) => call.type === 'get').slice(0, 3).map((call) => call.id);
  const expected = [changed, pending].sort((left, right) => left.id.localeCompare(right.id)).map((item) => item.eventId);
  assert.deepEqual(firstPass.slice(0, 2), expected); assert.equal(firstPass[2], projections[0].eventId);
  assert.equal(remote.events.size, 3); assert.match(remote.events.get(`personal:${changed.eventId}`).description, /Newest priority note/);
});

test('a chosen exact Google event palette color is written to the original event and acknowledged independently of minute notes', async (t) => {
  const { device, remote, original } = await linkedColoredActivity(t);
  await device.db.putSyncDocument('category:verified_event_color', { id: 'verified_event_color', name: 'Verified Google shade', color: '#2952A3',
    providerOriginalColor: '#2952A3', provider: 'google', accountId: 'google:person', providerColorId: '7', googleColorVerified: true });
  await device.categories.listCategories();
  const before = plain(await device.db.getDayEntries(day)); remote.calls.length = 0;
  await device.sheet.colorMinuteRange({ dateKey: day, startMinute: 1135, endMinute: 1137 }, 'google_palette_2952a3');
  const result = await device.engine.synchronizeAccounts(); assert.equal(result.outcome, 'success');
  const write = remote.calls.find((call) => call.type === 'update'); assert.equal(write.id, original.id); assert.equal(write.write.googleColorId, '7');
  assert.equal(remote.events.size, 1); assert.equal(remote.calls.filter((call) => call.type === 'create').length, 0);
  assert.deepEqual((await device.db.getDayEntries(day)).map((entry) => entry.text), before.map((entry) => entry.text));
  const acknowledged = (await device.engine.listProjections()).find((projection) => projection.eventId === original.id && projection.state !== 'deleted');
  assert.ok(acknowledged);
  assert.deepEqual(plain(acknowledged.baseColorSelection), { categoryId: 'google_palette_2952a3', color: '#2952A3' });
});

test('unsupported explicit color changes retain local fill and report a mapping error instead of pretending the source color changed', async (t) => {
  const { device, remote, original } = await linkedColoredActivity(t); remote.calls.length = 0;
  await device.sheet.colorMinuteRange({ dateKey: day, startMinute: 1135, endMinute: 1137 }, 'google_palette_0d7813');
  const changed = await device.engine.synchronizeAccounts(); assert.equal(changed.outcome, 'error'); assert.match(changed.message, /no verified Google event or label mapping/);
  assert.equal(remote.calls.filter((call) => ['update', 'create', 'delete'].includes(call.type)).length, 0);
  assert.equal((await device.db.getMinuteEntry(day, 1135)).categoryId, 'google_palette_0d7813');
  assert.equal(remote.events.get(`personal:${original.id}`).displayColor, '#112233');
  await device.sheet.colorMinuteRange({ dateKey: day, startMinute: 1135, endMinute: 1137 }, 'study');
  await device.categories.updateCategory('study', { color: '#0D7813' });
  const sameId = await device.engine.synchronizeAccounts(); assert.equal(sameId.outcome, 'error');
  assert.match(sameId.message, /no verified Google event or label mapping/);
  assert.equal(remote.calls.filter((call) => ['update', 'create', 'delete'].includes(call.type)).length, 0,
    'the acknowledgement compares hex as well as category ID');
});

test('a legitimate source recolor establishes a new color acknowledgement without being mistaken for an unsupported local choice', async (t) => {
  for (const retiredPosition of ['first', 'last']) {
    const { device, remote, original } = await linkedColoredActivity(t);
    const isOriginal = (projection) => projection.state !== 'deleted' && projection.eventId === original.id &&
      projection.sourceEventId === original.id && projection.calendarId === original.calendarId;
    const owners = (await device.engine.listProjections()).filter(isOriginal);
    assert.equal(owners.length, 1, 'the original event has exactly one active projection');
    const projection = owners[0];
    delete projection.baseColorSelection; await device.db.putSyncDocument(`projection:${projection.id}`, projection);
    // Explicit source adoption retains retired generated projections. Their key
    // order is unrelated to ownership; force both sides of the active source.
    const retiredId = (retiredPosition === 'first' ? '0' : 'f').repeat(40);
    await device.db.putSyncDocument(`projection:${retiredId}`, { ...projection, id: retiredId,
      blockId: `retired:${retiredId}`, state: 'deleted', eventId: null, sourceEventId: null,
      baseEvent: null, baseLocalHash: null });
    const before = await device.engine.listProjections();
    assert.equal((retiredPosition === 'first' ? before[0] : before.at(-1)).id, retiredId);
    remote.edit('personal', original.id, { displayColor: '#123456' }); remote.calls.length = 0;
    assert.deepEqual(plain(await device.engine.reconcileLinkedAccountColors([day])), [day]);
    const after = await device.engine.listProjections(); const imported = after.filter(isOriginal);
    assert.equal(imported.length, 1);
    assert.equal(imported[0].baseColorSelection.color, '#123456');
    assert.equal(imported[0].baseColorSelection.categoryId, (await device.db.getMinuteEntry(day, 1135)).categoryId);
    assert.equal(after.find((item) => item.id === retiredId).state, 'deleted');
    assert.equal(after.find((item) => item.id === retiredId).baseColorSelection, undefined);
    assert.equal((await device.engine.synchronizeAccounts()).outcome, 'success');
    assert.equal(remote.calls.filter((call) => ['update', 'create', 'delete'].includes(call.type)).length, 0);
  }
});

test('revoking calendar edit import during a gated palette lookup stops the later full source import', async (t) => {
  const { device, remote, original } = await linkedColoredActivity(t); const before = plain(await device.db.getDayEntries(day));
  remote.edit('personal', original.id, { displayColor: undefined, title: 'External changed title', start: iso(1160), end: iso(1163) });
  const list = remote.adapter.listCalendars; let release, started;
  const gate = new Promise((resolve) => { release = resolve; }); const reached = new Promise((resolve) => { started = resolve; });
  remote.adapter.listCalendars = async () => { started(); await gate; return list(); }; remote.calls.length = 0;
  const sync = device.engine.synchronizeAccounts(); await reached; device.accounts[0].consent.importCalendarEdits = false; release();
  const result = await sync; assert.equal(result.outcome, 'error'); assert.match(result.message, /Allow calendar edit import/);
  assert.deepEqual(plain(await device.db.getDayEntries(day)), before);
  assert.equal(remote.calls.filter((call) => ['update', 'create', 'delete'].includes(call.type)).length, 0);
});

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

test('clean account descriptions retain exact original prose and replace minute notes without duplicating visible bookkeeping', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const originalNotes = '  Unaccounted is a word in my own notes.\n9:00 Original timestamp prose\nContext block: literal original note\n';
  const original = { ...originalPrayer(), description: originalNotes };
  remote.seed(original); await saveRange(device, 1135, 2);
  await device.engine.linkActualsToAccounts([day], planned(original));
  await device.engine.synchronizeAccounts();
  let event = remote.events.get(`personal:${original.id}`);
  assert.ok(event.description.startsWith(originalNotes + '\n\n'));
  assert.equal(event.descriptionLog.version, 3);
  assert.equal(event.descriptionLog.offset, originalNotes.length + 2);
  assert.doesNotMatch(event.description, /--- Context minutes ---|--- End Context minutes ---|Context category:|Context projection:|Full minute record available in Context\./);
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 1135, text: 'Updated note\nContext projection: literal user continuation', categoryId: 'prayer' });
  await device.engine.synchronizeAccounts();
  event = remote.events.get(`personal:${original.id}`);
  assert.equal(event.description.split(originalNotes).length - 1, 1);
  assert.equal(event.description.split('Updated note').length - 1, 1);
  assert.match(event.description, /Context projection: literal user continuation/);
  const writes = remote.calls.filter((call) => call.type === 'update').length;
  await device.engine.synchronizeAccounts();
  assert.equal(remote.calls.filter((call) => call.type === 'update').length, writes);
});

test('a calendar edit to protected original notes becomes a review conflict without erasing either version', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  const current = remote.events.get(`personal:${original.id}`);
  const edited = current.description.replace('Original prayer notes', 'Changed original prayer notes');
  remote.edit('personal', original.id, { description: edited });
  await device.engine.synchronizeAccounts();
  assert.equal((await device.engine.listProjections())[0].state, 'conflict');
  assert.equal(remote.events.get(`personal:${original.id}`).description, edited);
  assert.equal((await device.db.getMinuteEntry(day, 1135)).text, 'Pray fardh');
});

test('a color-only minute stays private until bordered, then projects its title without inventing ledger text', async (t) => {
  const remote = cloud();
  const device = phone(t, remote);
  await prepare(device);
  await device.db.saveMinuteRange({ dateKey: day, startMinute: 600, durationMinutes: 1,
    text: '', categoryId: 'sleep', allowEmptyText: true });
  await device.engine.linkActualsToAccounts([day], null, { dateKey: day, minuteIndex: 600 });
  await device.engine.synchronizeAccounts();
  assert.equal(remote.events.size, 0);
  await borderRange(device, day, 600, 600, 'Sleep');
  await device.engine.linkActualsToAccounts([day], null, { dateKey: day, minuteIndex: 600 });
  await device.engine.synchronizeAccounts();
  const created = remote.calls.find((call) => call.type === 'create');
  assert.ok(created);
  assert.equal(created.write.title, 'Sleep');
  assert.equal(created.write.start, iso(600));
  assert.equal(created.write.end, iso(601));
  assert.equal(created.write.description, '');
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
    description: editFirstPrayerMinute(current.description, 'Begin fardh'),
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
    description: editFirstPrayerMinute(current.description, 'Calendar changed thought'),
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
    description: editFirstPrayerMinute(current.description, 'Remote correction'),
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
    description: editFirstPrayerMinute(current.description, 'Remote thought'),
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
    description: editFirstPrayerMinute(current.description, 'Edit after permission revoked'),
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
  const status = await device.engine.synchronizeAccounts();
  const projections = await device.engine.listProjections();
  // Projection documents are ordered by random IDs, not by their event identity.
  const movedPrayer = projections.find((projection) => projection.sourceEventId === original.id);
  assert.ok(movedPrayer);
  assert.equal(movedPrayer.state, 'conflict');
  assert.match(movedPrayer.conflict, /overlap|occupied|another/i);
  assert.equal(status.conflicts, 1);
  assert.ok(projections.some((projection) => projection.id !== movedPrayer.id && projection.state === 'synced'),
    'the separately recorded study activity can synchronize without moving or replacing the prayer');
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

test('an interrupted block projects every border and explicit regrouping retires the child events', async (t) => {
  const { device, remote, original } = await linkedPrayer(t);
  for (const id of ['prayer', 'family']) {
    const local = (await device.categories.listCategories()).find((category) => category.id === id);
    await device.db.putSyncDocument(`category:verified_${id}`, { id: `verified_${id}`, name: `Verified ${id}`, color: local.color,
      provider: 'google', accountId: 'google:person', calendarId: 'personal', providerLabelId: `label-${id}`,
      providerOriginalColor: local.color, googleColorVerified: true });
  }
  await device.categories.listCategories();
  const projectedEvent = plain(remote.events.get(`personal:${original.id}`));
  await saveRange(device, 1138, 2, 'Print for mum', 'family');
  await device.engine.linkActualsToAccounts([day], planned(projectedEvent),
    { dateKey: day, minuteIndex: 1138 });
  await device.engine.synchronizeAccounts();
  assert.notEqual(device.engine.getAccountSyncStatus().outcome, 'error', device.engine.getAccountSyncStatus().message);
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
  assert.equal(remote.events.size, 3, 'matching activity colors alone must not erase independently titled borders');

  await device.db.putSyncDocument('category:merge_color', { id: 'merge_color', name: 'Verified merge color', color: '#2952A3',
    provider: 'google', accountId: 'google:person', calendarId: 'personal', providerLabelId: 'merge-label',
    providerOriginalColor: '#2952A3', googleColorVerified: true });
  await device.categories.listCategories();
  await device.sheet.groupMinuteRange({ dateKey: day, startMinute: 1135, endMinute: 1144 },
    { title: original.title, categoryId: 'google_palette_2952a3' });
  await device.inline.flushInlineMinutes();
  await device.inline.retryInlineMinuteLinks({ synchronize: false });
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
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 510, text: 'Acknowledged current thought', categoryId: 'study' });
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

async function browserImport(remote, device, changes, id = 'browser_first_edit') {
  const stamp = new Date(Date.now() + 10_000).toISOString();
  const documents = changes.map((change, index) => ({ key: `minute:${change.day}:${change.minute}`,
    revision: `${String(Date.now() + 10_000).padStart(16, '0')}:${String(index).padStart(8, '0')}:browser_actor`,
    value: change.value === null ? null : { id: `browser_${index}`, dateKey: change.day, minuteIndex: change.minute,
      text: change.text, categoryId: 'study', blockId: `browser_${id}_${index}`, source: 'manual', createdAt: stamp, updatedAt: stamp,
      ...change.value } }));
  for (const [index, change] of changes.entries()) {
    if (change.value === null || change.bordered === false) continue;
    documents.push({ key: `category:minuteFormat:${change.day}:${change.minute}`,
      revision: `${String(Date.now() + 10_000).padStart(16, '0')}:${String(changes.length + index).padStart(8, '0')}:browser_actor`,
      value: { kind: 'minuteFormat', format: { calendarEvent: { id: documents[index].value.blockId, title: change.text } } } });
  }
  const batch = { version: 1, id, documents };
  remote.files.set(`context-${id}.json`, await device.codec.encryptBatch(batch, 'Context shared private ledger passphrase'));
  return documents;
}

test('a new browser day creates only an authorized account actual after encrypted import, without native outbox or source adoption', async (t) => {
  const remote = cloud(); const device = phone(t, remote, account({ ledgerStorage: true })); await prepare(device, true);
  const original = originalPrayer(); remote.seed(original);
  await browserImport(remote, device, [{ day: '2026-10-28', minute: 600, text: 'New browser minute' }]);
  await device.engine.synchronizeAccounts();
  assert.equal((await device.db.getMinuteEntry('2026-10-28', 600)).text, 'New browser minute');
  const projections = await device.engine.listProjections(); assert.equal(projections.length, 1);
  assert.equal(projections[0].sourceEventId, null); assert.equal(projections[0].calendarId, 'personal');
  assert.equal(projections[0].state, 'synced');
  assert.equal((await device.db.getPendingInlineMinuteLinks()).length, 0); assert.equal((await device.db.getPendingSyncDates()).length, 0);
  assert.equal(remote.events.get(`personal:${original.id}`).version, original.version);
  assert.equal(remote.calls.filter((call) => call.type === 'create').length, 1);
  await device.engine.synchronizeAccounts(); assert.equal(remote.calls.filter((call) => call.type === 'create').length, 1);
});

test('unbordered phone and browser notes remain private even with every calendar permission enabled', async (t) => {
  const remote = cloud(); const device = phone(t, remote, account({ ledgerStorage: true, editInvitations: true, editSeries: true, categoryRead: true }));
  await prepare(device, true);
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 611, text: 'Private front-desk thought', categoryId: 'study' });
  await device.engine.linkActualsToAccounts([day], null, { dateKey: day, minuteIndex: 611 });
  await browserImport(remote, device, [{ day: '2026-10-28', minute: 600, text: 'Private browser thought', bordered: false }]);
  await device.engine.synchronizeAccounts(); await device.inline.retryInlineMinuteLinks({ synchronize: false });
  assert.equal((await device.db.getMinuteEntry(day, 611)).text, 'Private front-desk thought');
  assert.equal((await device.db.getMinuteEntry('2026-10-28', 600)).text, 'Private browser thought');
  assert.equal((await device.engine.listProjections()).length, 0); assert.equal(remote.events.size, 0);
  assert.equal((await device.db.getPendingInlineMinuteLinks()).length, 0, 'private notes do not leave calendar-write tickets forever');
  assert.equal(remote.calls.filter((call) => ['create', 'update', 'delete', 'updateSeries'].includes(call.type)).length, 0);
});

test('a border arriving in a later encrypted batch exports a formerly private note exactly once', async (t) => {
  const remote = cloud(); const device = phone(t, remote, account({ ledgerStorage: true })); await prepare(device, true);
  await browserImport(remote, device, [{ day, minute: 612, text: 'Read a paper', bordered: false }]);
  await device.engine.synchronizeAccounts();
  assert.equal(remote.events.size, 0); assert.equal((await device.db.getPendingInlineMinuteLinks()).length, 0);
  const entry = await device.db.getMinuteEntry(day, 612);
  const document = { key: `category:minuteFormat:${day}:612`,
    revision: `${String(Date.now() + 20_000).padStart(16, '0')}:00000000:browser_actor`,
    value: { kind: 'minuteFormat', format: { calendarEvent: { id: entry.blockId, title: 'Study' } } } };
  remote.files.set('context-later-border.json', await device.codec.encryptBatch({ version: 1, id: 'later_border', documents: [document] },
    'Context shared private ledger passphrase'));
  await device.engine.synchronizeAccounts(); await device.engine.synchronizeAccounts();
  assert.equal(remote.events.size, 1); assert.equal([...remote.events.values()][0].title, 'Study');
  assert.match([...remote.events.values()][0].description, /10:12 AM  Read a paper/);
  assert.equal(remote.calls.filter((call) => call.type === 'create').length, 1);
  assert.equal((await device.db.getPendingInlineMinuteLinks()).length, 0);
});

test('an upload failure after browser merge leaves its durable link ticket for a later safe account pass', async (t) => {
  const remote = cloud(); const device = phone(t, remote, account({ ledgerStorage: true })); await prepare(device, true);
  await browserImport(remote, device, [{ day: day, minute: 601, text: 'Imported before failed upload' }]);
  remote.onWriteFile = async () => { throw Error('Upload temporarily unavailable'); };
  await device.engine.synchronizeAccounts();
  assert.equal((await device.db.getMinuteEntry(day, 601)).text, 'Imported before failed upload');
  assert.equal((await device.db.getPendingInlineMinuteLinks()).length, 1);
  assert.equal(remote.calls.filter((call) => call.type === 'create').length, 0);
  remote.onWriteFile = null; await device.engine.synchronizeAccounts();
  assert.equal((await device.db.getPendingInlineMinuteLinks()).length, 0);
  assert.equal(remote.calls.filter((call) => call.type === 'create').length, 1);
});

test('browser imports wait for account write permission and a destination rather than silently dropping their link intent', async (t) => {
  for (const reason of ['permission', 'destination']) {
    const remote = cloud(); const device = phone(t, remote, account({ ledgerStorage: true, calendarWrite: reason !== 'permission' }));
    await prepare(device, true);
    if (reason === 'destination') await device.engine.setAccountPreferences('google:person', { selectedCalendarIds: ['personal'], writeCalendarId: null });
    await browserImport(remote, device, [{ day, minute: 602, text: 'Wait for authorized actuals' }]);
    await device.engine.synchronizeAccounts();
    assert.equal((await device.db.getPendingInlineMinuteLinks()).length, 1);
    assert.equal(remote.calls.filter((call) => call.type === 'create').length, 0);
    await device.inline.retryInlineMinuteLinks({ synchronize: false });
    assert.equal((await device.db.getPendingInlineMinuteLinks()).length, 1,
      'the App/native preflight drain must not acknowledge an imported ticket before account routing is ready');
    device.accounts[0].consent.calendarWrite = true;
    await device.engine.setAccountPreferences('google:person', { selectedCalendarIds: ['personal'], writeCalendarId: 'personal' });
    await device.engine.synchronizeAccounts();
    assert.equal((await device.db.getPendingInlineMinuteLinks()).length, 0);
    assert.equal(remote.calls.filter((call) => call.type === 'create').length, 1);
  }
});

test('a winning browser tombstone reconciles its existing generated account event without inventing a new native write', async (t) => {
  const remote = cloud(); const device = phone(t, remote, account({ ledgerStorage: true })); await prepare(device, true);
  const imported = await browserImport(remote, device, [{ day, minute: 603, text: 'To remove from browser' }]);
  await device.engine.synchronizeAccounts(); assert.equal(remote.events.size, 1);
  const tombstone = { ...imported[0], revision: `${String(Date.now() + 20_000).padStart(16, '0')}:00000000:browser_actor`, value: null };
  remote.files.set('context-browser_delete.json', await device.codec.encryptBatch({ version: 1, id: 'browser_delete', documents: [tombstone] },
    'Context shared private ledger passphrase'));
  await device.engine.synchronizeAccounts();
  assert.equal(await device.db.getMinuteEntry(day, 603), null); assert.equal(remote.events.size, 0);
  assert.equal((await device.db.getPendingInlineMinuteLinks()).length, 0); assert.equal((await device.db.getPendingSyncDates()).length, 0);
});

test('one hundred deferred import tickets do not spin the inline drain or starve ordinary local-save tickets', async (t) => {
  const remote = cloud(); const device = phone(t, remote, account({ calendarWrite: false })); await prepare(device);
  const stamp = new Date().toISOString();
  await device.db.mergeSyncDocuments(Array.from({ length: 100 }, (_, index) => ({ key: `minute:${day}:${700 + index}`,
    revision: `${String(Date.now() + 1000).padStart(16, '0')}:${String(index).padStart(8, '0')}:browser_actor`,
    value: { id: `browser_${index}`, dateKey: day, minuteIndex: 700 + index, text: 'Waiting for account setup', categoryId: 'study',
      blockId: 'disconnected_browser_block', source: 'manual', createdAt: stamp, updatedAt: stamp } })));
  await device.db.putSyncDocument('projection:disconnected_owner', { id: 'disconnected_owner', accountId: 'removed-account',
    calendarId: 'removed-calendar', eventId: 'retained-event', sourceEventId: null, blockId: 'disconnected_browser_block',
    dateKey: day, startMinute: 700, endMinute: 799, baseEvent: null, baseLocalHash: null, state: 'pending' });
  await device.inline.retryInlineMinuteLinks({ synchronize: false });
  assert.equal((await device.db.getPendingInlineMinuteLinks()).length, 100);
  await device.db.saveMinuteRange({ dateKey: day, startMinute: 900, durationMinutes: 1,
    text: 'Ordinary local edit', categoryId: 'study', queueInlineLink: true });
  assert.equal((await device.db.getPendingInlineMinuteLinks())[0].minuteIndex, 900, 'ordinary local work is not hidden behind deferred imports');
  await device.inline.retryInlineMinuteLinks({ synchronize: false });
  assert.equal((await device.db.getPendingInlineMinuteLinks()).length, 100);
  assert.equal((await device.db.getPendingInlineMinuteLinks()).some((ticket) => ticket.minuteIndex === 900), false);
});

test('a bounded account drain rotates one hundred unrouteable imports so a newer eligible day reaches its calendar', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const stamp = new Date().toISOString(); const laterDay = '2026-10-26';
  const docs = Array.from({ length: 100 }, (_, index) => ({ key: `minute:${day}:${700 + index}`,
    revision: `${String(Date.now() + 1000).padStart(16, '0')}:${String(index).padStart(8, '0')}:browser_actor`,
    value: { id: `browser_${index}`, dateKey: day, minuteIndex: 700 + index, text: 'Retained disconnected owner', categoryId: 'study',
      blockId: 'disconnected_browser_block', source: 'manual', createdAt: stamp, updatedAt: stamp } }));
  await device.db.mergeSyncDocuments(docs);
  await device.db.putSyncDocument('projection:disconnected_owner', { id: 'disconnected_owner', accountId: 'removed-account',
    calendarId: 'removed-calendar', eventId: 'retained-event', sourceEventId: null, blockId: 'disconnected_browser_block',
    dateKey: day, startMinute: 700, endMinute: 799, baseEvent: null, baseLocalHash: null, state: 'pending' });
  await device.db.mergeSyncDocuments([{ key: `minute:${laterDay}:600`, revision: `${String(Date.now() + 2000).padStart(16, '0')}:00000000:browser_actor`,
    value: { ...docs[0].value, id: 'new-routeable', dateKey: laterDay, minuteIndex: 600, text: 'New eligible browser day', blockId: 'new_browser_block' } }]);
  await borderRange(device, laterDay, 600, 600, 'New eligible browser day');
  const beforeTokens = new Map((await device.db.getPendingInlineMinuteLinks(500)).map((ticket) => [`${ticket.dateKey}:${ticket.minuteIndex}`, ticket.token]));
  await device.engine.synchronizeAccounts();
  assert.equal(remote.calls.filter((call) => call.type === 'create').length, 0, 'one pass remains bounded to its first hundred tickets');
  assert.equal((await device.db.getPendingInlineMinuteLinks())[0].dateKey, laterDay);
  await device.engine.synchronizeAccounts();
  assert.equal(remote.calls.filter((call) => call.type === 'create').length, 1);
  assert.ok([...remote.events.values()].some((event) => event.description.includes('New eligible browser day')));
  const remaining = await device.db.getPendingInlineMinuteLinks(500); assert.equal(remaining.length, 100);
  assert.ok(remaining.every((ticket) => ticket.token === beforeTokens.get(`${ticket.dateKey}:${ticket.minuteIndex}`)),
    'rotation preserves every deferred token and never acknowledges a disconnected owner');
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
  assert.equal(oldStyle.value, null, 'vacated projection-owned formatting is removed with its old source rows');
  const newLabel = (await device.db.getSyncDocuments(`category:minuteFormat:${day}:${movedStart}`))[0];
  assert.equal(newLabel.value.format.activityGroup.title, 'Review revised paper');
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: movedStart + 2, text: 'A further thought', categoryId: moved[2].categoryId });
  await device.engine.linkActualsToAccounts([day], null, { dateKey: day, minuteIndex: movedStart + 2 });
  await device.engine.synchronizeAccounts();
  assert.equal(remote.events.size, 1);
  assert.equal([...remote.events.values()][0].title, 'Review revised paper');
  assert.match([...remote.events.values()][0].description, /4:42 PM  A further thought/);
});

test('held Group and partial Ungroup use the real spreadsheet-to-account pipeline without losing the event title, notes or fill', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const start = 600;
  for (const [offset, text] of ['Boil water', '', 'Talk to Mum', '', 'Pour coffee'].entries()) {
    if (text) await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: start + offset, text, categoryId: 'family' });
  }
  await device.sheet.groupMinuteRange({ dateKey: day, startMinute: start, endMinute: start + 4 },
    { title: 'Make coffee', categoryId: 'family' });
  await device.inline.retryInlineMinuteLinks({ synchronize: false }); await device.engine.synchronizeAccounts();
  const grouped = [...remote.events.values()]; assert.equal(grouped.length, 1);
  const originalId = grouped[0].id;
  assert.equal(grouped[0].title, 'Make coffee'); assert.equal(grouped[0].start, iso(start)); assert.equal(grouped[0].end, iso(start + 5));
  assert.equal(grouped[0].categoryId, 'family'); assert.match(grouped[0].description, /Boil water/);
  assert.match(grouped[0].description, /Talk to Mum/); assert.match(grouped[0].description, /Pour coffee/);
  await device.sheet.ungroupMinuteRange({ dateKey: day, startMinute: start + 2, endMinute: start + 2 });
  await device.inline.retryInlineMinuteLinks({ synchronize: false }); await device.engine.synchronizeAccounts();
  const split = [...remote.events.values()].sort((a, b) => a.start.localeCompare(b.start));
  assert.deepEqual(split.map((event) => [event.title, event.start, event.end, event.categoryId]), [
    ['Make coffee', iso(start), iso(start + 2), 'family'],
    ['Make coffee', iso(start + 3), iso(start + 5), 'family'],
  ]);
  assert.equal((await device.db.getMinuteEntry(day, start + 2)).text, 'Talk to Mum',
    'Ungroup keeps the middle minute private instead of exporting it as an event');
  assert.equal(remote.events.has(`personal:${originalId}`), true, 'the first surviving bordered range retains its original event identity');
  assert.equal(remote.events.get(`personal:${originalId}`).end, iso(start + 2));
  assert.ok((await device.db.getDayEntries(day)).every((entry) => entry.categoryId === 'family'));
  assert.deepEqual((await device.db.getDayEntries(day)).map((entry) => entry.text), ['Boil water', '', 'Talk to Mum', '', 'Pour coffee']);
  assert.ok(split.every((event) => event.title !== 'Unaccounted'));
  await device.sheet.undoSpreadsheetEdit(); await device.inline.retryInlineMinuteLinks({ synchronize: false });
  await device.engine.synchronizeAccounts();
  const restored = [...remote.events.values()]; assert.equal(restored.length, 1); assert.equal(restored[0].title, 'Make coffee');
  assert.equal(restored[0].start, iso(start)); assert.equal(restored[0].end, iso(start + 5));
  assert.equal(remote.calls.filter((call) => call.type === 'updateSeries').length, 0, 'grouping does not request unrelated series writes');
});

test('Ungrouping inside an adopted source keeps that occurrence on its first remainder and leaves detached notes private', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const original = { ...originalPrayer(), location: 'Clinic' }; remote.seed(original);
  await saveRange(device, 1135, 10, 'Pray fardh', 'prayer', original.title);
  await device.engine.linkActualsToAccounts([day], planned(original)); await device.engine.synchronizeAccounts();
  await device.sheet.ungroupMinuteRange({ dateKey: day, startMinute: 1138, endMinute: 1140 });
  await device.inline.retryInlineMinuteLinks({ synchronize: false }); await device.engine.synchronizeAccounts();
  const source = remote.events.get(`personal:${original.id}`);
  assert.ok(source); assert.equal(source.title, original.title); assert.equal(source.location, 'Clinic');
  assert.equal(source.start, iso(1135)); assert.equal(source.end, iso(1138));
  const events = [...remote.events.values()].sort((left, right) => left.start.localeCompare(right.start));
  assert.equal(events.length, 2); assert.equal(events[1].title, original.title);
  assert.equal(events[1].start, iso(1141)); assert.equal(events[1].end, iso(1145));
  assert.equal((await device.db.getMinuteEntry(day, 1139)).text, 'Pray fardh');
  assert.equal(remote.calls.filter((call) => call.type === 'delete' && call.id === original.id).length, 0);
  assert.equal(remote.calls.filter((call) => call.type === 'updateSeries').length, 0);
});

test('different minute fills inside one border retain one calendar event and independent minute notes', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const start = 900;
  const blockId = await explicitGroup(device, start, ['', '', '', '', ''], 'Sleep', 'sleep', 'activity_color_split');
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: start + 2, text: 'Bathroom break', categoryId: 'physiological' });
  assert.equal((await device.db.getMinuteEntry(day, start + 2)).blockId, blockId);
  await device.engine.linkActualsToAccounts([day], null, { dateKey: day, minuteIndex: start + 2 });
  await device.engine.synchronizeAccounts();
  const events = [...remote.events.values()].sort((a, b) => a.start.localeCompare(b.start));
  assert.equal(events.length, 1);
  assert.deepEqual(events.map((event) => [event.start, event.end, event.categoryId]), [
    [iso(start), iso(start + 5), 'sleep'],
  ]);
  assert.equal((await device.db.getMinuteEntry(day, start + 2)).categoryId, 'physiological');
  assert.equal((await device.db.getMinuteEntry(day, start + 2)).text, 'Bathroom break');
  assert.match(events[0].description, /Bathroom break/);
  remote.edit('personal', events[0].id, { title: 'Rest' });
  await device.engine.synchronizeAccounts();
  const segments = await device.db.getDaySegments(day);
  assert.deepEqual(plain(segments.map((segment) => segment.activityTitle)), ['Rest']);
  assert.equal([...remote.events.values()][0].id, events[0].id);
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
    await device.sheet.moveActivityGroup(group, destination); await device.inline.flushInlineMinutes(); await device.inline.retryInlineMinuteLinks(); await device.engine.synchronizeAccounts();
    assert.deepEqual(ids(), [original.id]);
    const saved = [...remote.events.values()][0];
    const start = new Date(`${destination.dateKey}T12:00:00`); start.setHours(Math.floor(destination.startMinute / 60), destination.startMinute % 60, 0, 0);
    assert.equal(saved.start, start.toISOString());
    assert.match(saved.description, /Kettle/); assert.match(saved.description, /Talk to Mum/); assert.match(saved.description, /Pour/); assert.match(saved.description, /Drink/);
    assert.equal(remote.calls.slice(beforeCalls).filter((call) => ['delete', 'create', 'updateSeries'].includes(call.type)).length, 0);
    await device.sheet.undoSpreadsheetEdit(); await device.inline.flushInlineMinutes(); await device.inline.retryInlineMinuteLinks(); await device.engine.synchronizeAccounts();
    assert.deepEqual(ids(), [original.id]); assert.equal([...remote.events.values()][0].start, iso(1135));
  }
});

test('multicolor overlapping and cross-day activity moves keep one original calendar event and every minute description through Undo', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  const original = originalPrayer(); remote.seed(original);
  await explicitGroup(device, 1135, ['A1', 'A2', 'B1', 'B2'], 'Coffee');
  await device.sheet.colorMinuteRange({ dateKey: day, startMinute: 1137, endMinute: 1138 }, 'work');
  await device.inline.flushInlineMinutes(); await device.inline.retryInlineMinuteLinks();
  await device.engine.linkActualsToAccounts([day], planned(original), { dateKey: day, minuteIndex: 1135 });
  await device.engine.synchronizeAccounts();
  const initial = [...remote.events.values()].sort((a, b) => a.start.localeCompare(b.start));
  assert.equal(initial.length, 1); assert.equal(initial[0].id, original.id);
  const originalIds = initial.map((event) => event.id);
  for (const destination of [{ dateKey: day, startMinute: 1137 }, { dateKey: '2026-11-06', startMinute: 500 }]) {
    const group = await device.sheet.getMovableActivityGroup(day, 1135);
    const preview = await device.sheet.prepareActivityGroupMove(group, destination);
    await device.sheet.moveActivityGroup(group, destination, { previewToken: preview.token });
    await device.inline.flushInlineMinutes(); await device.inline.retryInlineMinuteLinks(); const result = await device.engine.synchronizeAccounts();
    assert.equal(result.message, 'Accounts synchronized');
    const current = [...remote.events.values()].sort((a, b) => a.start.localeCompare(b.start));
    assert.deepEqual(current.map((event) => event.id), originalIds);
    assert.match(current[0].description, /A1[\s\S]*A2[\s\S]*B1[\s\S]*B2/);
    await device.sheet.undoSpreadsheetEdit(); await device.inline.flushInlineMinutes(); await device.inline.retryInlineMinuteLinks(); await device.engine.synchronizeAccounts();
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
  await device.inline.flushInlineMinutes(); await device.inline.retryInlineMinuteLinks(); await device.engine.synchronizeAccounts();
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
  await device.inline.flushInlineMinutes(); await device.inline.retryInlineMinuteLinks(); await device.engine.synchronizeAccounts();
  const initial = [...remote.events.values()].sort((a, b) => a.start.localeCompare(b.start));
  assert.equal(initial.length, 1);
  remote.onGet = () => { if (remote.calls.at(-1).id === initial[0].id) throw new Error('Temporary provider failure'); };
  const startCalls = remote.calls.length;
  const group = await device.sheet.getMovableActivityGroup(day, 1000);
  await device.sheet.moveActivityGroup(group, { dateKey: '2026-11-05', startMinute: 700 });
  await device.inline.flushInlineMinutes(); await device.inline.retryInlineMinuteLinks();
  const failed = await device.engine.synchronizeAccounts();
  assert.match(failed.message, /Temporary provider failure/);
  assert.deepEqual([...remote.events.values()].map((event) => event.id).sort(), initial.map((event) => event.id).sort());
  remote.onGet = null;
  const retried = await device.engine.synchronizeAccounts(); assert.equal(retried.message, 'Accounts synchronized');
  const moved = [...remote.events.values()].sort((a, b) => a.start.localeCompare(b.start));
  assert.deepEqual(moved.map((event) => event.id), initial.map((event) => event.id));
  assert.match(moved[0].description, /A1[\s\S]*A2[\s\S]*B1[\s\S]*B2/);
  await device.sheet.undoSpreadsheetEdit(); await device.inline.flushInlineMinutes(); await device.inline.retryInlineMinuteLinks(); await device.engine.synchronizeAccounts();
  assert.deepEqual([...remote.events.values()].sort((a, b) => a.start.localeCompare(b.start)).map((event) => [event.id, event.start]),
    initial.map((event) => [event.id, event.start]));
  assert.equal(remote.calls.slice(startCalls).filter((call) => ['create', 'delete', 'updateSeries'].includes(call.type)).length, 0);
});

test('ambiguous moved named-group geometry preserves existing calendar events for review instead of deleting them', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  await explicitGroup(device, 1000, ['A1', 'A2', 'B1', 'B2'], 'Coffee');
  await device.sheet.colorMinuteRange({ dateKey: day, startMinute: 1002, endMinute: 1003 }, 'work');
  await device.inline.flushInlineMinutes(); await device.inline.retryInlineMinuteLinks(); await device.engine.synchronizeAccounts();
  const initial = plain([...remote.events.values()]);
  const group = await device.sheet.getMovableActivityGroup(day, 1000);
  const sourceCells = await device.db.getSpreadsheetCells({ dateKey: day, startMinute: 1000, endMinute: 1003 });
  const targetCells = await device.db.getSpreadsheetCells({ dateKey: '2026-11-06', startMinute: 500, endMinute: 504 });
  // A merged ledger may split one border into two disjoint runs while moving.
  // That is not a provable translation of the existing source event.
  await device.db.applySpreadsheetTransaction([
    { day, expected: sourceCells, target: sourceCells.map((cell) => ({ minuteIndex: cell.minuteIndex, entry: null, format: {} })) },
    { day: '2026-11-06', expected: targetCells, target: targetCells.map((_target, index) => {
      if (index === 2) return { minuteIndex: 502, entry: null, format: {} };
      const cell = sourceCells[index < 2 ? index : index - 1];
      return { minuteIndex: 500 + index, entry: { text: cell.entry.text, categoryId: cell.entry.categoryId,
        blockId: group.blockId }, format: cell.format };
    }) },
  ], { textChanged: true, formatChanged: true });
  const beforeCalls = remote.calls.length;
  const result = await device.engine.synchronizeAccounts();
  assert.match(result.message, /ambiguous calendar shape/);
  assert.deepEqual(plain([...remote.events.values()]), initial);
  assert.equal(remote.calls.slice(beforeCalls).filter((call) => ['create', 'update', 'delete', 'updateSeries'].includes(call.type)).length, 0);
  assert.equal((await device.db.getDayEntries('2026-11-06')).length, 4);
});


test('an unmapped new explicit Google palette border remains queued instead of acknowledging a default-colored create', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  await device.sheet.groupMinuteRange({ dateKey: day, startMinute: 600, endMinute: 601 },
    { title: 'Read', categoryId: 'google_palette_2952a3' });
  await device.inline.retryInlineMinuteLinks({ synchronize: false });
  const result = await device.engine.synchronizeAccounts();
  assert.equal(result.outcome, 'error'); assert.match(result.message, /no verified Google event or label mapping/);
  assert.equal(remote.events.size, 0); assert.equal(remote.calls.some((call) => call.type === 'create'), false);
  assert.equal((await device.db.getMinuteEntry(day, 600)).categoryId, 'google_palette_2952a3');
  assert.ok((await device.engine.listProjections()).every((projection) => !projection.baseColorSelection && projection.state === 'pending'));
});
