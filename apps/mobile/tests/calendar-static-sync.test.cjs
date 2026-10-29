const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function header(props) {
  const file = path.join(__dirname, 'calendar-header.test.cjs');
  const source = fs.readFileSync(file, 'utf8'); const module = { exports: {} };
  vm.runInNewContext(source.slice(0, source.indexOf('\ntest(')) + '\nmodule.exports = headerHarness;',
    { module, require, __dirname, console }, { filename: file });
  return module.exports(props);
}
const syncButton = (h) => h.nodes().find((node) => node.type === 'Pressable' &&
  /^(Synchronizing calendars|Calendar sync needs attention|Sync attached calendars)/.test(node.props.accessibilityLabel ?? ''));

function icon(active, graphite) {
  const file = path.join(__dirname, '../src/components/CalendarHeaderIcon.tsx'); const module = { exports: {} };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module, exports: module.exports, require(name) {
    if (name === 'react') return { useMemo: (work) => work() };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { View: 'View', StyleSheet: { create: (styles) => styles, absoluteFill: {} } };
    if (name === '../appearance') return { useAppTheme: () => ({ colors: { graphite, paper: '#F8F7F4' } }) };
    throw Error('Unexpected icon dependency: ' + name);
  } }, { filename: file });
  return module.exports.CalendarHeaderIcon({ name: 'sync', active });
}
function nodes(tree) {
  return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
const flatStyle = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
function arrowTip(arms) {
  const endpoints = arms.map((style) => {
    const angle = parseFloat(style.transform[0].rotate) * Math.PI / 180;
    const x = style.left + style.width / 2, y = style.top + style.height / 2;
    return [-1, 1].map((sign) => [x + sign * style.width / 2 * Math.cos(angle), y + sign * style.width / 2 * Math.sin(angle)]);
  });
  const pairs = endpoints[0].flatMap((first) => endpoints[1].map((second) => ({
    distance: Math.hypot(first[0] - second[0], first[1] - second[1]),
    x: (first[0] + second[0]) / 2, y: (first[1] + second[1]) / 2,
  }))).sort((a, b) => a.distance - b.distance);
  assert.ok(pairs[0].distance < 0.5, 'the arrow arms must join at one tip');
  return pairs[0];
}

test('active and idle sync use distinct static grayscale loops with the lighter undo/redo stroke weight', () => {
  for (const graphite of ['#333333', '#E3E1DD']) {
    const active = icon(true, graphite), idle = icon(false, graphite);
    assert.equal(active.props.accessible, false); assert.equal(active.props.pointerEvents, 'none');
    const closed = nodes(active).find((node) => node.props.testID === 'sync-loop-closed');
    const open = nodes(idle).find((node) => node.props.testID === 'sync-loop-open');
    const closedStyle = flatStyle(closed.props.style), openStyle = flatStyle(open.props.style);
    assert.equal(closedStyle.borderWidth, 1.5); assert.equal(closedStyle.borderColor, graphite);
    assert.ok(closedStyle.width > closedStyle.height, 'the loop is a horizontally oriented oval');
    assert.equal(closedStyle.borderLeftColor, undefined); assert.equal(closedStyle.borderRightColor, undefined);
    assert.equal(openStyle.borderWidth, 1.5); assert.equal(openStyle.borderColor, graphite);
    assert.equal(openStyle.borderLeftColor, 'transparent'); assert.equal(openStyle.borderRightColor, 'transparent');
    for (const tree of [active, idle]) {
      assert.equal(nodes(tree).filter((node) => flatStyle(node.props.style).width === 6 && flatStyle(node.props.style).height === 1.5).length, 4,
        'both loop states retain the same pair of arrowheads');
      assert.ok(nodes(tree).every((node) => node.type === 'View' || node.type === 'Fragment'));
      const upper = nodes(tree).filter((node) => node.props.testID === 'sync-top-arrow').map((node) => flatStyle(node.props.style));
      const lower = nodes(tree).filter((node) => node.props.testID === 'sync-bottom-arrow').map((node) => flatStyle(node.props.style));
      assert.equal(upper.length, 2); assert.equal(lower.length, 2);
      const topTip = arrowTip(upper), bottomTip = arrowTip(lower);
      assert.ok(upper.every((style) => topTip.x < style.left + style.width / 2), 'top arrow points left');
      assert.ok(lower.every((style) => bottomTip.x > style.left + style.width / 2), 'bottom arrow points right');
      assert.ok(Math.abs(topTip.x - 9) < 0.5 && Math.abs(topTip.y - 5) < 0.5, 'top arrow sits on the upper horizontal run');
      assert.ok(Math.abs(bottomTip.x - 15) < 0.5 && Math.abs(bottomTip.y - 19) < 0.5, 'bottom arrow sits on the lower horizontal run');
    }
  }
});

test('the header never animates Sync and retains real busy state, retry, error and long-press actions', () => {
  const props = { syncing: false, syncError: null, syncDetails: () => 'Current sync details' };
  const h = header(props);
  let button = syncButton(h);
  assert.equal(h.nodes(button).find((node) => node.type === 'CalendarHeaderIcon').props.active, false);
  h.press(button); assert.equal(h.calls.sync, 1);
  props.syncing = true; props.syncError = 'A saved calendar change needs review'; h.render(); button = syncButton(h);
  assert.equal(button.props.accessibilityState.busy, true);
  assert.equal(button.props.accessibilityLabel, 'Synchronizing calendars');
  assert.equal(h.nodes(button).find((node) => node.type === 'CalendarHeaderIcon').props.active, true);
  assert.equal(h.nodes().some((node) => node.type === 'ActivityIndicator'), false);
  assert.equal(h.nodes(button).filter((node) => node.type === 'Text' && node.props.children === '!').length, 1);
  h.press(button); assert.equal(h.calls.sync, 1, 'busy taps cannot start duplicate work');
  button.props.onPressIn(); button.props.onLongPress(); button.props.onPress();
  assert.equal(h.calls.errors.length, 1); assert.equal(h.calls.sync, 1);
  props.syncing = false; h.render(); button = syncButton(h);
  assert.equal(button.props.accessibilityState.busy, false);
  assert.match(button.props.accessibilityLabel, /needs attention/);
  assert.equal(h.nodes(button).find((node) => node.type === 'CalendarHeaderIcon').props.active, false);
  h.press(button); assert.equal(h.calls.sync, 2);
});
