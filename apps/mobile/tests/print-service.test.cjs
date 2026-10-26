const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const day = '2026-10-25';
function runtime(overrides = {}) {
  const state = { platform: 'android', appState: 'active', drafts: [], accounts: [], accountCalendars: [],
    accountSelections: ['account-calendar'], permission: 'granted', deviceCalendars: [{ id: 'calendar' }],
    permissionReads: 0, nativeLists: 0, accountLists: 0, onDayRead: null, onNativeList: null,
    deviceFailure: false, accountError: false, printError: null, calls: [], reads: [], currentReads: 0, maxReads: 0,
    readGate: null, pdfCalls: [], pdfGate: null, pdfError: null, onPdf: null,
    pdfResult: { uri: 'file:///private/cache/context-test.pdf', numberOfPages: 1 },
    sharingAvailable: true, shareCalls: [], shareError: null, dashboardCalls: [], dashboardError: null,
    accountReads: 0, deviceReads: 0, renderOptions: null, dashboardRender: null, ...overrides };
  const listeners = new Set();
  const appState = { get currentState() { return state.appState; }, addEventListener(_name, callback) {
    listeners.add(callback); return { remove() { listeners.delete(callback); } };
  } };
  const filename = path.join(__dirname, '../src/services/print.ts');
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Date, Intl, Promise, Set, Map, Error,
    require(name) {
      if (name === 'react-native') return { Platform: { OS: state.platform }, AppState: appState };
      if (name === 'expo-print') return {
        async printToFileAsync(options) {
          state.pdfCalls.push(options); if (state.onPdf) await state.onPdf(options, state);
          if (state.pdfGate) await state.pdfGate;
          if (state.pdfError) throw state.pdfError;
          return state.pdfResult;
        },
        async printAsync(options) { state.calls.push(options); if (state.printError) throw state.printError; },
      };
      if (name === 'expo-sharing') return {
        isAvailableAsync: async () => state.sharingAvailable,
        shareAsync: async (uri, options) => {
          state.shareCalls.push({ uri, options }); if (state.shareError) throw state.shareError;
        },
      };
      if (name === '../data/database') return { async getDaySegments(date) {
        state.reads.push(date); state.currentReads++; state.maxReads = Math.max(state.maxReads, state.currentReads);
        if (state.onDayRead) state.onDayRead(date, state);
        try { if (state.readGate) await state.readGate; else await new Promise((resolve) => setImmediate(resolve)); return []; }
        finally { state.currentReads--; }
      } };
      if (name === '../sync/accounts') return { getAccounts: async () => { state.accountReads++; return state.accounts; } };
      if (name === '../sync/engine') return {
        getAccountPreferences: async () => ({ selectedCalendarIds: state.accountSelections }),
        loadAccountPlans: async () => { if (state.accountError) throw new Error('Provider unavailable'); return []; },
      };
      if (name === '../sync/providers') return { createCalendarAdapter: () => ({ listCalendars: async () => {
        state.accountLists++; return state.accountCalendars;
      } }) };
      if (name === './calendar') return {
        getCalendarPermissionStatus: async () => { state.permissionReads++; return state.permission; },
        listDeviceCalendars: async () => {
          state.nativeLists++; if (state.onNativeList) await state.onNativeList(state.nativeLists, state);
          return state.deviceCalendars;
        },
        loadPlannedEventsResult: async () => { state.deviceReads++; return { plans: [],
          failures: state.deviceFailure ? [{ calendarId: 'calendar', code: 'ERR_CALENDAR_READ_FAILED' }] : [] }; },
      };
      if (name === './inline-minutes') return { inlineMinuteDrafts: { snapshot: () => state.drafts } };
      if (name === './dashboard') return { getDashboardSummary: async (dates) => {
        state.dashboardCalls.push([...dates]); if (state.dashboardError) throw state.dashboardError;
        return { dates: [...dates], recordedMinutes: 30, periodMinutes: dates.length * 1440,
          unrecordedMinutes: dates.length * 1440 - 30, categories: [] };
      } };
      if (name === '../utils/print-calendar') return {
        createPrintCalendarDocument(dates, _clockFormat, config) {
          state.renderOptions = { ...config };
          const days = new Map();
          return {
            addDay(date) { days.set(date, `<section data-date="${date}"></section>`); },
            finish() { return '<html>' + dates.map((date) => days.get(date)).join('') + '</html>'; },
          };
        },
        renderDashboardPrint(summary, clockFormat, config) {
          state.dashboardRender = { summary, clockFormat, config: { ...config } };
          return '<html>Dashboard</html>';
        },
      };
      if (name.startsWith('../utils/')) return require(path.join(__dirname, '../src/utils', name.slice('../utils/'.length) + '.ts'));
      throw new Error(`Unexpected print test import: ${name}`);
    },
  }, { filename });
  return { state, api: module.exports, background() { state.appState = 'background'; for (const listener of listeners) listener('background'); } };
}
const options = (dates = [day]) => {
  const ordered = [...dates].sort();
  return { dates, options: { startDate: ordered[0], endDate: ordered.at(-1), view: 'schedule', orientation: 'portrait',
    colorStyle: 'outline', showWeekends: true, includeStartEndTimes: true, includeDescriptions: true,
    dashboardPeriod: 'custom', percentageBasis: 'recorded', dashboardMetric: 'recorded' },
    action: 'print', calendars: [{ id: 'calendar', title: 'Personal', color: '#555555',
      allowsModifications: true, sourceName: 'Phone', isPrimary: true }],
    preferences: { selectedCalendarIds: ['calendar'], writeCalendarId: null, syncActuals: false }, clockFormat: '24h' };
};

test('printing first creates a local PDF, then opens only the system PDF dialog without selecting a printer', async () => {
  const { state, api } = runtime();
  const result = await api.printContextSchedule(options());
  assert.equal(result.status, 'opened');
  assert.equal(state.calls.length, 1);
  assert.equal(state.pdfCalls.length, 1);
  assert.deepEqual(Object.keys(state.pdfCalls[0]), ['html', 'width', 'height']);
  assert.equal(state.pdfCalls[0].width, 612); assert.equal(state.pdfCalls[0].height, 792);
  assert.deepEqual(Object.keys(state.calls[0]), ['uri', 'orientation']);
  assert.equal(state.calls[0].uri, state.pdfResult.uri); assert.equal(state.calls[0].orientation, 'portrait');
  assert.match(state.pdfCalls[0].html, /data-date="2026-10-25"/);
  assert.equal(state.shareCalls.length, 0);
});

test('calendar and account source failures prevent all printing, including partial native results', async () => {
  for (const failure of [{ deviceFailure: true }, { accountError: true },
    { accounts: [{ id: 'account', consent: { calendarRead: true } }], accountCalendars: [] }]) {
    const { state, api } = runtime(failure);
    await assert.rejects(api.printContextSchedule(options()), /could not load|unavailable/);
    assert.equal(state.calls.length, 0);
    assert.equal(state.pdfCalls.length, 0);
  }
  const { state, api } = runtime();
  await assert.rejects(api.printContextSchedule({ ...options(), calendars: [] }), /unavailable/);
  assert.equal(state.calls.length, 0);
});

test('preparation has at most two day reads in flight and prints dates in calendar order', async () => {
  const dates = Array.from({ length: 28 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`);
  const { state, api } = runtime();
  const result = await api.printContextSchedule(options([...dates].reverse()));
  assert.equal(result.dayCount, 28); assert.equal(state.maxReads, 2);
  const rendered = [...state.pdfCalls[0].html.matchAll(/data-date="([0-9-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(rendered, dates);
});

test('cancelling a pending provider read returns promptly, stops the queue and never opens Print', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { state, api } = runtime({ readGate: gate });
  const controller = new AbortController();
  const printing = api.printContextSchedule({ ...options([day, '2026-10-26', '2026-10-27']), signal: controller.signal });
  while (!state.reads.length) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  const result = await Promise.race([printing, new Promise((_, reject) => setTimeout(() => reject(new Error('Cancel did not return')), 500))]);
  assert.equal(result.status, 'cancelled'); assert.equal(state.calls.length, 0);
  const readCount = state.reads.length;
  release(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.reads.length, readCount); assert.equal(state.calls.length, 0);
});

test('backgrounding during preparation and pre-aborted requests never open a print dialog', async () => {
  const controller = new AbortController(); controller.abort();
  const first = runtime();
  assert.equal((await first.api.printContextSchedule({ ...options(), signal: controller.signal })).status, 'cancelled');
  assert.equal(first.state.reads.length, 0);
  let release;
  const second = runtime({ readGate: new Promise((resolve) => { release = resolve; }) });
  const printing = second.api.printContextSchedule(options());
  while (!second.state.reads.length) await new Promise((resolve) => setImmediate(resolve));
  second.background();
  assert.equal((await printing).status, 'cancelled');
  release(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(second.state.calls.length, 0);
});

test('unsaved drafts block printing and only the exact native iOS cancellation is quiet', async () => {
  const unsaved = runtime({ drafts: [{ revision: 2, savedRevision: 1 }] });
  await assert.rejects(unsaved.api.printContextSchedule(options()), /could not be saved/);
  assert.equal(unsaved.state.calls.length, 0);
  const ios = runtime({ platform: 'ios', printError: { code: 'ERR_PRINT_INCOMPLETE' } });
  assert.equal((await ios.api.printContextSchedule(options())).status, 'cancelled');
  const unknown = runtime({ platform: 'ios', printError: new Error('Native print failed') });
  await assert.rejects(unknown.api.printContextSchedule(options()), /Native print failed/);
});

test('disconnects, read revocation, identity swaps, preference changes and deleted account calendars block the final Print', async () => {
  for (const mutate of [
    (state) => { state.accounts = []; },
    (state) => { state.accounts[0].consent.calendarRead = false; },
    (state) => { state.accounts[0].subject = 'another-person'; },
    (state) => { state.accounts[0].provider = 'microsoft'; },
    (state) => { state.accountSelections = []; },
    (state) => { state.accountCalendars = []; },
  ]) {
    const { state, api } = runtime({ accounts: [{ id: 'account', provider: 'google', subject: 'person',
      consent: { calendarRead: true } }], accountCalendars: [{ id: 'account-calendar' }],
      onDayRead(_date, current) { mutate(current); current.onDayRead = null; } });
    await assert.rejects(api.printContextSchedule(options([day, '2026-10-26'])), /accounts changed|calendar is unavailable/);
    assert.equal(state.calls.length, 0);
  }
});

test('native permission revocation or a removed native calendar during preparation prevents Print', async () => {
  for (const mutate of [
    (state) => { state.permission = 'denied'; },
    (state) => { state.deviceCalendars = []; },
  ]) {
    const { state, api } = runtime({ onDayRead(_date, current) { mutate(current); current.onDayRead = null; } });
    await assert.rejects(api.printContextSchedule(options()), /Calendar access changed|calendar is unavailable/);
    assert.equal(state.calls.length, 0);
    assert.ok(state.permissionReads >= 3);
  }
});

test('ledger-only printing does not query native calendar permissions or calendar lists', async () => {
  const { state, api } = runtime({ permission: 'denied', deviceCalendars: [] });
  const result = await api.printContextSchedule({ ...options(), calendars: [],
    preferences: { selectedCalendarIds: [], writeCalendarId: null, syncActuals: false } });
  assert.equal(result.status, 'opened');
  assert.equal(state.permissionReads, 0); assert.equal(state.nativeLists, 0);
});

test('cancellation during the final native availability check returns without opening a delayed Print', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { state, api } = runtime({ onNativeList: async (count) => { if (count === 2) await gate; } });
  const controller = new AbortController();
  const printing = api.printContextSchedule({ ...options(), signal: controller.signal });
  while (state.nativeLists < 2) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  assert.equal((await printing).status, 'cancelled');
  release(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.calls.length, 0);
});

test('Save PDF opens the local PDF share/save chooser with the correct type and never prints automatically', async () => {
  const { state, api } = runtime();
  const request = options(); request.action = 'save'; request.options.orientation = 'landscape';
  const result = await api.printContextSchedule(request);
  assert.equal(result.status, 'opened'); assert.equal(state.pdfCalls.length, 1);
  assert.equal(state.pdfCalls[0].width, 792); assert.equal(state.pdfCalls[0].height, 612);
  assert.equal(state.shareCalls.length, 1); assert.equal(state.calls.length, 0);
  assert.equal(state.shareCalls[0].uri, state.pdfResult.uri);
  assert.equal(state.shareCalls[0].options.mimeType, 'application/pdf');
  assert.equal(state.shareCalls[0].options.UTI, 'com.adobe.pdf');
});

test('canonical print options determine the range, weekday filtering and renderer configuration', async () => {
  const { state, api } = runtime();
  const request = options(['2026-10-24', '2026-10-27']);
  request.dates = ['1990-01-01']; // A stale caller hint must not override the dates the user selected in Print options.
  Object.assign(request.options, { view: 'week', orientation: 'landscape', colorStyle: 'black-white',
    showWeekends: false, includeStartEndTimes: false, includeDescriptions: false });
  const result = await api.printContextSchedule(request);
  assert.equal(result.dayCount, 2);
  const rendered = [...state.pdfCalls[0].html.matchAll(/data-date="([0-9-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(rendered, ['2026-10-26', '2026-10-27']);
  assert.equal(state.renderOptions.colorStyle, 'black-white'); assert.equal(state.renderOptions.view, 'week');
  assert.equal(state.renderOptions.includeStartEndTimes, false); assert.equal(state.renderOptions.includeDescriptions, false);
  assert.equal(state.calls[0].orientation, 'landscape');
});

test('Dashboard PDF preparation uses only local actual metrics and forwards Recorded/Unrecorded options', async () => {
  const { state, api } = runtime({ permission: 'denied', deviceCalendars: [], accountError: true, deviceFailure: true });
  const request = options(); request.options.view = 'dashboard'; request.options.dashboardMetric = 'unrecorded';
  await api.printContextSchedule(request);
  assert.deepEqual(state.dashboardCalls, [[day]]);
  assert.equal(state.dashboardRender.config.dashboardMetric, 'unrecorded');
  assert.equal(state.dashboardRender.summary.unrecordedMinutes, 1410);
  assert.equal(state.permissionReads, 0); assert.equal(state.nativeLists, 0);
  assert.equal(state.deviceReads, 0); assert.equal(state.accountReads, 0); assert.equal(state.reads.length, 0);
  assert.equal(state.pdfCalls.length, 1); assert.equal(state.calls.length, 1);
});

test('cancellation or backgrounding while a PDF renders never opens either handoff after rendering finishes', async () => {
  for (const background of [false, true]) {
    let release;
    const { state, api, background: moveToBackground } = runtime({ pdfGate: new Promise((resolve) => { release = resolve; }) });
    const controller = new AbortController();
    const request = options(); request.action = 'save'; request.signal = controller.signal;
    const printing = api.printContextSchedule(request);
    while (!state.pdfCalls.length) await new Promise((resolve) => setImmediate(resolve));
    if (background) moveToBackground(); else controller.abort();
    assert.equal((await printing).status, 'cancelled');
    release(); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.calls.length, 0); assert.equal(state.shareCalls.length, 0);
  }
});

test('invalid PDF results, PDF failures and unavailable sharing never hand content to a printer or another app', async () => {
  for (const failure of [
    { pdfError: new Error('PDF render failed') },
    { pdfResult: { uri: 'https://example.invalid/remote.pdf', numberOfPages: 1 } },
    { pdfResult: { uri: 'file:///private/cache/not-pdf.txt', numberOfPages: 1 } },
    { pdfResult: { uri: 'file:///private/cache/file.pdf', numberOfPages: 0 } },
  ]) {
    const { state, api } = runtime(failure);
    await assert.rejects(api.printContextSchedule(options()), /PDF/);
    assert.equal(state.calls.length, 0); assert.equal(state.shareCalls.length, 0);
  }
  const unavailable = runtime({ sharingAvailable: false });
  const save = options(); save.action = 'save';
  await assert.rejects(unavailable.api.printContextSchedule(save), /unavailable/);
  assert.equal(unavailable.state.pdfCalls.length, 0); assert.equal(unavailable.state.shareCalls.length, 0);
});

test('calendar access changed during native PDF rendering is rechecked before a print dialog opens', async () => {
  const { state, api } = runtime({ onPdf(_options, current) { current.permission = 'denied'; } });
  await assert.rejects(api.printContextSchedule(options()), /Calendar access changed/);
  assert.equal(state.pdfCalls.length, 1); assert.equal(state.calls.length, 0);
});
