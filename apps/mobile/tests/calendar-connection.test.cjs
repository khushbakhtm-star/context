const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function transpile(filename) {
  return ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function calendarRuntime(overrides = {}) {
  const state = {
    platform: 'android', permission: 'granted',
    calendars: [{ id: 'google-personal', title: 'Personal', color: '#2952A3',
      allowsModifications: true, source: { name: 'Google' } }],
    events: [], create: async () => ({ action: 'done', id: null }),
    open: async () => ({ action: 'done' }), ...overrides,
  };
  const calls = { permission: 0, calendars: 0, create: [], open: [], queries: [] };
  const timeFile = path.join(__dirname, '../src/utils/time.ts');
  const timeModule = { exports: {} };
  vm.runInNewContext(transpile(timeFile), { module: timeModule, exports: timeModule.exports, Date, Intl },
    { filename: timeFile });
  const nativeCalendar = {
    EntityTypes: { EVENT: 'event' },
    async getCalendarPermissionsAsync() { calls.permission += 1; return { status: state.permission }; },
    async getCalendarsAsync() { calls.calendars += 1; return state.calendars; },
    async createEventInCalendarAsync(details, options) {
      calls.create.push({ details, options });
      return state.create(details, options);
    },
    async openEventInCalendarAsync(details, options) {
      calls.open.push({ details, options });
      return state.open(details, options);
    },
    async getEventsAsync(ids, start, end) {
      calls.queries.push({ ids: [...ids], start, end });
      // Match the Android provider's fully-contained query semantics. The service
      // must pad its request before applying the correct day-overlap filter.
      return state.events.filter((event) => ids.includes(event.calendarId) &&
        new Date(event.startDate) >= start && new Date(event.endDate) <= end);
    },
  };
  const filename = path.join(__dirname, '../src/services/calendar.ts');
  const module = { exports: {} };
  vm.runInNewContext(transpile(filename), {
    module, exports: module.exports, Date, Intl, Map, Set, Promise, console,
    require(name) {
      if (name === 'react-native') return { Platform: { OS: state.platform } };
      if (name === 'expo-calendar/legacy') return nativeCalendar;
      if (name === 'expo-calendar') return {};
      if (name === '../data/database') return {};
      if (name === '../sync/accounts') return { getAccounts: async () => [] };
      if (name === '../theme') return { categoryById: () => ({ name: 'Activity' }) };
      if (name === '../utils/time') return timeModule.exports;
      if (name === '../utils/cell-format') return require('../src/utils/cell-format.ts');
      if (name === '../utils/activity-translation') return require('../src/utils/activity-translation.ts');
      if (name === '../utils/calendar-cell-color') return require('../src/utils/calendar-cell-color.ts');
      if (name === '../../modules/context-calendar-colors') return { getEventColorsAsync: async () => ({}) };
      throw new Error(`Unexpected calendar test import: ${name}`);
    },
  }, { filename });
  return { api: module.exports, time: timeModule.exports, state, calls };
}

for (const scenario of [
  { name: 'denied calendar access', permission: 'denied', ids: ['google-personal'], reason: 'permission' },
  { name: 'no selected calendar', ids: [], reason: 'selection' },
  { name: 'a stale selected calendar', ids: ['removed-calendar'], reason: 'selection' },
  { name: 'no available phone calendars', calendars: [], ids: ['google-personal'], reason: 'unavailable' },
  { name: 'a web session', platform: 'web', ids: ['google-personal'], reason: 'unavailable' },
]) {
  test(`connected event creation cannot launch with ${scenario.name}`, async () => {
    const { api, calls } = calendarRuntime(scenario);
    const ids = [...scenario.ids];
    await assert.rejects(api.createPlanInSystemCalendar('2026-10-25', 790, ids),
      (error) => error instanceof api.CalendarPlanConnectionError && error.reason === scenario.reason);
    assert.equal(calls.create.length, 0);
    assert.deepEqual(ids, scenario.ids, 'The guard must not select or broaden any calendar.');
    if (scenario.reason === 'permission' || scenario.platform === 'web') assert.equal(calls.calendars, 0);
  });
}

test('a plan saved in the selected phone calendar is loaded at its exact minute range', async () => {
  const { api, time, state, calls } = calendarRuntime();
  state.create = async (details) => {
    state.events.push({ id: 'created-plan', calendarId: 'google-personal', title: 'Make coffee',
      startDate: details.startDate, endDate: details.endDate, allDay: false });
    return { action: 'done', id: null };
  };
  const selection = ['google-personal'];
  await api.createPlanInSystemCalendar('2026-10-25', 790, selection);
  const calendars = await api.listDeviceCalendars();
  const plans = await api.loadPlannedEvents(selection, '2026-10-25', calendars);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].id, 'created-plan');
  assert.equal(plans[0].title, 'Make coffee');
  assert.equal(plans[0].color, '#2952A3');
  const range = time.calendarMinuteRange(plans[0].startDate, plans[0].endDate, '2026-10-25');
  assert.equal(range.startMinute, 790);
  assert.equal(range.endMinuteExclusive, 820);
  assert.deepEqual(calls.queries[0].ids, selection);
});

test('Android plan creation opens a separate calendar task and does not classify done/null as saved', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const { api, calls } = calendarRuntime({ create: () => pending });
  let completed = false;
  const operation = api.createPlanInSystemCalendar('2026-10-25', 790, ['google-personal'])
    .then((result) => { completed = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].options.startNewActivityTask, true);
  assert.equal(completed, false);
  finish({ action: 'done', id: null });
  const result = await operation;
  assert.equal(completed, true);
  assert.equal(result.action, 'done');
  assert.equal(result.id, null);
});

test('opening an existing Android plan uses a separate calendar task', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const { api, calls } = calendarRuntime({ open: () => pending });
  const startDate = new Date(2026, 9, 25, 13, 10);
  let completed = false;
  const operation = api.openPlannedEvent({ id: 'existing', startDate })
    .then(() => { completed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.open[0].details.id, 'existing');
  assert.equal(calls.open[0].options.startNewActivityTask, true);
  assert.equal(calls.open[0].options.allowsEditing, true);
  assert.equal(completed, false);
  finish({ action: 'done' });
  await operation;
  assert.equal(completed, true);
});

test('iOS calendar forms retain modal presentation', async () => {
  const { api, calls } = calendarRuntime({ platform: 'ios' });
  await api.createPlanInSystemCalendar('2026-10-25', 790, ['google-personal']);
  await api.openPlannedEvent({ id: 'existing', startDate: new Date(2026, 9, 25, 13, 10) });
  assert.equal(calls.create[0].options.startNewActivityTask, false);
  assert.equal(calls.open[0].options.startNewActivityTask, false);
});

test('selected-calendar refresh retains overlapping overnight plans and filters adjacent-only plans', async () => {
  const { api, time, state, calls } = calendarRuntime();
  state.events = [
    { id: 'sleep', calendarId: 'google-personal', title: 'Sleep', allDay: false,
      startDate: new Date(2026, 9, 24, 23), endDate: new Date(2026, 9, 25, 6) },
    { id: 'previous', calendarId: 'google-personal', title: 'Previous day only', allDay: false,
      startDate: new Date(2026, 9, 24, 10), endDate: new Date(2026, 9, 24, 11) },
    { id: 'next', calendarId: 'google-personal', title: 'Next day only', allDay: false,
      startDate: new Date(2026, 9, 26, 10), endDate: new Date(2026, 9, 26, 11) },
  ];
  const plans = await api.loadPlannedEvents(['google-personal'], '2026-10-25', await api.listDeviceCalendars());
  assert.equal(plans.length, 1);
  assert.equal(plans[0].id, 'sleep');
  const range = time.calendarMinuteRange(plans[0].startDate, plans[0].endDate, '2026-10-25');
  assert.equal(range.startMinute, 0);
  assert.equal(range.endMinuteExclusive, 360);
  assert.equal(calls.queries[0].start.getDate(), 24);
  assert.equal(calls.queries[0].end.getDate(), 27);
});
