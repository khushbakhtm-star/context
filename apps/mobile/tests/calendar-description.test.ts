import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { isDescriptionLog, makeCalendarDescription, readCalendarDescription, type DescriptionLog } from '../src/utils/calendar-description';

const id = 'projection_coffee';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const owned = (preserved: string, log: string) => ({ ...makeCalendarDescription(preserved, log), projectionId: id });
const legacy = (body: string, newline = '\n') => ['--- Context minutes ---', body,
  '--- End Context minutes ---'].join(newline);

test('clean descriptions preserve all original bytes and contain only timestamped user notes', () => {
  const preserved = ' \r\nBring Mum’s mug ☕\nOriginal appointment text.  \n';
  const log = '12:39 PM  Make coffee\n12:40 PM  Talk to Mum about making a doctor’s appointment';
  const result = makeCalendarDescription(preserved, log);
  assert.equal(result.description, `${preserved}\n\n${log}`);
  assert.deepEqual(result.descriptionLog, { version: 1, offset: preserved.length + 2,
    prefixHash: sha(preserved), logHash: sha(log) });
  assert.deepEqual(readCalendarDescription({ ...result, projectionId: id }, id), {
    preserved, log, format: 'clean',
  });
  const empty = makeCalendarDescription('', '13:11  Read the answer');
  assert.equal(empty.descriptionLog.offset, 0);
  assert.equal(empty.description, '13:11  Read the answer');
  assert.deepEqual(readCalendarDescription({ ...empty, projectionId: id }, id), {
    preserved: '', log: empty.description, format: 'clean',
  });
});

test('repeated clean writes replace the generated tail without duplicating it or trimming original whitespace', () => {
  const preserved = '\n\nOriginal notes  \r\n';
  let event = owned(preserved, '12:39 PM  Make coffee');
  for (let minute = 40; minute < 45; minute += 1) {
    const parts = readCalendarDescription(event, id);
    const nextLog = `12:${minute} PM  Still making coffee`;
    event = { ...makeCalendarDescription(parts.preserved, nextLog), projectionId: id };
    assert.equal(event.description, `${preserved}\n\n${nextLog}`);
  }
  assert.ok(!event.description.includes('12:39'));
});

test('clean metadata allows remote tail edits but rejects prefix, separator and ownership-metadata corruption', () => {
  const event = owned('Original appointment', '12:39 PM  Make coffee');
  const edited = { ...event, description: 'Original appointment\n\n12:39 PM  Talk to Mum\n12:40 PM  Boil water' };
  assert.deepEqual(readCalendarDescription(edited, id), { preserved: 'Original appointment',
    log: '12:39 PM  Talk to Mum\n12:40 PM  Boil water', format: 'clean' });
  assert.throws(() => readCalendarDescription({ ...event,
    description: event.description.replace('Original', 'Changed!') }, id), /Review it before synchronizing/);
  assert.throws(() => readCalendarDescription({ ...event,
    description: event.description.replace('\n\n', '\n ') }, id), /Review it before synchronizing/);
  for (const changes of [{ offset: 1 }, { offset: event.description.length + 1 },
    { offset: 0 }, { prefixHash: '0'.repeat(64) }, { version: 2 }, { logHash: 'bad' }]) {
    assert.throws(() => readCalendarDescription({ ...event,
      descriptionLog: { ...event.descriptionLog, ...changes } as DescriptionLog }, id), /Review it before synchronizing/);
  }
  const wrongOwner = { ...edited, projectionId: 'somebody_else' };
  assert.deepEqual(readCalendarDescription(wrongOwner, id), {
    preserved: wrongOwner.description, log: null, format: 'original',
  });
});

test('metadata has a bounded exact shape with lowercase SHA256 digests', () => {
  const valid = makeCalendarDescription('', '').descriptionLog;
  assert.ok(isDescriptionLog(valid));
  assert.ok(isDescriptionLog({ ...valid, offset: 2_000_000 }));
  for (const value of [null, [], 'value', { ...valid, offset: -1 }, { ...valid, offset: 0.5 },
    { ...valid, offset: 2_000_001 }, { ...valid, offset: NaN }, { ...valid, version: '1' },
    { ...valid, prefixHash: 'A'.repeat(64) }, { ...valid, logHash: 'f'.repeat(63) },
    { ...valid, extra: true }, { version: 1, offset: 0, prefixHash: valid.prefixHash }]) {
    assert.equal(isDescriptionLog(value), false);
  }
  assert.throws(() => makeCalendarDescription('x'.repeat(1_999_999), 'note'), /too long/);
});

test('original timestamp prose, Unaccounted and literal Context-like text never imply ownership', () => {
  const description = 'Unaccounted\n12:39 PM Meet the doctor\nContext category: a literal note\nContext projection: an idea';
  assert.deepEqual(readCalendarDescription({ description }, id), { preserved: description, log: null, format: 'original' });
  const unowned = legacy('Context category: family\n12:39 PM  Make coffee\nContext projection: somebody_else');
  assert.deepEqual(readCalendarDescription({ description: unowned }, id), {
    preserved: unowned, log: null, format: 'original',
  });
  const inline = `My note says ${legacy(`Context projection: ${id}`)} but these are inline words.`;
  assert.deepEqual(readCalendarDescription({ description: inline }, id), {
    preserved: inline, log: null, format: 'original',
  });
});

test('owned legacy migration removes only generated boundary scaffolding and one join', () => {
  const preserved = '  Unaccounted\r\nOriginal notes\n\n';
  const log = '12:39 PM  Make coffee\nContext category: words I typed\n12:40 PM  Talk to Mum\nContext projection: a literal note';
  const description = `${preserved}\n\n${legacy(`Context category: family\n${log}\nContext projection: ${id}`)}`;
  const parts = readCalendarDescription({ description }, id);
  assert.deepEqual(parts, { preserved, log, format: 'legacy' });
  const clean = makeCalendarDescription(parts.preserved, parts.log!);
  assert.equal(clean.description, `${preserved}\n\n${log}`);
  assert.deepEqual(readCalendarDescription({ ...clean, projectionId: id }, id), { preserved, log, format: 'clean' });

  const crlf = legacy(`Context category: family\r\n12:39 PM  Make coffee\r\nContext projection: ${id}`, '\r\n');
  assert.deepEqual(readCalendarDescription({ description: `Original\r\n\r\n${crlf}` }, id), {
    preserved: 'Original', log: '12:39 PM  Make coffee', format: 'legacy',
  });
});

test('event-level legacy ownership permits missing footer without stripping literal body text', () => {
  const log = '12:39 PM  Make coffee\nContext projection: a literal note';
  const description = `${legacy(`Context category: family\n${log}`)}\n\nAdded outside the log  `;
  assert.deepEqual(readCalendarDescription({ description, projectionId: id }, id), {
    preserved: 'Added outside the log  ', log, format: 'legacy',
  });
  const withSuffix = `Original  \n\n${legacy(`Context category: family\n12:39 PM  Coffee\nContext projection: ${id}`)}\n\nA new original note`;
  assert.deepEqual(readCalendarDescription({ description: withSuffix }, id), {
    preserved: 'Original  \n\nA new original note', log: '12:39 PM  Coffee', format: 'legacy',
  });
});

test('ambiguous or truncated owned legacy scaffolding requires review and unrelated large prose stays original', () => {
  const block = legacy(`Context category: family\n12:39 PM  Coffee\nContext projection: ${id}`);
  assert.throws(() => readCalendarDescription({ description: `${block}\n${block}`, projectionId: id }, id), /Review/);
  assert.throws(() => readCalendarDescription({ description: 'Original\n--- Context minutes ---\n12:39 Coffee', projectionId: id }, id), /Review/);
  assert.throws(() => readCalendarDescription({ description: '--- End Context minutes ---\n--- Context minutes ---', projectionId: id }, id), /Review/);
  const large = 'Original '.repeat(230_000);
  assert.equal(readCalendarDescription({ description: large }, id).preserved, large);
  assert.throws(() => readCalendarDescription({ description: large, projectionId: id }, id), /Review/);
});
