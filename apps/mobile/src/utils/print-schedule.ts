import type { ScheduleAgendaItem } from './schedule-agenda';
import { scheduleTimeRange } from './schedule-agenda';
import { isDateKey, normalizeSelectedDates } from './date-selection';
import { minuteLabel, parseDateKey } from './time';
import type { ContextPrintOptions } from './print-options';
import { printColor } from './print-theme';

export const MAX_PRINT_DATES = 366;
export const MAX_PRINT_HTML_BYTES = 10 * 1024 * 1024;

export function printScheduleDates(value: readonly string[]): string[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_PRINT_DATES || !value.every(isDateKey)) {
    throw new Error('Choose between 1 and 366 valid dates to print.');
  }
  return normalizeSelectedDates(value);
}

export function escapePrintText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;' })[character]!);
}

/** UTF-8 size without allocating another copy of a potentially long document. */
export function printUtf8Bytes(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) count++;
    else if (code < 0x800) count += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xDC00 && value.charCodeAt(index + 1) <= 0xDFFF) { count += 4; index++; }
    else count += 3;
  }
  return count;
}

function heading(day: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    .format(parseDateKey(day));
}

function appendItem(day: string, item: ScheduleAgendaItem, clockFormat: '12h' | '24h',
  append: (html: string) => void, appendText: (text: string) => void,
  options?: Pick<ContextPrintOptions, 'includeStartEndTimes' | 'includeDescriptions' | 'colorStyle'>) {
  if (item.dateKey !== day || !Number.isInteger(item.startMinute) || !Number.isInteger(item.endMinute) ||
    item.startMinute < 0 || item.endMinute > 1439 || item.startMinute > item.endMinute ||
    typeof item.title !== 'string' || typeof item.description !== 'string' || typeof item.allDay !== 'boolean' ||
    !Array.isArray(item.minuteNotes)) {
    throw new Error('Some activities could not be prepared. Refresh the calendar before printing.');
  }
  const color = printColor(item.color, options?.colorStyle ?? 'outline');
  append(`<article class="activity"><div class="activity-heading" style="border-left-color:${color.border};background:${color.background};color:${color.text}">`);
  if (options?.includeStartEndTimes !== false) {
    append('<span class="time">'); appendText(scheduleTimeRange(item, clockFormat)); append('</span>');
  }
  append('<h3>'); appendText(item.title); append('</h3></div>');
  if (options?.includeDescriptions === false) { append('</article>'); return; }
  if (item.minuteNotes.length) {
    for (const note of item.minuteNotes) {
      if (!Number.isInteger(note.minuteIndex) || note.minuteIndex < item.startMinute ||
        note.minuteIndex > item.endMinute || typeof note.text !== 'string') {
        throw new Error('Some activities could not be prepared. Refresh the calendar before printing.');
      }
      append('<div class="minute"><span class="minute-time">');
      appendText(minuteLabel(note.minuteIndex, clockFormat === '12h'));
      append('</span><span class="note">'); appendText(note.text); append('</span></div>');
    }
  } else if (item.description.trim()) {
    append('<div class="description">'); appendText(item.description); append('</div>');
  }
  append('</article>');
}

const START = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; script-src \'none\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>Schedule</title><style>' +
  '@page{margin:16mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:10pt;line-height:1.45}h1{font-size:19pt;margin:0 0 4mm;font-weight:600}.dates{font-size:10pt;color:#444;margin:0 0 7mm}.day{margin:0 0 8mm}h2{font-size:12pt;margin:0 0 4mm;padding-bottom:2mm;border-bottom:1px solid #aaa;break-after:avoid-page}.activity{margin:0 0 5mm}.activity-heading{border-left:3px solid #555;padding-left:3mm;break-after:avoid-page}.time{display:inline-block;min-width:34mm;margin-right:4mm;font-variant-numeric:tabular-nums;font-size:9pt}h3{display:inline;font-size:11pt;margin:0;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere}.minute{display:block;margin:1.5mm 0;orphans:3;widows:3;break-inside:auto}.minute-time{display:inline;font-size:9pt;margin-right:4mm;font-variant-numeric:tabular-nums}.note,.description{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}.description{margin-top:2mm}.empty{color:#555;font-size:9pt}</style></head><body><h1>Schedule</h1>';
const END = '</body></html>';

/** Incremental construction retains only bounded escaped HTML, not a year's raw notes. */
export function createPrintScheduleDocument(value: readonly string[], clockFormat: '12h' | '24h',
  maxBytes = MAX_PRINT_HTML_BYTES,
  options?: Pick<ContextPrintOptions, 'includeStartEndTimes' | 'includeDescriptions' | 'colorStyle' | 'orientation'>) {
  const dates = printScheduleDates(value);
  if (clockFormat !== '12h' && clockFormat !== '24h') throw new Error('Choose a valid time format before printing.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_PRINT_HTML_BYTES) throw new Error('Invalid print document limit.');
  const expected = new Set(dates);
  const sections = new Map<string, string[]>();
  const range = dates.length === 1 ? heading(dates[0]!) : `${heading(dates[0]!)} – ${heading(dates.at(-1)!)}`;
  let start = START.replace('@page{margin:16mm}', `@page{size:letter ${options?.orientation ?? 'portrait'};margin:16mm}`);
  if (options?.colorStyle === 'black-white') start = start.replaceAll('#444', '#000').replaceAll('#aaa', '#000').replaceAll('#555', '#000');
  const prefix = `${start}<p class="dates">${dates.length > 1 ? `${dates.length} selected dates · ` : ''}${escapePrintText(range)}</p>`;
  let size = printUtf8Bytes(prefix) + printUtf8Bytes(END);
  const checkSize = () => {
    if (size > maxBytes) throw new Error('This print document is too large. Choose fewer dates and try again.');
  };
  checkSize();
  return {
    addDay(day: string, items: readonly ScheduleAgendaItem[]) {
      if (!expected.has(day) || sections.has(day)) throw new Error('The print dates changed. Try printing again.');
      const chunks: string[] = [];
      const append = (html: string) => {
        size += printUtf8Bytes(html); checkSize(); chunks.push(html);
      };
      const appendText = (text: string) => {
        for (let start = 0; start < text.length;) {
          let end = Math.min(start + 8192, text.length);
          // Do not split surrogate pairs: byte accounting and the final Unicode text stay exact.
          if (end < text.length && text.charCodeAt(end - 1) >= 0xD800 && text.charCodeAt(end - 1) <= 0xDBFF &&
            text.charCodeAt(end) >= 0xDC00 && text.charCodeAt(end) <= 0xDFFF) end--;
          append(escapePrintText(text.slice(start, end))); start = end;
        }
      };
      append(`<section class="day" data-date="${day}"><h2>`); appendText(heading(day)); append('</h2>');
      if (items.length) for (const item of items) appendItem(day, item, clockFormat, append, appendText, options);
      else append('<p class="empty">No events</p>');
      append('</section>');
      sections.set(day, chunks);
    },
    finish(): string {
      if (sections.size !== dates.length) throw new Error('Some print dates could not be loaded. Try again before printing.');
      return [prefix, ...dates.flatMap((day) => sections.get(day)!), END].join('');
    },
  };
}
