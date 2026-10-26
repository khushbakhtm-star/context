import assert from 'node:assert/strict';
import test from 'node:test';
import { finishCellActivation, type CellActivationTap } from '../src/utils/cell-activation';
import { beginInlineCellTap, trackInlineCellTap } from '../src/utils/minute-interactions';
import { loadCalendarMinuteSelection } from '../src/utils/calendar-grid';

const key = '2026-10-25:600';
const point = { x: 120, y: 360 };
const tap = (at: number, previous: CellActivationTap | null = null, selectedKey = key, editingKey: string | null = null) =>
  finishCellActivation(beginInlineCellTap(selectedKey, point, at - 70), selectedKey, point, at, previous, editingKey);

test('a first tap selects and only a nearby quick second tap on the same cell edits', () => {
  const first = tap(1000); assert.equal(first.action, 'select');
  assert.equal(tap(1200, first.next).action, 'edit');
  assert.equal(tap(1400, first.next).action, 'select', 'a later repeated single tap only selects');
  assert.equal(tap(1200, first.next, '2026-10-26:600').action, 'select');
  assert.equal(tap(900, first.next).action, 'select', 'a clock rollback cannot synthesize a double tap');
  assert.equal(finishCellActivation(beginInlineCellTap(key, { x: 170, y: 360 }, 1100), key,
    { x: 170, y: 360 }, 1200, first.next).action, 'select', 'a distant spot is a new selection');
});

test('drag, hold, pinch and cancelled touches cannot open editing or preserve a double-tap candidate', () => {
  const previous = tap(1000).next;
  const start = beginInlineCellTap(key, point, 1100);
  for (const touch of [null, trackInlineCellTap(start, { x: 120, y: 390 }),
    trackInlineCellTap(start, point, 2), beginInlineCellTap(key, point, 800)]) {
    const result = finishCellActivation(touch, key, point, 1200, previous);
    assert.equal(result.action, 'none'); assert.equal(result.next, null);
  }
  assert.equal(finishCellActivation(start, key, { x: Number.NaN, y: 360 }, 1200, previous).action, 'none');
});

test('caret taps in an already editing cell leave editing alone and never become a popup action', () => {
  const result = tap(1200, tap(1000).next, key, key);
  assert.equal(result.action, 'caret'); assert.equal(result.next, null);
  assert.equal(tap(1300, null, '2026-10-25:601', key).action, 'select');
});

test('a double-tap edit request supersedes the pending single-tap selection load', async () => {
  const state = { mounted: true, rangeKey: 'range', token: 1, visibleDays: ['2026-10-25'] };
  let resolve!: (value: null) => void;
  const pending = new Promise<null>((done) => { resolve = done; });
  const readPlans = () => [];
  const first = tap(1000); assert.equal(first.action, 'select');
  const selection = loadCalendarMinuteSelection({ rangeKey: 'range', token: 1, dateKey: '2026-10-25', minuteIndex: 600 },
    { readEntry: () => pending, readPlans, currentState: () => state });
  const second = tap(1150, first.next); assert.equal(second.action, 'edit');
  state.token = 2;
  const editing = await loadCalendarMinuteSelection({ rangeKey: 'range', token: 2, dateKey: '2026-10-25', minuteIndex: 600 },
    { readEntry: async () => null, readPlans, currentState: () => state });
  resolve(null);
  assert.equal(await selection, null); assert.equal(editing?.minuteIndex, 600);
});
