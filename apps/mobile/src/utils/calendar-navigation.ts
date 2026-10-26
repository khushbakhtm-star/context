import { visibleCalendarDates } from './calendar-grid';
import { isDateKey, normalizeSelectedDates } from './date-selection';
import { addDays, dateKey, parseDateKey } from './time';

export type CalendarNavigationState = {
  activeDate: string;
  dayCount: 1 | 3 | 7;
  selectedDates?: readonly string[] | null;
  overviewMonth?: string | null;
};

export type CalendarNavigationTarget = {
  activeDate: string;
  selectedDates: string[] | null;
  overviewMonth: string | null;
};

function civilDayNumber(day: string): number {
  const value = parseDateKey(day);
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000;
}

/** Page full civil months without rolling a late-month anchor past February. */
export function calendarMonthDates(anchor: string, direction: -1 | 1): string[] | null {
  if (!isDateKey(anchor)) return null;
  const first = parseDateKey(anchor);
  first.setDate(1);
  first.setMonth(first.getMonth() + direction);
  if (!isDateKey(dateKey(first))) return null;
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
  return Array.from({ length: last.getDate() }, (_, index) => dateKey(addDays(first, index)));
}

/** Null disables navigation before it could produce an unsupported calendar date. */
export function calendarNavigationTarget(state: CalendarNavigationState,
  direction: -1 | 1): CalendarNavigationTarget | null {
  if (!isDateKey(state.activeDate)) return null;
  const selected = normalizeSelectedDates(state.selectedDates);
  if (selected.length > 7) {
    const anchor = isDateKey(state.overviewMonth) ? state.overviewMonth : selected[0]!;
    const dates = calendarMonthDates(anchor, direction);
    return dates ? { activeDate: dates[0]!, selectedDates: dates, overviewMonth: dates[0]! } : null;
  }
  if (selected.length) {
    const span = civilDayNumber(selected[selected.length - 1]!) - civilDayNumber(selected[0]!) + 1;
    const dates = selected.map((day) => dateKey(addDays(day, direction * span)));
    return dates.every(isDateKey)
      ? { activeDate: dates[0]!, selectedDates: dates, overviewMonth: null } : null;
  }
  const activeDate = dateKey(addDays(state.activeDate, direction * state.dayCount));
  if (!isDateKey(activeDate) || !visibleCalendarDates(activeDate, state.dayCount).every(isDateKey)) return null;
  return { activeDate, selectedDates: null, overviewMonth: null };
}
