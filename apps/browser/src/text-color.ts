/** Convert the browser's computed text color to the six-digit value used by the picker. */
export function effectiveTextColor(explicit: unknown, computed: string): string {
  if (typeof explicit === 'string' && /^#[0-9a-f]{6}$/i.test(explicit)) return explicit.toUpperCase();
  const value = computed.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  const rgb = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)(?:\s*[,/]\s*[\d.]+)?\s*\)$/i.exec(value);
  if (rgb && rgb.slice(1).every((part) => Number(part) <= 255)) return `#${rgb.slice(1).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  return '#242424';
}
