const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Render the actual screens and invoke their native layout/list callbacks. This
// proves requested positions and selected dates, not physical scrolling on a phone.
function screenHarness(t, kind, options = {}) {
  const sourceRoot = path.join(__dirname, '../src');
  const slots = [], effects = [], timers = new Map(), modules = new Map();
  const calls = [], reads = [], opened = [], pendingReads = new Map();
  let hook = 0, dirty = false, tree, timerId = 0, now = 0;
  let dimensions = { width: 390, height: 844, fontScale: 1 };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef(value) { const i = hook++; return slots[i] ??= { current: value }; },
    useState(initial) { const i = hook++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (next) => { const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useMemo(work, dependencies) { const i = hook++;
      if (!slots[i] || !same(slots[i].dependencies, dependencies)) slots[i] = { value: work(), dependencies };
      return slots[i].value; },
    useEffect(work, dependencies) { const i = hook++;
      if (!slots[i] || !same(slots[i].dependencies, dependencies)) {
        const old = slots[i]; slots[i] = { dependencies, cleanup: old?.cleanup };
        effects.push(() => { old?.cleanup?.(); slots[i].cleanup = work(); });
      } },
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [2026, 9, 25, 12, 34])); }
    static now() { return now; }
  }
  const listHandle = { scrollToIndex(value) { calls.push({ method: 'index', ...value }); },
    scrollToOffset(value) { calls.push({ method: 'offset', ...value }); } };
  const scrollHandle = { scrollTo(value) { calls.push({ method: 'scroll', ...value }); } };
  const element = (type, props, key) => {
    if (props?.ref && type === 'FlatList') props.ref.current = listHandle;
    if (props?.ref && type === 'ScrollView') props.ref.current = scrollHandle;
    return { type, props: props ?? {}, key };
  };
  const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', FlatList: 'FlatList', ScrollView: 'ScrollView',
    ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (value) => value, hairlineWidth: 0.5 },
    useWindowDimensions: () => dimensions,
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } };
  const resolvedSource = (relative) => path.join(sourceRoot, relative);
  function readSegments(day) {
    reads.push(day);
    if (!options.gatedReads) return Promise.resolve([]);
    return new Promise((resolve) => pendingReads.set(day, resolve));
  }
  function load(filename) {
    filename = path.normalize(filename);
    if (modules.has(filename)) return modules.get(filename);
    const module = { exports: {} }; modules.set(filename, module.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInContext(code, vm.createContext({ module, exports: module.exports, Date: ClockDate, console,
      setTimeout(callback, delay = 0) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
      clearTimeout(id) { timers.delete(id); }, setInterval() { return ++timerId; }, clearInterval() {},
      require(name) {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
        if (name === 'react-native') return native;
        const resolved = path.resolve(path.dirname(filename), name);
        if (resolved === resolvedSource('appearance')) return { useAppTheme: () => ({ colors: {} }) };
        if (resolved === resolvedSource('components/InfoButton')) return { InfoButton: 'InfoButton' };
        if (resolved === resolvedSource('data/database')) return { getDaySegments: readSegments };
        if (resolved === resolvedSource('services/calendar')) return { loadPlannedEventsResult: async (_ids, day) => ({
          plans: options.plans?.(day) ?? [], failures: [],
        }) };
        if (resolved === resolvedSource('sync/engine')) return { loadAccountPlans: async () => [] };
        if (!name.startsWith('.')) throw Error(`Unexpected overview test import: ${name}`);
        return load(fs.existsSync(`${resolved}.ts`) ? `${resolved}.ts` : `${resolved}.tsx`);
      },
    }), { filename });
    modules.set(filename, module.exports); return module.exports;
  }
  const files = { month: ['components/MonthOverview.tsx', 'MonthOverview'],
    year: ['screens/CalendarYearScreen.tsx', 'CalendarYearScreen'],
    schedule: ['screens/CalendarScheduleScreen.tsx', 'CalendarScheduleScreen'] };
  const [file, exportName] = files[kind];
  const Component = load(resolvedSource(file))[exportName];
  const props = { activeDate: '2026-10-25', focusRequest: { dateKey: '2026-10-25', token: 1 },
    selectedDates: kind === 'month' ? Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`) : null,
    calendars: [], preferences: { selectedCalendarIds: [] }, dataVersion: 0, clockFormat: '24h',
    onOpenMinute: (...values) => opened.push(values), onOpenMonth() {}, ...options.props };
  function render() { dirty = false; hook = 0; tree = Component(props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { for (let i = 0; i < 35; i++) { await Promise.resolve(); if (dirty) render(); } }
  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...[node.props?.children].flat(Infinity).filter((child) => child !== undefined).flatMap((child) => nodes(child))];
  }
  function find(type, predicate = () => true, node = tree) { return nodes(node).find((value) => value.type === type && predicate(value)); }
  function advance(ms = 0) { now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } }
  t.after(() => { for (const slot of slots) slot?.cleanup?.(); timers.clear(); });
  render();
  return { props, calls, reads, opened, pendingReads, render, settle, advance, nodes, find,
    list: () => find('FlatList'), get tree() { return tree; },
    setDimensions(value) { dimensions = { ...dimensions, ...value }; dirty = true; render(); },
    setProps(value) { Object.assign(props, value); render(); },
  };
}

test('Month Now selects today and reveals its measured week without loading a whole year', async (t) => {
  const r = screenHarness(t, 'month', { gatedReads: true });
  r.advance();
  assert.deepEqual(r.calls.map((call) => [call.method, call.index, call.viewOffset]), [['index', 0, 0]]);
  const month = r.list().props.renderItem({ item: '2026-10' });
  const selected = r.nodes(month).filter((node) => node.type === 'Pressable' && node.props.accessibilityState?.selected);
  assert.equal(selected.length, 1);
  assert.match(selected[0].props.accessibilityLabel, /October 25/);
  const week = r.nodes(month).find((node) => node.props.onLayout && r.nodes(node).includes(selected[0]));
  assert.ok(week, 'today belongs to a measured week row');
  week.props.onLayout({ nativeEvent: { layout: { y: 642 } } }); r.advance();
  assert.equal(r.calls.at(-1).viewOffset, -642);
  assert.equal(r.calls.at(-1).index, 0);
  week.props.onLayout({ nativeEvent: { layout: { y: 856 } } }); r.advance();
  assert.equal(r.calls.at(-1).viewOffset, -856,
    'cold-loaded events can grow earlier weeks without losing the explicitly focused week');
  selected[0].props.onPress();
  assert.deepEqual(r.opened, [['2026-10-25', 12 * 60 + 34]]);
  assert.equal(r.reads.length, 2, 'month reads stay bounded while the first two local reads are pending');
  r.list().props.onScrollBeginDrag();
  const before = r.calls.length;
  week.props.onLayout({ nativeEvent: { layout: { y: 700 } } }); r.advance(250);
  assert.equal(r.calls.length, before, 'manual scrolling cancels the pending reveal');
});

test('Month ignores a focus request for a day outside the selected dates', (t) => {
  const r = screenHarness(t, 'month', { gatedReads: true,
    props: { focusRequest: { dateKey: '2026-11-25', token: 3 } } });
  r.advance(500);
  assert.equal(r.calls.length, 0);
});

test('Month uses an already measured week when a new Now request arrives after layout', (t) => {
  const r = screenHarness(t, 'month', { gatedReads: true, props: { focusRequest: null } });
  const month = r.list().props.renderItem({ item: '2026-10' });
  const selected = r.nodes(month).find((node) => node.type === 'Pressable' && node.props.accessibilityState?.selected);
  const week = r.nodes(month).find((node) => node.props.onLayout && r.nodes(node).includes(selected));
  week.props.onLayout({ nativeEvent: { layout: { y: 710 } } });
  r.advance(); assert.equal(r.calls.length, 0);
  r.setProps({ focusRequest: { dateKey: '2026-10-25', token: 8 } }); r.advance();
  assert.deepEqual(r.calls.map((call) => [call.index, call.viewOffset]), [[0, -710]]);
  r.setProps({ focusRequest: { dateKey: '2026-10-25', token: 9 } }); r.advance();
  assert.equal(r.calls.length, 2, 'a second Now action on the same date still executes');
  assert.equal(r.calls.at(-1).viewOffset, -710);
});

test('Year Now highlights today and uses measured October row offset in the two-column layout', (t) => {
  const r = screenHarness(t, 'year');
  const months = r.nodes().find((node) => node.props.onLayout && [node.props.children].flat(Infinity)
    .some((child) => child?.key === '2026-10-01' && child.props.onLayout));
  const october = r.nodes().find((node) => node.key === '2026-10-01' && node.props.onLayout);
  assert.ok(months && october);
  assert.equal(october.props.style[1].width, '48%');
  const selected = r.nodes().filter((node) => node.type === 'Pressable' && node.props.accessibilityState?.selected);
  assert.equal(selected.length, 1);
  assert.match(selected[0].props.accessibilityLabel, /October 25/);
  october.props.onLayout({ nativeEvent: { layout: { y: 1088 } } });
  assert.equal(r.calls.length, 0, 'wait for parent geometry too');
  months.props.onLayout({ nativeEvent: { layout: { y: 58 } } });
  assert.deepEqual(r.calls.map((call) => [call.method, call.y, call.animated]), [['scroll', 1146, false]]);
  selected[0].props.onPress();
  assert.deepEqual(r.opened, [['2026-10-25', 754]]);
  assert.equal(r.reads.length, 0, 'year renders civil dates without querying event sources');
});

test('Year waits for new geometry after a column change and respects a manual drag', (t) => {
  const r = screenHarness(t, 'year');
  const monthParent = () => r.nodes().find((node) => node.props.onLayout && [node.props.children].flat(Infinity)
    .some((child) => child?.key === '2026-10-01' && child.props.onLayout));
  const october = () => r.nodes().find((node) => node.key === '2026-10-01' && node.props.onLayout);
  monthParent().props.onLayout({ nativeEvent: { layout: { y: 50 } } });
  october().props.onLayout({ nativeEvent: { layout: { y: 1000 } } });
  r.setDimensions({ width: 320 });
  assert.equal(october().props.style[1], false);
  monthParent().props.onLayout({ nativeEvent: { layout: { y: 70 } } });
  assert.equal(r.calls.length, 1, 'old two-column offset is not reused');
  october().props.onLayout({ nativeEvent: { layout: { y: 2600 } } });
  assert.equal(r.calls.at(-1).y, 2670);
  r.setProps({ focusRequest: { dateKey: '2026-10-25', token: 2 } });
  r.find('ScrollView').props.onScrollBeginDrag();
  const count = r.calls.length;
  october().props.onLayout({ nativeEvent: { layout: { y: 2800 } } });
  assert.equal(r.calls.length, count);
});

test('Schedule Now targets day 25, retries an unmeasured row, and retains top anchoring as data changes', async (t) => {
  const plans = (day) => Array.from({ length: day === '2026-10-25' ? 3 : 1 }, (_, i) => ({
    id: `${day}:${i}`, calendarId: 'device', title: `Activity ${i}`, color: '#123456', notes: 'Details', allDay: false,
    startDate: new Date(`${day}T09:${String(i * 10).padStart(2, '0')}:00`),
    endDate: new Date(`${day}T09:${String(i * 10 + 5).padStart(2, '0')}:00`),
  }));
  const r = screenHarness(t, 'schedule', { plans });
  r.advance();
  assert.deepEqual(r.calls.map((call) => [call.method, call.index, call.viewPosition]), [['index', 24, 0]]);
  r.list().props.onScrollToIndexFailed({ index: 24, averageItemLength: 117 });
  assert.equal(r.calls.at(-1).offset, 24 * 117);
  r.advance(150);
  assert.equal(r.calls.at(-1).index, 24);
  r.list().props.onViewableItemsChanged({ viewableItems: [{ item: '2026-10-25' }] });
  await r.settle();
  const row = r.list().props.renderItem({ item: '2026-10-25' });
  const events = r.nodes(row).filter((node) => node.type === 'Pressable' && node.props.accessibilityHint === 'Open minute cells');
  assert.equal(events.length, 3, 'fixture creates a variable-height target day');
  assert.equal(r.list().props.maintainVisibleContentPosition.minIndexForVisible, 0);
  r.find('Pressable', () => true, row).props.onPress();
  assert.deepEqual(r.opened, [['2026-10-25', 754]]);
  r.setProps({ dataVersion: 1 });
  await r.settle(); r.advance(300);
  assert.equal(r.calls.filter((call) => call.method === 'index').length, 2,
    'data refresh does not restart the original focus request');
  assert.equal(r.list().props.maintainVisibleContentPosition.minIndexForVisible, 0,
    'native list is asked to preserve the visible top row while event heights change');
  assert.ok(r.reads.length <= 12, 'fixtures do not fetch every date in the month');
});
