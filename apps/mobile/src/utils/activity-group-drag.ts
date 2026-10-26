import { isDateKey } from './date-selection';

export type ActivityGroupDragGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  railWidth: number;
  dayWidth: number;
  rowHeight: number;
  dates: readonly string[];
};

export type ActivityGroupDragGrip = { x: number; y: number; duration: number };
export type ActivityGroupDropTarget = { dateKey: string; startMinute: number; endMinute: number; column: number };

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

function validGeometry(value: ActivityGroupDragGeometry) {
  return [value.left, value.top, value.width, value.height, value.offsetX, value.offsetY,
    value.railWidth, value.dayWidth, value.rowHeight].every(Number.isFinite) &&
    value.railWidth >= 0 && value.width > value.railWidth && value.height > 0 &&
    value.dayWidth > 0 && value.rowHeight > 0 && value.dates.length > 0 && value.dates.length <= 7 &&
    value.dates.every(isDateKey) && new Set(value.dates).size === value.dates.length;
}

/** Capture the grabbed point relative to the group's first minute and date center.
 * Its first minute may be above the viewport; that does not change the grab. */
export function activityGroupDragGrip(pageX: number, pageY: number, geometry: ActivityGroupDragGeometry,
  source: { dateKey: string; startMinute: number; endMinute: number }): ActivityGroupDragGrip | null {
  if (!validGeometry(geometry) || ![pageX, pageY].every(Number.isFinite) ||
      !Number.isInteger(source.startMinute) || !Number.isInteger(source.endMinute) ||
      source.startMinute < 0 || source.endMinute > 1439 || source.endMinute < source.startMinute) return null;
  const column = geometry.dates.indexOf(source.dateKey);
  if (column < 0) return null;
  const x = pageX - geometry.left;
  const y = pageY - geometry.top;
  if (x < geometry.railWidth || x >= geometry.width || y < 0 || y >= geometry.height) return null;
  const contentX = Math.max(0, geometry.offsetX) + x;
  const contentY = Math.max(0, geometry.offsetY) + y;
  if (contentX < geometry.railWidth + column * geometry.dayWidth ||
      contentX >= geometry.railWidth + (column + 1) * geometry.dayWidth ||
      contentY < source.startMinute * geometry.rowHeight ||
      contentY >= (source.endMinute + 1) * geometry.rowHeight) return null;
  return {
    x: contentX - geometry.railWidth - (column + 0.5) * geometry.dayWidth,
    y: contentY - (source.startMinute + 0.5) * geometry.rowHeight,
    duration: source.endMinute - source.startMinute + 1,
  };
}

/** Map a held point onto the actual displayed dates, preserving the grabbed
 * minute within the group and keeping its complete duration inside one day. */
export function activityGroupDropTarget(pageX: number, pageY: number, geometry: ActivityGroupDragGeometry,
  grip: ActivityGroupDragGrip): ActivityGroupDropTarget | null {
  if (!validGeometry(geometry) || ![pageX, pageY, grip.x, grip.y].every(Number.isFinite) ||
      !Number.isInteger(grip.duration) || grip.duration < 1 || grip.duration > 1440) return null;
  // Clamp the finger first. Clamping the corrected group origin would make a
  // partly hidden group jump to the top visible minute when it is first held.
  const x = clamp(pageX - geometry.left, geometry.railWidth, geometry.width - 0.001);
  const y = clamp(pageY - geometry.top, 0, geometry.height - 0.001);
  const column = clamp(Math.floor((Math.max(0, geometry.offsetX) + x - geometry.railWidth - grip.x) /
    geometry.dayWidth), 0, geometry.dates.length - 1);
  const startMinute = clamp(Math.floor((Math.max(0, geometry.offsetY) + y - grip.y) / geometry.rowHeight),
    0, 1440 - grip.duration);
  return { dateKey: geometry.dates[column]!, startMinute, endMinute: startMinute + grip.duration - 1, column };
}

function edgeStep(position: number, minimum: number, maximum: number, maximumStep: number) {
  const edge = Math.min(40, (maximum - minimum) / 3);
  const pressure = position < minimum + edge ? -Math.min(1, (minimum + edge - position) / edge)
    : position > maximum - edge ? Math.min(1, (position - maximum + edge) / edge) : 0;
  return pressure === 0 ? 0 : Math.sign(pressure) * Math.max(1, maximumStep * Math.abs(pressure));
}

/** Call every 50ms during a held drag, then recompute the target with the returned
 * offsets. Movement is bounded independently on both axes and stops at content edges. */
export function activityGroupDragScrollOffsets(pageX: number, pageY: number, geometry: ActivityGroupDragGeometry) {
  if (!validGeometry(geometry) || ![pageX, pageY].every(Number.isFinite)) {
    return { x: geometry.offsetX, y: geometry.offsetY };
  }
  const maximumX = Math.max(0, geometry.railWidth + geometry.dates.length * geometry.dayWidth - geometry.width);
  const maximumY = Math.max(0, 1440 * geometry.rowHeight - geometry.height);
  const dx = edgeStep(pageX - geometry.left, geometry.railWidth, geometry.width, Math.min(16, geometry.dayWidth / 2));
  const dy = edgeStep(pageY - geometry.top, 0, geometry.height, Math.min(16, geometry.rowHeight / 2));
  return { x: clamp(geometry.offsetX + dx, 0, maximumX), y: clamp(geometry.offsetY + dy, 0, maximumY) };
}
