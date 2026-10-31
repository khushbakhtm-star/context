import { minuteLabel } from './time';

/** Time labels retain their readable size; dense rows show hours, never ellipses. */
export function calendarTimeRailLayout(rowHeight: number, fontScale = 1) {
  const multiplier = Number.isFinite(fontScale) && fontScale > 0 ? Math.min(1.4, fontScale) : 1;
  const fontSize = 16 * multiplier, lineHeight = 21 * multiplier;
  const height = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 0;
  return { fontSize, lineHeight, hourOnly: height < lineHeight + 2,
    hourStep: height > 0 ? Math.max(1, Math.ceil((lineHeight + 2) / (60 * height))) : 24 };
}

export function calendarHourLabel(minute: number, format: '12h' | '24h') {
  const hour = Math.max(0, Math.min(24, Math.floor(minute / 60)));
  return format === '24h' ? String(hour) : `${hour % 12 || 12}${hour % 24 < 12 ? 'AM' : 'PM'}`;
}

export function calendarTimeRailLabel(minute: number, rowHeight: number, format: '12h' | '24h', fontScale = 1) {
  if (!Number.isInteger(minute) || minute < 0 || minute > 1440) return '';
  const layout = calendarTimeRailLayout(rowHeight, fontScale);
  if (minute === 1440) return calendarHourLabel(minute, format);
  if (!layout.hourOnly) return minuteLabel(minute, format === '12h');
  return minute % (60 * layout.hourStep) === 0 ? calendarHourLabel(minute, format) : '';
}

/** Absolute label top in the day's coordinate space, shared by both renderers. */
export function calendarTimeRailLabelTop(minute: number, rowHeight: number, fontScale = 1) {
  const rail = calendarTimeRailLayout(rowHeight, fontScale);
  const top = rail.hourOnly ? minute * rowHeight - rail.lineHeight / 2
    : minute * rowHeight + (rowHeight - rail.lineHeight) / 2;
  return Math.max(0, Math.min(Math.max(0, 1440 * rowHeight - rail.lineHeight), top));
}
