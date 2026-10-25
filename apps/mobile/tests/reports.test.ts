/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countRecordedMinutes, isReportDate, moveReportPeriod, reportBounds, summarizeCategoryTime,
} from '../src/services/reports';

test('report periods use complete civil days, Monday weeks, and correct year boundaries', () => {
  assert.deepEqual(reportBounds('2026-10-25', 'day'), { start: '2026-10-25', end: '2026-10-25' });
  assert.deepEqual(reportBounds('2026-10-25', 'week'), { start: '2026-10-19', end: '2026-10-25' });
  assert.deepEqual(reportBounds('2026-01-01', 'week'), { start: '2025-12-29', end: '2026-01-04' });
  assert.deepEqual(reportBounds('2026-12-31', 'year'), { start: '2026-01-01', end: '2026-12-31' });
});

test('month ranges handle leap years without inventing February dates', () => {
  assert.deepEqual(reportBounds('2024-02-29', 'month'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(reportBounds('2026-02-15', 'month'), { start: '2026-02-01', end: '2026-02-28' });
  assert.equal(isReportDate('2026-02-29'), false);
  assert.equal(isReportDate('2024-02-29'), true);
  assert.equal(isReportDate('2026-13-01'), false);
});

test('period navigation clamps month/year anchors rather than skipping over short months', () => {
  assert.equal(moveReportPeriod('2026-01-31', 'month', 1), '2026-02-28');
  assert.equal(moveReportPeriod('2024-02-29', 'year', 1), '2025-02-28');
  assert.equal(moveReportPeriod('2026-01-01', 'day', -1), '2025-12-31');
  assert.equal(moveReportPeriod('2026-01-01', 'week', -1), '2025-12-25');
});

test('one minute is counted once, and the latest supplied category wins duplicate source rows', () => {
  const rows = countRecordedMinutes([
    { dateKey: '2026-10-25', minuteIndex: 51, categoryId: 'family' },
    { dateKey: '2026-10-25', minuteIndex: 51, categoryId: 'prayer' },
    { dateKey: '2026-10-25', minuteIndex: 52, categoryId: 'prayer' },
    { dateKey: '2026-10-26', minuteIndex: 51, categoryId: 'family' },
  ]);
  assert.equal(summarizeCategoryTime(rows).total, 3);
  assert.equal(summarizeCategoryTime(rows, 'prayer').total, 2);
  assert.equal(summarizeCategoryTime(rows, 'family').total, 1);
});

test('the same category produces comparable day, week, month, and year totals', () => {
  const rows = [
    { dateKey: '2026-10-25', categoryId: 'sleep', minutes: 360 },
    { dateKey: '2026-10-24', categoryId: 'sleep', minutes: 420 },
    { dateKey: '2026-10-01', categoryId: 'sleep', minutes: 300 },
    { dateKey: '2026-01-01', categoryId: 'sleep', minutes: 480 },
    { dateKey: '2026-10-25', categoryId: 'work', minutes: 240 },
  ];
  const totalFor = (period: 'day' | 'week' | 'month' | 'year') => {
    const range = reportBounds('2026-10-25', period);
    return summarizeCategoryTime(rows.filter((row) => row.dateKey >= range.start && row.dateKey <= range.end), 'sleep').total;
  };
  assert.equal(totalFor('day'), 360);
  assert.equal(totalFor('week'), 780);
  assert.equal(totalFor('month'), 1080);
  assert.equal(totalFor('year'), 1560);
});
