import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarCellColor, nativeEventColor, sourceEventColor } from '../src/utils/calendar-cell-color';
import { indexCalendarDay } from '../src/utils/calendar-grid';
import { localDateAtMinute } from '../src/utils/time';
import type { PlannedEvent } from '../src/types';

test('source event colors are exact opaque display values, independent of the manual Google palette', () => {
  assert.equal(sourceEventColor('#Ab12fF', '#445566'), '#Ab12fF');
  assert.equal(sourceEventColor(undefined, '#445566'), '#445566');
  assert.equal(sourceEventColor('invalid', '#445566'), '#445566');
  assert.equal(calendarCellColor({ hasActual: false, planColor: '#123ABC' }), '#123ABC');
});

test('explicit recorded cells, blank colored cells and group-member colors override the underlying plan', () => {
  for (const color of ['#123456', '#AB8B00', '#705770']) {
    assert.equal(calendarCellColor({ hasActual: true, actualColor: color, planColor: '#abcdef' }), color);
  }
  assert.equal(calendarCellColor({ hasActual: true, actualColor: '#123456', groupColor: '#111111', planColor: '#abcdef' }), '#123456');
  assert.equal(calendarCellColor({ hasActual: false, groupColor: '#111111', planColor: '#abcdef' }), '#111111');
  assert.equal(calendarCellColor({ hasActual: true, actualColor: '#123456', previewColor: '#654321', planColor: '#abcdef' }), '#654321');
});

test('native occurrence color wins over base event, exposed event color and calendar fallback', () => {
  const start = localDateAtMinute('2026-10-25', 60);
  const event = { id: 'event', displayColor: '#112233' };
  assert.equal(nativeEventColor(event, start, { event: '#223344', [`event@${start.getTime()}`]: '#334455' }, '#445566'), '#334455');
  assert.equal(nativeEventColor(event, start, { event: '#223344' }, '#445566'), '#223344');
  assert.equal(nativeEventColor(event, start, {}, '#445566'), '#112233');
  assert.equal(nativeEventColor({ id: 'apple-event' }, start, {}, '#445566'), '#445566');
});

test('an explicit fill reset suppresses actual, group and underlying plan colors until a new fill preview is chosen', () => {
  assert.equal(calendarCellColor({ noFill: true, hasActual: true, actualColor: '#123456', groupColor: '#234567', planColor: '#345678' }), undefined);
  assert.equal(calendarCellColor({ noFill: true, hasActual: false, planColor: '#345678' }), undefined);
  assert.equal(calendarCellColor({ noFill: true, previewColor: '#567890', hasActual: true, actualColor: '#123456' }), '#567890');
});

test('every minute of an overnight or shifted plan retains full source color with an exclusive end boundary', () => {
  const day = '2026-10-25';
  const plan: PlannedEvent = { id: 'event', calendarId: 'calendar', title: 'Sleep', allDay: false,
    startDate: localDateAtMinute(day, 1438), endDate: localDateAtMinute('2026-10-26', 3), color: '#aabbcc' };
  for (const [date, expected] of [[day, [1438, 1439]], ['2026-10-26', [0, 1, 2]]] as const) {
    const indexed = indexCalendarDay(date, [], [plan]);
    assert.deepEqual([...indexed.plansByMinute.keys()], [...expected]);
    for (const plans of indexed.plansByMinute.values()) assert.equal(calendarCellColor({ hasActual: false, planColor: plans[0]!.color }), '#aabbcc');
  }
  const shifted = { ...plan, startDate: localDateAtMinute(day, 600), endDate: localDateAtMinute(day, 603) };
  assert.deepEqual([...indexCalendarDay(day, [], [shifted]).plansByMinute.keys()], [600, 601, 602]);
  assert.equal(calendarCellColor({ hasActual: false, planColor: shifted.color }), '#aabbcc');
});
