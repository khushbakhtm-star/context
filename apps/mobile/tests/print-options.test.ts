import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPrintOptions, normalizePrintOptions, printOptionDates, withDashboardPeriod } from '../src/utils/print-options';

test('print setup starts with visible date bounds, view mapping and a safe finite range', () => {
  const options = defaultPrintOptions(['2026-10-28', '2026-10-25'], 'week');
  assert.equal(options.startDate, '2026-10-25'); assert.equal(options.endDate, '2026-10-28');
  assert.equal(options.view, 'week'); assert.equal(options.orientation, 'landscape');
  assert.equal(defaultPrintOptions(['2026-01-01'], 'year').view, 'month');
  assert.equal(printOptionDates(defaultPrintOptions(['2026-01-01', '2030-01-01'])).length, 366);
  assert.equal(options.dashboardMetric, 'recorded');
});

test('print range is inclusive, ordered and clips weekends only on request', () => {
  const options = defaultPrintOptions(['2026-10-23', '2026-10-27']);
  assert.deepEqual(printOptionDates(options), ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  assert.deepEqual(printOptionDates({ ...options, showWeekends: false }), ['2026-10-23', '2026-10-26', '2026-10-27']);
  assert.throws(() => printOptionDates({ ...options, startDate: '2026-10-24', endDate: '2026-10-25', showWeekends: false }), /No weekdays/);
});

test('Dashboard presets preserve orientation/style and use civil periods, including leap years and supported edges', () => {
  const options = { ...defaultPrintOptions(['2028-02-29']), colorStyle: 'grayscale' as const };
  const leap = withDashboardPeriod(options, 'year');
  assert.equal(printOptionDates(leap).length, 366); assert.equal(leap.colorStyle, 'grayscale');
  const week = withDashboardPeriod({ ...options, startDate: '2026-11-01', endDate: '2026-11-01' }, 'week');
  assert.equal(week.startDate, '2026-10-26'); assert.equal(week.endDate, '2026-11-01');
  assert.equal(withDashboardPeriod(defaultPrintOptions(['1000-01-01']), 'week').startDate, '1000-01-01');
  assert.equal(withDashboardPeriod(defaultPrintOptions(['9999-12-31']), 'week').endDate, '9999-12-31');
});

test('invalid print fields, reverse/oversized ranges and false-like values are rejected', () => {
  const options = defaultPrintOptions(['2026-10-25']);
  for (const patch of [{ startDate: '2026-02-30' }, { endDate: '2025-10-25' }, { endDate: '2027-11-01' },
    { view: 'script' }, { colorStyle: 'url(https://example.test)' }, { showWeekends: 'false' }, { dashboardMetric: 'unknown' }]) {
    assert.throws(() => normalizePrintOptions({ ...options, ...patch } as never));
  }
});

test('print dates remain civil slots across DST rather than repeating or losing a date', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    for (const [startDate, endDate] of [['2026-03-07', '2026-03-09'], ['2026-10-31', '2026-11-02']]) {
      const dates = printOptionDates({ ...defaultPrintOptions([startDate!]), startDate: startDate!, endDate: endDate! });
      assert.equal(dates.length, 3); assert.equal(new Set(dates).size, 3);
    }
  } finally { if (original == null) delete process.env.TZ; else process.env.TZ = original; }
});
