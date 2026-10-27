/** All twelve months fit initially. Pinching reflows to fewer, wider month
 * cards so their lettering can grow without horizontal scrolling. */
export function calendarYearLayout(width: number, height: number, zoom: number, fontScale = 1) {
  const viewportWidth = Number.isFinite(width) ? Math.max(140, width) : 390;
  const viewportHeight = Number.isFinite(height) ? Math.max(240, height) : 700;
  const scale = Number.isFinite(zoom) ? Math.max(0.7, Math.min(2.5, zoom)) : 1;
  const textScale = Number.isFinite(fontScale) ? Math.max(1, Math.min(1.6, fontScale)) : 1;
  const horizontalPadding = 8;
  const gap = 6;
  const headerHeight = 36;
  const columns = scale >= 2 ? 1 : scale >= 1.4 ? 2 : 3;
  const rows = Math.ceil(12 / columns);
  const monthWidth = (viewportWidth - horizontalPadding * 2 - gap * (columns - 1)) / columns;
  const monthHeight = (viewportHeight - headerHeight - gap * 3 - 8) / 4 * scale;
  const titleHeight = monthHeight * 0.18;
  const weekdayHeight = monthHeight * 0.10;
  const dayHeight = (monthHeight - titleHeight - weekdayHeight) / 6;
  const dayWidth = (monthWidth - 4) / 7;
  const contentHeight = headerHeight + monthHeight * rows + gap * (rows - 1) + 8;
  return { zoom: scale, columns, rows, horizontalPadding, gap, headerHeight, monthWidth, monthHeight,
    titleHeight, weekdayHeight, dayHeight, contentHeight, maxScroll: Math.max(0, contentHeight - viewportHeight),
    titleFont: Math.min(13 * scale * textScale, monthWidth / 6.5, titleHeight * 0.72),
    weekdayFont: Math.min(8 * scale * textScale, dayWidth * 0.68, weekdayHeight * 0.75),
    dayFont: Math.min(11 * scale * textScale, dayWidth * 0.75, dayHeight * 0.72),
    circleSize: Math.max(0, Math.min(dayWidth, dayHeight) - 1),
  };
}
