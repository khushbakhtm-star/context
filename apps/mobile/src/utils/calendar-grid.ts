import type { MinuteEntry, PlannedEvent } from '../types';
import { addDays, calendarMinuteRange, dateKey, localDateAtMinute, MINUTES_PER_DAY, parseDateKey, startOfWeek } from './time';

export type CalendarDayCount = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type CalendarLoadRequest = {
  rangeKey: string;
  token: number;
  entryEpochs: ReadonlyMap<string, number>;
};

export function calendarLoadIsCurrent(request: CalendarLoadRequest,
  state: { mounted: boolean; rangeKey: string; token: number }): boolean {
  return state.mounted && request.rangeKey === state.rangeKey && request.token === state.token;
}

export function calendarEntriesAreCurrent(day: string, request: CalendarLoadRequest,
  currentEpochs: ReadonlyMap<string, number>): boolean {
  return (currentEpochs.get(day) ?? 0) === request.entryEpochs.get(day);
}

export type CalendarSelectionRequest = { rangeKey: string; token: number; dateKey: string; minuteIndex: number };
export type CalendarSelectionState = { mounted: boolean; rangeKey: string; token: number; visibleDays: readonly string[] };
export type CalendarMinuteSelection = {
  dateKey: string;
  minuteIndex: number;
  entry: MinuteEntry | null;
  plan: PlannedEvent | null;
  planDuration: number | null;
};

export function calendarSelectionIsCurrent(request: CalendarSelectionRequest, state: CalendarSelectionState): boolean {
  return state.mounted && request.rangeKey === state.rangeKey && request.token === state.token &&
    state.visibleDays.includes(request.dateKey);
}

export async function loadCalendarMinuteSelection(request: CalendarSelectionRequest, {
  readEntry, readPlans, currentState,
}: {
  readEntry: (day: string, minute: number) => Promise<MinuteEntry | null>;
  readPlans: (day: string) => PlannedEvent[];
  currentState: () => CalendarSelectionState;
}): Promise<CalendarMinuteSelection | null> {
  const entry = await readEntry(request.dateKey, request.minuteIndex);
  if (!calendarSelectionIsCurrent(request, currentState())) return null;
  if (entry && (entry.dateKey !== request.dateKey || entry.minuteIndex !== request.minuteIndex)) {
    throw new Error('The loaded minute does not match the selected date and time.');
  }
  const plan = indexCalendarDay(request.dateKey, [], readPlans(request.dateKey))
    .plansByMinute.get(request.minuteIndex)?.[0] ?? null;
  return { dateKey: request.dateKey, minuteIndex: request.minuteIndex, entry, plan,
    planDuration: suggestedPlanDuration(request.dateKey, request.minuteIndex, entry, plan) };
}

export function visibleCalendarDates(activeDate: string, count: CalendarDayCount): string[] {
  const first = count === 7 ? startOfWeek(parseDateKey(activeDate)) : parseDateKey(activeDate);
  return Array.from({ length: count }, (_, index) => dateKey(addDays(first, index)));
}

export function parseCalendarDateInput(input: string): string | null {
  const value = input.trim();
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!iso && !us) return null;
  const year = Number(iso?.[1] ?? us?.[3]);
  const month = Number(iso?.[2] ?? us?.[1]);
  const day = Number(iso?.[3] ?? us?.[2]);
  if (year < 1000 || year > 9999) return null;
  const parsed = new Date(year, month - 1, day, 12);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    ? dateKey(parsed) : null;
}

/** Arrival order from independent providers must not choose a different title,
 * fill or source-event action on each refresh. Keep every overlapping event;
 * direct account events carry the provider identity needed for explicit edits. */
export function compareCalendarPlans(left: PlannedEvent, right: PlannedEvent): number {
  const origin = Number(!left.accountEvent) - Number(!right.accountEvent);
  if (origin) return origin;
  for (const [a, b] of [[left.accountEvent?.accountId ?? '', right.accountEvent?.accountId ?? ''],
    [left.calendarId, right.calendarId], [left.id, right.id]]) {
    if (a !== b) return a! < b! ? -1 : 1;
  }
  return left.startDate.getTime() - right.startDate.getTime() || left.endDate.getTime() - right.endDate.getTime();
}

export function indexCalendarDay(value: string, entries: MinuteEntry[], plans: PlannedEvent[]) {
  const entriesByMinute = new Map<number, MinuteEntry>();
  for (const entry of entries) {
    if (entry.dateKey === value && Number.isInteger(entry.minuteIndex) &&
        entry.minuteIndex >= 0 && entry.minuteIndex < MINUTES_PER_DAY) entriesByMinute.set(entry.minuteIndex, entry);
  }
  const plansByMinute = new Map<number, PlannedEvent[]>();
  for (const plan of [...plans].sort(compareCalendarPlans)) {
    if (plan.allDay || !Number.isFinite(plan.startDate.getTime()) ||
        !Number.isFinite(plan.endDate.getTime()) || plan.endDate <= plan.startDate) continue;
    const range = calendarMinuteRange(plan.startDate, plan.endDate, value);
    if (!range) continue;
    for (let minute = range.startMinute; minute < range.endMinuteExclusive; minute += 1) {
      const overlapping = plansByMinute.get(minute) ?? [];
      overlapping.push(plan);
      plansByMinute.set(minute, overlapping);
    }
  }
  return { entriesByMinute, plansByMinute };
}

export function suggestedPlanDuration(value: string, minute: number,
  entry: MinuteEntry | null, plan: PlannedEvent | null): number | null {
  if (entry || !plan) return null;
  return Math.max(1, Math.min(MINUTES_PER_DAY,
    Math.ceil((plan.endDate.getTime() - localDateAtMinute(value, minute).getTime()) / 60_000)));
}
