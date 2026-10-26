import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityCategory } from '../src/theme';
import { buildDashboardSummary, dashboardDates, dashboardPercent, dashboardPeriodDates, dashboardTimeBuckets,
  formatDashboardPercent } from '../src/utils/dashboard';

const monday = '2026-10-19';
const categories: ActivityCategory[] = [{ id: 'work', name: 'Work', color: '#AB8B00' },
  { id: 'family', name: 'People', color: '#BE6D00', archived: true }];

test('exact selected dates exclude intervening weekends from totals and both percentage denominators', () => {
  const dates = ['2026-10-23', '2026-10-26'];
  const summary = buildDashboardSummary(dates, [
    { dateKey: '2026-10-23', categoryId: 'work', minutes: 120 },
    { dateKey: '2026-10-24', categoryId: 'work', minutes: 1000 },
    { dateKey: '2026-10-25', categoryId: 'family', minutes: 1000 },
    { dateKey: '2026-10-26', categoryId: 'family', minutes: 60 },
  ], categories);
  assert.equal(summary.recordedMinutes, 180); assert.equal(summary.periodMinutes, 2880);
  assert.equal(summary.unrecordedMinutes, 2700);
  assert.equal(summary.rows.length, 2);
  assert.ok(Math.abs(summary.categories.find((category) => category.categoryId === 'work')!.recordedPercent - 120 / 180 * 100) < 1e-10);
  assert.ok(Math.abs(summary.categories.find((category) => category.categoryId === 'work')!.periodPercent - 120 / 2880 * 100) < 1e-10);
});

test('recorded category shares sum to 100 while remaining minute slots belong to Unrecorded', () => {
  const summary = buildDashboardSummary([monday], [
    { dateKey: monday, categoryId: 'work', minutes: 360 }, { dateKey: monday, categoryId: 'family', minutes: 120 },
  ], categories);
  assert.equal(summary.recordedMinutes, 480); assert.equal(summary.unrecordedMinutes, 960);
  assert.deepEqual(summary.categories.map((category) => [category.categoryId, category.recordedPercent, category.periodPercent]),
    [['work', 75, 25], ['family', 25, 120 * 100 / 1440]]);
  assert.equal(summary.categories.reduce((sum, category) => sum + category.recordedPercent, 0), 100);
  assert.equal(dashboardPercent(summary.categories[0]!), 75);
  assert.equal(dashboardPercent(summary.categories[0]!, 'period'), 25);
  assert.deepEqual(summary.dayTotals, [{ dateKey: monday, minutes: 480, unrecordedMinutes: 960 }]);
});

test('archived and unknown activity identities stay separate with their recorded history', () => {
  const summary = buildDashboardSummary([monday], [
    { dateKey: monday, categoryId: 'family', minutes: 3 },
    { dateKey: monday, categoryId: 'missing_a', minutes: 2 }, { dateKey: monday, categoryId: 'missing_b', minutes: 1 },
  ], categories);
  assert.equal(summary.categories[0]!.name, 'People'); assert.equal(summary.categories[0]!.color, '#BE6D00');
  assert.equal(summary.availableCategories.find((category) => category.id === 'family')!.archived, true);
  assert.equal(summary.categories.length, 3);
  assert.match(summary.categories[1]!.name, /missing_a/); assert.match(summary.categories[2]!.name, /missing_b/);
  assert.equal(summary.availableCategories.some((category) => category.id === 'work'), true, 'zero-time activities remain available for filtering');
});

test('zero recorded data produces zero recorded shares and a fully unrecorded civil period', () => {
  const summary = buildDashboardSummary([monday, '2026-10-20'], [], categories);
  assert.equal(summary.recordedMinutes, 0); assert.equal(summary.unrecordedMinutes, 2880);
  assert.deepEqual(summary.categories, []);
  assert.deepEqual(dashboardTimeBuckets(summary, 'week', 'unrecorded').map((bucket) => [bucket.minutes, bucket.percent]), [[1440, 100], [1440, 100]]);
  assert.equal(formatDashboardPercent(0), '0%'); assert.equal(formatDashboardPercent(Number.NaN), '0%');
  assert.equal(formatDashboardPercent(0.01), '<0.1%');
});

test('duplicate grouped totals or impossible minutes fail rather than double counting a civil cell', () => {
  const row = { dateKey: monday, categoryId: 'work', minutes: 30 };
  assert.throws(() => buildDashboardSummary([monday], [row, row], categories), /invalid/);
  for (const minutes of [-1, 0.5, 1441, Number.NaN]) {
    assert.throws(() => buildDashboardSummary([monday], [{ ...row, minutes }], categories), /invalid/);
  }
  assert.throws(() => buildDashboardSummary([monday], [{ ...row, minutes: 1000 },
    { dateKey: monday, categoryId: 'family', minutes: 500 }], categories), /available minute cells/);
});

test('one whole recorded day has zero Unrecorded, including colored blank and grouped member counts supplied by the ledger', () => {
  const summary = buildDashboardSummary([monday], [
    { dateKey: monday, categoryId: 'work', minutes: 1437 }, { dateKey: monday, categoryId: 'family', minutes: 3 },
  ], categories);
  assert.equal(summary.recordedMinutes, 1440); assert.equal(summary.unrecordedMinutes, 0);
  assert.equal(dashboardTimeBuckets(summary, 'day', 'unrecorded')[0]!.percent, 0);
  assert.equal(summary.categories.find((category) => category.categoryId === 'family')!.minutes, 3);
});

test('periods use Monday weeks, leap years and civil days through DST transitions', () => {
  assert.deepEqual(dashboardPeriodDates('2026-10-25', 'week'),
    ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.equal(dashboardPeriodDates('2028-02-29', 'year').length, 366);
  assert.equal(dashboardPeriodDates('2028-02-29', 'month').length, 29);
  for (const day of ['2026-03-08', '2026-11-01']) {
    const summary = buildDashboardSummary(dashboardPeriodDates(day, 'day'), [], categories);
    assert.equal(summary.periodMinutes, 1440); assert.equal(summary.unrecordedMinutes, 1440);
  }
  assert.ok(dashboardPeriodDates('1000-01-01', 'week').every((day) => day >= '1000-01-01'));
  assert.ok(dashboardPeriodDates('9999-12-31', 'week').every((day) => day <= '9999-12-31'));
});

test('yearly bars aggregate by month while category filters keep the correct daily or monthly denominator', () => {
  const summary = buildDashboardSummary(['2026-01-01', '2026-01-02', '2026-02-01'], [
    { dateKey: '2026-01-01', categoryId: 'work', minutes: 30 },
    { dateKey: '2026-01-01', categoryId: 'family', minutes: 30 },
    { dateKey: '2026-01-02', categoryId: 'work', minutes: 60 },
  ], categories);
  const gaps = dashboardTimeBuckets(summary, 'year', 'unrecorded');
  assert.deepEqual(gaps.map((bucket) => [bucket.key, bucket.minutes, bucket.periodMinutes]),
    [['2026-01', 2760, 2880], ['2026-02', 1440, 1440]]);
  const work = dashboardTimeBuckets(summary, 'year', 'recorded', 'work');
  assert.deepEqual(work.map((bucket) => [bucket.minutes, bucket.percent]), [[90, 75], [0, 0]]);
});

test('date lists are bounded, normalized and immutable; invalid selections fail', () => {
  const source = ['2026-10-20', monday, monday];
  assert.deepEqual(dashboardDates(source), [monday, '2026-10-20']);
  assert.deepEqual(source, ['2026-10-20', monday, monday]);
  assert.throws(() => dashboardDates([]), /valid dates/);
  assert.throws(() => dashboardDates(['2026-02-29']), /valid dates/);
  assert.throws(() => dashboardDates(Array.from({ length: 367 }, () => monday)), /valid dates/);
});
