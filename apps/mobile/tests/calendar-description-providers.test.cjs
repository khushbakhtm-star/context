const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { makeCalendarDescription, readCalendarDescription } = require('../src/utils/calendar-description.ts');

const META = 'String {7814848a-5a74-4c81-a7fe-3b962eaa0716} Name ContextMetadata';
const START = '<!-- context-minute-ledger:start -->';
const END = '<!-- context-minute-ledger:end -->';
const projectionId = 'projection_clean_coffee';
const consent = { calendarRead: true, calendarWrite: true, replaceOccurrences: true,
  editInvitations: true, editSeries: true, importCalendarEdits: true };
const account = (provider) => ({ id: `${provider}:person`, provider, subject: 'person', label: 'Person', consent });
const timing = { start: '2026-10-25T16:39:00.000Z', end: '2026-10-25T16:48:00.000Z', timeZone: 'UTC' };
const write = (preserved, log) => ({ title: 'Make coffee', ...makeCalendarDescription(preserved, log),
  ...timing, projectionId, categoryId: 'family_private_id' });
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

function loadProviders(handler = async () => { throw new Error('Unexpected network'); }) {
  const filename = path.join(__dirname, '../src/sync/providers.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports,
    require(name) {
      if (name === './accounts') return { accountFetch: handler };
      if (name === '../utils/calendar-description') return require('../src/utils/calendar-description.ts');
      throw new Error(`Unexpected import: ${name}`);
    }, Headers, Response, URL, console }, { filename });
  return module.exports;
}

function googleRaw(changes = {}) {
  return { id: 'event', etag: '"v1"', summary: 'Make coffee',
    start: { dateTime: timing.start }, end: { dateTime: timing.end }, ...changes };
}
function graphRaw(changes = {}) {
  return { id: 'event', '@odata.etag': '"v1"', type: 'singleInstance', subject: 'Make coffee',
    isOnlineMeeting: true, start: { dateTime: timing.start }, end: { dateTime: timing.end }, ...changes };
}
const graphMetadata = (value) => [{ id: META, value: typeof value === 'string' ? value : JSON.stringify(value) }];
const outsideSection = (html) => html.replace(/<!-- context-minute-ledger:start -->[\s\S]*?<!-- context-minute-ledger:end -->/g, '');

test('Google create and repeated update keep a clean visible description with ownership only in private metadata', async () => {
  const preserved = '  Original appointment notes\r\n12:00 PM this was original prose.\n';
  const requests = [];
  let stored;
  const { createCalendarAdapter } = loadProviders(async (_account, _url, init = {}) => {
    if (!init.method) return stored ? json(stored) : json({}, 404);
    const body = JSON.parse(init.body);
    requests.push(body);
    stored = googleRaw({ ...body, id: body.id ?? 'event', etag: `"v${requests.length + 1}"` });
    return json(stored);
  });
  const adapter = createCalendarAdapter(account('google'));
  let event = await adapter.createEvent('primary', write(preserved, '12:39 PM  Make coffee'));
  for (const log of ['12:39 PM  Make coffee\n12:40 PM  Talk to Mum', '12:41 PM  Pour <milk> & stir']) {
    const parts = readCalendarDescription(event, projectionId);
    assert.equal(parts.preserved, preserved);
    event = await adapter.updateEvent(event, write(parts.preserved, log));
    assert.equal(event.description, `${preserved}\n\n${log}`);
    assert.equal(readCalendarDescription(event, projectionId).log, log);
  }
  assert.equal(requests.length, 3);
  for (const body of requests) {
    assert.doesNotMatch(body.description, /--- Context minutes ---|--- End Context minutes ---|Context category:|Context projection:|Context block:|Full minute record available|family_private_id/);
    const metadata = JSON.parse(body.extendedProperties.private.contextDescriptionLog);
    assert.equal(metadata.version, 1);
    assert.equal(metadata.offset, preserved.length + 2);
    assert.equal(body.extendedProperties.private.contextProjectionId, projectionId);
    assert.equal(body.extendedProperties.private.contextCategoryId, 'family_private_id');
  }
  assert.ok(!event.description.includes('Talk to Mum'));
});

test('Google corrupt private metadata requires review and a changed original prefix remains a conflict', () => {
  const { normalizeGoogleEvent } = loadProviders();
  const entry = write('Original notes', '12:39 PM  Coffee');
  for (const invalid of ['{', 'null', JSON.stringify({ ...entry.descriptionLog, offset: -1 })]) {
    assert.throws(() => normalizeGoogleEvent(googleRaw({ description: entry.description,
      extendedProperties: { private: { contextProjectionId: projectionId, contextDescriptionLog: invalid } } }), 'primary'),
    (error) => error.code === 'INVALID_DESCRIPTION_METADATA');
  }
  const event = normalizeGoogleEvent(googleRaw({ description: entry.description.replace('Original', 'Altered!'),
    extendedProperties: { private: { contextProjectionId: projectionId,
      contextDescriptionLog: JSON.stringify(entry.descriptionLog) } } }), 'primary');
  assert.throws(() => readCalendarDescription(event, projectionId), /Review/);
});

test('Microsoft online HTML and exact multiline notes survive repeated updates and omitted response metadata', async () => {
  const originalHtml = '<!doctype html><html><body>\r\n<div>Original &amp; notes</div>\n' +
    '<div class="meeting-blob" data-exact="&quot;keep&quot;"><a href="https://teams.microsoft.com/join?x=1&amp;y=2">Join meeting</a>' +
    '<span data-meeting="protected">MEETING-BLOB</span></div>\r\n</body></html>';
  const { calendarHtmlToText } = loadProviders();
  const preserved = calendarHtmlToText(originalHtml);
  let server = graphRaw({ body: { contentType: 'html', content: originalHtml } });
  const payloads = [];
  const { createCalendarAdapter } = loadProviders(async (_account, _url, init = {}) => {
    if (!init.method) return json(server);
    const body = JSON.parse(init.body);
    payloads.push(body);
    server = graphRaw({ ...server, '@odata.etag': `"v${payloads.length + 1}"`,
      start: body.start, end: body.end, body: body.body,
      singleValueExtendedProperties: body.singleValueExtendedProperties });
    const { singleValueExtendedProperties: _omitted, ...response } = server;
    return json(response);
  });
  const adapter = createCalendarAdapter(account('microsoft'));
  let event = await adapter.getEvent('calendar', 'event');
  const notes = ['12:39 PM  Make coffee\r\n\r\nTalk to Mum <doctor> & "appointment" \'today\'\n  Keep trailing spaces  \n',
    '\n12:40 PM  Different note ☕\nLiteral &amp; &#10; <script>not executable</script>\n\n'];
  for (const note of notes) {
    const next = write(preserved, note);
    event = await adapter.updateEvent(event, next);
    assert.equal(event.description, `${preserved}\n\n${note}`);
    assert.equal(readCalendarDescription(event, projectionId).log, note);
    assert.equal(outsideSection(event.bodyHtml), originalHtml);
    assert.equal((event.bodyHtml.match(/<!-- context-minute-ledger:start -->/g) ?? []).length, 1);
    assert.equal((event.bodyHtml.match(/MEETING-BLOB/g) ?? []).length, 1);
    // Exercise a separate expanded read, rather than relying only on the write response shim.
    event = await adapter.getEvent('calendar', 'event');
    assert.equal(event.description, next.description);
    assert.equal(readCalendarDescription(event, projectionId).preserved, preserved);
  }
  assert.ok(!event.bodyHtml.includes('Keep trailing spaces'));
  for (const payload of payloads) {
    assert.equal(payload.body.contentType, 'html');
    assert.equal(outsideSection(payload.body.content), originalHtml);
    const metadata = JSON.parse(payload.singleValueExtendedProperties.find((item) => item.id === META).value);
    assert.equal(metadata.projectionId, projectionId);
    assert.equal(metadata.descriptionLog.offset, preserved.length + 2);
    const visibleSection = payload.body.content.slice(payload.body.content.indexOf(START), payload.body.content.indexOf(END));
    assert.doesNotMatch(visibleSection, /Context category:|Context projection:|Context block:|Full minute record available|family_private_id|<script>/);
  }
});

test('Microsoft remote edits retain the original metadata so changed prefix is reviewed and edited minute tail can import', () => {
  const { meetingBodyWithContext, normalizeMicrosoftEvent, calendarHtmlToText } = loadProviders();
  const rawHtml = '<html><body><p>Original appointment</p></body></html>';
  const entry = write(calendarHtmlToText(rawHtml), '12:39 PM  Make coffee\n');
  const content = meetingBodyWithContext(rawHtml, entry.description, entry.descriptionLog, projectionId);
  const properties = graphMetadata({ projectionId, categoryId: entry.categoryId, descriptionLog: entry.descriptionLog });
  const editedTail = normalizeMicrosoftEvent(graphRaw({ body: { contentType: 'html', content: content.replace('Make coffee', 'Talk to Mum') },
    singleValueExtendedProperties: properties }), 'calendar');
  assert.equal(readCalendarDescription(editedTail, projectionId).log, '12:39 PM  Talk to Mum\n');
  const editedPrefix = normalizeMicrosoftEvent(graphRaw({ body: { contentType: 'html', content: content.replace('Original appointment', 'Changed appointment') },
    singleValueExtendedProperties: properties }), 'calendar');
  assert.throws(() => readCalendarDescription(editedPrefix, projectionId), /Review/);
});

test('Microsoft malformed private metadata or malformed owned HTML cannot silently downgrade to an original description', () => {
  const { normalizeMicrosoftEvent, meetingBodyWithContext, calendarHtmlToText } = loadProviders();
  const rawHtml = '<html><body><p>Original appointment</p></body></html>';
  const entry = write(calendarHtmlToText(rawHtml), '12:39 PM  Make coffee');
  const html = meetingBodyWithContext(rawHtml, entry.description, entry.descriptionLog, projectionId);
  for (const value of ['{', 'null', '[]', JSON.stringify({ projectionId, descriptionLog: { ...entry.descriptionLog, offset: -1 } })]) {
    assert.throws(() => normalizeMicrosoftEvent(graphRaw({ body: { contentType: 'html', content: html },
      singleValueExtendedProperties: graphMetadata(value) }), 'calendar'), /review/i);
  }
  const properties = graphMetadata({ projectionId, descriptionLog: entry.descriptionLog });
  for (const content of [html.replace(END, ''), `${html}${START}<pre style="white-space:pre-wrap">extra</pre>${END}`,
    html.replace('white-space:pre-wrap', 'white-space:normal')]) {
    assert.throws(() => normalizeMicrosoftEvent(graphRaw({ body: { contentType: 'html', content },
      singleValueExtendedProperties: properties }), 'calendar'), /review/i);
  }
});

test('Microsoft first-time replacement never removes unowned user HTML inside reserved comment pairs', async () => {
  for (const [section, expectedCode] of [
    [`${START}<div>USER NOTE &amp; original detail</div>${END}`, 'INVALID_CONTEXT_HTML_SECTION'],
    [`${START}<pre style="white-space:pre-wrap">USER NOTE &amp; original detail</pre>${END}`, 'UNPROVEN_CONTEXT_HTML_SECTION'],
  ]) {
    const original = `<html><body><p>Appointment</p>${section}<div>Protected meeting blob</div></body></html>`;
    let patches = 0;
    const { createCalendarAdapter } = loadProviders(async (_account, _url, init = {}) => {
      if (init.method) patches += 1;
      return json(graphRaw({ body: { contentType: 'html', content: original } }));
    });
    const adapter = createCalendarAdapter(account('microsoft'));
    const event = await adapter.getEvent('calendar', 'event');
    assert.ok(event.description.includes('USER NOTE'));
    await assert.rejects(adapter.updateEvent(event, write(event.description, '12:39 PM  Make coffee')),
      (error) => error.code === expectedCode);
    assert.equal(patches, 0);
    assert.equal(event.bodyHtml, original);
  }
});
