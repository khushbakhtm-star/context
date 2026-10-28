const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.join(__dirname, 'calendar-activity-move.test.cjs');
const source = fs.readFileSync(file, 'utf8');
const moduleFixture = { exports: {} };
vm.runInNewContext(source.slice(0, source.indexOf('\ntest(')) + '\nmodule.exports = { runtime, oneMinute, nativeColorPlans, day };', {
  module: moduleFixture, require, __dirname, console, TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout,
}, { filename: file });
const { runtime, oneMinute, nativeColorPlans, day } = moduleFixture.exports;

test('actual guarded native content/color writes expose only successful local acknowledgements', async (t) => {
  const r = runtime(t); await oneMinute(r);
  await r.calendar.syncActualDay(day, 'personal');
  assert.equal(r.calendar.getNativeCalendarSyncDiagnostics().content.acknowledged, 1);
  const read = await nativeColorPlans(r, '#2952A3');
  await r.calendar.reconcileLinkedNativeColors(day, read.plans, [read.calendar]);
  await r.sheet.colorMinuteRange({ dateKey: day, startMinute: 100, endMinute: 100 }, 'work');
  await r.calendar.syncActualDay(day, 'personal');
  const before = r.calendar.getNativeCalendarSyncDiagnostics();
  assert.equal(before.color.acknowledged, r.colorCalls.length); assert.ok(before.color.acknowledged > 0);
  assert.equal(before.content.acknowledged, r.calls.filter((call) => ['create', 'update', 'delete'].includes(call.type)).length);
  const entry = await r.db.getMinuteEntry(day, 100);
  await r.db.saveMinuteEntry({ ...entry, text: 'Newest private minute note' });
  r.failUpdate = [...r.events.keys()][0];
  await assert.rejects(r.calendar.syncActualDay(day, 'personal'), /Provider temporarily unavailable/);
  assert.equal(r.calendar.getNativeCalendarSyncDiagnostics().content.acknowledged, before.content.acknowledged);
  const serialized = JSON.stringify(r.calendar.getNativeCalendarSyncDiagnostics());
  assert.equal(/Newest|minute note|event-|personal|title|notes|calendarId|eventId/.test(serialized), false);
});
