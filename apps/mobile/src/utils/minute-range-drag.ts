/** A drag stays in its source date column; only its vertical position selects minutes. */
export function minuteAtDragPosition(pageY: number, top: number, height: number, offset: number, rowHeight: number) {
  if (![pageY, top, height, offset, rowHeight].every(Number.isFinite) || height <= 0 || rowHeight <= 0) return null;
  const y = Math.max(0, Math.min(height - 1, pageY - top));
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
