const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const mobile = path.resolve(__dirname, '..');
const jsx = (type, props) => ({ type, props: props ?? {} });
const transpile = (text) => ts.transpileModule(text, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
function nodes(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  result.push(value); for (const child of [value.props?.children].flat(Infinity)) nodes(child, result);
  return result;
}
function textOf(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return [value?.props?.children].flat(Infinity).map((child) => child && typeof child === 'object' ? textOf(child) : child ?? '').join('');
}
const colors = { paper: '#FAFAFA', graphite: '#333333' };
const native = Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'Switch', 'StatusBar', 'AndroidNavigationBar', 'SafeAreaView']
  .map((name) => [name, name]));
const hooks = { useMemo: (work) => work(), useEffect: () => {}, useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}] };
const style = { create: (value) => value, hairlineWidth: 0.5 };

function renderFrame(tab, onReturnToCalendar = () => {}) {
  const file = path.join(mobile, 'App.tsx'); const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ['SCREEN_TITLES', 'createStyles', 'ApplicationFrame'].map((name) => {
    const node = source.statements.find((node) => node.name?.text === name ||
      node.declarationList?.declarations.some((value) => value.name?.text === name));
    assert.ok(node); return node.getText(source);
  });
  const module = { exports: {} };
  vm.runInNewContext(transpile([...declarations, 'export { ApplicationFrame };'].join('\n')), {
    module, exports: module.exports, ...native, ...hooks, StyleSheet: style, Platform: { OS: 'android' },
    useAppTheme: () => ({ colors, resolvedMode: 'light' }),
    require: (name) => { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx, Fragment: 'Fragment' }; },
  });
  return module.exports.ApplicationFrame({ ready: true, tab, onReturnToCalendar, children: 'Screen content' });
}

function renderSettings(permissionStatus = 'granted') {
  const file = path.join(mobile, 'src/screens/SettingsScreen.tsx'); const module = { exports: {} };
  const calls = { accounts: 0, colors: 0, refresh: 0, allow: 0 };
  vm.runInNewContext(transpile(fs.readFileSync(file, 'utf8')), { module, exports: module.exports,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return hooks;
      if (name === 'react-native') return { ...native, StyleSheet: style };
      if (name === '../appearance') return { useAppTheme: () => ({ colors, mode: 'system', setMode: () => {} }) };
      if (name === '../components/InfoButton') return { InfoButton: 'InfoButton' };
      if (name === '../components/ReleaseUpdates') return { ReleaseUpdateSettings: 'ReleaseUpdateSettings' };
      if (name === '../wear/WatchSettings') return { WatchSettings: 'WatchSettings' };
      if (name === '../services/calendar') return {};
      if (name === '../utils/time') return { dateKey: () => '2026-10-27', formatDayHeading: () => 'Tuesday, October 27' };
      throw Error(`Unexpected settings import: ${name}`);
    },
  });
  const tree = module.exports.SettingsScreen({ permissionStatus, calendars: [],
    preferences: { selectedCalendarIds: [], writeCalendarId: null, syncActuals: false },
    onChange: () => {}, clockFormat: '12h', onClockFormatChange: () => {}, updates: {},
    onOpenAccounts: () => calls.accounts++, onOpenCategories: () => calls.colors++,
    onRefreshCalendars: async () => { calls.refresh++; }, onRequestAccess: async () => { calls.allow++; } });
  return { tree, calls, list: nodes(tree) };
}

test('actual Settings frame places a 44-point back arrow before the title and returns to calendar', () => {
  let returned = 0; const tree = renderFrame('settings', () => returned++);
  const list = nodes(tree); const back = list.find((node) => node.props.accessibilityLabel === 'Back to calendar');
  assert.equal(textOf(back), '←'); assert.equal(back.props.style.width, 44); assert.equal(back.props.style.height, 44);
  const header = list.find((node) => node.type === 'View' && node.props.children?.includes(back));
  const children = header.props.children.filter(Boolean);
  assert.equal(children[0], back); assert.equal(children[1].props.accessibilityRole, 'header');
  assert.equal(textOf(children[1]), 'Settings'); assert.equal(textOf(header), '←Settings');
  back.props.onPress(); assert.equal(returned, 1);
});

test('other secondary frame navigation stays available and the Day grid gains no extra header', () => {
  for (const tab of ['reports', 'search', 'accounts', 'categories']) {
    const back = nodes(renderFrame(tab)).find((node) => node.props.accessibilityLabel === 'Back to calendar');
    assert.equal(textOf(back), 'Calendar');
  }
  assert.equal(nodes(renderFrame('today')).some((node) => node.props.accessibilityLabel === 'Back to calendar'), false);
});

test('Settings merges duplicate Privacy info while preserving native and account actions and distinct diagnostics', async () => {
  const h = renderSettings();
  assert.equal(h.list.filter((node) => node.type === 'Text' && textOf(node) === 'Privacy').length, 0);
  const info = h.list.find((node) => node.type === 'InfoButton' && node.props.title === 'Accounts & synchronization');
  assert.match(info.props.message, /encrypted private ledger/); assert.match(info.props.message, /sharing settings/);
  assert.match(info.props.message, /write permission alone/);
  const phoneInfo = h.list.find((node) => node.type === 'InfoButton' && node.props.title === 'Phone calendars');
  assert.match(phoneInfo.props.message, /configured account Actuals destination/);
  for (const [label, counter] of [['Accounts & synchronization', 'accounts'], ['Activity colors', 'colors'], ['Refresh', 'refresh']]) {
    const action = h.list.find((node) => node.type === 'Pressable' && textOf(node) === label);
    assert.ok(action); await action.props.onPress(); assert.equal(h.calls[counter], 1);
  }
  assert.equal(h.list.filter((node) => node.props.accessibilityLabel === 'Check selected phone calendars').length, 1);
  assert.equal(h.list.filter((node) => node.props.accessibilityLabel === 'Write actual activity blocks').length, 1);
  const denied = renderSettings('denied'); const allow = denied.list.find((node) => node.type === 'Pressable' && textOf(node) === 'Allow');
  await allow.props.onPress(); assert.equal(denied.calls.allow, 1);
});
