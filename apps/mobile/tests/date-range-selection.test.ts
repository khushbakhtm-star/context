import assert from 'node:assert/strict';
import test from 'node:test';
import { anchoredDateRange, dateAtGridPoint, isContiguousDateRange, MAX_RANGE_DAYS,
  rangeGestureSelection, rangeMonthPageTarget, type DateGridCellRect } from '../src/utils/date-range-selection';
import { isDateKey, monthDateCells } from '../src/utils/date-selection';

function grid(anchor = '2026-10-26', left = 17.5, top = 200, width = 343, rowHeight = 44): DateGridCellRect[] {
  return monthDateCells(anchor).map((cell, index) => ({ dateKey: cell.dateKey,
    x: left + (index % 7) * width / 7, y: top + Math.floor(index / 7) * rowHeight,
    width: width / 7, height: rowHeight }));
}
const center = (cell: DateGridCellRect) => [cell.x + cell.width / 2, cell.y + cell.height / 2] as const;
const civil = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;

test('ranges include both endpoints in either drag direction across months, years and leap days', () => {
  assert.deepEqual(anchoredDateRange('2026-10-30', '2026-11-02'),
    ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(anchoredDateRange('2026-11-02', '2026-10-30'),
    ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(anchoredDateRange('2026-12-31', '2027-01-02'), ['2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(anchoredDateRange('2028-03-01', '2028-02-28'), ['2028-02-28', '2028-02-29', '2028-03-01']);
  assert.deepEqual(anchoredDateRange('2026-10-26', '2026-10-26'), ['2026-10-26']);
});

test('a long drag clamps at 28 days without moving its anchor or jumping when the pointer continues', () => {
  const forward = anchoredDateRange('2026-10-26', '2026-12-01');
  assert.equal(forward.length, MAX_RANGE_DAYS);
  assert.equal(forward[0], '2026-10-26'); assert.equal(forward.at(-1), '2026-11-22');
  assert.deepEqual(anchoredDateRange('2026-10-26', '2027-05-01'), forward);
  const reverse = anchoredDateRange('2026-10-26', '2026-09-01');
  assert.equal(reverse.length, 28); assert.equal(reverse[0], '2026-09-29'); assert.equal(reverse.at(-1), '2026-10-26');
  assert.deepEqual(anchoredDateRange('2026-10-26', '2026-01-01'), reverse);
  assert.deepEqual(anchoredDateRange('2026-10-26', '2026-12-01', 3), ['2026-10-26', '2026-10-27', '2026-10-28']);
  assert.equal(anchoredDateRange('2026-10-26', '2026-12-01', 400).length, 28);
});

test('civil ranges remain consecutive through both daylight-saving transitions and supported year boundaries', () => {
  for (const [anchor, target] of [['2026-03-07', '2026-03-10'], ['2026-10-31', '2026-11-03'],
    ['1000-01-01', '1000-01-04'], ['9999-12-31', '9999-12-28']]) {
    const result = anchoredDateRange(anchor!, target!);
    assert.equal(result.length, 4);
    assert.ok(result.every(isDateKey));
    assert.ok(result.every((day, index) => index === 0 || civil(day) - civil(result[index - 1]!) === 1));
  }
  for (const invalid of ['2026-02-29', '2026-11-31', '0999-12-31', '10000-01-01', 'invalid']) {
    assert.deepEqual(anchoredDateRange(invalid, '2026-10-26'), []);
    assert.deepEqual(anchoredDateRange('2026-10-26', invalid), []);
  }
  for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(anchoredDateRange('2026-10-26', '2026-10-27', limit), []);
  }
});

test('anchored ranges satisfy bounded, ordered, inclusive geometry across many anchors and directions', () => {
  for (const month of ['2026-03-01', '2026-10-01', '2028-02-01', '2026-12-01']) {
    const days = monthDateCells(month).map((cell) => cell.dateKey);
    for (const anchor of days) for (const target of days) {
      const result = anchoredDateRange(anchor, target);
      assert.ok(result.includes(anchor)); assert.ok(result.length >= 1 && result.length <= 28);
      assert.equal(result.length, Math.min(28, Math.abs(civil(target) - civil(anchor)) + 1));
      assert.deepEqual([...result].sort(), result);
      assert.ok(result.every((day, index) => index === 0 || civil(day) - civil(result[index - 1]!) === 1));
      assert.equal(isContiguousDateRange(result), true);
      if (result.length < 28) assert.ok(result.includes(target));
    }
  }
});

test('Range validity rejects scattered dates or oversized ranges without rewriting Pick selections', () => {
  const picked = ['2026-11-01', '2026-10-26']; const original = [...picked];
  assert.equal(isContiguousDateRange(picked), false); assert.deepEqual(picked, original);
  assert.equal(isContiguousDateRange(['2026-10-27', '2026-10-26', '2026-10-26']), true);
  assert.equal(isContiguousDateRange([]), false); assert.equal(isContiguousDateRange(null), false);
  assert.equal(isContiguousDateRange(['2026-10-26', 'invalid']), false);
  const twentyNine = monthDateCells('2026-10-26').slice(0, 29).map((cell) => cell.dateKey);
  assert.equal(isContiguousDateRange(twentyNine), false);
  assert.equal(isContiguousDateRange(anchoredDateRange('2026-10-26', '2026-10-29'), 3), false);
});

test('edge-hold paging reaches either neighbor of the original anchor but cannot continue beyond useful months', () => {
  assert.equal(rangeMonthPageTarget('2026-10-20', '2026-10-26', 1), '2026-11-01');
  assert.equal(rangeMonthPageTarget('2026-10-20', '2026-11-01', 1), null);
  assert.equal(rangeMonthPageTarget('2026-10-20', '2026-10-01', -1), '2026-09-01');
  assert.equal(rangeMonthPageTarget('2026-10-20', '2026-09-01', -1), null);
  assert.equal(rangeMonthPageTarget('2026-10-20', '2026-09-01', 1), '2026-10-01');
  assert.equal(rangeMonthPageTarget('2026-10-20', '2026-08-01', 1), null);
  assert.equal(rangeMonthPageTarget('2026-12-20', '2026-12-01', 1), '2027-01-01');
  assert.equal(rangeMonthPageTarget('2027-01-20', '2027-01-01', -1), '2026-12-01');
});

test('padded anchors keep paging bounds tied to their own month and never leave supported civil years', () => {
  assert.equal(rangeMonthPageTarget('2026-09-28', '2026-10-01', 1), null);
  assert.equal(rangeMonthPageTarget('2026-09-28', '2026-10-01', -1), '2026-09-01');
  assert.equal(rangeMonthPageTarget('2026-11-08', '2026-10-01', -1), null);
  assert.equal(rangeMonthPageTarget('2026-11-08', '2026-10-01', 1), '2026-11-01');
  assert.equal(rangeMonthPageTarget('1000-01-01', '1000-01-01', -1), null);
  assert.equal(rangeMonthPageTarget('9999-12-31', '9999-12-01', 1), null);
  assert.equal(rangeMonthPageTarget('invalid', '2026-10-01', 1), null);
  assert.equal(rangeMonthPageTarget('2026-10-26', '2026-02-29', -1), null);
});

test('every allowed endpoint in a 28-day span is visible in the anchor grid or one permitted adjacent-month grid', () => {
  for (const initial of ['2026-03-01', '2026-10-01', '2028-02-01', '2026-12-01']) {
    for (const cell of monthDateCells(initial).filter((cell) => cell.inMonth)) {
      const anchor = cell.dateKey;
      const months = [initial, rangeMonthPageTarget(anchor, initial, -1), rangeMonthPageTarget(anchor, initial, 1)]
        .filter((month): month is string => month !== null);
      const visible = new Set(months.flatMap(monthDateCells).map((cell) => cell.dateKey));
      for (let offset = -27; offset <= 27; offset++) {
        const target = new Date((civil(anchor) + offset) * 86_400_000).toISOString().slice(0, 10);
        assert.equal(visible.has(target), true, `${target} must be reachable from ${anchor}`);
      }
    }
  }
});

test('measured hit rectangles resolve all 42 padded dates and shared edges without including outside pointers', () => {
  const cells = grid();
  for (const cell of cells) assert.equal(dateAtGridPoint(...center(cell), cells), cell.dateKey);
  assert.equal(dateAtGridPoint(cells[1]!.x, cells[1]!.y, cells), cells[1]!.dateKey);
  assert.equal(dateAtGridPoint(cells[7]!.x, cells[7]!.y, cells), cells[7]!.dateKey);
  assert.equal(dateAtGridPoint(17.49, 200, cells), null);
  assert.equal(dateAtGridPoint(360.5, 200, cells), null);
  assert.equal(dateAtGridPoint(17.5, 464, cells), null);
  assert.equal(dateAtGridPoint(17.5, 199.99, cells), null);
  assert.equal(cells[0]!.dateKey, '2026-09-28');
  assert.equal(cells.at(-1)!.dateKey, '2026-11-08');
});

test('invalid measurements, nonfinite coordinates and ambiguous overlapping cells never choose an arbitrary date', () => {
  const cells = grid(); const first = cells[0]!; const [x, y] = center(first);
  for (const point of [[Number.NaN, y], [x, Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY, y]]) {
    assert.equal(dateAtGridPoint(point[0]!, point[1]!, cells), null);
  }
  assert.equal(dateAtGridPoint(x, y, [{ ...first, dateKey: 'invalid' }]), null);
  assert.equal(dateAtGridPoint(x, y, [{ ...first, width: 0 }, { ...first, height: -1 }, { ...first, x: Number.NaN }]), null);
  assert.equal(dateAtGridPoint(x, y, [first, { ...first, dateKey: cells[1]!.dateKey }]), null);
  assert.equal(dateAtGridPoint(x, y, [first, { ...first }]), first.dateKey);
  assert.equal(dateAtGridPoint(...center(first), grid('2026-10-26', -100, 900)), null,
    'scrolling invalidates an old screen-coordinate sample');
});

test('drag previews handle reversed padded dates and leave committed or prior drafts untouched on invalid/multitouch samples', () => {
  const cells = grid(); const anchor = '2026-10-26'; const target = cells.find((cell) => cell.dateKey === '2026-09-28')!;
  const before = ['2026-10-01', '2026-10-05']; const committed = ['2026-10-26'];
  const preview = rangeGestureSelection(anchor, ...center(target), cells)!;
  assert.equal(preview.length, 28); assert.equal(preview[0], '2026-09-29'); assert.equal(preview.at(-1), anchor);
  for (const touches of [0, 2, 3, Number.NaN]) assert.equal(rangeGestureSelection(anchor, ...center(target), cells, touches), null);
  assert.equal(rangeGestureSelection(anchor, -1, -1, cells), null);
  assert.equal(rangeGestureSelection('invalid', ...center(target), cells), null);
  assert.deepEqual(before, ['2026-10-01', '2026-10-05']); assert.deepEqual(committed, ['2026-10-26']);
});
