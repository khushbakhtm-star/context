import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarYearLayout } from '../src/utils/calendar-year-layout';

test('twelve month cards fit the initial phone viewport at all supported text scales', () => {
  for (const width of [280, 320, 360, 390, 432]) for (const height of [320, 480, 640, 740]) {
    for (const fontScale of [1, 1.3, 1.6, 2]) {
      const layout = calendarYearLayout(width, height, 1, fontScale);
      assert.equal(layout.columns, 3); assert.equal(layout.rows, 4);
      assert.ok(Math.abs(layout.monthWidth * 3 + layout.horizontalPadding * 2 + layout.gap * 2 - width) < 0.001);
      assert.ok(Math.abs(layout.contentHeight - height) < 0.001);
      assert.equal(layout.maxScroll, 0);
      assert.ok(layout.dayFont * 1.2 < (layout.monthWidth - 4) / 7, 'two-digit dates remain within their fixed column');
    }
  }
});

test('pinch reflows to larger text and taller months within the fixed viewport; overflow is vertical', () => {
  const base = calendarYearLayout(390, 700, 1);
  for (const zoom of [0.7, 1.25, 1.4, 1.75, 2, 2.5]) {
    const current = calendarYearLayout(390, 700, zoom);
    assert.equal(current.columns, zoom >= 2 ? 1 : zoom >= 1.4 ? 2 : 3);
    assert.ok(Math.abs(current.monthWidth * current.columns + current.horizontalPadding * 2 +
      current.gap * (current.columns - 1) - 390) < 0.001);
    assert.equal(current.monthHeight, base.monthHeight * zoom);
    assert.equal(current.maxScroll > 0, zoom > 1);
    if (zoom > 1) assert.ok(current.titleFont >= base.titleFont);
    if (zoom >= 1.4) assert.ok(current.dayFont > base.dayFont);
  }
  assert.equal(calendarYearLayout(390, 700, 2).dayFont, base.dayFont * 2);
  for (const value of [NaN, Infinity, -1, 0]) {
    const current = calendarYearLayout(value, value, value, value);
    assert.ok(Number.isFinite(current.monthWidth) && Number.isFinite(current.dayFont));
    assert.ok(current.monthWidth > 0 && current.monthHeight > 0);
  }
});
