const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const consent = {
  ledgerStorage: true, calendarRead: true, calendarWrite: true, replaceOccurrences: true,
  importCalendarEdits: true, editInvitations: true, editSeries: true,
};
const account = (provider) => ({ id: `${provider}:person`, provider, subject: 'person', label: 'Person', consent });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { 'Content-Type': 'application/json' } });

function loadProviders(handler = async () => { throw new Error('Unexpected network'); }) {
  const filename = path.join(__dirname, '../src/sync/providers.ts');
  const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(javascript, { module, exports: module.exports,
    require(name) {
      if (name === './accounts') return { accountFetch: handler };
      if (name === '../utils/calendar-description') return require('../src/utils/calendar-description.ts');
      throw new Error(`Unexpected import: ${name}`);
    }, Headers, Response, URL, console }, { filename });
  return module.exports;
}

const scheduled = { start: { dateTime: '2031-03-01T09:00:00Z' }, end: { dateTime: '2031-03-01T10:00:00Z' } };
const write = { title: 'Actual activity', description: 'Minute text', start: '2031-03-01T09:15:00Z',
  end: '2031-03-01T10:00:00Z', timeZone: 'UTC', projectionId: 'projection-1', categoryId: 'work' };

test('Google retains provider mutation timestamps independently of the scheduled event time', () => {
  const { normalizeGoogleEvent } = loadProviders();
  const event = normalizeGoogleEvent({ id: 'event', etag: '"v2"', ...scheduled,
    created: '2026-10-29T10:15:00-04:00', updated: '2026-10-30T12:34:56.789Z' }, 'primary');
  assert.equal(event.createdAt, '2026-10-29T14:15:00.000Z');
  assert.equal(event.updatedAt, '2026-10-30T12:34:56.789Z');
  assert.equal(event.start, '2031-03-01T09:00:00.000Z');
});

test('missing or invalid mutation timestamps stay unknown rather than becoming event or observation time', () => {
  const { normalizeGoogleEvent } = loadProviders();
  for (const updated of [undefined, null, 123, 'invalid', '2026-10-30', '2026-10-30T12:34:56',
    '2026-02-30T12:34:56Z', '2026-10-30T24:00:00Z']) {
    const event = normalizeGoogleEvent({ id: 'event', ...scheduled,
      created: '2026-10-29T10:00:00Z', updated }, 'primary');
    assert.equal(event.updatedAt, undefined);
  }
});

test('a sparse Google cancellation remains a deletion without a fabricated modification timestamp', () => {
  const { normalizeGoogleEvent } = loadProviders();
  const event = normalizeGoogleEvent({ id: 'cancelled-instance', status: 'cancelled',
    recurringEventId: 'series', originalStartTime: { dateTime: '2026-10-30T09:00:00Z' },
    extendedProperties: { private: { contextDescriptionLog: '{invalid' } } }, 'primary');
  assert.equal(event.deleted, true);
  assert.equal(event.seriesId, 'series');
  assert.equal(event.originalStart, '2026-10-30T09:00:00.000Z');
  assert.equal(event.updatedAt, undefined);
  assert.equal(event.createdAt, undefined);
});

test('Google list preserves timestamped changes and sparse deletions on all expanded pages', async () => {
  const requests = [];
  const { createCalendarAdapter } = loadProviders(async (_account, url) => {
    const request = new URL(url);
    requests.push(request);
    return requests.length === 1
      ? json({ items: [{ id: 'event', etag: '"v2"', ...scheduled, updated: '2026-10-30T12:00:00Z' }], nextPageToken: 'next' })
      : json({ items: [{ id: 'removed', status: 'cancelled', updated: '2026-10-30T12:01:00Z' },
        { id: 'sparse', status: 'cancelled' }] });
  });
  const events = await createCalendarAdapter(account('google')).listEvents('primary', write.start, write.end);
  assert.equal(events.length, 3);
  assert.equal(events[0].updatedAt, '2026-10-30T12:00:00.000Z');
  assert.equal(events[1].deleted, true);
  assert.equal(events[1].updatedAt, '2026-10-30T12:01:00.000Z');
  assert.equal(events[2].deleted, true);
  assert.equal(events[2].updatedAt, undefined);
  assert.ok(requests.every((request) => request.searchParams.get('showDeleted') === 'true'));
  assert.ok(requests.every((request) => request.searchParams.get('singleEvents') === 'true'));
  assert.equal(requests[1].searchParams.get('pageToken'), 'next');
});

test('exact Google reads return tombstones while 404 and 410 remain un-timestamped absence evidence', async () => {
  const responses = [json({ id: 'event', status: 'cancelled', updated: '2026-10-30T12:00:00Z' }), json({}, 404), json({}, 410)];
  const { createCalendarAdapter } = loadProviders(async () => responses.shift());
  const adapter = createCalendarAdapter(account('google'));
  const cancelled = await adapter.getEvent('primary', 'event');
  assert.equal(cancelled.deleted, true);
  assert.equal(cancelled.updatedAt, '2026-10-30T12:00:00.000Z');
  assert.equal(await adapter.getEvent('primary', 'event'), null);
  assert.equal(await adapter.getEvent('primary', 'event'), null);
});

test('deleted resources cannot be updated or resurrected, and deleting an acknowledged tombstone is a no-op', async () => {
  let calls = 0;
  const { createCalendarAdapter, normalizeGoogleEvent, normalizeMicrosoftEvent } = loadProviders(async () => {
    calls += 1;
    throw new Error('Unexpected network');
  });
  for (const [provider, tombstone] of [
    ['google', normalizeGoogleEvent({ id: 'event', status: 'cancelled' }, 'primary')],
    ['microsoft', normalizeMicrosoftEvent({ id: 'event', isCancelled: true }, 'primary')],
  ]) {
    const adapter = createCalendarAdapter(account(provider));
    await assert.rejects(adapter.updateEvent(tombstone, write), (failure) => failure.code === 'EVENT_DELETED');
    await adapter.deleteEvent(tombstone);
  }
  assert.equal(calls, 0);
});

test('Google delete conditions on the exact event version and accepts idempotent absent responses', async () => {
  const requests = [];
  const statuses = [204, 404, 410, 412];
  const { createCalendarAdapter, normalizeGoogleEvent } = loadProviders(async (_account, url, init) => {
    requests.push({ url: new URL(url), init });
    const status = statuses.shift();
    return status === 204 ? new Response(null, { status }) : json({}, status);
  });
  const event = normalizeGoogleEvent({ id: 'event', etag: '"latest"', ...scheduled,
    extendedProperties: { private: { contextProjectionId: 'projection-1' } } }, 'primary');
  const adapter = createCalendarAdapter(account('google'));
  for (let index = 0; index < 3; index += 1) await adapter.deleteEvent(event);
  await assert.rejects(adapter.deleteEvent(event), (failure) => failure.code === 'CALENDAR_CONFLICT');
  assert.ok(requests.every(({ init }) => init.method === 'DELETE' && new Headers(init.headers).get('If-Match') === '"latest"'));
  assert.ok(requests.every(({ url }) => url.pathname.endsWith('/events/event')));
});

test('Microsoft mutation timestamps normalize to the same portable fields', () => {
  const { normalizeMicrosoftEvent } = loadProviders();
  const event = normalizeMicrosoftEvent({ id: 'event', ...scheduled,
    createdDateTime: '2026-10-29T10:00:00.0000000Z', lastModifiedDateTime: '2026-10-30T12:34:56.7890000Z' }, 'calendar');
  assert.equal(event.createdAt, '2026-10-29T10:00:00.000Z');
  assert.equal(event.updatedAt, '2026-10-30T12:34:56.789Z');
});

test('Google read-only projection recovery finds the deterministic event after its create response is lost', async () => {
  const calls = []; let created = false;
  const { createCalendarAdapter, googleProjectionEventId } = loadProviders(async (_account, url, init = {}) => {
    calls.push({ url: new URL(url), init });
    if (init.method === 'POST') { created = true; throw new Error('Creation response lost'); }
    if (!created) return json({}, 404);
    return json({ id: googleProjectionEventId(write.projectionId), etag: '"created"', ...scheduled,
      extendedProperties: { private: { contextProjectionId: write.projectionId } } });
  });
  const writer = createCalendarAdapter(account('google'));
  await assert.rejects(writer.createEvent('selected/calendar', write), /response lost/);
  const reader = createCalendarAdapter({ ...account('google'), consent: { ...consent, calendarWrite: false } });
  const found = await reader.findProjectedEvent('selected/calendar', write.projectionId);
  assert.equal(found.id, googleProjectionEventId(write.projectionId));
  assert.equal(found.calendarId, 'selected/calendar');
  assert.equal(found.projectionId, write.projectionId);
  assert.equal(calls.filter(({ init }) => init.method === 'POST').length, 1);
  assert.equal(calls.at(-1).init.method, undefined);
  assert.equal(calls.at(-1).url.pathname,
    `/calendar/v3/calendars/selected%2Fcalendar/events/${googleProjectionEventId(write.projectionId)}`);
});

test('Google projection recovery confirms absence but rejects unknown ownership and propagates provider errors', async () => {
  const { createCalendarAdapter, googleProjectionEventId } = loadProviders(async () => responses.shift());
  const id = googleProjectionEventId(write.projectionId);
  const responses = [json({}, 404), json({}, 410), json({ id, ...scheduled }),
    json({ id, ...scheduled, extendedProperties: { private: { contextProjectionId: 'different' } } }),
    json({ id: 'different', ...scheduled, extendedProperties: { private: { contextProjectionId: write.projectionId } } }),
    json({ error: { message: 'Provider denied access' } }, 403),
    json({ id, status: 'cancelled', extendedProperties: { private: { contextProjectionId: write.projectionId } } })];
  const adapter = createCalendarAdapter(account('google'));
  assert.equal(await adapter.findProjectedEvent('selected', write.projectionId), null);
  assert.equal(await adapter.findProjectedEvent('selected', write.projectionId), null);
  for (let index = 0; index < 3; index++) await assert.rejects(adapter.findProjectedEvent('selected', write.projectionId),
    (failure) => failure.code === 'PROJECTION_IDENTITY_MISMATCH');
  await assert.rejects(adapter.findProjectedEvent('selected', write.projectionId), (failure) => failure.status === 403);
  assert.equal((await adapter.findProjectedEvent('selected', write.projectionId)).deleted, true);
});

const graphProjection = (projectionId, id = 'recovered') => ({ id, type: 'singleInstance', '@odata.etag': 'W/"created"', ...scheduled,
  singleValueExtendedProperties: [{ id: 'String {7814848a-5a74-4c81-a7fe-3b962eaa0716} Name ContextMetadata',
    value: JSON.stringify({ projectionId, categoryId: 'work' }) }] });

test('Microsoft read-only projection recovery follows private-extension pages and verifies exact identity', async () => {
  const calls = []; const projectionId = "projection'quoted";
  const { createCalendarAdapter } = loadProviders(async (_account, url, init) => {
    calls.push({ url: new URL(url), init });
    return calls.length === 1
      ? json({ value: [graphProjection('different')], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/recovery-next' })
      : json({ value: [graphProjection(projectionId)] });
  });
  const reader = createCalendarAdapter({ ...account('microsoft'), consent: { ...consent, calendarWrite: false } });
  const found = await reader.findProjectedEvent('selected/calendar', projectionId);
  assert.equal(found.id, 'recovered'); assert.equal(found.projectionId, projectionId); assert.equal(found.calendarId, 'selected/calendar');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.pathname, '/v1.0/me/calendars/selected%2Fcalendar/events');
  assert.match(calls[0].url.searchParams.get('$filter'), /singleValueExtendedProperties\/Any/);
  assert.ok(calls[0].url.searchParams.get('$filter').includes("projection''quoted"));
  assert.match(calls[0].url.searchParams.get('$expand'), /ContextMetadata/);
  assert.ok(calls.every(({ init }) => !init.method && /ImmutableId/.test(new Headers(init.headers).get('Prefer'))));
});

test('Microsoft projection recovery never writes and propagates errors instead of claiming absence', async () => {
  let calls = 0;
  const responses = [json({ value: [] }), json({ value: [graphProjection(write.projectionId, 'one'), graphProjection(write.projectionId, 'two')] }),
    json({ error: { message: 'Provider unavailable' } }, 503), json({}),
    json({ value: [{ id: 'unverified', ...scheduled }] })];
  const { createCalendarAdapter } = loadProviders(async (_account, _url, init) => {
    calls++; assert.equal(init.method, undefined); return responses.shift();
  });
  const adapter = createCalendarAdapter(account('microsoft'));
  assert.equal(await adapter.findProjectedEvent('selected', write.projectionId), null);
  await assert.rejects(adapter.findProjectedEvent('selected', write.projectionId), (failure) => failure.code === 'CALENDAR_CONFLICT');
  await assert.rejects(adapter.findProjectedEvent('selected', write.projectionId), (failure) => failure.status === 503);
  await assert.rejects(adapter.findProjectedEvent('selected', write.projectionId), (failure) => failure.code === 'INVALID_PROVIDER_RESPONSE');
  await assert.rejects(adapter.findProjectedEvent('selected', write.projectionId), (failure) => failure.code === 'PROJECTION_IDENTITY_MISMATCH');
  assert.equal(calls, 5);
  for (const provider of ['google', 'microsoft']) {
    const disconnected = createCalendarAdapter({ ...account(provider), consent: { ...consent, calendarRead: false } });
    await assert.rejects(disconnected.findProjectedEvent('selected', write.projectionId), /reading is disabled/);
  }
  assert.equal(calls, 5);
});
