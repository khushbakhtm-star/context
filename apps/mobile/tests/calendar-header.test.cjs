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
function headerHarness(props = {}, options = {}) {
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
  const swipeModule = { exports: {} };
  vm.runInNewContext(transpile(fs.readFileSync(path.join(mobile, 'src/utils/calendar-period-swipe.ts'), 'utf8')),
    { module: swipeModule, exports: swipeModule.exports });
  const slots = []; let cursor = 0; let pendingEffects = []; const cleanups = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => value === b[index]);
  const listeners = new Set(); const state = { currentState: 'active', addEventListener: (_name, callback) => { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } };
  const dimensions = { width: 360, height: 500 };
  const calls = { now: 0, picker: 0, dashboard: 0, print: 0, search: 0, globalSearch: 0, settings: 0, checklist: 0, notepad: 0, calendar: 0, sync: 0, undo: 0, redo: 0, modes: [], errors: [], copies: [] };
  const history = { canUndo: true, canRedo: true, busy: false, ...options.history };
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
    createCalendarPeriodSwipe: swipeModule.exports.createCalendarPeriodSwipe,
    PanResponder: { create: (panHandlers) => ({ panHandlers }) },
    Animated: { View: 'AnimatedView', Value: class {
      constructor(value) { this.value = value; }
      setValue(value) { this.value = value; }
    } },
    spreadsheetEditor: { snapshot: () => history, subscribe: () => () => {} }, flushInlineMinutes: options.flush ?? (async () => {}),
    inlineMinuteDrafts: { snapshot: () => options.drafts ?? [] },
    undoSpreadsheetEdit: async () => { calls.undo++; }, redoSpreadsheetEdit: async () => { calls.redo++; },
    Keyboard: { dismiss() {} }, Alert: { alert: (...args) => calls.errors.push(args) }, AppState: state, Platform: { OS: options.os ?? 'android' },
    Clipboard: { setStringAsync: async (value) => { calls.copies.push(value); } },
    StyleSheet: { create: (value) => value, absoluteFill: {}, hairlineWidth: 0.5 },
    ScrollView: 'ScrollView', View: 'View', Text: 'Text', Pressable: 'Pressable', Modal: 'Modal',
    ActivityIndicator: 'ActivityIndicator', CalendarViewIcon: 'CalendarViewIcon', CalendarHeaderIcon: 'CalendarHeaderIcon',
    setTimeout: setTimer, clearTimeout: clearTimer, requestAnimationFrame: (callback) => setTimer(callback, 0), cancelAnimationFrame: clearTimer,
    require: (name) => { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx, Fragment: 'Fragment' }; },
  };
  vm.runInNewContext(transpile([declaration('CALENDAR_VIEW_OPTIONS'), declaration('createStyles'), declaration('CalendarHeader'), 'export { CalendarHeader };'].join('\n')), context);
  const defaults = { onOpenSettings: () => calls.settings++, onPrint: () => calls.print++, onOpenSearch: () => calls.search++,
    onOpenGlobalSearch: () => calls.globalSearch++,
    onOpenReports: () => calls.dashboard++, onOpenChecklist: () => calls.checklist++,
    onOpenNotepad: () => calls.notepad++,
    onReturnToCalendar: () => calls.calendar++, onSync: () => calls.sync++, syncing: false, syncError: null,
    onJumpToNow: () => calls.now++, onOpenDatePicker: () => calls.picker++, canGoPrevious: true, canGoNext: true,
    onPrevious() {}, onNext() {}, viewMode: 'day', hasSelectedDates: false,
    viewChanging: false, onViewModeChange: async (mode) => { calls.modes.push(mode); } };
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
  const hold = (button) => { button.props.onPressIn?.({ nativeEvent: { touches: [{}] } }); advance(450);
    button.props.onLongPress(); button.props.onPress(); };
  const binder = () => nodes().find((node) => /^.* view\. (Go to (now|top)|Focus editor)/.test(node.props.accessibilityLabel ?? ''));
  return { calls, history, advance, render, nodes, press, hold, binder,
    centerIcon: () => nodes(binder()).find((node) => node.type === 'CalendarViewIcon' || node.type === 'CalendarHeaderIcon'),
    dots: () => nodes(binder()).filter((node) => /^(calendar|priority|notepad)-view-dot$/.test(node.props.testID ?? ''))
      .map((node) => Boolean(node.props.style[1]?.backgroundColor)),
    swipeHandlers: () => nodes().find((node) => node.props.onPanResponderRelease).props,
    async settle() { for (let i = 0; i < 25; i++) await Promise.resolve(); render(); },
    changeHeight: (height) => { dimensions.height = height; render(); },
    background: () => { state.currentState = 'background'; for (const listener of listeners) listener('background'); },
    unmount: () => { for (const cleanup of cleanups) cleanup(); },
  };
}

test('one released view-icon tap goes immediately to Now in every current view without opening choices', async () => {
  for (const viewMode of ['day', 'week', 'month', 'year', 'schedule']) {
    const h = headerHarness({ viewMode }); assert.equal(h.centerIcon().props.mode, viewMode);
    h.press(h.binder()); assert.equal(h.calls.now, 1, 'Now does not wait for a second-tap timer');
    h.advance(600); await h.settle();
    assert.equal(h.nodes().some((node) => node.type === 'Modal' && node.props.visible), false);
  }
});

function swipeEvent(x, y = 0, fingers = 1) {
  const contact = { pageX: 110 + x, pageY: 35 + y };
  return { nativeEvent: { touches: Array.from({ length: fingers }, () => contact), changedTouches: [contact] } };
}

function beginBinderSwipe(h) {
  const swipe = h.swipeHandlers();
  assert.equal(swipe.onStartShouldSetPanResponderCapture(swipeEvent(0)), false);
  h.binder().props.onPressIn(swipeEvent(0));
  return swipe;
}

test('the view switch keeps one complete icon and changes views once on release', () => {
  for (const direction of [-1, 1]) {
    const h = headerHarness({ viewMode: 'week' });
    assert.equal(h.centerIcon().props.mode, 'week');
    assert.deepEqual(h.dots(), [true, false, false]);
    const swipe = beginBinderSwipe(h);
    assert.equal(swipe.onMoveShouldSetPanResponderCapture(swipeEvent(12 * direction)), true);
    swipe.onPanResponderGrant(swipeEvent(12 * direction));
    swipe.onPanResponderMove(swipeEvent(20 * direction));
    assert.equal(h.nodes(h.binder()).filter((node) => node.type === 'CalendarViewIcon' || node.type === 'CalendarHeaderIcon').length, 1);
    assert.deepEqual(h.dots(), [true, false, false]);
    assert.equal(h.calls.checklist, 0);
    swipe.onPanResponderRelease(swipeEvent(29 * direction, 2, 0));
    swipe.onPanResponderRelease(swipeEvent(29 * direction, 2, 0));
    h.binder().props.onPress();
    assert.equal(h.calls.checklist, direction === -1 ? 1 : 0);
    assert.equal(h.calls.notepad, direction === 1 ? 1 : 0);
    assert.equal(h.calls.now, 0);
  }
});

test('Priority swipes back to Pick / Range without selecting a new calendar mode', () => {
  const priority = { listId: 'family', busy: false, canUndo: false, canRedo: false };
  const h = headerHarness({ viewMode: 'day', hasSelectedDates: true, priority });
  const swipe = beginBinderSwipe(h);
  assert.equal(h.centerIcon().props.name, 'checklist');
  assert.deepEqual(h.dots(), [false, true, false]);
  assert.equal(h.binder().props.accessibilityActions.find((action) => action.name === 'previousView').label,
    'Switch to Pick / Range view');
  assert.equal(swipe.onMoveShouldSetPanResponderCapture(swipeEvent(15)), true);
  swipe.onPanResponderGrant(swipeEvent(15));
  swipe.onPanResponderRelease(swipeEvent(30, 0, 0));
  assert.equal(h.calls.calendar, 1);
  assert.deepEqual(h.calls.modes, []);
  h.binder().props.onAccessibilityAction({ nativeEvent: { actionName: 'previousView' } });
  assert.equal(h.calls.calendar, 2);
});

test('Notepad owns the third dot and its swipe targets wrap around the view order', () => {
  const h = headerHarness({ notepad: true });
  assert.equal(h.centerIcon().props.name, 'notepad');
  assert.deepEqual(h.dots(), [false, false, true]);
  h.press(h.binder());
  assert.equal(h.calls.now, 1, 'a tap uses the Notepad editor focus callback');
  h.binder().props.onAccessibilityAction({ nativeEvent: { actionName: 'switchView' } });
  h.binder().props.onAccessibilityAction({ nativeEvent: { actionName: 'previousView' } });
  assert.equal(h.calls.calendar, 1);
  assert.equal(h.calls.checklist, 1);
});

test('short, vertical, interrupted and multi-finger icon gestures do not change view or jump to Now', () => {
  for (const cancel of ['short', 'vertical', 'multitouch', 'background', 'terminate']) {
    const h = headerHarness();
    const swipe = beginBinderSwipe(h);
    if (cancel === 'vertical') {
      assert.equal(swipe.onMoveShouldSetPanResponderCapture(swipeEvent(4, 30)), false);
      assert.equal(swipe.onMoveShouldSetPanResponderCapture(swipeEvent(32)), false);
    } else {
      assert.equal(swipe.onMoveShouldSetPanResponderCapture(swipeEvent(14)), true);
      swipe.onPanResponderGrant(swipeEvent(14));
      if (cancel === 'multitouch') swipe.onPanResponderStart(swipeEvent(14, 0, 2));
      if (cancel === 'background') h.background();
      if (cancel === 'terminate') swipe.onPanResponderTerminate();
      swipe.onPanResponderRelease(swipeEvent(cancel === 'short' ? 18 : 35, 0, 0));
    }
    h.binder().props.onPress();
    assert.equal(h.calls.checklist, 0, cancel);
    assert.equal(h.calls.notepad, 0, cancel);
    assert.equal(h.calls.now, 0, cancel);
  }
});

test('holding the current-view icon opens choices after saving and consumes its release', async () => {
  const h = headerHarness({ viewMode: 'week' }); h.hold(h.binder()); await h.settle();
  const menu = h.nodes().find((node) => node.type === 'Modal' && node.props.visible); assert.ok(menu);
  assert.deepEqual(h.nodes(menu).filter((node) => node.type === 'Pressable' && / view$/.test(node.props.accessibilityLabel ?? ''))
    .map((node) => node.props.accessibilityLabel), ['Day view', 'Week view', 'Month view', 'Year view', 'Schedule view', 'Priority view', 'Notepad view']);
  h.nodes(menu).find((node) => node.props.accessibilityLabel === 'Month view').props.onPress();
  assert.deepEqual(h.calls.modes, ['month']); assert.equal(h.calls.now, 0);
});

test('the view chooser opens Notepad once after the menu closes', async () => {
  const h = headerHarness();
  h.hold(h.binder());
  await h.settle();
  const button = h.nodes().find((node) => node.props.accessibilityLabel === 'Notepad view');
  button.props.onPress();
  button.props.onPress();
  h.advance(0);
  await h.settle();
  assert.equal(h.calls.notepad, 1);
  assert.equal(h.calls.calendar, 0);
});

test('checklist view dispatches once after the view picker closes and retains calendar focus', async () => {
  const h = headerHarness(); h.hold(h.binder()); await h.settle();
  const button = h.nodes().find((node) => node.props?.accessibilityLabel === 'Priority view');
  assert.ok(button); button.props.onPress(); button.props.onPress(); h.advance(0); await h.settle();
  assert.equal(h.calls.checklist, 1); assert.equal(h.calls.now, 0); assert.equal(h.calls.picker, 0);
  assert.deepEqual(h.calls.modes, []);
  assert.equal(h.nodes().some((node) => node.type === 'Modal' && node.props.visible), false);
});

test('lifecycle cancellation consumes an unfinished view-icon touch and cannot open choices or dates later', async () => {
  const h = headerHarness();
  const binder = h.binder(); binder.props.onPressIn({ nativeEvent: { touches: [{}] } });
  h.background(); h.advance(450); binder.props.onLongPress(); binder.props.onPress(); await h.settle();
  assert.equal(h.calls.picker, 0); assert.equal(h.calls.now, 0);
  assert.equal(h.nodes().some((node) => node.type === 'Modal' && node.props.visible), false);
  const active = headerHarness(); const old = active.binder(); old.props.onPressIn({ nativeEvent: { touches: [{}] } });
  active.unmount(); old.props.onPress(); active.advance(400); assert.equal(active.calls.now, 0);
});

test('duplicate release callbacks navigate once and the next separate tap works immediately', async () => {
  const h = headerHarness();
  const binder = h.binder(); binder.props.onPressIn({ nativeEvent: { touches: [{}] } });
  binder.props.onPress(); binder.props.onPress(); assert.equal(h.calls.now, 1);
  h.press(h.binder()); assert.equal(h.calls.now, 2);
  h.advance(400); await h.settle(); assert.equal(h.nodes().some((node) => node.type === 'Modal' && node.props.visible), false);
});

test('canceled second release cannot cause a later stray action and Pick / Range is an ordinary menu option', async () => {
  const h = headerHarness();
  const binder = h.binder(); binder.props.onPressIn({ nativeEvent: { touches: [{}] } });
  h.advance(250); binder.props.onTouchEnd(); h.advance(0); h.advance(600); await h.settle(); assert.equal(h.calls.now, 0);
  h.hold(h.binder()); await h.settle();
  const option = h.nodes().find((node) => node.props.accessibilityLabel === 'Pick or range dates'); assert.ok(option);
  option.props.onPress(); assert.equal(h.calls.picker, 0); h.advance(0); assert.equal(h.calls.picker, 1);
});

test('touching another header control cancels an unfinished view-icon gesture', async () => {
  const h = headerHarness(); const binder = h.binder(); binder.props.onPressIn({ nativeEvent: { touches: [{}] } });
  const sync = h.nodes().find((node) => node.props.accessibilityLabel === 'Sync attached calendars');
  sync.props.onPressIn(); binder.props.onPress(); h.advance(400); await h.settle(); assert.equal(h.calls.now, 0);
  assert.equal(h.nodes().some((node) => node.type === 'Modal' && node.props.visible), false);
  sync.props.onPress(); assert.equal(h.calls.sync, 1);
});

test('view choices wait for the dated draft acknowledgement and refuse a failed save', async () => {
  let release; const wait = new Promise((resolve) => release = resolve);
  const h = headerHarness({}, { flush: () => wait }); h.hold(h.binder()); await h.settle();
  assert.equal(h.nodes().some((node) => node.type === 'Modal' && node.props.visible), false);
  release(); await h.settle(); assert.ok(h.nodes().some((node) => node.type === 'Modal' && node.props.visible));
  const failed = headerHarness({}, { drafts: [{ error: true, revision: 1, savedRevision: 0 }] });
  failed.hold(failed.binder()); await failed.settle(); assert.equal(failed.calls.errors.length, 1);
  assert.equal(failed.nodes().some((node) => node.type === 'Modal' && node.props.visible), false);
});

test('iOS opens Pick / Range only after the view sheet dismisses and cancels a stale background handoff', async () => {
  const h = headerHarness({}, { os: 'ios' }); h.hold(h.binder()); await h.settle();
  const modal = h.nodes().find((node) => node.type === 'Modal' && node.props.visible);
  h.nodes(modal).find((node) => node.props.accessibilityLabel === 'Pick or range dates').props.onPress();
  h.advance(0); assert.equal(h.calls.picker, 0); modal.props.onDismiss(); assert.equal(h.calls.picker, 1);
  modal.props.onDismiss(); assert.equal(h.calls.picker, 1);
  const stale = headerHarness({}, { os: 'ios' }); stale.hold(stale.binder()); await stale.settle();
  const old = stale.nodes().find((node) => node.type === 'Modal' && node.props.visible);
  stale.nodes(old).find((node) => node.props.accessibilityLabel === 'Pick or range dates').props.onPress();
  stale.background(); old.props.onDismiss(); assert.equal(stale.calls.picker, 0);
});

test('actual hamburger menu orders Dashboard, Print, Redo, global Search, Settings and dispatches after dismissal', () => {
  const h = headerHarness(); h.nodes().find((node) => node.props.accessibilityLabel === 'Open menu').props.onPress(); h.render();
  const menu = h.nodes().find((node) => node.type === 'Modal' && node.props.visible);
  const options = h.nodes(menu).filter((node) => node.type === 'Pressable' && /^(?:Open Dashboard|Print displayed dates|Redo Context edit|Search all Context|Open Settings)$/.test(node.props.accessibilityLabel ?? ''));
  assert.deepEqual(options.map((node) => node.props.accessibilityLabel), ['Open Dashboard', 'Print displayed dates', 'Redo Context edit', 'Search all Context', 'Open Settings']);
  h.changeHeight(800);
  assert.ok(h.nodes().some((node) => node.type === 'Modal' && node.props.visible), 'keyboard dismissal must not close the newly requested menu');
  options[0].props.onPress(); assert.equal(h.calls.dashboard, 0); h.advance(0); assert.equal(h.calls.dashboard, 1);
  assert.equal(h.nodes().filter((node) => node.props.accessibilityLabel === 'Choose calendar view').length, 0, 'there is no separate triangle control');
  for (const scroll of h.nodes().filter((node) => node.type === 'ScrollView')) {
    assert.equal(scroll.props.keyboardShouldPersistTaps, 'always');
    assert.equal(scroll.props.keyboardDismissMode, 'none');
  }
});

test('Priority omits navigation arrows, uses a clipboard, and never borrows calendar Undo', async () => {
  let undo = 0; let redo = 0; let flushes = 0;
  const priority = { listId: 'family', canUndo: true, canRedo: true, busy: false,
    undo: async () => { undo++; return true; }, redo: async () => { redo++; return true; }, beforeLeave: async () => true };
  const h = headerHarness({ priority, canGoPrevious: false }, { history: { canUndo: false, canRedo: false, busy: true }, flush: async () => { flushes++; } });
  const toolbar = h.nodes().find((node) => node.type === 'ScrollView');
  const buttons = h.nodes(toolbar).filter((node) => node.type === 'Pressable');
  assert.deepEqual(buttons.map((node) => node.props.accessibilityLabel), ['Open menu', 'Priority view. Go to top',
    'Undo Context edit', 'Open Search', 'Sync attached calendars']);
  assert.equal(h.centerIcon().props.name, 'checklist');
  assert.equal(buttons[2].props.disabled, false); h.press(buttons[2]); await h.settle(); assert.equal(undo, 1); assert.equal(h.calls.undo, 0);
  h.nodes().find((node) => node.props.accessibilityLabel === 'Open menu').props.onPress(); h.render();
  h.nodes().find((node) => node.props.accessibilityLabel === 'Redo Context edit').props.onPress(); h.advance(0); await h.settle();
  assert.equal(redo, 1); assert.equal(h.calls.redo, 0); assert.equal(flushes, 0);
});

test('toolbar Search keeps its current-view callback while menu Search dispatches global Search only once', async () => {
  const h = headerHarness(); h.nodes().find((node) => node.props.accessibilityLabel === 'Open Search').props.onPress();
  assert.equal(h.calls.search, 1); assert.equal(h.calls.globalSearch, 0);
  h.nodes().find((node) => node.props.accessibilityLabel === 'Open menu').props.onPress(); h.render();
  const search = h.nodes().find((node) => node.props.accessibilityLabel === 'Search all Context');
  search.props.onPress(); search.props.onPress(); assert.equal(h.calls.globalSearch, 0);
  h.advance(0); await h.settle(); assert.equal(h.calls.globalSearch, 1); assert.equal(h.calls.search, 1);
});

test('Priority view chooser preserves its draft until its own acknowledgement and cancels a background continuation', async () => {
  for (const background of [false, true]) {
    let release; let saves = 0; const gate = new Promise((resolve) => release = resolve);
    const priority = { listId: 'main', canUndo: false, canRedo: false, busy: false, undo: async () => false, redo: async () => false,
      beforeLeave: async () => { saves++; return gate; } };
    const h = headerHarness({ priority }); h.hold(h.binder()); await Promise.resolve();
    assert.equal(saves, 1); assert.equal(h.nodes().some((node) => node.type === 'Modal' && node.props.visible), false);
    if (background) h.background(); release(true); await h.settle();
    assert.equal(h.nodes().some((node) => node.type === 'Modal' && node.props.visible), !background);
  }
});

test('Search occupies the old Redo toolbar position and Undo retains its original action', async () => {
  const h = headerHarness(); const toolbar = h.nodes().find((node) => node.type === 'ScrollView');
  const buttons = h.nodes(toolbar).filter((node) => node.type === 'Pressable');
  assert.deepEqual(buttons.map((node) => node.props.accessibilityLabel), ['Open menu', 'Previous calendar view', 'Day view. Go to now',
    'Next calendar view', 'Undo Context edit', 'Open Search', 'Sync attached calendars']);
  assert.equal(buttons[5].props.children.props.name, 'search');
  h.press(buttons[5]); assert.equal(h.calls.search, 1); assert.equal(h.calls.redo, 0);
  h.press(buttons[4]); await h.settle(); assert.equal(h.calls.undo, 1);
  const busy = headerHarness({ viewChanging: true });
  const search = busy.nodes().find((node) => node.props.accessibilityLabel === 'Open Search');
  assert.equal(search.props.disabled, true); assert.equal(search.props.accessibilityState.disabled, true);
  busy.press(search); assert.equal(busy.calls.search, 0, 'a stale native activation cannot navigate while a mutation is busy');
});

test('menu Redo waits for dismissal and draft acknowledgement and rejects disabled or newly invalid history', async () => {
  const open = (h) => { h.nodes().find((node) => node.props.accessibilityLabel === 'Open menu').props.onPress(); h.render();
    const modal = h.nodes().find((node) => node.type === 'Modal' && node.props.visible);
    return { modal, redo: h.nodes(modal).find((node) => node.props.accessibilityLabel === 'Redo Context edit') }; };
  for (const os of ['android', 'ios']) {
    const h = headerHarness({}, { os }); const { modal, redo } = open(h);
    assert.equal(redo.props.disabled, false); assert.equal(redo.props.accessibilityState.disabled, false);
    redo.props.onPress(); redo.props.onPress(); assert.equal(h.calls.redo, 0);
    if (os === 'ios') { h.advance(0); assert.equal(h.calls.redo, 0); modal.props.onDismiss(); } else h.advance(0);
    await h.settle(); assert.equal(h.calls.redo, 1); assert.equal(h.calls.search, 0);
  }
  const disabled = headerHarness({}, { history: { canRedo: false } }); const unavailable = open(disabled).redo;
  assert.equal(unavailable.props.disabled, true); assert.equal(unavailable.props.accessibilityState.disabled, true);
  unavailable.props.onPress(); disabled.advance(0); await disabled.settle(); assert.equal(disabled.calls.redo, 0);
  for (const invalidation of ['canRedo', 'busy', 'background']) {
    let release; const gate = new Promise((resolve) => release = resolve);
    const h = headerHarness({}, { flush: () => gate }); const { redo } = open(h);
    redo.props.onPress(); h.advance(0); await Promise.resolve();
    if (invalidation === 'background') h.background(); else h.history[invalidation] = invalidation === 'busy';
    release(); await h.settle(); assert.equal(h.calls.redo, 0, invalidation + ' must be checked again before the native history command');
  }
});

test('actual binder cancellation rejects a cancelled/multitouch release and accessible view action opens choices directly', async () => {
  const h = headerHarness({ viewMode: 'schedule' }); const binder = h.binder();
  binder.props.onPressIn({ nativeEvent: { touches: [{}] } });
  binder.props.onTouchStart({ nativeEvent: { touches: [{}, {}] } }); binder.props.onPress(); h.advance(400);
  assert.equal(h.calls.now, 0);
  binder.props.onAccessibilityAction({ nativeEvent: { actionName: 'showViews' } }); await h.settle();
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
      module, exports: module.exports, Date: FixedDate, viewMode: mode, calendarFocusRef: { current: {} }, focusSequence: { current: 40 }, viewWrites: { current: Promise.resolve() },
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
