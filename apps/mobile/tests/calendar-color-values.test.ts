import test from 'node:test';
import assert from 'node:assert/strict';

import { calendarColorRequest, calendarColorValues, MAX_COLOR_CALENDAR_IDS, MAX_COLOR_INTERVAL_MS } from '../modules/context-calendar-colors/src/values';

test('calendar color requests retain exact native IDs, deduplicate selections and isolate their input', () => {
  const ids = ['0', '12', '12', '9223372036854775807'];
  const request = calendarColorRequest(ids, -60_000, 60_000);
  assert.deepEqual(request, { calendarIds: ['0', '12', '9223372036854775807'], startMs: -60_000, endMs: 60_000 });
  ids[0] = '999';
  assert.equal(request!.calendarIds[0], '0');
  assert.deepEqual(calendarColorRequest([], 0, 1), { calendarIds: [], startMs: 0, endMs: 1 });
});

test('calendar color requests bound IDs and timestamps before any native provider call', () => {
  for (const ids of [null, ['-1'], ['01'], ['1 OR 1=1'], ['1)'], ['9223372036854775808'], [1],
    Array.from({ length: MAX_COLOR_CALENDAR_IDS + 1 }, (_, index) => String(index))]) {
    assert.equal(calendarColorRequest(ids, 0, 1), null);
  }
  for (const [start, end] of [[0, 0], [1, 0], [NaN, 1], [0, Infinity], [0.5, 1], [0, MAX_COLOR_INTERVAL_MS + 1],
    [0, 8_640_000_000_000_001], [-8_640_000_000_000_001, -8_640_000_000_000_000]]) {
    assert.equal(calendarColorRequest(['1'], start, end), null);
  }
  assert.ok(calendarColorRequest(Array.from({ length: MAX_COLOR_CALENDAR_IDS }, (_, index) => String(index)), 0, 1));
});

test('a civil week crossing the fall daylight-saving transition remains within the bounded color interval', () => {
  const start = Date.parse('2026-10-31T00:00:00-04:00');
  const end = Date.parse('2026-11-07T00:00:00-05:00');
  assert.equal(end - start, 169 * 3_600_000);
  assert.ok(calendarColorRequest(['1'], start, end));
  assert.ok(calendarColorRequest(['1'], 0, MAX_COLOR_INTERVAL_MS));
});

test('provider color values retain event and exact-occurrence keys and reject arbitrary style values', () => {
  const input = Object.assign(Object.create({ inherited: '#FFFFFF' }), {
    '0': '#000000', '12': '#aabbcc', '12@-60000': '#fF0000', '9223372036854775807@0': '#FFFFFF',
    'bad': '#FFFFFF', '12@00': '#FFFFFF', '12@NaN': '#FFFFFF', '12@0@1': '#FFFFFF',
    '12@1.5': '#FFFFFF', '9223372036854775808': '#FFFFFF', '2': 'red', '3': '#11223344', '4': 'url(example)',
  });
  assert.deepEqual(calendarColorValues(input), {
    '0': '#000000', '12': '#AABBCC', '12@-60000': '#FF0000', '9223372036854775807@0': '#FFFFFF',
  });
  assert.deepEqual(calendarColorValues(null), {});
  assert.deepEqual(calendarColorValues(['#FFFFFF']), {});
  assert.deepEqual(calendarColorValues({ '1@9007199254740992': '#FFFFFF', '1': null }), {});
});
