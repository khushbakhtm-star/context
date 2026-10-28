import { validateMinuteCellRange, type MinuteCellRange } from './cell-format';

/** Explicit civil endpoints. The end is exclusive, as in calendar events. */
export type MinuteSpan = { startDateKey: string; startMinute: number; endDateKey: string; endMinute: number };
const MINUTES_PER_DAY = 1440;

function civil(day: string, minute: number) {
  validateMinuteCellRange({ dateKey: day, startMinute: minute, endMinute: minute });
  if (Number(day.slice(0, 4)) < 1000) throw new Error('Choose a date between years 1000 and 9999.');
  return Date.parse(`${day}T00:00:00Z`) / 60_000 + minute;
}

/** No device timezone arithmetic: a skipped/repeated clock hour must not change
 * which existing civil ledger cells the user selected. Provider endpoint/offset
 * validation remains a separate source-write guard. */
export function minuteSpanRanges(span: MinuteSpan): MinuteCellRange[] {
  const start = civil(span.startDateKey, span.startMinute);
  const end = civil(span.endDateKey, span.endMinute);
  const count = end - start;
  if (!Number.isInteger(count) || count < 1 || count > MINUTES_PER_DAY) {
    throw new Error('Choose an end after the start, within 24 hours of minute cells.');
  }
  const ranges: MinuteCellRange[] = [];
  for (let cursor = start; cursor < end;) {
    const dayStart = Math.floor(cursor / MINUTES_PER_DAY) * MINUTES_PER_DAY;
    const through = Math.min(end, dayStart + MINUTES_PER_DAY);
    ranges.push({ dateKey: new Date(dayStart * 60_000).toISOString().slice(0, 10),
      startMinute: cursor - dayStart, endMinute: through - dayStart - 1 });
    cursor = through;
  }
  return ranges;
}

export function minuteSpanCoordinates(span: MinuteSpan) {
  return minuteSpanRanges(span).flatMap((range) => Array.from({ length: range.endMinute - range.startMinute + 1 },
    (_, offset) => ({ dateKey: range.dateKey, minuteIndex: range.startMinute + offset })));
}
