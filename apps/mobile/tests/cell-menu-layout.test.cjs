const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function menu(overrides = {}, dimensions = { width: 390, height: 844 }) {
  const file = path.join(__dirname, '../src/components/CellActionMenu.tsx');
  const slots = []; let hook = 0, dirty = true, effects = [], tree; const widths = [], touches = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useRef(value) { return slots[hook++] ??= { current: value }; },
    useState(value) { const index = hook++; slots[index] ??= { value };
      return [slots[index].value, (next) => { const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }]; },
    useMemo(work, deps) { const index = hook++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: work(), deps };
      return slots[index].value; },
    useEffect(work, deps) { const index = hook++; if (!slots[index] || !same(slots[index].deps, deps)) {
      const previous = slots[index]; slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = work(); }); } },
  };
  const props = { busy: false, onCut() {}, onCopy() {}, onPaste() {}, onClose() {},
    onWidthChange: (width) => widths.push(width), onTouchActiveChange: (active) => touches.push(active), ...overrides };
  const jsx = (type, props) => ({ type, props: props ?? {} }); const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module, exports: module.exports, Math,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
        StyleSheet: { create: (value) => value, hairlineWidth: 0.5 }, Keyboard: { dismiss() {} },
        BackHandler: { addEventListener: () => ({ remove() {} }) }, useWindowDimensions: () => dimensions };
      if (name === '../appearance') return { useAppTheme: () => ({ colors: { ink: '#111111', panel: '#EEEEEE', hairline: '#CCCCCC' } }) };
      if (name === './CellColorPalette') return { CellColorPalette: 'CellColorPalette' };
      if (name === './CellActionIcon') return { CellActionIcon: 'CellActionIcon' };
      throw Error(`Unexpected menu layout import: ${name}`);
    },
  });
  function render() { let count = 0; do { assert.ok(count++ < 12, 'measurement must settle without layout churn');
    dirty = false; hook = 0; effects = []; tree = module.exports.CellActionMenu(props); effects.forEach((effect) => effect());
  } while (dirty); return tree; }
  function nodes(value = tree, result = []) { if (!value || typeof value !== 'object') return result;
    result.push(value); for (const child of [value.props?.children].flat(Infinity)) if (child != null) nodes(child, result); return result; }
  render();
  return { props, widths, touches, render, nodes, dimensions, get tree() { return tree; },
    style: () => Object.assign({}, ...tree.props.style.filter(Boolean)),
    rows: () => nodes().filter((node) => node.type === 'ScrollView' && node.props.horizontal),
    measureActions(width) { this.rows()[0].props.onContentSizeChange(width, 48); render(); },
    measureFormats(width) { this.rows()[1].props.onContentSizeChange(width, 48); render(); },
  };
}

test('a blank selection uses native action width with no empty formatting row or wide first-frame flash', () => {
  const h = menu(); assert.equal(h.style().opacity, 0); assert.equal(h.style().width, 374);
  assert.equal(h.rows().length, 1); h.measureActions(158.5);
  assert.equal(h.style().width, 159.5); assert.equal(h.style().opacity, 1);
  assert.deepEqual(h.widths, [159.5]);
  assert.equal(h.nodes().filter((node) => node.type === 'Pressable').length, 3);
  h.props.busy = true; h.render(); h.measureActions(158.5);
  assert.deepEqual(h.widths, [159.5], 'disabled styling does not reset or churn native measurements');
});

test('measured icon actions expand only up to the actual viewport bound without a formatting row', () => {
  const h = menu({ onReset() {}, onGroup() {}, onToggleBold() {}, onToggleItalic() {}, onToggleUnderline() {}, onTextColor() {}, onCellColor() {} });
  h.measureActions(244); assert.equal(h.style().opacity, 1);
  assert.equal(h.rows().length, 1); assert.equal(h.style().width, 245);
  h.measureActions(690); assert.equal(h.style().width, 374, 'native large-font content scrolls rather than exceeding the phone');
  for (const row of h.rows()) { assert.equal(row.props.keyboardShouldPersistTaps, 'always'); assert.equal(row.props.keyboardDismissMode, 'none'); }
  const narrow = menu({}, { width: 180, height: 320 }); narrow.measureActions(300); assert.equal(narrow.style().width, 164);
  const wide = menu({}, { width: 1200, height: 900 }); wide.measureActions(900); assert.equal(wide.style().width, 440);
});

test('icon actions retain accessible names and relevant AutoFill, Ungroup and pencil without text captions', () => {
  const h = menu({ onAutoFill() {}, onUngroup() {}, onEdit() {}, onCellColor() {} }); h.measureActions(280);
  const icons = h.nodes().filter((node) => node.type === 'CellActionIcon');
  assert.deepEqual(icons.map((node) => node.props.name), ['cut', 'copy', 'paste', 'fill', 'ungroup', 'edit']);
  assert.ok(h.nodes().some((node) => node.props.accessibilityLabel === 'Auto fill selected minute cells'));
  assert.ok(h.nodes().some((node) => node.props.accessibilityLabel === 'Edit selected minutes and time range'));
  assert.equal(h.nodes().some((node) => node.type === 'CellColorPalette'), false);
  assert.equal(h.nodes().some((node) => node.type === 'Text'), false);
});

test('a controlled parent can hold width through a native touch without hiding the menu or running a command early', () => {
  let copies = 0; const h = menu({ width: 374, onCopy: () => copies++ });
  h.measureActions(170); assert.equal(h.style().opacity, 0);
  h.props.width = 171; h.render(); assert.equal(h.style().opacity, 1);
  h.tree.props.onTouchStart(); h.measureActions(300);
  assert.equal(h.style().width, 171); assert.equal(h.style().opacity, 1); assert.equal(copies, 0);
  h.tree.props.onTouchEnd(); h.nodes().find((node) => node.props.accessibilityLabel === 'Copy selected minute cells').props.onPress();
  assert.equal(copies, 1); assert.deepEqual(h.touches, [true, false]);
  h.props.width = 301; h.render(); assert.equal(h.style().width, 301);
});
