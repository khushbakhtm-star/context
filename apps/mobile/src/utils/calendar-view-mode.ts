import { visibleCalendarDates } from './calendar-grid';
import { calendarMonthDates, calendarNavigationTarget, type CalendarNavigationTarget } from './calendar-navigation';
import { isDateKey, normalizeSelectedDates } from './date-selection';
import { addDays, dateKey, parseDateKey } from './time';

export type CalendarViewMode = 'day' | 'three-days' | 'week' | 'month' | 'year' | 'schedule';
export type CalendarViewKind = 'minutes' | 'month' | 'year' | 'schedule';
export type CalendarViewModeState = {
  mode: CalendarViewMode;
  activeDate: string;
  selectedDates?: readonly string[] | null;
  overviewMonth?: string | null;
};

/** Explicit dates keep their exact gaps and existing seven-column threshold. */
export function calendarViewKind(mode: CalendarViewMode, selectedDates?: readonly string[] | null): CalendarViewKind {
  const selected = normalizeSelectedDates(selectedDates);
  if (selected.length) return selected.length > 7 ? 'month' : 'minutes';
  return mode === 'day' || mode === 'three-days' || mode === 'week' ? 'minutes' : mode;
}

/** Twelve civil-month anchors; no event or minute data is fetched for a year here. */
export function calendarYearMonths(anchor: string): string[] {
  if (!isDateKey(anchor)) return [];
  const year = anchor.slice(0, 4);
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}-01`);
}

/** Schedule is deliberately bounded to one month, not an unbounded year query. */
export function calendarViewDates(mode: CalendarViewMode, activeDate: string,
  selectedDates?: readonly string[] | null): string[] {
  const selected = normalizeSelectedDates(selectedDates);
  if (selected.length) return selected;
  if (!isDateKey(activeDate)) return [];
  if (mode === 'month' || mode === 'schedule') {
    const first = `${activeDate.slice(0, 7)}-01`;
    const start = parseDateKey(first);
    const count = new Date(start.getFullYear(), start.getMonth() + 1, 0, 12).getDate();
    return Array.from({ length: count }, (_, index) => dateKey(addDays(first, index)));
  }
  if (mode === 'year') return calendarYearMonths(activeDate).flatMap((month) => calendarViewDates('month', month));
  const dates = visibleCalendarDates(activeDate, mode === 'week' ? 7 : mode === 'three-days' ? 3 : 1);
  return dates.every(isDateKey) ? dates : [];
}

/** Null disables an arrow before its page would leave the supported civil years. */
export function calendarViewModePageTarget(state: CalendarViewModeState,
  direction: -1 | 1): CalendarNavigationTarget | null {
  if (!isDateKey(state.activeDate)) return null;
  const selected = normalizeSelectedDates(state.selectedDates);
  if (selected.length || state.mode === 'day' || state.mode === 'three-days' || state.mode === 'week') {
    return calendarNavigationTarget({ ...state,
      dayCount: state.mode === 'week' ? 7 : state.mode === 'three-days' ? 3 : 1 }, direction);
  }
  if (state.mode === 'year') {
    const year = Number(state.activeDate.slice(0, 4)) + direction;
    const activeDate = `${String(year).padStart(4, '0')}-01-01`;
    return isDateKey(activeDate) ? { activeDate, selectedDates: null, overviewMonth: null } : null;
  }
  const anchor = isDateKey(state.overviewMonth) ? state.overviewMonth : state.activeDate;
  const dates = calendarMonthDates(anchor, direction);
  return dates ? { activeDate: dates[0]!, selectedDates: null, overviewMonth: dates[0]! } : null;
}
