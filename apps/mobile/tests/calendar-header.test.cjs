const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const mobile = path.resolve(__dirname, '..');
const appText = fs.readFileSync(path.join(mobile, 'App.tsx'), 'utf8');
const appSource = ts.createSourceFile('App.tsx', appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  const node = appSource.statements.find((node) => node.name?.text === name ||
    node.declarationList?.declarations.some((value) => value.name?.text === name));
  assert.ok(node, `Missing actual App declaration ${name}`); return node.getText(appSource);
}
const transpile = (source) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
function headerHarness(props = {}) {
  let clock = 1000; let nextTimer = 0; const timers = new Map();
  const fixed = new Date(2026, 9, 26, 13, 11, 0);
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [fixed.getTime() + clock])); } static now() { return clock; } }
  const setTimer = (callback, delay) => { const id = ++nextTimer; timers.set(id, { at: clock + delay, callback }); return id; };
  const clearTimer = (id) => timers.delete(id);
  const advance = (duration) => {
    clock += duration;
    while (true) {
      const due = [...timers].find(([, timer]) => timer.at <= clock);
      if (!due) break; timers.delete(due[0]); due[1].callback();
    }
  };
  const binderModule = { exports: {} };
  vm.runInNewContext(transpile(fs.readFileSync(path.join(mobile, 'src/utils/calendar-binder-press.ts'), 'utf8')),
    { module: binderModule, exports: binderModule.exports, Date: ClockDate, setTimeout: setTimer, clearTimeout: clearTimer });
  const slots = []; let cursor = 0; let pendingEffects = []; const cleanups = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => value === b[index]);
  const listeners = new Set(); const state = { currentState: 'active', addEventListener: (_name, callback) => { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } };
  const dimensions = { width: 360, height: 500 };
  const calls = { now: 0, picker: 0, dashboard: 0, print: 0, search: 0, settings: 0, sync: 0, modes: [] };
  const history = { canUndo: true, canRedo: true, busy: false };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const module = { exports: {} };
  const context = { module, exports: module.exports, Date: ClockDate, Intl, Math,
    useRef: (value) => { const index = cursor++; return slots[index] ??= { current: value }; },
    useState: (initial) => { const index = cursor++; slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (next) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useMemo: (work, deps) => { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: work(), deps }; return slots[index].value; },
    useEffect: (work, deps) => { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) {
      slots[index] = { deps }; pendingEffects.push(() => { const cleanup = work(); if (cleanup) cleanups.push(cleanup); }); } },
    useAppTheme: () => ({ colors: { paper: '#FFFFFF', graphite: '#333333', muted: '#777777' } }),
    useWindowDimensions: () => dimensions,
    createCalendarBinderPress: binderModule.exports.createCalendarBinderPress,
    spreadsheetEditor: { snapshot: () => history, subscribe: () => () => {} }, flushInlineMinutes: async () => {},
    undoSpreadsheetEdit: async () => {}, redoSpreadsheetEdit: async () => {},
    Keyboard: { dismiss() {} }, Alert: { alert() {} }, AppState: state, Platform: { OS: 'android' },
    StyleSheet: { create: (value) => value, absoluteFill: {}, hairlineWidth: 0.5 },
    ScrollView: 'ScrollView', View: 'View', Text: 'Text', Pressable: 'Pressable', Modal: 'Modal',
    ActivityIndicator: 'ActivityIndicator', CalendarViewIcon: 'CalendarViewIcon', CalendarHeaderIcon: 'CalendarHeaderIcon',
    setTimeout: setTimer, clearTimeout: clearTimer, requestAnimationFrame: (callback) => setTimer(callback, 0), cancelAnimationFrame: clearTimer,
    require: (name) => { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx, Fragment: 'Fragment' }; },
  };
  vm.runInNewContext(transpile([declaration('CALENDAR_VIEW_OPTIONS'), declaration('createStyles'), declaration('CalendarHeader'), 'export { CalendarHeader };'].join('\n')), context);
  const defaults = { onOpenSettings: () => calls.settings++, onPrint: () => calls.print++, onOpenSearch: () => calls.search++,
    onOpenReports: () => calls.dashboard++, onSync: () => calls.sync++, syncing: false, syncError: null,
    onJumpToNow: () => calls.now++, onOpenDatePicker: () => calls.picker++, canGoPrevious: true, canGoNext: true,
    onPrevious() {}, onNext() {}, viewMode: 'day', viewChanging: false, onViewModeChange: async (mode) => { calls.modes.push(mode); } };
  let tree;
  function nodes(node = tree, into = []) {
    if (!node || typeof node !== 'object') return into;
    into.push(node); for (const child of [node.props?.children].flat(Infinity)) if (child != null) nodes(child, into); return into;
  }
  function render() {
    cursor = 0; pendingEffects = []; tree = module.exports.CalendarHeader({ ...defaults, ...props });
    for (const node of nodes()) if (node.props.ref) node.props.ref.current = { measureInWindow: (done) => done(100, 40, 44, 44) };
    for (const effect of pendingEffects) effect(); return tree;
  }
  const press = (button) => { button.props.onPressIn?.({ nativeEvent: { touches: [{}] } }); button.props.onPress(); };
  render();
  return { calls, advance, render, nodes, press, binder: () => nodes().find((node) => /^.* view\. Go to /.test(node.props.accessibilityLabel ?? '')),
    changeHeight: (height) => { dimensions.height = height; render(); },
    background: () => { state.currentState = 'background'; for (const listener of listeners) listener('background'); },
    unmount: () => { for (const cleanup of cleanups) cleanup(); },
  };
}

test('actual header single tap waits for double tap, which opens view choices without also jumping to Now', () => {
  const h = headerHarness({ viewMode: 'week' });
  assert.equal(h.binder().props.children.props.mode, 'week');
  h.press(h.binder()); h.advance(299); assert.equal(h.calls.now, 0); h.advance(1); assert.equal(h.calls.now, 1);
  h.press(h.binder()); h.advance(100); h.press(h.binder()); h.advance(400); h.render();
  assert.equal(h.calls.now, 1);
  const menu = h.nodes().find((node) => node.type === 'Modal' && node.props.visible);
  assert.ok(menu);
  assert.deepEqual(h.nodes(menu).filter((node) => node.type === 'Pressable' && / view$/.test(node.props.accessibilityLabel ?? ''))
    .map((node) => node.props.accessibilityLabel), ['Day view', 'Week view', 'Month view', 'Year view', 'Schedule view']);
  h.nodes(menu).find((node) => node.props.accessibilityLabel === 'Month view').props.onPress();
  assert.deepEqual(h.calls.modes, ['month']); h.advance(400); assert.equal(h.calls.now, 1);
});

test('actual header long press and lifecycle cancellation never run a delayed Now action', () => {
  const h = headerHarness(); h.press(h.binder()); h.advance(100);
  const binder = h.binder(); binder.props.onPressIn({ nativeEvent: { touches: [{}] } });
  h.advance(450); binder.props.onLongPress(); binder.props.onLongPress(); binder.props.onPress(); h.advance(500);
  assert.equal(h.calls.picker, 1); assert.equal(h.calls.now, 0);
  h.press(h.binder()); h.background(); h.advance(400); assert.equal(h.calls.now, 0);
  const active = headerHarness(); active.press(active.binder()); active.unmount(); active.advance(400); assert.equal(active.calls.now, 0);
});

test('a second down before the threshold can release after it and still opens only the view menu', () => {
  const h = headerHarness(); h.press(h.binder()); h.advance(250);
  const binder = h.binder(); binder.props.onPressIn({ nativeEvent: { touches: [{}] } });
  h.advance(200); assert.equal(h.calls.now, 0, 'second down pauses the pending single action');
  binder.props.onPress(); h.advance(400); h.render();
  assert.equal(h.calls.now, 0); assert.ok(h.nodes().some((node) => node.type === 'Modal' && node.props.visible));
});

test('a paused second touch released outside cannot fire an old Now on a later tap', () => {
  const h = headerHarness(); h.press(h.binder()); h.advance(100);
  const binder = h.binder(); binder.props.onPressIn({ nativeEvent: { touches: [{}] } });
  h.advance(250); binder.props.onTouchEnd(); h.advance(0); h.advance(600);
  assert.equal(h.calls.now, 0);
  binder.props.onPressIn({ nativeEvent: { touches: [{}] } }); assert.equal(h.calls.now, 0);
  binder.props.onTouchEnd(); binder.props.onPress(); h.advance(300); assert.equal(h.calls.now, 1);
  binder.props.onAccessibilityAction({ nativeEvent: { actionName: 'longpress' } });
  binder.props.onAccessibilityAction({ nativeEvent: { actionName: 'longpress' } });
  assert.equal(h.calls.picker, 2, 'semantic date actions have no physical release and must remain repeatable');
});

test('touching another header control immediately cancels pending Now before its eventual release', () => {
  const h = headerHarness(); h.press(h.binder()); h.advance(100);
  const sync = h.nodes().find((node) => node.props.accessibilityLabel === 'Sync attached calendars');
  sync.props.onPressIn(); h.advance(400); assert.equal(h.calls.now, 0);
  sync.props.onPress(); assert.equal(h.calls.sync, 1);
});

test('actual hamburger menu orders Dashboard, Print, Search, Settings and dispatches after dismissal', () => {
  const h = headerHarness(); h.nodes().find((node) => node.props.accessibilityLabel === 'Open menu').props.onPress(); h.render();
  const menu = h.nodes().find((node) => node.type === 'Modal' && node.props.visible);
  const options = h.nodes(menu).filter((node) => node.type === 'Pressable' && /^(?:Open Dashboard|Print displayed dates|Open Search|Open Settings)$/.test(node.props.accessibilityLabel ?? ''));
  assert.deepEqual(options.map((node) => node.props.accessibilityLabel), ['Open Dashboard', 'Print displayed dates', 'Open Search', 'Open Settings']);
  h.changeHeight(800);
  assert.ok(h.nodes().some((node) => node.type === 'Modal' && node.props.visible), 'keyboard dismissal must not close the newly requested menu');
  options[0].props.onPress(); assert.equal(h.calls.dashboard, 0); h.advance(0); assert.equal(h.calls.dashboard, 1);
  assert.equal(h.nodes().filter((node) => node.props.accessibilityLabel === 'Choose calendar view').length, 0, 'there is no separate triangle control');
  for (const scroll of h.nodes().filter((node) => node.type === 'ScrollView')) {
    assert.equal(scroll.props.keyboardShouldPersistTaps, 'always');
    assert.equal(scroll.props.keyboardDismissMode, 'none');
  }
});

test('actual binder cancellation rejects a cancelled/multitouch release and accessible view action opens choices directly', () => {
  const h = headerHarness({ viewMode: 'schedule' }); const binder = h.binder();
  binder.props.onPressIn({ nativeEvent: { touches: [{}] } });
  binder.props.onTouchStart({ nativeEvent: { touches: [{}, {}] } }); binder.props.onPress(); h.advance(400);
  assert.equal(h.calls.now, 0);
  binder.props.onAccessibilityAction({ nativeEvent: { actionName: 'showViews' } }); h.render();
  assert.ok(h.nodes().some((node) => node.type === 'Modal' && node.props.visible));
  assert.equal(h.calls.now, 0);
});

test('actual App Now callback preserves Day/Week/Month/Year/Schedule and zoom while issuing a fresh present focus', async () => {
  const fn = appSource.statements.find((node) => node.name?.text === 'AppController');
  const jump = fn.body.statements.find((node) => node.name?.text === 'jumpToCurrentMinute');
  assert.ok(jump);
  for (const mode of ['day', 'three-days', 'week', 'month', 'year', 'schedule']) {
    const values = {}; const fixed = new Date(2026, 9, 26, 13, 11);
    class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [fixed.getTime()])); } }
    const module = { exports: {} };
    vm.runInNewContext(transpile(jump.getText(appSource) + '\nexport { jumpToCurrentMinute };'), {
      module, exports: module.exports, Date: FixedDate, viewMode: mode, focusSequence: { current: 40 }, viewWrites: { current: Promise.resolve() },
      transitionFromCalendar: async (change) => change(), dateKey: () => '2026-10-26', minuteIndexForDate: () => 791,
      setActiveDate: (value) => { values.date = value; }, setSelectedDateKeys: (value) => { values.selected = value; },
      setOverviewMonth: (value) => { values.month = value; }, setFocusRequest: (value) => { values.focus = value; },
      setCalendarViewResetToken: () => {}, setTab: (value) => { values.tab = value; }, setSetting: async () => {},
      changeDayCount: () => assert.fail('Now must not replace the selected view'), changeCalendarZoom: () => assert.fail('Now must preserve pinch zoom'),
    });
    await module.exports.jumpToCurrentMinute();
    assert.equal(values.date, '2026-10-26'); assert.equal(values.selected, null); assert.equal(values.tab, 'today');
    assert.equal(values.focus.minuteIndex, 791); assert.equal(values.focus.token, 41); assert.equal(values.focus.openEditor, false);
    assert.equal(values.month, mode === 'month' || mode === 'schedule' ? '2026-10-01' : null);
  }
});
