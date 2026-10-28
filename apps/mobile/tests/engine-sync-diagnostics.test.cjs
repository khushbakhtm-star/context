const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const filename = path.join(__dirname, 'engine.test.cjs');
const source = fs.readFileSync(filename, 'utf8');
const moduleFixture = { exports: {} };
vm.runInNewContext(source.slice(0, source.indexOf('\ntest(')) + '\nmodule.exports = { cloud, phone, prepare, day };', {
  module: moduleFixture, require, __dirname, console, TextEncoder, TextDecoder, Response, Headers, URL, setTimeout, clearTimeout,
}, { filename });
const { cloud, phone, prepare, day } = moduleFixture.exports;

test('holding Sync can inspect the exact pending event read without another render or provider request', async (t) => {
  const remote = cloud(); const device = phone(t, remote); await prepare(device);
  await device.db.saveMinuteRange({ dateKey: day, startMinute: 600, durationMinutes: 1,
    text: 'Local note', categoryId: 'unaccounted' });
  const entry = await device.db.getMinuteEntry(day, 600);
  await device.db.putSyncDocument(`category:minuteFormat:${day}:600`, {
    kind: 'minuteFormat', format: { calendarEvent: { id: entry.blockId, title: 'Activity' } },
  });
  await device.engine.linkActualsToAccounts([day]);
  await device.engine.synchronizeAccounts();
  let reached;
  let release;
  const started = new Promise((resolve) => { reached = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  remote.onGet = async () => { reached(); await gate; };
  const notifications = [];
  const unsubscribe = device.engine.subscribeAccountSync((status) => notifications.push(status));
  const pending = device.engine.synchronizeAccounts();
  await started;
  const count = notifications.length;
  const network = remote.calls.length;
  const status = device.engine.getAccountSyncStatus();
  assert.equal(status.diagnostics.active.step, 'calendar-event-read');
  assert.equal(status.diagnostics.finishedAt, undefined);
  assert.equal(status.progress.total, 1);
  assert.equal(notifications.length, count, 'reading live timing does not enqueue React notifications');
  assert.equal(remote.calls.length, network, 'reading live timing does not repeat the event read');
  assert.doesNotMatch(JSON.stringify(status.diagnostics), /google:person|personal|Local note|Activity|eventId|accountId/);
  release();
  const completed = await pending;
  remote.onGet = null; unsubscribe();
  assert.equal(completed.outcome, 'success');
  assert.ok(Number.isFinite(completed.diagnostics.finishedAt));
  assert.equal(completed.diagnostics.active, null);
  assert.ok(completed.diagnostics.steps.some((step) => step.step === 'calendar-event-read' && step.calls === 1));
});
