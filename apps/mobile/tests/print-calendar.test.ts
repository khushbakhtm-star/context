import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarPrintLanes, createPrintCalendarDocument, renderDashboardPrint } from '../src/utils/print-calendar';
import { defaultPrintOptions, printOptionDates, type ContextPrintOptions } from '../src/utils/print-options';
import { buildDashboardSummary, formatDashboardPercent } from '../src/utils/dashboard';
import { escapePrintText } from '../src/utils/print-schedule';
import type { ScheduleAgendaItem } from '../src/utils/schedule-agenda';
import type { ActivityCategory } from '../src/theme';

const day = '2026-10-25';
function item(changes: Partial<ScheduleAgendaItem> = {}): ScheduleAgendaItem {
  return { id: 'activity', dateKey: day, title: 'Make coffee', color: '#FF0000', startMinute: 759,
    endMinute: 767, allDay: false, kind: 'actual', description: 'Full description',
    minuteNotes: [{ minuteIndex: 759, text: 'A separate minute note' }], ...changes };
}
function config(view: ContextPrintOptions['view'], changes: Partial<ContextPrintOptions> = {}) {
  return { ...defaultPrintOptions([day], view), ...changes };
}
function calendarHtml(options: ContextPrintOptions, items: ScheduleAgendaItem[] = []) {
  const dates = printOptionDates(options);
  const document = createPrintCalendarDocument(dates, '24h', options);
  for (const date of [...dates].reverse()) document.addDay(date, items.filter((event) => event.dateKey === date));
  return document.finish();
}

test('Day is a paged 24-hour calendar with an all-day band and complete title appendix, without retaining minute notes', () => {
  const title = '<script>unsafe()</script> & "long title" ' + 'exact words '.repeat(1000);
  const event = item({ title, color: '#fff;background:url(https://example.invalid)' });
  Object.defineProperty(event, 'minuteNotes', { get() { throw new Error('Grid must not read raw minute notes'); } });
  Object.defineProperty(event, 'description', { get() { throw new Error('Grid must not read descriptions'); } });
  const html = calendarHtml(config('day'), [event, item({ id: 'all-day', title: 'Visit family', allDay: true,
    startMinute: 0, endMinute: 1439 })]);
  assert.equal((html.match(/data-view="day"/g) ?? []).length, 1);
  assert.ok(html.includes('00:00') && html.includes('23:00'));
  assert.ok(html.includes('All day') && html.includes('Event details'));
  assert.ok(html.includes(escapePrintText(title)));
  assert.ok(!html.includes('<script>') && !html.includes('background:url('));
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(html.includes('12:39 – 12:48'));
});

test('Week uses Monday-first day columns and omits weekends while respecting the exact chosen date range', () => {
  const options = config('week', { startDate: '2026-10-24', endDate: '2026-10-27', showWeekends: false });
  const html = calendarHtml(options, [item({ dateKey: '2026-10-26' })]);
  assert.equal((html.match(/data-view="week"/g) ?? []).length, 1);
  assert.deepEqual([...html.matchAll(/class="date-head[^"]*" data-date="([0-9-]+)"/g)].map((match) => match[1]),
    ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
  assert.ok(!html.includes('data-date="2026-10-24"') && !html.includes('data-date="2026-10-25"'));
  assert.ok(html.includes('class="date-head muted" data-date="2026-10-28"'));
});

test('Month prints separate grids across years, marks nonselected padding, and preserves every overflow title', () => {
  const options = config('month', { startDate: '2026-12-30', endDate: '2027-01-02' });
  const events = Array.from({ length: 5 }, (_, index) => item({ id: `event-${index}`, dateKey: '2026-12-30',
    title: `Exact overflow activity ${index}`, startMinute: 600 + index, endMinute: 600 + index }));
  const html = calendarHtml(options, events);
  assert.equal((html.match(/data-view="month"/g) ?? []).length, 2);
  assert.ok(html.includes('December 2026') && html.includes('January 2027'));
  assert.equal((html.match(/class="month-day"/g) ?? []).length, 4);
  assert.ok(html.includes('+3 · Event details'));
  for (const event of events) assert.ok(html.includes(event.title));
  assert.ok(!html.includes('A separate minute note'));
  const boundary = calendarHtml(config('month', { startDate: '9999-12-31', endDate: '9999-12-31' }));
  assert.ok(!boundary.includes('10000-'));
});

test('calendar lane allocation keeps overlapping intervals separate and lets adjacent intervals reuse full width', () => {
  const items = [item({ startMinute: 540, endMinute: 599 }), item({ startMinute: 570, endMinute: 629 }),
    item({ startMinute: 600, endMinute: 659 }), item({ startMinute: 660, endMinute: 689 })];
  assert.deepEqual(calendarPrintLanes(items).sort((a, b) => a.index - b.index).map(({ lane, lanes }) => [lane, lanes]),
    [[0, 2], [1, 2], [0, 2], [0, 1]]);
  assert.deepEqual(calendarPrintLanes([item({ startMinute: 0, endMinute: 0 }), item({ startMinute: 1, endMinute: 1 })])
    .map(({ lane, lanes }) => [lane, lanes]), [[0, 1], [0, 1]]);
  assert.equal(calendarPrintLanes([item({ allDay: true })]).length, 0);
  let seed = 42;
  for (let run = 0; run < 30; run++) {
    const sample = Array.from({ length: 16 }, () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const start = seed % 1300;
      return item({ startMinute: start, endMinute: start + seed % 140 });
    });
    const layout = new Map(calendarPrintLanes(sample).map((entry) => [entry.index, entry]));
    for (let a = 0; a < sample.length; a++) for (let b = a + 1; b < sample.length; b++) {
      if (sample[a]!.startMinute <= sample[b]!.endMinute && sample[b]!.startMinute <= sample[a]!.endMinute) {
        assert.notEqual(layout.get(a)!.lane, layout.get(b)!.lane);
      }
    }
  }
});

test('orientation and four print color styles affect the actual calendar markup without accepting CSS injection', () => {
  const full = calendarHtml(config('day', { colorStyle: 'full-color', orientation: 'landscape' }), [item()]);
  assert.ok(full.includes('@page{size:letter landscape'));
  assert.ok(full.includes('background:#FF0000;color:#FFFFFF'));
  const outline = calendarHtml(config('day', { colorStyle: 'outline' }), [item()]);
  assert.ok(outline.includes('border-color:#FF0000;background:#FFFFFF;color:#111111'));
  const grayscale = calendarHtml(config('day', { colorStyle: 'grayscale' }), [item()]);
  assert.ok(grayscale.includes('background:#4C4C4C'));
  const bw = calendarHtml(config('day', { colorStyle: 'black-white' }), [item()]);
  assert.ok(!bw.includes('#FF0000'));
  assert.ok([...bw.matchAll(/#[0-9A-F]{6}/g)].every((match) => ['#000000', '#FFFFFF'].includes(match[0])));
});

test('Schedule alone includes full minute descriptions and honors its time and description switches', () => {
  const hidden = calendarHtml(config('schedule', { includeStartEndTimes: false, includeDescriptions: false }), [item()]);
  assert.ok(!hidden.includes('12:39') && !hidden.includes('A separate minute note'));
  const shown = calendarHtml(config('schedule'), [item({ minuteNotes: [{ minuteIndex: 759, text: 'Full note '.repeat(2000) }] })]);
  assert.ok(shown.includes('12:39 – 12:48'));
  assert.ok(shown.includes('Full note '.repeat(2000)));
  assert.ok(!shown.includes('…'));
});

test('grid summary storage and final HTML are bounded, and incomplete or stale scopes cannot print', () => {
  const options = config('day');
  const document = createPrintCalendarDocument([day], '24h', options, 6000);
  assert.throws(() => document.addDay(day, [item({ title: '&'.repeat(20_000) })]), /too large/);
  assert.throws(() => document.finish(), /could not be loaded/);
  assert.throws(() => createPrintCalendarDocument(['2026-10-26'], '24h', options), /dates changed/);
  const year = config('month', { startDate: '2026-01-01', endDate: '2026-12-31' });
  const dates = printOptionDates(year);
  const large = createPrintCalendarDocument(dates, '24h', year, 10_000);
  for (const date of dates) large.addDay(date, []);
  assert.throws(() => large.finish(), /too large/);
});

const categories: ActivityCategory[] = [{ id: 'work', name: 'Work <script>unsafe()</script>', color: '#FF0000' },
  { id: 'study', name: 'Study', color: '#00FF00' }];
test('Dashboard prints actual category duration and the chosen percentage basis, with escaped labels', () => {
  const options = config('dashboard', { startDate: '2026-01-01', endDate: '2026-01-02' });
  const summary = buildDashboardSummary(printOptionDates(options), [
    { dateKey: '2026-01-01', categoryId: 'work', minutes: 60 }, { dateKey: '2026-01-02', categoryId: 'study', minutes: 30 },
  ], categories);
  const recorded = renderDashboardPrint(summary, '24h', options);
  assert.ok(recorded.includes('Recorded time') && recorded.includes('Share of recorded time'));
  assert.ok(recorded.includes(formatDashboardPercent(60 * 100 / 90)));
  assert.ok(recorded.includes(escapePrintText(categories[0]!.name)) && !recorded.includes('<script>'));
  const period = renderDashboardPrint(summary, '24h', { ...options, percentageBasis: 'period' });
  assert.ok(period.includes('Share of selected period') && period.includes(formatDashboardPercent(60 * 100 / 2880)));
  const gaps = renderDashboardPrint(summary, '24h', { ...options, dashboardMetric: 'unrecorded' });
  assert.ok(gaps.includes('Unrecorded by day') && gaps.includes('46h 30m'));
  assert.ok(gaps.includes(formatDashboardPercent(1380 * 100 / 1440)));
  assert.ok(!gaps.includes(escapePrintText(categories[0]!.name)));
  assert.ok(gaps.includes('Unrecorded time includes future cells'));
});

test('Year Dashboard uses twelve monthly buckets; empty and oversized reports remain explicit and bounded', () => {
  const options = config('dashboard', { startDate: '2028-01-01', endDate: '2028-12-31', dashboardPeriod: 'year', dashboardMetric: 'unrecorded' });
  const summary = buildDashboardSummary(printOptionDates(options), [], categories);
  const html = renderDashboardPrint(summary, '12h', options);
  assert.ok(html.includes('Unrecorded by month') && html.includes('February 2028') && html.includes('December 2028'));
  assert.equal((html.match(/class="chart-row"/g) ?? []).length, 12);
  const noRecorded = renderDashboardPrint(summary, '12h', { ...options, dashboardMetric: 'recorded' });
  assert.ok(noRecorded.includes('No recorded minutes') && !noRecorded.includes('NaN'));
  const hugeName = 'Very long category '.repeat(20_000);
  const huge = buildDashboardSummary(printOptionDates(options), [{ dateKey: '2028-01-01', categoryId: 'huge', minutes: 1 }],
    [{ id: 'huge', name: hugeName, color: '#555555' }]);
  assert.throws(() => renderDashboardPrint(huge, '24h', { ...options, dashboardMetric: 'recorded' }, 6000), /too large/);
});
