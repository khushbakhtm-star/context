import assert from 'node:assert/strict';
import test from 'node:test';
import { activityTextColor, beginInlineCellTap, isInlineCellTap, trackInlineCellTap } from '../src/utils/minute-interactions';

test('only a short stationary tap on the same active cell opens its options', () => {
  const tap = beginInlineCellTap('2026-10-25:270', { x: 80, y: 400 }, 1000);
  assert.equal(isInlineCellTap(tap, tap.key, { x: 82, y: 403 }, 1120), true);
  assert.equal(isInlineCellTap(null, tap.key, { x: 80, y: 400 }, 1120), false, 'the first cell tap has no active-input gesture');
  assert.equal(isInlineCellTap(tap, '2026-10-26:270', { x: 80, y: 400 }, 1120), false);
  assert.equal(isInlineCellTap(tap, tap.key, { x: 80, y: 400 }, 1500), false, 'a native text-selection hold stays native');
  assert.equal(isInlineCellTap(tap, tap.key, { x: 80, y: 400 }, 1120, true), false, 'selected text keeps its context menu');
});

test('scroll, selection-handle drags and two-finger zoom never become cell taps', () => {
  const tap = beginInlineCellTap('cell', { x: 80, y: 400 }, 1000);
  const moved = trackInlineCellTap(tap, { x: 80, y: 420 });
  assert.equal(isInlineCellTap(moved, tap.key, { x: 80, y: 400 }, 1200), false, 'moving back does not erase a drag');
  assert.equal(isInlineCellTap(trackInlineCellTap(tap, tap.origin, 2), tap.key, tap.origin, 1200), false);
  assert.equal(isInlineCellTap(beginInlineCellTap(tap.key, tap.origin, 1000, 2), tap.key, tap.origin, 1200), false);
});

test('opaque activity fills choose readable black or white defaults and reject invalid color data', () => {
  assert.equal(activityTextColor('#FFFFFF', '#888888'), '#000000');
  assert.equal(activityTextColor('#FFFF00', '#888888'), '#000000');
  assert.equal(activityTextColor('#2952A3', '#888888'), '#FFFFFF');
  assert.equal(activityTextColor('#0D7813', '#888888'), '#FFFFFF');
  assert.equal(activityTextColor('#000000', '#888888'), '#FFFFFF');
  assert.equal(activityTextColor(undefined, '#888888'), '#888888');
  assert.equal(activityTextColor('transparent', '#888888'), '#888888');
});
