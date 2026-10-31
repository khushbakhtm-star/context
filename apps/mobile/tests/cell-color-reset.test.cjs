const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const jsx = (type, props) => ({ type, props: props ?? {} });
function render(mode, busy = false, colorChoices = [{ id: 'green', name: 'Green', color: '#0D7813' }]) {
  const file = path.join(__dirname, '../src/components/CellColorPalette.tsx');
  const calls = []; const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module, exports: module.exports,
    require(name) {
      if (name === 'react') return { useMemo: (work) => work(), useState: (value) => [value, () => {}] };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react-native') return { View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable',
        StyleSheet: { create: (value) => value, hairlineWidth: 0.5 } };
      if (name === '../appearance') return { useAppTheme: () => ({ colors: {} }) };
      if (name === '../utils/google-activity-colors') {
        const utility = { exports: {} };
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/google-activity-colors.ts'), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText, { module: utility, exports: utility.exports, Date });
        return utility.exports;
      }
      throw Error(`Unexpected palette import ${name}`);
    },
  });
  const tree = module.exports.CellColorPalette({ mode, busy, textColor: '#111111', explicitTextColor: '#123456',
    colorChoices, onClose() {},
    onTextColor: (color) => calls.push(['text', color]), onCellColor: (id) => calls.push(['fill', id]),
    onResetCellColor: () => calls.push(['reset-fill']) });
  function nodes(value, into = []) { if (!value || typeof value !== 'object') return into; into.push(value);
    for (const child of [value.props.children].flat(Infinity)) nodes(child, into); return into; }
  return { calls, list: nodes(tree) };
}
test('Reset is the first color option for both palettes and resets only its own color channel', () => {
  for (const mode of ['text', 'cell']) {
    const h = render(mode); const choices = h.list.find((node) => node.props.accessibilityRole === 'radiogroup');
    const first = choices.props.children.flat(Infinity).filter(Boolean)[0];
    assert.equal(first.props.children.props.children, 'Reset');
    assert.equal(first.props.accessibilityLabel, mode === 'text' ? 'Reset text color' : 'Reset cell fill');
    first.props.onPress(); assert.deepEqual(h.calls, mode === 'text' ? [['text', null]] : [['reset-fill']]);
    assert.equal(h.list.some((node) => node.props.children === 'Automatic'), false, 'Reset replaces the redundant Automatic option');
  }
});
test('palette Reset remains disabled while a cell command is pending', () => {
  for (const mode of ['text', 'cell']) {
    const h = render(mode, true); const reset = h.list.find((node) => /^Reset /.test(node.props.accessibilityLabel ?? ''));
    assert.equal(reset.props.disabled, true); assert.equal(reset.props.accessibilityState.disabled, true);
  }
});

test('cell fill offers explicit custom categories while excluding unapproved colors and hidden palette proofs', () => {
  const h = render('cell', false, [
    { id: 'custom_focus', name: 'Focus', color: '#123456', customColor: true },
    { id: 'unapproved', name: 'Unapproved', color: '#123457' },
    { id: 'proof', name: 'Internal proof', color: '#0D7813', paletteOnly: true },
  ]);
  const choices = h.list.filter((node) => node.type === 'Pressable' && node.props.accessibilityRole === 'radio');
  assert.deepEqual(choices.map((node) => node.props.accessibilityLabel), ['Focus, #123456']);
  choices[0].props.onPress(); assert.deepEqual(h.calls, [['fill', 'custom_focus']]);
});
