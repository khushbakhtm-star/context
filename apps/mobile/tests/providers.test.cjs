const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadProviders(handler) {
  const filename = path.join(__dirname, '../src/sync/providers.ts');
  const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports,
    require(name) {
      if (name === './accounts') return { accountFetch: handler };
      if (name === '../utils/calendar-description') return require('../src/utils/calendar-description.ts');
      throw new Error(`Unexpected test import: ${name}`);
    },
    Headers, Response, URL, console,
  });
  vm.runInContext(javascript, context, { filename });
  return module.exports;
}

const consent = {
  ledgerStorage: true, calendarRead: true, calendarWrite: true,
  replaceOccurrences: true, importCalendarEdits: true,
  editInvitations: true, editSeries: true,
};
const account = (provider) => ({ id: `${provider}:user`, provider, subject: 'user', label: 'User', consent });
const event = (overrides = {}) => ({
  id: 'instance', calendarId: 'primary', title: 'Prayer', description: '',
  start: '2026-10-25T22:45:00.000Z', end: '2026-10-25T23:05:00.000Z',
  timeZone: 'America/New_York', allDay: false, version: '"v1"',
  seriesId: 'series', isSeriesMaster: false, deleted: false, ...overrides,
});
const write = {
  title: 'Prayer actual', description: '18:55 Pray', start: '2026-10-25T22:55:00.000Z',
  end: '2026-10-25T23:05:00.000Z', timeZone: 'America/New_York',
  projectionId: '8bec4f11-23cd-4567-8901-010203040506', categoryId: 'prayer',
};
const seriesWrite = { ...write, sourceOperationId: 'source-operation-1' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('Google calendar display fallback is separate from the exact provider color provenance', async () => {
  const { createCalendarAdapter } = loadProviders(async () => json({ items: [
    { id: 'actual', summary: 'Actual', backgroundColor: '#112233', accessRole: 'owner' },
    { id: 'missing', summary: 'Missing', accessRole: 'reader' },
    { id: 'invalid', summary: 'Invalid', backgroundColor: 'not-a-color', accessRole: 'writer' },
  ] }));
  const calendars = await createCalendarAdapter(account('google')).listCalendars();
  assert.equal(calendars[0].color, '#112233'); assert.equal(calendars[0].providedColor, '#112233');
  for (const calendar of calendars.slice(1)) {
    assert.equal(calendar.color, '#8E8C86'); assert.equal(calendar.providedColor, undefined);
  }
});

test('Google reads expanded occurrences and follows every page', async () => {
  const requests = [];
  const { createCalendarAdapter } = loadProviders(async (_account, url) => {
    requests.push(new URL(url));
    const page = requests.length;
    return json({
      items: [{ id: `instance-${page}`, etag: '"v1"', recurringEventId: 'series',
        originalStartTime: { dateTime: '2026-10-25T18:45:00-04:00' },
        start: { dateTime: '2026-10-25T18:45:00-04:00' }, end: { dateTime: '2026-10-25T19:05:00-04:00' } }],
      ...(page === 1 ? { nextPageToken: 'second' } : {}),
    });
  });
  const result = await createCalendarAdapter(account('google')).listEvents('primary', write.start, write.end);
  assert.equal(result.length, 2);
  assert.equal(result[0].seriesId, 'series');
  assert.equal(result[0].originalStart, '2026-10-25T22:45:00.000Z');
  assert.equal(result[0].isSeriesMaster, false);
  assert.equal(requests[0].searchParams.get('singleEvents'), 'true');
  assert.equal(requests[1].searchParams.get('pageToken'), 'second');
});

test('Google standard event colors use the exact provider palette without requiring a local category import', async () => {
  const requests = [];
  const { createCalendarAdapter } = loadProviders(async (_account, url) => {
    requests.push(url);
    if (url.endsWith('/colors')) return json({ event: { 7: { background: '#Ab12CD' } } });
    return json({ items: [{ id: 'colored', colorId: '7', start: { dateTime: write.start }, end: { dateTime: write.end } }] });
  });
  const events = await createCalendarAdapter(account('google')).listEvents('primary', write.start, write.end);
  assert.equal(events[0].displayColor, '#Ab12CD');
  assert.equal(requests.length, 2); assert.ok(requests[1].endsWith('/colors'));
});

test('Google named event label colors require existing category consent and take precedence over standard color IDs', async () => {
  for (const permitted of [false, true]) {
    const requests = [];
    const { createCalendarAdapter } = loadProviders(async (_account, url) => {
      requests.push(url);
      if (!url.includes('/events?')) return json({ labelProperties: { eventLabels: [{ id: 'label', backgroundColor: '#123456' }] } });
      return json({ items: [{ id: 'labeled', colorId: '7', eventLabelId: 'label', start: { dateTime: write.start }, end: { dateTime: write.end } }] });
    });
    const selected = account('google'); selected.consent = { ...selected.consent, categoryRead: permitted };
    const events = await createCalendarAdapter(selected).listEvents('primary', write.start, write.end);
    assert.equal(events[0].displayColor, permitted ? '#123456' : undefined);
    assert.equal(requests.length, permitted ? 2 : 1);
  }
});

test('Google modifies only the concrete instance with If-Match and no recurrence patch', async () => {
  let request;
  const { createCalendarAdapter } = loadProviders(async (_account, url, init) => {
    request = { url, init };
    return json({ id: 'instance', etag: '"v2"', start: { dateTime: write.start }, end: { dateTime: write.end } });
  });
  await createCalendarAdapter(account('google')).updateEvent(event(), write);
  assert.match(request.url, /events\/instance\?/);
  assert.equal(new Headers(request.init.headers).get('If-Match'), '"v1"');
  assert.equal(request.init.method, 'PATCH');
  const payload = JSON.parse(request.init.body);
  assert.equal(payload.recurrence, undefined);
  assert.equal(payload.start.dateTime, write.start);
});

test('series master and disabled replacement cannot trigger network writes', async () => {
  let calls = 0;
  const { createCalendarAdapter } = loadProviders(async () => { calls += 1; throw new Error('Unexpected network'); });
  await assert.rejects(createCalendarAdapter(account('google')).updateEvent(event({ isSeriesMaster: true }), write), /one occurrence/);
  const denied = account('google');
  denied.consent = { ...consent, replaceOccurrences: false };
  await assert.rejects(createCalendarAdapter(denied).updateEvent(event(), write), /disabled/);
  assert.equal(calls, 0);
});

test('Google 412 becomes a typed reconciliation conflict', async () => {
  const { createCalendarAdapter } = loadProviders(async () => json({ error: { code: 412 } }, 412));
  await assert.rejects(
    createCalendarAdapter(account('google')).updateEvent(event(), write),
    (error) => error.code === 'CALENDAR_CONFLICT' && error.status === 412,
  );
});

test('Google creation uses deterministic IDs and recovers a concurrent 409', async () => {
  let calls = 0;
  let insertedId;
  const { createCalendarAdapter, googleProjectionEventId } = loadProviders(async (_account, _url, init) => {
    calls += 1;
    if (calls === 1) return json({}, 404);
    if (calls === 2) {
      insertedId = JSON.parse(init.body).id;
      return json({}, 409);
    }
    return json({ id: insertedId, etag: '"v2"', start: { dateTime: write.start }, end: { dateTime: write.end },
      extendedProperties: { private: { contextProjectionId: write.projectionId } } });
  });
  const result = await createCalendarAdapter(account('google')).createEvent('primary', write);
  assert.equal(result.id, googleProjectionEventId(write.projectionId));
  assert.match(result.id, /^[0-9a-v]{5,1024}$/);
  assert.equal(calls, 3);
});

test('Microsoft calendarView uses UTC, immutable IDs, expanded metadata, and pagination', async () => {
  const calls = [];
  const { createCalendarAdapter } = loadProviders(async (_account, url, init) => {
    calls.push({ url, init });
    return json({ value: [{ id: `instance-${calls.length}`, type: 'occurrence', seriesMasterId: 'master',
      '@odata.etag': 'W/"v1"', start: { dateTime: '2026-10-25T22:55:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-10-25T23:05:00', timeZone: 'UTC' },
      body: { contentType: 'html', content: '<div>18:55 Pray &amp; reflect</div><div>18:56 Continue</div>' } }],
      ...(calls.length === 1 ? { '@odata.nextLink': 'https://graph.microsoft.com/v1.0/second' } : {}) });
  });
  const events = await createCalendarAdapter(account('microsoft')).listEvents('calendar', write.start, write.end);
  assert.equal(events.length, 2);
  assert.equal(events[0].start, write.start);
  assert.equal(events[0].description, '18:55 Pray & reflect\n18:56 Continue');
  assert.equal(events[0].isSeriesMaster, false);
  for (const call of calls) {
    const prefer = new Headers(call.init.headers).get('Prefer');
    assert.match(prefer, /ImmutableId/);
    assert.match(prefer, /timezone="UTC"/);
  }
  assert.equal(calls[1].url, 'https://graph.microsoft.com/v1.0/second');
});

test('Microsoft changed preflight version stops before PATCH', async () => {
  let calls = 0;
  const { createCalendarAdapter } = loadProviders(async () => {
    calls += 1;
    return json({ id: 'instance', type: 'exception', '@odata.etag': 'W/"changed"',
      start: { dateTime: '2026-10-25T22:55:00', timeZone: 'UTC' }, end: { dateTime: '2026-10-25T23:05:00', timeZone: 'UTC' } });
  });
  await assert.rejects(
    createCalendarAdapter(account('microsoft')).updateEvent(event(), write),
    (error) => error.code === 'CALENDAR_CONFLICT',
  );
  assert.equal(calls, 1);
});

test('Microsoft create posts stable transactionId and valid UTC start/end', async () => {
  let posted;
  const { createCalendarAdapter } = loadProviders(async (_account, _url, init) => {
    if (!init.method) return json({ value: [] });
    posted = JSON.parse(init.body);
    return json({ id: 'new', type: 'singleInstance', '@odata.etag': 'W/"v1"',
      start: posted.start, end: posted.end });
  });
  const result = await createCalendarAdapter(account('microsoft')).createEvent('calendar', write);
  assert.equal(posted.transactionId, write.projectionId);
  assert.equal(posted.start.timeZone, 'UTC');
  assert.equal(posted.start.dateTime, '2026-10-25T22:55:00.000');
  assert.equal(result.projectionId, write.projectionId);
});

test('HTML conversion preserves meeting-link targets as text', () => {
  const { calendarHtmlToText } = loadProviders(async () => { throw new Error('No network'); });
  assert.equal(
    calendarHtmlToText('<p><a href="https://teams.microsoft.com/join?x=1&amp;y=2">Join meeting</a></p>'),
    'Join meeting (https://teams.microsoft.com/join?x=1&y=2)',
  );
});

test('Microsoft online-meeting PATCH preserves the original HTML meeting blob', async () => {
  const originalHtml = '<html><body><div>Notes</div><div class="me-email-text" id="meetBlob"><a href="https://teams.microsoft.com/join">Join</a><span data-meeting="protected">MEETING-BLOB</span></div></body></html>';
  const description = 'Notes\nJoin\n--- Context minutes ---\n18:55 Pray <script>literal</script> & reflect\n--- End Context minutes ---';
  let payload;
  let getPrefer;
  const { createCalendarAdapter } = loadProviders(async (_account, _url, init) => {
    if (!init.method) {
      getPrefer = new Headers(init.headers).get('Prefer');
      return json({ id: 'instance', type: 'occurrence', isOnlineMeeting: true,
        '@odata.etag': '"v1"', start: { dateTime: '2026-10-25T22:45:00', timeZone: 'UTC' },
        end: { dateTime: '2026-10-25T23:05:00', timeZone: 'UTC' },
        body: { contentType: 'html', content: originalHtml } });
    }
    payload = JSON.parse(init.body);
    return json({ id: 'instance', type: 'exception', isOnlineMeeting: true,
      '@odata.etag': '"v2"', start: payload.start, end: payload.end, body: payload.body });
  });
  const result = await createCalendarAdapter(account('microsoft')).updateEvent(event({ isOnlineMeeting: true }), { ...write, description });
  assert.doesNotMatch(getPrefer, /body-content-type="text"/);
  assert.equal(payload.body.contentType, 'html');
  assert.ok(payload.body.content.includes('<div class="me-email-text" id="meetBlob"><a href="https://teams.microsoft.com/join">Join</a><span data-meeting="protected">MEETING-BLOB</span></div>'));
  assert.ok(payload.body.content.includes('&lt;script&gt;literal&lt;/script&gt; &amp; reflect'));
  assert.ok(result.bodyHtml.includes('MEETING-BLOB'));
  const outsideContext = payload.body.content.replace(/<!-- context-minute-ledger:start -->[\s\S]*?<!-- context-minute-ledger:end -->/g, '');
  assert.equal(outsideContext, originalHtml);
});

test('repeated online-meeting updates replace only the Context section', () => {
  const { meetingBodyWithContext } = loadProviders(async () => { throw new Error('No network'); });
  const { makeCalendarDescription } = require('../src/utils/calendar-description.ts');
  const original = '<html><body><div id="meeting-blob">Protected original</div></body></html>';
  const firstWrite = makeCalendarDescription('Protected original', '18:55 First text');
  const first = meetingBodyWithContext(original, firstWrite.description, firstWrite.descriptionLog, 'projection');
  const nextWrite = makeCalendarDescription('Protected original', '18:56 Changed text');
  const second = meetingBodyWithContext(first, nextWrite.description, nextWrite.descriptionLog, 'projection',
    { ...firstWrite, projectionId: 'projection' });
  assert.equal((second.match(/<!-- context-minute-ledger:start -->/g) || []).length, 1);
  assert.equal((second.match(/id="meeting-blob"/g) || []).length, 1);
  assert.doesNotMatch(second, /First text/);
  assert.match(second, /Changed text/);
  assert.equal(second.replace(/<!-- context-minute-ledger:start -->[\s\S]*?<!-- context-minute-ledger:end -->/g, ''), original);
});

test('online-meeting missing raw HTML refuses the write and WebDAV cannot be used as a calendar', async () => {
  let patches = 0;
  const { createCalendarAdapter } = loadProviders(async (_account, _url, init) => {
    if (init.method) patches += 1;
    return json({ id: 'instance', type: 'occurrence', isOnlineMeeting: true,
      '@odata.etag': '"v1"', start: { dateTime: '2026-10-25T22:45:00', timeZone: 'UTC' },
      end: { dateTime: '2026-10-25T23:05:00', timeZone: 'UTC' },
      body: { contentType: 'text', content: 'Missing meeting blob' } });
  });
  await assert.rejects(
    createCalendarAdapter(account('microsoft')).updateEvent(event({ isOnlineMeeting: true }), write),
    (failure) => failure.code === 'MEETING_BODY_REQUIRED',
  );
  assert.equal(patches, 0);
  assert.throws(() => createCalendarAdapter(account('webdav')), /ledger storage only/);
});

test('whole-series writes require a separate permission and occurrence writes still reject masters', async () => {
  let requests = 0;
  const { createCalendarAdapter } = loadProviders(async () => { requests += 1; throw new Error('No request expected'); });
  const denied = account('google');
  denied.consent = { ...consent, editSeries: false };
  await assert.rejects(createCalendarAdapter(denied).updateSeries(event(), write), (failure) => failure.code === 'SERIES_PERMISSION_REQUIRED');
  await assert.rejects(createCalendarAdapter(account('google')).updateEvent(event({ isSeriesMaster: true }), write), (failure) => failure.code === 'OCCURRENCE_REQUIRED');
  assert.equal(requests, 0);
});

test('Google whole-series changes retain original series dates and recurrence and condition on the master', async () => {
  let changed;
  const masterStart = '2026-01-01T22:45:00.000Z';
  const masterEnd = '2026-01-01T23:05:00.000Z';
  const { createCalendarAdapter } = loadProviders(async (_account, url, init = {}) => {
    if (init.method === 'PATCH') {
      changed = { url: new URL(url), init, body: JSON.parse(init.body) };
      return json({ id: 'series', etag: '"series-v2"', recurrence: ['RRULE:FREQ=DAILY'],
        start: changed.body.start, end: changed.body.end });
    }
    if (new URL(url).pathname.endsWith('/series')) return json({ id: 'series', etag: '"series-v1"',
      summary: 'Original plan', description: 'Keep master notes', recurrence: ['RRULE:FREQ=DAILY'],
      start: { dateTime: masterStart, timeZone: 'America/New_York' },
      end: { dateTime: masterEnd, timeZone: 'America/New_York' } });
    return json({ id: 'instance', etag: '"v1"', recurringEventId: 'series',
      start: { dateTime: event().start }, end: { dateTime: event().end } });
  });
  const saved = await createCalendarAdapter(account('google')).updateSeries(event(), seriesWrite);
  assert.equal(changed.body.start.dateTime, '2026-01-01T22:55:00.000Z');
  assert.equal(changed.body.end.dateTime, masterEnd);
  assert.equal(changed.body.recurrence, undefined);
  assert.equal(changed.body.extendedProperties.private.contextSourceOperationId, seriesWrite.sourceOperationId);
  assert.equal(changed.body.extendedProperties.private.contextProjectionId, undefined);
  assert.equal(changed.body.description, 'Keep master notes');
  assert.equal(new Headers(changed.init.headers).get('If-Match'), '"series-v1"');
  assert.match(changed.url.pathname, /\/events\/series$/);
  assert.equal(saved.isSeriesMaster, true);
});

test('invitation changes require invitation permission and send Google attendee updates only after approval', async () => {
  let changes = 0;
  let updateUrl;
  const { createCalendarAdapter } = loadProviders(async (_account, url, init) => {
    changes += 1;
    updateUrl = new URL(url);
    return json({ id: 'instance', etag: '"v2"', start: { dateTime: write.start }, end: { dateTime: write.end } });
  });
  const denied = account('google');
  denied.consent = { ...consent, editInvitations: false };
  await assert.rejects(createCalendarAdapter(denied).updateEvent(event({ isInvitation: true }), write),
    (failure) => failure.code === 'INVITATION_PERMISSION_REQUIRED');
  assert.equal(changes, 0);
  await createCalendarAdapter(account('google')).updateEvent(event({ isInvitation: true }), write);
  assert.equal(updateUrl.searchParams.get('sendUpdates'), 'all');
});

test('Google whole-series editing detects a changed selected occurrence before master mutation', async () => {
  let calls = 0;
  const { createCalendarAdapter } = loadProviders(async () => {
    calls += 1;
    if (calls === 1) return json({ id: 'series', etag: '"master-v1"', recurrence: ['RRULE:FREQ=DAILY'],
      start: { dateTime: '2026-01-01T22:45:00.000Z' }, end: { dateTime: '2026-01-01T23:05:00.000Z' } });
    return json({ id: 'instance', etag: '"changed"', recurringEventId: 'series',
      start: { dateTime: event().start }, end: { dateTime: event().end } });
  });
  await assert.rejects(createCalendarAdapter(account('google')).updateSeries(event(), seriesWrite), (failure) => failure.code === 'CALENDAR_CONFLICT');
  assert.equal(calls, 2);
});

test('Microsoft whole-series editing preserves online-meeting body and applies only occurrence deltas', async () => {
  let patch;
  const { createCalendarAdapter } = loadProviders(async (_account, url, init = {}) => {
    if (init.method === 'PATCH') {
      patch = { url, headers: new Headers(init.headers), body: JSON.parse(init.body) };
      return json({ id: 'series', type: 'seriesMaster', '@odata.etag': '"master-v2"',
        start: patch.body.start, end: patch.body.end });
    }
    if (new URL(url).pathname.endsWith('/series')) return json({ id: 'series', type: 'seriesMaster',
      isOnlineMeeting: true, '@odata.etag': '"master-v1"',
      start: { dateTime: '2026-01-01T22:45:00', timeZone: 'UTC' },
      end: { dateTime: '2026-01-01T23:05:00', timeZone: 'UTC' },
      body: { contentType: 'html', content: '<div id="MEETING-BLOB">Preserve online meeting</div>' } });
    return json({ id: 'instance', type: 'occurrence', seriesMasterId: 'series', '@odata.etag': '"v1"',
      start: { dateTime: event().start, timeZone: 'UTC' }, end: { dateTime: event().end, timeZone: 'UTC' } });
  });
  await createCalendarAdapter(account('microsoft')).updateSeries(event(), seriesWrite);
  assert.equal(patch.body.start.dateTime, '2026-01-01T22:55:00.000');
  assert.equal(patch.body.end.dateTime, '2026-01-01T23:05:00.000');
  assert.equal(patch.body.body, undefined);
  assert.equal(patch.body.recurrence, undefined);
  assert.equal(patch.body.singleValueExtendedProperties.length, 1);
  assert.equal(patch.body.singleValueExtendedProperties[0].value, seriesWrite.sourceOperationId);
  assert.equal(patch.headers.get('If-Match'), '"master-v1"');
});

test('provider category writes include Google custom-label version and supplied Microsoft category names', async () => {
  let googleRequest;
  const google = loadProviders(async (_account, url, init) => {
    googleRequest = { url: new URL(url), payload: JSON.parse(init.body) };
    return json({ id: 'instance', etag: '"v2"', start: { dateTime: write.start }, end: { dateTime: write.end } });
  });
  await google.createCalendarAdapter(account('google')).updateEvent(event(), { ...write, googleEventLabelId: 'custom-prayer' });
  assert.equal(googleRequest.url.searchParams.get('eventLabelVersion'), '1');
  assert.equal(googleRequest.payload.eventLabelId, 'custom-prayer');
  assert.equal(googleRequest.payload.colorId, undefined);

  let graphPayload;
  const graph = loadProviders(async (_account, _url, init = {}) => {
    if (init.method) graphPayload = JSON.parse(init.body);
    return json({ id: 'instance', type: 'occurrence', '@odata.etag': '"v1"',
      start: { dateTime: event().start }, end: { dateTime: event().end } });
  });
  await graph.createCalendarAdapter(account('microsoft')).updateEvent(event(), { ...write, microsoftCategories: ['Prayer', 'Personal'] });
  assert.deepEqual(graphPayload.categories, ['Prayer', 'Personal']);
});

test('Google whole-series retry with the same saved operation does not shift the master twice', async () => {
  let patches = 0;
  let master = { id: 'series', etag: '"master-v1"', recurrence: ['RRULE:FREQ=DAILY'],
    start: { dateTime: '2026-01-01T22:45:00.000Z' }, end: { dateTime: '2026-01-01T23:05:00.000Z' } };
  const { createCalendarAdapter } = loadProviders(async (_account, url, init = {}) => {
    if (init.method === 'PATCH') {
      patches += 1;
      master = { ...master, ...JSON.parse(init.body), etag: '"master-v2"' };
      return json(master);
    }
    if (new URL(url).pathname.endsWith('/series')) return json(master);
    return json({ id: 'instance', etag: patches ? '"changed-after-master"' : '"v1"', recurringEventId: 'series',
      start: { dateTime: event().start }, end: { dateTime: event().end } });
  });
  const adapter = createCalendarAdapter(account('google'));
  await adapter.updateSeries(event(), seriesWrite);
  const retried = await adapter.updateSeries(event(), seriesWrite);
  assert.equal(patches, 1);
  assert.equal(retried.start, '2026-01-01T22:55:00.000Z');
  assert.equal(retried.sourceOperationId, seriesWrite.sourceOperationId);
});

test('Microsoft whole-series retry reads its separate operation marker and never repeats the PATCH', async () => {
  let patches = 0;
  let master = { id: 'series', type: 'seriesMaster', '@odata.etag': '"master-v1"',
    start: { dateTime: '2026-01-01T22:45:00', timeZone: 'UTC' },
    end: { dateTime: '2026-01-01T23:05:00', timeZone: 'UTC' } };
  const { createCalendarAdapter } = loadProviders(async (_account, url, init = {}) => {
    if (init.method === 'PATCH') {
      patches += 1;
      master = { ...master, ...JSON.parse(init.body), '@odata.etag': '"master-v2"' };
      return json(master);
    }
    if (new URL(url).pathname.endsWith('/series')) return json(master);
    return json({ id: 'instance', type: 'occurrence', seriesMasterId: 'series',
      '@odata.etag': patches ? '"changed-after-master"' : '"v1"',
      start: { dateTime: event().start }, end: { dateTime: event().end } });
  });
  const adapter = createCalendarAdapter(account('microsoft'));
  await adapter.updateSeries(event(), seriesWrite);
  const retried = await adapter.updateSeries(event(), seriesWrite);
  assert.equal(patches, 1);
  assert.equal(retried.start, '2026-01-01T22:55:00.000Z');
  assert.equal(retried.sourceOperationId, seriesWrite.sourceOperationId);
});
