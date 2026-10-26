import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrintScheduleDocument, escapePrintText, printScheduleDates } from '../src/utils/print-schedule';
import { scheduleAgendaItems, type ScheduleAgendaItem } from '../src/utils/schedule-agenda';
import { anchoredDateRange } from '../src/utils/date-range-selection';
import type { ActivitySegment } from '../src/types';

const day = '2026-10-25';
function item(changes: Partial<ScheduleAgendaItem> = {}): ScheduleAgendaItem {
  return { id: 'activity', dateKey: day, title: 'Make coffee', startMinute: 759, endMinute: 767,
    allDay: false, kind: 'actual', color: '#A47AE2', description: '', minuteNotes: [
      { minuteIndex: 759, text: 'Make coffee' }, { minuteIndex: 760, text: 'Talk to Mum about a doctor appointment' },
    ], ...changes };
}

test('print markup escapes notes, titles and descriptions, with no external assets or executable content', () => {
  const malicious = '<img src="https://example.invalid/private" onerror="fetch(\'https://example.invalid\')"><script>alert(1)</script> & "quoted"';
  const document = createPrintScheduleDocument([day], '24h');
  document.addDay(day, [item({ title: malicious, minuteNotes: [{ minuteIndex: 759, text: malicious }],
    color: '#111111;background:url(https://example.invalid)' }), item({ id: 'plan', kind: 'plan',
      title: 'Plan', minuteNotes: [], description: malicious })]);
  const html = document.finish();
  assert.ok(html.includes(escapePrintText(malicious)));
  assert.ok(!/<(?:script|img|iframe|link|a)(?:\s|>)/i.test(html));
  assert.ok(!html.includes('background:url('));
  assert.ok(html.includes('border-left-color:#555555'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(html.includes('12:39'));
});

test('a full long minute note and multiline description survive printing without preview truncation', () => {
  const long = 'Thought & decision '.repeat(5000) + '\nSecond line: Ω 🪷';
  const document = createPrintScheduleDocument([day], '12h');
  document.addDay(day, [item({ minuteNotes: [{ minuteIndex: 759, text: long }] }),
    item({ id: 'plan', kind: 'plan', minuteNotes: [], description: long })]);
  const html = document.finish();
  assert.equal(html.split(escapePrintText(long)).length - 1, 2);
  assert.ok(html.includes('12:39 PM'));
  assert.ok(!html.includes('…'));
  assert.ok(html.includes('white-space:pre-wrap'));
  assert.ok(html.includes('.minute{display:block'));
  assert.ok(!html.includes('display:flex'));
});

test('out-of-order parallel day completion prints exact sorted dates, including a 28-day cross-month range', () => {
  const dates = anchoredDateRange('2026-10-20', '2026-11-16');
  const document = createPrintScheduleDocument(dates, '24h');
  for (const date of [...dates].reverse()) document.addDay(date, []);
  const html = document.finish();
  const rendered = [...html.matchAll(/data-date="([0-9-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(rendered, dates);
  assert.equal(rendered.length, 28);
  assert.ok(html.includes('No events'));
  assert.throws(() => printScheduleDates(['2026-02-29']), /valid dates/);
  assert.throws(() => printScheduleDates([]), /valid dates/);
  assert.throws(() => printScheduleDates(Array.from({ length: 367 }, () => day)), /valid dates/);
});

test('print times use exclusive end boundaries and the selected clock format', () => {
  const create = (format: '12h' | '24h') => {
    const document = createPrintScheduleDocument([day], format);
    document.addDay(day, [item({ startMinute: 1439, endMinute: 1439,
      minuteNotes: [{ minuteIndex: 1439, text: 'Finish the day' }] }),
      item({ id: 'all-day', allDay: true, startMinute: 0, endMinute: 1439, minuteNotes: [] })]);
    return document.finish();
  };
  assert.ok(create('24h').includes('23:59 – 24:00'));
  assert.ok(create('12h').includes('11:59 PM – 12:00 AM (+1 day)'));
  assert.ok(create('24h').includes('All day'));
});

test('adjacent multicolor group segments print once with every separate minute note', () => {
  const segment = (start: number, categoryId: string): ActivitySegment => ({
    segmentKey: `${day}:activity_coffee:${start}`, blockId: 'activity_coffee', dateKey: day,
    startMinute: start, endMinute: start, categoryId, activityTitle: 'Coffee activity',
    entries: [{ id: String(start), dateKey: day, minuteIndex: start, categoryId, blockId: 'activity_coffee',
      text: `Individual note ${start}`, source: 'manual', createdAt: '', updatedAt: '' }],
  });
  const document = createPrintScheduleDocument([day], '24h');
  document.addDay(day, scheduleAgendaItems(day, [segment(759, 'family'), segment(760, 'work')], []));
  const html = document.finish();
  assert.equal((html.match(/class="activity"/g) ?? []).length, 1);
  assert.ok(html.includes('Individual note 759') && html.includes('Individual note 760'));
  assert.ok(html.includes('12:39 – 12:41'));
});

test('document size is bounded in UTF-8 bytes; incomplete dates and invalid activities cannot print silently', () => {
  const document = createPrintScheduleDocument([day], '24h', 3500);
  assert.throws(() => document.addDay(day, [item({ minuteNotes: [{ minuteIndex: 759, text: '🪷'.repeat(1000) }] })]), /too large/);
  assert.throws(() => document.finish(), /could not be loaded/);
  const incomplete = createPrintScheduleDocument([day, '2026-10-26'], '24h');
  incomplete.addDay(day, []);
  assert.throws(() => incomplete.finish(), /could not be loaded/);
  assert.throws(() => incomplete.addDay(day, []), /dates changed/);
  assert.throws(() => incomplete.addDay('2026-10-26', [item()]), /could not be prepared/);
});

test('the document budget stops during a long note before allocating every later minute in a group', () => {
  let laterNoteRead = false;
  const later = { minuteIndex: 760, get text() { laterNoteRead = true; return 'Later note'; } };
  const document = createPrintScheduleDocument([day], '24h', 4000);
  assert.throws(() => document.addDay(day, [item({ minuteNotes: [
    { minuteIndex: 759, text: '&'.repeat(100_000) }, later,
  ] })]), /too large/);
  assert.equal(laterNoteRead, false);
  const unicode = createPrintScheduleDocument([day], '24h');
  const note = 'a'.repeat(8191) + '🪷' + 'z'.repeat(8191) + 'Ω';
  unicode.addDay(day, [item({ minuteNotes: [{ minuteIndex: 759, text: note }] })]);
  assert.ok(unicode.finish().includes(note), 'chunk boundaries retain complete surrogate pairs and Unicode notes');
});
