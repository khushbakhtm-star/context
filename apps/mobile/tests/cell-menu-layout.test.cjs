const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function menu(overrides = {}, dimensions = { width: 390, height: 844 }) {
  const file = path.join(__dirname, '../src/components/CellActionMenu.tsx');
  const slots = []; let hook = 0, dirty = true, effects = [], tree; const widths = [], touches = []; let back;
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
        BackHandler: { addEventListener: (_event, listener) => { back = listener; return { remove() {} }; } }, useWindowDimensions: () => dimensions };
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
    result.push(value); const children = typeof value.props?.children === 'function' ? value.props.children({ pressed: false }) : value.props?.children;
    for (const child of [children].flat(Infinity)) if (child != null) nodes(child, result); return result; }
  render();
  return { props, widths, touches, render, nodes, dimensions, back: () => { const result = back(); render(); return result; }, get tree() { return tree; },
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
  assert.deepEqual(icons.map((node) => node.props.name), ['cut', 'copy', 'paste', 'fill', 'ungroup', 'edit', 'format']);
  assert.ok(h.nodes().some((node) => node.props.accessibilityLabel === 'Auto fill selected minute cells'));
  assert.ok(h.nodes().some((node) => node.props.accessibilityLabel === 'Edit selected minutes and time range'));
  assert.equal(h.nodes().some((node) => node.type === 'CellColorPalette'), false);
  assert.equal(h.nodes().some((node) => node.type === 'Text'), false);
});

test('one Format tap reveals centered formatting controls inside the popup and closing it removes the extra height and width', () => {
  let bold = 0;
  const h = menu({ onToggleBold: () => bold++, onToggleItalic() {}, onToggleUnderline() {}, onTextColor() {}, onCellColor() {} });
  h.measureActions(190); const action = (label) => h.nodes().find((node) => node.props.accessibilityLabel === label);
  assert.equal(action('Bold'), undefined); assert.equal(h.rows().length, 1); assert.equal(h.style().width, 191);
  action('Format selected minute cells').props.onPress(); h.render();
  assert.equal(action('Format selected minute cells').props.accessibilityState.expanded, true);
  assert.equal(h.style().width, 232); assert.equal(h.rows().length, 2);
  action('Bold').props.onPress(); assert.equal(bold, 1, 'one completed tap dispatches one formatting command');
  h.props.format = { bold: true }; h.render(); assert.equal(action('Bold').props.accessibilityState.selected, true);
  for (const row of h.rows()) {
    const rowStyle = Object.assign({}, ...[row.props.style].flat(Infinity).filter(Boolean));
    const contentStyle = Object.assign({}, ...[row.props.contentContainerStyle].flat(Infinity).filter(Boolean));
    assert.equal(rowStyle.height, 48); assert.equal(rowStyle.flexGrow, 0); assert.equal(contentStyle.alignItems, 'center');
  }
  for (const button of h.nodes().filter((node) => node.type === 'Pressable')) {
    const style = Object.assign({}, ...button.props.style({ pressed: false }).filter(Boolean));
    assert.equal(style.height, 48); assert.equal(style.alignItems, 'center'); assert.equal(style.justifyContent, 'center');
  }
  action('Format selected minute cells').props.onPress(); h.render();
  assert.equal(action('Bold'), undefined); assert.equal(h.rows().length, 1); assert.equal(h.style().width, 191);
});

test('popup text and cell palettes retain reset semantics, Google choices and one-tap callbacks', () => {
  const texts = [], fills = []; let resets = 0;
  const choices = [{ id: 'basil', name: 'Basil', color: '#0B8043' }];
  const h = menu({ onTextColor: (value) => texts.push(value), onCellColor: (value) => fills.push(value),
    onResetCellColor: () => resets++, format: { textColor: '#ABCDEF' }, textColor: '#ABCDEF', fillColor: '#0B8043',
    colorChoices: choices, selectedColorId: 'basil' }); h.measureActions(190);
  const action = (label) => h.nodes().find((node) => node.props.accessibilityLabel === label);
  const palette = () => h.nodes().find((node) => node.type === 'CellColorPalette');
  action('Format selected minute cells').props.onPress(); h.render();
  action('Choose text color').props.onPress(); h.render(); assert.equal(palette().props.mode, 'text');
  assert.equal(h.style().width, 374); assert.equal(palette().props.explicitTextColor, '#ABCDEF');
  palette().props.onTextColor(null); h.render(); assert.deepEqual(texts, [null]); assert.equal(palette(), undefined);
  action('Choose cell color').props.onPress(); h.render(); assert.equal(palette().props.mode, 'cell');
  assert.equal(palette().props.colorChoices, choices); assert.equal(palette().props.selectedColorId, 'basil');
  palette().props.onCellColor('basil'); h.render(); assert.deepEqual(fills, ['basil']);
  action('Choose cell color').props.onPress(); h.render(); palette().props.onResetCellColor(); h.render(); assert.equal(resets, 1);
  assert.equal(action('Format selected minute cells').props.accessibilityState.expanded, true, 'choosing a color does not discard the selected cells');
});

test('Back dismisses a palette, then formatting, then the menu; busy actions and dismissal cannot mutate selection', () => {
  let close = 0, bold = 0, color = 0;
  const h = menu({ onClose: () => close++, onToggleBold: () => bold++, onTextColor: () => color++ }); h.measureActions(190);
  const action = (label) => h.nodes().find((node) => node.props.accessibilityLabel === label);
  action('Format selected minute cells').props.onPress(); h.render(); action('Choose text color').props.onPress(); h.render();
  h.props.busy = true; h.render(); action('Bold').props.onPress();
  h.nodes().find((node) => node.type === 'CellColorPalette').props.onTextColor('#FFFFFF'); h.back();
  assert.equal(bold, 0); assert.equal(color, 0); assert.equal(close, 0);
  assert.ok(h.nodes().some((node) => node.type === 'CellColorPalette'));
  h.props.busy = false; h.render(); h.back(); assert.equal(h.nodes().some((node) => node.type === 'CellColorPalette'), false);
  assert.ok(action('Bold')); h.back(); assert.equal(action('Bold'), undefined); assert.equal(close, 0);
  h.back(); assert.equal(close, 1);
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

test('overlapping Copy and Paste pages match the actual button background while pressed and released', () => {
  const h = menu(); h.measureActions(160);
  for (const label of ['Copy selected minute cells', 'Paste into selected minute cells']) {
    const button = h.nodes().find((node) => node.props.accessibilityLabel === label);
    for (const pressed of [false, true]) {
      const style = Object.assign({}, ...button.props.style({ pressed }).filter(Boolean));
      const icon = button.props.children({ pressed });
      assert.equal(icon.props.backgroundColor, style.backgroundColor ?? h.style().backgroundColor,
        'foreground page masks must use the same color as their containing button');
    }
  }
});
