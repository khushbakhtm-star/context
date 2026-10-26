import { isDateKey, normalizeSelectedDates, shiftCalendarMonth } from './date-selection';

export const MAX_RANGE_DAYS = 28;
const DAY_MS = 86_400_000;
const civilDay = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
const dayKey = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export type DateGridCellRect = {
  dateKey: string;
  /** Measured page coordinates, including scroll offsets. */
  x: number;
  y: number;
  width: number;
  height: number;
};

function rangeLimit(maxDays: number) {
  return Number.isInteger(maxDays) && maxDays > 0 ? Math.min(MAX_RANGE_DAYS, maxDays) : 0;
}

/** Inclusive civil dates. A long drag stops 27 days away from its original
 * anchor; the anchor never slides when the pointer goes beyond that limit. */
export function anchoredDateRange(anchor: string, target: string, maxDays = MAX_RANGE_DAYS): string[] {
  const limit = rangeLimit(maxDays);
  if (!limit || !isDateKey(anchor) || !isDateKey(target)) return [];
  const start = civilDay(anchor);
  const difference = civilDay(target) - start;
  const offset = Math.sign(difference) * Math.min(Math.abs(difference), limit - 1);
  const first = Math.min(start, start + offset);
  const result = Array.from({ length: Math.abs(offset) + 1 }, (_, index) => dayKey(first + index));
  return result.every(isDateKey) ? result : [];
}

/** Range mode accepts only one consecutive, bounded run. Pick mode remains free
 * to retain scattered dates, so switching modes alone never rewrites them. */
export function isContiguousDateRange(value: unknown, maxDays = MAX_RANGE_DAYS): boolean {
  const limit = rangeLimit(maxDays);
  if (!limit || !Array.isArray(value) || !value.length || !value.every(isDateKey)) return false;
  const dates = normalizeSelectedDates(value);
  return dates.length <= limit && civilDay(dates.at(-1)!) - civilDay(dates[0]!) === dates.length - 1;
}

/** Every 28-day span is contained in the anchor month and at most one neighbor
 * on either side. An edge hold must not keep paging after that useful window. */
export function rangeMonthPageTarget(anchor: string, currentMonth: string, direction: -1 | 1): string | null {
  if (!isDateKey(anchor) || !isDateKey(currentMonth) || (direction !== -1 && direction !== 1)) return null;
  const index = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
  const first = `${currentMonth.slice(0, 7)}-01`;
  if (Math.abs(index(first) - index(anchor)) > 1) return null;
  const next = shiftCalendarMonth(first, direction);
  return next !== first && isDateKey(next) && Math.abs(index(next) - index(anchor)) <= 1 ? next : null;
}

/** Half-open measured rectangles give shared edges one owner. A malformed or
 * stale overlapping layout cannot select an arbitrary date. */
export function dateAtGridPoint(x: number, y: number, cells: readonly DateGridCellRect[]): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let found: string | null = null;
  for (const cell of cells) {
    if (!isDateKey(cell.dateKey) || ![cell.x, cell.y, cell.width, cell.height].every(Number.isFinite) ||
        cell.width <= 0 || cell.height <= 0) continue;
    if (x < cell.x || x >= cell.x + cell.width || y < cell.y || y >= cell.y + cell.height) continue;
    if (found && found !== cell.dateKey) return null;
    found = cell.dateKey;
  }
  return found;
}

/** Pure preview only: invalid/outside/multitouch samples return null, leaving the
 * caller responsible for retaining or restoring its pre-gesture draft. */
export function rangeGestureSelection(anchor: string, x: number, y: number,
  cells: readonly DateGridCellRect[], touchCount = 1, maxDays = MAX_RANGE_DAYS): string[] | null {
  if (touchCount !== 1) return null;
  const target = dateAtGridPoint(x, y, cells);
  if (!target) return null;
  const dates = anchoredDateRange(anchor, target, maxDays);
  return dates.length ? dates : null;
}
