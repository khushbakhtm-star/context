import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarCellTextLayout, calendarCellTextOpacity, calendarCellTextScale,
  calendarReadableMinuteWindow } from '../src/utils/calendar-cell-text';
import { calendarPinchOffsetRange, calendarPinchPreviewGeometry } from '../src/utils/calendar-layout';

function interpolate(input: number, graph: { inputRange: number[]; outputRange: number[] }) {
  const { inputRange: xs, outputRange: ys } = graph;
  if (input <= xs[0]!) return ys[0]!;
  if (input >= xs.at(-1)!) return ys.at(-1)!;
  const right = xs.findIndex((value) => value >= input); const left = right - 1;
  return ys[left]! + (ys[right]! - ys[left]!) * (input - xs[left]!) / (xs[right]! - xs[left]!);
}
const near = (actual: number, expected: number, message = '') =>
  assert.ok(Math.abs(actual - expected) <= 1e-8, `${message}: ${actual} != ${expected}`);

test('all calendar notes share one zoom scale, independent of note length, width and measured paragraph height', () => {
  for (const rowHeight of [0.35, 4, 9, 13, 17, 34, 68, 85]) {
    const layout = calendarCellTextLayout(rowHeight);
    near(layout.scale, Math.min(1, rowHeight / 34));
    near(layout.fontSize, 16 * layout.scale); near(layout.lineHeight, 21 * layout.scale);
    assert.equal(layout.opacity, calendarCellTextOpacity(layout.scale));
  }
  assert.equal(calendarCellTextScale(34), 1);
  assert.equal(calendarCellTextScale(85), 1, 'large cells add lines without changing the normal font');
});

test('zoom visibility follows one standard font fade and never a per-note fit threshold', () => {
  assert.equal(calendarCellTextOpacity(6 / 16), 0);
  near(calendarCellTextOpacity(7 / 16), 0.5);
  assert.equal(calendarCellTextOpacity(8 / 16), 1);
  let previous = 0;
  for (let step = 0; step <= 100; step++) {
    const opacity = calendarCellTextOpacity(step / 100);
    assert.ok(opacity >= previous && opacity >= 0 && opacity <= 1); previous = opacity;
  }
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) assert.equal(calendarCellTextOpacity(bad), 0);
});

test('one complete standard line must fit before any note or title becomes visible at a shared zoom', () => {
  for (const fontScale of [0.5, 0.85, 1, 1.4]) {
    for (const rowHeight of [0.35, 4, 9, 13, 17, 20, 29, 30, 34, 68, 85]) {
      const layout = calendarCellTextLayout(rowHeight, fontScale);
      if (layout.opacity > 0) assert.ok(layout.lineHeight + 4 <= rowHeight, 'no partially clipped first line appears');
      if (layout.lineHeight + 4 > rowHeight) assert.equal(layout.opacity, 0);
    }
  }
  assert.equal(calendarCellTextLayout(20, 1.4).opacity, 0);
  assert.equal(calendarCellTextLayout(30, 1.4).opacity, 1);
  assert.equal(calendarCellTextLayout(13, 0.5).opacity, calendarCellTextLayout(13, 1).opacity,
    'a smaller styled font cannot independently bypass the common fade');
});

test('system text size is applied exactly once and retains the shared large-text cap', () => {
  for (const [fontScale, expected] of [[0.5, 0.5], [0.85, 0.85], [1, 1], [2, 1.4], [0, 1], [-1, 1], [Number.NaN, 1]] as const) {
    const layout = calendarCellTextLayout(34, fontScale);
    near(layout.fontSize, 16 * expected); near(layout.lineHeight, 21 * expected);
    assert.equal(layout.opacity, 1);
  }
});

test('invalid zoom geometry is uniformly hidden without invalid native font values', () => {
  for (const rowHeight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(calendarCellTextScale(rowHeight), 0);
    assert.deepEqual(calendarCellTextLayout(rowHeight), { scale: 0, fontSize: 0, lineHeight: 0, opacity: 0 });
  }
});

test('bounded readable note windows include midnight and end-of-day viewport clamps without losing visible cells', () => {
  for (const viewportHeight of [320, 500, 844]) {
    for (const minute of [0, 1, 30, 720.5, 1400, 1439, 1440]) {
      for (const viewportY of [0, viewportHeight / 2, viewportHeight]) {
        const anchor = { minute, viewportY };
        const window = calendarReadableMinuteWindow(anchor, viewportHeight);
        assert.ok(window.first >= 0 && window.last <= 1439 && window.first <= window.last);
        assert.ok(window.last - window.first + 1 <= Math.ceil(viewportHeight / 9) + 6,
          'a seven-day pinch must not mount all 10,080 note controls');
        for (const rowHeight of [9, 9.01, 17, 34, 68, 85]) {
          const offset = Math.max(0, Math.min(1440 * rowHeight - viewportHeight, minute * rowHeight - viewportY));
          const first = Math.max(0, Math.floor(offset / rowHeight));
          const last = Math.min(1439, Math.ceil((offset + viewportHeight) / rowHeight) - 1);
          assert.ok(window.first <= first && window.last >= last,
            `readable viewport ${first}..${last} escaped ${window.first}..${window.last} near minute ${minute}`);
        }
      }
    }
  }
});

test('single-value native scroll interpolation preserves the focal minute and clamps at both day edges', () => {
  for (const baseRowHeight of [0.35, 8, 17, 34, 85]) {
    for (const viewportHeight of [320, 500, 844]) {
      for (const minute of [0, 1, 10, 720.5, 1430, 1439, 1440]) {
        for (const viewportY of [0, viewportHeight / 2, viewportHeight]) {
          const anchor = { minute, viewportY, day: 0, viewportX: 100 };
          const graph = calendarPinchOffsetRange(anchor, baseRowHeight, viewportHeight);
          for (let i = 1; i < graph.inputRange.length; i++) assert.ok(graph.inputRange[i]! > graph.inputRange[i - 1]!);
          const minRow = viewportHeight / 1440;
          for (let step = 0; step <= 50; step++) {
            const target = minRow + (85 - minRow) * step / 50;
            near(interpolate(target / baseRowHeight, graph),
              calendarPinchPreviewGeometry(anchor, baseRowHeight, target, viewportHeight).translateY,
              'native offset must not jump when its anchor reaches the first or last minute');
          }
        }
      }
    }
  }
});
