/** A cell shows its complete paragraph, never an ellipsized or clipped excerpt.
 * Native text measurement supplies the wrapped paragraph height. Zoom changes
 * glyph size uniformly, leaving the date column and line-wrap width fixed. */
export function calendarCellTextScale(rowHeight: number, availableHeight: number, measuredHeight: number) {
  if (![rowHeight, availableHeight, measuredHeight].every(Number.isFinite) ||
      rowHeight <= 0 || availableHeight <= 0 || measuredHeight <= 0) return 0;
  return Math.max(0, Math.min(1, rowHeight / 34, availableHeight / measuredHeight));
}

export function calendarCellTextOpacity(scale: number, fontSize = 16) {
  if (!Number.isFinite(scale) || !Number.isFinite(fontSize) || fontSize <= 0) return 0;
  // Shrink before fading. No unreadably small partial letters remain in a row.
  return Math.max(0, Math.min(1, (scale * fontSize - 6) / 2));
}

export function calendarMeasuredTextHeight(lines: readonly { y: number; height: number }[]): number | null {
  if (!lines.length || lines.some((line) => !Number.isFinite(line.y) || !Number.isFinite(line.height) || line.height <= 0)) return null;
  return Math.ceil(Math.max(...lines.map((line) => line.y + line.height)) * 64) / 64;
}

/** Some emoji and unbreakable glyphs can exceed the native wrapping width. */
export function calendarMeasuredTextWidth(lines: readonly { width?: number }[]): number | null {
  if (!lines.length || lines.some((line) => line.width === undefined || !Number.isFinite(line.width) || line.width < 0)) return null;
  return Math.ceil(Math.max(...lines.map((line) => line.width!)) * 64) / 64;
}

/** Native interpolation knots for the exact committed-text fit, including its
 * fixed screen-pixel inset. A compact starting row is never a missing label. */
export function calendarCellTextFitRange(baseRowHeight: number, baseHeight: number, measuredHeight: number, inset = 2, maximumScale = 1) {
  if (![baseRowHeight, baseHeight, measuredHeight, inset, maximumScale].every(Number.isFinite) ||
      baseRowHeight <= 0 || baseHeight <= 0 || measuredHeight <= 0 || inset < 0 || maximumScale < 0 || maximumScale > 1) throw new Error('Invalid cell text geometry.');
  const maximum = Math.max(1, 85 / baseRowHeight);
  const edges = [0, maximum, 2 * inset / baseHeight, 34 * maximumScale / baseRowHeight,
    (measuredHeight * maximumScale + 2 * inset) / baseHeight];
  const denominator = 34 * baseHeight - measuredHeight * baseRowHeight;
  if (denominator > 0) edges.push(68 * inset / denominator);
  const inputRange = [...new Set(edges.filter((value) => Number.isFinite(value) && value >= 0 && value <= maximum))].sort((a, b) => a - b);
  return { inputRange, outputRange: inputRange.map((scale) => Math.min(maximumScale, calendarCellTextScale(baseRowHeight * scale,
    Math.max(0, baseHeight * scale - 2 * inset), measuredHeight))) };
}

export type CalendarCellAnnotation = { minute: number; text: string; title?: string; color: string; titleColor: string;
  bold?: boolean; italic?: boolean; underline?: boolean };

/** At the largest supported font scale, below a 9px minute every paragraph is
 * fully faded. Only this bounded union of potentially readable rows needs text
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
