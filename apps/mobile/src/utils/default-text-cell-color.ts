/** A display-only neutral fill; it never assigns an activity or calendar color. */
export function defaultTextCellColor({ text, categoryId, customColor, mode, noFill, hasSourceColor }: {
  text: string; categoryId?: string; customColor?: boolean; mode: 'light' | 'dark'; noFill?: boolean; hasSourceColor?: boolean;
}): string | undefined {
  if (!text.trim() || !noFill && (hasSourceColor || categoryId !== 'unaccounted' || customColor)) return undefined;
  return mode === 'light' ? '#E6E6E6' : '#333333';
}
