import type { MinuteEntry } from '../types';
import { addDays, dateKey, parseDateKey, startOfWeek } from '../utils/time';

export type ReportPeriod = 'day' | 'week' | 'month' | 'year';
export type CategoryTimeRow = { dateKey: string; categoryId: string; minutes: number };

export function isReportDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseDateKey(value);
  return Number.isFinite(parsed.getTime()) && dateKey(parsed) === value;
}

export function reportBounds(anchor: string, period: ReportPeriod) {
  if (!isReportDate(anchor)) throw new Error('Choose a real date in YYYY-MM-DD format.');
  const date = parseDateKey(anchor);
  if (period === 'day') return { start: anchor, end: anchor };
  if (period === 'week') {
    const start = startOfWeek(date);
    return { start: dateKey(start), end: dateKey(addDays(start, 6)) };
  }
  if (period === 'month') return {
    start: dateKey(new Date(date.getFullYear(), date.getMonth(), 1, 12)),
    end: dateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12)),
  };
  return { start: `${date.getFullYear()}-01-01`, end: `${date.getFullYear()}-12-31` };
}

export function moveReportPeriod(anchor: string, period: ReportPeriod, direction: number) {
  const source = parseDateKey(anchor);
  if (period === 'day' || period === 'week') return dateKey(addDays(source, direction * (period === 'week' ? 7 : 1)));
  const target = period === 'month'
    ? new Date(source.getFullYear(), source.getMonth() + direction, 1, 12)
    : new Date(source.getFullYear() + direction, source.getMonth(), 1, 12);
  const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(source.getDate(), maxDay));
  return dateKey(target);
}

/** Defensive deduplication makes source combinations count a civil minute only once. */
export function countRecordedMinutes(entries: Pick<MinuteEntry, 'dateKey' | 'minuteIndex' | 'categoryId'>[]) {
  const unique = new Map<string, typeof entries[number]>();
  for (const entry of entries) unique.set(`${entry.dateKey}:${entry.minuteIndex}`, entry);
  const rows = new Map<string, CategoryTimeRow>();
  for (const entry of unique.values()) {
    const key = `${entry.dateKey}:${entry.categoryId}`;
    const row = rows.get(key) ?? { dateKey: entry.dateKey, categoryId: entry.categoryId, minutes: 0 };
    row.minutes += 1;
    rows.set(key, row);
  }
  return [...rows.values()];
}

export function summarizeCategoryTime(rows: CategoryTimeRow[], categoryId: string | null = null) {
  const categoryTotals = new Map<string, number>();
  const dayTotals = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    if (categoryId && row.categoryId !== categoryId) continue;
    total += row.minutes;
    categoryTotals.set(row.categoryId, (categoryTotals.get(row.categoryId) ?? 0) + row.minutes);
    dayTotals.set(row.dateKey, (dayTotals.get(row.dateKey) ?? 0) + row.minutes);
  }
  return { total, categoryTotals, dayTotals };
}

export function formatRecordedDuration(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
