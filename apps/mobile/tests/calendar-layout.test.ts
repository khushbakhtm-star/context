import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarGridLayout, calendarZoomOffsets, normalizeCalendarZoom, parseCalendarMinute, revealCalendarDay } from '../src/utils/calendar-layout';
import { minuteLabel } from '../src/utils/time';

test('a day fills the visible ledger while multi-day views retain readable swipeable columns', () => {
  const single = calendarGridLayout(360, 1);
  assert.equal(single.dayWidth, 272);
  assert.equal(single.contentWidth, 360);
  assert.equal(single.maxOffset, 0);
  for (const count of [3, 7] as const) {
    const layout = calendarGridLayout(360, count);
    assert.equal(layout.dayWidth, 160);
    assert.equal(layout.contentWidth, 88 + count * 160);
    assert.ok(layout.maxOffset > 0);
  }
  assert.equal(calendarGridLayout(1400, 7).maxOffset, 0, 'a wide screen can display every date without horizontal clipping');
});

test('focus reveals the exact date beyond the pinned rail and preserves an already visible column', () => {
  const layout = calendarGridLayout(360, 7);
  assert.equal(revealCalendarDay(0, 0, layout), 0);
  assert.equal(revealCalendarDay(0, 1, layout), 48);
  assert.equal(revealCalendarDay(48, 1, layout), 48);
  assert.equal(revealCalendarDay(48, 0, layout), 0);
  const last = revealCalendarDay(0, 6, layout);
  assert.equal(last, layout.maxOffset);
  assert.equal(6 * layout.dayWidth + layout.dayWidth - last, layout.viewportWidth - layout.railWidth);
  assert.equal(revealCalendarDay(last, -1, layout), last);
});

test('range end times preserve AM/PM boundaries and reject another day’s midnight', () => {
  assert.equal(parseCalendarMinute('12:00 AM'), 0);
  assert.equal(parseCalendarMinute('12:00 pm'), 720);
  assert.equal(parseCalendarMinute('10:20 AM'), 620);
  assert.equal(parseCalendarMinute('23:59'), 1439);
  for (const value of ['24:00', '0:00 AM', '13:00 PM', '10:60', '10', 'text']) assert.equal(parseCalendarMinute(value), null);
});

test('zoom scales both axes and exposes adjacent dates in Day mode without changing its anchor', () => {
  assert.equal(normalizeCalendarZoom(undefined), 1);
  assert.equal(normalizeCalendarZoom('1.5'), 1);
  assert.equal(normalizeCalendarZoom(Number.NaN), 1);
  assert.equal(normalizeCalendarZoom(0.1), 0.5);
  assert.equal(normalizeCalendarZoom(8), 2.5);
  const small = calendarGridLayout(360, 1, 0.5);
  assert.equal(small.rowHeight, 17);
  assert.equal(small.dayWidth, 136);
  assert.equal(small.railWidth, 52);
  assert.ok(small.dayCount > 1 && small.dayCount <= 7);
  const large = calendarGridLayout(360, 1, 2);
  assert.equal(large.rowHeight, 68);
  assert.equal(large.dayWidth, 544);
  assert.equal(large.dayCount, 1);
  assert.equal(calendarGridLayout(360, 1, 2, small.dayCount).dayCount, small.dayCount,
    'buffered adjacent dates remain available when zooming into an edited date');
});

test('zoom anchors retain the minute and day under the focal point, and clamp at day boundaries', () => {
  const anchor = { minute: 600, day: 4, viewportX: 220, viewportY: 150 };
  for (const zoom of [0.5, 1, 2.5]) {
    const layout = calendarGridLayout(360, 7, zoom);
    const offset = calendarZoomOffsets(anchor, layout, 500);
    assert.equal(anchor.minute * layout.rowHeight - offset.y, anchor.viewportY);
    assert.equal(layout.railWidth + anchor.day * layout.dayWidth - offset.x, anchor.viewportX);
  }
  const layout = calendarGridLayout(360, 7, 0.5);
  assert.deepEqual(calendarZoomOffsets({ minute: 0, day: 0, viewportX: 220, viewportY: 150 }, layout, 500), { x: 0, y: 0 });
  assert.equal(calendarZoomOffsets({ minute: 1440, day: 7, viewportX: 0, viewportY: 0 }, layout, 500).y,
    1440 * layout.rowHeight - 500);
});

test('focusing an oversized zoomed column reveals its text start rather than its far right edge', () => {
  const layout = calendarGridLayout(360, 3, 2.5);
  assert.ok(layout.dayWidth > layout.viewportWidth - layout.railWidth);
  assert.equal(revealCalendarDay(0, 1, layout), layout.dayWidth);
  assert.equal(revealCalendarDay(layout.maxOffset, 2, layout), layout.dayWidth * 2);
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
  assert.equal(small.railWidth, 23, 'a passive label needs no 44dp touch-target minimum');
  assert.ok(small.railWidth >= 41.2 * small.zoom + 2);
  assert.equal(calendarGridLayout(360, 1, 1, 1, Number.NaN).railWidth, 88, 'invalid native measurements keep the safe fallback');
});

test('changing clock label width preserves the focal date and minute when the rail gets narrower', () => {
  const anchor = { minute: 791.5, day: 4.25, viewportX: 220, viewportY: 160 };
  for (const width of [66.2, 41.2, 85]) {
    const layout = calendarGridLayout(360, 7, 1.5, 7, width);
    const offset = calendarZoomOffsets(anchor, layout, 500);
    assert.equal(layout.railWidth + anchor.day * layout.dayWidth - offset.x, anchor.viewportX);
    assert.equal(anchor.minute * layout.rowHeight - offset.y, anchor.viewportY);
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
