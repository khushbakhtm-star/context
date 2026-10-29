import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarFitDayZoom, calendarGridLayout, calendarPinchZoom, calendarPinchPreviewGeometry, calendarZoomOffsets, normalizeCalendarZoom } from '../src/utils/calendar-layout';
import { compactCalendarBands, compactCalendarOutlines, compactMinuteAt, type CompactMinute } from '../src/utils/calendar-compact';

test('a single inward pinch can fit all 1440 minutes with fixed Day or Week columns', () => {
  for (const height of [240, 500, 844, 1200]) for (const count of [1, 7] as const) {
    const value = calendarPinchZoom(1, 100, 20, height);
    const layout = calendarGridLayout(390, count, value, count, 44, false, height);
    assert.ok(Math.abs(layout.rowHeight * 1440 - height) < 0.05);
    assert.equal(layout.dayCount, count); assert.equal(layout.dayWidth, (390 - layout.railWidth) / count);
    assert.equal(layout.contentWidth, 390); assert.equal(layout.maxOffset, 0);
    assert.ok(layout.rowHeight > 0 && layout.rowHeight < 1);
  }
  const comfortable = calendarGridLayout(390, 7, calendarPinchZoom(1, 200, 80, 600), 7, 44, false, 600);
  assert.ok(Math.abs(comfortable.rowHeight * 1440 - 600) < 0.05);
});

test('height-only pinch is reversible away from bounds and rejects invalid distances without jumps', () => {
  const expanded = calendarPinchZoom(0.1, 100, 150, 500);
  assert.equal(expanded, 1.139063);
  assert.ok(Math.abs(calendarPinchZoom(expanded, 150, 100, 500) - 0.1) < 0.000001);
  for (const value of [0, -1, Number.NaN, Infinity]) assert.equal(calendarPinchZoom(1, 100, value, 500), 1);
  assert.equal(calendarPinchZoom(1, 0, 20, 500), 1);
  assert.equal(calendarPinchZoom(1, 100, 1000000, 500), 2.5);
  assert.equal(calendarPinchZoom(1, 100, 0.01, 500), calendarFitDayZoom(500));
  assert.equal(normalizeCalendarZoom(Number.NaN), 1);
  assert.ok(normalizeCalendarZoom(0.0122549) > 0.012, 'fine precision must not round a full-day row to zero');
});

test('fractional-density geometry preserves continuous minute coordinates and bounded anchors', () => {
  const layout = calendarGridLayout(390, 7, 0.1, 7, 44, false, 500);
  const anchor = { minute: 791.25, day: 3, viewportX: 120, viewportY: 140 };
  const offset = calendarZoomOffsets(anchor, layout, 500);
  assert.ok(Math.abs(anchor.minute * layout.rowHeight - offset.y - 140) < 0.000001);
  const fit = calendarGridLayout(390, 7, calendarFitDayZoom(500), 7, 44, false, 500);
  for (const minute of [0, 1, 60, 719, 720, 1439]) assert.equal(compactMinuteAt((minute + 0.25) * fit.rowHeight, fit.rowHeight), minute);
  assert.equal(compactMinuteAt(1440 * fit.rowHeight, fit.rowHeight), null);
  assert.equal(compactMinuteAt(-1, fit.rowHeight), null); assert.equal(compactMinuteAt(1, 0), null);
  assert.deepEqual(calendarZoomOffsets(anchor, fit, 500), { x: 0, y: 0 });
});

test('passive pinch transforms keep the same focal minute and cover the full viewport without changing date widths', () => {
  for (const height of [240, 500, 844]) for (const count of [1, 7] as const) {
    const anchor = { minute: 731.25, day: count - 1, viewportX: 120, viewportY: height / 2 };
    const base = calendarGridLayout(390, count, 1, count, 44, false, height);
    for (const zoom of [calendarFitDayZoom(height), 0.27, 0.5001, 1.125, 2.5]) {
      const target = calendarGridLayout(390, count, zoom, count, 44, false, height);
      const preview = calendarPinchPreviewGeometry(anchor, base.rowHeight, target.rowHeight, height);
      const offset = calendarZoomOffsets(anchor, target, height);
      assert.equal(preview.offset, offset.y);
      assert.equal(preview.translateY + preview.offset, 0);
      assert.equal(preview.scaleY * preview.inverseScaleY, 1);
      assert.ok(preview.translateY <= 0);
      assert.ok(1440 * base.rowHeight * preview.scaleY + preview.translateY >= height - 1e-6);
      assert.equal(target.dayWidth, base.dayWidth);
      if (offset.y > 0 && offset.y < 1440 * target.rowHeight - height) {
        assert.ok(Math.abs(anchor.minute * base.rowHeight * preview.scaleY + preview.translateY - anchor.viewportY) < 1e-6);
      }
    }
  }
  const before = calendarGridLayout(390, 1, 0.5).rowHeight;
  assert.ok(calendarGridLayout(390, 1, 0.5001).rowHeight > before, 'small gestures must not jump between rounded pixel heights');
});

test('compact overview keeps exact coalesced event bounds and repeated notes without minute controls', () => {
  const cells: CompactMinute[] = Array.from({ length: 1440 }, (_, minute) => minute < 420
    ? { color: '#0B8043', groupId: 'activity_night', title: 'Rest', text: 'Resting', textColor: '#ffffff' } : {});
  const before = JSON.stringify(cells); const runs = compactCalendarBands(cells);
  assert.deepEqual(runs, [{ color: '#0B8043', groupId: 'activity_night', title: 'Rest', text: 'Resting', textColor: '#ffffff', startMinute: 0, endMinute: 420 }]);
  assert.equal(JSON.stringify(cells), before);
});

test('high-entropy colors have a strict overview node budget and cannot invent exact event labels', () => {
  const cells = Array.from({ length: 1440 }, (_, minute) => ({ color: minute % 2 ? '#ffffff' : '#000000',
    groupId: `activity_${minute}`, title: `Item ${minute}`, text: `Note ${minute}` }));
  const before = JSON.stringify(cells); const runs = compactCalendarBands(cells);
  assert.ok(runs.length <= 192);
  assert.ok(runs.every((run) => run.mixed && !run.title && !run.text && !run.groupId));
  assert.equal(JSON.stringify(cells), before, 'overview summaries must never alter minute data');
  assert.throws(() => compactCalendarBands(cells.slice(1)), /Invalid/);
});

test('one compact event outline spans different internal colors and notes without duplicating its title', () => {
  const cells: CompactMinute[] = Array.from({ length: 1440 }, (_, minute) => minute >= 500 && minute < 620
    ? { groupId: 'activity_one', title: 'One event', color: minute % 2 ? '#0B8043' : '#F4511E', text: `Note ${minute}`, textColor: '#111111' } : {});
  assert.deepEqual(compactCalendarOutlines(cells), [{ groupId: 'activity_one', title: 'One event', textColor: '#111111', startMinute: 500, endMinute: 620 }]);
  const many = cells.map((_cell, minute) => ({ groupId: `activity_${minute}`, title: 'Small event' }));
  assert.equal(compactCalendarOutlines(many).length, 96);
});
