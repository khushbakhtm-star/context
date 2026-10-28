const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
