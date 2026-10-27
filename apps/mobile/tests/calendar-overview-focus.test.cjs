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
  const calls = [], reads = [], nativeReads = [], cachedReads = [], accountReads = [], opened = [], focused = [], warnings = [], pendingReads = new Map();
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
    PanResponder: { create: (panHandlers) => ({ panHandlers }) },
    useWindowDimensions: () => dimensions,
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } };
  const resolvedSource = (relative) => path.join(sourceRoot, relative);
  function readSegments(day) {
    reads.push(day);
    if (options.segments) return Promise.resolve(options.segments(day));
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
        if (resolved === resolvedSource('appearance')) return { useAppTheme: () => ({ colors: {
          paper: '#FFFFFF', ink: '#101010', accent: '#222222', onAccent: '#FFFFFF', selectedDay: '#DDDDDD',
        } }) };
        if (resolved === resolvedSource('components/InfoButton')) return { InfoButton: 'InfoButton' };
        if (resolved === resolvedSource('data/database')) return { getDaySegments: readSegments };
        if (resolved === resolvedSource('services/calendar')) return { loadPlannedEventsResult: async (ids, day) => {
          nativeReads.push(day); return options.device?.(day, ids) ?? { plans: options.plans?.(day) ?? [], failures: [] };
        } };
        if (resolved === resolvedSource('sync/engine')) return {
          loadCachedAccountPlans: async (day) => { cachedReads.push(day); return options.cached?.(day) ?? []; },
          loadAccountPlansResult: async (day) => { accountReads.push(day);
            return options.accounts?.(day) ?? { plans: [], failures: [], fromCache: false }; },
        };
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
    onOpenMinute: (...values) => opened.push(values), onOpenMonth() {}, onFocusedMinuteChange: (value) => focused.push(value),
    onSyncWarningChange: (message) => warnings.push(message), ...options.props };
  function render() { dirty = false; hook = 0; tree = Component(props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { for (let i = 0; i < 35; i++) { await Promise.resolve(); if (dirty) render(); } }
  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...[node.props?.children].flat(Infinity).filter((child) => child !== undefined).flatMap((child) => nodes(child))];
  }
  function find(type, predicate = () => true, node = tree) { return nodes(node).find((value) => value.type === type && predicate(value)); }
  function advance(ms = 0) { now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } }
  function unmount() { for (const slot of slots) { slot?.cleanup?.(); if (slot) slot.cleanup = undefined; } timers.clear(); }
  t.after(unmount);
  render();
  return { props, calls, reads, nativeReads, cachedReads, accountReads, opened, focused, warnings, pendingReads, render, settle, advance, nodes, find, unmount,
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

test('Year initially fits all twelve months and highlights today without horizontal scrolling', (t) => {
  const r = screenHarness(t, 'year');
  const months = r.nodes().find((node) => node.props.onLayout && [node.props.children].flat(Infinity)
    .some((child) => child?.key === '2026-10-01' && child.props.onLayout));
  const october = r.nodes().find((node) => node.key === '2026-10-01' && node.props.onLayout);
  assert.ok(months && october);
  assert.equal(october.props.style[1].width, (390 - 16 - 12) / 3);
  const monthCards = r.nodes().filter((node) => /^2026-\d\d-01$/.test(node.key ?? '') && node.props.onLayout);
  assert.equal(monthCards.length, 12);
  assert.ok(monthCards.every((node) => node.props.style[1].width === october.props.style[1].width));
  assert.equal(r.find('ScrollView').props.horizontal, false);
  assert.equal(r.find('ScrollView').props.showsHorizontalScrollIndicator, false);
  r.tree.props.onLayout({ nativeEvent: { layout: { width: 390, height: 700 } } }); r.render();
  const measuredCard = r.nodes().find((node) => node.key === '2026-10-01' && node.props.onLayout);
  assert.equal(measuredCard.props.style[1].height * 4 + 36 + 18 + 8, 700);
  const selected = r.nodes().filter((node) => node.type === 'Pressable' && node.props.accessibilityState?.selected);
  assert.equal(selected.length, 1);
  assert.match(selected[0].props.accessibilityLabel, /October 25/);
  measuredCard.props.onLayout({ nativeEvent: { layout: { y: 1088 } } });
  assert.equal(r.calls.length, 0, 'wait for parent geometry too');
  r.nodes().find((node) => node.props.onLayout && [node.props.children].flat(Infinity)
    .some((child) => child?.key === '2026-10-01' && child.props.onLayout))
    .props.onLayout({ nativeEvent: { layout: { y: 58 } } });
  assert.ok(r.calls.every((call) => call.method === 'scroll' && call.y === 0 && call.animated === false),
    'at the initial fit all months remain visible, so Now cannot scroll the year out of frame');
  selected[0].props.onPress();
  assert.deepEqual(r.opened, [['2026-10-25', 754]]);
  assert.equal(r.reads.length, 0, 'year renders civil dates without querying event sources');
});

test('Year pinch reflows larger lettering and month heights within the viewport; single-finger scrolling retains control', (t) => {
  const r = screenHarness(t, 'year');
  const monthParent = () => r.nodes().find((node) => node.props.onLayout && [node.props.children].flat(Infinity)
    .some((child) => child?.key === '2026-10-01' && child.props.onLayout));
  const october = () => r.nodes().find((node) => node.key === '2026-10-01' && node.props.onLayout);
  const cardWidth = october().props.style[1].width;
  const cardHeight = october().props.style[1].height;
  const fontBefore = r.find('Text', (node) => node.props.children === 25).props.style[1].fontSize;
  const touch = (span, count = 2) => ({ nativeEvent: { touches: count === 2
    ? [{ pageX: 0, pageY: 0 }, { pageX: span, pageY: 0 }] : [{ pageX: 0, pageY: 0 }] } });
  assert.equal(r.tree.props.onStartShouldSetPanResponderCapture(touch(50, 1)), false);
  assert.equal(r.tree.props.onMoveShouldSetPanResponderCapture(touch(50, 1)), false);
  assert.equal(r.tree.props.onStartShouldSetPanResponderCapture(touch(50)), true);
  r.tree.props.onPanResponderGrant(touch(50));
  r.tree.props.onPanResponderMove(touch(100)); r.render();
  assert.equal(october().props.style[1].width, 390 - 16);
  assert.ok(october().props.style[1].width > cardWidth, 'zoomed month reflows to one viewport-wide column');
  assert.equal(october().props.style[1].height, cardHeight * 2);
  assert.equal(r.find('Text', (node) => node.props.children === 25).props.style[1].fontSize, fontBefore * 2);
  assert.equal(r.calls.length, 0, 'pinching cancels prior automatic focus instead of repointing the viewport');
  monthParent().props.onLayout({ nativeEvent: { layout: { y: 50 } } });
  october().props.onLayout({ nativeEvent: { layout: { y: 1000 } } });
  r.setDimensions({ width: 320 });
  r.tree.props.onLayout({ nativeEvent: { layout: { width: 320, height: 600 } } }); r.render();
  assert.equal(october().props.style[1].width, 320 - 16);
  monthParent().props.onLayout({ nativeEvent: { layout: { y: 70 } } });
  assert.equal(r.calls.length, 0, 'manual pinch remains in control through new layout measurements');
  october().props.onLayout({ nativeEvent: { layout: { y: 2600 } } });
  assert.equal(r.calls.length, 0);
  r.setProps({ focusRequest: { dateKey: '2026-10-25', token: 2 } });
  assert.ok(r.calls.at(-1).y > 0, 'a new explicit Now request can reveal its month after zooming');
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

const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject }; };
function segment(day, title, minute = 600) {
  const entry = { id: `entry:${day}:${minute}`, dateKey: day, minuteIndex: minute, text: title,
    categoryId: 'family', blockId: `block:${day}:${minute}`, source: 'manual', createdAt: '', updatedAt: '' };
  return { dateKey: day, startMinute: minute, endMinute: minute, categoryId: 'family', entries: [entry],
    blockId: entry.blockId, segmentKey: `segment:${day}:${minute}` };
}
function plan(day, title, minute = 540, calendarId = 'device') {
  const startDate = new Date(`${day}T00:00:00`); startDate.setMinutes(minute);
  return { id: title, calendarId, title, color: '#123456', allDay: false,
    startDate, endDate: new Date(startDate.getTime() + 60_000) };
}
function dayTree(r, kind, day) { return r.list().props.renderItem({ item: kind === 'month' ? day.slice(0, 7) : day }); }
function hasText(r, node, text) { return r.nodes(node).some((value) => value.type === 'Text' && value.props.children === text); }

const flatStyle = (value) => Object.assign({}, ...[value].flat(Infinity).filter((item) => item && typeof item === 'object'));

test('Month leaves loading and empty dates blank, highlights only today, and shows every activity title in its actual fill', async (t) => {
  const day = '2026-10-25';
  const blocked = deferred();
  const r = screenHarness(t, 'month', { props: { activeDate: '2026-10-26', focusRequest: null,
    selectedDates: [day, '2026-10-26'] },
    plans: () => [], segments: (date) => date === day ? [segment(date, 'Recorded note')] : [],
    accounts: () => blocked.promise,
    device: (date) => ({ plans: date === day ? Array.from({ length: 5 }, (_, i) =>
      ({ ...plan(date, `Activity ${i}`, 540 + i * 2), color: i % 2 ? '#FBD75B' : '#0B8043' })) : [], failures: [] }) });
  let month = dayTree(r, 'month', day);
  assert.equal(r.nodes(month).some((node) => node.props.accessibilityLabel?.startsWith('Loading ')), false);
  assert.equal(hasText(r, month, '…'), false);
  await r.settle(); month = dayTree(r, 'month', day);
  const eventButtons = r.nodes(month).filter((node) => node.type === 'Pressable' &&
    /, (?:Activity \d|Recorded note)$/.test(node.props.accessibilityLabel ?? ''));
  assert.equal(eventButtons.length, 6, 'all titles remain visible without a +N or ellipsis substitute');
  for (const button of eventButtons.filter((node) => node.props.accessibilityLabel.includes('Activity '))) {
    assert.match(flatStyle(button.props.style).backgroundColor, /^#(?:FBD75B|0B8043)$/);
    const texts = r.nodes(button).filter((node) => node.type === 'Text');
    assert.equal(texts.length, 1, 'no start-time text is rendered before the title');
    assert.equal(texts[0].props.numberOfLines, 2);
    assert.equal(texts[0].props.ellipsizeMode, 'clip', 'long note previews are bounded without adding ellipsis placeholders');
    assert.match(texts[0].props.children, /^Activity \d$/);
    assert.match(flatStyle(texts[0].props.style).color, /^#(?:000000|FFFFFF)$/);
  }
  const dateButtons = r.nodes(month).filter((node) => node.type === 'Pressable' && /^Open (?!minutes)/.test(node.props.accessibilityLabel ?? ''));
  const highlighted = dateButtons.filter((button) => r.nodes(button).some((node) => flatStyle(node.props.style).backgroundColor === '#222222'));
  assert.equal(highlighted.length, 1);
  assert.match(highlighted[0].props.accessibilityLabel, /October 25/);
  const emptyDay = r.nodes(month).find((node) => node.key === '2026-10-26' && flatStyle(node.props.style).minHeight === 140);
  assert.deepEqual(r.nodes(emptyDay).filter((node) => node.type === 'Text').map((node) => node.props.children), [26]);
});

test('Month and Year preserve an exact focused minute on a date tap and report explicit event focus', async (t) => {
  for (const kind of ['month', 'year']) {
    const r = screenHarness(t, kind, { props: { focusRequest: { dateKey: '2026-10-25', token: 4, minuteIndex: 530 } },
      plans: (day) => [plan(day, 'Morning activity', 560)] });
    await r.settle();
    const tree = kind === 'month' ? dayTree(r, kind, '2026-10-25') : r.tree;
    const day = r.nodes(tree).find((node) => node.type === 'Pressable' && /^Open Sunday, October 25/.test(node.props.accessibilityLabel ?? ''));
    assert.ok(day); day.props.onPress();
    assert.deepEqual(r.opened.at(-1), ['2026-10-25', 530]);
    assert.equal(r.focused.at(-1).dateKey, '2026-10-25'); assert.equal(r.focused.at(-1).minuteIndex, 530);
    if (kind === 'month') {
      const event = r.nodes(tree).find((node) => node.type === 'Pressable' && node.props.accessibilityLabel?.endsWith(', Morning activity'));
      assert.ok(event); event.props.onPress();
      assert.deepEqual(r.opened.at(-1), ['2026-10-01', 560]);
      assert.equal(r.focused.at(-1).minuteIndex, 560);
    }
  }
});

test('Month never substitutes a category name for an intentionally blank colored cell', async (t) => {
  const day = '2026-10-25'; const blank = segment(day, '');
  const r = screenHarness(t, 'month', { props: { selectedDates: [day] }, segments: () => [blank] });
  await r.settle();
  const tree = dayTree(r, 'month', day);
  assert.equal(hasText(r, tree, 'Quality time with my people'), false);
  const item = r.nodes(tree).find((node) => node.type === 'Pressable' && node.key === `actual:${blank.segmentKey}`);
  assert.ok(item);
  assert.match(flatStyle(item.props.style).backgroundColor, /^#[0-9a-f]{6}$/i);
  assert.deepEqual(r.nodes(item).filter((node) => node.type === 'Text').map((node) => node.props.children), ['']);
});

test('Month and Schedule paint all requested local notes while both provider queues remain blocked', async (t) => {
  const days = Array.from({ length: 8 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`);
  for (const kind of ['month', 'schedule']) {
    const native = deferred(), account = deferred();
    const r = screenHarness(t, kind, { props: { activeDate: days[0], selectedDates: days, focusRequest: null },
      segments: (day) => [segment(day, `Local ${day}`)],
      device: () => native.promise, accounts: () => account.promise });
    r.list().props.onViewableItemsChanged({ viewableItems: [{ item: kind === 'month' ? '2026-10' : days.at(-1) }] });
    await r.settle();
    assert.ok(hasText(r, dayTree(r, kind, days.at(-1)), `Local ${days.at(-1)}`), kind);
    assert.ok(r.reads.includes(days.at(-1)), 'pending providers cannot occupy the local-reader queue');
    assert.equal(r.nativeReads.length, 2, 'native provider concurrency remains bounded independently');
    assert.equal(r.accountReads.length, 2, 'remote account concurrency remains bounded independently');
    assert.ok(r.cachedReads.includes(days.at(-1)), 'local account-cache reads do not queue behind remote requests');
  }
});

test('an independent successful native result appears before a delayed account read and preserves actual minutes', async (t) => {
  const day = '2026-10-25';
  for (const kind of ['month', 'schedule']) {
    const account = deferred();
    const r = screenHarness(t, kind, { props: { selectedDates: [day], focusRequest: null },
      segments: () => [segment(day, 'Recorded now')],
      device: () => ({ plans: [plan(day, 'Phone calendar')], failures: [] }), accounts: () => account.promise });
    await r.settle();
    assert.ok(hasText(r, dayTree(r, kind, day), 'Recorded now'), kind);
    assert.ok(hasText(r, dayTree(r, kind, day), 'Phone calendar'), kind);
    account.reject(new Error('Offline')); await r.settle();
    assert.ok(hasText(r, dayTree(r, kind, day), 'Recorded now'));
    assert.ok(hasText(r, dayTree(r, kind, day), 'Phone calendar'));
    assert.match(r.warnings.at(-1), /Some calendar events could not load/);
    assert.equal(hasText(r, r.tree, 'Some events could not load'), false);
  }
});

test('same-screen refresh retains known plans while showing new local notes, then honors authoritative empty results', async (t) => {
  const day = '2026-10-25';
  for (const kind of ['month', 'schedule']) {
    let phase = 0; const native = deferred(), account = deferred();
    const devicePlan = plan(day, 'Known phone plan'); const accountPlan = plan(day, 'Known account plan', 550, 'account');
    const r = screenHarness(t, kind, { props: { selectedDates: [day], focusRequest: null },
      segments: () => [segment(day, phase ? 'Latest local note' : 'Old local note')],
      cached: () => phase === 1 ? [accountPlan] : [],
      device: () => phase === 1 ? native.promise : { plans: phase === 0 ? [devicePlan] : [], failures: [] },
      accounts: () => phase === 1 ? account.promise : { plans: phase === 0 ? [accountPlan] : [], failures: [], fromCache: false } });
    await r.settle();
    phase = 1; r.setProps({ dataVersion: 1 }); await r.settle();
    assert.ok(hasText(r, dayTree(r, kind, day), 'Latest local note'));
    assert.ok(hasText(r, dayTree(r, kind, day), 'Known phone plan'));
    assert.ok(hasText(r, dayTree(r, kind, day), 'Known account plan'));
    native.resolve({ plans: [], failures: [{ calendarId: 'device', code: 'ERR_CALENDAR_READ_FAILED' }] });
    account.resolve({ plans: [accountPlan], failures: [{ accountId: 'account', code: 'timeout' }], fromCache: true });
    await r.settle();
    assert.ok(hasText(r, dayTree(r, kind, day), 'Known phone plan'));
    assert.ok(hasText(r, dayTree(r, kind, day), 'Known account plan'));
    phase = 2; r.setProps({ dataVersion: 2 }); await r.settle();
    assert.ok(hasText(r, dayTree(r, kind, day), 'Latest local note'));
    assert.equal(hasText(r, dayTree(r, kind, day), 'Known phone plan'), false);
    assert.equal(hasText(r, dayTree(r, kind, day), 'Known account plan'), false);
  }
});

test('late old-view providers and ledger reads cannot overwrite a newer navigation or local edit refresh', async (t) => {
  const first = '2026-10-25', second = '2026-11-01';
  for (const kind of ['month', 'schedule']) {
    const local = deferred(), native = deferred(), account = deferred(); let phase = 0;
    const r = screenHarness(t, kind, { props: { activeDate: first, selectedDates: [first], focusRequest: null },
      segments: (day) => phase === 0 ? local.promise : [segment(day, 'Latest saved note')],
      device: (day) => phase === 0 ? native.promise : { plans: [plan(day, 'Current phone plan')], failures: [] },
      accounts: () => phase === 0 ? account.promise : { plans: [], failures: [], fromCache: false } });
    phase = 1; r.setProps({ activeDate: second, selectedDates: [second], dataVersion: 1 }); await r.settle();
    local.resolve([segment(first, 'Stale local note')]); native.resolve({ plans: [plan(first, 'Stale phone plan')], failures: [] });
    account.resolve({ plans: [plan(first, 'Stale account plan')], failures: [], fromCache: false }); await r.settle();
    const tree = dayTree(r, kind, second);
    assert.ok(hasText(r, tree, 'Latest saved note')); assert.ok(hasText(r, tree, 'Current phone plan'));
    assert.equal(hasText(r, tree, 'Stale local note'), false); assert.equal(hasText(r, tree, 'Stale phone plan'), false);
    assert.equal(hasText(r, tree, 'Stale account plan'), false);
  }
});

test('a delayed initial account cache cannot replace the newer successful account result', async (t) => {
  const day = '2026-10-25';
  for (const kind of ['month', 'schedule']) {
    const cached = deferred();
    const r = screenHarness(t, kind, { props: { selectedDates: [day], focusRequest: null }, cached: () => cached.promise,
      accounts: () => ({ plans: [plan(day, 'Fresh account event')], failures: [], fromCache: false }) });
    await r.settle(); assert.ok(hasText(r, dayTree(r, kind, day), 'Fresh account event'));
    cached.resolve([plan(day, 'Stale cached event')]); await r.settle();
    assert.ok(hasText(r, dayTree(r, kind, day), 'Fresh account event'));
    assert.equal(hasText(r, dayTree(r, kind, day), 'Stale cached event'), false);
  }
});

test('changed calendar selection and permission failures clear cached plans without hiding local notes', async (t) => {
  const day = '2026-10-25';
  for (const kind of ['month', 'schedule']) {
    let phase = 0; const pending = deferred();
    const r = screenHarness(t, kind, { props: { selectedDates: [day], focusRequest: null, preferences: { selectedCalendarIds: ['a'] } },
      segments: () => [segment(day, 'Keep local note')],
      device: () => phase === 0 ? { plans: [plan(day, 'Selected phone event', 540, 'a')], failures: [] }
        : phase === 1 ? pending.promise : { plans: [], failures: [{ calendarId: 'a', code: 'ERR_MISSING_CALENDAR_PERMISSION' }] } });
    await r.settle(); assert.ok(hasText(r, dayTree(r, kind, day), 'Selected phone event'));
    phase = 1; r.setProps({ preferences: { selectedCalendarIds: ['b'] } }); await r.settle();
    assert.ok(hasText(r, dayTree(r, kind, day), 'Keep local note'));
    assert.equal(hasText(r, dayTree(r, kind, day), 'Selected phone event'), false);
    phase = 0; r.setProps({ preferences: { selectedCalendarIds: ['a'] } }); await r.settle();
    assert.ok(hasText(r, dayTree(r, kind, day), 'Selected phone event'));
    phase = 2; r.setProps({ dataVersion: 1 }); await r.settle();
    assert.ok(hasText(r, dayTree(r, kind, day), 'Keep local note'));
    assert.equal(hasText(r, dayTree(r, kind, day), 'Selected phone event'), false);
    assert.match(r.warnings.at(-1), /Some calendar events could not load/);
    assert.equal(hasText(r, r.tree, 'Some events could not load'), false);
  }
});

test('Month and Schedule report source warning only through the callback, clear after retry data refresh and on unmount', async (t) => {
  const day = '2026-10-25';
  for (const kind of ['month', 'schedule']) {
    let failed = true;
    const r = screenHarness(t, kind, { props: { selectedDates: [day], focusRequest: null },
      device: () => ({ plans: [], failures: failed ? [{ calendarId: 'device', code: 'ERR_CALENDAR_READ_FAILED' }] : [] }) });
    await r.settle(); assert.match(r.warnings.at(-1), /Some calendar events could not load/);
    const tree = dayTree(r, kind, day);
    assert.equal(hasText(r, r.tree, 'Some events could not load'), false);
    assert.equal(hasText(r, tree, 'Events unavailable'), false);
    assert.equal(r.nodes(tree).some((node) => /Some events unavailable/.test(node.props.accessibilityLabel ?? '')), false);
    assert.equal(r.nodes().some((node) => node.type === 'Pressable' && hasText(r, node, 'Retry')), false);
    failed = false; r.setProps({ dataVersion: 1 }); await r.settle();
    assert.equal(r.warnings.at(-1), null, 'successful Sync-triggered refresh removes the warning');
    failed = true; r.setProps({ dataVersion: 2 }); await r.settle(); assert.match(r.warnings.at(-1), /calendar events/);
    r.unmount(); assert.equal(r.warnings.at(-1), null, 'leaving the view releases its parent warning slot');
  }
});

test('local activity read failures use the parent warning slot without falsely claiming an empty schedule', async (t) => {
  const day = '2026-10-25';
  for (const kind of ['month', 'schedule']) {
    const r = screenHarness(t, kind, { props: { selectedDates: [day], focusRequest: null },
      segments: () => Promise.reject(new Error('Local read unavailable')) });
    await r.settle(); assert.match(r.warnings.at(-1), /saved activity could not load/);
    assert.equal(hasText(r, r.tree, 'Some events could not load'), false);
    assert.equal(hasText(r, dayTree(r, kind, day), 'No events'), false);
  }
});
