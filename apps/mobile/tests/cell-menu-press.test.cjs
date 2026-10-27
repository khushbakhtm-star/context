const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('an open keyboard does not reserve a menu tap, and a single completed press dispatches once', () => {
  const filename = path.join(__dirname, '../src/components/CellActionMenu.tsx');
  const module = { exports: {} }; const touches = []; let copies = 0;
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Math,
    require(name) {
      if (name === 'react') return { useMemo: (work) => work(), useEffect() {}, useState: (value) => [value, () => {}], useRef: (value) => ({ current: value }) };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
        Keyboard: { isVisible: () => true, dismiss() {} }, StyleSheet: { create: (value) => value, hairlineWidth: 0.5 },
        BackHandler: { addEventListener: () => ({ remove() {} }) }, useWindowDimensions: () => ({ height: 800, width: 390 }) };
      if (name === '../appearance') return { useAppTheme: () => ({ colors: { ink: '#111111', panel: '#EEEEEE', hairline: '#CCCCCC' } }) };
      if (name === './CellColorPalette') return { CellColorPalette: 'CellColorPalette' };
      throw Error(`Unexpected menu press import ${name}`);
    } }, { filename });
  const tree = module.exports.CellActionMenu({ busy: false, onCopy: () => copies++, onCut() {}, onClose() {},
    onTouchActiveChange: (active) => touches.push(active) });
  const nodes = [];
  function visit(node) { if (!node || typeof node !== 'object') return; nodes.push(node);
    for (const child of [node.props?.children].flat(Infinity)) visit(child); }
  visit(tree);
  for (const scroll of nodes.filter((node) => node.type === 'ScrollView')) {
    assert.equal(scroll.props.keyboardShouldPersistTaps, 'always');
    assert.equal(scroll.props.keyboardDismissMode, 'none');
  }
  tree.props.onTouchStart(); assert.equal(copies, 0, 'holding or scrolling over a command cannot execute on touch down');
  const button = nodes.find((node) => node.props.accessibilityLabel === 'Copy selected minute cells');
  assert.equal(button.props.disabled, false);
  tree.props.onTouchEnd(); button.props.onPress();
  assert.equal(copies, 1); assert.deepEqual(touches, [true, false]);
});
