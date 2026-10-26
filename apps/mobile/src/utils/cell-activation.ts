import { isInlineCellTap, type CellPoint, type InlineCellTap } from './minute-interactions';

export type CellActivationTap = { key: string; point: CellPoint; endedAt: number };
export const CELL_DOUBLE_TAP_MS = 360;
const DOUBLE_TAP_SLOP = 18;

/** Selection and editing are separate intents. A drag, hold, pinch or text
 * selection never arms the next tap to open a keyboard or a color panel. */
export function finishCellActivation(touch: InlineCellTap | null, key: string, point: CellPoint, now: number,
  previous: CellActivationTap | null, editingKey: string | null = null) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(now) ||
      !isInlineCellTap(touch, key, point, now)) {
    return { action: 'none' as const, next: null };
  }
  if (editingKey === key) return { action: 'caret' as const, next: null };
  if (previous?.key === key && now >= previous.endedAt && now - previous.endedAt <= CELL_DOUBLE_TAP_MS &&
      Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <= DOUBLE_TAP_SLOP) {
    return { action: 'edit' as const, next: null };
  }
  return { action: 'select' as const, next: { key, point: { ...point }, endedAt: now } };
}
