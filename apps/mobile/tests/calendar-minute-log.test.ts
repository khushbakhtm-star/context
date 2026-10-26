import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCalendarMinuteLog, parseCalendarMinuteLog } from '../src/utils/calendar-minute-log';
import { makeCalendarDescription, readCalendarDescription } from '../src/utils/calendar-description';
import { parseProjectedMinutes, validateBatch } from '../src/sync/codec';
const day = '2026-10-26';
const minute = (minuteIndex: number, text: string, dateKey = day) => ({ dateKey, minuteIndex, text });
test('identical adjacent notes appear once with the calendar end time and expand back exactly', () => {
  const entries = [minute(759, 'Make coffee'), minute(760, 'Make coffee'), minute(761, 'Talk to Mum'),
    minute(762, 'Make coffee'), minute(764, 'Make coffee')];
  const text = formatCalendarMinuteLog(entries);
  assert.equal(text, '12:39 PM – 12:41 PM  Make coffee\n12:41 PM  Talk to Mum\n12:42 PM  Make coffee\n12:44 PM  Make coffee');
  assert.deepEqual(parseCalendarMinuteLog(text), entries.map(({ minuteIndex, text }) => ({ minuteIndex, text })));
  assert.equal(formatCalendarMinuteLog([minute(791, 'Read'), minute(792, 'Read')], false), '13:11 – 13:13  Read');
});
test('multiline, empty, indented and timestamp-looking content survives compressed ranges', () => {
  const note = '  Read the answer\n\n12:00 PM this is prose\n    Indented\nContext block: literal\n';
  const entries = [minute(791, note), minute(792, note), minute(793, ''), minute(794, '')];
  assert.deepEqual(parseCalendarMinuteLog(formatCalendarMinuteLog(entries)), entries.map(({ minuteIndex, text }) => ({ minuteIndex, text })));
  for (const text of ['– 13:13 is literal prose', '- 1:13 PM is literal prose', '  – 13:13', ' (+1 day)']) {
    const entry = minute(791, text);
    assert.deepEqual(parseCalendarMinuteLog(formatCalendarMinuteLog([entry], false)), [{ minuteIndex: 791, text }]);
  }
});
test('midnight and full-day ranges preserve all civil minute slots', () => {
  const overnight = [minute(1439, 'Sleep'), minute(0, 'Sleep', '2026-10-27')];
  assert.equal(formatCalendarMinuteLog(overnight), '11:59 PM – 12:01 AM (+1 day)  Sleep');
  assert.deepEqual(parseCalendarMinuteLog(formatCalendarMinuteLog(overnight)), [{ minuteIndex: 1439, text: 'Sleep' }, { minuteIndex: 0, text: 'Sleep' }]);
  const full = Array.from({ length: 1440 }, (_, index) => minute(index, 'Sleep'));
  assert.equal(formatCalendarMinuteLog(full, false), '00:00 – 24:00  Sleep');
  assert.equal(parseCalendarMinuteLog(formatCalendarMinuteLog(full)).length, 1440);
  assert.equal(parseCalendarMinuteLog(formatCalendarMinuteLog(full, false)).length, 1440);
});
test('invalid, overlapping and oversized ranges require review', () => {
  assert.throws(() => parseCalendarMinuteLog('13:00 – 13:03  A\n13:02  B'), /duplicate/);
  assert.throws(() => parseCalendarMinuteLog('25:00 – 25:01  A'), /invalid/);
  assert.throws(() => parseCalendarMinuteLog('13:00 – 14:00 (+1 day)  A'), /24 hours/);
  assert.throws(() => formatCalendarMinuteLog([minute(3, 'A'), minute(3, 'A')]), /chronological/);
  assert.throws(() => formatCalendarMinuteLog([minute(3, 'A', '2026-02-30')]), /valid dates/);
});
test('version two distinguishes compact ranges from legacy prose and synchronizes its metadata', () => {
  const log = formatCalendarMinuteLog([minute(791, 'Read'), minute(792, 'Read')]);
  const made = makeCalendarDescription('Original', log, 2);
  assert.equal(made.descriptionLog.version, 2);
  assert.equal(readCalendarDescription({ ...made, projectionId: 'p' }, 'p').log, log);
  assert.equal(parseProjectedMinutes(log, { ranges: true }).length, 2);
  assert.equal(parseProjectedMinutes('13:11 – 13:13 is literal prose')[0]?.text, '– 13:13 is literal prose');
  const batch = { version: 1, id: 'rangeformat', documents: [{ key: 'projection:p', revision: '0000000000000001:00000000:device00',
    value: { baseEvent: { descriptionLog: made.descriptionLog } } }] };
  assert.deepEqual(validateBatch(batch), batch);
});
