export type CompactMinute = { color?: string; groupId?: string; title?: string; text?: string; textColor?: string };
export type CompactBand = CompactMinute & { startMinute: number; endMinute: number; mixed?: boolean };

const key = (cell: CompactMinute) => JSON.stringify([cell.color ?? '', cell.groupId ?? '', cell.title ?? '', cell.groupId ? '' : cell.text ?? '', cell.textColor ?? '']);
const visible = (cell: CompactMinute) => Boolean(cell.color || cell.title || cell.text);

/** Exact adjacent runs are the common case. High-entropy data uses bounded
 * summary bands at overview scale; summaries never claim exact event borders. */
export function compactCalendarBands(cells: readonly CompactMinute[], limit = 192): CompactBand[] {
  if (cells.length !== 1440 || !Number.isInteger(limit) || limit < 24 || limit > 288) throw new Error('Invalid compact calendar data.');
  const merge = (values: CompactBand[]) => {
    const result: CompactBand[] = [];
    for (const cell of values) {
      const previous = result.at(-1);
      if (previous && previous.endMinute === cell.startMinute && previous.mixed === cell.mixed && key(previous) === key(cell)) previous.endMinute = cell.endMinute;
      else result.push({ ...cell });
    }
    return result;
  };
  const exact = merge(cells.map((cell, minute) => ({ ...cell, startMinute: minute, endMinute: minute + 1 })));
  if (exact.length <= limit) return exact.filter(visible);
  const size = Math.ceil(1440 / limit);
  const summary: CompactBand[] = [];
  for (let start = 0; start < 1440; start += size) {
    const end = Math.min(1440, start + size);
    const choices = new Map<string, { cell: CompactMinute; count: number }>();
    for (let minute = start; minute < end; minute++) {
      const cell = cells[minute]!;
      if (!visible(cell)) continue;
      const id = key(cell); const previous = choices.get(id);
      if (previous) previous.count++;
      else choices.set(id, { cell, count: 1 });
    }
    if (!choices.size) continue;
    const winner = [...choices.values()].sort((left, right) => right.count - left.count)[0]!.cell;
    // A summary describes presence/color only. Keep labels/borders exact rather
    // than moving an event's title or apparent boundary to a bucket edge.
    summary.push({ color: winner.color, textColor: winner.textColor, mixed: true, startMinute: start, endMinute: end });
  }
  return merge(summary);
}

export function compactMinuteAt(y: number, rowHeight: number): number | null {
  if (!Number.isFinite(y) || !Number.isFinite(rowHeight) || rowHeight <= 0 || y < 0 || y >= 1440 * rowHeight) return null;
  return Math.max(0, Math.min(1439, Math.floor(y / rowHeight)));
}

/** One event border ignores the notes and colors inside it. A dense overview
 * omits the smallest outlines rather than inventing approximate event bounds. */
export function compactCalendarOutlines(cells: readonly CompactMinute[], limit = 96): CompactBand[] {
  if (cells.length !== 1440 || !Number.isInteger(limit) || limit < 1 || limit > 192) throw new Error('Invalid compact calendar data.');
  const result: CompactBand[] = [];
  for (let minute = 0; minute < cells.length; minute++) {
    const cell = cells[minute]!; if (!cell.groupId || !cell.title) continue;
    const previous = result.at(-1);
    if (previous?.groupId === cell.groupId && previous.title === cell.title && previous.endMinute === minute) previous.endMinute = minute + 1;
    else result.push({ groupId: cell.groupId, title: cell.title, textColor: cell.textColor, startMinute: minute, endMinute: minute + 1 });
  }
  return result.sort((a, b) => (b.endMinute - b.startMinute) - (a.endMinute - a.startMinute) || a.startMinute - b.startMinute)
    .slice(0, limit).sort((a, b) => a.startMinute - b.startMinute);
}
