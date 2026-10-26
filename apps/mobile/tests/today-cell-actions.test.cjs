const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the production screen's event callbacks without a native device.
// Native views are inert elements; state/effects advance deterministically between events.
function screen(t) {
  const day = '2026-10-25'; let now = 10000; let hook = 0; let dirty = true; let tree;
  const slots = []; const effects = []; const timers = new Map(); let timerId = 0;
  const calls = []; const pastePreviews = []; const listeners = new Set(); const rows = new Map(); const modules = new Map();
  let clipboard = null; let failure = null; let writeGate = null; let dismisses = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useRef(value) { const i = hook++; return slots[i] ??= { current: value }; },
    useState(value) { const i = hook++; if (!slots[i]) slots[i] = { value: typeof value === 'function' ? value() : value };
      return [slots[i].value, (next) => { const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useMemo(work, deps) { const i = hook++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: work() }; return slots[i].value; },
    useCallback(work, deps) { return this.useMemo(work, deps); },
    useEffect(work, deps) { const i = hook++; if (!slots[i] || !same(slots[i].deps, deps)) {
      const previous = slots[i]; slots[i] = { deps, cleanup: previous?.cleanup };
      effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = work(); }); } },
  };
  // Transpiled named imports do not bind `this`.
  react.useCallback = (work, deps) => react.useMemo(() => work, deps);
  const jsx = (type, props) => ({ type, props: props ?? {} });
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-25T12:00:00-04:00'])); } static now() { return now; } }
  class Value { constructor(value) { this.value = value; } setValue(value) { this.value = value; } }
  const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', FlatList: 'FlatList',
    TextInput: 'TextInput', KeyboardAvoidingView: 'KeyboardAvoidingView', RefreshControl: 'RefreshControl',
    Platform: { OS: 'android' }, StyleSheet: { create: (value) => value, hairlineWidth: 0.5 },
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
    Animated: { Value, View: 'AnimatedView', ScrollView: 'AnimatedScrollView', event: (_mapping, options) => options.listener,
      add: (left, right) => ({ get value() { return left.value + right.value; } }) },
    PanResponder: { create: (handlers) => ({ panHandlers: handlers }) },
    Keyboard: { dismiss() { dismisses++; }, addListener: () => ({ remove() {} }) },
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    Alert: { alert(_title, _text, buttons) { buttons.find((button) => button.text === 'Replace')?.onPress(); } },
    Linking: { openURL: async () => {} } };
  const source = (relative) => path.join(__dirname, '../src', relative);
  const emit = () => listeners.forEach((listener) => listener());
  let drafts;
  const sheet = { spreadsheetEditor: { snapshot: () => ({ busy: false, formatVersion: 0, canUndo: false, canRedo: false, clipboard }),
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } },
    getDayCellFormats: async () => new Map(), getDayActivityGroups: async () => [],
    editInlineMinute: (...args) => drafts.edit(...args), getSpreadsheetClipboard: () => clipboard,
    copyMinuteRange: (range) => capture('copy', range), cutMinuteRange: (range) => capture('cut', range),
    clearTextMinuteRange: async (range) => { command('clear', range); for (let minute = range.startMinute; minute <= range.endMinute; minute++) {
      const row = rows.get(`${range.dateKey}:${minute}`); if (row) { row.text = ''; drafts.rebaseCommitted([{ ...row, keepColor: true }]); } } },
    prepareMinutePaste: async (range) => { pastePreviews.push({ ...range }); return { ...range, token: 'preview', occupiedCount: 0 }; },
    pasteMinuteRange: async (destination) => { command('paste', destination); for (let offset = 0; offset < clipboard.cells.length; offset++) {
      const source = clipboard.cells[offset]; const minuteIndex = destination.startMinute + offset;
      rows.set(`${destination.dateKey}:${minuteIndex}`, { ...source, dateKey: destination.dateKey, minuteIndex });
      drafts.rebaseCommitted([{ ...source, dateKey: destination.dateKey, minuteIndex, keepColor: false }]); }
      if (clipboard.mode === 'cut') { for (let minute = clipboard.range.startMinute; minute <= clipboard.range.endMinute; minute++) rows.delete(`${clipboard.range.dateKey}:${minute}`); clipboard = null; }
      emit(); },
  };
  function command(action, value) { if (failure === action) throw Error(`${action} failed; retry`); calls.push({ action, ...value }); }
  async function capture(mode, range) { command(mode, range); clipboard = { mode, range: { ...range }, count: range.endMinute - range.startMinute + 1,
    token: 'clipboard', cells: Array.from({ length: range.endMinute - range.startMinute + 1 }, (_, index) =>
      ({ ...rows.get(`${range.dateKey}:${range.startMinute + index}`) })) }; emit(); }
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const module = { exports: {} }; modules.set(filename, module.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInContext(code, vm.createContext({ module, exports: module.exports, console, Date: ClockDate, Intl, Math, Map, Set,
      Promise, Error, Number, JSON, setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
      clearTimeout: (id) => timers.delete(id), setInterval: () => ++timerId, clearInterval() {},
      requestAnimationFrame: () => ++timerId, cancelAnimationFrame() {},
      require(name) {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        if (name === 'react-native') return native;
        if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) };
        const resolved = path.resolve(path.dirname(filename), name);
        if (resolved === source('appearance')) return { useAppTheme: () => ({ colors: load(source('theme.ts')).darkColors, resolvedMode: 'dark' }) };
        if (resolved.endsWith('/components/CellActionMenu') || resolved.endsWith('\\components\\CellActionMenu')) return { CellActionMenu: 'CellActionMenu' };
        if (resolved.endsWith('/components/CellColorPalette') || resolved.endsWith('\\components\\CellColorPalette')) return { CellColorPalette: 'CellColorPalette' };
        if (resolved.endsWith('/components/MinuteEditor') || resolved.endsWith('\\components\\MinuteEditor')) return { MinuteEditor: 'MinuteEditor' };
        if (resolved === source('data/database')) return { getDayEntries: async (date) => [...rows.values()].filter((row) => row.dateKey === date).map((row) => ({ ...row })),
          getMinuteEntry: async (date, minute) => rows.get(`${date}:${minute}`) ? { ...rows.get(`${date}:${minute}`) } : null };
        if (resolved === source('services/calendar')) return { loadPlannedEventsResult: async () => ({ plans: [], failures: [] }), reconcileLinkedNativeColors: async () => [], flushPendingActuals: async () => ({}) };
        if (resolved === source('services/categories')) return { listSelectableActivityCategories: async () => [] };
        if (resolved === source('services/inline-minutes')) return { inlineMinuteDrafts: drafts,
          flushInlineMinutes: () => drafts.flushAll(), retryInlineMinuteLinks: async () => {}, subscribeInlineMinuteCommits: (listener) => drafts.subscribeCommits((_value, result) => listener(result)),
          subscribeInlineMinuteLinkWarnings: () => () => {} };
        if (resolved === source('services/spreadsheet')) return sheet;
        if (resolved === source('sync/accounts')) return { getAccounts: async () => [] };
        if (resolved === source('sync/engine')) return { loadAccountPlans: async () => [], linkActualsToAccounts: async () => {}, requestAccountSynchronization: () => {}, synchronizeAccounts: async () => {} };
        if (!name.startsWith('.')) throw Error(`Unexpected Today test import ${name}`);
        return load(`${resolved}.ts`);
      } }), { filename });
    modules.set(filename, module.exports); return module.exports;
  }
  const Drafts = load(source('utils/inline-minute-drafts.ts')).InlineMinuteDrafts;
  drafts = new Drafts(async (value) => { if (writeGate) await writeGate;
    if (failure === 'save') throw Error('Save failed');
    const entry = { ...value, blockId: rows.get(`${value.dateKey}:${value.minuteIndex}`)?.blockId ?? 'note' }; rows.set(`${value.dateKey}:${value.minuteIndex}`, entry);
    return { ...value, entry, affectedDates: [value.dateKey] }; }, 60000);
  const Today = load(source('screens/TodayScreen.tsx')).TodayScreen;
  const props = { activeDate: day, calendars: [], preferences: { selectedCalendarIds: [], syncActuals: false }, dataVersion: 0,
    focusRequest: null, onFocusConsumed() {}, onDataChanged() {}, onDateChange() {}, onOpenSettings() {} };
  function render() { hook = 0; dirty = false; tree = Today(props); while (effects.length) effects.shift()(); }
  async function settle() { for (let round = 0; round < 80; round++) { await Promise.resolve(); if (dirty) render(); } }
  function find(node, type) { if (!node || typeof node !== 'object') return null; if (node.type === type) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, type); if (result) return result; } return null; }
  function cell(minute, date = day) { const row = find(tree, 'FlatList').props.renderItem({ item: minute });
    return row.props.children[1].find((value) => value.props.accessibilityLabel?.startsWith(load(source('utils/time.ts')).formatDayHeading(date))) ?? row.props.children[1][0]; }
  function event() { return { nativeEvent: { pageX: 150, pageY: 400, touches: [{ pageX: 150, pageY: 400 }] } }; }
  function menuPosition(node = tree) { if (!node || typeof node !== 'object') return null;
    if (node.type === 'AnimatedView' && node.props.children?.type === 'CellActionMenu') return node.props.style[1].transform[1].translateY.value;
    for (const child of [node.props?.children].flat(Infinity)) { if (child === undefined) continue; const value = menuPosition(child); if (value != null) return value; } return null; }
  function menuAncestors(node = tree, trail = []) { if (!node || typeof node !== 'object') return null;
    if (node.type === 'CellActionMenu') return trail;
    for (const child of [node.props?.children].flat(Infinity)) { if (child === undefined) continue;
      const value = menuAncestors(child, [...trail, node]); if (value) return value; } return null; }
  function measureViewport({ rootX = 0, rootY = 80, gridX = 0, bodyY = 146, height = 500, defer = false } = {}) {
    const screen = tree.props.children;
    const grid = [screen.props.children].flat(Infinity).find((node) => node?.props?.onPanResponderGrant);
    const body = find(tree, 'FlatList');
    let bodyParent;
    function visit(node) { if (!node || typeof node !== 'object') return;
      if ([node.props?.children].flat().includes(body)) bodyParent = node;
      for (const child of [node.props?.children].flat(Infinity)) visit(child); }
    visit(tree);
    for (const host of [screen, grid, bodyParent]) assert.equal(host.props.collapsable, false, 'measured Android anchors must retain native hosts');
    const callbacks = [];
    const measure = (...values) => (callback) => { if (defer) callbacks.push(() => callback(...values)); else callback(...values); };
    screen.props.ref.current = { measureInWindow: measure(rootX, rootY, 390, 700) };
    grid.props.ref.current = { measureInWindow: measure(gridX, rootY, 390, 700) };
    bodyParent.props.ref.current = { measureInWindow: measure(gridX, bodyY, 390, height) };
    screen.props.onLayout();
    return callbacks;
  }
  async function tap(minute) { const target = cell(minute); target.props.onPressIn(); target.props.onTouchStart(event()); now += 60;
    target.props.onTouchEnd(event()); target.props.onPress(event()); await settle(); }
  async function hold(minute) { const target = cell(minute); target.props.onPressIn(); target.props.onTouchStart(event());
    now += 460; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    await settle(); target.props.onTouchEnd(event()); target.props.onPress(event()); await settle(); }
  t.after(() => { for (const slot of slots) slot?.cleanup?.(); timers.clear(); });
  return { day, calls, pastePreviews, rows, drafts, async start() { render(); await settle(); }, tap, hold, settle,
    async selectThrough(minute) {
      function handle(node) { if (!node || typeof node !== 'object') return null;
        if (node.props?.accessibilityLabel === 'Drag to select minutes for Auto fill') return node;
        for (const child of [node.props?.children].flat(Infinity)) { const found = handle(child); if (found) return found; } return null; }
      handle(tree).props.onAccessibilityTap(); await settle(); await tap(minute);
    },
    menu: () => find(tree, 'CellActionMenu')?.props, menuPosition, menuAncestors, measureViewport,
    input: (minute = 600) => find(cell(minute), 'TextInput')?.props,
    get dismisses() { return dismisses; }, set failure(value) { failure = value; },
    set writeGate(value) { writeGate = value; }, advance(ms) { now += ms; }, cell, get tree() { return tree; } };
}

test('a held recorded cell dispatches whole-cell Copy, then a held destination dispatches Paste', async (t) => {
  const r = screen(t); r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Read Context answer', categoryId: 'work', blockId: 'note' });
  await r.start(); await r.hold(600); assert.ok(r.menu()); await r.menu().onCopy(); await r.settle();
  assert.equal(r.calls[0].action, 'copy'); assert.equal(r.calls[0].startMinute, 600); assert.equal(r.menu(), undefined);
  await r.tap(601); await r.hold(601); assert.equal(r.menu().canPaste, true); await r.menu().onPaste(); await r.settle();
  assert.equal(r.calls[1].action, 'paste'); assert.equal(r.calls[1].startMinute, 601); assert.equal(r.rows.get(`${r.day}:601`).text, 'Read Context answer');
  assert.equal(r.rows.get(`${r.day}:601`).categoryId, 'work'); assert.equal(r.rows.get(`${r.day}:600`).text, 'Read Context answer');
});

test('Paste forwards every selected minute to both overwrite preview and application', async (t) => {
  const r = screen(t); r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Read and follow along', categoryId: 'work', blockId: 'note' });
  await r.start(); await r.hold(600); await r.menu().onCopy(); await r.settle();
  r.advance(500); await r.tap(601); await r.selectThrough(604);
  assert.ok(r.menu()); await r.menu().onPaste(); await r.settle();
  assert.deepEqual(r.pastePreviews, [{ dateKey: r.day, startMinute: 601, endMinute: 604 }]);
  const applied = r.calls.find((call) => call.action === 'paste');
  assert.equal(applied.startMinute, 601); assert.equal(applied.endMinute, 604);
});

test('Cut remains deferred until Paste and Clear flushes pending typing before applying', async (t) => {
  const r = screen(t); r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Initial note', categoryId: 'work', blockId: 'note' });
  await r.start(); await r.tap(600); await r.tap(600); assert.ok(r.input()); r.input().onChangeText('Latest complete cell'); await r.settle();
  r.input().onSubmitEditing(); await r.settle();
  await r.hold(600); await r.menu().onCut(); await r.settle(); assert.equal(r.rows.get(`${r.day}:600`).text, 'Latest complete cell');
  await r.tap(601); await r.hold(601); await r.menu().onPaste(); await r.settle();
  assert.equal(r.rows.has(`${r.day}:600`), false); assert.equal(r.rows.get(`${r.day}:601`).text, 'Latest complete cell');
  await r.hold(601); await r.menu().onClear(); await r.settle(); assert.equal(r.rows.get(`${r.day}:601`).text, '');
});

test('failed menu commands keep the selected menu and actionable error instead of silently disappearing', async (t) => {
  const r = screen(t); r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Keep me', categoryId: 'work', blockId: 'note' });
  await r.start(); await r.hold(600); r.failure = 'copy'; await r.menu().onCopy(); await r.settle();
  assert.match(r.menu().error, /copy failed/); assert.equal(r.rows.get(`${r.day}:600`).text, 'Keep me');
  r.failure = null; await r.menu().onCopy(); await r.settle(); assert.equal(r.calls.at(-1).action, 'copy');
});

test('a menu command locks its source before a pending local flush and dispatches only once', async (t) => {
  const r = screen(t); r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Original', categoryId: 'work', blockId: 'note' });
  await r.start(); await r.hold(600);
  r.drafts.edit(r.day, 600, { text: 'Latest full cell before Copy' });
  let release; r.writeGate = new Promise((resolve) => { release = resolve; });
  const command = r.menu().onCopy; command(); command(); await r.settle();
  assert.equal(r.menu().busy, true, 'the action is visibly busy before flush resolves');
  r.menu().onClose(); await r.tap(601); await r.hold(601);
  assert.ok(r.menu(), 'Back/dismiss and destination taps cannot consume a queued source command');
  assert.equal(r.calls.length, 0, 'copy waits for the latest complete local value');
  release(); r.writeGate = null; await r.settle();
  assert.deepEqual(r.calls.map(({ action, startMinute }) => [action, startMinute]), [['copy', 600]]);
  assert.equal(r.cell(600).props.accessibilityState.selected, true);
  assert.equal(r.cell(601).props.accessibilityState.selected, false);
});

test('a keyboard-hide layout change cannot move a menu button between touch down and its first release', async (t) => {
  const r = screen(t); r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Single press', categoryId: 'work', blockId: 'note' });
  await r.start(); await r.hold(600);
  r.menu().onHeightChange(100); const before = r.menuPosition();
  r.menu().onTouchActiveChange(true);
  r.menu().onHeightChange(240); // The keyboard/viewport transition measures a different available panel.
  assert.equal(r.menuPosition(), before, 'the native down/up target must stay at the same coordinates');
  assert.equal(r.calls.length, 0, 'touch down alone must never trigger a destructive action');
  r.menu().onTouchActiveChange(false); r.menu().onCopy(); await r.settle();
  assert.deepEqual(r.calls.map((call) => call.action), ['copy']);
});

test('the compact menu is outside the RN scroll responder that consumes the first tap during momentum', async (t) => {
  const scrollSource = fs.readFileSync(path.join(__dirname,
    '../node_modules/react-native/Libraries/Components/ScrollView/ScrollView.js'), 'utf8');
  const method = scrollSource.match(/_handleStartShouldSetResponderCapture:\s*\(e: GestureResponderEvent\) => boolean =\s*\(e: GestureResponderEvent\) => (\{[\s\S]*?\n    \});/);
  assert.ok(method, 'exercise the installed React Native capture implementation, rather than a copied policy');
  const capture = vm.runInNewContext('(function(e) ' + method[1] + ')',
    { __DEV__: false, console, TextInputState: { isTextInput: () => false } });
  let momentum = true; let delivered = 0;
  const ancestor = { props: { keyboardShouldPersistTaps: 'always', disableScrollViewPanResponder: true },
    _isAnimating: () => momentum, _softKeyboardIsDetached: () => false, _keyboardIsDismissible: () => false };
  const event = { target: {} };
  if (!capture.call(ancestor, event)) delivered++;
  assert.equal(delivered, 0, 'even persist=always and disabled JS pan responder cannot bypass momentum capture');
  momentum = false;
  if (!capture.call(ancestor, event)) delivered++;
  assert.equal(delivered, 1, 'this exact ancestor policy explains a first consumed tap followed by a working tap');

  const r = screen(t); r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Copy once', categoryId: 'work', blockId: 'note' });
  await r.start(); r.measureViewport(); await r.hold(600);
  const parents = r.menuAncestors(); assert.ok(parents.length);
  assert.ok(parents.some((node) => node.props.pointerEvents === 'box-none'));
  assert.ok(!parents.some((node) => ['ScrollView', 'AnimatedScrollView', 'FlatList', 'Modal'].includes(node.type)));
  assert.ok(!parents.some((node) => node.props.onPanResponderGrant), 'the menu also sits outside grid pinch/group responders');
  momentum = true; r.menu().onCopy(); await r.settle();
  assert.deepEqual(r.calls.map((call) => call.action), ['copy'], 'the first menu release reaches its original command without an ancestor capture');
});

test('the sibling menu preserves root-relative anchors and outside cells still select in one tap', async (t) => {
  const r = screen(t); r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Original', categoryId: 'work', blockId: 'note' });
  await r.start(); await r.hold(600); r.menu().onHeightChange(100);
  const initial = r.menuPosition(); assert.equal(typeof initial, 'number');
  r.measureViewport({ rootY: 80, bodyY: 146 }); const anchored = r.menuPosition();
  assert.equal(anchored, initial + 66, 'the old minute-viewport anchor is translated into the sibling root coordinates');
  r.menu().onTouchActiveChange(true);
  r.measureViewport({ rootY: 80, bodyY: 170 }); assert.equal(r.menuPosition(), anchored, 'resize cannot move a pressed target');
  await r.tap(601);
  assert.equal(r.menu(), undefined); assert.equal(r.cell(601).props.accessibilityState.selected, true);
  assert.equal(r.input(601), undefined, 'an outside cell selects directly without a dismiss-then-select tap or keyboard');
});

test('late native geometry callbacks cannot replace a newer root/body menu anchor', async (t) => {
  const r = screen(t); await r.start(); await r.hold(600); r.menu().onHeightChange(100);
  const before = r.menuPosition();
  const old = r.measureViewport({ rootY: 80, bodyY: 146, defer: true });
  const latest = r.measureViewport({ rootY: 80, bodyY: 180, defer: true });
  latest.forEach((complete) => complete()); assert.equal(r.menuPosition(), before + 100);
  old.forEach((complete) => complete()); assert.equal(r.menuPosition(), before + 100);
});

test('single taps only select filled cells, double tap edits, and Save waits for current typing', async (t) => {
  const r = screen(t); r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Original', categoryId: 'work', blockId: 'note' });
  await r.start(); await r.tap(600); assert.equal(r.input(), undefined); r.advance(500); await r.tap(600); assert.equal(r.input(), undefined);
  await r.tap(600); assert.equal(r.input().value, 'Original'); r.input().onChangeText('First edit'); await r.settle();
  let release; r.writeGate = new Promise((resolve) => { release = resolve; }); const previousDismisses = r.dismisses;
  r.input().onSubmitEditing(); await r.settle(); assert.ok(r.input()); assert.equal(r.dismisses, previousDismisses);
  r.input().onChangeText('Latest edit while saving'); await r.settle(); release(); r.writeGate = null; await r.settle();
  assert.equal(r.rows.get(`${r.day}:600`).text, 'Latest edit while saving'); assert.equal(r.input(), undefined);
  assert.ok(r.dismisses > previousDismisses); assert.equal(r.cell(600).props.accessibilityState.selected, true);
});

test('a failed keyboard Save preserves the typed value and editing for retry', async (t) => {
  const r = screen(t); await r.start(); await r.tap(600); await r.tap(600);
  r.input().onChangeText('An unsaved thought'); await r.settle(); r.failure = 'save';
  const previousDismisses = r.dismisses; r.input().onSubmitEditing(); await r.settle();
  assert.equal(r.input().value, 'An unsaved thought'); assert.equal(r.dismisses, previousDismisses);
  assert.equal(r.drafts.get(r.day, 600).error, true);
  r.input().onAccessibilityAction({ nativeEvent: { actionName: 'showMenu' } }); await r.settle();
  assert.equal(r.input(), undefined, 'an explicitly requested blocked whole-cell command can leave the raw cell selected without a keyboard');
  await r.tap(600); await r.tap(600);
  assert.equal(r.input().value, 'An unsaved thought', 'the same raw cell remains editable after a failed database save');
  r.input().onChangeText('Revised after the failure'); await r.settle();
  r.failure = null; r.input().onSubmitEditing(); await r.settle();
  assert.equal(r.rows.get(`${r.day}:600`).text, 'Revised after the failure'); assert.equal(r.input(), undefined);
});

test('a completed old Save cannot close a newer cell keyboard after an asynchronous switch', async (t) => {
  const r = screen(t); await r.start(); await r.tap(600); await r.tap(600);
  r.input().onChangeText('Save the old cell'); await r.settle();
  let release; r.writeGate = new Promise((resolve) => { release = resolve; });
  r.input().onSubmitEditing(); await r.settle();
  await r.tap(601); await r.tap(601); const dismissesBeforeAck = r.dismisses;
  release(); r.writeGate = null; await r.settle();
  assert.equal(r.rows.get(`${r.day}:600`).text, 'Save the old cell');
  assert.ok(r.input(601), 'the latest double-tapped destination stays in edit mode');
  assert.equal(r.dismisses, dismissesBeforeAck, 'the older checkmark cannot dismiss the new editor');
});

test('editing owns native partial selection and text-only Cut/Paste without opening the whole-cell menu', async (t) => {
  const r = screen(t);
  r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Make coffee; talk to Mum', categoryId: 'family', blockId: 'activity_source' });
  r.rows.set(`${r.day}:601`, { dateKey: r.day, minuteIndex: 601, text: 'Remember: ', categoryId: 'work', blockId: 'activity_destination' });
  await r.start(); await r.tap(600); await r.tap(600);
  assert.equal(r.input().contextMenuHidden, false);
  r.input().onSelectionChange({ nativeEvent: { selection: { start: 13, end: 24 } } });
  await r.hold(600);
  assert.ok(r.input(), 'holding edited text must leave the native editor and its selection handles mounted');
  assert.equal(r.menu(), undefined, 'the row cannot steal a native word-selection hold');
  const phrase = 'talk to Mum';
  r.input().onChangeText('Make coffee; '); await r.settle(); // Native Cut reports only the new text value.
  await r.tap(601); await r.tap(601);
  assert.equal(r.input(601).contextMenuHidden, false);
  r.input(601).onChangeText('Remember: ' + phrase); r.input(601).onSubmitEditing(); await r.settle();
  assert.equal(r.rows.get(`${r.day}:600`).text, 'Make coffee; ');
  assert.equal(r.rows.get(`${r.day}:601`).text, 'Remember: talk to Mum');
  assert.equal(r.rows.get(`${r.day}:600`).categoryId, 'family');
  assert.equal(r.rows.get(`${r.day}:601`).categoryId, 'work');
  assert.equal(r.rows.get(`${r.day}:600`).blockId, 'activity_source');
  assert.equal(r.rows.get(`${r.day}:601`).blockId, 'activity_destination');
  assert.equal(r.calls.length, 0, 'native text actions do not invoke whole-cell Copy/Cut/Paste commands');
  await r.hold(600); assert.ok(r.menu(), 'whole-cell actions remain available after editing closes');
});
