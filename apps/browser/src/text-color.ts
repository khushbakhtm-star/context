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

/** Match the phone's automatic black/white contrast for opaque activity fills. */
export function noteColorOnFill(fill: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(fill)) return '#242424';
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(fill.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF';
}
