const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function component(t, file, name, initial) {
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
      const previous = slots[i]; slots[i] = { deps, cleanup: previous?.cleanup };
      effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = work(); }); } },
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const colors = new Proxy({}, { get: () => '#777777' });
  const native = Object.fromEntries(['View', 'Text', 'TextInput', 'Pressable', 'ScrollView', 'Modal', 'KeyboardAvoidingView', 'Switch'].map((name) => [name, name]));
  Object.assign(native, { Platform: { OS: 'android' }, StyleSheet: { create: (value) => value, hairlineWidth: 0.5, absoluteFill: {} },
    Keyboard: { dismiss() {} }, BackHandler: { addEventListener: () => ({ remove() {} }) }, useWindowDimensions: () => ({ width: 390, height: 844 }) });
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const module = { exports: {} }; modules.set(filename, module.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, console, Date, Intl, Map, Set, Math, JSON, Object, Error, Number, Promise,
      require(request) {
        if (request === 'react') return react;
        if (request === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        if (request === 'react-native') return native;
        if (request === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) };
        if (request === '../appearance') return { useAppTheme: () => ({ colors }) };
        for (const stub of ['InfoButton', 'DateSelectionPopup', 'CellColorPalette', 'CellActionIcon']) if (request === './' + stub) return { [stub]: stub };
        if (!request.startsWith('.')) throw Error('Unexpected component dependency: ' + request);
        const resolved = path.resolve(path.dirname(filename), request);
        return load(fs.existsSync(resolved + '.ts') ? resolved + '.ts' : resolved + '.tsx');
      } }, { filename });
    modules.set(filename, module.exports); return module.exports;
  }
  const renderComponent = load(path.join(__dirname, '../src/components', file))[name];
  function render() { hook = 0; dirty = false; tree = renderComponent(props); while (effects.length) effects.shift()(); }
  async function settle() { for (let i = 0; i < 50; i++) { await Promise.resolve(); if (dirty) render(); } }
  const visit = (node, predicate) => {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const found = visit(child, predicate); if (found) return found; }
    return null;
  };
  t.after(() => slots.forEach((slot) => slot?.cleanup?.()));
  return { async start() { render(); await settle(); }, settle,
    action: (label) => visit(tree, (node) => node.props?.accessibilityLabel === label)?.props,
    find: (type) => visit(tree, (node) => node.type === type)?.props,
    async update(next) { props = { ...props, ...next }; dirty = true; await settle(); },
    get tree() { return tree; } };
}

const session = (id = 1) => ({ id, span: { startDateKey: '2026-10-28', startMinute: 1350, endDateKey: '2026-10-28', endMinute: 1351 },
  text: '', categoryId: 'rest' });

test('pencil form explicitly fills overnight text and optionally creates one separately titled event', async (t) => {
  const calls = []; let closes = 0;
  const h = component(t, 'MinuteSpanEditor.tsx', 'MinuteSpanEditor', { session: session(), clockFormat: '12h', colorChoices: [{ id: 'rest', color: '#0B8043', name: 'Basil' }],
    onClose() { closes++; }, onSave: async (span, input) => { calls.push({ span, input }); return true; } });
  await h.start(); h.action('Text for selected minutes').onChangeText('Rest'); h.action('End time').onChangeText('7:00 AM'); await h.settle();
  h.action('Group as event').onValueChange(true); await h.settle();
  assert.equal(h.action('Event title').value, 'Rest'); assert.equal(h.action('Save minute range').disabled, false);
  h.action('Save minute range').onPress(); await h.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ span: { startDateKey: '2026-10-28', startMinute: 1350, endDateKey: '2026-10-29', endMinute: 421 },
    input: { text: 'Rest', event: { title: 'Rest', categoryId: 'rest' } } }]);
  assert.equal(closes, 1);
});

test('blank mixed-note text preserves notes and an existing border cannot be misleadingly toggled off', async (t) => {
  let input;
  const h = component(t, 'MinuteSpanEditor.tsx', 'MinuteSpanEditor', { session: { ...session(), text: undefined,
    event: { title: 'Named activity', categoryId: 'rest', blockId: 'activity_existing' } }, clockFormat: '24h', colorChoices: [], onClose() {},
    onSave: async (_span, value) => { input = value; return true; } });
  await h.start(); assert.equal(h.action('Text for selected minutes').placeholder, 'Mixed notes');
  assert.equal(h.action('Group as event').disabled, true);
  h.action('Save minute range').onPress(); await h.settle();
  assert.equal(Object.hasOwn(input, 'text'), false);
  assert.equal(input.event.blockId, 'activity_existing'); assert.equal(input.event.title, 'Named activity');
});

test('existing event form displays its last included minute and extends Gaming through the new final cell', async (t) => {
  const calls = [];
  const h = component(t, 'MinuteSpanEditor.tsx', 'MinuteSpanEditor', {
    session: { ...session(), span: { startDateKey: '2026-10-28', startMinute: 1200, endDateKey: '2026-10-28', endMinute: 1257 }, text: 'Game',
      event: { title: 'Gaming', categoryId: 'rest', blockId: 'activity_game' } },
    clockFormat: '24h', colorChoices: [], onClose() {}, onSave: async (span, input) => { calls.push({ span, input }); return false; },
  });
  await h.start(); assert.equal(h.action('Start time').value, '20:00'); assert.equal(h.action('End time').value, '20:56');
  h.action('Save minute range').onPress(); await h.settle();
  assert.equal(calls[0].span.endMinute, 1257, 'opening and saving preserves the existing calendar endpoint');
  h.action('End time').onChangeText('20:57'); await h.settle(); h.action('Save minute range').onPress(); await h.settle();
  assert.equal(calls[1].span.endMinute, 1258, 'the complete 20:57 cell is included');
  assert.equal(calls[1].input.event.blockId, 'activity_game');
});

test('an existing border ending at midnight displays the prior day final cell and round-trips unchanged', async (t) => {
  let saved;
  const span = { startDateKey: '2026-10-28', startMinute: 1350, endDateKey: '2026-10-29', endMinute: 0 };
  const h = component(t, 'MinuteSpanEditor.tsx', 'MinuteSpanEditor', { session: { ...session(), span,
    event: { title: 'Sleep', categoryId: 'rest', blockId: 'activity_sleep' } }, clockFormat: '24h', colorChoices: [], onClose() {},
    onSave: async (value) => { saved = value; return true; } });
  await h.start(); assert.equal(h.action('End time').value, '23:59');
  h.action('Save minute range').onPress(); await h.settle(); assert.deepEqual(JSON.parse(JSON.stringify(saved)), span);
});

test('explicitly emptying pencil Text is a deliberate text clear rather than mixed-note preservation', async (t) => {
  let saved;
  const h = component(t, 'MinuteSpanEditor.tsx', 'MinuteSpanEditor', { session: { ...session(), text: 'Existing note' },
    clockFormat: '24h', colorChoices: [], onClose() {}, onSave: async (_span, input) => { saved = input; return true; } });
  await h.start(); h.action('Text for selected minutes').onChangeText(''); await h.settle(); h.action('Save minute range').onPress(); await h.settle();
  assert.equal(saved.text, ''); assert.equal(Object.hasOwn(saved, 'event'), false);
});

test('an open pencil draft survives source refresh and a stale completed Save cannot close a new form', async (t) => {
  let finish, calls = 0, closes = 0;
  const h = component(t, 'MinuteSpanEditor.tsx', 'MinuteSpanEditor', { session: session(), clockFormat: '24h', colorChoices: [], onClose() { closes++; },
    onSave: async () => { calls++; return new Promise((resolve) => { finish = resolve; }); } });
  await h.start(); h.action('Text for selected minutes').onChangeText('Local draft'); await h.settle();
  await h.update({ session: { ...session(), text: 'Provider refresh' } });
  assert.equal(h.action('Text for selected minutes').value, 'Local draft');
  const firstSave = h.action('Save minute range').onPress; firstSave(); firstSave(); await h.settle(); assert.equal(calls, 1);
  await h.update({ session: { ...session(2), text: 'New form' } }); finish(true); await h.settle();
  assert.equal(closes, 0); assert.equal(h.action('Text for selected minutes').value, 'New form');
});

test('icon-only held menu keeps named one-tap actions, relevant options and busy guards', async (t) => {
  const calls = []; const h = component(t, 'CellActionMenu.tsx', 'CellActionMenu', { busy: false,
    onCut: () => calls.push('cut'), onCopy: () => calls.push('copy'), onPaste: () => calls.push('paste'),
    onReset: () => calls.push('reset'), onGroup: () => calls.push('group'), onEdit: () => calls.push('edit'), onClose() {} });
  await h.start(); h.find('ScrollView').onContentSizeChange(320); await h.settle();
  for (const [name, label] of [['cut', 'Cut'], ['copy', 'Copy'], ['paste', 'Paste into'], ['reset', 'Reset'], ['group', 'Group']]) {
    const full = label === 'Paste into' ? 'Paste into selected minute cells' : `${label} selected minute cells`;
    const button = h.action(full); assert.ok(button); assert.equal(Boolean(button.disabled), false); button.onPress(); assert.equal(calls.at(-1), name);
  }
  h.action('Edit selected minutes and time range').onPress(); assert.equal(calls.at(-1), 'edit');
  assert.equal(h.action('Clear selected minute cells'), undefined, 'Reset is the sole cell-erasure action');
  assert.equal(h.find('Text'), undefined, 'action captions are not rendered');
  assert.equal(h.action('Bold'), undefined, 'formatting remains in the existing bottom bar');
  await h.update({ busy: true }); assert.equal(h.action('Copy selected minute cells').disabled, true);
});

test('compact overview selects continuous minute coordinates and rejects scroll, pinch and stale geometry releases', async (t) => {
  const selected = [], held = [], day = '2026-10-28';
  const props = { scrollRef: { current: null }, days: [day], labels: new Map([[day, 'Selected day']]), bands: new Map(),
    rowHeight: 0.5, railWidth: 44, dayWidth: 346, colors: {}, current: { day, minute: 600 }, disabled: false, scrolling: true,
    timeLabel: String, onSelect: (...args) => selected.push(args), onHold: (...args) => held.push(args), onScroll() {}, onBegin() {}, onEnd() {}, onLayout() {}, onContentSizeChange() {} };
  const h = component(t, 'CompactMinuteOverview.tsx', 'CompactMinuteOverview', props); await h.start();
  const event = (minute, touches = 1, delta = 0) => ({ nativeEvent: { locationY: (minute + 0.25) * 0.5, pageX: 100 + delta, pageY: 200,
    touches: Array.from({ length: touches }, () => ({ pageX: 100 + delta, pageY: 200 })) } });
  const cell = () => h.action('Selected day, compact minute overview');
  cell().onTouchStart(event(621)); cell().onPress(); assert.deepEqual(selected, [[day, 621]]);
  cell().onTouchStart(event(800)); cell().onTouchMove(event(800, 1, 12)); cell().onPress(); assert.equal(selected.length, 1);
  cell().onTouchStart(event(800, 2)); cell().onPress(); assert.equal(selected.length, 1);
  cell().onTouchStart(event(800)); await h.update({ rowHeight: 0.6 }); cell().onPress(); assert.equal(selected.length, 1);
  await h.update({ rowHeight: 0.5 }); cell().onTouchStart(event(1439)); cell().onLongPress(); cell().onPress();
  assert.deepEqual(held, [[day, 1439]]); assert.equal(selected.length, 1);
  cell().onTouchStart(event(700)); await h.update({ disabled: true }); await h.update({ disabled: false }); cell().onPress(); assert.equal(selected.length, 1);
});
