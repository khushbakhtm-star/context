import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarMonthDates, calendarNavigationTarget } from '../src/utils/calendar-navigation';

test('preset navigation advances its own span and keeps a preset selection', () => {
  for (const count of [1, 3, 7] as const) {
    const next = calendarNavigationTarget({ activeDate: '2026-10-26', dayCount: count }, 1)!;
    assert.equal(next.activeDate, `2026-${count === 7 ? '11-02' : count === 3 ? '10-29' : '10-27'}`);
    assert.equal(next.selectedDates, null);
    assert.deepEqual(calendarNavigationTarget({ ...next, dayCount: count }, -1),
      { activeDate: '2026-10-26', selectedDates: null, overviewMonth: null });
  }
});

test('disjoint minute selections move by civil span while retaining their gaps and count', () => {
  const selectedDates = ['2026-10-31', '2026-11-02', '2026-11-04'];
  const next = calendarNavigationTarget({ activeDate: selectedDates[0]!, dayCount: 1, selectedDates }, 1)!;
  assert.deepEqual(next.selectedDates, ['2026-11-05', '2026-11-07', '2026-11-09']);
  assert.deepEqual(calendarNavigationTarget({ ...next, dayCount: 1 }, -1)!.selectedDates, selectedDates);
  assert.deepEqual(selectedDates, ['2026-10-31', '2026-11-02', '2026-11-04']);
  assert.deepEqual(calendarNavigationTarget({ activeDate: '2028-02-28', dayCount: 3,
    selectedDates: ['2028-02-28', '2028-03-01'] }, 1)!.selectedDates, ['2028-03-02', '2028-03-04']);
});

test('month paging uses the visible month and includes each target-month date once', () => {
  const selectedDates = Array.from({ length: 8 }, (_, index) => `2026-10-${index + 20}`);
  const next = calendarNavigationTarget({ activeDate: '2026-10-20', dayCount: 7,
    selectedDates, overviewMonth: '2026-12-01' }, 1)!;
  assert.equal(next.activeDate, '2027-01-01');
  assert.equal(next.overviewMonth, '2027-01-01');
  assert.equal(next.selectedDates!.length, 31);
  assert.equal(next.selectedDates!.at(-1), '2027-01-31');
  assert.equal(new Set(next.selectedDates).size, 31);
  assert.equal(calendarNavigationTarget({ activeDate: '2026-10-20', dayCount: 7,
    selectedDates, overviewMonth: 'invalid' }, -1)!.activeDate, '2026-09-01');
});

test('month anchors clamp safely across short months, leap years and year changes', () => {
  const common = calendarMonthDates('2026-03-31', -1)!;
  assert.equal(common.length, 28);
  assert.equal(common[0], '2026-02-01');
  assert.equal(common.at(-1), '2026-02-28');
  assert.equal(calendarMonthDates('2028-03-31', -1)!.at(-1), '2028-02-29');
  assert.equal(calendarMonthDates('2026-12-31', 1)![0], '2027-01-01');
});

test('navigation disables before any preset, custom date or month leaves supported years', () => {
  assert.equal(calendarNavigationTarget({ activeDate: '1000-01-01', dayCount: 1 }, -1), null);
  assert.equal(calendarNavigationTarget({ activeDate: '9999-12-31', dayCount: 1 }, 1), null);
  assert.equal(calendarNavigationTarget({ activeDate: '9999-12-27', dayCount: 3 }, 1), null);
  assert.equal(calendarNavigationTarget({ activeDate: '1000-01-08', dayCount: 7 }, -1), null);
  assert.equal(calendarNavigationTarget({ activeDate: '1000-01-01', dayCount: 1,
    selectedDates: ['1000-01-01', '1000-01-03'] }, -1), null);
  assert.equal(calendarNavigationTarget({ activeDate: '9999-12-29', dayCount: 1,
    selectedDates: ['9999-12-29', '9999-12-31'] }, 1), null);
  assert.equal(calendarMonthDates('1000-01-31', -1), null);
  assert.equal(calendarMonthDates('9999-12-01', 1), null);
  assert.equal(calendarNavigationTarget({ activeDate: 'not-a-date', dayCount: 1 }, 1), null);
});
