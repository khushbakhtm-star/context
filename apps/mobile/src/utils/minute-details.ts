import { minuteSpanRanges, type MinuteSpan } from './minute-span';
import { parseCalendarMinute } from './calendar-layout';
import { addDays, dateKey } from './time';

export function minuteDetailsSpan(input: { startDateKey: string; startTime: string; endDateKey: string; endTime: string;
  endDateExplicit: boolean }): MinuteSpan {
  const parse = (text: string) => parseCalendarMinute(text.trim().replace(/^(\d{1,2})\s*(AM|PM)$/i, '$1:00 $2'));
  const startMinute = parse(input.startTime), endMinute = parse(input.endTime);
  if (startMinute === null || endMinute === null) throw new Error('Enter valid start and end times.');
  const endDateKey = input.endDateExplicit ? input.endDateKey : endMinute <= startMinute
    ? dateKey(addDays(input.startDateKey, 1)) : input.startDateKey;
  const span = { startDateKey: input.startDateKey, startMinute, endDateKey, endMinute };
  minuteSpanRanges(span);
  return span;
}

export function minuteDetailsCount(span: MinuteSpan): number {
  return minuteSpanRanges(span).reduce((sum, range) => sum + range.endMinute - range.startMinute + 1, 0);
}

export function minuteDetailsTitle(text: string): string { return text.split(/\r?\n/, 1)[0]!.trim().slice(0, 200); }
export function minuteDetailsDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : 'Choose date';
}
