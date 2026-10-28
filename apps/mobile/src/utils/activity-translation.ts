import { validateMinuteCellRange } from './cell-format';
import type { ActivitySegment, MinuteEntry } from '../types';

export type ActivityInterval = { key: string; dateKey: string; startMinute: number;
  endDateKey?: string; endMinute: number; absoluteEndMinute?: number };
const civil = (day: string, minute: number) => Date.parse(`${day}T00:00:00Z`) / 60_000 + minute;

export function activityIntervalAbsoluteEnd(interval: ActivityInterval) {
  return civil(interval.endDateKey ?? interval.dateKey, interval.endMinute) - civil(interval.dateKey, 0);
}

export function activityIntervalContains(interval: ActivityInterval, entry: Pick<MinuteEntry, 'dateKey' | 'minuteIndex'>) {
  const value = civil(entry.dateKey, entry.minuteIndex);
  return value >= civil(interval.dateKey, interval.startMinute) &&
    value <= civil(interval.endDateKey ?? interval.dateKey, interval.endMinute);
}

export function activityIntervalRanges(interval: ActivityInterval) {
  const end = activityIntervalAbsoluteEnd(interval);
  const ranges = [{ dateKey: interval.dateKey, startMinute: interval.startMinute, endMinute: Math.min(1439, end) }];
  if (end >= 1440) ranges.push({ dateKey: interval.endDateKey!, startMinute: 0, endMinute: interval.endMinute });
  return ranges;
}

/** Only a complete, identically bordered, contiguous block can become one
 * provider event. Day-local view segments and per-minute colors stay unchanged. */
export function coalesceNativeActivitySpan(parts: readonly ActivitySegment[], members: readonly MinuteEntry[]): ActivitySegment | null {
  if (!parts.length || !members.length || members.length > 1440) return null;
  const ordered = [...members].sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.minuteIndex - b.minuteIndex);
  const first = ordered[0]!;
  const title = parts[0]!.activityTitle;
  if (!title || !parts.every((part) => part.blockId === first.blockId && part.activityTitle === title)) return null;
  const represented = parts.flatMap((part) => part.entries).sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.minuteIndex - b.minuteIndex);
  const fields = ['id', 'dateKey', 'minuteIndex', 'text', 'categoryId', 'blockId', 'source', 'createdAt', 'updatedAt'] as const;
  if (represented.length !== ordered.length || new Set(ordered.map((entry) => entry.id)).size !== ordered.length ||
      represented.some((entry, index) => fields.some((key) => entry[key] !== ordered[index]![key]))) return null;
  try {
    for (let index = 0; index < ordered.length; index++) {
      const entry = ordered[index]!;
      validateMinuteCellRange({ dateKey: entry.dateKey, startMinute: entry.minuteIndex, endMinute: entry.minuteIndex });
      if (entry.blockId !== first.blockId || civil(entry.dateKey, entry.minuteIndex) !== civil(first.dateKey, first.minuteIndex) + index) return null;
    }
  } catch { return null; }
  const endMinute = first.minuteIndex + ordered.length - 1;
  return { segmentKey: `${first.dateKey}:${first.blockId}:${first.minuteIndex}-${endMinute}`,
    blockId: first.blockId, dateKey: first.dateKey, startMinute: first.minuteIndex, endMinute,
    categoryId: first.categoryId, activityTitle: title, entries: ordered.map((entry) => ({ ...entry })) };
}

/** A whole-activity move has one common civil offset and unchanged run geometry. */
export function matchActivityTranslation(previous: readonly ActivityInterval[], current: readonly ActivityInterval[]) {
  if (!previous.length || previous.length !== current.length) return null;
  const read = (input: readonly ActivityInterval[]) => {
    try {
      const rows = input.map((item) => {
        validateMinuteCellRange({ dateKey: item.dateKey, startMinute: item.startMinute, endMinute: item.startMinute });
        validateMinuteCellRange({ dateKey: item.endDateKey ?? item.dateKey, startMinute: item.endMinute, endMinute: item.endMinute });
        return { item, start: civil(item.dateKey, item.startMinute), end: civil(item.endDateKey ?? item.dateKey, item.endMinute) };
      }).sort((a, b) => a.start - b.start || a.end - b.end);
      if (new Set(rows.map((row) => row.item.key)).size !== rows.length ||
          rows.some((row, index) => row.end < row.start || row.end - row.start >= 1440 ||
            (index > 0 && rows[index - 1]!.end >= row.start))) return null;
      return rows;
    } catch { return null; }
  };
  const from = read(previous); const to = read(current);
  if (!from || !to) return null;
  const shiftMinutes = to[0]!.start - from[0]!.start;
  if (!from.every((row, index) => row.start + shiftMinutes === to[index]!.start && row.end + shiftMinutes === to[index]!.end)) return null;
  return { shiftMinutes, matches: from.map((row, index) => ({ previous: row.item, current: to[index]!.item })) };
}

export function bindingInterval(segmentKey: string, blockId: string): ActivityInterval | null {
  const separator = segmentKey.lastIndexOf(':');
  const prefix = segmentKey.slice(0, separator);
  const range = /^(\d{1,4})-(\d{1,4})$/.exec(segmentKey.slice(separator + 1));
  const day = prefix.slice(0, 10);
  if (!range || prefix !== `${day}:${blockId}`) return null;
  const startMinute = Number(range[1]), absoluteEndMinute = Number(range[2]);
  try {
    validateMinuteCellRange({ dateKey: day, startMinute, endMinute: startMinute });
    if (absoluteEndMinute < startMinute || absoluteEndMinute - startMinute >= 1440) return null;
    const endDateKey = new Date((civil(day, 0) + Math.floor(absoluteEndMinute / 1440) * 1440) * 60_000).toISOString().slice(0, 10);
    const endMinute = absoluteEndMinute % 1440;
    validateMinuteCellRange({ dateKey: endDateKey, startMinute: endMinute, endMinute });
    return { key: segmentKey, dateKey: day, startMinute, endMinute,
      ...(absoluteEndMinute >= 1440 ? { endDateKey, absoluteEndMinute } : {}) };
  } catch { return null; }
}
