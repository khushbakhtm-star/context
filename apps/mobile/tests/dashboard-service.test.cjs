const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function runtime() {
  const state = { calls: [], rows: [], categories: [], gate: null };
  const filename = path.join(__dirname, '../src/services/dashboard.ts');
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Promise, Error,
    require(name) {
      if (name === '../data/database') return { async getCategoryTimeTotals(start, end) {
        state.calls.push([start, end]); if (state.gate) await state.gate; return state.rows;
      } };
      if (name === './categories') return { async listCategories() { return state.categories; } };
      if (name === '../utils/dashboard') return require('../src/utils/dashboard.ts');
      throw new Error(`Dashboard must not import a calendar or provider: ${name}`);
    },
  }, { filename });
  return { state, api: module.exports };
}

test('Dashboard uses one local grouped query and filters exact selected dates without calendar or provider reads', async () => {
  const { state, api } = runtime();
  state.rows = [{ dateKey: '2026-10-23', categoryId: 'work', minutes: 2 },
    { dateKey: '2026-10-24', categoryId: 'work', minutes: 100 },
    { dateKey: '2026-10-26', categoryId: 'work', minutes: 3 }];
  state.categories = [{ id: 'work', name: 'Work', color: '#AB8B00', archived: true }];
  const summary = await api.getDashboardSummary(['2026-10-26', '2026-10-23']);
  assert.deepEqual(state.calls, [['2026-10-23', '2026-10-26']]);
  assert.equal(summary.recordedMinutes, 5); assert.equal(summary.unrecordedMinutes, 2875);
  assert.equal(summary.categories[0].name, 'Work');
});

test('aborted Dashboard work cannot return a late summary and pre-aborted work does not query', async () => {
  const first = runtime(); const aborted = new AbortController(); aborted.abort();
  await assert.rejects(first.api.getDashboardSummary(['2026-10-25'], { signal: aborted.signal }), { name: 'AbortError' });
  assert.equal(first.state.calls.length, 0);
  const second = runtime(); let release;
  second.state.gate = new Promise((resolve) => { release = resolve; });
  const controller = new AbortController();
  const loading = second.api.getDashboardSummary(['2026-10-25'], { signal: controller.signal });
  controller.abort(); release();
  await assert.rejects(loading, { name: 'AbortError' });
});

function dashboardScreen(t, initial = {}) {
  let hook = 0, dirty = true, tree; const slots = [], effects = [], calls = [], settings = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useRef(value) { return slots[hook++] ??= { current: value }; },
    useState(value) { const i = hook++; slots[i] ??= { value: typeof value === 'function' ? value() : value };
      return [slots[i].value, (next) => { const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useMemo(work, deps) { const i = hook++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: work() }; return slots[i].value; },
    useEffect(work, deps) { const i = hook++; if (!slots[i] || !same(slots[i].deps, deps)) {
      const prior = slots[i]; slots[i] = { deps, cleanup: prior?.cleanup };
      effects.push(() => { prior?.cleanup?.(); slots[i].cleanup = work(); }); } },
  };
  const utils = require('../src/utils/dashboard.ts'); const jsx = (type, props) => ({ type, props: props ?? {} });
  const module = { exports: {} }, file = path.join(__dirname, '../src/screens/ReportsScreen.tsx');
  const colors = new Proxy({}, { get: () => '#777777' });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { module, exports: module.exports, Date, Intl, AbortController, Promise, Error, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { ...Object.fromEntries(['ActivityIndicator', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map((item) => [item, item])),
      StyleSheet: { create: (value) => value, hairlineWidth: .5 } };
    if (name === '../appearance') return { useAppTheme: () => ({ colors, resolvedMode: 'light' }) };
    for (const item of ['InfoButton', 'DashboardChart', 'DateSelectionPopup']) if (name === '../components/' + item) return { [item]: item };
    if (name === '../data/database') return { getSetting: async () => 'bar', setSetting: async (...args) => { settings.push(args); } };
    if (name === '../services/dashboard') return { getDashboardSummary: async (dates) => { calls.push([...dates]);
      return utils.buildDashboardSummary(dates, dates.map((dateKey) => ({ dateKey, categoryId: 'work', minutes: 30 })),
        [{ id: 'work', name: 'Work', color: '#AB8B00' }]); } };
    if (name.startsWith('../utils/') || name === '../services/reports') return require('../src/' + name.slice(3) + '.ts');
    throw Error('Unexpected Dashboard screen dependency: ' + name);
  } }, { filename: file });
  function render() { hook = 0; dirty = false; tree = module.exports.ReportsScreen({ dataVersion: 0, initialDate: '2026-10-19', ...initial }); while (effects.length) effects.shift()(); }
  function nodes(node) { return !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }
  async function settle() { for (let i = 0; i < 60; i++) { await Promise.resolve(); if (dirty) render(); } }
  t.after(() => slots.forEach((slot) => slot?.cleanup?.()));
  return { async start() { render(); await settle(); }, settle, calls, settings,
    node: (type) => nodes(tree).find((node) => node.type === type)?.props,
    action: (label) => nodes(tree).find((node) => node.props.accessibilityLabel === label)?.props,
    textAction: (text) => nodes(tree).find((node) => node.type === 'Pressable' && nodes(node).some((child) => child.type === 'Text' && child.props.children === text))?.props };
}

test('actual Dashboard honors initial selected dates, permits Pick/Range edits and persists Pie/Bar/Line choices', async (t) => {
  const h = dashboardScreen(t, { initialSelectedDates: ['2026-10-29', '2026-10-19'] }); await h.start();
  assert.deepEqual(h.calls[0], ['2026-10-19', '2026-10-29']);
  assert.equal(h.action('Previous selected'), undefined); assert.equal(h.node('DashboardChart').type, 'bar');
  h.action('Line chart').onPress(); await h.settle();
  assert.equal(h.node('DashboardChart').type, 'line');
  assert.deepEqual(Array.from(h.node('DashboardChart').items, (item) => item.dateKey), ['2026-10-19', '2026-10-29']);
  assert.deepEqual(h.settings.at(-1), ['dashboard.chartType', 'line']);
  h.action('Edit Dashboard selected dates').onPress(); await h.settle(); assert.equal(h.node('DateSelectionPopup').visible, true);
  h.node('DateSelectionPopup').onApply(['2026-11-02', '2026-10-19']); await h.settle();
  assert.deepEqual(h.calls.at(-1), ['2026-10-19', '2026-11-02']); assert.equal(h.node('DateSelectionPopup').visible, false);
  h.action('Pie chart').onPress(); await h.settle(); assert.equal(h.node('DashboardChart').totalMinutes, 60);
  h.textAction('Unrecorded').onPress(); await h.settle();
  assert.equal(h.node('DashboardChart').totalMinutes, 2880); assert.equal(h.node('DashboardChart').remainderLabel, 'Recorded minutes');
  assert.equal(h.node('DashboardChart').items[0].minutes, 2820);
});

test('actual Dashboard defaults to one day, and period controls still query real week/month/year civil dates', async (t) => {
  const h = dashboardScreen(t); await h.start(); assert.deepEqual(h.calls[0], ['2026-10-19']);
  for (const [label, count] of [['Week', 7], ['Month', 31], ['Year', 365]]) {
    h.textAction(label).onPress(); await h.settle(); assert.equal(h.calls.at(-1).length, count);
  }
  h.action('Line chart').onPress(); await h.settle(); assert.equal(h.node('DashboardChart').items.length, 12, 'yearly line uses existing monthly totals');
});

test('all native chart types retain a readable accessible name/minutes/percentage legend, including pie remainder', () => {
  const jsx = (type, props) => ({ type, props: props ?? {} }), module = { exports: {} };
  const file = path.join(__dirname, '../src/components/DashboardChart.tsx');
  const colors = new Proxy({}, { get: () => '#777777' });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { module, exports: module.exports, require(name) {
    if (name === 'react') return { useMemo: (work) => work(), useState: () => [260, () => {}] };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { View: 'View', Text: 'Text', StyleSheet: { create: (value) => value, hairlineWidth: .5 } };
    if (name === '../appearance') return { useAppTheme: () => ({ colors }) };
    if (name === '../utils/dashboard') return require('../src/utils/dashboard.ts');
    throw Error('Unexpected chart dependency: ' + name);
  } }, { filename: file });
  function nodes(node) { return !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }
  for (const type of ['pie', 'bar', 'line']) {
    const tree = module.exports.DashboardChart({ type, items: [{ key: 'work', label: 'Work', minutes: 90, percent: 75, color: '#AB8B00' }], totalMinutes: 120 });
    const all = nodes(tree); assert.ok(all.some((node) => node.props.accessible && node.props.accessibilityLabel === 'Work, 90 minutes, 75%'));
    assert.ok(all.some((node) => node.type === 'Text' && node.props.children === 'Work'));
    assert.ok(all.some((node) => node.type === 'Text' && [node.props.children].flat(Infinity).join('') === '90 minutes · 75%'));
    if (type === 'pie') assert.ok(all.some((node) => node.props.accessibilityLabel === 'Other recorded activities, 30 minutes, 25%'));
    if (type === 'line') {
      const plot = all.find((node) => node.props.testID === 'dashboard-line');
      assert.equal(plot.props.accessible, false); assert.equal(plot.props.pointerEvents, 'none');
      assert.equal([plot.props.children].flat(Infinity).filter((node) => node?.props?.style?.width === 6).length, 1, 'single date has one real point');
    }
  }
});
