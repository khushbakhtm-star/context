import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivitySegment, MinuteEntry, PlannedEvent } from '../src/types';
import { scheduleAgendaItems, scheduleDescription, schedulePlanDescription, scheduleTimeRange } from '../src/utils/schedule-agenda';
import { localDateAtMinute } from '../src/utils/time';

const day = '2026-10-25';
function actual(start: number, end: number, blockId = 'activity_coffee', categoryId = 'family'): ActivitySegment {
  const entries: MinuteEntry[] = Array.from({ length: end - start + 1 }, (_, index) => ({
    id: `${blockId}-${start + index}`, dateKey: day, minuteIndex: start + index,
    text: index ? `Minute note ${start + index}` : `First note ${start}`,
    categoryId, blockId, source: 'manual', createdAt: '', updatedAt: '',
  }));
  return { segmentKey: `${day}:${blockId}:${start}-${end}`, blockId, dateKey: day,
    startMinute: start, endMinute: end, categoryId, entries, activityTitle: 'Make coffee' };
}
function plan(id: string, start: number, end: number): PlannedEvent {
  return { id, calendarId: 'calendar', title: 'Planned coffee', notes: 'Bring the mug', color: '#A47AE2',
    startDate: localDateAtMinute(day, start), endDate: localDateAtMinute(day, end), allDay: false };
}

test('a named multicolor activity is one schedule row with every exact timestamped minute note', () => {
  const first = actual(759, 760); first.entries[0]!.text = ' Make coffee\nUse the small mug ';
  const second = actual(761, 762, 'activity_coffee', 'work');
  const result = scheduleAgendaItems(day, [second, first], [plan('echo', 759, 763)]);
  assert.equal(result.length, 1);
  assert.deepEqual([result[0]!.title, result[0]!.startMinute, result[0]!.endMinute], ['Make coffee', 759, 762]);
  assert.deepEqual(result[0]!.minuteNotes.map((note) => note.minuteIndex), [759, 760, 761, 762]);
  assert.match(scheduleDescription(result[0]!, '24h'), /^12:39  Make coffee\nUse the small mug /);
  assert.match(scheduleDescription(result[0]!, '12h'), /12:41 PM First note 761/);
  assert.equal(first.entries[0]!.text, ' Make coffee\nUse the small mug ', 'display aggregation cannot change the saved note');
});

test('separate groups and nonadjacent runs keep separate rows', () => {
  const result = scheduleAgendaItems(day, [actual(100, 101), actual(103, 104), actual(105, 106, 'activity_other')], []);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((item) => [item.startMinute, item.endMinute]), [[100, 101], [103, 104], [105, 106]]);
});

test('actual coverage splits plans without duplication and keeps plan descriptions', () => {
  const planned = plan('meeting', 540, 600);
  const result = scheduleAgendaItems(day, [actual(555, 570)], [planned, planned]);
  assert.deepEqual(result.map((item) => [item.kind, item.startMinute, item.endMinute]), [
    ['plan', 540, 554], ['actual', 555, 570], ['plan', 571, 599],
  ]);
  assert.deepEqual(result.filter((item) => item.kind === 'plan').map((item) => item.description), ['Bring the mug', 'Bring the mug']);
  assert.equal(scheduleTimeRange(result[0]!, '24h'), '09:00 – 09:15');
  assert.equal(scheduleTimeRange(result[2]!, '12h'), '9:31 AM – 10:00 AM');
});

test('a separately overlapping plan does not duplicate a multicolor group or hide its uncovered portions', () => {
  const result = scheduleAgendaItems(day, [actual(100, 101), actual(102, 103, 'activity_coffee', 'work')],
    [plan('overlapping', 99, 106)]);
  assert.deepEqual(result.map((item) => [item.kind, item.startMinute, item.endMinute]), [
    ['plan', 99, 99], ['actual', 100, 103], ['plan', 104, 105],
  ]);
  assert.equal(result[1]!.minuteNotes.length, 4);
});

test('all-day events stay distinct and overnight plans clip to the displayed day', () => {
  const overnight = { ...plan('overnight', 1430, 1440), endDate: localDateAtMinute('2026-10-26', 10) };
  const allDay = { ...plan('all-day', 0, 1440), allDay: true, title: 'Visit family' };
  const result = scheduleAgendaItems(day, [], [overnight, allDay, allDay]);
  assert.equal(result.length, 2);
  assert.equal(scheduleTimeRange(result[0]!, '24h'), 'All day');
  assert.equal(scheduleTimeRange(result[1]!, '24h'), '23:50 – 24:00');
  assert.equal(scheduleTimeRange(result[1]!, '12h'), '11:50 PM – 12:00 AM (+1 day)');
  const next = scheduleAgendaItems('2026-10-26', [], [overnight, allDay]);
  assert.equal(next.length, 1);
  assert.equal(scheduleTimeRange(next[0]!, '24h'), '00:00 – 00:10');
});

test('blank group members do not duplicate or replace nonblank minute descriptions', () => {
  const segment = actual(100, 102); segment.entries[1]!.text = ''; segment.entries[2]!.text = 'Talk to Mum';
  const result = scheduleAgendaItems(day, [segment], []);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]!.minuteNotes, [{ minuteIndex: 100, text: 'First note 100' }, { minuteIndex: 102, text: 'Talk to Mum' }]);
  assert.equal(scheduleTimeRange(result[0]!, '24h'), '01:40 – 01:43');
});

test('plan previews hide generated ownership metadata while preserving useful descriptions and source text', () => {
  const notes = ['Bring the mug', '--- Context minutes ---', 'Context category: family', '12:39 PM Make coffee',
    'Context projection: projection-id', '--- End Context minutes ---', 'Context block: activity_coffee',
    'Full minute record available in Context.', 'Context matters to me.'].join('\n');
  assert.equal(schedulePlanDescription(notes), 'Bring the mug\n12:39 PM Make coffee\nContext matters to me.');
  const planned = { ...plan('meeting', 759, 763), notes };
  const result = scheduleAgendaItems(day, [], [planned]);
  assert.equal(result[0]!.description, 'Bring the mug\n12:39 PM Make coffee\nContext matters to me.');
  assert.equal(planned.notes, notes);
  const segment = actual(759, 760); segment.entries[0]!.text = 'Context block: a note I typed';
  assert.equal(scheduleAgendaItems(day, [segment], [])[0]!.minuteNotes[0]!.text, 'Context block: a note I typed');
});

test('a bounded schedule preview leaves the complete minute notes available to the minute grid', () => {
  const segment = actual(100, 102); segment.entries[0]!.text = 'A'.repeat(1000);
  const item = scheduleAgendaItems(day, [segment], [])[0]!;
  const preview = scheduleDescription(item, '24h', 60);
  assert.equal(preview.length, 61); assert.ok(preview.endsWith('…'));
  assert.match(scheduleDescription(item, '24h'), /01:42 Minute note 102/);
  assert.equal(item.minuteNotes[0]!.text.length, 1000);
});
