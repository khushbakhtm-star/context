import assert from 'node:assert/strict';
import test from 'node:test';
import { activityGroupDragGrip, activityGroupDragScrollOffsets, activityGroupDropTarget,
  type ActivityGroupDragGeometry } from '../src/utils/activity-group-drag';

const dates = ['2026-10-25', '2026-10-27', '2026-11-02'];
const geometry = (changes: Partial<ActivityGroupDragGeometry> = {}): ActivityGroupDragGeometry => ({
  left: 20, top: 150, width: 390, height: 500, offsetX: 0, offsetY: 730 * 34,
  railWidth: 70, dayWidth: 160, rowHeight: 34, dates, ...changes,
});

test('a group remains anchored to its grabbed minute at every zoom and moves whole across exact date columns', () => {
  const source = { dateKey: dates[0]!, startMinute: 739, endMinute: 747 };
  for (const rowHeight of [17, 34, 85]) {
    const value = geometry({ rowHeight, offsetY: 735 * rowHeight, height: 1200, width: 650 });
    const x = value.left + value.railWidth + 80;
    const y = value.top + (742.5 * rowHeight - value.offsetY);
    const grip = activityGroupDragGrip(x, y, value, source)!;
    assert.deepEqual(activityGroupDropTarget(x, y, value, grip), { ...source, column: 0 });
    assert.deepEqual(activityGroupDropTarget(x + value.dayWidth, y - 3 * rowHeight, value, grip),
      { dateKey: dates[1], startMinute: 736, endMinute: 744, column: 1 });
    assert.deepEqual(activityGroupDropTarget(x + 2 * value.dayWidth, y + 2 * rowHeight, value, grip),
      { dateKey: dates[2], startMinute: 741, endMinute: 749, column: 2 });
  }
});

test('a group whose first minutes are scrolled above the viewport never jumps on pickup', () => {
  const source = { dateKey: dates[1]!, startMinute: 700, endMinute: 800 };
  const value = geometry({ offsetY: 750 * 34, offsetX: 160 });
  const x = value.left + value.railWidth + 70;
  const y = value.top + 5.5 * value.rowHeight;
  const grip = activityGroupDragGrip(x, y, value, source)!;
  assert.deepEqual(activityGroupDropTarget(x, y, value, grip), { ...source, column: 1 });
  assert.equal(activityGroupDropTarget(x, y + 3 * value.rowHeight, value, grip)!.startMinute, 703);
});

test('the complete group duration clamps at midnight and stays inside actual displayed dates', () => {
  const value = geometry({ offsetY: 0 });
  const grip = activityGroupDragGrip(170, 200, value, { dateKey: dates[0]!, startMinute: 0, endMinute: 8 })!;
  assert.deepEqual(activityGroupDropTarget(-10000, -10000, value, grip),
    { dateKey: dates[0], startMinute: 0, endMinute: 8, column: 0 });
  const bottom = geometry({ offsetY: 1440 * 34 - 500, offsetX: 160 });
  assert.deepEqual(activityGroupDropTarget(10000, 10000, bottom, { x: 0, y: 0, duration: 9 }),
    { dateKey: dates[2], startMinute: 1431, endMinute: 1439, column: 2 });
  assert.equal(activityGroupDropTarget(170, 400, value, { x: 0, y: 0, duration: 1440 })!.startMinute, 0);
});

test('edge autoscroll advances both axes at a bounded speed and recalculates a held destination', () => {
  let value = geometry();
  const source = { dateKey: dates[1]!, startMinute: 740, endMinute: 749 };
  const x = value.left + value.width - 1, y = value.top + value.height - 1;
  const grip = activityGroupDragGrip(x, y, value, source)!;
  const first = activityGroupDropTarget(x, y, value, grip)!;
  for (let tick = 0; tick < 80; tick += 1) {
    const next = activityGroupDragScrollOffsets(x, y, value);
    assert.ok(next.x >= value.offsetX && next.x - value.offsetX <= 16);
    assert.ok(next.y >= value.offsetY && next.y - value.offsetY <= 16);
    value = { ...value, offsetX: next.x, offsetY: next.y };
  }
  const last = activityGroupDropTarget(x, y, value, grip)!;
  assert.ok(last.startMinute > first.startMinute + 20);
  assert.equal(last.dateKey, dates[2]);
  assert.deepEqual(activityGroupDragScrollOffsets(value.left + 230, value.top + 250, value),
    { x: value.offsetX, y: value.offsetY });
  assert.deepEqual(activityGroupDragScrollOffsets(-10000, -10000, geometry({ offsetX: 0, offsetY: 0 })), { x: 0, y: 0 });
});

test('invalid grabs, geometry, date columns and durations cannot produce a move target', () => {
  const value = geometry();
  const source = { dateKey: dates[0]!, startMinute: 739, endMinute: 747 };
  assert.equal(activityGroupDragGrip(50, 300, value, source), null, 'time rail is not a date column');
  assert.equal(activityGroupDragGrip(200, 100, value, source), null);
  assert.equal(activityGroupDragGrip(350, 500, value, source), null, 'another date column cannot grab this group');
  assert.equal(activityGroupDragGrip(200, 200, value, source), null, 'a minute outside the group cannot grab it');
  assert.equal(activityGroupDragGrip(200, 300, value, { ...source, dateKey: '2026-10-26' }), null);
  assert.equal(activityGroupDragGrip(200, 300, value, { ...source, endMinute: 1439.5 }), null);
  assert.equal(activityGroupDragGrip(200, 300, { ...value, dates: [dates[0]!, dates[0]!] }, source), null);
  assert.equal(activityGroupDragGrip(200, 300, { ...value, dates: ['2026-02-29'] }, source), null);
  for (const patch of [{ rowHeight: 0 }, { width: 70 }, { height: 0 }, { offsetX: NaN }]) {
    assert.equal(activityGroupDropTarget(200, 300, { ...value, ...patch }, { x: 0, y: 0, duration: 9 }), null);
  }
  assert.equal(activityGroupDropTarget(200, 300, value, { x: 0, y: 0, duration: 0 }), null);
  assert.equal(activityGroupDropTarget(200, 300, value, { x: 0, y: 0, duration: 1441 }), null);
  assert.equal(activityGroupDropTarget(NaN, 300, value, { x: 0, y: 0, duration: 9 }), null);
});
