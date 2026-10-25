export const CALENDAR_TIME_RAIL = 88;
export const CALENDAR_BASE_ROW_HEIGHT = 34;

export function normalizeCalendarZoom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(0.5, Math.min(2.5, value)) * 100) / 100 : 1;
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

export function calendarGridLayout(viewport: number, preset: 1 | 3 | 7, value = 1, bufferedDays: number = preset) {
  const viewportWidth = Number.isFinite(viewport) && viewport > CALENDAR_TIME_RAIL ? viewport : 360;
  const zoom = normalizeCalendarZoom(value);
  const railWidth = Math.min(Math.max(52, Math.round(CALENDAR_TIME_RAIL * zoom)), Math.max(52, viewportWidth - 64));
  const baseAvailable = viewportWidth - CALENDAR_TIME_RAIL;
  const baseDayWidth = preset === 1 ? Math.max(160, baseAvailable) : Math.max(160, baseAvailable / preset);
  const dayWidth = Math.max(80, Math.round(baseDayWidth * zoom));
  const needed = zoom < 1 ? Math.ceil(Math.max(1, viewportWidth - railWidth) / dayWidth) + 1 : preset;
  const dayCount = Math.min(7, Math.max(preset, needed, bufferedDays));
  const contentWidth = Math.max(viewportWidth, railWidth + dayCount * dayWidth);
  return { viewportWidth, dayWidth, contentWidth, railWidth, zoom, rowHeight: Math.max(17, Math.round(CALENDAR_BASE_ROW_HEIGHT * zoom)),
    maxOffset: Math.max(0, contentWidth - viewportWidth), dayCount };
}

export type CalendarZoomAnchor = { minute: number; day: number; viewportX: number; viewportY: number };

export function calendarZoomOffsets(anchor: CalendarZoomAnchor, layout: ReturnType<typeof calendarGridLayout>, viewportHeight: number) {
  return {
    x: Math.max(0, Math.min(layout.maxOffset, layout.railWidth + anchor.day * layout.dayWidth - anchor.viewportX)),
    y: Math.max(0, Math.min(1440 * layout.rowHeight - Math.max(0, viewportHeight), anchor.minute * layout.rowHeight - anchor.viewportY)),
  };
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
