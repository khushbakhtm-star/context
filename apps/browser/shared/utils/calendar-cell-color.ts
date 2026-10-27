/** Source colors are display values, independent of the manual Google palette. */
export function calendarColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

export function sourceEventColor(eventColor: unknown, calendarFallback: unknown): string {
  return calendarColor(eventColor) ?? calendarColor(calendarFallback) ?? '#8E8C86';
}

export function nativeEventColor(event: { id?: unknown; startDate?: unknown; displayColor?: unknown; eventColor?: unknown; color?: unknown },
  start: Date, colors: Readonly<Record<string, string>>, calendarFallback: unknown) {
  const id = typeof event.id === 'string' ? event.id : '';
  return sourceEventColor(calendarColor(colors[`${id}@${start.getTime()}`]) ?? calendarColor(colors[id]) ??
    calendarColor(event.displayColor) ?? calendarColor(event.eventColor) ?? calendarColor(event.color), calendarFallback);
}

export function calendarCellColor({ previewColor, actualColor, hasActual, groupColor, planColor, noFill }: {
  previewColor?: string; actualColor?: string; hasActual: boolean; groupColor?: string; planColor?: string; noFill?: boolean;
}) {
  return calendarColor(previewColor) ?? (noFill ? undefined : (hasActual ? calendarColor(actualColor) : undefined) ??
    calendarColor(groupColor) ?? calendarColor(planColor));
}
