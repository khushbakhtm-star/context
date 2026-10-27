import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calendarEntriesAreCurrent, calendarLoadIsCurrent, indexCalendarDay, loadCalendarMinuteSelection,
  parseCalendarDateInput, suggestedPlanDuration, visibleCalendarDates,
  type CalendarSelectionState,
} from '../src/utils/calendar-grid';
import type { MinuteEntry, PlannedEvent } from '../src/types';
import { localDateAtMinute } from '../src/utils/time';

test('calendar spans preserve civil dates across months and align a seven-day view to Monday', () => {
  assert.deepEqual(visibleCalendarDates('2026-10-25', 7), [
    '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
  ]);
  assert.deepEqual(visibleCalendarDates('2026-12-31', 3), ['2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(visibleCalendarDates('2026-11-01', 1), ['2026-11-01']);
});

test('date entry accepts US and ISO dates without silently rolling invalid dates', () => {
  assert.equal(parseCalendarDateInput('10/25/2026'), '2026-10-25');
  assert.equal(parseCalendarDateInput('2028-02-29'), '2028-02-29');
  for (const invalid of ['02/29/2026', '2026-13-01', '2026-04-31', '10/25/26', 'text']) {
    assert.equal(parseCalendarDateInput(invalid), null);
  }
});

test('day columns isolate their own entries and clip overnight plans at minute boundaries', () => {
  const entries = [
    { dateKey: '2026-10-25', minuteIndex: 12, text: 'Sunday' },
    { dateKey: '2026-10-26', minuteIndex: 12, text: 'Monday' },
  ] as MinuteEntry[];
  const sleep = { id: 'sleep', calendarId: 'calendar', title: 'Sleep', color: '#888888', allDay: false,
    startDate: localDateAtMinute('2026-10-25', 23 * 60),
    endDate: localDateAtMinute('2026-10-26', 6 * 60) } satisfies PlannedEvent;
  const allDay = { ...sleep, id: 'all-day', allDay: true };
  const sunday = indexCalendarDay('2026-10-25', entries, [sleep, allDay]);
  const monday = indexCalendarDay('2026-10-26', entries, [sleep, allDay]);
  assert.equal(sunday.entriesByMinute.get(12)?.text, 'Sunday');
  assert.equal(monday.entriesByMinute.get(12)?.text, 'Monday');
  assert.equal(sunday.plansByMinute.has(1379), false);
  assert.deepEqual(sunday.plansByMinute.get(1380), [sleep]);
  assert.deepEqual(sunday.plansByMinute.get(1439), [sleep]);
  assert.deepEqual(monday.plansByMinute.get(0), [sleep]);
  assert.deepEqual(monday.plansByMinute.get(359), [sleep]);
  assert.equal(monday.plansByMinute.has(360), false);
});

test('plan duration uses the tapped column date when an activity crosses midnight', () => {
  const plan = { id: 'late', calendarId: 'calendar', title: 'Late activity', color: '#888888', allDay: false,
    startDate: localDateAtMinute('2026-10-25', 23 * 60 + 50),
    endDate: localDateAtMinute('2026-10-26', 30) } satisfies PlannedEvent;
  assert.equal(suggestedPlanDuration('2026-10-25', 23 * 60 + 50, null, plan), 40);
  assert.equal(suggestedPlanDuration('2026-10-26', 10, null, plan), 20);
  assert.equal(suggestedPlanDuration('2026-10-25', 1430, {} as MinuteEntry, plan), null);
});

test('overlapping source title, color and edit identity stay stable across provider arrival orders', async () => {
  const day = '2026-10-25';
  const native = { id: 'device-event', calendarId: 'device', title: 'Pray', color: '#0B8043', allDay: false,
    startDate: localDateAtMinute(day, 389), endDate: localDateAtMinute(day, 390) } satisfies PlannedEvent;
  const account = { ...native, id: 'remote-event', calendarId: 'google-calendar', color: '#51B749',
    accountEvent: { accountId: 'google:owner', event: { id: 'remote-event' } } } as PlannedEvent;
  const other = { ...account, id: 'another-real-event', calendarId: 'z-other-calendar', title: 'Another activity' };
  for (const order of [[native, account, other], [other, account, native], [account, native, other]]) {
    const original = [...order];
    const events = indexCalendarDay(day, [], order).plansByMinute.get(389)!;
    assert.equal(events[0], account); assert.equal(events[0]!.color, '#51B749');
    assert.equal(events.length, 3, 'overlaps are retained; title/time similarity is not treated as identity');
    assert.deepEqual(order, original, 'the caller cache is not mutated');
    const selected = await loadCalendarMinuteSelection({ dateKey: day, minuteIndex: 389, rangeKey: day, token: 1 }, {
      readEntry: async () => null, readPlans: () => order,
      currentState: () => ({ mounted: true, rangeKey: day, token: 1, visibleDays: [day] }),
    });
    assert.equal(selected!.plan, account, 'the displayed source and explicit Event action use the same identity');
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('a delayed minute read is discarded when navigation has moved to a different range', async () => {
  const read = deferred<MinuteEntry | null>();
  const state: CalendarSelectionState = { mounted: true, rangeKey: 'first-range', token: 1,
    visibleDays: ['2026-10-25'] };
  const pending = loadCalendarMinuteSelection({ dateKey: '2026-10-25', minuteIndex: 12,
    rangeKey: 'first-range', token: 1 }, {
    readEntry: () => read.promise,
    readPlans: () => { throw new Error('Stale selection must not read another range’s plans'); },
    currentState: () => state,
  });
  state.rangeKey = 'next-range';
  state.visibleDays = ['2026-10-26'];
  read.resolve({ dateKey: '2026-10-25', minuteIndex: 12, text: 'Earlier date' } as MinuteEntry);
  assert.equal(await pending, null);
});

test('rapid taps keep only the newest request and bind its editor to the tapped column', async () => {
  const firstRead = deferred<MinuteEntry | null>();
  const days = visibleCalendarDates('2026-10-25', 3);
  const rangeKey = days.join('|');
  const state: CalendarSelectionState = { mounted: true, rangeKey, token: 1, visibleDays: days };
  const earlier = loadCalendarMinuteSelection({ dateKey: days[0]!, minuteIndex: 12, rangeKey, token: 1 }, {
    readEntry: () => firstRead.promise, readPlans: () => [], currentState: () => state,
  });
  state.token = 2;
  const latestEntry = { dateKey: days[2]!, minuteIndex: 48, text: 'Third column' } as MinuteEntry;
  const latest = await loadCalendarMinuteSelection({ dateKey: days[2]!, minuteIndex: 48, rangeKey, token: 2 }, {
    readEntry: async (day, minute) => {
      assert.equal(day, days[2]);
      assert.equal(minute, 48);
      return latestEntry;
    }, readPlans: () => [], currentState: () => state,
  });
  firstRead.resolve(null);
  assert.equal(await earlier, null);
  assert.equal(latest?.dateKey, days[2]);
  assert.equal(latest?.minuteIndex, 48);
  assert.equal(latest?.entry, latestEntry);
});

test('a wrong-date database result cannot initialize another column’s editor', async () => {
  const state: CalendarSelectionState = { mounted: true, rangeKey: 'range', token: 1,
    visibleDays: ['2026-10-25', '2026-10-26'] };
  await assert.rejects(loadCalendarMinuteSelection({ dateKey: '2026-10-26', minuteIndex: 12,
    rangeKey: 'range', token: 1 }, {
    readEntry: async () => ({ dateKey: '2026-10-25', minuteIndex: 12 } as MinuteEntry),
    readPlans: () => [], currentState: () => state,
  }), /does not match/);
  state.mounted = false;
  assert.equal(await loadCalendarMinuteSelection({ dateKey: '2026-10-26', minuteIndex: 12,
    rangeKey: 'range', token: 1 }, {
    readEntry: async () => null, readPlans: () => [], currentState: () => state,
  }), null);
});

test('late refreshes cannot replace a newer range or overwrite local mutations in one day', async () => {
  const finished = deferred<void>();
  const request = { rangeKey: 'range', token: 1,
    entryEpochs: new Map([['2026-10-25', 0], ['2026-10-26', 0]]) };
  const state = { mounted: true, rangeKey: 'range', token: 1 };
  const localEpochs = new Map([['2026-10-25', 0], ['2026-10-26', 0]]);
  const pending = (async () => {
    await finished.promise;
    return calendarLoadIsCurrent(request, state)
      ? [...request.entryEpochs.keys()].filter((day) => calendarEntriesAreCurrent(day, request, localEpochs)) : [];
  })();
  localEpochs.set('2026-10-26', 1);
  finished.resolve();
  assert.deepEqual(await pending, ['2026-10-25']);
  state.rangeKey = 'other-range';
  state.token = 2;
  assert.equal(calendarLoadIsCurrent(request, state), false);
});
