import type { ActivityCategory } from '../theme';
import { reportBounds, type CategoryTimeRow, type ReportPeriod } from '../services/reports';
import { isDateKey, normalizeSelectedDates } from './date-selection';
import { parseDateKey } from './time';

export type DashboardPercentageBasis = 'recorded' | 'period';
export type DashboardMetric = 'recorded' | 'unrecorded';
export type DashboardCategoryMetric = {
  categoryId: string;
  name: string;
  color: string;
  minutes: number;
  recordedPercent: number;
  periodPercent: number;
};
export type DashboardSummary = {
  dates: string[];
  recordedMinutes: number;
  unrecordedMinutes: number;
  periodMinutes: number;
  categories: DashboardCategoryMetric[];
  rows: CategoryTimeRow[];
  dayTotals: { dateKey: string; minutes: number; unrecordedMinutes: number }[];
  availableCategories: Pick<ActivityCategory, 'id' | 'name' | 'color' | 'archived'>[];
};

export function dashboardDates(value: readonly string[]): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 366 || !value.every(isDateKey)) {
    throw new Error('Choose between 1 and 366 valid dates for the Dashboard.');
  }
  return normalizeSelectedDates(value);
}

/** Count civil slots rather than elapsed DST hours. At supported-year edges a
 * partial week contains only the dates Context can actually display. */
export function dashboardPeriodDates(anchor: string, period: ReportPeriod): string[] {
  if (!isDateKey(anchor)) throw new Error('Choose a real date in YYYY-MM-DD format.');
  const bounds = reportBounds(anchor, period);
  const civil = (day: string) => {
    const date = parseDateKey(day);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  };
  const first = civil(bounds.start);
  const count = (civil(bounds.end) - first) / 86_400_000 + 1;
  if (!Number.isInteger(count) || count < 1 || count > 366) throw new Error('Choose a valid Dashboard period.');
  return Array.from({ length: count }, (_, index) => new Date(first + index * 86_400_000).toISOString().slice(0, 10))
    .filter(isDateKey);
}

const COLOR = /^#[0-9a-f]{6}$/i;
export function buildDashboardSummary(value: readonly string[], sourceRows: readonly CategoryTimeRow[],
  metadata: readonly ActivityCategory[]): DashboardSummary {
  const dates = dashboardDates(value);
  const selected = new Set(dates);
  const catalog = new Map<string, Pick<ActivityCategory, 'id' | 'name' | 'color' | 'archived'>>();
  for (const category of metadata) catalog.set(category.id, { id: category.id, name: category.name,
    color: COLOR.test(category.color) ? category.color : '#5A6986', archived: category.archived });
  const rows: CategoryTimeRow[] = [];
  const seen = new Set<string>();
  const categoryTotals = new Map<string, number>();
  const dayTotals = new Map(dates.map((day) => [day, 0]));
  for (const row of sourceRows) {
    if (!selected.has(row.dateKey)) continue;
    const identity = `${row.dateKey}\0${row.categoryId}`;
    if (typeof row.categoryId !== 'string' || !row.categoryId.trim() || !Number.isInteger(row.minutes) ||
        row.minutes < 0 || row.minutes > 1440 || seen.has(identity)) {
      throw new Error('Recorded time totals are invalid. Refresh the Dashboard and try again.');
    }
    seen.add(identity);
    if (!row.minutes) continue;
    const total = dayTotals.get(row.dateKey)! + row.minutes;
    if (total > 1440) throw new Error('Recorded time totals exceed the available minute cells. Refresh and try again.');
    dayTotals.set(row.dateKey, total);
    categoryTotals.set(row.categoryId, (categoryTotals.get(row.categoryId) ?? 0) + row.minutes);
    rows.push({ dateKey: row.dateKey, categoryId: row.categoryId, minutes: row.minutes });
    if (!catalog.has(row.categoryId)) catalog.set(row.categoryId,
      { id: row.categoryId, name: `Other recorded activity (${row.categoryId})`, color: '#5A6986' });
  }
  const recordedMinutes = [...categoryTotals.values()].reduce((total, minutes) => total + minutes, 0);
  const periodMinutes = dates.length * 1440;
  const categories = [...categoryTotals].map(([categoryId, minutes]) => ({ categoryId, minutes,
    name: catalog.get(categoryId)!.name, color: catalog.get(categoryId)!.color,
    recordedPercent: recordedMinutes ? minutes * 100 / recordedMinutes : 0,
    periodPercent: minutes * 100 / periodMinutes,
  })).sort((left, right) => right.minutes - left.minutes || left.name.localeCompare(right.name) || left.categoryId.localeCompare(right.categoryId));
  return { dates, recordedMinutes, unrecordedMinutes: periodMinutes - recordedMinutes, periodMinutes, categories,
    rows: rows.sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.categoryId.localeCompare(right.categoryId)),
    dayTotals: [...dayTotals].map(([dateKey, minutes]) => ({ dateKey, minutes, unrecordedMinutes: 1440 - minutes })),
    availableCategories: [...catalog.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)) };
}

export function dashboardPercent(metric: Pick<DashboardCategoryMetric, 'recordedPercent' | 'periodPercent'>,
  basis: DashboardPercentageBasis = 'recorded') {
  return basis === 'period' ? metric.periodPercent : metric.recordedPercent;
}

export function formatDashboardPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  if (value < 0.1) return '<0.1%';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

export function dashboardTimeBuckets(summary: DashboardSummary, period: ReportPeriod, metric: DashboardMetric,
  categoryId: string | null = null) {
  const selectedCategory = new Map(summary.rows.filter((row) => row.categoryId === categoryId)
    .map((row) => [row.dateKey, row.minutes]));
  const buckets = new Map<string, { key: string; startDate: string; endDate: string; minutes: number;
    periodMinutes: number; recordedMinutes: number; percent: number }>();
  for (const day of summary.dayTotals) {
    const key = period === 'year' ? day.dateKey.slice(0, 7) : day.dateKey;
    const bucket = buckets.get(key) ?? { key, startDate: day.dateKey, endDate: day.dateKey,
      minutes: 0, periodMinutes: 0, recordedMinutes: 0, percent: 0 };
    bucket.endDate = day.dateKey;
    bucket.periodMinutes += 1440;
    bucket.recordedMinutes += day.minutes;
    bucket.minutes += metric === 'unrecorded' ? day.unrecordedMinutes :
      categoryId ? selectedCategory.get(day.dateKey) ?? 0 : day.minutes;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((bucket) => ({ ...bucket,
    percent: metric === 'unrecorded' ? bucket.minutes * 100 / bucket.periodMinutes :
      bucket.recordedMinutes ? bucket.minutes * 100 / bucket.recordedMinutes : 0 }));
}
