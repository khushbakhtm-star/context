import type { ActivitySegment, PlannedEvent } from '../types';
import { isActivityGroupId } from './cell-format';
import { monthAgendaItems, type MonthAgendaItem } from './month-agenda';
import { minuteLabel } from './time';

export type ScheduleMinuteNote = { minuteIndex: number; text: string };
export type ScheduleAgendaItem = MonthAgendaItem & {
  description: string;
  minuteNotes: ScheduleMinuteNote[];
  blockId?: string;
};

/** Hide only generated bookkeeping lines in this read-only preview. The source
 * description and the ledger's exact minute notes are never rewritten. */
export function schedulePlanDescription(notes: string) {
  return notes.split(/\r?\n/).filter((line) =>
    !/^Context (?:block|projection|category): .+$/.test(line) &&
    line !== '--- Context minutes ---' && line !== '--- End Context minutes ---' &&
    line !== 'Full minute record available in Context.').join('\n').trim();
}

/** Use the same actual-over-plan coverage as Month, retaining every minute note.
 * A named activity is one schedule row even when its cells use several colors. */
export function scheduleAgendaItems(day: string, segments: readonly ActivitySegment[], plans: readonly PlannedEvent[]): ScheduleAgendaItem[] {
  const actuals = new Map(segments.map((segment) => [`actual:${segment.segmentKey}`, segment]));
  const planNotes = new Map(plans.map((plan) => [
    `plan:${plan.calendarId}|${plan.id}|${plan.startDate.getTime()}|${plan.endDate.getTime()}:`, schedulePlanDescription(plan.notes ?? ''),
  ]));
  const items = monthAgendaItems(day, segments, plans).map((item): ScheduleAgendaItem => {
    const segment = actuals.get(item.id);
    return { ...item, description: segment ? '' : [...planNotes].find(([prefix]) => item.id.startsWith(prefix))?.[1] ?? '',
      minuteNotes: segment ? segment.entries.filter((entry) => entry.dateKey === day &&
        entry.minuteIndex >= item.startMinute && entry.minuteIndex <= item.endMinute && entry.text.trim())
        .map((entry) => ({ minuteIndex: entry.minuteIndex, text: entry.text }))
        .sort((left, right) => left.minuteIndex - right.minuteIndex) : [],
      ...(segment ? { blockId: segment.blockId } : {}) };
  });
  const result: ScheduleAgendaItem[] = [];
  const previousByBlock = new Map<string, ScheduleAgendaItem>();
  for (const item of items) {
    if (item.kind === 'actual' && isActivityGroupId(item.blockId)) {
      const previous = previousByBlock.get(item.blockId);
      if (previous && previous.endMinute + 1 === item.startMinute) {
        previous.endMinute = item.endMinute;
        previous.minuteNotes.push(...item.minuteNotes);
        continue;
      }
      previousByBlock.set(item.blockId, item);
    }
    result.push(item);
  }
  return result;
}

/** Stored intervals include their last minute; displayed end times are exclusive. */
export function scheduleTimeRange(item: Pick<MonthAgendaItem, 'startMinute' | 'endMinute' | 'allDay'>,
  clockFormat: '12h' | '24h') {
  if (item.allDay) return 'All day';
  const end = item.endMinute + 1;
  const startText = minuteLabel(item.startMinute, clockFormat === '12h');
  const endText = end === 1440
    ? clockFormat === '24h' ? '24:00' : '12:00 AM (+1 day)'
    : minuteLabel(end, clockFormat === '12h');
  return `${startText} – ${endText}`;
}

export function scheduleDescription(item: Pick<ScheduleAgendaItem, 'description' | 'minuteNotes'>,
  clockFormat: '12h' | '24h', maxCharacters?: number) {
  const limit = maxCharacters == null ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(maxCharacters));
  if (!item.minuteNotes.length) return item.description.length > limit
    ? `${item.description.slice(0, limit)}…` : item.description;
  let result = '';
  for (const note of item.minuteNotes) {
    const prefix = `${result ? '\n' : ''}${minuteLabel(note.minuteIndex, clockFormat === '12h')} `;
    const remaining = limit - result.length;
    if (prefix.length + note.text.length > remaining) {
      return `${result}${`${prefix}${note.text}`.slice(0, remaining)}…`;
    }
    result += prefix + note.text;
  }
  return result;
}
