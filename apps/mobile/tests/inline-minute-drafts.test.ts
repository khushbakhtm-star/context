import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { InlineMinuteDrafts, inlineMinuteKey, type InlineMinuteValue } from '../src/utils/inline-minute-drafts';

const minute = (dateKey = '2026-10-25', minuteIndex = 411): InlineMinuteValue =>
  ({ dateKey, minuteIndex, text: 'Initial entry', categoryId: 'work', keepColor: false });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('an older save acknowledgement cannot erase text typed during its write', async () => {
  const first = deferred<string>();
  const calls: InlineMinuteValue[] = [];
  const drafts = new InlineMinuteDrafts(async (value) => {
    calls.push({ ...value });
    return calls.length === 1 ? first.promise : value.text;
  }, 60_000);
  drafts.activate(minute());
  drafts.edit('2026-10-25', 411, { text: 'First change' });
  const saving = drafts.flush(inlineMinuteKey('2026-10-25', 411));
  await setImmediate();
  drafts.edit('2026-10-25', 411, { text: 'Latest thought  ' });
  first.resolve('First change');
  assert.equal(await saving, true);
  assert.deepEqual(calls.map((value) => value.text), ['First change', 'Latest thought  ']);
  assert.equal(drafts.get('2026-10-25', 411)?.text, 'Latest thought  ', 'raw focused text retains intentional caret whitespace');
  assert.equal(drafts.get('2026-10-25', 411)?.revision, drafts.get('2026-10-25', 411)?.savedRevision);
  await drafts.flushAll();
});

test('first-edit source-color preparation preserves fast typing and close without saving a temporary default color', async () => {
  const ready = deferred<void>(); const calls: InlineMinuteValue[] = [];
  const drafts = new InlineMinuteDrafts(async (value) => { calls.push({ ...value }); return value.text; }, 60_000);
  const key = inlineMinuteKey('2026-10-25', 411);
  drafts.activate({ ...minute(), text: 'Planned activity', categoryId: 'unaccounted' });
  drafts.edit('2026-10-25', 411, { text: 'First note' });
  drafts.prepareBeforeSave(key, ready.promise.then(() => drafts.edit('2026-10-25', 411, { categoryId: 'source-color' })));
  const saving = drafts.flush(key); drafts.close(key);
  drafts.edit('2026-10-25', 411, { text: 'Latest note while the color loads  ' });
  await setImmediate(); assert.equal(calls.length, 0);
  assert.equal(drafts.get('2026-10-25', 411)?.text, 'Latest note while the color loads  ');
  ready.resolve(); await saving; await setImmediate();
  assert.deepEqual(calls.map(({ text, categoryId }) => ({ text, categoryId })),
    [{ text: 'Latest note while the color loads  ', categoryId: 'source-color' }]);
  assert.equal(drafts.get('2026-10-25', 411), null, 'the closed draft prunes only after its prepared value saves');
});

test('failed optional color preparation cannot discard the raw minute text', async () => {
  const calls: InlineMinuteValue[] = [];
  const drafts = new InlineMinuteDrafts(async (value) => { calls.push({ ...value }); return null; }, 60_000);
  drafts.activate(minute()); drafts.edit('2026-10-25', 411, { text: 'Keep the thought' });
  drafts.prepareBeforeSave(inlineMinuteKey('2026-10-25', 411), Promise.reject(new Error('Color metadata unavailable')));
  assert.equal(await drafts.flush(inlineMinuteKey('2026-10-25', 411)), true);
  assert.equal(calls[0]!.text, 'Keep the thought');
});

test('different dates serialize SQLite writes and retain their own coordinates during fast switches', async () => {
  const first = deferred<string>();
  const calls: InlineMinuteValue[] = [];
  const drafts = new InlineMinuteDrafts(async (value) => {
    calls.push({ ...value });
    return calls.length === 1 ? first.promise : value.text;
  }, 60_000);
  drafts.activate(minute('2026-10-25', 1439));
  drafts.edit('2026-10-25', 1439, { text: 'Before midnight' });
  drafts.activate(minute('2026-10-26', 0));
  drafts.edit('2026-10-26', 0, { text: 'After midnight' });
  const finishing = drafts.flushAll();
  await setImmediate();
  assert.deepEqual(calls.map((value) => [value.dateKey, value.minuteIndex]), [['2026-10-25', 1439]]);
  first.resolve('done');
  await finishing;
  assert.deepEqual(calls.map((value) => [value.dateKey, value.minuteIndex, value.text]), [
    ['2026-10-25', 1439, 'Before midnight'], ['2026-10-26', 0, 'After midnight'],
  ]);
});

test('a failed save retains its dated draft across navigation and can retry without a stale reseed', async () => {
  let fail = true;
  const saved: string[] = [];
  const drafts = new InlineMinuteDrafts(async (value) => {
    if (fail) throw new Error('SQLite unavailable');
    saved.push(value.text); return value.text;
  }, 60_000);
  drafts.activate(minute());
  drafts.edit('2026-10-25', 411, { text: 'Keep this thought' });
  assert.equal(await drafts.flush(inlineMinuteKey('2026-10-25', 411)), false);
  drafts.close(inlineMinuteKey('2026-10-25', 411));
  await setImmediate();
  assert.equal(drafts.get('2026-10-25', 411)?.error, true);
  drafts.activate(minute('2026-10-26', 412));
  drafts.activate({ ...minute(), text: 'Older database value' });
  assert.equal(drafts.get('2026-10-25', 411)?.text, 'Keep this thought');
  fail = false;
  await drafts.flushAll();
  assert.deepEqual(saved, ['Keep this thought']);
  assert.equal(drafts.get('2026-10-25', 411)?.error, false);
});

test('observer failures cannot turn a committed save into a failed save or poison the next coordinate', async () => {
  const calls: string[] = [];
  const drafts = new InlineMinuteDrafts(async (value) => { calls.push(value.text); return value.text; }, 60_000);
  drafts.subscribe(() => { throw new Error('unmounted observer'); });
  drafts.subscribeCommits(() => { throw new Error('unmounted commit observer'); });
  drafts.activate(minute());
  drafts.edit('2026-10-25', 411, { text: 'Saved once' });
  assert.equal(await drafts.flush(inlineMinuteKey('2026-10-25', 411)), true);
  drafts.activate(minute('2026-10-26', 411));
  drafts.edit('2026-10-26', 411, { text: 'Next coordinate' });
  await drafts.flushAll();
  assert.deepEqual(calls, ['Saved once', 'Next coordinate']);
  assert.equal(drafts.snapshot().some((value) => value.error), false);
});

test('an explicit blank color and a deliberate text deletion remain distinct save intents', async () => {
  const calls: InlineMinuteValue[] = [];
  const drafts = new InlineMinuteDrafts(async (value) => { calls.push({ ...value }); return null; }, 60_000);
  drafts.activate({ ...minute(), text: '', keepColor: false });
  drafts.edit('2026-10-25', 411, { categoryId: 'prayer', keepColor: true });
  await drafts.flushAll();
  drafts.edit('2026-10-25', 411, { text: 'Recorded thought', keepColor: false });
  await drafts.flushAll();
  drafts.edit('2026-10-25', 411, { text: '', keepColor: false });
  await drafts.flushAll();
  assert.deepEqual(calls.map(({ text, categoryId, keepColor }) => ({ text, categoryId, keepColor })), [
    { text: '', categoryId: 'prayer', keepColor: true },
    { text: 'Recorded thought', categoryId: 'prayer', keepColor: false },
    { text: '', categoryId: 'prayer', keepColor: false },
  ]);
});
