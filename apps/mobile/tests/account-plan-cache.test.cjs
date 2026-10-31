const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

const day = '2026-10-25';
const plain = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject }; };
const turn = () => new Promise((resolve) => setImmediate(resolve));

function harness(existingSettings) {
  const account = { id: 'google:person', provider: 'google', subject: 'person', label: 'Personal',
    consent: { calendarRead: true, calendarWrite: false, ledgerStorage: false, importCalendarEdits: false } };
  const accounts = [account]; const settings = existingSettings ?? new Map(); const documents = new Map();
  if (!settings.has('account.calendars.google:person')) settings.set('account.calendars.google:person',
    { selectedCalendarIds: ['personal'], writeCalendarId: null });
  const event = { id: 'coffee', calendarId: 'personal', title: 'Make coffee', description: '12:39 Make coffee\n12:40 Talk to Mum',
    start: new Date(2026, 9, 25, 12, 39).toISOString(), end: new Date(2026, 9, 25, 12, 47).toISOString(),
    timeZone: 'America/New_York', version: 'etag-1', allDay: false, isSeriesMaster: false, deleted: false,
    displayColor: '#aBcDeF', googleColorId: '3', opaqueFutureProperty: { preserved: true } };
  const calls = []; const writes = []; const timers = new Map(); let timerId = 0;
  let clockNow = Date.now();
  class ClockDate extends Date { static now() { return clockNow; } }
  const network = { beforeCalendars: null, beforeEvents: null, fail: false };
  const adapter = {
    async listCalendars() { calls.push('listCalendars'); if (network.beforeCalendars) await network.beforeCalendars();
      if (network.fail) throw Error('Offline');
      return ['personal', 'work'].map((id) => ({ id, title: id, color: '#123456', writable: true })); },
    async listEvents(calendarId) { calls.push(`listEvents:${calendarId}`);
      const response = calendarId === event.calendarId ? [plain(event)] : [];
      if (network.beforeEvents) await network.beforeEvents(calendarId);
      if (network.fail) throw Error('Offline'); return response; },
  };
  const root = path.join(__dirname, '../src'); const loaded = new Map();
  function load(file) {
    if (loaded.has(file)) return loaded.get(file);
    const module = { exports: {} }; loaded.set(file, module.exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, console, Date: ClockDate, Error, Map, Set, Promise,
      TextEncoder, TextDecoder, Uint8Array, Intl,
      setTimeout(callback, delay) { assert.equal(delay, 10_000); const id = ++timerId; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); },
      require(name) {
        if (name === 'expo-crypto') return {};
        if (name === 'expo-secure-store') return {};
        if (name.startsWith('@noble/hashes/')) return require(name);
        const resolved = path.resolve(path.dirname(file), `${name}.ts`);
        if (resolved === path.join(root, 'data/database.ts')) return {
          getSetting: async (key, fallback) => settings.has(key) ? plain(settings.get(key)) : fallback,
          setSetting: async (key, value) => { writes.push(key); settings.set(key, plain(value)); },
          getSyncDocuments: async (prefix) => [...documents.values()].filter((document) => document.key.startsWith(prefix)).map(plain),
          putSyncDocument: () => { throw Error('Display cache must not write private-ledger documents.'); },
        };
        if (resolved === path.join(root, 'sync/accounts.ts')) return { getAccounts: async () => plain(accounts) };
        if (resolved === path.join(root, 'sync/providers.ts')) return { createCalendarAdapter: () => {
          calls.push('createAdapter'); return adapter; } };
        if (resolved === path.join(root, 'sync/codec.ts')) return { hashValue: (value) =>
          crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') };
        if (resolved === path.join(root, 'sync/storage.ts')) return {};
        if (resolved === path.join(root, 'services/categories.ts')) return {};
        if (resolved === path.join(root, 'theme.ts')) return { CATEGORIES: [], categoryById: () => ({ color: '#000000' }) };
        if (name.startsWith('.')) return load(resolved);
        throw Error(`Unexpected import ${name}`);
      },
    }, { filename: file });
    return module.exports;
  }
  const engine = load(path.join(root, 'sync/engine.ts'));
  return { engine, settings, account, accounts, event, calls, writes, network, timers, documents,
    advance: (milliseconds) => { clockNow += milliseconds; },
    preferences: (ids) => settings.set('account.calendars.google:person', { selectedCalendarIds: ids, writeCalendarId: null }),
    expire: () => { const current = [...timers.values()]; timers.clear(); current.forEach((callback) => callback()); } };
}

test('a retired exact event is hidden from cached plans until Google reports a genuinely newer restoration', async () => {
  const h = harness(); h.event.updatedAt = '2026-10-30T10:00:00.000Z';
  await h.engine.loadAccountPlansResult(day);
  h.documents.set('projection:retired', { key: 'projection:retired', revision: '0000000000000001:00000000:fixture000', value: {
    id: 'retired', accountId: h.account.id, calendarId: h.event.calendarId, eventId: h.event.id, blockId: 'activity_old',
    dateKey: day, startMinute: 759, endMinute: 766, state: 'deleted', retiredAt: '2026-10-30T11:00:00.000Z', baseEvent: h.event,
  } });
  assert.equal((await h.engine.loadCachedAccountPlans(day)).length, 0);
  assert.equal((await h.engine.loadAccountPlansResult(day)).plans.length, 0);
  h.event.updatedAt = '2026-10-30T12:00:00.000Z';
  assert.equal((await h.engine.loadAccountPlansResult(day)).plans.length, 1);
});

test('successful reads persist a local Date-hydrated cache with full notes/colors and opaque provider fields', async () => {
  const h = harness(); const result = await h.engine.loadAccountPlansResult(day);
  assert.equal(result.plans.length, 1); assert.equal(result.fromCache, false); assert.deepEqual(plain(result.failures), []);
  assert.equal(result.plans[0].color, '#aBcDeF');
  assert.ok(h.writes.every((key) => key.startsWith('calendar.plan-cache.v1.')));
  assert.equal(h.writes.length, 1);
  h.calls.length = 0;
  const offline = await h.engine.loadCachedAccountPlans(day);
  assert.deepEqual(h.calls, [], 'a local cache read must not create an adapter, get a token, or read a provider');
  assert.ok(offline[0].startDate instanceof Date); assert.ok(offline[0].endDate instanceof Date);
  assert.equal(offline[0].startDate.getTime(), Date.parse(h.event.start));
  assert.equal(offline[0].notes, h.event.description);
  assert.deepEqual(plain(offline[0].accountEvent.event.opaqueFutureProperty), { preserved: true });
  const restarted = harness(h.settings); assert.equal((await restarted.engine.loadCachedAccountPlans(day)).length, 1);
  assert.deepEqual(restarted.calls, [], 'cache persists across engine restarts without network');
});

test('offline refresh returns its last successful cache and does not erase or rewrite it', async () => {
  const h = harness(); await h.engine.loadAccountPlans(day); const before = plain([...h.settings]); h.writes.length = 0;
  h.network.fail = true;
  const result = await h.engine.loadAccountPlansResult(day);
  assert.equal(result.plans[0].title, 'Make coffee'); assert.equal(result.fromCache, true);
  assert.deepEqual(plain(result.failures), [{ accountId: h.account.id, code: 'unavailable' }]);
  assert.deepEqual(plain([...h.settings]), before); assert.deepEqual(h.writes, []);
});

test('the strict legacy loader rejects offline source reads while screen results retain cached plans', async () => {
  const h = harness(); await h.engine.loadAccountPlans(day); h.network.fail = true;
  await assert.rejects(h.engine.loadAccountPlans(day), /account calendar plans could not load/);
  const screen = await h.engine.loadAccountPlansResult(day);
  assert.equal(screen.plans[0].title, 'Make coffee'); assert.equal(screen.fromCache, true);
  assert.equal(screen.failures[0].code, 'unavailable');
});

test('empty selections and read-revoked or disconnected accounts never start provider work or expose cached plans', async () => {
  const h = harness(); await h.engine.loadAccountPlans(day); h.calls.length = 0;
  h.preferences([]); assert.deepEqual(plain(await h.engine.loadCachedAccountPlans(day)), []);
  assert.deepEqual(plain(await h.engine.loadAccountPlansResult(day)), { plans: [], failures: [], fromCache: false });
  h.preferences(['personal']); h.account.consent.calendarRead = false;
  assert.deepEqual(plain(await h.engine.loadCachedAccountPlans(day)), []);
  assert.deepEqual(plain(await h.engine.loadAccountPlans(day)), []);
  h.account.consent.calendarRead = true; h.accounts.length = 0;
  assert.deepEqual(plain(await h.engine.loadCachedAccountPlans(day)), []);
  assert.deepEqual(plain(await h.engine.loadAccountPlans(day)), []); assert.deepEqual(h.calls, []);
});

test('cache identity includes exact calendar selection and account subject, while selection ordering is normalized', async () => {
  const h = harness(); await h.engine.loadAccountPlans(day);
  h.preferences(['personal', 'work']); assert.deepEqual(plain(await h.engine.loadCachedAccountPlans(day)), []);
  await h.engine.loadAccountPlans(day); h.preferences(['work', 'personal', 'work']);
  assert.equal((await h.engine.loadCachedAccountPlans(day)).length, 1);
  h.account.subject = 'another-user'; assert.deepEqual(plain(await h.engine.loadCachedAccountPlans(day)), []);
});

test('a late response cannot publish or cache plans after account removal, read revocation, or selection change', async () => {
  for (const revoke of [(h) => h.accounts.splice(0), (h) => { h.account.consent.calendarRead = false; },
    (h) => h.preferences(['work'])]) {
    const h = harness(); const gate = deferred(); h.network.beforeEvents = () => gate.promise;
    const job = h.engine.loadAccountPlansResult(day); await turn(); revoke(h); gate.resolve();
    const result = await job; assert.deepEqual(plain(result), { plans: [], failures: [], fromCache: false });
    assert.deepEqual(h.writes, []);
  }
});

test('identical in-flight refreshes are coalesced while local cache reads remain immediately available', async () => {
  const h = harness(); await h.engine.loadAccountPlans(day); h.calls.length = 0;
  const gate = deferred(); h.network.beforeCalendars = () => gate.promise;
  const first = h.engine.loadAccountPlansResult(day); const second = h.engine.loadAccountPlansResult(day); await turn();
  assert.deepEqual(h.calls, ['createAdapter', 'listCalendars']);
  assert.equal((await h.engine.loadCachedAccountPlans(day)).length, 1);
  gate.resolve(); const results = await Promise.all([first, second]);
  assert.equal(results[0].plans.length, 1); assert.equal(results[1].plans.length, 1);
  assert.deepEqual(h.calls, ['createAdapter', 'listCalendars', 'listEvents:personal']);
});

test('timeout returns cached fallback, keeps the hung provider request coalesced, and permits a later refresh after settlement', async () => {
  const h = harness(); await h.engine.loadAccountPlans(day); h.calls.length = 0;
  const gate = deferred(); h.network.beforeCalendars = () => gate.promise;
  const first = h.engine.loadAccountPlansResult(day); await turn(); h.expire();
  const expired = await first; assert.equal(expired.fromCache, true); assert.equal(expired.plans.length, 1);
  assert.deepEqual(plain(expired.failures), [{ accountId: h.account.id, code: 'timeout' }]);
  const next = h.engine.loadAccountPlansResult(day); await turn();
  assert.deepEqual(h.calls, ['createAdapter', 'listCalendars'], 'a timed-out caller must not release the underlying coalescing slot');
  gate.resolve(); assert.equal((await next).fromCache, false);
  h.network.beforeCalendars = null; await h.engine.loadAccountPlans(day);
  assert.equal(h.calls.filter((call) => call === 'listCalendars').length, 2);
});

test('an expired in-flight lease permits one new refresh even when the old provider never settles', async () => {
  const h = harness(); await h.engine.loadAccountPlans(day); h.calls.length = 0;
  const never = deferred(); let reads = 0;
  h.network.beforeCalendars = () => ++reads === 1 ? never.promise : undefined;
  const first = h.engine.loadAccountPlansResult(day); await turn(); h.expire(); await first;
  h.advance(59_999);
  const shared = h.engine.loadAccountPlansResult(day); await turn(); h.expire(); await shared;
  assert.equal(reads, 1, 'all callers within the lease share the original hung request');
  h.advance(1); h.event.title = 'Reconnected activity';
  const recovered = await h.engine.loadAccountPlansResult(day);
  assert.equal(reads, 2); assert.equal(recovered.plans[0].title, 'Reconnected activity');
  assert.equal(recovered.fromCache, false); assert.deepEqual(plain(recovered.failures), []);
});

test('a superseded late provider response cannot overwrite fresh cache or remove the current in-flight slot', async () => {
  const h = harness(); await h.engine.loadAccountPlans(day); h.calls.length = 0;
  const old = deferred(); const fresh = deferred(); let reads = 0;
  h.event.title = 'Stale provider snapshot';
  h.network.beforeEvents = () => ++reads === 1 ? old.promise : fresh.promise;
  const oldCaller = h.engine.loadAccountPlansResult(day); await turn();
  h.advance(60_000); h.event.title = 'Fresh provider snapshot';
  const currentCaller = h.engine.loadAccountPlansResult(day); await turn();
  old.resolve(); const obsolete = await oldCaller;
  assert.equal(obsolete.fromCache, true); assert.equal(obsolete.failures[0].code, 'unavailable');
  assert.equal(obsolete.plans[0].title, 'Make coffee', 'a superseded response is a failure, not successful empty/stale data');
  const joined = h.engine.loadAccountPlansResult(day); await turn();
  assert.equal(reads, 2, 'old completion must not delete the newer coalescing slot');
  fresh.resolve(); assert.equal((await currentCaller).plans[0].title, 'Fresh provider snapshot');
  assert.equal((await joined).plans[0].title, 'Fresh provider snapshot');
  assert.equal((await h.engine.loadCachedAccountPlans(day))[0].title, 'Fresh provider snapshot');
});

test('a late superseded caller falls back to the newer completed cache rather than returning its old source snapshot', async () => {
  const h = harness(); await h.engine.loadAccountPlans(day);
  const old = deferred(); let reads = 0; h.event.title = 'Old snapshot';
  h.network.beforeEvents = () => ++reads === 1 ? old.promise : undefined;
  const oldCaller = h.engine.loadAccountPlansResult(day); await turn();
  h.advance(60_000); h.event.title = 'Newest snapshot';
  assert.equal((await h.engine.loadAccountPlansResult(day)).plans[0].title, 'Newest snapshot');
  const before = h.writes.length; old.resolve(); const result = await oldCaller;
  assert.equal(result.plans[0].title, 'Newest snapshot'); assert.equal(result.fromCache, true);
  assert.equal(result.failures[0].code, 'unavailable'); assert.equal(h.writes.length, before);
  assert.equal((await h.engine.loadCachedAccountPlans(day))[0].title, 'Newest snapshot');
});

test('a partial selected-calendar failure never replaces a complete successful scope cache', async () => {
  const h = harness(); h.preferences(['personal', 'work']); await h.engine.loadAccountPlans(day);
  const before = plain([...h.settings]); h.writes.length = 0;
  h.event.title = 'Changed but incomplete'; h.network.beforeEvents = (id) => { if (id === 'work') throw Error('Work offline'); };
  const result = await h.engine.loadAccountPlansResult(day);
  assert.equal(result.plans[0].title, 'Make coffee'); assert.equal(result.fromCache, true);
  assert.deepEqual(plain([...h.settings]), before); assert.deepEqual(h.writes, []);
});

test('corrupted cache dates, scopes, provider identities and payloads fail closed without a network read', async () => {
  const h = harness(); await h.engine.loadAccountPlans(day);
  const key = h.writes[0]; const original = plain(h.settings.get(key)); h.calls.length = 0;
  for (const change of [(value) => { value.plans[0].startDate = 'broken'; },
    (value) => { value.scope.calendarIds = ['work']; }, (value) => { value.plans[0].accountEvent.accountId = 'other'; },
    (value) => { value.plans[0].accountEvent.event.end = value.plans[0].accountEvent.event.start; },
    (value) => { value.plans[0].allDay = true; },
    (value) => { value.plans[0].startDate = value.plans[0].accountEvent.event.start = new Date(2026, 9, 26, 0).toISOString();
      value.plans[0].endDate = value.plans[0].accountEvent.event.end = new Date(2026, 9, 26, 1).toISOString(); }]) {
    const value = plain(original); change(value); h.settings.set(key, value);
    assert.deepEqual(plain(await h.engine.loadCachedAccountPlans(day)), []);
  }
  assert.deepEqual(h.calls, []);
});
