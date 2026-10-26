import assert from 'node:assert/strict';
import test from 'node:test';
import { monthAgendaItems } from '../src/utils/month-agenda';
import { localDateAtMinute } from '../src/utils/time';
import type { ActivitySegment, MinuteEntry, PlannedEvent } from '../src/types';

const day = '2026-10-25';
function actual(start: number, end: number, title?: string, blockId = 'coffee'): ActivitySegment {
  const entries: MinuteEntry[] = Array.from({ length: end - start + 1 }, (_, index) => ({
    id: `${blockId}-${start + index}`, dateKey: day, minuteIndex: start + index,
    text: index ? 'Talk to mum about making a doctor appointment' : 'Make coffee',
    categoryId: 'family', blockId, source: 'manual', createdAt: '', updatedAt: '',
  }));
  return { segmentKey: `${day}:${blockId}:${start}-${end}`, blockId, dateKey: day,
    startMinute: start, endMinute: end, categoryId: 'family', entries, activityTitle: title };
}
function plan(id: string, start: number, end: number): PlannedEvent {
  return { id, calendarId: 'calendar', title: 'Planned coffee', color: '#A47AE2',
    startDate: localDateAtMinute(day, start), endDate: localDateAtMinute(day, end), allDay: false };
}

test('a named activity stays one month item while each minute retains its own note', () => {
  const segment = actual(12 * 60 + 39, 12 * 60 + 47, 'Make coffee');
  const result = monthAgendaItems(day, [segment], [plan('planned', 12 * 60 + 39, 12 * 60 + 48)]);
  assert.equal(result.length, 1);
  assert.deepEqual([result[0]!.title, result[0]!.startMinute, result[0]!.endMinute, result[0]!.kind],
    ['Make coffee', 759, 767, 'actual']);
  assert.equal(segment.entries[1]!.text, 'Talk to mum about making a doctor appointment');
});

test('actual minutes override only their part of a longer plan without duplicate coverage', () => {
  const result = monthAgendaItems(day, [actual(555, 570, 'Actual coffee')], [plan('planned', 540, 600)]);
  assert.deepEqual(result.map((item) => [item.kind, item.startMinute, item.endMinute]), [
    ['plan', 540, 554], ['actual', 555, 570], ['plan', 571, 599],
  ]);
});

test('overnight plans clip at the selected day; all-day events remain day items', () => {
  const overnight = { ...plan('overnight', 1430, 1440), endDate: localDateAtMinute('2026-10-26', 10) };
  const allDay = { ...plan('all-day', 0, 1440), allDay: true, title: 'Visit family' };
  const first = monthAgendaItems(day, [], [overnight, allDay, allDay]);
  assert.equal(first.length, 2);
  assert.equal(first[0]!.allDay, true);
  assert.deepEqual([first[1]!.startMinute, first[1]!.endMinute], [1430, 1439]);
  const second = monthAgendaItems('2026-10-26', [], [overnight, allDay]);
  assert.deepEqual(second.map((item) => [item.startMinute, item.endMinute]), [[0, 9]]);
});

test('a stale device echo of a locally edited block is hidden using its exact ownership marker', () => {
  const segment = actual(765, 770, 'Coffee now', 'coffee-block');
  const stale = { ...plan('old-echo', 759, 765), notes: 'Context block: coffee-block\nContext projection: old' };
  const separate = { ...plan('unrelated', 759, 765), notes: 'Context block: other-block' };
  const result = monthAgendaItems(day, [segment], [stale, separate]);
  assert.equal(result.filter((item) => item.kind === 'plan').length, 1);
  assert.match(result.find((item) => item.kind === 'plan')!.id, /unrelated/);
});

test('distinct activity blocks stay distinct and events from other dates or invalid ranges are ignored', () => {
  const a = actual(100, 102, 'First activity', 'first');
  const b = actual(103, 105, 'Second activity', 'second');
  const otherDay = { ...actual(110, 115), dateKey: '2026-10-26' };
  const invalid = { ...plan('invalid', 300, 350), startDate: new Date('invalid') };
  const reverse = plan('reverse', 400, 399);
  const result = monthAgendaItems(day, [a, b, otherDay], [invalid, reverse]);
  assert.deepEqual(result.map((item) => item.title), ['First activity', 'Second activity']);
});
