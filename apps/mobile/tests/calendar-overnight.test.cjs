const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Reuse the actual native-provider/SQLite fixture without executing its tests.
const fixture = path.join(__dirname, 'calendar-activity-move.test.cjs');
const source = fs.readFileSync(fixture, 'utf8');
const moduleObject = { exports: {} };
vm.runInNewContext(source.slice(0, source.indexOf('\ntest(')) + '\nmodule.exports = { runtime, day, plain };', {
  require: createRequire(fixture), module: moduleObject, exports: moduleObject.exports,
  __dirname, __filename: fixture, console, Date, TextEncoder, TextDecoder, setTimeout, clearTimeout,
});
const { runtime, day, plain } = moduleObject.exports;
const next = '2026-10-26';
const night = { startDateKey: day, startMinute: 1380, endDateKey: next, endMinute: 462 };
async function fill(r, span = night, blockId) {
  const input = { text: 'Sleep', event: { title: 'Sleep', categoryId: 'unaccounted', ...(blockId ? { blockId } : {}) } };
  const preview = await r.sheet.prepareMinuteSpanFill(span, input);
  await r.sheet.fillMinuteSpan(span, input, { previewToken: preview.token });
  return (await r.db.getMinuteEntry(span.startDateKey, span.startMinute)).blockId;
}
const localTime = (date, minute) => new Date(`${date}T00:00:00`).setMinutes(minute);

test('one overnight border exports one exact native event and canonical binding from either day, retaining all minute annotations', async (t) => {
  const r = runtime(t); await r.db.initializeDatabase(); const blockId = await fill(r);
  await r.calendar.syncActualDay(next, 'personal');
  await r.calendar.syncActualDay(day, 'personal');
  assert.equal(r.events.size, 1);
  assert.equal(r.calls.filter((call) => call.type === 'create').length, 1);
  assert.equal(r.calls.filter((call) => call.type === 'update').length, 0, 'second day acknowledges the same complete span');
  const binding = (await r.db.getSyncBindingsForBlock(blockId))[0];
  assert.equal(binding.segmentKey, `${day}:${blockId}:1380-1901`);
  assert.equal(binding.dateKey, day); assert.equal((await r.db.getSyncBindings(next)).length, 0);
  const event = r.events.get(binding.eventId);
  assert.equal(new Date(event.startDate).getTime(), localTime(day, 1380));
  assert.equal(new Date(event.endDate).getTime(), localTime(next, 462));
  assert.equal(event.title, 'Sleep'); assert.equal(event.notes, '11:00 PM  Sleep');
  await r.db.saveMinuteEntry({ dateKey: next, minuteIndex: 30, text: 'Woke briefly', categoryId: 'unaccounted' });
  await r.calendar.syncActualDay(next, 'personal');
  assert.equal(r.events.size, 1); assert.match(r.events.get(binding.eventId).notes, /12:30 AM  Woke briefly/);
  assert.equal((await r.db.getSyncBindingsForBlock(blockId))[0].eventId, binding.eventId);
});

test('an explicit overnight resize moves the same source ID far from its old anchor and preserves location and private detached notes', async (t) => {
  const r = runtime(t); await r.db.initializeDatabase(); const blockId = await fill(r);
  await r.calendar.syncActualDay(day, 'personal'); const id = [...r.events.keys()][0];
  r.events.get(id).location = 'Original source location';
  const moved = { startDateKey: '2026-11-05', startMinute: 1410, endDateKey: '2026-11-06', endMinute: 310 };
  await fill(r, moved, blockId);
  const cleanup = await r.calendar.syncActualDay(day, 'personal'); assert.equal(cleanup.removed, 0);
  await r.calendar.syncActualDay(moved.endDateKey, 'personal');
  assert.deepEqual([...r.events.keys()], [id]); assert.equal(r.events.get(id).location, 'Original source location');
  assert.equal(new Date(r.events.get(id).startDate).getTime(), localTime(moved.startDateKey, 1410));
  assert.equal(new Date(r.events.get(id).endDate).getTime(), localTime(moved.endDateKey, 310));
  assert.equal((await r.db.getSyncBindingsForBlock(blockId))[0].dateKey, moved.startDateKey);
  const detached = await r.db.getMinuteEntry(day, 1380);
  assert.equal(detached.text, 'Sleep'); assert.notEqual(detached.blockId, blockId);
  assert.equal(r.calls.filter((call) => call.type === 'create').length, 1);
  assert.equal(r.calls.filter((call) => call.type === 'delete').length, 0);
});

test('an exact linked source can move across midnight and clear its description without copying its title into notes or retaining old fill', async (t) => {
  const r = runtime(t); await r.db.initializeDatabase(); const blockId = await fill(r);
  await r.calendar.syncActualDay(day, 'personal'); const id = [...r.events.keys()][0];
  const event = r.events.get(id); event.title = 'Rest after travel'; event.notes = ''; event.location = 'Kept source location';
  event.startDate = new Date(localTime('2026-11-04', 1438)).toISOString();
  event.endDate = new Date(localTime('2026-11-05', 63)).toISOString();
  const calendars = [{ id: 'personal', title: 'Personal', color: '#2952A3', allowsModifications: true, sourceName: 'Device' }];
  const read = await r.calendar.loadPlannedEventsResult(['personal'], day, calendars); r.calls.length = 0;
  const changed = await r.calendar.reconcileLinkedNativeColors(day, read.plans, calendars);
  assert.ok(changed.includes(day) && changed.includes(next) && changed.includes('2026-11-04') && changed.includes('2026-11-05'));
  const members = await r.db.getEntriesForBlock(blockId); assert.equal(members.length, 65);
  assert.equal(members[0].dateKey, '2026-11-04'); assert.equal(members[0].minuteIndex, 1438);
  assert.equal(members.at(-1).dateKey, '2026-11-05'); assert.equal(members.at(-1).minuteIndex, 62);
  assert.ok(members.every((entry) => entry.text === ''));
  assert.equal(await r.db.getActivityTitleForEntries(members), 'Rest after travel');
  const old = (await r.db.getSpreadsheetCells({ dateKey: next, startMinute: 0, endMinute: 0 }))[0];
  assert.equal(old.entry, null); assert.equal(JSON.stringify(old.format), '{}');
  assert.equal(r.events.get(id).location, 'Kept source location'); assert.equal(r.calls.length, 0, 'import is read-only to the provider');
  assert.equal((await r.db.getSyncBindingsForBlock(blockId))[0].segmentKey, `2026-11-04:${blockId}:1438-1502`);
});

test('resetting both days deletes only the exact original overnight event and preserves unrelated private notes', async (t) => {
  const r = runtime(t); await r.db.initializeDatabase(); const blockId = await fill(r);
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 700, text: 'Unrelated private note', categoryId: 'unaccounted' });
  await r.calendar.syncActualDay(day, 'personal'); const id = [...r.events.keys()][0];
  await r.sheet.resetMinuteCells({ dateKey: day, startMinute: 1380, endMinute: 1439 });
  await r.calendar.syncActualDay(day, 'personal'); await r.calendar.syncActualDay(next, 'personal');
  assert.deepEqual([...r.events.keys()], [id]);
  await r.sheet.resetMinuteCells({ dateKey: next, startMinute: 0, endMinute: 461 });
  await r.calendar.syncActualDay(next, 'personal'); await r.calendar.syncActualDay(day, 'personal');
  assert.equal(r.events.size, 0); assert.equal((await r.db.getSyncBindingsForBlock(blockId)).length, 0);
  assert.equal(await r.db.getMinuteEntry(day, 1380), null);
  assert.equal(await r.db.getMinuteEntry(next, 0), null);
  assert.equal((await r.db.getMinuteEntry(day, 700)).text, 'Unrelated private note');
  assert.equal(JSON.stringify(r.calls.filter((call) => call.type === 'delete')), JSON.stringify([{ type: 'delete', id }]));
  assert.equal(r.calls.filter((call) => call.type === 'create').length, 1);
});

test('native source rekey accepts only a complete ordinary block with exact contiguous calendarEvent labels inside SQLite', async (t) => {
  const r = runtime(t); await r.db.initializeDatabase();
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text: 'Original', categoryId: 'unaccounted' });
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 101, text: 'Second annotation', categoryId: 'unaccounted' });
  const blockId = (await r.db.getMinuteEntry(day, 100)).blockId;
  const members = await r.db.getEntriesForBlock(blockId);
  const binding = { segmentKey: `${day}:${blockId}:100-101`, blockId, dateKey: day, calendarId: 'personal', eventId: 'exact-source' };
  await r.db.saveSyncBinding(binding); const before = (await r.db.getSyncBindingsForBlock(blockId))[0];
  const after = { ...binding, segmentKey: `${day}:${blockId}:102-103` };
  await assert.rejects(r.db.remapActivitySyncBindings(blockId, [{ before, after }], members), /border/);
  await r.db.putSyncDocument(`category:minuteFormat:${day}:100`, { kind: 'minuteFormat', format: { calendarEvent: { id: blockId, title: 'Source title' } } });
  await r.db.putSyncDocument(`category:minuteFormat:${day}:101`, { kind: 'minuteFormat', format: { calendarEvent: { id: blockId, title: 'Changed title' } } });
  await assert.rejects(r.db.remapActivitySyncBindings(blockId, [{ before, after }], members), /border changed/);
  await r.db.putSyncDocument(`category:minuteFormat:${day}:101`, { kind: 'minuteFormat', format: { calendarEvent: { id: blockId, title: 'Source title' } } });
  await assert.rejects(r.db.remapActivitySyncBindings(blockId, [{ before, after }], members.slice(0, 1)), /activity changed/);
  await r.db.remapActivitySyncBindings(blockId, [{ before, after }], members);
  assert.equal((await r.db.getSyncBindingsForBlock(blockId))[0].segmentKey, after.segmentKey);
});

test('a sole ordinary source border can resize overnight without replacing its provider identity', async (t) => {
  const r = runtime(t); await r.db.initializeDatabase();
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 100, text: 'Source annotation', categoryId: 'unaccounted' });
  const blockId = (await r.db.getMinuteEntry(day, 100)).blockId;
  await r.db.putSyncDocument(`category:minuteFormat:${day}:100`, { kind: 'minuteFormat', format: { calendarEvent: { id: blockId, title: 'Original source' } } });
  await r.calendar.syncActualDay(day, 'personal'); const id = [...r.events.keys()][0]; r.events.get(id).location = 'Exact location';
  await fill(r, night, blockId);
  await r.calendar.syncActualDay(next, 'personal');
  assert.deepEqual([...r.events.keys()], [id]); assert.equal(r.events.get(id).location, 'Exact location');
  assert.equal((await r.db.getSyncBindingsForBlock(blockId))[0].segmentKey, `${day}:${blockId}:1380-1901`);
  assert.equal(r.calls.filter((call) => call.type === 'create').length, 1);
  assert.equal(r.calls.filter((call) => call.type === 'delete').length, 0);
});

test('multiple old native bindings cannot be combined into an overnight source by matching their title or time', async (t) => {
  const r = runtime(t); await r.db.initializeDatabase(); const blockId = await fill(r);
  await r.calendar.syncActualDay(day, 'personal'); const original = [...r.events.values()][0];
  r.events.set('second-source', { ...original, id: 'second-source' });
  await r.db.saveSyncBinding({ segmentKey: `${next}:${blockId}:0-461`, blockId, dateKey: next, calendarId: 'personal', eventId: 'second-source' });
  r.calls.length = 0;
  await assert.rejects(r.calendar.syncActualDay(next, 'personal'), /multiple calendar links/);
  await assert.rejects(r.calendar.syncActualDay(next, 'personal', () => true, { existingBindingsOnly: true }), /multiple calendar links/);
  assert.equal(r.calls.length, 0); assert.equal(r.events.size, 2);
  assert.equal((await r.db.getSyncBindingsForBlock(blockId)).length, 2);
});

test('an overnight remote import checks raw drafts on every destination day before changing any old member or binding', async (t) => {
  const options = {}; const r = runtime(t, options); await r.db.initializeDatabase(); const blockId = await fill(r);
  await r.calendar.syncActualDay(day, 'personal'); const id = [...r.events.keys()][0];
  const before = JSON.stringify(await r.db.getEntriesForBlock(blockId));
  const binding = JSON.stringify(await r.db.getSyncBindingsForBlock(blockId));
  const event = r.events.get(id); event.notes = ''; event.startDate = new Date(localTime('2026-11-04', 1438)).toISOString();
  event.endDate = new Date(localTime('2026-11-05', 3)).toISOString();
  const calendars = [{ id: 'personal', title: 'Personal', color: '#2952A3', allowsModifications: true, sourceName: 'Device' }];
  const read = await r.calendar.loadPlannedEventsResult(['personal'], day, calendars);
  let guarded = false;
  options.colorGuard = (entries) => {
    if (entries.some((entry) => entry.dateKey === '2026-11-05' && entry.minuteIndex === 0)) {
      guarded = true; throw Error('Synthetic destination raw draft changed');
    }
  };
  r.calls.length = 0;
  await assert.rejects(r.calendar.reconcileLinkedNativeColors(day, read.plans, calendars),
    (error) => error.name === 'NativeCalendarReconciliationError' && error.failures.some((failure) => failure.blockId === blockId));
  assert.equal(guarded, true); assert.equal(JSON.stringify(await r.db.getEntriesForBlock(blockId)), before);
  assert.equal(JSON.stringify(await r.db.getSyncBindingsForBlock(blockId)), binding); assert.equal(r.calls.length, 0);
  assert.equal(await r.db.getMinuteEntry('2026-11-05', 0), null);
});

test('an ambiguous moved native block is excluded before binding rekey while unrelated valid events can still publish', async (t) => {
  const r = runtime(t); await r.db.initializeDatabase();
  const blockId = await fill(r, { startDateKey: day, startMinute: 100, endDateKey: day, endMinute: 101 });
  await r.calendar.syncActualDay(day, 'personal'); const id = [...r.events.keys()][0];
  const before = JSON.stringify(await r.db.getSyncBindingsForBlock(blockId));
  const sourceStart = r.events.get(id).startDate;
  await fill(r, { startDateKey: day, startMinute: 200, endDateKey: day, endMinute: 201 }, blockId);
  await r.db.saveMinuteEntry({ dateKey: day, minuteIndex: 205, text: 'Separate member', categoryId: 'unaccounted' });
  r.sqlite.prepare('UPDATE minute_entries SET block_id = ? WHERE date_key = ? AND minute_index = ?').run(blockId, day, 205);
  await r.db.putSyncDocument(`category:minuteFormat:${day}:205`, { kind: 'minuteFormat', format: { activityGroup: { id: blockId, title: 'Sleep' } } });
  await fill(r, { startDateKey: day, startMinute: 300, endDateKey: day, endMinute: 301 });
  let remaps = 0; const originalRemap = r.db.remapActivitySyncBindings;
  r.db.remapActivitySyncBindings = (...args) => { remaps++; return originalRemap(...args); };
  r.calls.length = 0;
  const result = await r.calendar.flushPendingActuals('personal', [day]);
  assert.equal(result.failed, 1); assert.equal(remaps, 0);
  assert.equal(JSON.stringify(await r.db.getSyncBindingsForBlock(blockId)), before);
  assert.equal(r.events.get(id).startDate, sourceStart);
  assert.equal(r.calls.filter((call) => call.id === id).length, 0);
  assert.equal(r.calls.filter((call) => call.type === 'create').length, 1);
  assert.equal(r.events.size, 2);
});

test('resetting only the complete overnight end day shrinks the exact start-day event even when only that day is processed', async (t) => {
  const r = runtime(t); await r.db.initializeDatabase(); const blockId = await fill(r);
  await r.calendar.syncActualDay(day, 'personal'); const id = [...r.events.keys()][0];
  await r.sheet.resetMinuteCells({ dateKey: next, startMinute: 0, endMinute: 461 });
  const calendars = [{ id: 'personal', title: 'Personal', color: '#2952A3', allowsModifications: true, sourceName: 'Device' }];
  const read = await r.calendar.loadPlannedEventsResult(['personal'], next, calendars);
  await r.calendar.reconcileLinkedNativeColors(next, read.plans, calendars);
  assert.equal(await r.db.getMinuteEntry(next, 0), null, 'an unchanged source must not restore an explicit local reset');
  r.calls.length = 0;
  const result = await r.calendar.syncActualDay(next, 'personal');
  assert.equal(result.updated, 1); assert.equal(result.created, 0); assert.equal(result.removed, 0);
  assert.deepEqual([...r.events.keys()], [id]);
  assert.equal(new Date(r.events.get(id).startDate).getTime(), localTime(day, 1380));
  assert.equal(new Date(r.events.get(id).endDate).getTime(), localTime(next, 0));
  assert.equal((await r.db.getSyncBindingsForBlock(blockId))[0].segmentKey, `${day}:${blockId}:1380-1439`);
  assert.equal(r.calls.length, 1); assert.equal(r.calls[0].type, 'update');
});
