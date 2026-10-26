import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarViewDates, calendarViewKind, calendarViewModePageTarget, calendarYearMonths } from '../src/utils/calendar-view-mode';
import { monthAgendaItems } from '../src/utils/month-agenda';
import { localDateAtMinute } from '../src/utils/time';
import type { ActivitySegment, PlannedEvent } from '../src/types';

test('view presets retain the one-minute ledger while Week selects seven Monday-first civil days', () => {
  assert.deepEqual(calendarViewDates('day', '2026-10-29'), ['2026-10-29']);
  assert.deepEqual(calendarViewDates('three-days', '2026-10-30'), ['2026-10-30', '2026-10-31', '2026-11-01']);
  assert.deepEqual(calendarViewDates('week', '2026-11-01'),
    ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  assert.equal(calendarViewKind('week'), 'minutes');
  assert.equal(calendarViewKind('month'), 'month');
  assert.equal(calendarViewKind('year'), 'year');
  assert.equal(calendarViewKind('schedule'), 'schedule');
});

test('Month and Schedule cover only the anchor civil month, including leap days without adjacent-month padding', () => {
  for (const mode of ['month', 'schedule'] as const) {
    const leap = calendarViewDates(mode, '2028-02-29');
    assert.equal(leap[0], '2028-02-01'); assert.equal(leap.at(-1), '2028-02-29');
    assert.equal(leap.length, 29); assert.equal(new Set(leap).size, 29);
    assert.equal(calendarViewDates(mode, '2026-02-28').length, 28);
    assert.equal(calendarViewDates(mode, '2026-12-31').at(-1), '2026-12-31');
  }
});

test('Year supplies twelve month anchors and exactly one full civil year', () => {
  const months = calendarYearMonths('2028-02-29');
  assert.equal(months.length, 12); assert.equal(months[0], '2028-01-01'); assert.equal(months.at(-1), '2028-12-01');
  const leap = calendarViewDates('year', '2028-02-29');
  assert.equal(leap.length, 366); assert.equal(new Set(leap).size, 366);
  assert.equal(leap[0], '2028-01-01'); assert.equal(leap.at(-1), '2028-12-31');
  assert.equal(leap.filter((day) => day === '2028-02-29').length, 1);
  assert.equal(calendarViewDates('year', '2026-10-26').length, 365);
});

test('explicit dates stay exact, sorted and disjoint, with at most seven minute columns before month overview', () => {
  const exact = ['2026-11-03', '2026-10-26', '2026-11-03', '2026-10-29'];
  for (const mode of ['day', 'week', 'month', 'year', 'schedule'] as const) {
    assert.deepEqual(calendarViewDates(mode, '2026-10-26', exact), ['2026-10-26', '2026-10-29', '2026-11-03']);
    assert.equal(calendarViewKind(mode, exact), 'minutes');
  }
  const seven = ['2026-10-01', '2026-10-03', '2026-10-08', '2026-10-11', '2026-10-22', '2026-10-25', '2026-10-31'];
  assert.equal(calendarViewKind('year', seven), 'minutes');
  assert.equal(calendarViewKind('day', [...seven, '2026-11-03']), 'month');
  assert.deepEqual(calendarViewDates('month', '2026-10-26', [...seven, '2026-11-03']), [...seven, '2026-11-03']);
  assert.deepEqual(exact, ['2026-11-03', '2026-10-26', '2026-11-03', '2026-10-29']);
});

test('Month and Schedule arrows page civil months safely from a late-month anchor', () => {
  for (const mode of ['month', 'schedule'] as const) {
    const previous = calendarViewModePageTarget({ mode, activeDate: '2028-03-31' }, -1)!;
    assert.deepEqual(previous, { activeDate: '2028-02-01', selectedDates: null, overviewMonth: '2028-02-01' });
    assert.equal(calendarViewDates(mode, previous.activeDate).at(-1), '2028-02-29');
    const next = calendarViewModePageTarget({ mode, activeDate: '2026-12-31' }, 1)!;
    assert.equal(next.activeDate, '2027-01-01'); assert.equal(next.selectedDates, null);
    assert.equal(calendarViewModePageTarget({ mode, activeDate: '2026-10-31', overviewMonth: '2026-12-01' }, 1)!.activeDate,
      '2027-01-01');
  }
});

test('Year arrows page whole civil years without rolling February into March', () => {
  const next = calendarViewModePageTarget({ mode: 'year', activeDate: '2028-02-29' }, 1)!;
  assert.deepEqual(next, { activeDate: '2029-01-01', selectedDates: null, overviewMonth: null });
  assert.equal(calendarViewModePageTarget({ ...next, mode: 'year' }, -1)!.activeDate, '2028-01-01');
});

test('custom date paging keeps the old exact-gap rules independently of preset mode', () => {
  const selectedDates = ['2026-10-31', '2026-11-02', '2026-11-04'];
  const next = calendarViewModePageTarget({ mode: 'day', activeDate: selectedDates[0]!, selectedDates }, 1)!;
  assert.deepEqual(next.selectedDates, ['2026-11-05', '2026-11-07', '2026-11-09']);
  assert.deepEqual(calendarViewModePageTarget({ ...next, mode: 'day' }, -1)!.selectedDates, selectedDates);
  const overview = calendarViewModePageTarget({ mode: 'month', activeDate: '2026-10-25',
    selectedDates: calendarViewDates('month', '2026-10-25').slice(0, 8), overviewMonth: '2026-11-01' }, 1)!;
  assert.equal(overview.activeDate, '2026-12-01');
  assert.equal(overview.selectedDates!.length, 31);
});

test('preset arrows advance Day, three days and Week by their own civil span', () => {
  const start = '2026-10-26';
  assert.equal(calendarViewModePageTarget({ mode: 'day', activeDate: start }, 1)!.activeDate, '2026-10-27');
  assert.equal(calendarViewModePageTarget({ mode: 'three-days', activeDate: start }, 1)!.activeDate, '2026-10-29');
  const week = calendarViewModePageTarget({ mode: 'week', activeDate: start }, 1)!;
  assert.equal(week.activeDate, '2026-11-02');
  assert.equal(calendarViewModePageTarget({ ...week, mode: 'week' }, -1)!.activeDate, start);
});

test('unsupported dates and boundary-year arrows never create invalid preset ranges', () => {
  for (const mode of ['day', 'week', 'month', 'year', 'schedule'] as const) {
    assert.deepEqual(calendarViewDates(mode, '2026-02-29'), []);
    assert.equal(calendarViewModePageTarget({ mode, activeDate: 'invalid' }, 1), null);
    assert.equal(calendarViewModePageTarget({ mode, activeDate: '1000-01-01' }, -1), null);
    assert.equal(calendarViewModePageTarget({ mode, activeDate: '9999-12-31' }, 1), null);
  }
  assert.deepEqual(calendarYearMonths('invalid'), []);
});

test('civil month dates include DST-transition days once even when their real duration is 23 or 25 hours', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const spring = calendarViewDates('schedule', '2026-03-08');
    const autumn = calendarViewDates('schedule', '2026-11-01');
    assert.equal(spring.length, 31); assert.equal(spring.filter((day) => day === '2026-03-08').length, 1);
    assert.equal(autumn.length, 30); assert.equal(autumn.filter((day) => day === '2026-11-01').length, 1);
    assert.equal((localDateAtMinute('2026-03-09', 0).getTime() - localDateAtMinute('2026-03-08', 0).getTime()) / 3_600_000, 23);
    assert.equal((localDateAtMinute('2026-11-02', 0).getTime() - localDateAtMinute('2026-11-01', 0).getTime()) / 3_600_000, 25);
    assert.deepEqual(calendarViewDates('week', '2026-11-01'),
      ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('Schedule shares actual-over-plan overlays and excludes next-day midnight on both DST boundary dates', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    for (const [day, nextDay] of [['2026-03-08', '2026-03-09'], ['2026-11-01', '2026-11-02']] as const) {
      const plan: PlannedEvent = { id: 'overnight', calendarId: 'calendar', title: 'Planned activity', color: '#A47AE2',
        startDate: localDateAtMinute(day, 0), endDate: localDateAtMinute(nextDay, 0), allDay: false };
      const segment: ActivitySegment = { segmentKey: `${day}:actual:90-95`, blockId: 'actual', dateKey: day,
        startMinute: 90, endMinute: 95, categoryId: 'family', activityTitle: 'What happened',
        entries: Array.from({ length: 6 }, (_, index) => ({ id: `minute-${index}`, dateKey: day, minuteIndex: 90 + index,
          text: `Actual note ${index}`, categoryId: 'family', blockId: 'actual', source: 'manual', createdAt: '', updatedAt: '' })) };
      assert.deepEqual(monthAgendaItems(day, [segment], [plan, plan]).map((item) => [item.kind, item.startMinute, item.endMinute]),
        [['plan', 0, 89], ['actual', 90, 95], ['plan', 96, 1439]]);
      assert.deepEqual(monthAgendaItems(nextDay, [], [plan]), []);
      assert.equal(segment.entries[5]!.text, 'Actual note 5');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});
