const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the production screen's event callbacks without a native device.
// Native views are inert elements; state/effects advance deterministically between events.
function screen(t, options = {}) {
  const day = '2026-10-25'; let now = 10000; let hook = 0; let dirty = true; let tree;
  const slots = []; const effects = []; const timers = new Map(); const animationFrames = new Map(); let timerId = 0;
  const calls = []; const pastePreviews = []; const externalPreviews = []; const spanPreviews = []; const alerts = [];
  const listeners = new Set(); const appStateListeners = new Set(); const keyboardListeners = new Map(); const rows = new Map(); const modules = new Map();
  let systemReads = 0; let systemCopies = 0;
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
    Platform: { OS: options.platform ?? 'android' }, StyleSheet: { create: (value) => value, hairlineWidth: 0.5 },
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
    Animated: { Value, View: 'AnimatedView', ScrollView: 'AnimatedScrollView', event: (_mapping, options) => options.listener,
      add: (left, right) => ({ get value() { return left.value + right.value; } }) },
    PanResponder: { create: (handlers) => ({ panHandlers: handlers }) },
    Keyboard: { dismiss() { dismisses++; }, addListener: (name, listener) => {
      const list = keyboardListeners.get(name) ?? new Set(); keyboardListeners.set(name, list); list.add(listener);
      return { remove() { list.delete(listener); } }; } },
    AppState: { currentState: 'active', addEventListener: (_event, listener) => {
      appStateListeners.add(listener); return { remove() { appStateListeners.delete(listener); } }; } },
    Alert: { alert(title, text, buttons) { alerts.push({ title, text });
      buttons.find((button) => button.text === (options.confirmReplace === false ? 'Cancel' : 'Replace'))?.onPress(); } },
    Linking: { openURL: async () => {} } };
  const source = (relative) => path.join(__dirname, '../src', relative);
  const emit = () => listeners.forEach((listener) => listener());
  let drafts;
  const sheet = { spreadsheetEditor: { snapshot: () => ({ busy: false, formatVersion: 0, canUndo: false, canRedo: false, clipboard }),
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } },
    getDayCellFormats: options.readFormats ?? (async () => new Map()), getDayActivityGroups: options.readGroups ?? (async () => []),
    editInlineMinute: (...args) => drafts.edit(...args), getSpreadsheetClipboard: () => clipboard,
    resetMinuteFill: async (range) => command('reset-fill', range),
    resetMinuteCells: async (range) => { command('reset-cells', range); for (let minute = range.startMinute; minute <= range.endMinute; minute++) {
      rows.delete(`${range.dateKey}:${minute}`); drafts.rebaseCommitted([{ dateKey: range.dateKey, minuteIndex: minute,
        text: '', categoryId: 'unaccounted', keepColor: false }]); } },
    applyCellFormat: async (range, patch) => command('format', { ...range, patch }),
    colorMinuteRange: async (range, categoryId) => command('color', { ...range, categoryId }),
    ungroupMinuteRange: async (range) => command('ungroup', range),
    groupMinuteRange: async (range, group) => command('group', { ...range, ...group }),
    prepareMinuteSpanFill: async (span, input) => {
      const ranges = load(source('utils/minute-span.ts')).minuteSpanRanges(span);
      spanPreviews.push({ span: { ...span }, input: JSON.parse(JSON.stringify(input)) });
      if (options.prepareSpanGate) await options.prepareSpanGate;
      return { token: 'span-preview', span, ranges, cellCount: ranges.reduce((n, r) => n + r.endMinute - r.startMinute + 1, 0), occupiedCount: options.spanOccupied ?? 0 };
    },
    fillMinuteSpan: async (span, input, applyOptions) => command('span-fill', { span, input, ...applyOptions }),
    cancelMinuteRangeMove() {},
    getMovableActivityGroup: options.readMovableGroup ?? (async () => null),
    prepareActivityGroupMove: async (source, destination) => { command('prepare-group-move', { source, destination });
      return { token: 'group-move-preview', occupiedCount: options.moveOccupied ?? 0 }; },
    moveActivityGroup: async (source, destination, applyOptions) => command('move-group', { source, destination, ...applyOptions }),
    prepareMinuteRangeMove: async (source, destination, prepareOptions) => {
      command('prepare-range-move', { source, destination, ...prepareOptions });
      return { token: prepareOptions?.sourceToken ? 'move-drop-preview' : 'move-source-preview', occupiedCount: options.moveOccupied ?? 0 };
    },
    moveMinuteRange: async (source, destination, applyOptions) => command('move-range', { source, destination, ...applyOptions }),
    copyMinuteRange: (range) => capture('copy', range), cutMinuteRange: (range) => capture('cut', range),
    clearTextMinuteRange: async (range) => { command('clear', range); for (let minute = range.startMinute; minute <= range.endMinute; minute++) {
      const row = rows.get(`${range.dateKey}:${minute}`); if (row) { row.text = ''; drafts.rebaseCommitted([{ ...row, keepColor: true }]); } } },
    prepareMinutePaste: async (range) => { pastePreviews.push({ ...range }); return {
      range: { ...range, endMinute: range.endMinute ?? range.startMinute }, token: 'preview', occupiedCount: 0, mode: clipboard.mode }; },
    prepareExternalMinutePaste: async (text, destination) => {
      externalPreviews.push({ text, ...destination });
      if (failure === 'prepare-external') throw Error('External Paste could not be prepared');
      return options.externalPreview ?? { token: 'external-preview', rows: 1, columns: 1, occupiedCount: 0,
        ranges: [{ ...destination, endMinute: destination.endMinute ?? destination.startMinute }] };
    },
    pasteExternalMinuteRange: async (text, destination, applyOptions) => {
      command('paste-external', { text, ...destination, ...applyOptions });
      for (const entry of options.externalRows ?? []) {
        rows.set(`${entry.dateKey}:${entry.minuteIndex}`, { ...entry });
        drafts.rebaseCommitted([{ ...entry, keepColor: false }]);
      }
    },
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
      requestAnimationFrame: (callback) => { const id = ++timerId; animationFrames.set(id, callback); return id; },
      cancelAnimationFrame: (id) => animationFrames.delete(id),
      require(name) {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        if (name === 'react-native') return native;
        if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) };
        const resolved = path.resolve(path.dirname(filename), name);
        if (resolved === source('appearance')) return { useAppTheme: () => ({ colors: load(source('theme.ts')).darkColors, resolvedMode: 'dark' }) };
        for (const name of ['CellActionIcon', 'CompactMinuteOverview', 'MinuteSpanEditor']) {
          if (resolved.endsWith('/components/' + name) || resolved.endsWith('\\components\\' + name)) return { [name]: name };
        }
        if (resolved.endsWith('/components/CellActionMenu') || resolved.endsWith('\\components\\CellActionMenu')) return { CellActionMenu: 'CellActionMenu' };
        if (resolved.endsWith('/components/CellColorPalette') || resolved.endsWith('\\components\\CellColorPalette')) return { CellColorPalette: 'CellColorPalette' };
        if (resolved.endsWith('/components/MinuteEditor') || resolved.endsWith('\\components\\MinuteEditor')) return { MinuteEditor: 'MinuteEditor' };
        if (resolved === source('data/database')) return { getDayEntries: options.readEntries ?? (async (date) => [...rows.values()].filter((row) => row.dateKey === date).map((row) => ({ ...row }))),
          getEntriesForBlock: async (blockId) => [...rows.values()].filter((row) => row.blockId === blockId).map((row) => ({ ...row })),
          getMinuteEntry: async (date, minute) => rows.get(`${date}:${minute}`) ? { ...rows.get(`${date}:${minute}`) } : null };
        if (resolved === source('services/calendar')) return { loadPlannedEventsResult: options.readNative ?? (async () => ({ plans: [], failures: [] })),
          reconcileLinkedNativeColors: options.reconcileColors ?? (async () => []), flushPendingActuals: async () => ({}) };
        if (resolved === source('services/categories')) return {
          listSelectableActivityCategories: options.readColors ?? (async () => options.colors ?? []),
          subscribeWritablePaletteChanges: options.subscribePalette ?? (() => () => {}),
        };
        if (resolved === source('services/inline-minutes')) return { inlineMinuteDrafts: drafts,
          flushInlineMinutes: () => drafts.flushAll(), retryInlineMinuteLinks: async () => {}, subscribeInlineMinuteCommits: (listener) => drafts.subscribeCommits((_value, result) => listener(result)),
          subscribeInlineMinuteLinkWarnings: options.subscribeLinkWarnings ?? (() => () => {}) };
        if (resolved === source('services/spreadsheet')) return sheet;
        if (resolved === source('services/system-cell-clipboard')) return {
          copySpreadsheetCellsToSystem: async () => { systemCopies++; },
          readSpreadsheetPasteSource: async () => {
            systemReads++;
            if (options.readPasteSource) return options.readPasteSource();
            if (clipboard) return { kind: 'internal' };
            throw Error('Copy some cell text before pasting.');
          },
        };
        if (resolved === source('sync/accounts')) return { getAccounts: async () => [] };
        if (resolved === source('sync/engine')) return { loadCachedAccountPlans: options.readCached ?? (async () => []),
          loadAccountPlansResult: options.readAccount ?? (async () => ({ plans: [], failures: [], fromCache: false })),
          linkActualsToAccounts: async () => {}, requestAccountSynchronization: () => {}, synchronizeAccounts: async () => {} };
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
    focusRequest: null, onFocusConsumed() {}, onDataChanged() {}, onDateChange() {}, onOpenSettings() {}, ...options.props };
  function render() { hook = 0; dirty = false; tree = Today(props); while (effects.length) effects.shift()(); }
  async function settle() { for (let round = 0; round < 80; round++) { await Promise.resolve(); if (dirty) render(); } }
  function find(node, type) { if (!node || typeof node !== 'object') return null; if (node.type === type) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, type); if (result) return result; } return null; }
  function labelled(node, label) { if (!node || typeof node !== 'object') return null;
    if (node.props?.accessibilityLabel === label) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const result = labelled(child, label); if (result) return result; } return null; }
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
  let disposed = false;
  function unmount() { if (disposed) return; disposed = true;
    for (const slot of slots) slot?.cleanup?.(); timers.clear(); animationFrames.clear(); }
  t.after(unmount);
  return { day, calls, pastePreviews, externalPreviews, spanPreviews, alerts, rows, drafts, async start() { render(); await settle(); }, tap, hold, settle,
    async selectThrough(minute) {
      function handle(node) { if (!node || typeof node !== 'object') return null;
        if (node.props?.accessibilityLabel === 'Drag to select minutes for Auto fill') return node;
        for (const child of [node.props?.children].flat(Infinity)) { const found = handle(child); if (found) return found; } return null; }
      handle(tree).props.onAccessibilityTap(); await settle(); await tap(minute);
    },
    details: () => find(tree, 'MinuteSpanEditor')?.props, overview: () => find(tree, 'CompactMinuteOverview')?.props,
    menu: () => find(tree, 'CellActionMenu')?.props, menuPosition, menuAncestors, measureViewport,
    palette: () => find(tree, 'CellColorPalette')?.props,
    menuBox: () => { const style = menuAncestors()?.at(-1)?.props.style[1];
      return style ? { width: style.width, left: style.left.value } : null; },
    async beginMove(minute, { date = day, x = 150, y = 400 } = {}) {
      measureViewport();
      const list = find(tree, 'FlatList'); const rowHeight = list.props.getItemLayout(null, minute).length;
      list.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: (minute + 0.5) * rowHeight - (y - 146) } } });
      const target = cell(minute, date); const touch = { nativeEvent: { pageX: x, pageY: y, touches: [{ pageX: x, pageY: y }] } };
      const parent = () => { const screen = tree.props.children; return [screen.props.children].flat(Infinity).find((node) => node?.props?.onPanResponderGrant)?.props; };
      parent().onStartShouldSetPanResponderCapture(touch); target.props.onPressIn(); target.props.onTouchStart(touch);
      for (const duration of [460, 650]) { now += duration;
        for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
        await settle(); }
      const responder = parent(); const claimed = responder.onMoveShouldSetPanResponderCapture(touch, { dx: 1, dy: 1, numberActiveTouches: 1 });
      if (claimed) responder.onPanResponderGrant(touch);
      await settle(); return { responder, rowHeight, claimed, x, y };
    },
    async flushAnimationFrames() { const pending = [...animationFrames.values()]; animationFrames.clear();
      pending.forEach((callback) => callback()); await settle(); },
    text: (minute, date = day) => find(cell(minute, date), 'Text')?.props.children,
    async refresh() { const pending = find(tree, 'FlatList').props.refreshControl.props.onRefresh(); await settle(); return pending; },
    async navigate(date) { props.activeDate = date; dirty = true; await settle(); },
    async background() { native.AppState.currentState = 'background'; for (const listener of appStateListeners) listener('background'); await settle(); },
    async keyboard(name, event) { for (const listener of keyboardListeners.get(name) ?? []) listener(event); await settle(); },
    input: (minute = 600, date = day) => labelled(tree,
      load(source('utils/time.ts')).formatDayHeading(date) + ', ' + load(source('utils/time.ts')).minuteLabel(minute, true) + ', minute text')?.props,
    bar: (mode) => labelled(tree, mode === 'format' ? 'Minute formatting bar' : 'Minute text entry bar')?.props,
    action: (label) => labelled(tree, label)?.props,
    get systemReads() { return systemReads; }, get systemCopies() { return systemCopies; },
    unmount, get dismisses() { return dismisses; }, set failure(value) { failure = value; },
    set writeGate(value) { writeGate = value; }, advance(ms) { now += ms; }, cell, get tree() { return tree; } };
}

function plan(id, minute, account = false) {
  return { id, calendarId: account ? 'account-calendar' : 'native', title: id,
    startDate: new Date(2026, 9, 25, Math.floor(minute / 60), minute % 60),
    endDate: new Date(2026, 9, 25, Math.floor(minute / 60), minute % 60 + 1),
    ...(account ? { accountEvent: { accountId: 'account', event: {} } } : {}) };
}

test('pencil opens a dated mixed-note range and submits one guarded overnight fill', async (t) => {
  const h = screen(t, { spanOccupied: 2 });
  h.rows.set(`${h.day}:600`, { dateKey: h.day, minuteIndex: 600, text: 'First note', categoryId: 'study', blockId: 'first' });
  h.rows.set(`${h.day}:601`, { dateKey: h.day, minuteIndex: 601, text: 'Another note', categoryId: 'study', blockId: 'second' });
  await h.start(); await h.tap(600); await h.selectThrough(602); h.menu().onEdit(); await h.settle();
  assert.equal(h.details().session.text, undefined);
  assert.equal(h.details().session.span.startMinute, 600); assert.equal(h.details().session.span.endMinute, 603);
  const span = { startDateKey: h.day, startMinute: 1350, endDateKey: '2026-10-26', endMinute: 420 };
  const input = { text: 'Rest', event: { title: 'Rest', categoryId: 'study' } };
  assert.equal(await h.details().onSave(span, input), true); await h.settle();
  assert.equal(h.spanPreviews.length, 1);
  const applied = h.calls.find((call) => call.action === 'span-fill');
  assert.deepEqual(JSON.parse(JSON.stringify(applied)), { action: 'span-fill', span, input, previewToken: 'span-preview' });
});

test('pencil preserves full existing cross-day event identity and independent notes', async (t) => {
  const group = { dateKey: '2026-10-25', blockId: 'activity_existing', title: 'Rest', categoryId: 'study', startMinute: 1439, endMinute: 1439 };
  const h = screen(t, { readGroups: async (day) => day === group.dateKey ? [group] : [] });
  h.rows.set(`${h.day}:1439`, { dateKey: h.day, minuteIndex: 1439, text: 'Before midnight', categoryId: 'study', blockId: group.blockId });
  h.rows.set('2026-10-26:0', { dateKey: '2026-10-26', minuteIndex: 0, text: 'After midnight', categoryId: 'study', blockId: group.blockId });
  await h.start(); await h.tap(1439); h.action('Edit selected minutes and time range').onPress(); await h.settle();
  assert.equal(h.details().session.event.blockId, group.blockId);
  assert.equal(h.details().session.span.endDateKey, '2026-10-26'); assert.equal(h.details().session.span.endMinute, 1);
  assert.equal(h.details().session.text, undefined, 'mixed notes stay separate from the event title');
});

test('navigation during a pencil preview prevents the old range from committing', async (t) => {
  let release; const gate = new Promise((resolve) => { release = resolve; }); const h = screen(t, { prepareSpanGate: gate });
  await h.start(); await h.tap(600); h.action('Edit selected minutes and time range').onPress(); await h.settle();
  const saving = h.details().onSave({ ...h.details().session.span }, { text: 'Old intent' }); await h.settle();
  assert.equal(h.spanPreviews.length, 1); await h.navigate('2026-10-26'); release(); assert.equal(await saving, false); await h.settle();
  assert.equal(h.calls.some((call) => call.action === 'span-fill'), false); assert.equal(h.details().session, null);
});

test('canceling occupied pencil replacement preserves the form and performs no write', async (t) => {
  const h = screen(t, { spanOccupied: 1, confirmReplace: false }); await h.start(); await h.tap(600);
  h.action('Edit selected minutes and time range').onPress(); await h.settle(); const id = h.details().session.id;
  assert.equal(await h.details().onSave(h.details().session.span, { text: 'Replacement' }), false); await h.settle();
  assert.equal(h.calls.some((call) => call.action === 'span-fill'), false); assert.equal(h.details().session.id, id);
});

test('full-day compact Week keeps seven fixed columns and pencil opens the touched minute', async (t) => {
  const h = screen(t, { props: { dayCount: 7, zoom: 500 / (1440 * 34) } }); await h.start();
  assert.ok(h.overview()); assert.equal(h.overview().days.length, 7); assert.ok(h.overview().rowHeight < 1);
  assert.ok(Math.abs(7 * h.overview().dayWidth + h.overview().railWidth - 390) < 0.000001);
  h.overview().onSelect(h.day, 1375); await h.settle(); h.action('Edit selected minutes and time range').onPress(); await h.settle();
  assert.equal(h.details().session.span.startDateKey, h.day); assert.equal(h.details().session.span.startMinute, 1375);
});

test('an existing link warning reports pending during account work and retry only after that work stops', async (t) => {
  let update; let warning;
  const h = screen(t, { subscribeLinkWarnings(listener) { update = listener; return () => {}; },
    props: { onSyncWarningChange(value) { warning = value; } } });
  await h.start(); update(true, true); await h.settle();
  assert.match(warning, /saved on this phone.*linking is pending/); assert.equal(warning.includes('needs a retry'), false);
  update(true, false); await h.settle(); assert.match(warning, /needs a retry/);
  update(false, false); await h.settle(); assert.equal(warning, null);
});

test('a calendar event has one titled border while its minute editors start with independent blank notes', async (t) => {
  const event = { ...plan('Appointment', 530), endDate: new Date(2026, 9, 25, 10, 20), color: '#F4511E' };
  const h = screen(t, { readNative: async () => ({ plans: [event], failures: [] }) });
  await h.start();
  assert.equal(h.text(530), ''); assert.equal(h.text(531), '');
  assert.ok(h.cell(530).props.accessibilityLabel.includes('Appointment'));
  const textNodes = (node) => !node || typeof node !== 'object' ? [] : [
    ...(node.type === 'Text' ? [node.props.children] : []), ...[node.props?.children].flat(Infinity).flatMap(textNodes)];
  assert.equal(textNodes(h.cell(530)).filter((text) => text === 'Appointment').length, 1);
  assert.equal(textNodes(h.cell(531)).filter((text) => text === 'Appointment').length, 0);
  await h.tap(531); assert.equal(h.input(531).value, '');
  h.input(531).onChangeText('Find parking'); await h.settle();
  assert.equal(h.text(531), 'Find parking'); assert.equal(h.text(530), '');
});

test('the bottom border button names even one blank minute without copying the title into its note', async (t) => {
  const h = screen(t, { colors: [{ id: 'family', name: 'Tangerine', color: '#F4511E' }] });
  await h.start(); await h.tap(600); h.action('Save minute text and show formatting').onPress(); await h.settle();
  h.action('Apply event border').onPress(); await h.settle();
  h.action('Activity title for selected minutes').onChangeText('Appointment'); await h.settle();
  h.action('Choose group fill color').onPress(); await h.settle(); h.palette().onCellColor('family'); await h.settle();
  h.action('Create group from selected minutes').onPress(); await h.settle();
  assert.equal(h.calls.at(-1).action, 'group'); assert.equal(h.calls.at(-1).title, 'Appointment');
  assert.equal(h.calls.at(-1).startMinute, 600); assert.equal(h.calls.at(-1).endMinute, 600);
  assert.equal(h.text(600), '');
});

test('Reset cells executes on one tap for a text-free colored cell while Clear remains text-only', async (t) => {
  const h = screen(t); h.rows.set(`${h.day}:600`, { dateKey: h.day, minuteIndex: 600, text: '', categoryId: 'family', blockId: 'note' });
  await h.start(); await h.hold(600);
  assert.equal(h.menu().onClear, undefined); assert.equal(typeof h.menu().onReset, 'function');
  h.menu().onReset(); await h.settle();
  assert.equal(h.calls.filter((call) => call.action === 'reset-cells').length, 1);
  assert.equal(h.rows.has(`${h.day}:600`), false); assert.equal(h.text(600), '');
});

test('calendar source failures report to Sync without an inline banner and clear on recovery and unmount', async (t) => {
  let nativeFailed = true, accountFailed = true; const warnings = [];
  const h = screen(t, {
    props: { preferences: { selectedCalendarIds: ['native'], syncActuals: false },
      onSyncWarningChange: (message) => warnings.push(message) },
    readNative: async () => ({ plans: [], failures: nativeFailed ? [{ calendarId: 'native', code: 'ERR_CALENDAR_UNAVAILABLE' }] : [] }),
    readAccount: async () => ({ plans: [], failures: accountFailed ? [{ accountId: 'google:person', code: 'unavailable' }] : [], fromCache: false }),
  });
  h.rows.set(`${h.day}:600`, { dateKey: h.day, minuteIndex: 600, text: 'Saved minute remains visible', categoryId: 'study', blockId: 'saved' });
  await h.start();
  assert.match(warnings.at(-1), /Phone-calendar events could not refresh/);
  assert.match(warnings.at(-1), /Account-calendar events could not refresh/);
  const allText = (node) => !node || typeof node !== 'object' ? '' :
    [typeof node.props?.children === 'string' ? node.props.children : '',
      ...[node.props?.children].flat(Infinity).filter((child) => child && typeof child === 'object').map(allText)].join(' ');
  assert.doesNotMatch(allText(h.tree), /Some calendar plans could not load|Pull down to retry|Phone-calendar events could not refresh|Account-calendar events could not refresh/);
  assert.equal(h.text(600), 'Saved minute remains visible');
  nativeFailed = false; await h.refresh(); await h.settle();
  assert.match(warnings.at(-1), /Account-calendar events could not refresh/);
  assert.doesNotMatch(warnings.at(-1), /Phone-calendar events could not refresh/);
  accountFailed = false; await h.refresh(); await h.settle(); assert.equal(warnings.at(-1), null);
  accountFailed = true; await h.refresh(); await h.settle(); assert.ok(warnings.at(-1));
  h.unmount(); assert.equal(warnings.at(-1), null);
});

test('a blank colored cell exposes fill Reset while a plain blank keeps only clipboard actions', async (t) => {
  const colored = screen(t); colored.rows.set(`${colored.day}:600`, { dateKey: colored.day, minuteIndex: 600,
    text: '', categoryId: 'family', blockId: 'colored' });
  await colored.start(); await colored.hold(600);
  assert.equal(colored.menu().onCellColor, undefined); assert.equal(colored.menu().onResetCellColor, undefined);
  assert.equal(colored.menu().onClear, undefined); colored.menu().onClose(); await colored.settle();
  colored.action('Save minute text and show formatting').onPress(); await colored.settle();
  colored.action('Choose cell color').onPress(); await colored.settle(); colored.palette().onResetCellColor(); await colored.settle();
  assert.deepEqual(colored.calls.map((call) => [call.action, call.startMinute, call.endMinute]), [['reset-fill', 600, 600]]);
  const blank = screen(t); await blank.start(); await blank.hold(600);
  assert.equal(blank.menu().onCellColor, undefined); assert.equal(blank.menu().onResetCellColor, undefined);
  assert.equal(typeof blank.menu().onCut, 'function'); assert.equal(typeof blank.menu().onCopy, 'function');
  assert.equal(typeof blank.menu().onPaste, 'function');
});

test('saved notes and cached plans paint while both live providers remain pending', async (t) => {
  const never = new Promise(() => {}); let nativeReads = 0; let accountReads = 0;
  const r = screen(t, { readNative: () => { nativeReads++; return never; },
    readAccount: () => { accountReads++; return never; }, readCached: async () => [plan('Cached event', 601, true)] });
  r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Saved offline note', categoryId: 'work', blockId: 'note' });
  await r.start();
  assert.ok(nativeReads && accountReads, 'the live reads really started and remain unresolved');
  assert.equal(r.text(600), 'Saved offline note'); assert.equal(r.text(601), '');
  assert.ok(r.cell(601).props.accessibilityLabel.includes('Cached event'));
  await r.refresh(); assert.equal(r.text(600), 'Saved offline note', 'foreground refresh also finishes without those providers');
});

test('notes do not wait for local formatting/group reads or another displayed date', async (t) => {
  const never = new Promise(() => {}); const day = '2026-10-25';
  const r = screen(t, { props: { dayCount: 3 }, readFormats: () => never, readGroups: () => never,
    readEntries: (date) => date === '2026-10-26' ? never : Promise.resolve([{ dateKey: date, minuteIndex: 600,
      text: date === day ? 'First day saved' : 'Third day saved', categoryId: 'work', blockId: 'note' }]) });
  await r.start();
  assert.equal(r.text(600), 'First day saved'); assert.equal(r.text(600, '2026-10-27'), 'Third day saved');
});

test('native plans display before slow color reconciliation without hiding saved text', async (t) => {
  const never = new Promise(() => {}); let colorReads = 0;
  const r = screen(t, { readNative: async () => ({ plans: [plan('Native event', 601)], failures: [] }),
    reconcileColors: () => { colorReads++; return never; } });
  r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Local text', categoryId: 'work', blockId: 'note' });
  await r.start(); assert.ok(colorReads); assert.equal(r.text(600), 'Local text'); assert.equal(r.text(601), '');
  assert.ok(r.cell(601).props.accessibilityLabel.includes('Native event'));
});

test('offline refresh retains known calendar plans and current local notes', async (t) => {
  let offline = false; const cached = plan('Account cached', 602, true);
  const r = screen(t, { props: { preferences: { selectedCalendarIds: ['native'], syncActuals: false } },
    readCached: async () => [cached],
    readNative: async () => offline ? { plans: [], failures: [{ calendarId: 'native', code: 'offline' }] }
      : { plans: [plan('Native cached', 601)], failures: [] },
    readAccount: async () => ({ plans: [cached], failures: offline ? [{ accountId: 'account', code: 'timeout' }] : [], fromCache: offline }) });
  r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Local text', categoryId: 'work', blockId: 'note' });
  await r.start(); offline = true; await r.refresh(); await r.settle();
  assert.equal(r.text(600), 'Local text'); assert.equal(r.text(601), ''); assert.equal(r.text(602), '');
  assert.ok(r.cell(601).props.accessibilityLabel.includes('Native cached'));
  assert.ok(r.cell(602).props.accessibilityLabel.includes('Account cached'));
});

test('Basil source color stays stable when native and account refreshes finish in different orders', async (t) => {
  let finishNative; let finishAccount;
  const nativePlan = { ...plan('Pray', 629), color: '#0B8043' };
  const accountPlan = { ...plan('Pray', 629, true), color: '#51B749' };
  const r = screen(t, { props: { preferences: { selectedCalendarIds: ['native'], syncActuals: false } },
    readCached: async () => [accountPlan],
    readNative: () => new Promise((done) => { finishNative = done; }),
    readAccount: () => new Promise((done) => { finishAccount = done; }) });
  const fill = () => r.cell(629).props.children[0].props.style.filter(Boolean)
    .filter((style) => style.backgroundColor).at(-1)?.backgroundColor;
  await r.start(); assert.equal(r.text(629), ''); assert.ok(r.cell(629).props.accessibilityLabel.includes('Pray')); assert.equal(fill(), '#51B749');
  finishNative({ plans: [nativePlan], failures: [] }); await r.settle();
  assert.equal(fill(), '#51B749');
  finishAccount({ plans: [accountPlan], failures: [], fromCache: false }); await r.settle();
  assert.equal(fill(), '#51B749'); assert.equal(r.text(629), ''); assert.ok(r.cell(629).props.accessibilityLabel.includes('Pray'));
  await r.refresh();
  finishAccount({ plans: [accountPlan], failures: [], fromCache: false }); await r.settle();
  finishNative({ plans: [nativePlan], failures: [] }); await r.settle();
  assert.equal(fill(), '#51B749'); assert.equal(r.text(629), ''); assert.ok(r.cell(629).props.accessibilityLabel.includes('Pray'));
});

test('late provider and color reloads cannot replace a newer inline edit', async (t) => {
  let resolve; const native = new Promise((done) => { resolve = done; });
  const r = screen(t, { readNative: () => native, reconcileColors: async () => ['2026-10-25'] });
  r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Original', categoryId: 'work', blockId: 'note' });
  await r.start(); await r.tap(600); await r.tap(600); r.input().onChangeText('Latest offline edit'); await r.settle();
  resolve({ plans: [plan('Old remote title', 600)], failures: [] }); await r.settle();
  assert.equal(r.input().value, 'Latest offline edit'); r.input().onSubmitEditing(); await r.settle();
  assert.equal(r.text(600), 'Latest offline edit');
});

test('revoked native access removes cached plans while keeping saved local notes', async (t) => {
  for (const throws of [false, true]) {
    let revoked = false;
    const r = screen(t, { props: { preferences: { selectedCalendarIds: ['native'], syncActuals: false } },
      readNative: async () => {
        if (!revoked) return { plans: [plan('Private native plan', 601)], failures: [] };
        if (throws) throw { code: 'ERR_CALENDAR_PERMISSION_DENIED' };
        return { plans: [], failures: [{ calendarId: 'native', code: 'ERR_MISSING_CALENDAR_PERMISSION' }] };
      } });
    r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Local note kept', categoryId: 'work', blockId: 'note' });
    await r.start(); assert.equal(r.text(601), ''); assert.ok(r.cell(601).props.accessibilityLabel.includes('Private native plan')); revoked = true;
    await r.refresh(); await r.settle();
    assert.ok(!r.cell(601).props.accessibilityLabel.includes('Private native plan')); assert.equal(r.text(600), 'Local note kept');
  }
});

test('a delayed previous date provider cannot paint into the newly selected date', async (t) => {
  let resolve; let oldColors = 0; const old = new Promise((done) => { resolve = done; });
  const r = screen(t, { readNative: (_ids, day) => day === '2026-10-25' ? old : Promise.resolve({ plans: [], failures: [] }),
    reconcileColors: async (day) => { if (day === '2026-10-25') oldColors++; return []; } });
  r.rows.set('2026-10-26:600', { dateKey: '2026-10-26', minuteIndex: 600, text: 'New day note', categoryId: 'work', blockId: 'note' });
  await r.start(); await r.navigate('2026-10-26'); resolve({ plans: [plan('Previous day event', 600)], failures: [] }); await r.settle();
  assert.equal(r.text(600, '2026-10-26'), 'New day note'); assert.equal(oldColors, 0);
});

test('an external clipboard Paste is available without reading the clipboard until explicitly pressed and fills the selected range', async (t) => {
  const r = screen(t, { readPasteSource: async () => ({ kind: 'external', text: 'Copied from Sheets' }) });
  await r.start(); assert.equal(r.systemReads, 0);
  await r.tap(600); await r.selectThrough(603); assert.ok(r.menu());
  assert.equal(r.menu().canPaste, true, 'external Paste cannot depend on an internal Context clipboard');
  assert.equal(r.systemReads, 0, 'opening/selecting a menu never reads another app’s clipboard');
  r.menu().onPaste(); await r.settle();
  assert.equal(r.systemReads, 1);
  assert.deepEqual(r.externalPreviews, [{ text: 'Copied from Sheets', dateKey: r.day, startMinute: 600, endMinute: 603 }]);
  const applied = r.calls.find((call) => call.action === 'paste-external');
  assert.equal(applied.text, 'Copied from Sheets'); assert.equal(applied.startMinute, 600); assert.equal(applied.endMinute, 603);
  assert.equal(applied.previewToken, 'external-preview'); assert.equal(r.pastePreviews.length, 0);
});

test('a two-by-two external matrix confirms and refreshes every prepared date without replacing the Context clipboard', async (t) => {
  const day = '2026-10-25', tomorrow = '2026-10-26'; const text = 'A\tB\nC\tD';
  const externalRows = [[day, 600, 'A'], [tomorrow, 600, 'B'], [day, 601, 'C'], [tomorrow, 601, 'D']]
    .map(([dateKey, minuteIndex, value]) => ({ dateKey, minuteIndex, text: value, categoryId: 'work', blockId: 'new' }));
  const r = screen(t, { props: { dayCount: 3 }, readPasteSource: async () => ({ kind: 'external', text }), externalRows,
    externalPreview: { token: 'matrix-preview', rows: 2, columns: 2, occupiedCount: 2,
      ranges: [{ dateKey: day, startMinute: 600, endMinute: 601 }, { dateKey: tomorrow, startMinute: 600, endMinute: 601 }] } });
  await r.start(); await r.hold(600); r.menu().onPaste(); await r.settle();
  assert.equal(r.alerts.length, 1); assert.match(r.alerts[0].text, /2/);
  const applied = r.calls.find((call) => call.action === 'paste-external');
  assert.equal(applied.text, text); assert.equal(applied.previewToken, 'matrix-preview');
  assert.equal(r.text(600, day), 'A'); assert.equal(r.text(601, day), 'C');
  assert.equal(r.text(600, tomorrow), 'B'); assert.equal(r.text(601, tomorrow), 'D');
  assert.equal(r.menu(), undefined, 'successful multi-date acknowledgement closes the selected-cell menu');
});

test('canceling the external overwrite review keeps the selected cells and never applies clipboard text', async (t) => {
  const r = screen(t, { confirmReplace: false, readPasteSource: async () => ({ kind: 'external', text: 'New external value' }),
    externalPreview: { token: 'occupied-preview', rows: 1, columns: 1, occupiedCount: 1,
      ranges: [{ dateKey: '2026-10-25', startMinute: 600, endMinute: 600 }] } });
  r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Keep original', categoryId: 'family', blockId: 'note' });
  await r.start(); await r.hold(600); r.menu().onPaste(); await r.settle();
  assert.equal(r.alerts.length, 1); assert.equal(r.calls.some((call) => call.action === 'paste-external'), false);
  assert.equal(r.rows.get(`${r.day}:600`).text, 'Keep original'); assert.ok(r.menu()); assert.equal(r.menu().busy, false);
});

test('empty, denied and invalid external clipboard reads keep an actionable menu and every saved cell', async (t) => {
  for (const failure of ['empty', 'denied', 'prepare-external']) {
    const r = screen(t, { readPasteSource: async () => {
      if (failure === 'empty') throw Error('Copy some text before pasting.');
      if (failure === 'denied') throw Error('The device clipboard could not be read. Try again.');
      return { kind: 'external', text: 'An invalid oversized matrix' };
    } });
    r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Keep saved note', categoryId: 'family', blockId: 'note' });
    await r.start(); await r.hold(600); if (failure === 'prepare-external') r.failure = failure;
    r.menu().onPaste(); await r.settle();
    assert.ok(r.menu(), failure); assert.equal(r.menu().busy, false);
    assert.match(r.menu().error, /Copy some text|clipboard could not be read|could not be prepared/);
    assert.equal(r.rows.get(`${r.day}:600`).text, 'Keep saved note');
    assert.equal(r.calls.some((call) => call.action === 'paste-external'), false);
  }
});

test('navigation during an external clipboard read cannot prepare or paste into the abandoned date', async (t) => {
  let resolve; const pending = new Promise((done) => { resolve = done; });
  const r = screen(t, { readPasteSource: () => pending });
  await r.start(); await r.hold(600); r.menu().onPaste(); await r.settle();
  assert.equal(r.systemReads, 1); await r.navigate('2026-10-26');
  resolve({ kind: 'external', text: 'Old destination text' }); await r.settle();
  assert.equal(r.externalPreviews.length, 0); assert.equal(r.calls.some((call) => call.action === 'paste-external'), false);
  assert.equal(r.rows.size, 0);
});

test('navigation during external preview prevents a later overwrite review or paste', async (t) => {
  let resolve; const pending = new Promise((done) => { resolve = done; });
  const r = screen(t, { readPasteSource: async () => ({ kind: 'external', text: 'External text' }), externalPreview: pending });
  await r.start(); await r.hold(600); r.menu().onPaste(); await r.settle();
  assert.equal(r.externalPreviews.length, 1); await r.navigate('2026-10-26');
  resolve({ token: 'late-preview', rows: 1, columns: 1, occupiedCount: 1,
    ranges: [{ dateKey: '2026-10-25', startMinute: 600, endMinute: 600 }] }); await r.settle();
  assert.equal(r.alerts.length, 0); assert.equal(r.calls.some((call) => call.action === 'paste-external'), false);
});

test('backgrounding during an external clipboard read dismisses the old selection and prevents its pending paste', async (t) => {
  let resolve; const pending = new Promise((done) => { resolve = done; });
  const r = screen(t, { readPasteSource: () => pending });
  r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Keep saved value', categoryId: 'family', blockId: 'note' });
  await r.start(); await r.hold(600); r.menu().onPaste(); await r.settle();
  await r.background(); resolve({ kind: 'external', text: 'Late clipboard value' }); await r.settle();
  assert.equal(r.externalPreviews.length, 0); assert.equal(r.calls.some((call) => call.action === 'paste-external'), false);
  assert.equal(r.menu(), undefined); assert.equal(r.rows.get(`${r.day}:600`).text, 'Keep saved value');
});

test('an explicitly chosen fresh external source takes the external path even while a Context copy remains available', async (t) => {
  const r = screen(t, { readPasteSource: async () => ({ kind: 'external', text: 'Fresh spreadsheet text' }) });
  r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Old Context snapshot', categoryId: 'work', blockId: 'note' });
  await r.start(); await r.hold(600); r.menu().onCopy(); await r.settle();
  assert.equal(r.systemCopies, 1); assert.equal(r.systemReads, 0);
  await r.hold(601); r.menu().onPaste(); await r.settle();
  assert.equal(r.calls.some((call) => call.action === 'paste'), false);
  assert.equal(r.calls.find((call) => call.action === 'paste-external').text, 'Fresh spreadsheet text');
  assert.equal(r.rows.get(`${r.day}:600`).text, 'Old Context snapshot');
});

test('a held recorded cell dispatches whole-cell Copy, then a held destination dispatches Paste', async (t) => {
  const r = screen(t); r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Read Context answer', categoryId: 'work', blockId: 'note' });
  await r.start(); await r.hold(600); assert.ok(r.menu()); await r.menu().onCopy(); await r.settle();
  assert.equal(r.calls[0].action, 'copy'); assert.equal(r.calls[0].startMinute, 600); assert.equal(r.menu(), undefined);
  await r.tap(601); await r.hold(601); assert.equal(r.menu().canPaste, true); await r.menu().onPaste(); await r.settle();
  assert.equal(r.calls[1].action, 'paste'); assert.equal(r.calls[1].startMinute, 601); assert.equal(r.rows.get(`${r.day}:601`).text, 'Read Context answer');
  assert.equal(r.rows.get(`${r.day}:601`).categoryId, 'work'); assert.equal(r.rows.get(`${r.day}:600`).text, 'Read Context answer');
  assert.equal(r.systemCopies, 1); assert.equal(r.systemReads, 1); assert.equal(r.externalPreviews.length, 0);
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

test('the sibling menu centers using measured width and defers horizontal resizing until the native release completes', async (t) => {
  const r = screen(t); await r.start(); r.measureViewport(); await r.hold(600);
  r.menu().onWidthChange(170); await r.settle();
  assert.deepEqual(r.menuBox(), { width: 170, left: 110 });
  assert.equal(r.menu().width, 170); assert.equal(r.menu().maxWidth, 374);
  r.menu().onTouchActiveChange(true); r.menu().onWidthChange(300); await r.settle();
  assert.deepEqual(r.menuBox(), { width: 170, left: 110 });
  r.menu().onTouchActiveChange(false); await r.settle();
  assert.deepEqual(r.menuBox(), { width: 170, left: 110 }, 'release must reach the original Pressable before its bounds change');
  await r.flushAnimationFrames(); assert.deepEqual(r.menuBox(), { width: 300, left: 45 });
});

test('a pending command retains the measured menu width until acknowledgement, then applies deferred layout on a retryable error', async (t) => {
  const r = screen(t); r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Original', categoryId: 'work', blockId: 'note' });
  await r.start(); r.measureViewport(); await r.hold(600); r.menu().onWidthChange(170); await r.settle();
  r.drafts.edit(r.day, 600, { text: 'Latest note' }); let release;
  r.writeGate = new Promise((resolve) => { release = resolve; }); r.failure = 'copy';
  r.menu().onCopy(); await r.settle(); assert.equal(r.menu().busy, true);
  r.menu().onWidthChange(300); await r.settle(); assert.deepEqual(r.menuBox(), { width: 170, left: 110 });
  release(); r.writeGate = null; await r.settle();
  assert.match(r.menu().error, /copy failed/); assert.deepEqual(r.menuBox(), { width: 300, left: 45 });
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
  assert.ok(r.input(601), 'an outside cell opens its bottom entry bar directly');
  assert.equal(r.input(601).autoFocus, undefined, 'selection does not focus its keyboard');
});

test('late native geometry callbacks cannot replace a newer root/body menu anchor', async (t) => {
  const r = screen(t); await r.start(); await r.hold(600); r.menu().onHeightChange(100);
  const before = r.menuPosition();
  const old = r.measureViewport({ rootY: 80, bodyY: 146, defer: true });
  const latest = r.measureViewport({ rootY: 80, bodyY: 180, defer: true });
  latest.forEach((complete) => complete()); assert.equal(r.menuPosition(), before + 100);
  old.forEach((complete) => complete()); assert.equal(r.menuPosition(), before + 100);
});

test('single taps show the unfocused bottom entry bar, double tap edits, and Save waits for current typing before formatting', async (t) => {
  const r = screen(t); r.rows.set(`${r.day}:600`, { dateKey: r.day, minuteIndex: 600, text: 'Original', categoryId: 'work', blockId: 'note' });
  await r.start(); await r.tap(600); assert.equal(r.input().value, 'Original');
  assert.equal(r.input().autoFocus, undefined); assert.ok(r.bar('entry'));
  let focusRequests = 0; r.input().ref.current = { focus() { focusRequests++; } };
  await r.flushAnimationFrames(); assert.equal(focusRequests, 0);
  r.advance(500); await r.tap(600); await r.flushAnimationFrames(); assert.equal(focusRequests, 0);
  await r.tap(600); assert.equal(r.input().value, 'Original'); r.input().onChangeText('First edit'); await r.settle();
  await r.flushAnimationFrames(); assert.equal(focusRequests, 1);
  assert.equal(r.text(600), 'First edit', 'the saved-cell display mirrors raw bottom-input text before SQLite acknowledgement');
  let release; r.writeGate = new Promise((resolve) => { release = resolve; }); const previousDismisses = r.dismisses;
  r.input().onSubmitEditing(); await r.settle(); assert.ok(r.input()); assert.equal(r.dismisses, previousDismisses);
  r.input().onChangeText('Latest edit while saving'); await r.settle(); release(); r.writeGate = null; await r.settle();
  assert.equal(r.rows.get(`${r.day}:600`).text, 'Latest edit while saving'); assert.equal(r.input(), undefined);
  assert.ok(r.bar('format')); r.action('Finish formatting').onPress(); await r.settle(); assert.equal(r.bar('format'), undefined);
  assert.ok(r.dismisses > previousDismisses); assert.equal(r.cell(600).props.accessibilityState.selected, true);
});

test('an untouched blank advances through both bottom checks without recording a minute, opening a popup, or clearing selection', async (t) => {
  const h = screen(t); await h.start(); await h.tap(600);
  assert.equal(h.input().value, ''); assert.equal(h.input().maxLength, 50000); assert.equal(h.input().autoFocus, undefined);
  assert.equal(h.cell(600).props.children.some((child) => child?.type === 'TextInput'), false, 'grid cells never become editors');
  h.action('Save minute text and show formatting').onPress(); await h.settle();
  assert.equal(h.rows.size, 0); assert.equal(h.input(), undefined); assert.ok(h.bar('format')); assert.equal(h.menu(), undefined);
  assert.ok(h.action('Bold')); assert.ok(h.action('Italic')); assert.ok(h.action('Underline'));
  assert.ok(h.action('Choose text color')); assert.ok(h.action('Choose cell color'));
  h.action('Finish formatting').onPress(); await h.settle();
  assert.equal(h.bar('format'), undefined); assert.equal(h.bar('entry'), undefined); assert.equal(h.rows.size, 0);
  assert.equal(h.cell(600).props.accessibilityState.selected, true);
  await h.tap(600); assert.ok(h.bar('entry'), 'a subsequent selection opens entry again');
});

test('format actions stay in the saved bottom bar while held Group uses the existing inline composer', async (t) => {
  const h = screen(t, { colors: [{ id: 'family', name: 'Basil', color: '#0B8043' }] }); h.rows.set(`${h.day}:600`, { dateKey: h.day, minuteIndex: 600,
    text: 'Read Codex', categoryId: 'study', blockId: 'note' });
  await h.start(); await h.tap(600); await h.selectThrough(602); assert.ok(h.menu());
  for (const key of ['onToggleBold', 'onToggleItalic', 'onToggleUnderline', 'onTextColor', 'onCellColor', 'onResetCellColor', 'onEvent'])
    assert.equal(h.menu()[key], undefined, `${key} is absent from the held clipboard popup`);
  assert.equal(typeof h.menu().onAutoFill, 'function'); assert.equal(typeof h.menu().onGroup, 'function');
  h.action('Save minute text and show formatting').onPress(); await h.settle();
  h.action('Bold').onPress(); await h.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))), { action: 'format', dateKey: h.day, startMinute: 600, endMinute: 602, patch: { bold: true } });
  h.action('Choose text color').onPress(); await h.settle(); h.palette().onTextColor('#123456'); await h.settle();
  assert.equal(h.calls.at(-1).patch.textColor, '#123456'); assert.ok(h.bar('format'));
  await h.hold(600); h.menu().onGroup(); await h.settle();
  assert.ok(h.action('Activity title for selected minutes'), 'Group retains its explicit inline title form');
  assert.equal(h.bar('format'), undefined, 'the existing group composer replaces the bar while naming an activity');
  h.action('Cancel grouping').onPress(); await h.settle(); assert.ok(h.bar('format'));
  assert.equal(h.menu(), undefined, 'canceling a deliberate fill-panel action does not open a held-cell popup');
  await h.hold(600); h.menu().onGroup(); await h.settle();
  h.action('Activity title for selected minutes').onChangeText('Reading'); await h.settle();
  h.action('Choose group fill color').onPress(); await h.settle(); h.palette().onCellColor('family'); await h.settle();
  assert.equal(h.action('Create group from selected minutes').disabled, false);
  h.action('Create group from selected minutes').onPress(); await h.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))), { action: 'group', dateKey: h.day, startMinute: 600, endMinute: 602, title: 'Reading', categoryId: 'family' });
  assert.ok(h.bar('format'));
});

test('source Event stays in the fill panel and held Ungroup retains its existing selected-cell route', async (t) => {
  const group = { dateKey: '2026-10-25', blockId: 'activity_group', title: 'Coffee', categoryId: 'family', startMinute: 600, endMinute: 601 };
  const h = screen(t, { readGroups: async () => [group], readNative: async () => ({ plans: [plan('Source event', 600)], failures: [] }) });
  h.rows.set(`${h.day}:600`, { dateKey: h.day, minuteIndex: 600, text: 'Boil water', categoryId: 'family', blockId: group.blockId });
  await h.start(); await h.tap(600); h.action('Save minute text and show formatting').onPress(); await h.settle();
  h.action('Choose cell color').onPress(); await h.settle();
  assert.ok(h.action('Open source calendar event details'));
  await h.hold(600); assert.equal(typeof h.menu().onUngroup, 'function'); h.menu().onUngroup(); await h.settle();
  assert.equal(h.calls.at(-1).action, 'ungroup'); assert.equal(h.calls.at(-1).startMinute, 600);
});

test('a failed keyboard Save preserves the typed value and editing for retry', async (t) => {
  const r = screen(t); await r.start(); await r.tap(600); await r.tap(600);
  r.input().onChangeText('An unsaved thought'); await r.settle(); r.failure = 'save';
  const previousDismisses = r.dismisses; r.input().onSubmitEditing(); await r.settle();
  assert.equal(r.input().value, 'An unsaved thought'); assert.equal(r.dismisses, previousDismisses);
  assert.equal(r.drafts.get(r.day, 600).error, true);
  await r.hold(600); assert.equal(r.menu(), undefined, 'a failed draft blocks whole-cell actions without discarding the entry bar');
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
  assert.equal(r.input().onTouchStart, undefined, 'the native input is outside the grid hold responder');
  assert.ok(r.input(), 'holding edited text must leave the native editor and its selection handles mounted');
  assert.equal(r.menu(), undefined, 'native word selection does not invoke grid actions');
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
  assert.equal(r.systemReads, 0, 'native partial text Paste stays inside the input and does not inspect the whole-cell clipboard');
  await r.hold(600); assert.ok(r.menu(), 'whole-cell actions remain available after editing closes');
});
