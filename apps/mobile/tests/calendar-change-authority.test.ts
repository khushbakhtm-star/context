import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarMutationTime, latestCalendarChange } from '../src/utils/calendar-change-authority';

const timestamp = '2026-10-30T12:00:00.000Z';
const instant = Date.parse(timestamp);
test('the most recent real modification wins, with a stable calendar tie', () => {
  assert.equal(latestCalendarChange({ localUpdatedAt: instant + 1, remoteUpdatedAt: timestamp }), 'context');
  assert.equal(latestCalendarChange({ localUpdatedAt: instant - 1, remoteUpdatedAt: timestamp }), 'calendar');
  assert.equal(latestCalendarChange({ localUpdatedAt: instant, remoteUpdatedAt: timestamp }), 'calendar');
});
test('a confirmed missing event is never resurrected using a fabricated read time', () => {
  assert.equal(latestCalendarChange({ localUpdatedAt: instant, remoteDeleted: true }), 'calendar');
  assert.equal(latestCalendarChange({ localUpdatedAt: null, remoteDeleted: true }), 'calendar');
  assert.equal(latestCalendarChange({ localUpdatedAt: instant + 1, remoteUpdatedAt: timestamp, remoteDeleted: true }), 'context');
});
test('versions, minute endpoints and invalid or unavailable timestamps do not order edits', () => {
  for (const value of [undefined, 'v99', '2026-10-30', 'not a date', '', 123, '2026-10-30T99:00:00Z', '2026-02-30T12:00:00Z'])
    assert.equal(calendarMutationTime(value), null);
  assert.equal(latestCalendarChange({ localUpdatedAt: instant }), 'unknown');
  assert.equal(latestCalendarChange({ localUpdatedAt: null, remoteUpdatedAt: timestamp }), 'unknown');
  assert.equal(calendarMutationTime('2026-10-30T08:00:00-04:00'), instant);
});
