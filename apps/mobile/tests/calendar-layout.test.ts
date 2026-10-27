import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarGridLayout, calendarZoomOffsets, normalizeCalendarZoom, parseCalendarMinute, revealCalendarDay } from '../src/utils/calendar-layout';
import { minuteLabel } from '../src/utils/time';

test('a day fills the visible ledger and all multi-day columns fit on one fixed page', () => {
  const single = calendarGridLayout(360, 1);
  assert.equal(single.dayWidth, 272);
  assert.equal(single.contentWidth, 360);
  assert.equal(single.maxOffset, 0);
  for (const count of [3, 7] as const) {
    const layout = calendarGridLayout(360, count);
    assert.equal(layout.dayWidth, 272 / count);
    assert.equal(layout.contentWidth, 360);
    assert.equal(layout.maxOffset, 0);
  }
  assert.equal(calendarGridLayout(1400, 7).maxOffset, 0, 'a wide screen can display every date without horizontal clipping');
});

test('focusing any date retains the complete page without horizontal offsets', () => {
  const layout = calendarGridLayout(360, 7);
  assert.equal(revealCalendarDay(0, 0, layout), 0);
  assert.equal(revealCalendarDay(0, 1, layout), 0);
  assert.equal(revealCalendarDay(48, 1, layout), 0);
  assert.equal(revealCalendarDay(48, 0, layout), 0);
  const last = revealCalendarDay(0, 6, layout);
  assert.equal(last, layout.maxOffset);
  assert.ok(Math.abs(7 * layout.dayWidth - last - (layout.viewportWidth - layout.railWidth)) < 0.000001);
  assert.equal(revealCalendarDay(last, -1, layout), last);
});

test('range end times preserve AM/PM boundaries and reject another day’s midnight', () => {
  assert.equal(parseCalendarMinute('12:00 AM'), 0);
  assert.equal(parseCalendarMinute('12:00 pm'), 720);
  assert.equal(parseCalendarMinute('10:20 AM'), 620);
  assert.equal(parseCalendarMinute('23:59'), 1439);
  for (const value of ['24:00', '0:00 AM', '13:00 PM', '10:60', '10', 'text']) assert.equal(parseCalendarMinute(value), null);
});

test('Day zoom changes minute density while retaining one full-width date column', () => {
  assert.equal(normalizeCalendarZoom(undefined), 1);
  assert.equal(normalizeCalendarZoom('1.5'), 1);
  assert.equal(normalizeCalendarZoom(Number.NaN), 1);
  assert.equal(normalizeCalendarZoom(0.1), 0.5);
  assert.equal(normalizeCalendarZoom(8), 2.5);
  const small = calendarGridLayout(360, 1, 0.5);
  assert.equal(small.rowHeight, 17);
  assert.equal(small.dayWidth, 272);
  assert.equal(small.railWidth, 88);
  assert.equal(small.dayCount, 1);
  assert.equal(small.maxOffset, 0);
  const large = calendarGridLayout(360, 1, 2);
  assert.equal(large.rowHeight, 68);
  assert.equal(large.dayWidth, 272);
  assert.equal(large.dayCount, 1);
  assert.equal(calendarGridLayout(360, 1, 2, 7).dayCount, 1,
    'legacy buffered dates cannot introduce another date into Day view');
});

test('an explicit Day reset clears the zoomed date buffer and restores one full-width day', () => {
  for (const width of [360, 412, 768]) {
    const previous = calendarGridLayout(width, 1, 0.5, 1, 65);
    assert.equal(previous.dayCount, 1);
    const reset = calendarGridLayout(width, 1, 1, 1, 65);
    assert.equal(reset.dayCount, 1);
    assert.equal(reset.dayWidth, width - reset.railWidth);
    assert.equal(reset.maxOffset, 0);
  }
});

test('vertical zoom retains the focal minute with fixed horizontal geometry and clamps at day boundaries', () => {
  const anchor = { minute: 600, day: 4, viewportX: 220, viewportY: 150 };
  for (const zoom of [0.5, 1, 2.5]) {
    const layout = calendarGridLayout(360, 7, zoom);
    const offset = calendarZoomOffsets(anchor, layout, 500);
    assert.equal(anchor.minute * layout.rowHeight - offset.y, anchor.viewportY);
    assert.equal(offset.x, 0, 'horizontal geometry remains fixed while minute density changes');
  }
  const layout = calendarGridLayout(360, 7, 0.5);
  assert.deepEqual(calendarZoomOffsets({ minute: 0, day: 0, viewportX: 220, viewportY: 150 }, layout, 500), { x: 0, y: 0 });
  assert.equal(calendarZoomOffsets({ minute: 1440, day: 7, viewportX: 0, viewportY: 0 }, layout, 500).y,
    1440 * layout.rowHeight - 500);
});

test('zoom never enlarges columns beyond the page or requires a sideways reveal', () => {
  const layout = calendarGridLayout(360, 3, 2.5);
  assert.equal(layout.dayWidth, (layout.viewportWidth - layout.railWidth) / 3);
  assert.equal(revealCalendarDay(0, 1, layout), 0);
  assert.equal(revealCalendarDay(layout.maxOffset, 2, layout), 0);
});

test('native-measured 12-hour and 24-hour rails fit time text with two pixels of total padding', () => {
  const twelve = calendarGridLayout(360, 1, 1, 1, 66.2);
  const twentyFour = calendarGridLayout(360, 1, 1, 1, 41.2);
  assert.equal(twelve.railWidth, 69);
  assert.equal(twentyFour.railWidth, 44);
  assert.equal(twelve.railWidth + twelve.dayWidth, 360);
  assert.equal(twentyFour.railWidth + twentyFour.dayWidth, 360,
    'date headers and minute cells share the same first-column boundary and full remaining width');
  const small = calendarGridLayout(360, 7, 0.5, 7, 41.2);
  assert.equal(small.railWidth, 44, 'time labels keep their measured width at every vertical zoom');
  assert.ok(small.railWidth >= 41.2 + 2);
  assert.equal(calendarGridLayout(360, 1, 1, 1, Number.NaN).railWidth, 88, 'invalid native measurements keep the safe fallback');
});

test('changing clock label width retains the focal minute without introducing horizontal scrolling', () => {
  const anchor = { minute: 791.5, day: 4.25, viewportX: 220, viewportY: 160 };
  for (const width of [66.2, 41.2, 85]) {
    const layout = calendarGridLayout(360, 7, 1.5, 7, width);
    const offset = calendarZoomOffsets(anchor, layout, 500);
    assert.equal(offset.x, 0);
    assert.equal(anchor.minute * layout.rowHeight - offset.y, anchor.viewportY);
  }
});

test('all seven dates fit narrow S23 layouts at every zoom and supported font scale', () => {
  for (const viewport of [320, 360, 384, 390, 412, 768, 1400]) {
    for (const measured of [41.2, 66.2, 66.2 * 1.4]) {
      for (const count of [1, 2, 3, 4, 5, 6, 7] as const) for (const zoom of [0.5, 0.75, 1, 1.5, 2, 2.5]) {
        const layout = calendarGridLayout(viewport, count, zoom, 7, measured, true);
        assert.equal(layout.dayCount, count);
        assert.equal(layout.railWidth, Math.ceil(measured) + 2);
        assert.equal(layout.dayWidth, (viewport - layout.railWidth) / count);
        assert.ok(Math.abs(layout.railWidth + count * layout.dayWidth - viewport) < 0.000001);
        assert.equal(layout.contentWidth, viewport); assert.equal(layout.maxOffset, 0);
        assert.equal(layout.rowHeight, Math.max(17, Math.round(34 * zoom)));
      }
    }
  }
});

test('12-hour and 24-hour labels round-trip inclusive range minutes across midnight and noon', () => {
  for (const [minute, twelve, twentyFour] of [
    [0, '12:00 AM', '00:00'], [720, '12:00 PM', '12:00'], [791, '1:11 PM', '13:11'], [1439, '11:59 PM', '23:59'],
  ] as const) {
    assert.equal(minuteLabel(minute, true), twelve);
    assert.equal(minuteLabel(minute, false), twentyFour);
    assert.equal(parseCalendarMinute(twelve), minute);
    assert.equal(parseCalendarMinute(twentyFour), minute);
  }
});
