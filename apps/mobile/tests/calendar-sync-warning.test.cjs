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

// Reuse the established production CalendarHeader renderer, without registering
// that file's tests twice. Only its inert Alert transport gains an observer.
function header(props = {}) {
  const file = path.join(__dirname, 'calendar-header.test.cjs');
  const text = fs.readFileSync(file, 'utf8'); const prefix = text.slice(0, text.indexOf('\ntest('));
  const alertStub = 'Alert: { alert() {} }'; assert.ok(prefix.includes(alertStub));
  const module = { exports: {} }; const alerts = [];
  vm.runInNewContext(prefix.replace(alertStub, 'Alert: { alert(...args) { observedAlerts.push(args); } }') +
    '\nmodule.exports = { headerHarness };', { module, exports: module.exports, __dirname,
      require, console, observedAlerts: alerts });
  return { ...module.exports.headerHarness(props), alerts };
}
const syncButton = (h) => h.nodes().find((node) => node.type === 'Pressable' &&
  /^(?:Calendar sync needs attention|Sync attached calendars|Synchronizing calendars)/.test(node.props.accessibilityLabel ?? ''));

test('the production Sync control shows one quiet exclamation badge and one tap performs a retry', () => {
  const props = { syncError: 'Phone-calendar events could not refresh.' }; const h = header(props);
  const button = syncButton(h); assert.ok(button);
  assert.equal(button.props.accessibilityLabel, 'Calendar sync needs attention. Tap to retry');
  assert.equal(button.props.accessibilityHint, 'Touch and hold for sync details');
  const badge = h.nodes(button).filter((node) => node.type === 'Text' && node.props.children === '!');
  assert.equal(badge.length, 1); assert.equal(badge[0].props.accessible, false);
  assert.equal(badge[0].props.importantForAccessibility, 'no');
  h.press(button); assert.equal(h.calls.sync, 1); assert.deepEqual(h.alerts, []);
  props.syncError = null; h.render();
  assert.equal(syncButton(h).props.accessibilityLabel, 'Sync attached calendars');
  assert.equal(h.nodes(syncButton(h)).some((node) => node.props.children === '!'), false);
});

test('physical and accessible long presses show details without also synchronizing', () => {
  const message = 'Account-calendar access needs a retry.'; const h = header({ syncError: message });
  const button = syncButton(h);
  button.props.onPressIn(); button.props.onLongPress(); button.props.onPress();
  assert.equal(h.calls.sync, 0); assert.deepEqual(JSON.parse(JSON.stringify(h.alerts)), [['Calendar synchronization', message]]);
  assert.deepEqual(JSON.parse(JSON.stringify(button.props.accessibilityActions)), [{ name: 'longpress', label: 'Show sync details' }]);
  button.props.onAccessibilityAction({ nativeEvent: { actionName: 'longpress' } });
  assert.equal(h.calls.sync, 0); assert.equal(h.alerts.length, 2);
  h.press(button); assert.equal(h.calls.sync, 1, 'the next ordinary tap must not inherit the completed long press');
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
