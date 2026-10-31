import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityCategory } from '../src/theme';
import { buildDashboardSummary, dashboardDates, dashboardPercent, dashboardPeriodDates, dashboardTimeBuckets,
  dashboardPieItems, dashboardPieGeometry, dashboardLineGeometry, formatDashboardPercent } from '../src/utils/dashboard';

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

const chartItems = [
  { key: 'work', label: 'Work', color: '#AB8B00', minutes: 90, percent: 75 },
  { key: 'family', label: 'People', color: '#BE6D00', minutes: 30, percent: 25 },
];

test('pie geometry gives exact whole-percent shares and keeps filtered or unrecorded remainders explicit', () => {
  const pie = dashboardPieGeometry(chartItems);
  assert.equal(pie.length, 360);
  assert.equal(pie.filter((stroke) => stroke.itemKey === 'work').length, 270);
  assert.equal(pie.filter((stroke) => stroke.itemKey === 'family').length, 90);
  const filtered = dashboardPieItems([chartItems[0]!], 120);
  assert.deepEqual(filtered.map((item) => [item.label, item.minutes, item.percent]), [['Work', 90, 75], ['Other recorded activities', 30, 25]]);
  const unrecorded = dashboardPieItems([{ ...chartItems[0]!, label: 'Unrecorded minutes', minutes: 1000 }], 1440, 'Recorded minutes');
  assert.equal(unrecorded[1]!.minutes, 440);
  assert.equal(unrecorded.reduce((sum, item) => sum + item.percent, 0), 100);
  assert.deepEqual(dashboardPieGeometry([]), []);
  assert.deepEqual(dashboardPieGeometry([{ ...chartItems[0]!, minutes: 0 }]), []);
  assert.throws(() => dashboardPieItems(chartItems, 100), /Invalid/);
  assert.throws(() => dashboardPieGeometry([{ ...chartItems[0]!, minutes: -1 }]), /Invalid/);
});

test('each radial stroke joins the pie center and its edge with finite, clipped-circle geometry', () => {
  for (const stroke of dashboardPieGeometry(chartItems)) {
    const radians = stroke.angle * Math.PI / 180;
    const midpoint = { x: stroke.left + stroke.width / 2, y: stroke.top + stroke.height / 2 };
    const inner = { x: midpoint.x - Math.sin(radians) * stroke.height / 2, y: midpoint.y + Math.cos(radians) * stroke.height / 2 };
    const outer = { x: midpoint.x + Math.sin(radians) * stroke.height / 2, y: midpoint.y - Math.cos(radians) * stroke.height / 2 };
    assert.ok(Math.hypot(inner.x - 90, inner.y - 90) < 1e-10);
    assert.ok(Math.abs(Math.hypot(outer.x - 90, outer.y - 90) - 90) < 1e-10);
    assert.ok(Object.values(stroke).filter((value) => typeof value === 'number').every(Number.isFinite));
  }
});

test('line geometry preserves real minute values, date gaps and a valid single-day point without invented hours', () => {
  const items = [0, 30, 60].map((minutes, index) => ({ ...chartItems[0]!, key: String(index), minutes,
    dateKey: ['2026-10-19', '2026-10-20', '2026-10-29'][index]! }));
  const line = dashboardLineGeometry(items);
  assert.equal(line.maximum, 60); assert.equal(line.points.length, 3); assert.equal(line.segments.length, 2);
  assert.deepEqual(line.points.map((point) => point.x), [10, 34, 250]);
  assert.deepEqual(line.points.map((point) => point.y), [140, 75, 10]);
  const single = dashboardLineGeometry([items[1]!]);
  assert.deepEqual(single.points.map((point) => [point.x, point.y]), [[130, 10]]); assert.deepEqual(single.segments, []);
  assert.deepEqual(dashboardLineGeometry(items.map((item) => ({ ...item, minutes: 0 }))).points.map((point) => point.y), [140, 140, 140]);
  assert.deepEqual(dashboardLineGeometry([]).points, []);
  assert.throws(() => dashboardLineGeometry([{ ...items[0]!, minutes: Number.NaN }]), /Invalid/);
});

test('selected-date line buckets contain only requested civil dates and keep each activity denominator', () => {
  const summary = buildDashboardSummary(['2026-10-19', '2026-10-29'], [
    { dateKey: '2026-10-19', categoryId: 'work', minutes: 30 },
    { dateKey: '2026-10-19', categoryId: 'family', minutes: 30 },
    { dateKey: '2026-10-29', categoryId: 'work', minutes: 120 },
  ], categories);
  assert.deepEqual(dashboardTimeBuckets(summary, 'selected', 'recorded', 'work').map((bucket) => [bucket.key, bucket.minutes, bucket.percent]),
    [['2026-10-19', 30, 50], ['2026-10-29', 120, 100]]);
  assert.equal(dashboardTimeBuckets(summary, 'selected', 'unrecorded').length, 2);
});
