const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const GOOGLE = 'https://www.googleapis.com/calendar/v3';
const account = (changes = {}) => ({ id: 'google:person', provider: 'google', subject: 'person', label: 'Person',
  consent: { calendarRead: true, calendarWrite: true, categoryRead: true, replaceOccurrences: true,
    importCalendarEdits: true, editInvitations: false, editSeries: false }, ...changes });
const raw = (changes = {}) => ({ id: 'event', etag: '"v1"', summary: 'Activity', colorId: '2',
  start: { dateTime: '2026-10-25T12:00:00.000Z' }, end: { dateTime: '2026-10-25T12:03:00.000Z' }, ...changes });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const palette = () => ({ event: { '2': { background: '#0b8043' }, '3': { background: '#f4511e' } } });
const gate = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function providers(handler, currentAccounts) {
  const seenAccounts = new Map();
  const filename = path.join(__dirname, '../src/sync/providers.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require(name) {
    if (name === './accounts') return {
      accountFetch(current, ...args) { seenAccounts.set(current.id, current); return handler(current, ...args); },
      async getAccounts() { return currentAccounts ? currentAccounts() : [...seenAccounts.values()]; },
    };
    if (name === '../utils/calendar-description') return require('../src/utils/calendar-description.ts');
    throw Error('Unexpected provider dependency');
  }, Response, Headers, URL }, { filename });
  return module.exports;
}

test('one pass coalesces Google palette work across adapters while every event and ETag stays fresh', async () => {
  const pending = gate(); let metadataReads = 0; let eventReads = 0;
  const api = providers(async (_account, url) => {
    if (url === GOOGLE + '/colors') { metadataReads += 1; await pending.promise; return json(palette()); }
    eventReads += 1; return json(raw({ id: String(eventReads), etag: `"v${eventReads}"` }));
  });
  const cache = api.createCalendarMetadataReadCache();
  const first = api.createCalendarAdapter(account(), cache).getEvent('primary', 'first');
  const second = api.createCalendarAdapter(account(), cache).getEvent('primary', 'second');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(eventReads, 2); assert.equal(metadataReads, 1);
  pending.resolve();
  const events = await Promise.all([first, second]);
  assert.deepEqual(events.map((event) => event.version), ['"v1"', '"v2"']);
  assert.ok(events.every((event) => event.displayColor === '#0b8043'));
  assert.equal((await api.createCalendarAdapter(account(), cache).getEvent('primary', 'third')).version, '"v3"');
  assert.equal(metadataReads, 1); assert.equal(eventReads, 3);
});

test('calendar label metadata is scoped to its exact calendar and category-read consent', async () => {
  const labels = [];
  const api = providers(async (_account, url) => {
    if (/\/events\//.test(url)) return json(raw({ colorId: undefined, eventLabelId: 'named-label' }));
    labels.push(url);
    return json({ labelProperties: { eventLabels: [{ id: 'named-label', backgroundColor:
      url.includes('second') ? '#f4511e' : '#0b8043' }] } });
  });
  const cache = api.createCalendarMetadataReadCache(); const adapter = api.createCalendarAdapter(account(), cache);
  assert.equal((await adapter.getEvent('primary', 'one')).displayColor, '#0b8043');
  assert.equal((await api.createCalendarAdapter(account(), cache).getEvent('primary', 'two')).displayColor, '#0b8043');
  assert.equal((await adapter.getEvent('second', 'three')).displayColor, '#f4511e');
  assert.equal(labels.length, 2);
  const revoked = account(); revoked.consent.categoryRead = false;
  assert.equal((await api.createCalendarAdapter(revoked, cache).getEvent('primary', 'four')).displayColor, undefined);
  assert.equal(labels.length, 2);
  const unreadable = account(); unreadable.consent.calendarRead = false;
  await assert.rejects(api.createCalendarAdapter(unreadable, cache).getEvent('primary', 'five'), /reading is disabled/);
  assert.equal(labels.length, 2);
});

test('account, subject and read-consent changes cannot reuse another metadata scope', async () => {
  let reads = 0;
  const api = providers(async (_account, url) => url === GOOGLE + '/colors' ? (reads += 1, json(palette())) : json(raw()));
  const cache = api.createCalendarMetadataReadCache();
  for (const current of [account(), account({ subject: 'another-subject' }), account({ id: 'google:another-account' }),
    account({ consent: { ...account().consent, categoryRead: false } })]) {
    await api.createCalendarAdapter(current, cache).getEvent('primary', 'same-event');
  }
  assert.equal(reads, 4);
  await api.createCalendarAdapter(account(), cache).getEvent('primary', 'again'); assert.equal(reads, 4);
});

test('a rejected palette read is evicted and later metadata succeeds without caching a failed event read', async () => {
  let metadataReads = 0; let eventReads = 0;
  const api = providers(async (_account, url) => {
    if (url === GOOGLE + '/colors') return ++metadataReads === 1 ? json({ error: { code: 'UNAVAILABLE' } }, 503) : json(palette());
    eventReads += 1; return eventReads === 3 ? json({ error: { code: 'FORBIDDEN' } }, 403) : json(raw());
  });
  const cache = api.createCalendarMetadataReadCache(); const adapter = api.createCalendarAdapter(account(), cache);
  assert.equal((await adapter.getEvent('primary', 'one')).displayColor, undefined);
  assert.equal((await adapter.getEvent('primary', 'two')).displayColor, '#0b8043');
  await assert.rejects(adapter.getEvent('primary', 'three'), (error) => error.status === 403);
  assert.equal((await adapter.getEvent('primary', 'four')).displayColor, '#0b8043');
  assert.equal(metadataReads, 2); assert.equal(eventReads, 4);
});

test('cached palette snapshots neither alias provider objects nor memoize writes or source versions', async () => {
  let reads = 0; let patches = 0; let etag = 0; let stored = raw(); const providerPalette = palette(); const versions = [];
  const api = providers(async (_account, url, init = {}) => {
    if (url === GOOGLE + '/colors') { reads += 1; return { ok: true, status: 200, json: async () => providerPalette }; }
    if (init.method === 'PATCH') {
      patches += 1; versions.push(init.headers['If-Match']);
      const body = JSON.parse(init.body); stored = raw({ ...body, etag: `"v${++etag}"` });
    } else stored = { ...stored, etag: `"v${++etag}"` };
    return json(stored);
  });
  const cache = api.createCalendarMetadataReadCache(); const adapter = api.createCalendarAdapter(account(), cache);
  let current = await adapter.getEvent('primary', 'event');
  providerPalette.event['2'].background = '#ffffff';
  const write = { title: 'Activity', description: '12:00 PM note', start: current.start, end: current.end,
    timeZone: 'UTC', projectionId: 'projection_stable', categoryId: 'activity', googleColorId: '2' };
  current = await adapter.updateEvent(current, write); assert.equal(current.displayColor, '#0b8043');
  current = await api.createCalendarAdapter(account(), cache).getEvent('primary', 'event');
  await adapter.updateEvent(current, write);
  assert.equal(reads, 1); assert.equal(patches, 2); assert.deepEqual(versions, ['"v1"', '"v3"']);
});

test('new pass handles and ordinary uncached adapters get fresh metadata; calendar lists stay uncached', async () => {
  let reads = 0; let lists = 0;
  const api = providers(async (_account, url) => {
    if (url === GOOGLE + '/colors') { reads += 1; return json(palette()); }
    if (url.includes('/calendarList')) { lists += 1; return json({ items: [] }); }
    return json(raw());
  });
  const firstPass = api.createCalendarMetadataReadCache();
  await api.createCalendarAdapter(account(), firstPass).getEvent('primary', 'event');
  await api.createCalendarAdapter(account(), api.createCalendarMetadataReadCache()).getEvent('primary', 'event');
  const uncached = api.createCalendarAdapter(account());
  await uncached.getEvent('primary', 'event'); await uncached.getEvent('primary', 'event');
  const cached = api.createCalendarAdapter(account(), firstPass);
  await cached.listCalendars(); await cached.listCalendars();
  assert.equal(reads, 4); assert.equal(lists, 2);
});

test('one pass cannot retain more than the bounded metadata scope budget', async () => {
  let reads = 0;
  const api = providers(async (_account, url) => url === GOOGLE + '/colors' ? (reads += 1, json(palette())) : json(raw()));
  const cache = api.createCalendarMetadataReadCache();
  for (let index = 0; index < 129; index += 1) {
    await api.createCalendarAdapter(account({ subject: `subject-${index}` }), cache).getEvent('primary', 'event');
  }
  assert.equal(reads, 129);
  await api.createCalendarAdapter(account({ subject: 'subject-128' }), cache).getEvent('primary', 'event'); assert.equal(reads, 129);
  await api.createCalendarAdapter(account({ subject: 'subject-0' }), cache).getEvent('primary', 'event'); assert.equal(reads, 130);
});

test('a stale adapter cannot reuse label metadata after consent revocation, disconnect or subject replacement', async () => {
  const original = account(); let current = [original]; let labelReads = 0;
  const api = providers(async (_account, url) => {
    if (/\/events\//.test(url)) return json(raw({ colorId: undefined, eventLabelId: 'label' }));
    labelReads += 1;
    return json({ labelProperties: { eventLabels: [{ id: 'label', backgroundColor: '#0b8043' }] } });
  }, () => current);
  const cache = api.createCalendarMetadataReadCache(); const stale = api.createCalendarAdapter(original, cache);
  assert.equal((await stale.getEvent('primary', 'first')).displayColor, '#0b8043'); assert.equal(labelReads, 1);
  current = [account({ consent: { ...original.consent, categoryRead: false } })];
  assert.equal((await stale.getEvent('primary', 'revoked')).displayColor, undefined); assert.equal(labelReads, 1);
  current = [];
  assert.equal((await stale.getEvent('primary', 'disconnected')).displayColor, undefined); assert.equal(labelReads, 1);
  current = [account({ subject: 'replacement-subject' })];
  assert.equal((await stale.getEvent('primary', 'replaced')).displayColor, undefined); assert.equal(labelReads, 1);
  assert.equal((await api.createCalendarAdapter(current[0], cache).getEvent('primary', 'fresh')).displayColor, '#0b8043');
  assert.equal(labelReads, 2);
});

test('revoking metadata access while its response is pending discards and evicts that snapshot', async () => {
  const original = account(); let current = original; let labelReads = 0; const pending = gate();
  const api = providers(async (_account, url) => {
    if (/\/events\//.test(url)) return json(raw({ colorId: undefined, eventLabelId: 'label' }));
    labelReads += 1; if (labelReads === 1) await pending.promise;
    return json({ labelProperties: { eventLabels: [{ id: 'label', backgroundColor: '#0b8043' }] } });
  }, () => [current]);
  const cache = api.createCalendarMetadataReadCache(); const adapter = api.createCalendarAdapter(original, cache);
  const inFlight = adapter.getEvent('primary', 'event'); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(labelReads, 1);
  current = account({ consent: { ...original.consent, categoryRead: false } }); pending.resolve();
  assert.equal((await inFlight).displayColor, undefined);
  current = original;
  assert.equal((await adapter.getEvent('primary', 'fresh')).displayColor, '#0b8043'); assert.equal(labelReads, 2);
});
