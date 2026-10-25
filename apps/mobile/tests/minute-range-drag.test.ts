import assert from 'node:assert/strict';
import test from 'node:test';
import { minuteAtDragPosition, minuteDragScrollOffset } from '../src/utils/minute-range-drag';

test('a fill-handle drag selects earlier and later minutes from the scrolled viewport', () => {
  const top = 200, height = 500, row = 34, offset = 759 * row;
  assert.equal(minuteAtDragPosition(top + 8 * row + 2, top, height, offset, row), 767);
  assert.equal(minuteAtDragPosition(top + 2, top, height, offset, row), 759);
  assert.equal(minuteAtDragPosition(top + 4 * row + 2, top, height, offset, row), 763);
});

test('minute geometry clamps to the visible edge and day boundaries at every zoom', () => {
  for (const row of [17, 34, 85]) {
    assert.equal(minuteAtDragPosition(-1000, 100, 500, 0, row), 0);
    assert.equal(minuteAtDragPosition(9000, 100, 500, 1440 * row - 500, row), 1439);
    assert.equal(minuteAtDragPosition(100, 100, 500, 100 * row, row), 100);
  }
  assert.equal(minuteAtDragPosition(NaN, 0, 500, 0, 34), null);
  assert.equal(minuteAtDragPosition(100, 0, 500, 0, 0), null);
});

test('edge autoscroll moves both ways at a bounded speed and stops in the viewport middle', () => {
  const offset = 759 * 34;
  assert.equal(minuteDragScrollOffset(400, 200, 500, offset, 34), offset);
  const up = minuteDragScrollOffset(200, 200, 500, offset, 34);
  const down = minuteDragScrollOffset(700, 200, 500, offset, 34);
  assert.ok(up < offset && offset - up <= 16);
  assert.ok(down > offset && down - offset <= 16);
  assert.equal(minuteDragScrollOffset(-500, 200, 500, 0, 34), 0);
  assert.equal(minuteDragScrollOffset(9000, 200, 500, 1440 * 34 - 500, 34), 1440 * 34 - 500);
});

test('a held edge drag can reach minutes beyond the initial viewport', () => {
  let offset = 759 * 34;
  const first = minuteAtDragPosition(699, 200, 500, offset, 34)!;
  for (let tick = 0; tick < 60; tick += 1) offset = minuteDragScrollOffset(699, 200, 500, offset, 34);
  assert.ok(minuteAtDragPosition(699, 200, 500, offset, 34)! > first + 20);
});
