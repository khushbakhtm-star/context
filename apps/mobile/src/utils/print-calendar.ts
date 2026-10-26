import type { DashboardSummary } from './dashboard';
import { dashboardPercent, dashboardTimeBuckets, formatDashboardPercent } from './dashboard';
import { formatRecordedDuration } from '../services/reports';
import { isDateKey, monthDateCells } from './date-selection';
import { normalizePrintOptions, printOptionDates, type ContextPrintOptions } from './print-options';
import { createPrintScheduleDocument, escapePrintText, MAX_PRINT_HTML_BYTES, printScheduleDates, printUtf8Bytes } from './print-schedule';
import { printColor } from './print-theme';
import { scheduleTimeRange, type ScheduleAgendaItem } from './schedule-agenda';
import { addDays, dateKey, minuteLabel, parseDateKey, startOfWeek } from './time';

type CalendarItem = Pick<ScheduleAgendaItem, 'id' | 'dateKey' | 'title' | 'color' | 'startMinute' | 'endMinute' | 'allDay'>;
export type CalendarPrintLane = { index: number; lane: number; lanes: number };

/** Half-open intervals share a lane when one ends exactly as the next starts. */
export function calendarPrintLanes(items: readonly CalendarItem[]): CalendarPrintLane[] {
  const sorted = items.map((item, index) => ({ item, index })).filter(({ item }) => !item.allDay)
    .sort((a, b) => a.item.startMinute - b.item.startMinute || a.item.endMinute - b.item.endMinute || a.index - b.index);
  const result: CalendarPrintLane[] = [];
  let cluster: CalendarPrintLane[] = [];
  let ends: number[] = [];
  let clusterEnd = -1;
  const finish = () => { for (const item of cluster) result.push({ ...item, lanes: ends.length }); cluster = []; ends = []; };
  for (const { item, index } of sorted) {
    if (item.startMinute >= clusterEnd) finish();
    let lane = ends.findIndex((end) => end <= item.startMinute);
    if (lane < 0) lane = ends.length;
    ends[lane] = item.endMinute + 1;
    cluster.push({ index, lane, lanes: 0 });
    clusterEnd = Math.max(item.endMinute + 1, cluster.length === 1 ? -1 : clusterEnd);
  }
  finish();
  return result;
}

function documentWriter(options: ContextPrintOptions, title: string, maxBytes = MAX_PRINT_HTML_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PRINT_HTML_BYTES) throw new Error('Invalid print document limit.');
  const chunks: string[] = [];
  let bytes = 0;
  const raw = (html: string) => {
    bytes += printUtf8Bytes(html);
    if (bytes > maxBytes) throw new Error('This print document is too large. Choose fewer dates and try again.');
    chunks.push(html);
  };
  const text = (value: string) => {
    for (let start = 0; start < value.length;) {
      let end = Math.min(start + 8192, value.length);
      if (end < value.length && value.charCodeAt(end - 1) >= 0xD800 && value.charCodeAt(end - 1) <= 0xDBFF &&
        value.charCodeAt(end) >= 0xDC00 && value.charCodeAt(end) <= 0xDFFF) end--;
      raw(escapePrintText(value.slice(start, end))); start = end;
    }
  };
  const bw = options.colorStyle === 'black-white';
  const ink = bw ? '#000000' : '#111111';
  const muted = bw ? '#000000' : '#555555';
  const line = bw ? '#000000' : '#CCCCCC';
  const pale = bw ? '#FFFFFF' : '#F5F5F5';
  raw('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\';style-src \'unsafe-inline\';img-src \'none\';script-src \'none\';connect-src \'none\';base-uri \'none\';form-action \'none\'"><title>');
  text(title);
  raw(`</title><style>@page{size:letter ${options.orientation};margin:12mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#FFFFFF;color:${ink};font:10pt/1.35 Arial,Helvetica,sans-serif}h1{font-size:17pt;margin:0 0 3mm}h2{font-size:13pt;margin:0 0 3mm}h3{font-size:11pt;margin:0 0 1.5mm;white-space:pre-wrap;overflow-wrap:anywhere}.sub{font-size:8pt;color:${muted};margin:0 0 3mm}.calendar-page{break-before:page;break-inside:avoid}.calendar-page:first-of-type{break-before:auto}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:0.5pt solid ${line};vertical-align:top}.date-head{font-weight:600;text-align:center;font-size:8pt;padding:2mm}.muted{color:${muted};background:${pale}}.all-day th{font-size:7pt;text-align:left;font-weight:400;padding:1mm}.all-day td{padding:1mm;height:24pt}.small-event{font-size:7pt;line-height:10pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-left:2pt solid;padding:0 1mm;margin-bottom:1pt}.more{font-size:7pt;color:${muted}}.time-grid{position:relative;overflow:hidden}.hours{height:100%}.hours th{font-size:7pt;line-height:8pt;text-align:right;font-weight:400;padding:0 1mm 0 0;white-space:nowrap}.hours td{padding:0}.events{position:absolute;top:0;bottom:0;left:14mm;right:0}.event-column{position:absolute;top:0;bottom:0;border-right:0.5pt solid ${line}}.timed-event{position:absolute;border:0.6pt solid;border-radius:1pt;overflow:hidden;font-size:7pt;line-height:9pt;padding:0 1pt}.month-week td{padding:1mm;font-size:8pt}.day-number{font-size:9pt;font-weight:600;margin-bottom:1.5mm}.month-event{font-size:7pt;line-height:10pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-left:2pt solid;padding-left:1mm;margin-bottom:1pt}.details{break-before:page}.detail-day{margin:0 0 5mm}.detail{margin:0 0 3mm;break-inside:auto}.detail-time{font-size:8pt;color:${muted};margin-right:3mm}.detail-title{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}.totals{margin:3mm 0 6mm}.totals td{padding:3mm;text-align:center;font-size:9pt}.total{font-weight:600;font-size:16pt;display:block;margin-top:1mm}.chart-row{margin:0 0 4mm;break-inside:auto}.chart-label{white-space:pre-wrap;overflow-wrap:anywhere;font-size:10pt}.chart-value{font-size:9pt;margin:1mm 0}.track{height:5mm;border:0.5pt solid ${line};background:#FFFFFF}.bar{height:100%;border:0.7pt solid}.summary-section{margin-top:6mm}p{orphans:3;widows:3}</style></head><body>`);
  return { raw, text, finish() { raw('</body></html>'); return chunks.join(''); } };
}
type Writer = ReturnType<typeof documentWriter>;
const heading = (day: string) => new Intl.DateTimeFormat(undefined,
  { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(parseDateKey(day));
const shortHeading = (day: string) => new Intl.DateTimeFormat(undefined,
  { weekday: 'short', month: 'short', day: 'numeric' }).format(parseDateKey(day));
const preview = (text: string, limit = 100) => {
  if (text.length <= limit) return text;
  let end = limit;
  if (text.charCodeAt(end - 1) >= 0xD800 && text.charCodeAt(end - 1) <= 0xDBFF &&
    text.charCodeAt(end) >= 0xDC00 && text.charCodeAt(end) <= 0xDFFF) end--;
  return `${text.slice(0, end)}…`;
};
const percentCss = (value: number) => Math.min(100, Math.max(0, value)).toFixed(4);

function itemStyle(item: CalendarItem, options: ContextPrintOptions) {
  const color = printColor(item.color, options.colorStyle);
  return `border-color:${color.border};background:${color.background};color:${color.text}`;
}

function timeGrid(writer: Writer, days: string[], selected: Set<string>, byDay: Map<string, CalendarItem[]>,
  options: ContextPrintOptions, clockFormat: '12h' | '24h') {
  writer.raw('<table class="all-day"><colgroup><col style="width:14mm">');
  for (const _day of days) writer.raw('<col>');
  writer.raw('</colgroup><thead><tr><th></th>');
  for (const day of days) {
    writer.raw(`<th class="date-head${selected.has(day) ? '' : ' muted'}" data-date="${day}">`);
    writer.text(shortHeading(day)); writer.raw('</th>');
  }
  writer.raw('</tr></thead><tbody><tr><th>All day</th>');
  for (const day of days) {
    writer.raw(`<td${selected.has(day) ? '' : ' class="muted"'}>`);
    const items = byDay.get(day) ?? [];
    const allDay = items.map((item, index) => ({ item, index })).filter(({ item }) => item.allDay);
    for (const { item, index } of allDay.slice(0, 2)) {
      writer.raw(`<div class="small-event" style="${itemStyle(item, options)}">`);
      writer.text(`${index + 1}. ${preview(item.title, 70)}`); writer.raw('</div>');
    }
    if (allDay.length > 2) writer.raw(`<div class="more">+${allDay.length - 2} · Event details</div>`);
    writer.raw('</td>');
  }
  writer.raw('</tr></tbody></table>');
  const rowHeight = options.orientation === 'landscape' ? 16 : 22;
  const gridHeight = rowHeight * 24;
  writer.raw(`<div class="time-grid" style="height:${gridHeight}pt"><table class="hours"><colgroup><col style="width:14mm">`);
  for (const _day of days) writer.raw('<col>');
  writer.raw('</colgroup><tbody>');
  for (let hour = 0; hour < 24; hour++) {
    writer.raw(`<tr style="height:${rowHeight}pt"><th>`);
    writer.text(minuteLabel(hour * 60, clockFormat === '12h')); writer.raw('</th>');
    for (const day of days) writer.raw(`<td${selected.has(day) ? '' : ' class="muted"'}></td>`);
    writer.raw('</tr>');
  }
  writer.raw('</tbody></table><div class="events">');
  for (let column = 0; column < days.length; column++) {
    const items = byDay.get(days[column]!) ?? [];
    writer.raw(`<div class="event-column" style="left:${column * 100 / days.length}%;width:${100 / days.length}%">`);
    for (const layout of calendarPrintLanes(items)) {
      const item = items[layout.index]!;
      const top = item.startMinute * gridHeight / 1440;
      const height = Math.max(1, (item.endMinute + 1 - item.startMinute) * gridHeight / 1440);
      writer.raw(`<div class="timed-event" data-event="${layout.index + 1}" style="${itemStyle(item, options)};top:${top.toFixed(3)}pt;height:${height.toFixed(3)}pt;left:${layout.lane * 100 / layout.lanes}%;width:${100 / layout.lanes}%">`);
      writer.text(`${layout.index + 1}. ${preview(item.title)}`);
      writer.raw('</div>');
    }
    writer.raw('</div>');
  }
  writer.raw('</div></div><p class="sub">Full event times and titles follow in Event details.</p>');
}

function eventDetails(writer: Writer, dates: string[], byDay: Map<string, CalendarItem[]>, clockFormat: '12h' | '24h') {
  if (!dates.some((day) => byDay.get(day)?.length)) return;
  writer.raw('<section class="details"><h1>Event details</h1>');
  for (const day of dates) {
    const items = byDay.get(day) ?? [];
    if (!items.length) continue;
    writer.raw('<div class="detail-day"><h2>'); writer.text(heading(day)); writer.raw('</h2>');
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      writer.raw('<div class="detail"><span class="detail-time">');
      writer.text(`${index + 1}. ${scheduleTimeRange(item, clockFormat)}`);
      writer.raw('</span><span class="detail-title">'); writer.text(item.title); writer.raw('</span></div>');
    }
    writer.raw('</div>');
  }
  writer.raw('</section>');
}

/** Grid views retain only bounded summaries; full minute descriptions belong to Schedule. */
export function createPrintCalendarDocument(value: readonly string[], clockFormat: '12h' | '24h', input: ContextPrintOptions,
  maxBytes = MAX_PRINT_HTML_BYTES) {
  const options = normalizePrintOptions(input);
  const dates = printScheduleDates(value);
  if (clockFormat !== '12h' && clockFormat !== '24h') throw new Error('Choose a valid time format before printing.');
  if (dates.join('|') !== printOptionDates(options).join('|')) throw new Error('The print dates changed. Try printing again.');
  if (options.view === 'schedule') return createPrintScheduleDocument(dates, clockFormat, maxBytes, options);
  if (options.view === 'dashboard') throw new Error('Choose the Dashboard summary to print this view.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PRINT_HTML_BYTES) throw new Error('Invalid print document limit.');
  const selected = new Set(dates);
  const byDay = new Map<string, CalendarItem[]>();
  let summaryBytes = 0;
  const reserve = (text: string) => {
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + 8192, text.length);
      if (end < text.length && text.charCodeAt(end - 1) >= 0xD800 && text.charCodeAt(end - 1) <= 0xDBFF &&
        text.charCodeAt(end) >= 0xDC00 && text.charCodeAt(end) <= 0xDFFF) end--;
      summaryBytes += printUtf8Bytes(escapePrintText(text.slice(start, end))); start = end;
      if (summaryBytes > maxBytes) throw new Error('This print document is too large. Choose fewer dates and try again.');
    }
  };
  return {
    addDay(day: string, items: readonly ScheduleAgendaItem[]) {
      if (!selected.has(day) || byDay.has(day)) throw new Error('The print dates changed. Try printing again.');
      const summaries: CalendarItem[] = [];
      for (const item of items) {
        if (item.dateKey !== day || typeof item.title !== 'string' || typeof item.id !== 'string' ||
          !Number.isInteger(item.startMinute) || !Number.isInteger(item.endMinute) || item.startMinute < 0 ||
          item.endMinute > 1439 || item.startMinute > item.endMinute || typeof item.allDay !== 'boolean') {
          throw new Error('Some activities could not be prepared. Refresh the calendar before printing.');
        }
        summaryBytes += 512; reserve(item.title);
        if (summaryBytes > maxBytes) throw new Error('This print document is too large. Choose fewer dates and try again.');
        summaries.push({ id: item.id, dateKey: day, title: item.title, color: item.color,
          startMinute: item.startMinute, endMinute: item.endMinute, allDay: item.allDay });
      }
      byDay.set(day, summaries);
    },
    finish() {
      if (byDay.size !== dates.length) throw new Error('Some print dates could not be loaded. Try again before printing.');
      const writer = documentWriter(options, options.view === 'month' ? 'Month calendar' : options.view === 'week' ? 'Week calendar' : 'Day calendar', maxBytes);
      if (options.view === 'day') {
        for (const day of dates) {
          writer.raw('<section class="calendar-page" data-view="day"><h1>'); writer.text(heading(day)); writer.raw('</h1>');
          timeGrid(writer, [day], selected, byDay, options, clockFormat); writer.raw('</section>');
        }
      } else if (options.view === 'week') {
        const weeks = [...new Set(dates.map((day) => dateKey(startOfWeek(parseDateKey(day)))))];
        for (const week of weeks) {
          const days = Array.from({ length: options.showWeekends ? 7 : 5 }, (_, index) => dateKey(addDays(week, index))).filter(isDateKey);
          writer.raw('<section class="calendar-page" data-view="week"><h1>');
          writer.text(`${shortHeading(days[0]!)} – ${heading(days.at(-1)!)}`); writer.raw('</h1>');
          timeGrid(writer, days, selected, byDay, options, clockFormat); writer.raw('</section>');
        }
      } else {
        const months = [...new Set(dates.map((day) => day.slice(0, 7)))];
        const columns = options.showWeekends ? 7 : 5;
        for (const month of months) {
          const cells = monthDateCells(`${month}-01`);
          writer.raw('<section class="calendar-page" data-view="month"><h1>');
          writer.text(new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(parseDateKey(`${month}-01`)));
          writer.raw('</h1><table class="month-calendar"><thead><tr>');
          for (let index = 0; index < columns; index++) {
            writer.raw('<th class="date-head">'); writer.text(new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(addDays('2026-10-19', index))); writer.raw('</th>');
          }
          writer.raw('</tr></thead><tbody>');
          for (let row = 0; row < 6; row++) {
            writer.raw(`<tr class="month-week" style="height:${options.orientation === 'landscape' ? 66 : 88}pt">`);
            for (const cell of cells.slice(row * 7, row * 7 + columns)) {
              if (!isDateKey(cell.dateKey)) { writer.raw('<td class="muted"></td>'); continue; }
              const active = cell.inMonth && selected.has(cell.dateKey);
              const items = active ? byDay.get(cell.dateKey) ?? [] : [];
              writer.raw(`<td class="${active ? 'month-day' : 'muted'}" data-date="${cell.dateKey}"><div class="day-number">${cell.day}</div>`);
              for (let index = 0; index < Math.min(2, items.length); index++) {
                const item = items[index]!;
                writer.raw(`<div class="month-event" style="${itemStyle(item, options)}">`);
                writer.text(`${item.allDay ? '' : minuteLabel(item.startMinute, clockFormat === '12h') + ' '}${index + 1}. ${preview(item.title, 80)}`);
                writer.raw('</div>');
              }
              if (items.length > 2) writer.raw(`<div class="more">+${items.length - 2} · Event details</div>`);
              writer.raw('</td>');
            }
            writer.raw('</tr>');
          }
          writer.raw('</tbody></table><p class="sub">Full event times and titles follow in Event details.</p></section>');
        }
      }
      eventDetails(writer, dates, byDay, clockFormat);
      return writer.finish();
    },
  };
}

function chartRow(writer: Writer, label: string, minutes: number, percent: number, color: string, options: ContextPrintOptions) {
  if (!Number.isInteger(minutes) || minutes < 0 || !Number.isFinite(percent) || percent < 0 || percent > 100.00001) {
    throw new Error('Dashboard totals are invalid. Refresh the Dashboard before printing.');
  }
  const palette = printColor(color, options.colorStyle);
  writer.raw('<div class="chart-row"><div class="chart-label">'); writer.text(label); writer.raw('</div><div class="chart-value">');
  writer.text(`${formatRecordedDuration(minutes)} · ${formatDashboardPercent(percent)}`);
  writer.raw(`</div><div class="track"><div class="bar" style="width:${percentCss(percent)}%;border-color:${palette.border};background:${palette.bar}"></div></div></div>`);
}

export function renderDashboardPrint(summary: DashboardSummary, clockFormat: '12h' | '24h', input: ContextPrintOptions,
  maxBytes = MAX_PRINT_HTML_BYTES) {
  const options = normalizePrintOptions(input);
  const dates = printScheduleDates(summary.dates);
  if (options.view !== 'dashboard' || dates.join('|') !== printOptionDates(options).join('|') ||
    (clockFormat !== '12h' && clockFormat !== '24h') || summary.periodMinutes !== dates.length * 1440 ||
    !Number.isInteger(summary.recordedMinutes) || summary.recordedMinutes < 0 || summary.recordedMinutes > summary.periodMinutes ||
    summary.unrecordedMinutes !== summary.periodMinutes - summary.recordedMinutes ||
    summary.categories.reduce((total, category) => total + category.minutes, 0) !== summary.recordedMinutes) {
    throw new Error('Dashboard totals or dates changed. Refresh before printing.');
  }
  const writer = documentWriter(options, 'Dashboard', maxBytes);
  const unrecorded = options.dashboardMetric === 'unrecorded';
  writer.raw('<h1>'); writer.text(unrecorded ? 'Unrecorded time' : 'Recorded time'); writer.raw('</h1><p class="sub">');
  writer.text(`${heading(dates[0]!)} – ${heading(dates.at(-1)!)} · ${dates.length} selected ${dates.length === 1 ? 'day' : 'days'}`);
  writer.raw('</p><table class="totals"><tbody><tr>');
  for (const [label, value] of [['Recorded', summary.recordedMinutes], ['Unrecorded', summary.unrecordedMinutes], ['Period capacity', summary.periodMinutes]] as const) {
    writer.raw('<td>'); writer.text(label); writer.raw('<span class="total">'); writer.text(formatRecordedDuration(value)); writer.raw('</span></td>');
  }
  writer.raw('</tr></tbody></table>');
  const basisLabel = options.percentageBasis === 'period' ? 'Share of selected period' : 'Share of recorded time';
  if (!unrecorded) {
    writer.raw('<section><h2>Activities</h2><p class="sub">'); writer.text(basisLabel); writer.raw('</p>');
    if (!summary.categories.length) writer.raw('<p>No recorded minutes</p>');
    for (const category of summary.categories) chartRow(writer, category.name, category.minutes,
      dashboardPercent(category, options.percentageBasis), category.color, options);
    writer.raw('</section>');
  }
  const period = options.dashboardPeriod === 'custom' ? 'day' : options.dashboardPeriod;
  const buckets = dashboardTimeBuckets(summary, period, options.dashboardMetric);
  writer.raw('<section class="summary-section"><h2>');
  writer.text(`${unrecorded ? 'Unrecorded' : 'Recorded'} by ${period === 'year' ? 'month' : 'day'}`);
  writer.raw('</h2><p class="sub">'); writer.text(unrecorded ? 'Share of the available minute cells in each period' : basisLabel); writer.raw('</p>');
  for (const bucket of buckets) {
    const label = period === 'year' ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
      .format(parseDateKey(`${bucket.key}-01`)) : heading(bucket.startDate);
    const denominator = options.percentageBasis === 'period' ? summary.periodMinutes : summary.recordedMinutes;
    const percent = unrecorded ? bucket.percent : denominator ? bucket.minutes * 100 / denominator : 0;
    chartRow(writer, label, bucket.minutes, percent, '#555555', options);
  }
  writer.raw('</section><p class="sub">Each selected day has 1,440 minute cells. Unrecorded time includes future cells.</p>');
  return writer.finish();
}
