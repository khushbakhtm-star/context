import assert from 'node:assert/strict';
import test from 'node:test';
import { createCalendarListFocus } from '../src/utils/calendar-list-focus';

test('an unmeasured agenda target is rendered approximately, then scrolled to its exact top', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: { index?: number; offset?: number; viewOffset?: number }[] = [];
  let measured = false;
  const list = {
    scrollToIndex(options: { index: number; viewOffset: number }) {
      calls.push(options);
      if (!measured) focus.onFailure({ index: options.index, averageItemLength: 80 });
    },
    scrollToOffset(options: { offset: number }) { calls.push(options); },
  };
  const focus = createCalendarListFocus(() => list, () => true);
  focus.request(25, -240);
  t.mock.timers.tick(0);
  assert.equal(calls[0]?.index, 25);
  assert.equal(calls[1]?.offset, 2000);
  measured = true;
  t.mock.timers.tick(150);
  assert.equal(calls[2]?.index, 25);
  assert.equal(calls[2]?.viewOffset, -240);
  t.mock.timers.tick(300);
  assert.equal(calls.length, 3);
});

test('new dates replace an old retry and manual dragging cancels pending movement', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: number[] = [];
  const focus = createCalendarListFocus(() => ({ scrollToIndex: ({ index }) => calls.push(index), scrollToOffset() {} }), () => true);
  focus.request(25); focus.request(3);
  t.mock.timers.tick(0);
  assert.deepEqual(calls, [3]);
  focus.request(17); focus.cancel();
  t.mock.timers.tick(1000);
  assert.deepEqual(calls, [3]);
});

test('closed views, invalid dates and perpetually unmeasured lists cannot keep scrolling', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let active = true; let count = 0;
  const focus = createCalendarListFocus(() => ({
    scrollToIndex({ index }) { count++; focus.onFailure({ index, averageItemLength: 60 }); }, scrollToOffset() {},
  }), () => active);
  focus.request(-1); t.mock.timers.tick(0); assert.equal(count, 0);
  focus.request(25);
  for (let index = 0; index < 12; index++) t.mock.timers.tick(150);
  assert.equal(count, 8);
  focus.request(7); active = false;
  t.mock.timers.tick(150);
  assert.equal(count, 8);
});

test('a request made before the native list mounts waits for its ref and is still cancelable', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls: number[] = [];
  let mounted = false;
  const focus = createCalendarListFocus(() => mounted ? {
    scrollToIndex: ({ index }) => calls.push(index), scrollToOffset() {},
  } : null, () => true);
  focus.request(1); t.mock.timers.tick(0);
  assert.deepEqual(calls, []);
  mounted = true; t.mock.timers.tick(150);
  assert.deepEqual(calls, [1]);
  focus.cancel(); t.mock.timers.tick(1000);
  assert.deepEqual(calls, [1]);
});
