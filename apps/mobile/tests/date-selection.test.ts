import assert from 'node:assert/strict';
import test from 'node:test';
import { dateSelectionMode, isDateKey, monthDateCells, normalizeSelectedDates, shiftCalendarMonth, toggleSelectedDate } from '../src/utils/date-selection';
import { calendarGridLayout } from '../src/utils/calendar-layout';

test('selected dates are sorted and deduplicated without rolling invalid civil dates or silently truncating', () => {
  assert.deepEqual(normalizeSelectedDates(['2026-10-26', '2026-10-25', '2026-10-26', '2026-02-29', '2026-2-01', null]),
    ['2026-10-25', '2026-10-26']);
  assert.equal(isDateKey('2028-02-29'), true);
  assert.equal(isDateKey('2026-04-31'), false);
  assert.deepEqual(normalizeSelectedDates({ date: '2026-10-26' }), []);
  const days = Array.from({ length: 31 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`);
  assert.deepEqual(normalizeSelectedDates(days), days);
});

test('individual toggles preserve exact disjoint dates and cross-month selections', () => {
  const selected = toggleSelectedDate(['2026-10-25', '2026-11-01'], '2026-10-26');
  assert.deepEqual(selected, ['2026-10-25', '2026-10-26', '2026-11-01']);
  assert.deepEqual(toggleSelectedDate(selected, '2026-10-25'), ['2026-10-26', '2026-11-01']);
  assert.deepEqual(toggleSelectedDate(selected, '2026-11-31'), selected);
});

test('the first date tap starts a fresh view and following taps add or remove exact days', () => {
  const oldView = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
  assert.deepEqual(toggleSelectedDate(oldView, '2026-10-26', true), ['2026-10-26']);
  const first = toggleSelectedDate(oldView, '2026-10-25', true);
  const second = toggleSelectedDate(first, '2026-10-26');
  assert.deepEqual(second, ['2026-10-25', '2026-10-26']);
  assert.deepEqual(toggleSelectedDate(second, '2026-10-25'), ['2026-10-26']);
  assert.deepEqual(oldView, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'],
    'a draft selection does not mutate the view that Cancel must preserve');
});

test('seven unique dates keep minute cells while an eighth switches to month overview', () => {
  const seven = Array.from({ length: 7 }, (_, index) => `2026-10-${25 + index}`);
  assert.equal(dateSelectionMode(seven), 'minutes');
  assert.equal(dateSelectionMode([...seven, seven[0], 'invalid']), 'minutes');
  assert.equal(dateSelectionMode([...seven, '2026-11-01']), 'month');
});

test('month grids span civil dates across year boundaries and leap days with stable Monday weeks', () => {
  const october = monthDateCells('2026-10-26');
  assert.equal(october.length, 42);
  assert.equal(october[0]!.dateKey, '2026-09-28');
  assert.equal(october.filter((cell) => cell.inMonth).length, 31);
  assert.equal(new Set(october.map((cell) => cell.dateKey)).size, 42);
  assert.equal(monthDateCells('2028-02-29').filter((cell) => cell.inMonth).length, 29);
  assert.equal(monthDateCells('2027-01-01')[0]!.dateKey, '2026-12-28');
  assert.deepEqual(monthDateCells('2026-02-29'), []);
  assert.equal(shiftCalendarMonth('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftCalendarMonth('2026-03-31', -1), '2026-02-01');
});

test('explicit two to seven day selections never fabricate columns when pinch zoom or an old buffer is present', () => {
  for (const count of [1, 2, 3, 4, 5, 6, 7] as const) {
    for (const zoom of [0.5, 1, 2.5]) {
      const layout = calendarGridLayout(390, count, zoom, 7, 44, true);
      assert.equal(layout.dayCount, count);
      assert.equal(layout.contentWidth, layout.railWidth + count * layout.dayWidth);
    }
  }
  assert.ok(calendarGridLayout(390, 1, 0.5, 1, 44).dayCount > 1,
    'standard preset views retain their existing pinch-to-show-more behavior');
});
