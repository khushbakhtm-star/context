import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarCellTextFitRange, calendarCellTextOpacity, calendarCellTextScale, calendarMeasuredTextHeight, calendarMeasuredTextWidth,
  calendarReadableMinuteWindow } from '../src/utils/calendar-cell-text';
import { calendarPinchOffsetRange, calendarPinchPreviewGeometry } from '../src/utils/calendar-layout';

function interpolate(input: number, graph: { inputRange: number[]; outputRange: number[] }) {
  const { inputRange: xs, outputRange: ys } = graph;
  if (input <= xs[0]!) return ys[0]!;
  if (input >= xs.at(-1)!) return ys.at(-1)!;
  const right = xs.findIndex((value) => value >= input);
  const left = right - 1;
  return ys[left]! + (ys[right]! - ys[left]!) * (input - xs[left]!) / (xs[right]! - xs[left]!);
}
const near = (actual: number, expected: number, message = '') =>
  assert.ok(Math.abs(actual - expected) <= 1e-8, `${message}: ${actual} != ${expected}`);

test('whole-paragraph fit respects both cell height and normal font size instead of clipping a long note', () => {
  for (const rowHeight of [0.35, 8, 9, 17, 34, 68, 85]) {
    for (const measuredHeight of [21, 42, 210, 21000]) {
      const space = Math.max(0, rowHeight - 4);
      const fit = calendarCellTextScale(rowHeight, space, measuredHeight);
      assert.ok(fit >= 0 && fit <= 1);
      assert.ok(measuredHeight * fit <= space + 1e-9, 'the final line must fit, even for thousands of lines');
      assert.ok(fit <= rowHeight / 34 + 1e-9, 'zooming out reduces the complete paragraph uniformly');
    }
  }
  assert.equal(calendarCellTextScale(85, 81, 63), 1, 'three wrapped lines return to the normal font when room permits');
  assert.equal(calendarCellTextScale(34, 30, 21000), 30 / 21000);
});

test('missing or invalid text geometry cannot expose an unmeasured clipped paragraph', () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(calendarCellTextScale(bad, 30, 21), 0);
    assert.equal(calendarCellTextScale(34, bad, 21), 0);
    assert.equal(calendarCellTextScale(34, 30, bad), 0);
  }
  assert.equal(calendarMeasuredTextHeight([]), null);
  assert.equal(calendarMeasuredTextHeight([{ y: 0, height: 0 }]), null);
  assert.equal(calendarMeasuredTextHeight([{ y: Number.NaN, height: 21 }]), null);
  assert.equal(calendarMeasuredTextHeight([{ y: 0, height: Number.POSITIVE_INFINITY }]), null);
});

test('native measurement includes the entire wrapped paragraph and rounds outward without losing its last pixel', () => {
  const lines = [{ y: 0, height: 21 }, { y: 21.125, height: 21 }, { y: 42.25, height: 21.001 }];
  const height = calendarMeasuredTextHeight(lines)!;
  const bottom = Math.max(...lines.map((line) => line.y + line.height));
  assert.ok(height >= bottom && height - bottom < 1 / 64);
  assert.equal(calendarMeasuredTextHeight([...lines].reverse()), height, 'line order cannot omit the last extent');
});

test('native width measurement includes wide glyphs and rounds outward rather than cutting an emoji at the cell edge', () => {
  const lines = [{ width: 12 }, { width: 22.001 }, { width: 0 }, { width: 19.125 }];
  const widest = Math.max(...lines.map((line) => line.width));
  const width = calendarMeasuredTextWidth(lines)!;
  assert.ok(width >= widest && width - widest < 1 / 64);
  assert.equal(calendarMeasuredTextWidth([...lines].reverse()), width);
  assert.equal(calendarMeasuredTextWidth([{ width: 0 }, { width: 0 }]), 0, 'blank lines can have zero native width');
  const fit = Math.min(1, 19 / width);
  assert.ok(width * fit <= 19 + 1e-9, 'the whole wide glyph fits a narrow Week column');
});

test('missing native widths permit height-only fallback while malformed provided widths are rejected', () => {
  for (const lines of [[], [{}], [{ width: 21 }, {}]]) assert.equal(calendarMeasuredTextWidth(lines), null);
  for (const width of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(calendarMeasuredTextWidth([{ width: 21 }, { width }]), null);
  }
  assert.equal(calendarMeasuredTextWidth([{ width: '21' as unknown as number }]), null);
});

test('text shrinks before fading out and reappears continuously at a readable size', () => {
  for (const fontSize of [11, 16, 22.4]) {
    assert.equal(calendarCellTextOpacity(0, fontSize), 0);
    assert.equal(calendarCellTextOpacity(6 / fontSize, fontSize), 0);
    near(calendarCellTextOpacity(7 / fontSize, fontSize), 0.5);
    assert.equal(calendarCellTextOpacity(8 / fontSize, fontSize), 1);
    let previous = 0;
    for (let step = 0; step <= 100; step++) {
      const opacity = calendarCellTextOpacity(step / 100, fontSize);
      assert.ok(opacity >= previous && opacity >= 0 && opacity <= 1); previous = opacity;
    }
  }
  assert.equal(calendarCellTextOpacity(Number.NaN), 0);
  assert.equal(calendarCellTextOpacity(1, 0), 0);
});

test('native pinch text fits match the committed cells across compact-to-normal zoom and fixed screen insets', () => {
  for (const baseRowHeight of [0.35, 1, 8, 9, 17, 34, 85]) {
    for (const measuredHeight of [14, 21, 42, 84, 4200]) {
      for (const inset of [0, 2, 3]) {
        const graph = calendarCellTextFitRange(baseRowHeight, baseRowHeight, measuredHeight, inset);
        assert.equal(graph.inputRange.length, graph.outputRange.length);
        assert.ok(graph.inputRange.length >= 2);
        for (let i = 1; i < graph.inputRange.length; i++) assert.ok(graph.inputRange[i]! > graph.inputRange[i - 1]!);
        for (let step = 0; step <= 100; step++) {
          const targetHeight = 0.35 + (85 - 0.35) * step / 100;
          const ratio = targetHeight / baseRowHeight;
          const fit = interpolate(ratio, graph);
          const available = Math.max(0, targetHeight - inset * 2);
          near(fit, calendarCellTextScale(targetHeight, available, measuredHeight), 'preview and final font size must agree');
          assert.ok(measuredHeight * fit <= available + 1e-8);
          const finalVerticalScale = fit / ratio * ratio;
          near(finalVerticalScale, fit, 'inverse parent compensation must preserve glyph aspect ratio');
        }
      }
    }
  }
});

test('native text interpolation rejects invalid geometry rather than constructing unusable animation nodes', () => {
  for (const values of [[0, 34, 21, 2], [34, 0, 21, 2], [34, 34, 0, 2], [34, 34, 21, -1],
    [Number.NaN, 34, 21, 2], [34, Number.POSITIVE_INFINITY, 21, 2]]) {
    assert.throws(() => calendarCellTextFitRange(...values as [number, number, number, number]), /Invalid/);
  }
});

test('width-capped native pinch fits preserve whole glyphs and match final cells without changing their aspect ratio', () => {
  for (const baseRowHeight of [0.35, 1, 8, 9, 17, 34, 85]) {
    for (const measuredHeight of [14, 21, 42, 84, 4200]) {
      for (const cap of [0.1, 0.5, 19 / 22, 1]) {
        for (const inset of [0, 2, 3]) {
          const graph = calendarCellTextFitRange(baseRowHeight, baseRowHeight, measuredHeight, inset, cap);
          for (let i = 1; i < graph.inputRange.length; i++) assert.ok(graph.inputRange[i]! > graph.inputRange[i - 1]!);
          for (let step = 0; step <= 100; step++) {
            const targetHeight = 0.35 + (85 - 0.35) * step / 100;
            const ratio = targetHeight / baseRowHeight;
            const fit = interpolate(ratio, graph);
            const available = Math.max(0, targetHeight - inset * 2);
            near(fit, Math.min(cap, calendarCellTextScale(targetHeight, available, measuredHeight)),
              'a wide glyph must have the same size before and after handoff');
            assert.ok(fit >= -1e-9 && fit <= cap + 1e-9);
            assert.ok(measuredHeight * fit <= available + 1e-8);
            assert.ok(22 * fit <= 22 * cap + 1e-8, 'a 22px unbreakable glyph remains inside its capped width');
            near(fit / ratio * ratio, fit, 'width fitting cannot squash the glyph vertically');
          }
        }
      }
    }
  }
});

test('zero width allowance stays hidden and invalid width caps never create an invalid animation graph', () => {
  const hidden = calendarCellTextFitRange(0.35, 0.35, 21, 2, 0);
  assert.ok(hidden.inputRange.length >= 2);
  for (const ratio of [0, 1, 10, 100, 85 / 0.35]) assert.equal(interpolate(ratio, hidden), 0);
  for (const cap of [-0.1, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => calendarCellTextFitRange(34, 34, 21, 2, cap), /Invalid/);
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
