const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const harness = fs.readFileSync(path.join(__dirname, 'today-cell-actions.test.cjs'), 'utf8');
const fixture = { exports: {} };
vm.runInNewContext(`${harness.slice(0, harness.indexOf('\nfunction plan('))}\nmodule.exports = screen;`,
  { module: fixture, exports: fixture.exports, require, __dirname, console });
const screen = fixture.exports;

// Run the installed native avoiding component's actual overlap calculation and
// hide/resize callbacks; mock only the platform hosts and keyboard event source.
const expoRequire = createRequire(require.resolve('expo/package.json'));
const babel = expoRequire('@babel/core');
const filename = path.join(path.dirname(require.resolve('react-native/package.json')),
  'Libraries/Components/Keyboard/KeyboardAvoidingView.js');
const code = babel.transformFileSync(filename, { babelrc: false, configFile: false,
  plugins: [expoRequire.resolve('@babel/plugin-transform-flow-strip-types'),
    expoRequire.resolve('@babel/plugin-transform-react-jsx'), expoRequire.resolve('@babel/plugin-transform-modules-commonjs')] }).code;

function nativeAvoider(props, platform) {
  const listeners = new Map();
  class Component { constructor(value) { this.props = value; }
    setState(patch) { this.state = { ...this.state, ...patch }; } }
  const react = { Component, createRef: () => ({ current: null }),
    createElement: (type, value, ...children) => ({ type, props: { ...value, children } }) };
  const loaded = { exports: {} };
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require(name) {
    if (name === 'react') return react;
    if (name.endsWith('/Keyboard')) return { isVisible: () => false,
      addListener: (name, callback) => { listeners.set(name, callback); return { remove: () => listeners.delete(name) }; } };
    if (name.endsWith('/Platform')) return { OS: platform };
    if (name.endsWith('/StyleSheet')) return { compose: (first, second) => [first, second] };
    if (name.endsWith('/LayoutAnimation')) return { configureNext() {}, Types: { keyboard: 'keyboard' } };
    if (name.endsWith('/AccessibilityInfo')) return { prefersCrossFadeTransitions: async () => false };
    if (name.endsWith('/View')) return 'View';
    throw Error(`Unexpected native avoidance dependency ${name}`);
  } }, { filename });
  const view = new loaded.exports.default(props); view.componentDidMount();
  const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
  return {
    async layout(y, height) { await view._onLayout({ persist() {}, nativeEvent: { layout: { x: 0, y, width: 390, height } } }); },
    async show(top) { listeners.get(platform === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow')({ duration: 0,
      easing: 'keyboard', endCoordinates: { screenX: 0, screenY: top, width: 390, height: 844 - top } }); await tick(); },
    async hide() { listeners.get(platform === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide')(); await tick(); },
    get padding() { return view.render().props.style[1]?.paddingBottom ?? 0; },
    dispose() { view.componentWillUnmount(); },
  };
}

test('Android composer follows an overlay keyboard without double avoidance when Android already resizes', async (t) => {
  const h = screen(t); await h.start();
  h.tree.props.onLayout({ nativeEvent: { layout: { width: 390, y: 44 } } });
  h.measureViewport({ rootY: 68 }); await h.settle();
  assert.equal(h.tree.props.behavior, 'padding');
  assert.equal(h.tree.props.keyboardVerticalOffset, 24, 'the header is in layout.y and must not be counted twice');
  const avoidance = nativeAvoider(h.tree.props, 'android'); t.after(() => avoidance.dispose());
  await avoidance.layout(44, 752); await avoidance.show(544);
  assert.equal(68 + 752 - avoidance.padding, 544, 'composer bottom reaches the keyboard top');
  await avoidance.layout(44, 476);
  assert.equal(avoidance.padding, 0, 'native adjustResize already lifted the composer');
  await avoidance.hide(); await avoidance.layout(44, 752);
  assert.equal(avoidance.padding, 0, 'hiding restores the complete grid and composer layout');
});

test('iOS composer accounts for its measured parent origin and restores after keyboard hiding', async (t) => {
  const h = screen(t, { platform: 'ios' }); await h.start();
  h.tree.props.onLayout({ nativeEvent: { layout: { width: 390, y: 44 } } });
  h.measureViewport({ rootY: 103 }); await h.settle();
  assert.equal(h.tree.props.keyboardVerticalOffset, 59);
  const avoidance = nativeAvoider(h.tree.props, 'ios'); t.after(() => avoidance.dispose());
  await avoidance.layout(44, 707); await avoidance.show(510);
  assert.equal(103 + 707 - avoidance.padding, 510, 'no extra home indicator/safe-area offset is added');
  await avoidance.show(460); assert.equal(103 + 707 - avoidance.padding, 460);
  await avoidance.hide(); assert.equal(avoidance.padding, 0);
});

test('keyboard geometry cannot change the editing coordinate, raw text, or native caret selection', async (t) => {
  const h = screen(t); h.rows.set(`${h.day}:600`, { dateKey: h.day, minuteIndex: 600,
    text: 'Coffee with mum', categoryId: 'study', blockId: 'note' });
  await h.start(); await h.tap(600);
  const inputRef = h.input().ref;
  h.input().onFocus(); h.input().onSelectionChange({ nativeEvent: { selection: { start: 7, end: 11 } } });
  h.tree.props.onLayout({ nativeEvent: { layout: { width: 390, y: 44 } } });
  h.measureViewport({ rootY: 68, height: 260 });
  await h.keyboard('keyboardDidShow', { endCoordinates: { screenY: 544, height: 300 } });
  const input = h.input();
  assert.equal(input.ref, inputRef); assert.equal(input.value, 'Coffee with mum');
  assert.equal(input.contextMenuHidden, false); assert.equal(input.scrollEnabled, true);
  assert.equal(input.multiline, true); assert.equal(input.selection, undefined, 'native cursor remains uncontrolled');
  input.onChangeText('Coffee and tea with mum'); await h.settle();
  assert.equal(h.text(600), 'Coffee and tea with mum');
  assert.equal(h.drafts.get(h.day, 600).text, 'Coffee and tea with mum');
  h.measureViewport({ rootY: 68, height: 500 }); await h.keyboard('keyboardDidHide', {});
  assert.equal(h.input().ref, inputRef); assert.equal(h.input().value, 'Coffee and tea with mum');
});

test('a delayed old window measurement cannot replace the latest keyboard parent offset', async (t) => {
  const h = screen(t); await h.start();
  h.tree.props.onLayout({ nativeEvent: { layout: { width: 390, y: 44 } } });
  const old = h.measureViewport({ rootY: 68, defer: true });
  const current = h.measureViewport({ rootY: 103, defer: true });
  current.forEach((callback) => callback()); await h.settle();
  assert.equal(h.tree.props.keyboardVerticalOffset, 59);
  old.forEach((callback) => callback()); await h.settle();
  assert.equal(h.tree.props.keyboardVerticalOffset, 59);
});
