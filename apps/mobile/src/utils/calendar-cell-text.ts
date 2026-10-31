/** Every minute uses the same font scale at a given zoom. A long note is
 * naturally wrapped and clipped by its cell; its content never shrinks it. */
export function calendarCellTextScale(rowHeight: number) {
  return Number.isFinite(rowHeight) && rowHeight > 0 ? Math.min(1, rowHeight / 34) : 0;
}

/** One visibility rule for all notes and titles, independent of their text,
 * width, styling or system font multiplier. */
export function calendarCellTextOpacity(scale: number) {
  if (!Number.isFinite(scale)) return 0;
  return Math.max(0, Math.min(1, (scale * 16 - 6) / 2));
}

export function calendarCellTextLayout(rowHeight: number, fontScale = 1) {
  const scale = calendarCellTextScale(rowHeight);
  const multiplier = Number.isFinite(fontScale) && fontScale > 0 ? Math.min(1.4, fontScale) : 1;
  const lineHeight = 21 * multiplier * scale;
  return { scale, fontSize: 16 * multiplier * scale, lineHeight,
    opacity: lineHeight > 0 && lineHeight + 4 <= rowHeight ? calendarCellTextOpacity(scale) : 0 };
}

export type CalendarCellAnnotation = { minute: number; text: string; title?: string; color: string; titleColor: string;
  bold?: boolean; italic?: boolean; underline?: boolean };

/** Below a 9px minute every note is fully faded under the shared rule. Only
 * this conservative bounded union of potentially readable rows needs text
 * hosts while the whole-day background remains coalesced. */
export function calendarReadableMinuteWindow(anchor: { minute: number; viewportY: number }, viewportHeight: number) {
  if (![anchor.minute, anchor.viewportY, viewportHeight].every(Number.isFinite) || viewportHeight <= 0) throw new Error('Invalid calendar text viewport.');
  const offset = Math.max(0, Math.min(1440 * 9 - viewportHeight, anchor.minute * 9 - anchor.viewportY));
  return { first: Math.max(0, Math.floor(offset / 9) - 2),
    last: Math.min(1439, Math.ceil((offset + viewportHeight) / 9) + 1) };
}

export function calendarAnnotationKey(day: string, cell: CalendarCellAnnotation, title = false) {
  return JSON.stringify([day, cell.minute, title ? 'title' : 'note', title ? cell.title : cell.text,
    title ? cell.titleColor : cell.color, title || Boolean(cell.bold), !title && Boolean(cell.italic), !title && Boolean(cell.underline)]);
}
