import { categoryById } from '../theme';
import type { ActivitySegment, PlannedEvent } from '../types';
import { indexCalendarDay } from './calendar-grid';
import { calendarMinuteRange } from './time';

export type MonthAgendaItem = {
  id: string;
  dateKey: string;
  title: string;
  color: string;
  startMinute: number;
  endMinute: number;
  allDay: boolean;
  kind: 'actual' | 'plan';
};

/** The month view summarizes blocks, while the minute ledger retains every note. */
export function monthAgendaItems(day: string, segments: readonly ActivitySegment[], plans: readonly PlannedEvent[]): MonthAgendaItem[] {
  const validSegments = segments.filter((segment) => segment.dateKey === day &&
    Number.isInteger(segment.startMinute) && Number.isInteger(segment.endMinute) &&
    segment.startMinute >= 0 && segment.endMinute < 1440 && segment.endMinute >= segment.startMinute);
  const entries = validSegments.flatMap((segment) => segment.entries);
  const { entriesByMinute } = indexCalendarDay(day, entries, []);
  const actualBlockIds = new Set(validSegments.map((segment) => segment.blockId));
  const result: MonthAgendaItem[] = validSegments.map((segment) => ({
    id: `actual:${segment.segmentKey}`, dateKey: day,
    title: segment.activityTitle?.trim() || segment.entries.find((entry) => entry.text.trim())?.text.trim() ||
      categoryById(segment.categoryId).name,
    color: categoryById(segment.categoryId).color, startMinute: segment.startMinute,
    endMinute: segment.endMinute, allDay: false, kind: 'actual',
  }));
  const seen = new Set<string>();
  for (const plan of plans) {
    if (!Number.isFinite(plan.startDate.getTime()) || !Number.isFinite(plan.endDate.getTime()) ||
      plan.endDate <= plan.startDate) continue;
    const range = calendarMinuteRange(plan.startDate, plan.endDate, day);
    if (!range) continue;
    const identity = `${plan.calendarId}|${plan.id}|${plan.startDate.getTime()}|${plan.endDate.getTime()}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    // A device-calendar echo of a locally edited block can still have its old times.
    const blockMarker = plan.notes?.split(/\r?\n/).find((line) => line.startsWith('Context block: '));
    if (blockMarker && actualBlockIds.has(blockMarker.slice('Context block: '.length))) continue;
    const appendPlan = (start: number, end: number) => result.push({
      id: `plan:${identity}:${start}`, dateKey: day, title: plan.title.trim() || 'Untitled event',
      color: plan.color, startMinute: start, endMinute: end, allDay: plan.allDay, kind: 'plan',
    });
    if (plan.allDay) { appendPlan(0, 1439); continue; }
    // A recorded minute takes precedence over a plan, exactly as in the minute grid.
    let start: number | null = null;
    for (let minute = range.startMinute; minute < range.endMinuteExclusive; minute += 1) {
      if (!entriesByMinute.has(minute)) {
        if (start === null) start = minute;
      } else if (start !== null) { appendPlan(start, minute - 1); start = null; }
    }
    if (start !== null) appendPlan(start, range.endMinuteExclusive - 1);
  }
  return result.sort((left, right) => Number(right.allDay) - Number(left.allDay) ||
    left.startMinute - right.startMinute || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}
