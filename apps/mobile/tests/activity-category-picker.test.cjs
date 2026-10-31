const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function component(t, initial, services = {}, filename = 'ActivityCategoryPicker.tsx', exportName = 'ActivityCategoryPicker') {
  let hook = 0, dirty = true, tree, props = initial;
  const slots = [], effects = [], modules = new Map();
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useRef(value) { const i = hook++; return slots[i] ??= { current: value }; },
    useState(value) { const i = hook++; slots[i] ??= { value: typeof value === 'function' ? value() : value };
      return [slots[i].value, (next) => { const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useMemo(work, deps) { const i = hook++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: work() }; return slots[i].value; },
    useEffect(work, deps) { const i = hook++; if (!slots[i] || !same(slots[i].deps, deps)) {
      const prior = slots[i]; slots[i] = { deps, cleanup: prior?.cleanup };
      effects.push(() => { prior?.cleanup?.(); slots[i].cleanup = work(); }); } },
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const colors = new Proxy({}, { get: () => '#777777' });
  const native = Object.fromEntries(['View', 'Text', 'TextInput', 'Pressable', 'ScrollView', 'Modal', 'KeyboardAvoidingView'].map((name) => [name, name]));
  Object.assign(native, { Keyboard: { dismiss() {} }, Platform: { OS: 'android' },
    StyleSheet: { create: (value) => value, hairlineWidth: .5 },
    BackHandler: { addEventListener: () => ({ remove() {} }) }, useWindowDimensions: () => ({ width: 390, height: 844 }) });
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const module = { exports: {} }; modules.set(file, module.exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, console, Date, Map, Set, Math, JSON, Object, Error, Number, Promise,
      require(request) {
        if (request === 'react') return react;
        if (request === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
        if (request === 'react-native') return native;
        if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) };
        if (request === '../appearance') return { useAppTheme: () => ({ colors, resolvedMode: 'light' }) };
        if (request === '../services/categories') return services;
        for (const name of ['CellActionIcon', 'CellColorPalette']) if (request === './' + name) return { [name]: name };
        if (!request.startsWith('.')) throw Error('Unexpected component dependency: ' + request);
        return load(path.resolve(path.dirname(file), request) + '.ts');
      } }, { filename: file });
    modules.set(file, module.exports); return module.exports;
  }
  const renderComponent = load(path.join(__dirname, '../src/components', filename))[exportName];
  function render() { hook = 0; dirty = false; tree = renderComponent(props); while (effects.length) effects.shift()(); }
  async function settle() { for (let i = 0; i < 60; i++) { await Promise.resolve(); if (dirty) render(); } }
  function walk(node) { return !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(walk)]; }
  const nodes = () => walk(tree);
  t.after(() => slots.forEach((slot) => slot?.cleanup?.()));
  return { async start() { render(); await settle(); }, settle, nodes,
    action: (label) => nodes().find((node) => node.props?.accessibilityLabel === label)?.props,
    async update(next) { props = { ...props, ...next }; dirty = true; await settle(); } };
}
const choices = [
  { id: 'first', name: 'User-defined first label', color: '#0B8043', provider: 'google', accountId: 'google:person', providerColorId: '10', googleColorVerified: true },
  { id: 'second', name: 'Another existing label', color: '#0B8043' },
  { id: 'third', name: 'A separate color', color: '#3F51B5', provider: 'google', accountId: 'google:person', providerColorId: '9', googleColorVerified: true },
];
const initial = (extra = {}) => ({ visible: true, selectedId: 'second', colorChoices: choices, onClose() {}, onSelect() {}, ...extra });

test('Categorize preserves distinct existing names at one color and selects only the deliberately chosen category ID', async (t) => {
  const selected = []; let closed = 0, created = 0;
  const h = component(t, initial({ onSelect: (id) => selected.push(id), onClose: () => closed++ }),
    { createCategory: () => { created++; throw Error('Must not create while choosing'); } });
  await h.start();
  const heading = h.nodes().find((node) => node.type === 'View' && [node.props.children].flat(Infinity)
    .some((child) => child?.props?.accessibilityRole === 'header' && child.props.children === 'Categorize'));
  assert.ok([heading.props.children].flat(Infinity).some((node) => node?.props?.accessibilityLabel === 'Add category'),
    'Add category stays in the fixed heading beside Close rather than below a long category list');
  assert.equal(h.nodes().filter((node) => node.props.accessibilityLabel === 'Add category').length, 1);
  assert.equal(h.nodes().find((node) => node.type === 'ScrollView').props.keyboardShouldPersistTaps, 'always');
  const radios = h.nodes().filter((node) => node.props.accessibilityRole === 'radio');
  assert.equal(radios.length, 3); assert.equal(h.action('Another existing label, #0B8043').accessibilityState.checked, true);
  assert.ok(h.nodes().some((node) => node.type === 'Text' && node.props.children === choices[0].name));
  assert.ok(h.nodes().some((node) => node.type === 'Text' && node.props.children === choices[1].name));
  assert.deepEqual(selected, []); h.action('User-defined first label, #0B8043').onPress(); await h.settle();
  assert.deepEqual(selected, ['first']); assert.equal(closed, 1); assert.equal(created, 0);
});

test('Add category offers only scoped Google colors, keeps user text, reloads then explicitly applies the new label', async (t) => {
  const calls = [];
  const h = component(t, initial({ onSelect: (id) => calls.push(['select', id]),
    onCategoriesChanged: () => calls.push(['reload']), onClose: () => calls.push(['close']) }),
    { createCategory: async (input) => { calls.push(['create', JSON.parse(JSON.stringify(input))]); return { id: 'custom_saved', ...input }; } });
  await h.start(); h.action('Add category').onPress(); await h.settle();
  assert.equal(h.action('Category name').value, '', 'no example labels are prefilled');
  assert.equal(h.action('Save and use category').disabled, true);
  assert.equal(h.nodes().filter((node) => node.props.accessibilityRole === 'radio').length, 2, 'same-color labels share one creation swatch');
  assert.equal(h.action('Use category color #D50000'), undefined, 'unscoped fallback colors must not be offered');
  assert.equal(h.nodes().filter((node) => node.type === 'TextInput').length, 1, 'there is no arbitrary hexadecimal color input');
  h.action('Category name').onChangeText('  My own category  ');
  h.action('Use category color #3F51B5').onPress(); await h.settle();
  h.action('Save and use category').onPress(); await h.settle();
  assert.deepEqual(calls, [['create', { name: 'My own category', color: '#3F51B5' }], ['reload'], ['select', 'custom_saved'], ['close']]);
});

test('failed creation applies nothing and failed assignment retries the saved category without making duplicates', async (t) => {
  let created = 0, attempts = 0, closed = 0; const selected = [];
  const h = component(t, initial({ onSelect(id) { selected.push(id); if (attempts++ === 0) throw Error('Cells changed; try again'); },
    onClose() { closed++; } }), { createCategory: async () => { created++; if (created === 1) throw Error('Storage unavailable'); return { id: 'custom_saved' }; } });
  await h.start(); h.action('Add category').onPress(); await h.settle();
  h.action('Category name').onChangeText('Kept draft'); await h.settle();
  h.action('Save and use category').onPress(); await h.settle();
  assert.equal(h.action('Category name').value, 'Kept draft'); assert.deepEqual(selected, []); assert.equal(closed, 0);
  assert.ok(h.nodes().some((node) => node.props.accessibilityRole === 'alert' && /Storage unavailable/.test(node.props.children)));
  h.action('Save and use category').onPress(); await h.settle(); assert.equal(created, 2); assert.equal(closed, 0);
  assert.ok(h.nodes().some((node) => node.props.accessibilityRole === 'alert' && /Cells changed/.test(node.props.children)));
  h.action('Save and use category').onPress(); await h.settle();
  assert.equal(created, 2); assert.deepEqual(selected, ['custom_saved', 'custom_saved']); assert.equal(closed, 1);
});

test('picker serializes repeated Save taps and cannot apply an old asynchronous creation to a reopened selection', async (t) => {
  let resolve, calls = 0, closed = 0; const selected = [];
  const h = component(t, initial({ onSelect: (id) => selected.push(id), onClose() { closed++; } }),
    { createCategory: () => { calls++; return new Promise((finish) => { resolve = finish; }); } });
  await h.start(); h.action('Add category').onPress(); await h.settle();
  h.action('Category name').onChangeText('A draft'); await h.settle();
  const save = h.action('Save and use category').onPress; save(); save(); await h.settle();
  assert.equal(calls, 1); assert.equal(h.action('Close categories').disabled, true);
  h.action('Close categories').onPress(); assert.equal(closed, 0);
  await h.update({ visible: false }); await h.update({ visible: true, selectedId: 'first' });
  resolve({ id: 'custom_old' }); await h.settle();
  assert.deepEqual(selected, []); assert.equal(closed, 0); assert.ok(h.action('Add category'));
});

test('empty scoped palette and external busy state cannot create categories or apply a hidden color', async (t) => {
  let calls = 0;
  const h = component(t, initial({ colorChoices: [], busy: true, onSelect() { calls++; } }), { createCategory: () => { calls++; } });
  await h.start(); assert.equal(h.action('Add category').disabled, true);
  await h.update({ busy: false }); h.action('Add category').onPress(); await h.settle();
  h.action('Category name').onChangeText('Waiting for colors'); await h.settle();
  assert.equal(h.action('Save and use category').disabled, true); h.action('Save and use category').onPress(); await h.settle();
  assert.equal(calls, 0); assert.equal(h.nodes().filter((node) => node.props.accessibilityRole === 'radio').length, 0);
  await h.update({ colorChoices: [choices[2]] }); assert.equal(h.action('Save and use category').disabled, false);
});

test('unnamed palette colors display without placeholder text and naming assigns the same stable ID', async (t) => {
  const calls = [];
  const unnamed = { id: 'google_palette_2952a3', name: '#2952A3', color: '#2952A3' };
  const provider = { id: 'provider_palette', name: 'Google event color 10', color: '#0B8043',
    provider: 'google', accountId: 'google:person', providerColorId: '10', googleColorVerified: true,
    providerOriginalName: 'Google event color 10' };
  const h = component(t, initial({ colorChoices: [unnamed, provider], onSelect: (id) => calls.push(['select', id]),
    onCategoriesChanged: () => calls.push(['reload']) }), {
    updateCategory: async (id, input) => { calls.push(['rename', id, JSON.parse(JSON.stringify(input))]); return { ...unnamed, ...input }; },
    createCategory: () => { throw Error('Naming a palette color must not create another identity'); },
  });
  await h.start();
  assert.ok(h.action('Name color #2952A3')); assert.ok(h.action('Name color #0B8043'));
  assert.equal(h.nodes().some((node) => node.type === 'Text' && ['#2952A3', 'Google event color 10'].includes(node.props.children)), false);
  h.action('Name color #2952A3').onPress(); await h.settle();
  assert.equal(h.action('Category name').value, ''); assert.deepEqual(calls, []);
  h.action('Category name').onChangeText('Personal label'); await h.settle();
  h.action('Save and use category').onPress(); await h.settle();
  assert.deepEqual(calls, [['rename', unnamed.id, { name: 'Personal label' }], ['reload'], ['select', unnamed.id]]);
});

test('holding a meaningful label exposes a stable-ID rename and preserves other same-color labels', async (t) => {
  const calls = [];
  const h = component(t, initial({ onSelect: (id) => calls.push(['select', id]) }), {
    updateCategory: async (id, input) => { calls.push(['rename', id, JSON.parse(JSON.stringify(input))]); return { id }; },
  });
  await h.start();
  const action = h.action('Another existing label, #0B8043');
  assert.equal(action.accessibilityActions[0].label, 'Rename category');
  action.onLongPress(); await h.settle(); assert.equal(h.action('Category name').value, 'Another existing label');
  assert.ok(h.nodes().some((node) => node.type === 'Text' && /everywhere it is used/.test(node.props.children)));
  h.action('Category name').onChangeText('A renamed label'); await h.settle();
  h.action('Save and use category').onPress(); await h.settle();
  assert.deepEqual(calls, [['rename', 'second', { name: 'A renamed label' }], ['select', 'second']]);
  await h.update({ visible: false }); await h.update({ visible: true });
  h.action('User-defined first label, #0B8043').onAccessibilityAction({ nativeEvent: { actionName: 'longpress' } }); await h.settle();
  assert.equal(h.action('Category name').value, 'User-defined first label');
});

test('rainbow accepts an explicit custom hex and label with no calendar palette and never saves an invalid color', async (t) => {
  const calls = [];
  const h = component(t, initial({ colorChoices: [], onSelect: (id) => calls.push(['select', id]) }), {
    createCategory: async (input) => { calls.push(['create', JSON.parse(JSON.stringify(input))]); return { id: 'custom_personal' }; },
  });
  await h.start(); h.action('Custom category color').onPress(); await h.settle();
  assert.ok(h.action('Custom category hexadecimal color')); h.action('Category name').onChangeText('My custom label');
  h.action('Custom category hexadecimal color').onChangeText('#123'); await h.settle();
  assert.equal(h.action('Save and use category').disabled, true); h.action('Save and use category').onPress(); await h.settle(); assert.deepEqual(calls, []);
  h.action('Custom category hexadecimal color').onChangeText('#12abef'); await h.settle();
  h.action('Save and use category').onPress(); await h.settle();
  assert.deepEqual(calls, [['create', { name: 'My custom label', color: '#12ABEF', customColor: true }], ['select', 'custom_personal']]);
});

test('the plus form can choose a custom color without losing its label and clearing hex does not refill it', async (t) => {
  const h = component(t, initial()); await h.start(); h.action('Add category').onPress(); await h.settle();
  h.action('Category name').onChangeText('Keep this exact label'); await h.settle();
  h.action('Use custom category color').onPress(); await h.settle();
  assert.equal(h.action('Category name').value, 'Keep this exact label');
  h.action('Custom category hexadecimal color').onChangeText(''); await h.settle();
  assert.equal(h.action('Custom category hexadecimal color').value, ''); assert.equal(h.action('Save and use category').disabled, true);
});

test('custom names and deliberate provider overrides remain visible while only unnamed fallback duplicates condense', async (t) => {
  const h = component(t, initial({ colorChoices: [
    { id: 'google_palette_2952a3', name: '#2952A3', color: '#2952A3' },
    { id: 'native_palette', name: '#2952A3', color: '#2952A3', provider: 'device', calendarId: 'native', providerColorId: '1', googleColorVerified: true },
    { id: 'custom_one', name: '#123456', color: '#123456', customColor: true },
    { id: 'custom_two', name: 'Another custom meaning', color: '#123456', customColor: true },
    { ...choices[0], name: 'User renamed imported color', providerOriginalName: 'Google event color 10' },
    { id: 'sleep', name: 'Sleep', color: '#705770' },
  ] }));
  await h.start();
  assert.equal(h.nodes().filter((node) => node.props.accessibilityLabel === 'Name color #2952A3').length, 1);
  for (const label of ['#123456, #123456', 'Another custom meaning, #123456', 'User renamed imported color, #0B8043', 'Sleep, #705770']) assert.ok(h.action(label), label);
});

test('plus can create a distinct label at an existing custom hex without treating that color as Google-approved', async (t) => {
  const calls = [];
  const h = component(t, initial({ colorChoices: [{ id: 'custom_existing', name: 'Existing meaning', color: '#123456', customColor: true }] }), {
    createCategory: async (input) => { calls.push(JSON.parse(JSON.stringify(input))); return { id: 'custom_distinct' }; },
  });
  await h.start(); h.action('Add category').onPress(); await h.settle();
  h.action('Category name').onChangeText('A different meaning'); await h.settle();
  h.action('Save and use category').onPress(); await h.settle();
  assert.deepEqual(calls, [{ name: 'A different meaning', color: '#123456', customColor: true }]);
});

test('cell popup exposes one accessible Categorize action only when supported and honors its busy guard', async (t) => {
  const calls = [];
  const h = component(t, { busy: false, onCut() {}, onCopy() {}, onClose() {}, onCategorize: () => calls.push('categorize') }, {}, 'CellActionMenu.tsx', 'CellActionMenu');
  await h.start(); const action = h.action('Categorize selected minute cells'); assert.ok(action); action.onPress();
  assert.deepEqual(calls, ['categorize']); assert.equal(action.accessibilityRole, 'button');
  await h.update({ busy: true }); assert.equal(h.action('Categorize selected minute cells').disabled, true);
  h.action('Categorize selected minute cells').onPress(); assert.deepEqual(calls, ['categorize']);
  await h.update({ busy: false, onCategorize: undefined }); assert.equal(h.action('Categorize selected minute cells'), undefined);
});
