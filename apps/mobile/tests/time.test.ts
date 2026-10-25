/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { zonedMinuteToInstant } from '../src/sync/time';

const duration = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / 60000;

test('New York spring-forward endpoints resolve to one real hour across two civil hours', () => {
  const start = zonedMinuteToInstant('2026-03-08', 90, 'America/New_York');
  const end = zonedMinuteToInstant('2026-03-08', 210, 'America/New_York');
  assert.equal(start, '2026-03-08T06:30:00.000Z');
  assert.equal(end, '2026-03-08T07:30:00.000Z');
  assert.equal(duration(start, end), 60);
});

test('New York fall-back endpoints resolve to three real hours across two civil hours', () => {
  const start = zonedMinuteToInstant('2026-11-01', 30, 'America/New_York');
  const end = zonedMinuteToInstant('2026-11-01', 150, 'America/New_York');
  assert.equal(start, '2026-11-01T04:30:00.000Z');
  assert.equal(end, '2026-11-01T07:30:00.000Z');
  assert.equal(duration(start, end), 180);
});

test('a nonexistent spring-forward minute is rejected instead of being silently shifted', () => {
  assert.throws(
    () => zonedMinuteToInstant('2026-03-08', 150, 'America/New_York'),
    /does not exist.*clocks moved forward/,
  );
});

test('a repeated fall-back endpoint is rejected instead of arbitrarily selecting one fold', () => {
  assert.throws(
    () => zonedMinuteToInstant('2026-11-01', 90, 'America/New_York'),
    /repeated daylight-saving hour/,
  );
});

test('minute 1440 resolves next-day midnight with that day’s correct UTC offset', () => {
  assert.equal(
    zonedMinuteToInstant('2026-03-08', 1440, 'America/New_York'),
    '2026-03-09T04:00:00.000Z',
  );
  assert.equal(
    zonedMinuteToInstant('2026-11-01', 1440, 'America/New_York'),
    '2026-11-02T05:00:00.000Z',
  );
  assert.equal(
    zonedMinuteToInstant('2026-10-25', 1440, 'Asia/Kathmandu'),
    '2026-10-25T18:15:00.000Z',
  );
});

test('quarter-hour offsets are preserved for Kathmandu without rounding to whole hours', () => {
  assert.equal(
    zonedMinuteToInstant('2026-10-25', 360, 'Asia/Kathmandu'),
    '2026-10-25T00:15:00.000Z',
  );
  assert.equal(
    zonedMinuteToInstant('2026-10-25', 720, 'Asia/Kathmandu'),
    '2026-10-25T06:15:00.000Z',
  );
});

test('captured IANA-zone conversion does not depend on the phone’s current travel timezone', () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const inLosAngeles = zonedMinuteToInstant('2026-10-25', 1135, 'America/New_York');
    process.env.TZ = 'Asia/Tokyo';
    const inTokyo = zonedMinuteToInstant('2026-10-25', 1135, 'America/New_York');
    assert.equal(inLosAngeles, '2026-10-25T22:55:00.000Z');
    assert.equal(inTokyo, inLosAngeles);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
