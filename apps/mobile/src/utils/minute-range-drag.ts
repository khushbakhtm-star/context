/** Keep the point grabbed on a fill handle relative to the source minute's center. */
export function minuteDragGripOffset(pageY: number, top: number, offset: number, rowHeight: number, sourceMinute: number) {
  if (![pageY, top, offset, rowHeight, sourceMinute].every(Number.isFinite) || rowHeight <= 0 ||
      !Number.isInteger(sourceMinute) || sourceMinute < 0 || sourceMinute > 1439) return null;
  return pageY - top + Math.max(0, offset) - (sourceMinute + 0.5) * rowHeight;
}

/** A drag stays in its source date column; an optional captured grip keeps its original minute anchored. */
export function minuteAtDragPosition(
  pageY: number, top: number, height: number, offset: number, rowHeight: number, gripOffset = 0,
) {
  if (![pageY, top, height, offset, rowHeight, gripOffset].every(Number.isFinite) || height <= 0 || rowHeight <= 0) return null;
  const y = Math.max(0, Math.min(height - 1, pageY - top - gripOffset));
  return Math.max(0, Math.min(1439, Math.floor((Math.max(0, offset) + y) / rowHeight)));
}

/** Advance at most half a row per 50ms while a held drag is near a viewport edge. */
export function minuteDragScrollOffset(pageY: number, top: number, height: number, offset: number, rowHeight: number) {
  if (![pageY, top, height, offset, rowHeight].every(Number.isFinite) || height <= 0 || rowHeight <= 0) return offset;
  const edge = Math.min(40, height / 3);
  const y = pageY - top;
  const pressure = y < edge ? -Math.min(1, (edge - y) / edge)
    : y > height - edge ? Math.min(1, (y - height + edge) / edge) : 0;
  const step = pressure === 0 ? 0 : Math.sign(pressure) * Math.max(1, Math.min(16, rowHeight / 2) * Math.abs(pressure));
  return Math.max(0, Math.min(Math.max(0, 1440 * rowHeight - height), offset + step));
}
