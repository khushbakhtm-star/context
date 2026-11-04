const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function settingsSync(props) {
  const file = path.join(__dirname, 'calendar-header.test.cjs');
  const source = fs.readFileSync(file, 'utf8'); const module = { exports: {} };
  vm.runInNewContext(source.slice(0, source.indexOf('\ntest(')) + '\nmodule.exports = headerHarness;',
    { module, require, __dirname, console }, { filename: file });
  return module.exports(props, {}, true);
}
const syncButton = (h) => h.nodes().find((node) => node.type === 'Pressable' &&
  /^(Synchronizing calendars|Calendar sync needs attention|Sync attached calendars)/.test(node.props.accessibilityLabel ?? ''));

function icon(active, ink, muted, issue = false) {
  const file = path.join(__dirname, '../src/components/CalendarHeaderIcon.tsx'); const module = { exports: {} };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module, exports: module.exports, require(name) {
    if (name === 'react') return { useMemo: (work) => work() };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { View: 'View', StyleSheet: { create: (styles) => styles, absoluteFill: {} } };
    if (name === '../appearance') return { useAppTheme: () => ({ colors: { ink, muted, graphite: ink, paper: '#F8F7F4' } }) };
    throw Error('Unexpected icon dependency: ' + name);
  } }, { filename: file });
  return module.exports.CalendarHeaderIcon({ name: 'sync', active, issue });
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

test('active, idle and issue sync use static circular loops, muted quiet states and congruent side chevrons', () => {
  for (const [ink, muted] of [['#171817', '#6E706C'], ['#F0EDF2', '#B0ADB7']]) {
    const active = icon(true, ink, muted), idle = icon(false, ink, muted), issue = icon(false, ink, muted, true);
    assert.equal(active.props.accessible, false); assert.equal(active.props.pointerEvents, 'none');
    const closed = nodes(active).find((node) => node.props.testID === 'sync-loop-closed');
    const open = nodes(idle).find((node) => node.props.testID === 'sync-loop-open');
    const closedStyle = flatStyle(closed.props.style), openStyle = flatStyle(open.props.style);
    assert.equal(closedStyle.borderWidth, 1.5); assert.equal(closedStyle.borderColor, ink);
    assert.equal(closedStyle.width, 22); assert.equal(closedStyle.height, 22); assert.equal(closedStyle.borderRadius, 11);
    assert.equal(closedStyle.left, 1); assert.equal(closedStyle.top, 1);
    assert.equal(closedStyle.borderLeftColor, undefined); assert.equal(closedStyle.borderRightColor, undefined);
    assert.equal(openStyle.borderWidth, 1.5); assert.equal(openStyle.borderColor, muted);
    assert.equal(openStyle.borderLeftColor, 'transparent'); assert.equal(openStyle.borderRightColor, 'transparent');
    for (const tree of [active, idle, issue]) {
      const color = tree === active ? ink : muted;
      assert.equal(nodes(tree).filter((node) => flatStyle(node.props.style).width === 4 && flatStyle(node.props.style).height === 1.5).length, 4,
        'all states retain the same pair of side arrowheads');
      assert.ok(nodes(tree).every((node) => node.type === 'View' || node.type === 'Fragment'));
      const left = nodes(tree).filter((node) => node.props.testID === 'sync-left-arrow').map((node) => flatStyle(node.props.style));
      const right = nodes(tree).filter((node) => node.props.testID === 'sync-right-arrow').map((node) => flatStyle(node.props.style));
      assert.equal(left.length, 2); assert.equal(right.length, 2);
      assert.ok([...left, ...right].every((style) => style.backgroundColor === color && style.height === 1.5));
      const leftTip = arrowTip(left), rightTip = arrowTip(right);
      assert.ok(left.every((style) => leftTip.y > style.top + style.height / 2), 'left chevron points down');
      assert.ok(right.every((style) => rightTip.y < style.top + style.height / 2), 'right chevron points up');
      const radius = closedStyle.width / 2 - closedStyle.borderWidth / 2;
      for (const tip of [leftTip, rightTip]) assert.ok(Math.abs(Math.hypot(tip.x - 12, tip.y - 12) - radius) < 1e-9,
        'both arrow tips lie on the actual circle stroke, not inside it');
      assert.ok(Math.abs(leftTip.x + rightTip.x - 24) < 1e-9 && Math.abs(leftTip.y + rightTip.y - 24) < 1e-9,
        'the arrow tips are exactly opposite one another');
      const centers = (arms) => arms.map((arm) => [arm.left + arm.width / 2, arm.top + arm.height / 2]);
      for (const center of centers(left)) assert.ok(centers(right).some((other) =>
        Math.abs(center[0] + other[0] - 24) < 1e-9 && Math.abs(center[1] + other[1] - 24) < 1e-9),
      'arrow arms keep identical clearance and are congruent under a half turn');
    }
  }
});

test('the issue mark is centered inside one muted closed circle and remains entirely decorative even during sync', () => {
  for (const active of [false, true]) {
    const tree = icon(active, '#171817', '#6E706C', true), all = nodes(tree);
    const ring = flatStyle(all.find((node) => node.props.testID === 'sync-loop-closed').props.style);
    assert.equal(ring.borderColor, '#6E706C'); assert.equal(ring.borderLeftColor, undefined); assert.equal(ring.borderRightColor, undefined);
    assert.equal(all.filter((node) => node.props.testID === 'sync-issue-mark').length, 1);
    const mark = flatStyle(all.find((node) => node.props.testID === 'sync-issue-mark').props.style);
    assert.equal(mark.left + mark.width / 2, 12); assert.equal(mark.top + mark.height / 2, 12);
    const stem = flatStyle(all.find((node) => node.props.testID === 'sync-issue-stem').props.style);
    const dot = flatStyle(all.find((node) => node.props.testID === 'sync-issue-dot').props.style);
    assert.equal(stem.width, ring.borderWidth); assert.equal(dot.width, ring.borderWidth); assert.equal(dot.height, ring.borderWidth);
    assert.equal(stem.backgroundColor, '#6E706C'); assert.equal(dot.backgroundColor, '#6E706C');
    assert.equal(tree.props.accessible, false); assert.equal(tree.props.accessibilityElementsHidden, true);
    assert.equal(tree.props.importantForAccessibility, 'no-hide-descendants');
    assert.equal(all.some((node) => node.type === 'Text' || node.props.accessibilityLabel), false);
  }
  for (const active of [false, true]) assert.equal(nodes(icon(active, '#171817', '#6E706C')).some((node) => node.props.testID === 'sync-issue-mark'), false);
});

test('Settings never animates Sync and retains real busy state, retry, error and long-press actions', () => {
  const props = { syncing: false, syncError: null, syncDetails: () => 'Current sync details' };
  const h = settingsSync(props);
  let button = syncButton(h);
  assert.equal(h.nodes(button).find((node) => node.type === 'CalendarHeaderIcon').props.active, false);
  assert.equal(h.nodes(button).find((node) => node.type === 'CalendarHeaderIcon').props.issue, false);
  h.press(button); assert.equal(h.calls.sync, 1);
  props.syncing = true; h.render(); button = syncButton(h);
  assert.equal(button.props.accessibilityLabel, 'Synchronizing calendars');
  assert.equal(h.nodes(button).find((node) => node.type === 'CalendarHeaderIcon').props.active, true);
  assert.equal(h.nodes(button).find((node) => node.type === 'CalendarHeaderIcon').props.issue, false);
  props.syncing = true; props.syncError = 'A saved calendar change needs review'; h.render(); button = syncButton(h);
  assert.equal(button.props.accessibilityState.busy, true);
  assert.equal(button.props.accessibilityLabel, 'Synchronizing calendars');
  assert.equal(h.nodes(button).find((node) => node.type === 'CalendarHeaderIcon').props.active, false);
  assert.equal(h.nodes(button).find((node) => node.type === 'CalendarHeaderIcon').props.issue, true);
  assert.equal(h.nodes().some((node) => node.type === 'ActivityIndicator'), false);
  assert.equal(h.nodes(button).filter((node) => node.type === 'Text' && node.props.children === '!').length, 0, 'there is no duplicate outer badge');
  h.press(button); assert.equal(h.calls.sync, 1, 'busy taps cannot start duplicate work');
  button.props.onPressIn(); button.props.onLongPress(); button.props.onPress();
  assert.equal(h.calls.errors.length, 1); assert.equal(h.calls.sync, 1);
  props.syncing = false; h.render(); button = syncButton(h);
  assert.equal(button.props.accessibilityState.busy, false);
  assert.match(button.props.accessibilityLabel, /needs attention/);
  assert.equal(h.nodes(button).find((node) => node.type === 'CalendarHeaderIcon').props.active, false);
  h.press(button); assert.equal(h.calls.sync, 2);
});
