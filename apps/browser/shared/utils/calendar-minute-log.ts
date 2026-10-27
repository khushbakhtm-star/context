import { minuteLabel } from './time';

type LogEntry = { dateKey: string; minuteIndex: number; text: string };
export type CalendarMinuteLine = { minuteIndex: number; text: string };
const CLOCK = '(\\d{1,2}):([0-5]\\d)(?:[ \\t]*(AM|PM))?';
const singleLine = new RegExp('^' + CLOCK + '(?:[ \\t]{2}(.*)|[ \\t](.*)|$)', 'i');
// A two-space boundary starts the note. Only a single space may surround a
// range separator, so a note beginning "– 13:13" remains literal text.
const rangeLine = new RegExp('^' + CLOCK + '[ \\t]?[–—-][ \\t]?' + CLOCK +
  '(?:[ \\t]*\\(\\+1 day\\))?(?:[ \\t]{2}(.*)|[ \\t](.*)|$)', 'i');

function civil(entry: LogEntry) {
  const day = Date.parse(entry.dateKey + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.dateKey) || !Number.isFinite(day) ||
      new Date(day).toISOString().slice(0, 10) !== entry.dateKey ||
      !Number.isInteger(entry.minuteIndex) || entry.minuteIndex < 0 || entry.minuteIndex >= 1440 ||
      typeof entry.text !== 'string') throw new Error('This minute log needs valid dates and minute cells.');
  return day / 60_000 + entry.minuteIndex;
}

/** End times are exclusive, matching the calendar event's actual duration.
 * Indented continuation lines keep timestamp-looking prose inside its own note. */
export function formatCalendarMinuteLog(entries: readonly LogEntry[], includeMeridiem = true): string {
  if (entries.length > 1440) throw new Error('Split activities longer than 24 hours before synchronizing.');
  const lines: string[] = [];
  let previous = -Infinity;
  for (let index = 0; index < entries.length;) {
    const first = entries[index]!;
    const start = civil(first);
    if (start <= previous) throw new Error('Minute notes must be in chronological order.');
    let endIndex = index;
    while (endIndex + 1 < entries.length) {
      const next = entries[endIndex + 1]!;
      const nextTime = civil(next);
      if (nextTime <= start + endIndex - index) throw new Error('Minute notes must be in chronological order.');
      if (nextTime !== start + endIndex - index + 1 || next.text !== first.text) break;
      endIndex++;
    }
    let label = minuteLabel(first.minuteIndex, includeMeridiem);
    if (endIndex > index) {
      const end = start + endIndex - index + 1;
      const nextDay = Math.floor(end / 1440) > Math.floor(start / 1440);
      const endMinute = ((end % 1440) + 1440) % 1440;
      label += ' – ' + (!includeMeridiem && nextDay && endMinute === 0 ? '24:00' :
        minuteLabel(endMinute, includeMeridiem) + (nextDay ? ' (+1 day)' : ''));
    }
    const text = first.text.replace(/\r\n/g, '\n').split('\n');
    lines.push(label + '  ' + text[0]);
    for (const continuation of text.slice(1)) lines.push('    ' + continuation);
    previous = start + endIndex - index;
    index = endIndex + 1;
  }
  return lines.join('\n');
}

function clock(hourText: string, minuteText: string, meridiem?: string, end = false): number {
  let hour = Number(hourText);
  if (meridiem) {
    if (hour < 1 || hour > 12) throw new Error('A calendar minute timestamp is invalid.');
    hour = hour % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
  } else if (hour > 23 && !(end && hour === 24 && minuteText === '00')) {
    throw new Error('A calendar minute timestamp is invalid.');
  }
  return hour * 60 + Number(minuteText);
}

/** Version-two calendar descriptions expand compact ranges without changing the ledger. */
export function parseCalendarMinuteLog(description: string): CalendarMinuteLine[] {
  const entries: CalendarMinuteLine[] = [];
  const seen = new Set<number>();
  let current: CalendarMinuteLine[] = [];
  for (const line of description.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('    ')) {
      if (!current.length) throw new Error('The calendar minute log starts with an unattached note.');
      for (const entry of current) entry.text += '\n' + line.slice(4);
      continue;
    }
    const range = rangeLine.exec(line);
    const single = range ? null : singleLine.exec(line);
    if (!range && !single) {
      if (!current.length && !line.trim()) continue;
      if (!current.length) throw new Error('The calendar minute log starts with an unattached note.');
      // Calendar editors may remove indentation; non-timestamp continuation text remains valid.
      for (const entry of current) entry.text += '\n' + line;
      continue;
    }
    const value = range ?? single!;
    const start = clock(value[1]!, value[2]!, value[3]);
    let count = 1;
    if (range) {
      let end = clock(value[4]!, value[5]!, value[6], true);
      const explicitNextDay = /\(\+1 day\)/.test(line.slice(0, line.length - (value[7]?.length ?? value[8]?.length ?? 0)));
      if (explicitNextDay && end < 1440) end += 1440;
      else if (end <= start) end += 1440;
      count = end - start;
      if (count < 1 || count > 1440) throw new Error('A calendar minute range must last at most 24 hours.');
    }
    const text = range ? value[7] ?? value[8] ?? '' : value[4] ?? value[5] ?? '';
    current = [];
    for (let offset = 0; offset < count; offset++) {
      const minuteIndex = (start + offset) % 1440;
      if (seen.has(minuteIndex)) throw new Error('The calendar description contains duplicate minute timestamps.');
      seen.add(minuteIndex);
      const entry = { minuteIndex, text };
      entries.push(entry); current.push(entry);
    }
  }
  return entries;
}
