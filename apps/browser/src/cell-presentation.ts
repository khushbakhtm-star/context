import type { SyncDocument } from '../shared/sync/types';
import { cellEventLabel, cellFormatKey, formatFromDocument } from '../shared/utils/cell-format';
import { addDays, dateKey } from '../shared/utils/time';
import { sourceEventColor } from '../shared/utils/calendar-cell-color';

type Plan = { id: string; title: string; color?: string };
type Point = { day: string; minute: number };
/** Browser rows have one fixed scale. Text uses that common size and the native
 * line breaker; overflow clips at the cell instead of fitting each note. */
export const MINUTE_NOTE_STYLE = Object.freeze({ fontSize: '14px', lineHeight: '21px', width: '100%',
  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'normal', textOverflow: 'clip', overflow: 'hidden' });
export const MINUTE_TIME_STYLE = Object.freeze({ fontSize: '12px', whiteSpace: 'nowrap', textOverflow: 'clip' });
function adjacent(day: string, minute: number, delta: number): Point {
  const value = minute + delta;
  return value < 0 ? { day: dateKey(addDays(day, -1)), minute: 1439 } : value > 1439 ?
    { day: dateKey(addDays(day, 1)), minute: 0 } : { day, minute: value };
}

/** A title labels one bordered activity; it is never the text of an empty minute. */
export function minuteCellPresentation(documents: ReadonlyMap<string, SyncDocument>, day: string, minute: number,
  planAt: (day: string, minute: number) => Plan | undefined) {
  const identify = (point: Point) => {
    const entry = documents.get(`minute:${point.day}:${point.minute}`)?.value;
    const format = formatFromDocument(documents.get(cellFormatKey(point.day, point.minute))?.value);
    const label = cellEventLabel(format, String(entry?.blockId ?? ''));
    const plan = !format.noFill ? planAt(point.day, point.minute) : undefined;
    const category = entry ? documents.get(`category:${entry.categoryId}`)?.value : undefined;
    return { text: typeof entry?.text === 'string' ? entry.text : '',
      title: label?.title ?? plan?.title, borderId: label?.id ?? (plan ? `plan:${plan.id}` : undefined),
      eventColor: label ? sourceEventColor(category?.color, undefined) : plan ? sourceEventColor(plan.color, undefined) : undefined,
      planned: !label && Boolean(plan) };
  };
  const current = identify({ day, minute });
  const matches = (other: ReturnType<typeof identify>) => other.borderId === current.borderId && other.title === current.title;
  return { ...current, first: Boolean(current.borderId && !matches(identify(adjacent(day, minute, -1)))),
    last: Boolean(current.borderId && !matches(identify(adjacent(day, minute, 1)))) };
}
