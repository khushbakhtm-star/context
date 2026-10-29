import assert from 'node:assert/strict';
import test from 'node:test';
import { minuteDetailsSpan, minuteDetailsCount, minuteDetailsLastCell, minuteDetailsTitle, minuteDetailsDate } from '../src/utils/minute-details';
import { minuteSpanCoordinates } from '../src/utils/minute-span';

test('time entry suggests next-day overnight bounds only until an explicit end date is chosen', () => {
  const input = { startDateKey: '2026-10-28', startTime: '10:30 PM', endDateKey: '2026-10-28', endTime: '7:00 AM', endDateExplicit: false };
  const span = minuteDetailsSpan(input);
  assert.deepEqual(span, { startDateKey: '2026-10-28', startMinute: 1350, endDateKey: '2026-10-29', endMinute: 421 });
  assert.equal(minuteDetailsCount(span), 511);
  assert.equal(minuteDetailsCount(minuteDetailsSpan({ ...input, startDateKey: '2026-10-27', startTime: '11am', endTime: '7am' })), 1201);
  assert.throws(() => minuteDetailsSpan({ ...input, endDateExplicit: true }), /end after/);
});

test('date/time entry handles year rollover, full-day midnight and both clock formats', () => {
  const overnight = minuteDetailsSpan({ startDateKey: '2026-12-31', startTime: '23:59', endDateKey: '2026-12-31', endTime: '00:00', endDateExplicit: false });
  assert.equal(overnight.endDateKey, '2027-01-01'); assert.equal(minuteDetailsCount(overnight), 2);
  assert.equal(minuteDetailsCount(minuteDetailsSpan({ startDateKey: '2026-10-28', startTime: '12:00 AM', endDateKey: '2026-10-28', endTime: '12:00 AM', endDateExplicit: false })), 1);
  assert.equal(minuteDetailsCount(minuteDetailsSpan({ startDateKey: '2026-10-28', startTime: '00:00', endDateKey: '2026-10-28', endTime: '23:59', endDateExplicit: true })), 1440);
  for (const time of ['24:00', '13:00 PM', 'words', '12:90']) assert.throws(() => minuteDetailsSpan({ startDateKey: '2026-10-28', startTime: time, endDateKey: '2026-10-28', endTime: '12:00', endDateExplicit: true }), /valid start/);
});

test('explicit civil dates use existing minute slots through DST and reject spans exceeding one day', () => {
  const span = minuteDetailsSpan({ startDateKey: '2026-11-01', startTime: '00:00', endDateKey: '2026-11-01', endTime: '23:59', endDateExplicit: true });
  assert.equal(minuteDetailsCount(span), 1440);
  assert.throws(() => minuteDetailsSpan({ startDateKey: '2026-10-28', startTime: '10:00', endDateKey: '2026-10-30', endTime: '10:00', endDateExplicit: true }), /24 hours/);
  assert.equal(minuteDetailsTitle('  Activity name\nminute details'), 'Activity name');
  assert.equal(minuteDetailsTitle('x'.repeat(250)).length, 200);
  assert.equal(minuteDetailsDate('2026-10-28'), '10/28/2026');
  assert.equal(minuteDetailsDate(''), 'Choose date');
});

test('Through includes the complete user-named final minute and leaves the following cell outside', () => {
  for (const [startTime, endTime, lastMinute] of [['00:00', '7:24 AM', 444], ['8:00 PM', '8:57 PM', 1257]] as const) {
    const span = minuteDetailsSpan({ startDateKey: '2026-10-29', startTime, endDateKey: '2026-10-29', endTime, endDateExplicit: true });
    assert.equal(span.endMinute, lastMinute + 1);
    assert.deepEqual(minuteDetailsLastCell(span), { dateKey: '2026-10-29', minuteIndex: lastMinute });
    const cells = minuteSpanCoordinates(span);
    assert.equal(cells.at(-1)!.minuteIndex, lastMinute);
    assert.equal(cells.some((cell) => cell.minuteIndex === lastMinute + 1), false);
  }
});

test('reopening a calendar-exclusive range as inclusive Through preserves the exact span across midnight', () => {
  for (const span of [
    { startDateKey: '2026-10-29', startMinute: 724, endDateKey: '2026-10-30', endMinute: 445 },
    { startDateKey: '2026-10-29', startMinute: 0, endDateKey: '2026-10-30', endMinute: 0 },
    { startDateKey: '2028-02-29', startMinute: 1439, endDateKey: '2028-03-01', endMinute: 1 },
  ]) {
    const last = minuteDetailsLastCell(span);
    const time = (minute: number) => `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`;
    assert.deepEqual(minuteDetailsSpan({ startDateKey: span.startDateKey, startTime: time(span.startMinute),
      endDateKey: last.dateKey, endTime: time(last.minuteIndex), endDateExplicit: true }), span);
  }
  assert.throws(() => minuteDetailsSpan({ startDateKey: '2026-02-28', startTime: '00:00', endDateKey: '2026-02-30',
    endTime: '23:59', endDateExplicit: true }), /valid minute range/);
});
