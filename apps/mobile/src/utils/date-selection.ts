import { addDays, dateKey, parseDateKey, startOfWeek } from './time';

/** Civil dates stay independent of UTC offsets and daylight-saving transitions. */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1000 || year > 9999) return false;
  const parsed = parseDateKey(value);
  return Number.isFinite(parsed.getTime()) && dateKey(parsed) === value;
}

export function normalizeSelectedDates(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter(isDateKey))].sort() : [];
}

export function toggleSelectedDate(value: unknown, day: string, startNewSelection = false): string[] {
  const dates = normalizeSelectedDates(value);
  if (!isDateKey(day)) return dates;
  if (startNewSelection) return [day];
  return dates.includes(day) ? dates.filter((selected) => selected !== day) : [...dates, day].sort();
}

export function dateSelectionMode(value: unknown): 'minutes' | 'month' {
  return normalizeSelectedDates(value).length > 7 ? 'month' : 'minutes';
}

export type MonthDateCell = { dateKey: string; day: number; inMonth: boolean };

/** A stable six-week Monday-first grid, including adjacent-month dates. */
export function monthDateCells(anchor: string): MonthDateCell[] {
  if (!isDateKey(anchor)) return [];
  const month = parseDateKey(anchor);
  month.setDate(1);
  const first = startOfWeek(month);
  return Array.from({ length: 42 }, (_, index) => {
    const day = addDays(first, index);
    return { dateKey: dateKey(day), day: day.getDate(), inMonth: day.getMonth() === month.getMonth() };
  });
}

export function shiftCalendarMonth(anchor: string, amount: number): string {
  if (!isDateKey(anchor) || !Number.isInteger(amount)) return anchor;
  const month = parseDateKey(anchor);
  month.setDate(1);
  month.setMonth(month.getMonth() + amount);
  const next = dateKey(month);
  return isDateKey(next) ? next : anchor;
}
