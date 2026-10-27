/** A reserved category metadata key keeps old ledger clients able to carry formatting
 * without rejecting the whole encrypted batch. It is not an activity category: the
 * value deliberately has no category id/name/color, and new category queries exclude it. */
export const CELL_FORMAT_PREFIX = 'category:minuteFormat:';
export type ActivityGroupLabel = { id: string; title: string };
export type CellFormat = { bold?: boolean; italic?: boolean; underline?: boolean; textColor?: string; noFill?: true;
  activityGroup?: ActivityGroupLabel; calendarEvent?: ActivityGroupLabel };
export type MinuteCellRange = { dateKey: string; startMinute: number; endMinute: number };

export function isActivityGroupId(value: unknown): value is string {
  return typeof value === 'string' && /^activity_[A-Za-z0-9_-]{1,150}$/.test(value);
}

/** Source-linked blocks retain their provider identity when given an event title. */
export function isCalendarEventId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}

export function cellEventLabel(format: CellFormat, blockId: string | undefined): ActivityGroupLabel | undefined {
  if (!blockId) return undefined;
  return [format.activityGroup, format.calendarEvent].find((label) => label?.id === blockId);
}

export function normalizeActivityGroup(value: unknown): ActivityGroupLabel | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const group = value as Record<string, unknown>;
  if (!isActivityGroupId(group.id) || typeof group.title !== 'string' ||
      !group.title.trim() || group.title.trim().length > 200) return undefined;
  return { id: group.id, title: group.title.trim() };
}

export function normalizeCellFormat(value: unknown): CellFormat {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: CellFormat = {};
  if (source.bold === true) result.bold = true;
  if (source.italic === true) result.italic = true;
  if (source.underline === true) result.underline = true;
  if (source.noFill === true) result.noFill = true;
  if (typeof source.textColor === 'string' && /^#[0-9a-f]{6}$/i.test(source.textColor)) {
    result.textColor = source.textColor.toUpperCase();
  }
  const activityGroup = normalizeActivityGroup(source.activityGroup);
  if (activityGroup) result.activityGroup = activityGroup;
  const event = source.calendarEvent;
  if (event && typeof event === 'object' && !Array.isArray(event)) {
    const label = event as Record<string, unknown>;
    if (isCalendarEventId(label.id) && typeof label.title === 'string' && label.title.trim() && label.title.trim().length <= 200) {
      result.calendarEvent = { id: label.id, title: label.title.trim() };
    }
  }
  return result;
}

export function cellFormatKey(day: string, minute: number) { return `${CELL_FORMAT_PREFIX}${day}:${minute}`; }
export function cellFormatDocument(format: CellFormat): Record<string, unknown> | null {
  const normalized = normalizeCellFormat(format);
  return Object.keys(normalized).length ? { kind: 'minuteFormat', format: normalized } : null;
}
export function formatFromDocument(value: unknown): CellFormat {
  if (!value || typeof value !== 'object' || (value as Record<string, unknown>).kind !== 'minuteFormat') return {};
  return normalizeCellFormat((value as Record<string, unknown>).format);
}
export function validateMinuteCellRange(range: MinuteCellRange): MinuteCellRange {
  const day = new Date(`${range.dateKey}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.dateKey) || !Number.isFinite(day.getTime()) ||
      day.toISOString().slice(0, 10) !== range.dateKey ||
      !Number.isInteger(range.startMinute) || !Number.isInteger(range.endMinute) ||
      range.startMinute < 0 || range.endMinute > 1439 || range.endMinute < range.startMinute) {
    throw new Error('Choose a valid minute range within one day.');
  }
  return range;
}
