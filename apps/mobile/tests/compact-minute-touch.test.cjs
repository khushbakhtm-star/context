const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function component(callbacks = {}) {
  const jsx = (type, props) => ({ type, props: props ?? {} }); const slots = []; let hook = 0;
  const file = path.join(__dirname, '../src/components/CompactMinuteOverview.tsx'); const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module, exports: module.exports, require(name) {
    if (name === 'react') return { useRef: (value) => slots[hook++] ??= { current: value } };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
      StyleSheet: { hairlineWidth: 0.5, absoluteFill: {} } };
    return require(path.resolve(path.dirname(file), name + '.ts'));
  } }, { filename: file });
  const calls = []; const day = '2026-11-02';
  const tree = module.exports.CompactMinuteOverview({ scrollRef: { current: null }, days: [day], labels: new Map([[day, 'Monday']]),
    bands: new Map(), rowHeight: 0.5, railWidth: 40, dayWidth: 300, colors: {},
    current: { day, minute: 600 }, disabled: false, scrolling: true, timeLabel: String,
    onSelect: (...args) => calls.push(['select', ...args]), onHold: (...args) => calls.push(['hold', ...args]),
    onBegin() {}, onEnd() {}, onScroll() {}, onLayout() {}, onContentSizeChange() {}, ...callbacks });
  function walk(node) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(walk)] : []; }
  return { tree, target: walk(tree).find((node) => node.type === 'Pressable').props, calls, day };
}
const pointer = (y = 300, count = 1) => ({ nativeEvent: { locationY: y, pageX: 160, pageY: y + 80,
  touches: Array.from({ length: count }, () => ({ pageX: 160, pageY: y + 80 })) } });

test('compact selected-body gestures forward exact minute and move/end to the shared drag owner', () => {
  const calls = []; const h = component({ onCellTouchStart: (...args) => calls.push(['start', ...args]),
    onCellTouchMove: (event) => calls.push(['move', event]), onCellTouchEnd: (event) => calls.push(['end', event]) });
  const down = pointer(), move = pointer(310), end = pointer(310, 0);
  h.target.onTouchStart(down); h.target.onTouchMove(move); h.target.onTouchEnd(end); h.target.onPress();
  assert.equal(calls[0][0], 'start'); assert.equal(calls[0][1], h.day); assert.equal(calls[0][2], 600);
  assert.equal(calls[0][3], down); assert.equal(calls[1][1], move); assert.equal(calls[2][1], end);
  assert.deepEqual(h.calls, [], 'a moved gesture never selects the abandoned source on release');
  assert.equal(h.tree.props.scrollEnabled, true, 'ordinary vertical scrolling remains available before drag ownership');
});

test('compact hold uses the owner timer once and cancellation reaches the shared gesture owner', () => {
  let cancels = 0; const h = component({ onCellTouchStart() {}, onCellTouchCancel() { cancels++; } });
  h.target.onTouchStart(pointer()); h.target.onLongPress(); h.target.onPress();
  assert.deepEqual(h.calls, [], 'custom owner timers prevent a second native long-press action');
  h.target.onTouchCancel(); assert.equal(cancels, 1);
});

test('compact plain taps and standalone long holds retain their original selection route', () => {
  const h = component(); h.target.onTouchStart(pointer()); h.target.onPress();
  assert.deepEqual(h.calls, [['select', h.day, 600]]);
  h.target.onTouchStart(pointer()); h.target.onLongPress(); h.target.onPress();
  assert.deepEqual(h.calls, [['select', h.day, 600], ['hold', h.day, 600]]);
});
