const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const harnessSource = fs.readFileSync(path.join(__dirname, 'today-cell-actions.test.cjs'), 'utf8');
const prefix = harnessSource.slice(0, harnessSource.indexOf('\nfunction plan('));
assert.ok(prefix.includes('function screen('));
const fixture = { exports: {} };
vm.runInNewContext(`${prefix}\nmodule.exports = screen;`, { module: fixture, exports: fixture.exports, require, __dirname, console });
const screen = fixture.exports;
function find(node, predicate) { if (!node || typeof node !== 'object') return null; if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, predicate); if (result) return result; } return null; }
const grid = (h) => find(h.tree, (node) => node.props?.onStartShouldSetPanResponderCapture)?.props;
const event = (touches = 1) => ({ nativeEvent: { pageX: 160, pageY: 420,
  touches: Array.from({ length: touches }, (_, i) => ({ pageX: 160 + i * 30, pageY: 420 + i * 30 })) } });
async function swipe(h, dx = -85, dy = 3) {
  const props = grid(h); assert.equal(props.onStartShouldSetPanResponderCapture(event()), false);
  const claimed = props.onMoveShouldSetPanResponderCapture(event(), { dx: dx / 2, dy, numberActiveTouches: 1 });
  if (claimed) { props.onPanResponderGrant(event()); props.onPanResponderMove(event(), { dx, dy, numberActiveTouches: 1 });
    props.onPanResponderRelease(event(0), { dx, dy, numberActiveTouches: 0 }); }
  await h.settle(); return claimed;
}
test('actual Today responder pages a whole period once while vertical scrolling retains its contact', async (t) => {
  const pages = []; const h = screen(t, { props: { dayCount: 7, onPeriodSwipe: (direction) => pages.push(direction) } }); await h.start();
  assert.equal(await swipe(h), true); assert.deepEqual(pages, [1]);
  assert.equal(await swipe(h, 90), true); assert.deepEqual(pages, [1, -1]);
  assert.equal(await swipe(h, 4, 60), false); assert.deepEqual(pages, [1, -1]);
  assert.equal(h.drafts.snapshot().length, 0, 'navigation never creates a minute or opens its keyboard');
});
test('actual Today responder never steals an active editor, selected range, or open cell menu', async (t) => {
  const pages = []; const h = screen(t, { props: { onPeriodSwipe: (direction) => pages.push(direction) } }); await h.start();
  await h.tap(600); await h.tap(600); assert.ok(h.input()); assert.equal(await swipe(h), false);
  h.input().onSubmitEditing(); await h.settle(); await h.hold(600); assert.ok(h.menu()); assert.equal(await swipe(h), false);
  h.menu().onClose(); await h.settle(); await h.selectThrough(605); assert.equal(await swipe(h), false);
  assert.deepEqual(pages, []);
});
test('a Today swipe captured before a date or lifecycle change cannot navigate from its stale page', async (t) => {
  const pages = []; const h = screen(t, { props: { onPeriodSwipe: (direction) => pages.push(direction) } }); await h.start();
  let props = grid(h); props.onStartShouldSetPanResponderCapture(event());
  assert.equal(props.onMoveShouldSetPanResponderCapture(event(), { dx: -30, dy: 0, numberActiveTouches: 1 }), true); props.onPanResponderGrant(event());
  await h.navigate('2026-10-26'); props.onPanResponderRelease(event(0), { dx: -90, dy: 0, numberActiveTouches: 0 });
  assert.deepEqual(pages, []);
  props = grid(h); props.onStartShouldSetPanResponderCapture(event()); props.onMoveShouldSetPanResponderCapture(event(), { dx: -30, dy: 0, numberActiveTouches: 1 }); props.onPanResponderGrant(event());
  await h.background(); props.onPanResponderRelease(event(0), { dx: -90, dy: 0, numberActiveTouches: 0 }); assert.deepEqual(pages, []);
});

function overviewHarness() {
  const filename = path.join(__dirname, '../src/components/CalendarPeriodSwipe.tsx'); const slots = []; let hook = 0; let tree; let cleanup;
  const listeners = new Set(); const native = { View: 'View', PanResponder: { create: (panHandlers) => ({ panHandlers }) },
    AppState: { currentState: 'active', addEventListener: (_name, callback) => { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } } };
  const react = { useRef(value) { const index = hook++; return slots[index] ??= { current: value }; },
    useMemo(work) { const index = hook++; return slots[index] ??= work(); }, useEffect(work) { const index = hook++; if (!slots[index]) { slots[index] = true; cleanup = work(); } } };
  const utils = { exports: {} }; const module = { exports: {} };
  const transpile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(transpile(fs.readFileSync(path.join(__dirname, '../src/utils/calendar-period-swipe.ts'), 'utf8')), { module: utils, exports: utils.exports });
  vm.runInNewContext(transpile(fs.readFileSync(filename, 'utf8')), { module, exports: module.exports, require(name) {
    if (name === 'react') return react; if (name === 'react-native') return native;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
    return utils.exports;
  } });
  const pages = []; const props = { enabled: true, scope: 'month:2026-10', children: { type: 'CalendarContents' }, onPage: (direction) => pages.push(direction) };
  function render() { hook = 0; tree = module.exports.CalendarPeriodSwipe(props); return tree.props; } render();
  return { props, pages, render, background() { native.AppState.currentState = 'background'; for (const fn of listeners) fn('background'); }, dispose: () => cleanup?.() };
}
test('actual Month/Year/Schedule wrapper preserves taps and vertical scroll; scope/lifecycle/disabled states cancel paging', () => {
  const h = overviewHarness(); let props = h.render(); assert.equal(props.onStartShouldSetPanResponderCapture(event()), false);
  assert.equal(props.onMoveShouldSetPanResponderCapture(event(), { dx: 4, dy: 30, numberActiveTouches: 1 }), false);
  props.onStartShouldSetPanResponderCapture(event()); assert.equal(props.onMoveShouldSetPanResponderCapture(event(), { dx: -30, dy: 2, numberActiveTouches: 1 }), true);
  props.onPanResponderRelease(event(0), { dx: -90, dy: 2, numberActiveTouches: 0 }); assert.deepEqual(h.pages, [1]);
  props.onStartShouldSetPanResponderCapture(event()); props.onMoveShouldSetPanResponderCapture(event(), { dx: -30, dy: 0, numberActiveTouches: 1 });
  h.props.scope = 'month:2026-11'; props = h.render(); props.onPanResponderRelease(event(0), { dx: -90, dy: 0, numberActiveTouches: 0 }); assert.deepEqual(h.pages, [1]);
  h.props.enabled = false; props = h.render(); props.onStartShouldSetPanResponderCapture(event()); assert.equal(props.onMoveShouldSetPanResponderCapture(event(), { dx: 90, dy: 0, numberActiveTouches: 1 }), false);
  h.props.enabled = true; props = h.render(); props.onStartShouldSetPanResponderCapture(event()); props.onMoveShouldSetPanResponderCapture(event(), { dx: 30, dy: 0, numberActiveTouches: 1 });
  h.background(); props.onPanResponderRelease(event(0), { dx: 90, dy: 0, numberActiveTouches: 0 }); assert.deepEqual(h.pages, [1]); h.dispose();
});

test('actual App swipe handler uses the same period targets and waits for the guarded draft transition', async () => {
  const filename = path.join(__dirname, '../App.tsx'); const parsed = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'swipeCalendarPeriod') handler = node; ts.forEachChild(node, visit); } visit(parsed);
  assert.ok(handler); const code = ts.transpileModule(`${handler.getText(parsed)}\nexport { swipeCalendarPeriod };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let release; const gate = new Promise((resolve) => { release = resolve; }); const shifted = []; const failures = [];
  const module = { exports: {} }; const context = { module, exports: module.exports, tab: 'today', datePickerOpen: false, viewChangingRef: { current: false },
    previousView: { activeDate: '2026-10-19' }, nextView: { activeDate: '2026-11-02' },
    transitionFromCalendar: async (change, title) => { failures.push(title); await gate; change(); }, shiftCalendarView: (target) => shifted.push(target) };
  vm.runInNewContext(code, context); const waiting = module.exports.swipeCalendarPeriod(1); assert.deepEqual(shifted, []);
  release(); await waiting; assert.equal(shifted[0].activeDate, '2026-11-02'); assert.deepEqual(failures, ['Could not change dates']);
  context.viewChangingRef.current = true; module.exports.swipeCalendarPeriod(-1); assert.equal(shifted.length, 1);
  context.viewChangingRef.current = false; context.datePickerOpen = true; module.exports.swipeCalendarPeriod(-1); assert.equal(shifted.length, 1);
  context.datePickerOpen = false; context.nextView = null; module.exports.swipeCalendarPeriod(1); assert.equal(shifted.length, 1);
});
