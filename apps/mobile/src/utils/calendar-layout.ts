import type { CalendarDayCount } from './calendar-grid';

export const CALENDAR_TIME_RAIL = 88;
export const CALENDAR_BASE_ROW_HEIGHT = 34;
export const CALENDAR_COMPACT_ROW_HEIGHT = 9;

export function calendarGridPaint(colors: { surface: string; hairline: string }, mode: 'light' | 'dark') {
  return { background: mode === 'dark' ? '#000000' : colors.surface,
    line: mode === 'dark' ? '#3A393D' : colors.hairline };
}

export function normalizeCalendarZoom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(0.0001, Math.min(2.5, value)) * 1_000_000) / 1_000_000 : 1;
}

export function calendarFitDayZoom(viewportHeight: number): number {
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 500;
  return height / (1440 * CALENDAR_BASE_ROW_HEIGHT);
}

/** One comfortable inward pinch can reach the full day; columns never scale. */
export function calendarPinchZoom(startZoom: number, startDistance: number, distance: number, viewportHeight: number): number {
  const floor = calendarFitDayZoom(viewportHeight);
  const initial = Math.max(floor, normalizeCalendarZoom(startZoom));
  if (!Number.isFinite(startDistance) || startDistance < 8 || !Number.isFinite(distance) || distance <= 0) return initial;
  return Math.max(floor, normalizeCalendarZoom(initial * (distance / startDistance) ** 6));
}

export function parseCalendarMinute(input: string): number | null {
  const value = input.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!value) return null;
  const hour = Number(value[1]);
  const minute = Number(value[2]);
  const meridiem = value[3]?.toUpperCase();
  if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) return null;
  return ((meridiem ? hour % 12 + (meridiem === 'PM' ? 12 : 0) : hour) * 60) + minute;
}

/** The native label measurement includes the user's font scale and stays fixed
 * during vertical zoom. A passive time rail adds one pixel on each side. */
export function calendarGridLayout(viewport: number, preset: CalendarDayCount, value = 1, bufferedDays: number = preset,
  measuredBaseTimeWidth?: number, exactSelection = false, viewportHeight = 500) {
  const viewportWidth = Number.isFinite(viewport) && viewport > CALENDAR_TIME_RAIL ? viewport : 360;
  const zoom = Math.max(calendarFitDayZoom(viewportHeight), normalizeCalendarZoom(value));
  const compact = typeof measuredBaseTimeWidth === 'number' && Number.isFinite(measuredBaseTimeWidth) && measuredBaseTimeWidth > 0;
  const railWidth = Math.min(compact ? Math.ceil(measuredBaseTimeWidth) + 2 : CALENDAR_TIME_RAIL, viewportWidth - 64);
  // A view is one complete page. Pinch changes minute density; dates and text keep their horizontal geometry.
  const dayCount = Math.max(1, Math.min(7, Math.trunc(preset))) as CalendarDayCount;
  const dayWidth = (viewportWidth - railWidth) / dayCount;
  const contentWidth = viewportWidth;
  const height = CALENDAR_BASE_ROW_HEIGHT * zoom;
  return { viewportWidth, dayWidth, contentWidth, railWidth, zoom, rowHeight: height,
    maxOffset: Math.max(0, contentWidth - viewportWidth), dayCount };
}

export type CalendarZoomAnchor = { minute: number; day: number; viewportX: number; viewportY: number };

export function calendarZoomOffsets(anchor: CalendarZoomAnchor, layout: ReturnType<typeof calendarGridLayout>, viewportHeight: number) {
  return {
    x: Math.max(0, Math.min(layout.maxOffset, layout.railWidth + anchor.day * layout.dayWidth - anchor.viewportX)),
    y: Math.max(0, Math.min(1440 * layout.rowHeight - Math.max(0, viewportHeight), anchor.minute * layout.rowHeight - anchor.viewportY)),
  };
}

/** A passive full-day preview uses only native transforms while the committed
 * virtualized grid keeps its existing item layout until the gesture is released. */
export function calendarPinchPreviewGeometry(anchor: CalendarZoomAnchor, baseRowHeight: number,
  targetRowHeight: number, viewportHeight: number) {
  if (![baseRowHeight, targetRowHeight, viewportHeight, anchor.minute, anchor.viewportY].every(Number.isFinite) ||
      baseRowHeight <= 0 || targetRowHeight <= 0 || viewportHeight <= 0) {
    throw new Error('Invalid calendar pinch geometry.');
  }
  const offset = Math.max(0, Math.min(1440 * targetRowHeight - viewportHeight,
    anchor.minute * targetRowHeight - anchor.viewportY));
  const scaleY = targetRowHeight / baseRowHeight;
  return { scaleY, inverseScaleY: 1 / scaleY, translateY: -offset, offset };
}

/** The pinned time rail covers the left portion of the scrolling content. Reveal the
 * selected date in the remaining viewport without moving an already visible column. */
export function revealCalendarDay(offset: number, dayIndex: number, layout: ReturnType<typeof calendarGridLayout>) {
  const current = Math.max(0, Math.min(layout.maxOffset, Number.isFinite(offset) ? offset : 0));
  if (dayIndex < 0 || dayIndex >= layout.dayCount) return current;
  const available = Math.max(1, layout.viewportWidth - layout.railWidth);
  const left = dayIndex * layout.dayWidth;
  const right = left + layout.dayWidth;
  const next = layout.dayWidth > available ? left : left < current ? left : right > current + available ? right - available : current;
  return Math.max(0, Math.min(layout.maxOffset, next));
}
