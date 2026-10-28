const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the production account worker, SQLite journal and projection writer
// through the existing isolated-phone fixture, without registering its tests.
function fixture(timers = {}) {
  const filename = path.join(__dirname, 'engine.test.cjs');
  const source = fs.readFileSync(filename, 'utf8');
  const boundary = source.indexOf('\ntest(');
  assert.ok(boundary > 0);
  const module = { exports: {} };
  vm.runInNewContext(source.slice(0, boundary) + '\nmodule.exports = { cloud, phone, prepare, day };', {
    module, require, __dirname, console, TextEncoder, TextDecoder, Response, Headers, URL,
    setTimeout, clearTimeout, ...timers,
  }, { filename });
  return module.exports;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function linked(t, timers) {
  const { cloud, phone, prepare, day } = fixture(timers);
  const remote = cloud();
  const device = phone(t, remote);
  await prepare(device);
  await device.db.saveMinuteRange({ dateKey: day, startMinute: 610,
    durationMinutes: 1, text: 'Original note', categoryId: 'work' });
  const entry = await device.db.getMinuteEntry(day, 610);
  await device.db.putSyncDocument(`category:minuteFormat:${day}:610`, {
    kind: 'minuteFormat', format: { calendarEvent: { id: entry.blockId, title: 'Work activity' } },
  });
  await device.engine.linkActualsToAccounts([day]);
  await device.engine.synchronizeAccounts();
  remote.calls.length = 0;
  return { device, remote, day };
}

test('poll, native and manual callers join one active cycle without a redundant provider pass', async (t) => {
  const { device, remote } = await linked(t);
  const reached = deferred(); const release = deferred(); let reads = 0;
  remote.onGet = async () => { reads++; reached.resolve(); await release.promise; };
  t.after(() => { release.resolve(); remote.onGet = null; });
  const first = device.engine.synchronizeAccounts();
  await reached.promise;
  const joined = Array.from({ length: 80 }, () => device.engine.synchronizeAccounts());
  assert.ok(joined.every((job) => job === first), 'all observers await the exact same worker');
  release.resolve();
  const results = await Promise.all([first, ...joined]);
  assert.equal(reads, 1, 'an unchanged source is checked once despite many observers');
  assert.equal(new Set(results.map((result) => result.cycleId)).size, 1);
  assert.ok(results.every((result) => result.cycleComplete && !result.running));
  assert.equal(remote.calls.some((call) => ['create', 'update', 'delete'].includes(call.type)), false);
});

test('a durable inline edit requests a follow-up even when account observers only join', async (t) => {
  const { device, remote, day } = await linked(t);
  const reached = deferred(); const release = deferred(); let reads = 0;
  remote.onGet = async () => { if (++reads === 1) { reached.resolve(); await release.promise; } };
  t.after(() => { release.resolve(); remote.onGet = null; });
  const first = device.engine.synchronizeAccounts();
  await reached.promise;
  const entry = await device.db.getMinuteEntry(day, 610);
  device.inline.inlineMinuteDrafts.activate({ dateKey: day, minuteIndex: 610,
    text: entry.text, categoryId: entry.categoryId, keepColor: true });
  device.sheet.editInlineMinute(day, 610, { text: 'Newest saved inline note' });
  await device.inline.flushInlineMinutes();
  await device.inline.retryInlineMinuteLinks();
  const joined = device.engine.synchronizeAccounts();
  assert.equal(joined, first);
  release.resolve();
  const result = await joined;
  assert.equal(reads, 2, 'the durable commit, rather than its observers, requests pass two');
  assert.equal(result.cycleComplete, true);
  assert.equal((await device.db.getMinuteEntry(day, 610)).text, 'Newest saved inline note');
  assert.match([...remote.events.values()][0].description, /Newest saved inline note/);
});

test('an explicit retry request retains one bounded follow-up without any new local edit', async (t) => {
  const { device, remote } = await linked(t);
  const reached = deferred(); const release = deferred(); let reads = 0;
  remote.onGet = async () => { if (++reads === 1) { reached.resolve(); await release.promise; } };
  t.after(() => { release.resolve(); remote.onGet = null; });
  const first = device.engine.synchronizeAccounts();
  await reached.promise;
  for (let count = 0; count < 80; count++) device.engine.requestAccountSynchronization();
  release.resolve();
  const result = await first;
  assert.equal(reads, 2);
  assert.equal(result.cycleComplete, true);
  assert.equal(result.outcome, 'success');
});

test('new work arriving in pass two continues later without extending the original caller', async (t) => {
  const scheduled = new Map(); let timerId = 0;
  const timers = {
    setTimeout(callback, delay) { const id = ++timerId; scheduled.set(id, { callback, delay }); return id; },
    clearTimeout(id) { scheduled.delete(id); },
  };
  const { device, remote, day } = await linked(t, timers);
  const firstReached = deferred(); const secondReached = deferred();
  const firstRelease = deferred(); const secondRelease = deferred(); let reads = 0;
  remote.onGet = async () => {
    reads++;
    if (reads === 1) { firstReached.resolve(); await firstRelease.promise; }
    if (reads === 2) { secondReached.resolve(); await secondRelease.promise; }
  };
  t.after(() => { firstRelease.resolve(); secondRelease.resolve(); remote.onGet = null; });
  const first = device.engine.synchronizeAccounts();
  await firstReached.promise;
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 610, text: 'First saved change', categoryId: 'work' });
  device.engine.requestAccountSynchronization();
  firstRelease.resolve();
  await secondReached.promise;
  await device.db.saveMinuteEntry({ dateKey: day, minuteIndex: 610, text: 'Second saved change', categoryId: 'work' });
  device.engine.requestAccountSynchronization();
  secondRelease.resolve();
  const completed = await first;
  assert.equal(reads, 2, 'one caller remains bounded to two passes');
  assert.equal(completed.cycleComplete, true);
  assert.equal(scheduled.size, 1, 'later work remains scheduled after the first cycle settles');
  const [id, later] = [...scheduled][0]; scheduled.delete(id);
  assert.equal(later.delay, 500);
  later.callback();
  const next = await device.engine.synchronizeAccounts();
  assert.equal(reads, 3);
  assert.ok(next.cycleId > completed.cycleId);
  assert.match([...remote.events.values()][0].description, /Second saved change/);
});
