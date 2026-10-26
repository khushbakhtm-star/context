import type { PrintColorStyle } from './print-options';

export function printColor(value: string, style: PrintColorStyle) {
  let color = /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : '#555555';
  const rgb = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
  const brightness = rgb[0]! * 0.299 + rgb[1]! * 0.587 + rgb[2]! * 0.114;
  if (style === 'grayscale') {
    const shade = Math.round(brightness).toString(16).padStart(2, '0');
    color = `#${shade}${shade}${shade}`.toUpperCase();
  }
  if (style === 'black-white') return { border: '#000000', background: '#FFFFFF', text: '#000000', bar: '#000000' };
  if (style === 'outline') return { border: color, background: '#FFFFFF', text: '#111111', bar: '#FFFFFF' };
  return { border: color, background: color, text: brightness < 145 ? '#FFFFFF' : '#111111', bar: color };
}
