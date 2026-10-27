const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const mobile = path.resolve(__dirname, '..');
const jsx = (type, props) => ({ type, props: props ?? {} });
const transpile = (text) => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function all(node, result = []) { if (!node || typeof node !== 'object') return result; result.push(node); for (const child of [node.props?.children].flat(Infinity)) all(child, result); return result; }
function text(node) { if (typeof node === 'string' || typeof node === 'number') return String(node); return [node?.props?.children].flat(Infinity).map(text).join(''); }
function style(node) { return Object.assign({}, ...[node?.props?.style].flat(Infinity).filter(Boolean)); }
const native = Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'Switch', 'Modal', 'SafeAreaView'].map((name) => [name, name]));
native.StyleSheet = { create: (value) => value, hairlineWidth: 0.5 }; native.Platform = { OS: 'android' };
const colors = { ink: '#171817', graphite: '#2B2C2A', paper: '#FBFAF7', surface: '#FFFFFF', panel: '#F5F2EC', accent: '#171817', onAccent: '#FFFFFF', hairline: '#DDD9D1', muted: '#6E706C' };
function settingsFixture() {
  let cursor = 0; const slots = []; const effects = []; let tree;
  const changes = []; const modes = []; const clocks = [];
  const react = { useMemo: (work) => work(), useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof value === 'function' ? value() : value }; return [slots[i].value, (next) => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; }, useEffect() {} };
  const module = { exports: {} };
  vm.runInNewContext(transpile(fs.readFileSync(path.join(mobile, 'src/screens/SettingsScreen.tsx'), 'utf8')), { module, exports: module.exports,
    require(name) {
      if (name === 'react') return react; if (name === 'react-native') return native; if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === '../appearance') return { useAppTheme: () => ({ colors, mode: 'dark', setMode: (mode) => modes.push(mode) }) };
      if (name === '../components/InfoButton') return { InfoButton: 'InfoButton' };
      if (name === '../components/ReleaseUpdates') return { ReleaseUpdateSettings: 'ReleaseUpdateSettings' };
      if (name === '../wear/WatchSettings') return { WatchSettings: 'WatchSettings' };
      if (name === '../utils/time') return { dateKey: () => '2026-10-27', formatDayHeading: () => 'Tuesday, October27' };
      if (name === '../services/calendar') return {};
      throw Error(`Unexpected Settings UI import ${name}`);
    } });
  const calendar = (id, title) => ({ id, title, color: '#51B749', allowsModifications: true, sourceName: 'Synthetic calendar' });
  const props = { permissionStatus: 'granted', calendars: [calendar('checked', 'Checked plan'), calendar('other', 'Unchecked plan'), calendar('actuals', 'Unchecked actuals destination')],
    preferences: { selectedCalendarIds: ['checked'], writeCalendarId: 'actuals', syncActuals: true },
    onChange: (value) => changes.push(value), onOpenAccounts() {}, onOpenCategories() {}, onRequestAccess: async () => effects.push('allow'), onRefreshCalendars: async () => effects.push('refresh'),
    clockFormat: '24h', onClockFormatChange: (value) => clocks.push(value), updates: {} };
  function render() { cursor = 0; tree = module.exports.SettingsScreen(props); return all(tree); } render();
  return { props, render, changes, modes, clocks, effects, nodes: () => all(tree), tree: () => tree };
}
test('Settings initially shows only checked calendars, with an accessible state-only dropdown preserving Actuals and read permissions', () => {
  const h = settingsFixture(); const labels = () => h.nodes().filter((node) => node.props.accessibilityRole === 'checkbox').map((node) => node.props.accessibilityLabel);
  assert.deepEqual(labels(), ['Checked plan']); assert.equal(h.changes.length, 0); assert.deepEqual(h.effects, []);
  let toggle = h.nodes().find((node) => node.props.accessibilityLabel === 'Other calendars (2)'); assert.ok(toggle); assert.equal(toggle.props.accessibilityState.expanded, false);
  toggle.props.onPress(); h.render(); assert.deepEqual(labels(), ['Checked plan', 'Unchecked plan', 'Unchecked actuals destination']);
  assert.equal(h.nodes().find((node) => node.props.accessibilityLabel === 'Other calendars (2)').props.accessibilityState.expanded, true);
  assert.equal(h.changes.length, 0, 'expanding cannot select a calendar or change a destination');
  h.nodes().find((node) => node.props.accessibilityLabel === 'Unchecked plan').props.onPress();
  assert.deepEqual([...h.changes[0].selectedCalendarIds], ['checked', 'other']); assert.equal(h.changes[0].writeCalendarId, 'actuals'); assert.equal(h.changes[0].syncActuals, true);
  h.props.preferences = h.changes[0]; h.render(); toggle = h.nodes().find((node) => node.props.accessibilityLabel === 'Other calendars (1)'); toggle.props.onPress(); h.render();
  assert.deepEqual(labels(), ['Checked plan', 'Unchecked plan']); assert.equal(h.props.preferences.writeCalendarId, 'actuals', 'a collapsed unchecked Actuals destination is retained');
});
test('Appearance and clock choices stay highlighted while navigation/status rows stay neutral and headings match', () => {
  const h = settingsFixture(); const list = h.nodes();
  for (const selected of ['Dark', '24-hour']) { const radio = list.find((node) => node.props.accessibilityRole === 'radio' && text(node) === selected);
    assert.equal(radio.props.accessibilityState.checked, true); assert.equal(style(radio).backgroundColor, colors.accent); }
  const accountText = list.find((node) => node.type === 'Text' && text(node) === 'Accounts & synchronization');
  const accountContainer = list.find((node) => node.type === 'View' && all(node).includes(accountText) && style(node).borderRadius === 14);
  assert.equal(style(accountContainer).backgroundColor, colors.surface);
  const permission = list.find((node) => node.type === 'View' && [node.props?.children].flat(Infinity).some((child) => child?.type === 'InfoButton' && child.props.title === 'Calendar access'));
  assert.equal(style(permission).backgroundColor, colors.surface); assert.notEqual(style(permission).backgroundColor, colors.accent);
  const headings = list.filter((node) => node.props.accessibilityRole === 'header'); assert.ok(headings.length >= 5);
  for (const heading of headings) { assert.equal(style(heading).fontSize, 16); assert.equal(style(heading).fontWeight, '600'); assert.equal(style(heading).lineHeight, 22); }
  h.props.permissionStatus = 'denied'; const denied = h.render(); assert.equal(denied.some((node) => node.props.accessibilityRole === 'checkbox'), false); assert.equal(h.changes.length, 0);
});
test('choosing an Actuals destination does not implicitly check the source calendar', () => {
  const h = settingsFixture(); h.nodes().find((node) => node.props.accessibilityLabel === 'Other calendars (2)').props.onPress(); h.render();
  h.nodes().find((node) => node.props.accessibilityLabel === 'Use Unchecked plan for actuals').props.onPress();
  assert.equal(h.changes[0].writeCalendarId, 'other'); assert.deepEqual([...h.changes[0].selectedCalendarIds], ['checked']);
});

test('Watch synchronization and update checks use the same action styling and section heading as Settings', async () => {
  const fixture = settingsFixture(); const check = fixture.nodes().find((node) => node.props.accessibilityLabel === 'Check selected phone calendars');
  const calls = []; const module = { exports: {} }; const hooks = { useMemo: (work) => work(), useEffect() {}, useState: (value) => [typeof value === 'function' ? value() : value, () => {}] };
  vm.runInNewContext(transpile(fs.readFileSync(path.join(mobile, 'src/wear/WatchSettings.tsx'), 'utf8')), { module, exports: module.exports,
    require(name) { if (name === 'react') return hooks; if (name === 'react-native') return native; if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }; if (name === '../appearance') return { useAppTheme: () => ({ colors }) };
      if (name === '../components/InfoButton') return { InfoButton: 'InfoButton' }; if (name === '../utils/time') return {};
      if (name === './service') return { getWearState: () => ({ available: true, enabled: true, running: false, connectedNodeCount: 1, pendingCount: 0, conflicts: [] }),
        drainWearInbox: async () => calls.push('drain'), refreshWearStatus: async () => calls.push('refresh') };
      throw Error(`Unexpected WatchSettings UI import ${name}`); } });
  const watch = all(module.exports.WatchSettings()); const sync = watch.find((node) => node.type === 'Pressable' && text(node) === 'Sync watch now');
  for (const key of ['minHeight', 'paddingHorizontal', 'paddingVertical', 'borderRadius', 'backgroundColor', 'alignSelf']) assert.equal(style(sync)[key], style(check)[key], key);
  const title = watch.find((node) => node.props.accessibilityRole === 'header' && text(node) === 'Paired watch'); assert.equal(style(title).fontSize, 16); assert.equal(style(title).fontWeight, '600');
  sync.props.onPress(); for (let tick = 0; tick < 10; tick++) await Promise.resolve(); assert.deepEqual(calls, ['drain', 'refresh']);
  const source = fs.readFileSync(path.join(mobile, 'src/components/ReleaseUpdates.tsx'), 'utf8'); const parsed = ts.createSourceFile('ReleaseUpdates.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected = parsed.statements.filter((node) => node.name?.text === 'ReleaseUpdateSettings' || node.declarationList?.declarations.some((entry) => entry.name?.text === 'createStyles'));
  const updates = { configured: true, enabled: true, checking: false, loading: false, checkNow: async () => calls.push('updates') }; const exported = { exports: {} };
  vm.runInNewContext(transpile(`${selected.map((node) => node.getText(parsed)).join('\n')}\nexport { ReleaseUpdateSettings };`), { module: exported, exports: exported.exports, useMemo: hooks.useMemo,
    useAppTheme: () => ({ colors }), StyleSheet: native.StyleSheet, ...native, InfoButton: 'InfoButton',
    require: () => ({ jsx, jsxs: jsx }) });
  const updateNodes = all(exported.exports.ReleaseUpdateSettings({ updates })); const update = updateNodes.find((node) => node.type === 'Pressable' && text(node) === 'Check now');
  for (const key of ['minHeight', 'paddingHorizontal', 'paddingVertical', 'borderRadius', 'backgroundColor', 'alignSelf']) assert.equal(style(update)[key], style(check)[key], key);
  assert.equal(style(updateNodes.find((node) => node.props.accessibilityRole === 'header')).fontSize, 16);
  await update.props.onPress(); assert.equal(calls.at(-1), 'updates');
});
