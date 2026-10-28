import test from 'node:test';
import assert from 'node:assert/strict';
import { minuteSpanCoordinates, minuteSpanRanges } from '../src/utils/minute-span';

test('overnight civil selection joins yesterday and today with an exclusive calendar end', () => {
  const span = { startDateKey: '2026-10-28', startMinute: 23 * 60, endDateKey: '2026-10-29', endMinute: 7 * 60 };
  assert.deepEqual(minuteSpanRanges(span), [
    { dateKey: '2026-10-28', startMinute: 1380, endMinute: 1439 },
    { dateKey: '2026-10-29', startMinute: 0, endMinute: 419 },
  ]);
  const cells = minuteSpanCoordinates(span);
  assert.equal(cells.length, 480); assert.deepEqual(cells.at(-1), { dateKey: '2026-10-29', minuteIndex: 419 });
  assert.equal(new Set(cells.map((cell) => `${cell.dateKey}:${cell.minuteIndex}`)).size, cells.length);
});

test('ending at midnight does not create an extra cell on the next day', () => {
  assert.deepEqual(minuteSpanRanges({ startDateKey: '2026-10-31', startMinute: 1260,
    endDateKey: '2026-11-01', endMinute: 0 }), [{ dateKey: '2026-10-31', startMinute: 1260, endMinute: 1439 }]);
});

test('the service rejects an earlier same-date end instead of guessing a date', () => {
  for (const endMinute of [0, 1380]) assert.throws(() => minuteSpanRanges({ startDateKey: '2026-10-28',
    startMinute: 1380, endDateKey: '2026-10-28', endMinute }), /end after the start/);
});

test('one full civil day is allowed and oversized or invalid spans are rejected', () => {
  assert.equal(minuteSpanCoordinates({ startDateKey: '2026-10-28', startMinute: 700,
    endDateKey: '2026-10-29', endMinute: 700 }).length, 1440);
  for (const patch of [{ endMinute: 701 }, { endDateKey: '2026-10-30' }, { startMinute: -1 },
    { endMinute: 1440 }, { startDateKey: '2026-02-30' }, { startDateKey: '0999-12-31' }]) {
    assert.throws(() => minuteSpanRanges({ startDateKey: '2026-10-28', startMinute: 700,
      endDateKey: '2026-10-29', endMinute: 700, ...patch }));
  }
});

test('month and leap-day boundaries use the correct civil dates', () => {
  assert.deepEqual(minuteSpanCoordinates({ startDateKey: '2028-02-29', startMinute: 1439,
    endDateKey: '2028-03-01', endMinute: 1 }), [
    { dateKey: '2028-02-29', minuteIndex: 1439 }, { dateKey: '2028-03-01', minuteIndex: 0 },
  ]);
});

test('clock offset transitions do not silently add or remove civil ledger cells', () => {
  for (const [startDateKey, endDateKey] of [['2026-10-31', '2026-11-01'], ['2026-03-07', '2026-03-08']] as const) {
    assert.equal(minuteSpanCoordinates({ startDateKey, startMinute: 22 * 60, endDateKey, endMinute: 7 * 60 }).length, 540);
  }
});
