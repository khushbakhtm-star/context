export type CellPoint = { x: number; y: number };
export type InlineCellTap = { key: string; origin: CellPoint; startedAt: number; moved: boolean };

const TAP_SLOP = 9;
const TAP_DURATION = 280;

export function beginInlineCellTap(key: string, point: CellPoint, now: number, touches = 1): InlineCellTap {
  return { key, origin: point, startedAt: now, moved: touches !== 1 };
}

export function trackInlineCellTap(tap: InlineCellTap | null, point: CellPoint, touches = 1): InlineCellTap | null {
  if (!tap) return null;
  return { ...tap, moved: tap.moved || touches !== 1 ||
    Math.hypot(point.x - tap.origin.x, point.y - tap.origin.y) > TAP_SLOP };
}

/** A hold, selection-handle drag, pinch, or superseded cell must keep its native
 * editing behavior instead of opening the minute-options popup. */
export function isInlineCellTap(tap: InlineCellTap | null, key: string, point: CellPoint, now: number,
  hasTextSelection = false): boolean {
  const tracked = trackInlineCellTap(tap, point);
  return Boolean(tracked && tracked.key === key && !tracked.moved && !hasTextSelection &&
    now >= tracked.startedAt && now - tracked.startedAt < TAP_DURATION);
}

/** Choose the higher-contrast default foreground for an opaque activity fill.
 * Explicit user text colors remain the caller's responsibility. */
export function activityTextColor(fill: string | undefined, fallback: string): string {
  if (!fill || !/^#[0-9a-f]{6}$/i.test(fill)) return fallback;
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(fill.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF';
}
