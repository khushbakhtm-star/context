import { minuteSpanRanges, type MinuteSpan } from './minute-span';
import { parseCalendarMinute } from './calendar-layout';
import { addDays, dateKey } from './time';
import { validateMinuteCellRange } from './cell-format';

export function minuteDetailsSpan(input: { startDateKey: string; startTime: string; endDateKey: string; endTime: string;
  endDateExplicit: boolean }): MinuteSpan {
  const parse = (text: string) => parseCalendarMinute(text.trim().replace(/^(\d{1,2})\s*(AM|PM)$/i, '$1:00 $2'));
  const startMinute = parse(input.startTime), throughMinute = parse(input.endTime);
  if (startMinute === null || throughMinute === null) throw new Error('Enter valid start and end times.');
  const throughDateKey = input.endDateExplicit ? input.endDateKey : throughMinute < startMinute
    ? dateKey(addDays(input.startDateKey, 1)) : input.startDateKey;
  validateMinuteCellRange({ dateKey: throughDateKey, startMinute: throughMinute, endMinute: throughMinute });
  // The form names the final included minute. Calendar/service endpoints remain
  // exclusive so imports, durations and adjoining events share one boundary.
  const span = { startDateKey: input.startDateKey, startMinute,
    endDateKey: throughMinute === 1439 ? dateKey(addDays(throughDateKey, 1)) : throughDateKey,
    endMinute: (throughMinute + 1) % 1440 };
  minuteSpanRanges(span);
  return span;
}

export function minuteDetailsLastCell(span: MinuteSpan): { dateKey: string; minuteIndex: number } {
  const last = minuteSpanRanges(span).at(-1)!;
  return { dateKey: last.dateKey, minuteIndex: last.endMinute };
}

export function minuteDetailsCount(span: MinuteSpan): number {
  return minuteSpanRanges(span).reduce((sum, range) => sum + range.endMinute - range.startMinute + 1, 0);
}

export function minuteDetailsTitle(text: string): string { return text.split(/\r?\n/, 1)[0]!.trim().slice(0, 200); }
export function minuteDetailsDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : 'Choose date';
}
