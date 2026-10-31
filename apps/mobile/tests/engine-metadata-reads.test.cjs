const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the production engine and SQLite repository with the same isolated
// native/transport fixture as the existing end-to-end reconciliation tests.
const fixture = fs.readFileSync(path.join(__dirname, 'engine.test.cjs'), 'utf8');
const prefix = fixture.slice(0, fixture.indexOf("test('account plan display"));
const context = { require, __dirname, console, module: { exports: {} },
  TextEncoder, TextDecoder, Response, Headers, URL, setTimeout, clearTimeout };
vm.runInNewContext(prefix + '\nmodule.exports = { cloud, phone, prepare, account, day };', context);
const { cloud, phone, prepare, account, day } = context.module.exports;

async function activities(t, options = {}) {
  const remote = cloud();
  const device = phone(t, remote, account(options.grants));
  await prepare(device);
  for (let index = 0; index < 4; index++) {
    const minute = 500 + index * 10;
    await device.db.saveMinuteRange({ dateKey: day, startMinute: minute, durationMinutes: 1,
      text: `Activity ${index}`, categoryId: 'unaccounted' });
    const entry = await device.db.getMinuteEntry(day, minute);
    await device.db.putSyncDocument(`category:minuteFormat:${day}:${minute}`, {
      kind: 'minuteFormat', format: { calendarEvent: { id: entry.blockId, title: `Activity ${index}` } },
    });
  }
  await device.engine.linkActualsToAccounts([day]);
  return { remote, device };
}

test('a sync shares inherited calendar colors but rereads every event and refreshes metadata next cycle', async (t) => {
  const { remote, device } = await activities(t);
  let lists = 0;
  let color = '#123456';
  remote.adapter.listCalendars = async () => { lists++; return [{ id: 'personal', providedColor: color }]; };
  await device.engine.synchronizeAccounts();
  assert.equal(lists, 1, 'one color metadata read covers all four successful writes');
  const before = remote.calls.filter((call) => call.type === 'get').length;
  color = '#654321';
  await device.engine.synchronizeAccounts();
  assert.equal(lists, 2, 'the next cycle fetches current calendar metadata');
  assert.equal(remote.calls.filter((call) => call.type === 'get').length - before, 4,
    'sharing colors does not bypass fresh source-event reads');
});

test('a failed inherited-color read is evicted so another event can retry in the same pass', async (t) => {
  const { remote, device } = await activities(t);
  let lists = 0;
  remote.adapter.listCalendars = async () => {
    if (++lists === 1) throw Error('Transient metadata failure');
    return [{ id: 'personal', providedColor: '#123456' }];
  };
  await device.engine.synchronizeAccounts();
  assert.equal(lists, 2, 'later events retry once and then share the successful read');
  assert.equal(remote.calls.filter((call) => call.type === 'create').length, 4);
});

test('metadata scope changes when account permissions change during a pass', async (t) => {
  const { remote, device } = await activities(t);
  let lists = 0;
  remote.adapter.listCalendars = async () => {
    lists++;
    device.accounts[0].consent.categoryRead = true;
    return [{ id: 'personal', providedColor: '#123456' }];
  };
  await device.engine.synchronizeAccounts();
  assert.equal(lists, 2, 'a different consent snapshot cannot reuse the earlier read');
});

test('unchanged activity reconciliation rereads exact owners without per-activity full projection collections', async (t) => {
  const { remote, device } = await activities(t);
  await device.engine.synchronizeAccounts();
  const projections = await device.engine.listProjections();
  const read = device.db.getSyncDocuments;
  const exact = new Map(); let remoteStarted = false; let collectionsAfterFirstEvent = 0;
  device.db.getSyncDocuments = async (prefix, ...args) => {
    if (prefix === 'projection:' && remoteStarted) collectionsAfterFirstEvent++;
    else if (prefix.startsWith('projection:') && prefix !== 'projection:') exact.set(prefix, (exact.get(prefix) ?? 0) + 1);
    return read(prefix, ...args);
  };
  remote.onGet = () => { remoteStarted = true; };
  remote.calls.length = 0;
  try {
    const result = await device.engine.synchronizeAccounts();
    assert.equal(result.outcome, 'success');
    assert.equal(remote.calls.filter((call) => call.type === 'get').length, projections.length,
      'fresh provider versions are still read for every live activity');
    for (const projection of projections) assert.equal(exact.get(`projection:${projection.id}`), 3,
      'each activity has independent fresh owner, color-CAS and final owner checks');
    assert.equal(collectionsAfterFirstEvent, 1, 'only the final aggregate conflict count reads the collection');
    assert.equal(remote.calls.filter((call) => ['create', 'update', 'delete'].includes(call.type)).length, 0);
  } finally { device.db.getSyncDocuments = read; remote.onGet = null; }
});

test('retired projections remain in history without entering activity ranking or network reconciliation', async (t) => {
  const { remote, device } = await activities(t);
  await device.engine.synchronizeAccounts();
  const live = await device.engine.listProjections();
  const retired = [0, 1].map((index) => ({ ...live[index], id: `retired_history_${index}`,
    blockId: `retired_block_${index}`, eventId: `retired_event_${index}`, state: 'deleted' }));
  for (const projection of retired) await device.db.putSyncDocument(`projection:${projection.id}`, projection);
  const readIntent = device.db.getActivityEditIntent; const checkedBlocks = [];
  device.db.getActivityEditIntent = async (blockId) => { checkedBlocks.push(blockId); return readIntent(blockId); };
  remote.calls.length = 0;
  try {
    const result = await device.engine.synchronizeAccounts();
    assert.equal(result.outcome, 'success');
    assert.equal(result.diagnostics.steps.find((row) => row.step === 'calendar-activity').calls, live.length);
    assert.ok(retired.every((projection) => !checkedBlocks.includes(projection.blockId)),
      'the priority scan does not load a retired activity segment');
    assert.equal(remote.calls.filter((call) => call.type === 'get').length, live.length);
    assert.ok(remote.calls.every((call) => !retired.some((projection) => projection.eventId === call.id)));
    const history = await device.engine.listProjections();
    for (const projection of retired) assert.deepEqual(JSON.parse(JSON.stringify(history.find((item) => item.id === projection.id))),
      JSON.parse(JSON.stringify(projection)));
  } finally { device.db.getActivityEditIntent = readIntent; }
});

test('the production exact-owner reader rejects malformed or mismatched identities and never adopts a prefix neighbor', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/sync/engine.ts'), 'utf8');
  const parsed = ts.createSourceFile('engine.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const helpers = parsed.statements.filter((node) => ['projectionIsValid', 'getProjection'].includes(node.name?.text));
  assert.equal(helpers.length, 2);
  const valid = { id: 'owner', accountId: 'google:person', calendarId: 'personal', blockId: 'activity_owner',
    dateKey: day, startMinute: 500, endMinute: 501, state: 'synced' };
  const module = { exports: {} }; const requested = []; let documents = [];
  vm.runInNewContext(ts.transpileModule(helpers.map((node) => node.getText(parsed)).join('\n') +
    '\nexport { getProjection };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module, exports: module.exports, getSyncDocuments: async (key) => { requested.push(key); return structuredClone(documents); } });
  const read = () => module.exports.getProjection('owner');
  assert.equal(await read(), null);
  documents = [{ key: 'projection:owner_extra', value: { ...valid, id: 'owner_extra' } }];
  assert.equal(await read(), null);
  documents = [{ key: 'projection:owner', value: null }]; assert.equal(await read(), null);
  for (const value of [{ ...valid, id: 'different_owner' }, { ...valid, accountId: 42 }, { ...valid, state: 'invalid' }]) {
    documents = [{ key: 'projection:owner', value }];
    await assert.rejects(read(), /synchronized calendar link is invalid/);
  }
  documents = [{ key: 'projection:owner', value: valid }];
  assert.equal((await read()).state, 'synced');
  documents[0].value.state = 'pending';
  assert.equal((await read()).state, 'pending', 'a later read must not reuse an earlier owner snapshot');
  assert.ok(requested.every((key) => key === 'projection:owner'));
});
