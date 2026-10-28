import assert from 'node:assert/strict';
import test from 'node:test';
import { minuteDetailsSpan, minuteDetailsCount, minuteDetailsTitle, minuteDetailsDate } from '../src/utils/minute-details';

test('time entry suggests next-day overnight bounds only until an explicit end date is chosen', () => {
  const input = { startDateKey: '2026-10-28', startTime: '10:30 PM', endDateKey: '2026-10-28', endTime: '7:00 AM', endDateExplicit: false };
  const span = minuteDetailsSpan(input);
  assert.deepEqual(span, { startDateKey: '2026-10-28', startMinute: 1350, endDateKey: '2026-10-29', endMinute: 420 });
  assert.equal(minuteDetailsCount(span), 510);
  assert.equal(minuteDetailsCount(minuteDetailsSpan({ ...input, startDateKey: '2026-10-27', startTime: '11am', endTime: '7am' })), 1200);
  assert.throws(() => minuteDetailsSpan({ ...input, endDateExplicit: true }), /end after/);
});

test('date/time entry handles year rollover, full-day midnight and both clock formats', () => {
  const overnight = minuteDetailsSpan({ startDateKey: '2026-12-31', startTime: '23:59', endDateKey: '2026-12-31', endTime: '00:00', endDateExplicit: false });
  assert.equal(overnight.endDateKey, '2027-01-01'); assert.equal(minuteDetailsCount(overnight), 1);
  assert.equal(minuteDetailsCount(minuteDetailsSpan({ startDateKey: '2026-10-28', startTime: '12:00 AM', endDateKey: '2026-10-28', endTime: '12:00 AM', endDateExplicit: false })), 1440);
  for (const time of ['24:00', '13:00 PM', 'words', '12:90']) assert.throws(() => minuteDetailsSpan({ startDateKey: '2026-10-28', startTime: time, endDateKey: '2026-10-28', endTime: '12:00', endDateExplicit: true }), /valid start/);
});

test('explicit civil dates use existing minute slots through DST and reject spans exceeding one day', () => {
  const span = minuteDetailsSpan({ startDateKey: '2026-11-01', startTime: '00:00', endDateKey: '2026-11-02', endTime: '00:00', endDateExplicit: true });
  assert.equal(minuteDetailsCount(span), 1440);
  assert.throws(() => minuteDetailsSpan({ startDateKey: '2026-10-28', startTime: '10:00', endDateKey: '2026-10-30', endTime: '10:00', endDateExplicit: true }), /24 hours/);
  assert.equal(minuteDetailsTitle('  Activity name\nminute details'), 'Activity name');
  assert.equal(minuteDetailsTitle('x'.repeat(250)).length, 200);
  assert.equal(minuteDetailsDate('2026-10-28'), '10/28/2026');
  assert.equal(minuteDetailsDate(''), 'Choose date');
});
