const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const mobile = path.resolve(__dirname, '..');
const transpile = (source) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;

// Reuse the production Settings Sync renderer, without registering
// that file's tests twice. Only its inert Alert transport gains an observer.
function settingsSync(props = {}) {
  const file = path.join(__dirname, 'calendar-header.test.cjs');
  const text = fs.readFileSync(file, 'utf8'); const prefix = text.slice(0, text.indexOf('\ntest('));
  const alertStub = 'Alert: { alert: (...args) => calls.errors.push(args) }'; assert.ok(prefix.includes(alertStub));
  const module = { exports: {} }; const alerts = [];
  vm.runInNewContext(prefix.replace(alertStub, 'Alert: { alert(...args) { calls.errors.push(args); observedAlerts.push(args); } }') +
    '\nmodule.exports = { headerHarness };', { module, exports: module.exports, __dirname,
      require, console, observedAlerts: alerts });
  return { ...module.exports.headerHarness(props, {}, true), alerts };
}
const syncButton = (h) => h.nodes().find((node) => node.type === 'Pressable' &&
  /^(?:Calendar sync needs attention|Sync attached calendars|Synchronizing calendars)/.test(node.props.accessibilityLabel ?? ''));
const syncIcon = (h) => h.nodes(syncButton(h)).find((node) => node.type === 'CalendarHeaderIcon');

function inlineWarning(overrides = {}) {
  const file = path.join(mobile, 'src/screens/TodayScreen.tsx');
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = source.statements.find((node) => node.name?.text === 'TodayScreen');
  const warning = screen.body.statements.flatMap((node) => node.declarationList?.declarations ?? [])
    .find((node) => node.name?.text === 'calendarSyncWarning');
  assert.ok(warning);
  return vm.runInNewContext(warning.initializer.getText(source), { inlineLinkWarning: true, inlineLinkRunning: false,
    accountWarning: null, projectionWarning: null, calendarReadWarning: null, ...overrides });
}

test('active inline-link retry stays progress while a settled retry need shows the Sync warning', () => {
  const pending = inlineWarning({ inlineLinkRunning: true });
  assert.equal(pending, null);
  const active = settingsSync({ syncing: true, syncError: pending, syncDetails: () => 'Synchronizing calendar activities.' });
  assert.equal(syncIcon(active).props.issue, false); assert.equal(syncIcon(active).props.active, true);
  syncButton(active).props.onPressIn(); syncButton(active).props.onLongPress();
  assert.match(active.alerts[0][1], /Synchronizing calendar activities/);
  const retry = inlineWarning();
  assert.match(retry, /saved on this phone.*needs a retry/);
  const settled = settingsSync({ syncing: false, syncError: retry });
  assert.equal(syncIcon(settled).props.issue, true); assert.equal(syncIcon(settled).props.active, false);
});

test('actual read or projection failures remain visible while other inline-link work is running', () => {
  for (const warning of ['accountWarning', 'projectionWarning', 'calendarReadWarning']) {
    const message = `${warning} actual failure`;
    const error = inlineWarning({ inlineLinkRunning: true, [warning]: message });
    assert.equal(error, message);
    const active = settingsSync({ syncing: true, syncError: error });
    assert.equal(syncIcon(active).props.issue, true); assert.equal(syncIcon(active).props.active, false);
    assert.equal(syncButton(active).props.accessibilityState.busy, true);
  }
  const file = path.join(mobile, 'App.tsx');
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const helpers = source.statements.filter((node) => ['accountSyncContinues', 'accountSyncFailure'].includes(node.name?.text));
  const context = {};
  vm.runInNewContext(transpile(helpers.map((node) => node.getText(source)).join('\n')), context);
  assert.equal(context.accountSyncFailure({ running: true, outcome: 'error', conflicts: 0, message: 'Provider rejected the request' }),
    'Provider rejected the request');
  assert.match(context.accountSyncFailure({ running: true, outcome: 'running', conflicts: 1 }), /Review calendar conflicts/);
});

test('the production Sync control requests the internal issue mark without an outer badge and one tap retries', () => {
  const props = { syncError: 'Phone-calendar events could not refresh.' }; const h = settingsSync(props);
  const button = syncButton(h); assert.ok(button);
  assert.equal(button.props.accessibilityLabel, 'Calendar sync needs attention. Tap to retry');
  assert.equal(button.props.accessibilityHint, 'Touch and hold for sync details');
  const badge = h.nodes(button).filter((node) => node.type === 'Text' && node.props.children === '!');
  assert.equal(badge.length, 0); assert.equal(syncIcon(h).props.issue, true); assert.equal(syncIcon(h).props.active, false);
  h.press(button); assert.equal(h.calls.sync, 1); assert.deepEqual(h.alerts, []);
  props.syncError = null; h.render();
  assert.equal(syncButton(h).props.accessibilityLabel, 'Sync attached calendars');
  assert.equal(syncIcon(h).props.issue, false); assert.equal(syncIcon(h).props.active, false);
});

test('physical and accessible long presses show details without also synchronizing', () => {
  const message = 'Account-calendar access needs a retry.'; const h = settingsSync({ syncError: message });
  const button = syncButton(h);
  button.props.onPressIn(); button.props.onLongPress(); button.props.onPress();
  assert.equal(h.calls.sync, 0); assert.deepEqual(JSON.parse(JSON.stringify(h.alerts)), [['Calendar synchronization', message]]);
  assert.deepEqual(JSON.parse(JSON.stringify(button.props.accessibilityActions)), [{ name: 'longpress', label: 'Show sync details' }]);
  button.props.onAccessibilityAction({ nativeEvent: { actionName: 'longpress' } });
  assert.equal(h.calls.sync, 0); assert.equal(h.alerts.length, 2);
  h.press(button); assert.equal(h.calls.sync, 1, 'the next ordinary tap must not inherit the completed long press');
});

test('Copy timings uses only the separate safe payload while private Sync errors stay inside the popup', async () => {
  const timing = 'Account synchronization elapsed: 111.0 s.\nCalendar API event read: 86 calls, 90.0 s.';
  const h = settingsSync({ syncing: true, syncError: 'Private event title, person@example.test',
    syncDetails: () => 'Private account status', syncTimingDetails: () => timing });
  const button = syncButton(h); button.props.onPressIn(); button.props.onLongPress();
  const [, message, buttons] = h.alerts[0];
  assert.match(message, /Private event title/);
  assert.ok(buttons.some((item) => item.text === 'OK'));
  await buttons.find((item) => item.text === 'Copy timings').onPress(); await Promise.resolve();
  assert.equal(h.calls.copies.length, 1); assert.equal(h.calls.copies[0], timing); assert.equal(h.calls.sync, 0);
  assert.equal(/Private|example.test/.test(h.calls.copies[0]), false);
});

test('old-view warning callbacks and unmount cleanup cannot erase the active view warning', () => {
  const file = path.join(mobile, 'App.tsx'); const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const controller = source.statements.find((node) => node.name?.text === 'AppController');
  const declaration = controller.body.statements.flatMap((node) => node.declarationList?.declarations ?? [])
    .find((node) => node.name?.text === 'reportCalendarSyncWarning');
  assert.ok(declaration);
  const callback = declaration.initializer.arguments[0].getText(source);
  const scopeRef = { current: 'day:2026-10-27' }; let warning = null;
  function reporter(scope) {
    const module = { exports: {} };
    vm.runInNewContext(transpile(`module.exports = (${callback});`), { module,
      syncWarningScope: scope, syncWarningScopeRef: scopeRef,
      setCalendarLoadWarning: (change) => { warning = change(warning); } });
    return module.exports;
  }
  const old = reporter(scopeRef.current); old('Day source failed');
  assert.equal(warning.message, 'Day source failed');
  scopeRef.current = 'week:2026-10-28'; const current = reporter(scopeRef.current);
  current('Current week source failed'); const active = warning;
  old(null); old('Late day response'); assert.equal(warning, active);
  current('Current week source failed'); assert.equal(warning, active, 'identical warning does not trigger redundant state');
  current(null); assert.equal(warning.scope, 'week:2026-10-28'); assert.equal(warning.message, null);
});

test('the Settings Sync status still reports the last matching calendar view warning', () => {
  const file = path.join(mobile, 'App.tsx');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const controller = source.statements.find((node) => node.name?.text === 'AppController');
  const values = controller.body.statements.flatMap((node) => node.declarationList?.declarations ?? [])
    .filter((node) => ['calendarWarningScope', 'calendarSyncError'].includes(node.name?.text));
  assert.equal(values.length, 2);
  const declaration = transpile(values.map((node) => 'const ' + node.getText(source) + ';').join('\n') + '\ncalendarSyncError;');
  const current = { tab: 'settings', viewKind: 'week', activeDate: '2026-10-28', selectedDateKeys: null,
    manualSyncError: null, accountSyncStatus: {}, accountSyncFailure: () => null,
    calendarLoadWarning: { scope: JSON.stringify(['today', 'week', '2026-10-28', null]), message: 'Calendar source needs review' } };
  assert.equal(vm.runInNewContext(declaration, current), 'Calendar source needs review');
  assert.equal(vm.runInNewContext(declaration, { ...current, activeDate: '2026-11-04' }), null);
});
