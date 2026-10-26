export const MAX_COLOR_CALENDAR_IDS = 256;
// Eight days allow a seven-day civil week containing a 25-hour daylight-saving day.
export const MAX_COLOR_INTERVAL_MS = 8 * 86_400_000;
export const MAX_COLOR_ROWS = 50_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const LONG_MAX = '9223372036854775807';

function nativeId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value) &&
    (value.length < LONG_MAX.length || value.length === LONG_MAX.length && value <= LONG_MAX);
}

export function calendarColorRequest(calendarIds: unknown, startMs: unknown, endMs: unknown) {
  if (!Array.isArray(calendarIds) || calendarIds.length > MAX_COLOR_CALENDAR_IDS || !calendarIds.every(nativeId) ||
      typeof startMs !== 'number' || typeof endMs !== 'number' || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) ||
      Math.abs(startMs) > MAX_DATE_MS || Math.abs(endMs) > MAX_DATE_MS || endMs <= startMs || endMs - startMs > MAX_COLOR_INTERVAL_MS) return null;
  return { calendarIds: [...new Set(calendarIds)], startMs, endMs };
}

/** The native bridge is optional. Invalid provider output must never become a style value. */
export function calendarColorValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value);
  if (entries.length > MAX_COLOR_ROWS * 2) return {};
  const output: Record<string, string> = {};
  for (const [key, color] of entries) {
    const [id, occurrence, extra] = key.split('@');
    if (!nativeId(id) || extra != null || typeof color !== 'string' || !/^#[a-f\d]{6}$/i.test(color)) continue;
    if (occurrence != null && (!/^-?(?:0|[1-9]\d*)$/.test(occurrence) || !Number.isSafeInteger(Number(occurrence)) ||
        Math.abs(Number(occurrence)) > MAX_DATE_MS)) continue;
    output[key] = color.toUpperCase();
  }
  return output;
}
