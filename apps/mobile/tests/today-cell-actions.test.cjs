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
  const calls = []; const listeners = new Set(); const rows = new Map(); const modules = new Map();
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
    Animated: { Value, View: 'AnimatedView', ScrollView: 'AnimatedScrollView', event: (_mapping, options) => options.listener },
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
    prepareMinutePaste: async (range) => ({ ...range, token: 'preview', occupiedCount: 0 }),
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
    const entry = { ...value, blockId: 'note' }; rows.set(`${value.dateKey}:${value.minuteIndex}`, entry);
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
  async function tap(minute) { const target = cell(minute); target.props.onPressIn(); target.props.onTouchStart(event()); now += 60;
    target.props.onTouchEnd(event()); target.props.onPress(event()); await settle(); }
  async function hold(minute) { const target = cell(minute); target.props.onPressIn(); target.props.onTouchStart(event());
    now += 460; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    await settle(); target.props.onTouchEnd(event()); target.props.onPress(event()); await settle(); }
  t.after(() => { for (const slot of slots) slot?.cleanup?.(); timers.clear(); });
  return { day, calls, rows, drafts, async start() { render(); await settle(); }, tap, hold, settle,
    menu: () => find(tree, 'CellActionMenu')?.props, menuPosition, input: (minute = 600) => find(cell(minute), 'TextInput')?.props,
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

test('Cut remains deferred until Paste and Clear flushes pending typing before applying', async (t) => {
  const r = screen(t); r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Initial note', categoryId: 'work', blockId: 'note' });
  await r.start(); await r.tap(600); await r.tap(600); assert.ok(r.input()); r.input().onChangeText('Latest complete cell'); await r.settle();
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
  await r.hold(600); assert.equal(r.input(), undefined, 'a blocked command can leave the raw cell selected without a keyboard');
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
