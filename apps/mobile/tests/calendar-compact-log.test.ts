import test from 'node:test';
import assert from 'node:assert/strict';
import { compactCalendarMinuteLog, parseCompactCalendarMinuteLog, formatCalendarMinuteLog } from '../src/utils/calendar-minute-log';
import { makeCompactCalendarDescription, makeCalendarDescription, readCalendarDescription, isDescriptionLog } from '../src/utils/calendar-description';

const minute = (minuteIndex: number, text: string, dateKey = '2026-10-27') => ({ dateKey, minuteIndex, text });

test('consecutive identical notes appear once with their first timestamp and retain all occupied minute cells', () => {
  const notes = [minute(530, 'Wash face'), minute(531, ''), ...[536, 537, 538, 539].map((n) => minute(n, 'Put on makeup')),
    minute(540, ''), minute(541, 'Collect keys')];
  const compact = compactCalendarMinuteLog(notes, false);
  assert.equal(compact.log, '08:50  Wash face\n08:56  Put on makeup\n09:01  Collect keys');
  assert.deepEqual(parseCompactCalendarMinuteLog(compact.log, compact), notes.filter((entry) => entry.text)
    .map(({ minuteIndex, text }) => ({ minuteIndex, text })));
  assert.ok(JSON.stringify(makeCompactCalendarDescription('', notes).descriptionLog).length < 1024);
});

test('a repeated note after a blank gap or another note remains a distinct timestamped occurrence', () => {
  const compact = compactCalendarMinuteLog([minute(10, 'Read'), minute(11, 'Read'), minute(12, ''), minute(13, 'Read'),
    minute(14, 'Write'), minute(15, 'Read')], false);
  assert.equal(compact.log, '00:10  Read\n00:13  Read\n00:14  Write\n00:15  Read');
  assert.deepEqual(parseCompactCalendarMinuteLog(compact.log, compact).map((e) => e.minuteIndex), [10, 11, 13, 14, 15]);
});

test('all-blank event notes produce an empty description without timestamp or title placeholders', () => {
  const result = makeCompactCalendarDescription('', [minute(530, ''), minute(531, '')]);
  assert.equal(result.description, '');
  assert.equal(result.descriptionLog.version, 3);
  assert.ok(isDescriptionLog(result.descriptionLog));
  assert.deepEqual(parseCompactCalendarMinuteLog('', result.descriptionLog), []);
});

test('changed note prose can round-trip across a repeated run without accepting ambiguous timestamp edits', () => {
  const compact = compactCalendarMinuteLog([minute(600, 'Read'), minute(601, 'Read'), minute(602, 'Write')], false);
  assert.deepEqual(parseCompactCalendarMinuteLog(compact.log.replace('Read', 'Review'), compact), [
    { minuteIndex: 600, text: 'Review' }, { minuteIndex: 601, text: 'Review' }, { minuteIndex: 602, text: 'Write' }]);
  assert.throws(() => parseCompactCalendarMinuteLog(compact.log.replace('10:00', '10:01'), compact), /timestamps changed/);
  assert.throws(() => parseCompactCalendarMinuteLog(compact.log, { ...compact, minuteMask: '0'.repeat(360) }), /layout needs review/);
});

test('compact repeated runs preserve multiline timestamp-looking prose and midnight boundaries', () => {
  const text = 'Read\n00:01 is part of this note';
  const compact = compactCalendarMinuteLog([minute(1439, text), minute(0, text, '2026-10-28'), minute(1, '', '2026-10-28')], false);
  assert.equal(compact.log, '23:59  Read\n    00:01 is part of this note');
  assert.deepEqual(parseCompactCalendarMinuteLog(compact.log, compact), [{ minuteIndex: 1439, text }, { minuteIndex: 0, text }]);
});

test('a full day uses bounded private metadata even when every minute has a different note', () => {
  const notes = Array.from({ length: 1440 }, (_, n) => minute(n, `Note ${n}`));
  const compact = compactCalendarMinuteLog(notes, false);
  assert.equal(parseCompactCalendarMinuteLog(compact.log, compact).length, 1440);
  assert.ok(JSON.stringify(makeCompactCalendarDescription('', notes).descriptionLog).length < 1024);
  assert.throws(() => compactCalendarMinuteLog([minute(10, 'One'), minute(10, 'Two')]), /chronological/);
});

test('clearing an owned description clears its former prefix and log even with a stale private offset', () => {
  for (const generated of [makeCalendarDescription('Location notes', '10:00  Read', 2),
    makeCompactCalendarDescription('Location notes', [minute(600, 'Read')])]) {
    assert.deepEqual(readCalendarDescription({ ...generated, description: '', projectionId: 'known' }, 'known'),
      { preserved: '', log: '', format: 'clean' });
  }
  assert.equal(formatCalendarMinuteLog([minute(600, 'Read'), minute(601, 'Read')], false), '10:00 – 10:02  Read',
    'old formatter remains available for legacy acknowledgement proof');
});
