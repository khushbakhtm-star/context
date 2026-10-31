const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const plain = (value) => JSON.parse(JSON.stringify(value));

function transpile(filename) {
  return ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function event(calendarId = 'selected', overrides = {}) {
  return { id: `${calendarId}-event`, calendarId, title: 'Private event title', notes: 'Private event notes',
    startDate: new Date(2026, 9, 25, 13, 19).toISOString(),
    endDate: new Date(2026, 9, 25, 13, 22).toISOString(), allDay: false, ...overrides };
}

function loadUtility(name, cache = new Map()) {
  const filename = path.join(__dirname, '../src/utils', name + '.ts');
  if (cache.has(filename)) return cache.get(filename);
  const module = { exports: {} }; cache.set(filename, module.exports);
  vm.runInNewContext(transpile(filename), { module, exports: module.exports, Date, Intl,
    TextEncoder, TextDecoder, Uint8Array, Map, Set, Error, console,
    require(specifier) {
      if (specifier.startsWith('@noble/')) return require(specifier);
      if (specifier.startsWith('./')) return loadUtility(specifier.slice(2), cache);
      throw new Error(`Unexpected pure calendar utility import: ${specifier}`);
    },
  }, { filename });
  cache.set(filename, module.exports); return module.exports;
}

function calendarRuntime(overrides = {}) {
  const state = { platform: 'android', events: [event()],
    calendars: [{ id: 'selected', title: 'Private account calendar', color: '#2952A3',
      allowsModifications: true, isVisible: true, isSynced: true }],
    modernAvailable: true, modern: null, legacy: null, eventColors: {}, ...overrides };
  const calls = { modern: [], legacy: [], active: 0, maximumActive: 0 };
  async function invoke(source, ids, start, end) {
    calls[source].push({ ids: [...ids], start, end });
    calls.active += 1;
    calls.maximumActive = Math.max(calls.maximumActive, calls.active);
    try {
      if (state[source]) return await state[source](ids, start, end);
      return state.events.filter((item) => ids.includes(item.calendarId) &&
        (source === 'modern' ? new Date(item.startDate) < end && new Date(item.endDate) > start
          : new Date(item.startDate) >= start && new Date(item.endDate) <= end));
    } finally { calls.active -= 1; }
  }
  const timeFile = path.join(__dirname, '../src/utils/time.ts');
  const timeModule = { exports: {} };
  vm.runInNewContext(transpile(timeFile), { module: timeModule, exports: timeModule.exports, Date, Intl },
    { filename: timeFile });
  const modern = state.modernAvailable ? { listEvents: (...args) => invoke('modern', ...args) } : {};
  const legacy = {
    EntityTypes: { EVENT: 'event' },
    getCalendarsAsync: async () => state.calendars,
    getEventsAsync: (...args) => invoke('legacy', ...args),
  };
  const filename = path.join(__dirname, '../src/services/calendar.ts');
  const module = { exports: {} };
  vm.runInNewContext(transpile(filename), {
    module, exports: module.exports, Date, Intl, Map, Set, Promise, console,
    require(name) {
      if (name === 'react-native') return { Platform: { OS: state.platform } };
      if (name === 'expo-calendar') return modern;
      if (name === 'expo-calendar/legacy') return legacy;
      if (name === '../../modules/context-calendar-colors') return { getEventColorsAsync: async () => state.eventColors };
      if (name === '../data/database') return {};
      if (name === './calendar-write-routing') return { hasConfiguredAccountCalendarWriter: async () => false };
      if (name === '../sync/accounts') return { getAccounts: async () => [] };
      if (name === './categories' || name === '../sync/engine' || name === '../sync/codec') return {};
      if (name === '../theme') return { categoryById: () => ({ name: 'Activity' }) };
      if (name === '../utils/time') return timeModule.exports;
      if (name === '../utils/calendar-description') return loadUtility('calendar-description');
      if (name === '../utils/calendar-minute-log') return loadUtility('calendar-minute-log');
      if (name === '../utils/cell-format') return loadUtility('cell-format');
      if (name === '../utils/activity-translation') return loadUtility('activity-translation');
      if (name === '../utils/native-bound-retime') return loadUtility('native-bound-retime');
      if (name === '../utils/calendar-cell-color') return loadUtility('calendar-cell-color');
      if (name === '../utils/native-sync-diagnostics') return loadUtility('native-sync-diagnostics');
      if (name === '../utils/calendar-change-authority') return loadUtility('calendar-change-authority');
      throw new Error(`Unexpected calendar read test import: ${name}`);
    },
  }, { filename });
  return { api: module.exports, state, calls, calendars: state.calendars };
}

test('Android uses the modern mapper for only selected calendars, bypassing the legacy empty-RRULE fault', async () => {
  const row = event('selected', { recurrenceRule: '' });
  // Native modern events expose properties through shared-object getters.
  const shared = Object.create(Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, value])));
  const { api, calls, calendars } = calendarRuntime({ modern: async () => [shared],
    legacy: async () => { throw Object.assign(new Error('Legacy RRULE mapping failed'), { code: 'E_BAD_RECURRENCE' }); } });
  const result = await api.loadPlannedEventsResult(['selected', 'selected'], '2026-10-25', calendars);
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].title, row.title);
  assert.equal(result.plans[0].startDate.getHours(), 13);
  assert.equal(result.plans[0].startDate.getMinutes(), 19);
  assert.equal(result.failures.length, 0);
  assert.deepEqual(calls.modern[0].ids, ['selected']);
  assert.equal(calls.modern.length, 1);
  assert.equal(calls.modern[0].start.getDate(), 25);
  assert.equal(calls.modern[0].end.getDate(), 26);
  assert.equal(calls.legacy.length, 0);
  const diagnostic = api.getCalendarReadDiagnostics();
  assert.equal(diagnostic.calendars[0].source, 'readmodern');
  assert.equal(diagnostic.calendars[0].acceptedEvents, 1);
  assert.equal(diagnostic.calendars[0].timedEvents, 1);
  const encoded = JSON.stringify(diagnostic);
  for (const privateText of [row.title, row.notes, calendars[0].title]) assert.ok(!encoded.includes(privateText));
});

test('native effective event colors override calendar colors and refresh with each source read', async () => {
  const native = event();
  const { api, state, calendars } = calendarRuntime({ events: [native], eventColors: {
    [native.id]: '#123ABC', [`${native.id}@${new Date(native.startDate).getTime()}`]: '#FEDCBA',
  } });
  assert.equal((await api.loadPlannedEventsResult(['selected'], '2026-10-25', calendars)).plans[0].color, '#FEDCBA');
  state.eventColors = { [native.id]: '#654321' };
  assert.equal((await api.loadPlannedEventsResult(['selected'], '2026-10-25', calendars)).plans[0].color, '#654321');
  state.eventColors = {};
  assert.equal((await api.loadPlannedEventsResult(['selected'], '2026-10-25', calendars)).plans[0].color, calendars[0].color);
});

test('one selected calendar failing preserves another calendar plans and exposes the failure', async () => {
  const { api, calls, calendars } = calendarRuntime({ modern: async ([id]) => {
    if (id === 'failing') throw Object.assign(new Error('Private event failure text'), { code: 'E_CALENDAR_READ_FAILED' });
    return [event(id)];
  } });
  const result = await api.loadPlannedEventsResult(['selected', 'failing'], '2026-10-25', calendars);
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].calendarId, 'selected');
  assert.deepEqual(plain(result.failures), [{ calendarId: 'failing', code: 'E_CALENDAR_READ_FAILED' }]);
  assert.equal(api.getCalendarReadDiagnostics().failedCalendarCount, 1);
  assert.equal(api.getCalendarReadDiagnostics().calendars[1].status, 'failed');
  assert.equal(calls.legacy.length, 0);
  await assert.rejects(api.loadPlannedEvents(['selected', 'failing'], '2026-10-25', calendars),
    (error) => error instanceof api.CalendarReadError && error.partialPlans.length === 1 && error.failures.length === 1);
});

test('calendar reads and shared-event property extraction are serialized across concurrent visible-day requests', async () => {
  const { api, calls, calendars } = calendarRuntime({ modern: async ([id]) => {
    await new Promise((resolve) => setImmediate(resolve));
    return [event(id)];
  } });
  await Promise.all([
    api.loadPlannedEventsResult(['selected', 'second'], '2026-10-25', calendars),
    api.loadPlannedEventsResult(['third'], '2026-10-25', calendars),
  ]);
  assert.equal(calls.maximumActive, 1);
  assert.deepEqual(calls.modern.map((call) => call.ids[0]), ['selected', 'second', 'third']);
});

test('invalid native times and identities are counted visibly while valid events remain usable', async () => {
  const { api, calendars } = calendarRuntime({ modern: async () => [
    event(), event('selected', { id: 'bad-time', startDate: 'not a date' }),
    event('selected', { id: 'zero-time', endDate: new Date(2026, 9, 25, 13, 19).toISOString() }),
    event('selected', { id: null }), event('unchecked'),
    event('selected', { id: 'outside', startDate: new Date(2026, 9, 27, 13).toISOString(),
      endDate: new Date(2026, 9, 27, 14).toISOString() }),
  ] });
  const result = await api.loadPlannedEventsResult(['selected'], '2026-10-25', calendars);
  assert.equal(result.plans.length, 1);
  assert.equal(result.failures[0].code, 'ERR_INVALID_EVENT_TIMES');
  const status = api.getCalendarReadDiagnostics().calendars[0];
  assert.equal(status.status, 'invalid-events');
  assert.equal(status.queriedEvents, 6);
  assert.equal(status.acceptedEvents, 1);
  assert.equal(status.discardedInvalidTimes, 2);
  assert.equal(status.discardedInvalidIdentities, 2);
  assert.equal(status.outsideDayEvents, 1);
});

test('only an absent modern method or its specific unavailability error allows the padded legacy fallback', async () => {
  for (const overrides of [{ modernAvailable: false }, { modern: async () => {
    throw Object.assign(new Error('The method or property Calendar.listEvents is not available on android, are you sure you\'ve linked all the native dependencies properly?'),
      { code: 'ERR_UNAVAILABLE' });
  } }]) {
    const { api, calls, calendars } = calendarRuntime(overrides);
    const result = await api.loadPlannedEventsResult(['selected'], '2026-10-25', calendars);
    assert.equal(result.plans.length, 1);
    assert.equal(result.failures.length, 0);
    assert.equal(calls.legacy.length, 1);
    assert.equal(calls.legacy[0].start.getDate(), 24);
    assert.equal(calls.legacy[0].end.getDate(), 27);
    assert.equal(api.getCalendarReadDiagnostics().calendars[0].source, 'legacy');
  }
});

test('permission and provider failures never fall back to a second read or expose private error messages', async () => {
  for (const code of ['E_MISSING_PERMISSIONS', 'ERR_UNAVAILABLE', 'Private contact@example.com']) {
    const { api, calls, calendars } = calendarRuntime({ modern: async () => {
      throw Object.assign(new Error('Private provider error message'), { code });
    } });
    const result = await api.loadPlannedEventsResult(['selected'], '2026-10-25', calendars);
    assert.equal(result.plans.length, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(calls.legacy.length, 0);
    const diagnostic = api.getCalendarReadDiagnostics();
    assert.equal(diagnostic.calendars[0].status, 'failed');
    assert.ok(!JSON.stringify(diagnostic).includes('Private'));
    assert.ok(!JSON.stringify(diagnostic).includes('@'));
  }
});

test('a successful empty read is distinct from a failed query and diagnostic snapshots cannot be mutated', async () => {
  const { api, calendars } = calendarRuntime({ modern: async () => [] });
  const result = await api.checkCalendarConnection(['selected'], '2026-10-25', calendars);
  assert.equal(result.failures.length, 0);
  const diagnostic = api.getCalendarReadDiagnostics();
  assert.equal(diagnostic.dateKey, '2026-10-25');
  assert.ok(Number.isFinite(Date.parse(diagnostic.checkedAt)));
  assert.equal(diagnostic.calendars[0].status, 'ok');
  assert.equal(diagnostic.calendars[0].queriedEvents, 0);
  diagnostic.calendars[0].queriedEvents = 999;
  diagnostic.selectedCalendarIds.push('unchecked');
  assert.equal(api.getCalendarReadDiagnostics().calendars[0].queriedEvents, 0);
  assert.deepEqual(plain(api.getCalendarReadDiagnostics().selectedCalendarIds), ['selected']);
});

test('modern Android reads retain a multi-day overlapping event that legacy containment would omit', async () => {
  const { api, calendars } = calendarRuntime({ events: [event('selected', {
    startDate: new Date(2026, 9, 20, 9).toISOString(), endDate: new Date(2026, 9, 30, 17).toISOString(),
  })] });
  const result = await api.loadPlannedEventsResult(['selected'], '2026-10-25', calendars);
  assert.equal(result.plans.length, 1);
  assert.equal(result.failures.length, 0);
});

test('hidden or unsynced phone calendars remain visible as connection metadata without being autoenabled', async () => {
  const { api, calendars } = calendarRuntime({ calendars: [{ id: 'selected', title: 'Hidden calendar',
    isVisible: false, isSynced: false, color: '#2952A3', allowsModifications: true }], modern: async () => [] });
  const available = await api.listDeviceCalendars();
  assert.equal(available.length, 1);
  assert.equal(available[0].isVisible, false);
  assert.equal(available[0].isSynced, false);
  await api.loadPlannedEventsResult(['selected'], '2026-10-25', calendars);
  const status = api.getCalendarReadDiagnostics().calendars[0];
  assert.equal(status.isVisible, false);
  assert.equal(status.isSynced, false);
  assert.equal(calendars[0].isVisible, false);
});

test('iOS reads retain the legacy path and invalid calendar IDs never produce an unfiltered native query', async () => {
  const ios = calendarRuntime({ platform: 'ios' });
  const result = await ios.api.loadPlannedEventsResult(['selected'], '2026-10-25', ios.calendars);
  assert.equal(result.plans.length, 1);
  assert.equal(ios.calls.modern.length, 0);
  assert.equal(ios.calls.legacy.length, 1);
  const invalid = calendarRuntime();
  const failed = await invalid.api.loadPlannedEventsResult([''], '2026-10-25', invalid.calendars);
  assert.equal(failed.failures[0].code, 'ERR_INVALID_CALENDAR_ID');
  assert.equal(invalid.calls.modern.length, 0);
  assert.equal(invalid.calls.legacy.length, 0);
});
