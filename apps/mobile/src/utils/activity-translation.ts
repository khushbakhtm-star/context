import { validateMinuteCellRange } from './cell-format';

export type ActivityInterval = { key: string; dateKey: string; startMinute: number;
  endDateKey?: string; endMinute: number };
const civil = (day: string, minute: number) => Date.parse(`${day}T00:00:00Z`) / 60_000 + minute;

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
  const interval = { key: segmentKey, dateKey: day, startMinute: Number(range[1]), endMinute: Number(range[2]) };
  try { validateMinuteCellRange(interval); return interval; } catch { return null; }
}
