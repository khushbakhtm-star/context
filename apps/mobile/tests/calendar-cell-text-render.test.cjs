const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Run the actual component and its native animated graph. Text layout callbacks
// deliberately arrive later than row layout, as they do on a real phone.
function componentModule() {
  let active;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    memo: (render) => render,
    useRef(value) { const i = active.hook++; return active.slots[i] ??= { current: value }; },
    useState(value) { const state = active, i = state.hook++;
      state.slots[i] ??= { value: typeof value === 'function' ? value() : value };
      return [state.slots[i].value, (next) => {
        const value = typeof next === 'function' ? next(state.slots[i].value) : next;
        if (!Object.is(value, state.slots[i].value)) { state.slots[i].value = value; state.dirty = true; }
      }]; },
    useMemo(work, deps) { const i = active.hook++;
      if (!active.slots[i] || !same(active.slots[i].deps, deps)) active.slots[i] = { deps, value: work() };
      return active.slots[i].value; },
    useEffect(work, deps) { const i = active.hook++;
      if (!active.slots[i] || !same(active.slots[i].deps, deps)) { active.slots[i] = { deps }; active.effects.push(work); } },
  };
  const number = (value) => typeof value === 'number' ? value : value.value;
  class Node {
    constructor(read) { this.read = read; }
    get value() { return this.read(); }
    interpolate({ inputRange, outputRange }) {
      assert.ok(inputRange.every((value, index) => Number.isFinite(value) && (index === 0 || value >= inputRange[index - 1])),
        'native interpolation knots must remain finite and ordered at every supported font scale');
      return new Node(() => {
      const value = Math.max(inputRange[0], Math.min(inputRange.at(-1), this.value));
      let index = 0;
      while (index < inputRange.length - 2 && value > inputRange[index + 1]) index++;
      const fraction = (value - inputRange[index]) / (inputRange[index + 1] - inputRange[index]);
      return outputRange[index] + fraction * (outputRange[index + 1] - outputRange[index]);
    }); }
  }
  class Value extends Node {
    constructor(value) { let current = value; super(() => current); this.setValue = (next) => { current = next; }; }
  }
  const native = { View: 'View', Text: 'Text', StyleSheet: { absoluteFill: {}, hairlineWidth: 0.5 }, Animated: { View: 'AnimatedView',
    multiply: (a, b) => new Node(() => number(a) * number(b)),
    divide: (a, b) => new Node(() => number(a) / number(b)),
    subtract: (a, b) => new Node(() => number(a) - number(b)),
  } };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText, { module, exports: module.exports, require(name) {
      if (name === 'react') return react;
      if (name === 'react-native') return native;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name.startsWith('.')) { const base = path.resolve(path.dirname(filename), name);
        return load(fs.existsSync(base + '.ts') ? base + '.ts' : base + '.tsx'); }
      throw Error('Unexpected text component dependency: ' + name);
    } }, { filename });
    modules.set(filename, module.exports); return module.exports;
  }
  const Cell = load(path.join(__dirname, '../src/components/CalendarCellText.tsx')).CalendarCellText;
  function mount(input = {}, Render = Cell) {
    const state = { hook: 0, slots: [], effects: [], dirty: true, renders: 0, tree: null };
    const props = { text: 'One complete note', width: 200, height: 34, rowHeight: 34, color: '#222222', ...input };
    function render() {
      let iterations = 0;
      do {
        assert.ok(iterations++ < 10, 'measurement must settle without a render loop');
        active = state; state.hook = 0; state.dirty = false; state.renders++; state.tree = Render(props);
        const effects = state.effects.splice(0); effects.forEach((effect) => effect());
      } while (state.dirty);
    }
    render();
    return { props, update(next) { Object.assign(props, next); render(); },
      measure(lines) { this.text().onTextLayout({ nativeEvent: { lines } }); render(); },
      text: () => state.tree?.props.children.props.children.props,
      style: () => state.tree?.props.children.props.style,
      tree: () => state.tree, renders: () => state.renders,
    };
  }
  return { mount, Value, divide: native.Animated.divide, number,
    mountPreview: (input) => mount(input, load(path.join(__dirname, '../src/components/CalendarPinchPreview.tsx')).CalendarPinchPreview) };
}

test('whole wrapped notes wait for native measurement, fit without ellipsis, and return to normal size when room permits', () => {
  const { mount } = componentModule(); let ready = 0;
  const h = mount({ text: 'A full first line\nAnd a full second line', onReady: () => ready++ });
  assert.equal(ready, 0); assert.equal(h.style().opacity, 0);
  assert.equal(h.text().numberOfLines, undefined); assert.equal(h.text().ellipsizeMode, undefined);
  assert.equal(h.text().allowFontScaling, false); assert.equal(h.text().style.width, 200);
  h.measure([{ y: 0, height: 21 }, { y: 21, height: 21 }]);
  assert.equal(ready, 1); assert.equal(h.style().opacity, 1);
  const [, x, y] = h.style().transform;
  assert.equal(x.scaleX, y.scaleY); assert.ok(42 * y.scaleY + 4 <= 34 + 1e-9);
  h.update({ height: 85, rowHeight: 85 });
  assert.equal(h.text().style.fontSize, 16); assert.equal(h.style().transform[1].scaleX, 1);
  assert.equal(h.style().transform[2].scaleY, 1); assert.equal(h.text().children, h.props.text);
});

test('a late measurement for an old paragraph cannot reveal or acknowledge a changed note or width', () => {
  const { mount } = componentModule(); let oldReady = 0, latestReady = 0;
  const h = mount({ text: 'Old note', onReady: () => oldReady++ });
  const stale = h.text().onTextLayout;
  h.update({ text: 'New complete words', width: 90, bold: true, italic: true, underline: true, onReady: () => latestReady++ });
  stale({ nativeEvent: { lines: [{ y: 0, height: 21 }] } });
  assert.equal(h.style().opacity, 0); assert.equal(oldReady, 0); assert.equal(latestReady, 0);
  h.measure([{ y: 0, height: 21 }, { y: 21, height: 21 }]);
  assert.equal(latestReady, 1); assert.equal(h.text().children, 'New complete words');
  assert.equal(h.text().style.fontWeight, '700'); assert.equal(h.text().style.fontStyle, 'italic');
  assert.equal(h.text().style.textDecorationLine, 'underline');
});

test('cached complete measurements acknowledge a new visible host without waiting for another native layout', () => {
  const { mount } = componentModule();
  const first = mount({ text: 'Cached two-line paragraph' });
  first.measure([{ y: 0, height: 21 }, { y: 21, height: 21 }]);
  let ready = 0;
  const second = mount({ text: 'Cached two-line paragraph', height: 85, rowHeight: 85, onReady: () => ready++ });
  assert.equal(ready, 1); assert.equal(second.style().opacity, 1);
  assert.equal(second.style().transform[1].scaleX, 1);
});

test('compact-to-normal pinch reveals complete text through one native graph with fixed insets and no React renders per move', () => {
  const { mount, Value, divide, number } = componentModule(); const progress = new Value(1);
  const h = mount({ text: 'A measured wrapped paragraph', width: 200, rowHeight: 0.35, height: 0.35,
    scaleY: progress, inverseScaleY: divide(1, progress) });
  assert.ok(h.text(), 'the tiny base cell still mounts its measuring text');
  h.measure([{ y: 0, height: 21 }, { y: 21, height: 21 }]);
  const renders = h.renders();
  for (const row of [0.35, 4, 9, 16, 34, 68, 85]) {
    const ratio = row / 0.35; progress.setValue(ratio);
    const style = h.style(); const [inset, x, y] = style.transform;
    assert.ok(Math.abs(number(x.scaleX) - number(y.scaleY) * ratio) < 1e-8, 'font aspect ratio stays unchanged after the parent scale');
    assert.ok(Math.abs(number(inset.translateY) * ratio - 2) < 1e-8, 'padding is two screen pixels rather than two scaled base pixels');
    const drawn = 42 * number(y.scaleY) * ratio;
    assert.ok(drawn <= Math.max(0, row - 4) + 1e-8, 'the complete paragraph fits the target cell');
    if (row <= 9) assert.equal(number(style.opacity), 0);
    if (row >= 68) { assert.equal(number(style.opacity), 1); assert.equal(number(x.scaleX), 1); }
  }
  assert.equal(h.renders(), renders, 'all gesture updates stay in the native animated graph');
});

test('intentionally unreadable rows acknowledge handoff without showing clipped text, while invalid native measurements stay hidden', () => {
  const { mount } = componentModule(); let ready = 0;
  const hidden = mount({ rowHeight: 4, height: 4, onReady: () => ready++ });
  assert.equal(ready, 1); assert.equal(hidden.style().opacity, 0);
  const pending = mount({ text: 'Still waiting for complete layout', onReady: () => ready++ });
  pending.measure([{ y: 0, height: NaN }]);
  assert.equal(ready, 1); assert.equal(pending.style().opacity, 0);
  pending.measure([{ y: 0, height: 21 }]); assert.equal(ready, 2); assert.equal(pending.style().opacity, 1);
});

test('cell notes honor smaller system text and retain the existing large-text cap without accepting invalid scales', () => {
  const { mount } = componentModule();
  for (const [fontScale, expected] of [[0.5, 0.5], [0.85, 0.85], [1, 1], [2, 1.4], [0, 1], [-1, 1], [NaN, 1]]) {
    const h = mount({ fontScale });
    assert.equal(h.text().style.fontSize, 16 * expected);
    assert.equal(h.text().style.lineHeight, 21 * expected);
    assert.equal(h.text().allowFontScaling, false, 'native scaling is applied once, before whole-paragraph fitting');
  }
});

test('a very small system title font constructs a valid native fade graph instead of failing during pinch', () => {
  const { mount, Value, divide, number } = componentModule();
  const scale = new Value(1);
  const h = mount({ text: 'Small title', fontScale: 0.5, fontSize: 11, lineHeight: 14, rowHeight: 34, height: 34,
    scaleY: scale, inverseScaleY: divide(1, scale) });
  h.measure([{ y: 0, height: 7 }]);
  for (const ratio of [0.1, 1, 2.5]) {
    scale.setValue(ratio);
    assert.equal(number(h.style().opacity), 0, 'a sub-six-pixel font remains safely faded without unordered interpolation knots');
    assert.ok(Number.isFinite(number(h.style().transform[1].scaleX)));
  }
});

test('a wide unbreakable glyph fits horizontally in a narrow Week cell in committed and native pinch text', () => {
  const { mount, Value, divide, number } = componentModule();
  const scale = new Value(1), props = { text: '👨‍👩‍👧‍👦', width: 19, height: 34, rowHeight: 34 };
  const plain = mount(props), preview = mount({ ...props, scaleY: scale, inverseScaleY: divide(1, scale) });
  plain.measure([{ y: 0, height: 21, width: 22.01 }]);
  preview.measure([{ y: 0, height: 21, width: 22.01 }]);
  const measuredWidth = Math.ceil(22.01 * 64) / 64;
  assert.ok(measuredWidth * plain.style().transform[1].scaleX <= 19, 'a single wide emoji cannot be clipped at the right cell edge');
  for (const ratio of [0.3, 0.5, 1, 2.5]) {
    scale.setValue(ratio);
    const uniform = number(preview.style().transform[1].scaleX);
    assert.ok(measuredWidth * uniform <= 19 + 1e-8);
    assert.ok(Math.abs(number(preview.style().transform[2].scaleY) * ratio - uniform) < 1e-8);
  }
  scale.setValue(1);
  assert.equal(number(preview.style().transform[1].scaleX), plain.style().transform[1].scaleX);
});

test('a prewarmed week pinch preserves readable grouped minute notes in a bounded layer instead of substituting or duplicating band titles', () => {
  const { mountPreview, Value } = componentModule();
  const days = Array.from({ length: 7 }, (_, index) => `2026-10-${25 + index}`);
  const bands = new Map(days.map((day) => [day, [{ startMinute: 0, endMinute: 1440,
    groupId: 'same-group', text: 'Obsolete coalesced band note', color: '#0B8043' }]]));
  const annotations = new Map(days.map((day) => [day, Array.from({ length: 1440 }, (_, minute) => ({
    minute, text: `${day} precise note ${minute}`, color: '#123456', titleColor: '#FFFFFF',
    bold: minute === 600, italic: minute === 600, underline: minute === 600,
    ...(minute === 600 ? { title: 'Independent event title' } : {}),
  }))]));
  const h = mountPreview({ active: false, days, bands, outlines: new Map(), annotations,
    rowHeight: 34, railWidth: 88, dayWidth: 44, colors: { ink: '#FFFFFF', currentTime: '#C4B8E7' },
    scaleY: new Value(1), anchor: { minute: 600, viewportY: 250, day: 0, viewportX: 110 },
    viewportHeight: 500, timeLabel: (minute) => String(minute), current: { day: days[0], minute: 600 },
    backgroundColor: '#000000', gridLineColor: '#3A393D' });
  const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  const labels = () => nodes(h.tree()).filter((node) => typeof node.type === 'function' && typeof node.props.text === 'string');
  const before = labels();
  assert.ok(before.length < 1000, 'a dense 10,080-note week does not mount all its minute labels for a pinch');
  for (const day of days) for (let minute = 593; minute <= 607; minute++)
    assert.equal(before.filter((node) => node.props.text === `${day} precise note ${minute}`).length, 1);
  assert.equal(before.filter((node) => node.props.text === 'Independent event title').length, 7);
  assert.equal(before.some((node) => node.props.text === 'Obsolete coalesced band note'), false);
  const note = before.find((node) => node.props.text === `${days[0]} precise note 600`).props;
  const title = before.find((node) => node.props.text === 'Independent event title').props;
  assert.equal(note.bold, true); assert.equal(note.italic, true); assert.equal(note.underline, true);
  assert.equal(note.color, '#123456'); assert.equal(title.color, '#FFFFFF');
  assert.ok(note.width + title.width < 44); assert.equal(title.inset, 3);
  h.update({ active: true });
  const during = labels();
  for (const day of days) for (let minute = 593; minute <= 607; minute++) {
    const text = `${day} precise note ${minute}`;
    const previous = before.find((node) => node.props.text === text).props;
    const current = during.find((node) => node.props.text === text).props;
    for (const field of ['width', 'height', 'rowHeight', 'color', 'bold', 'italic', 'underline']) assert.equal(current[field], previous[field]);
  }
});

test('pinch rules and event edges keep their screen-pixel weight even when a full day grows to normal minute rows', () => {
  const { mountPreview, Value, number } = componentModule();
  const scale = new Value(1), day = '2026-10-29';
  const h = mountPreview({ active: true, days: [day], bands: new Map(),
    outlines: new Map([[day, [{ startMinute: 590, endMinute: 620, groupId: 'event', textColor: '#FFFFFF' }]]]),
    annotations: new Map(), rowHeight: 0.35, railWidth: 88, dayWidth: 302,
    colors: { ink: '#FFFFFF', currentTime: '#C4B8E7' }, scaleY: scale,
    anchor: { minute: 600, viewportY: 250, day: 0, viewportX: 110 }, viewportHeight: 500,
    timeLabel: (minute) => String(minute), current: { day, minute: 600 }, selection: { day, first: 600, last: 600 },
    backgroundColor: '#000000', gridLineColor: '#3A393D' });
  const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  const rules = nodes(h.tree()).filter((node) => /^pinch-(?:current-rule|hour-rule|minute-rule|event-edge|selection-edge)$/.test(node.props.testID ?? ''));
  const selectionBox = nodes(h.tree()).find((node) => node.props.style?.borderLeftWidth === 2 && node.props.style?.borderRightWidth === 2);
  assert.equal(selectionBox.props.style.height, 0.35, 'a single selected minute retains logical height instead of scaling a two-pixel minimum into a giant box');
  for (const id of ['pinch-current-rule', 'pinch-hour-rule', 'pinch-minute-rule', 'pinch-event-edge', 'pinch-selection-edge'])
    assert.ok(rules.some((node) => node.props.testID === id), id + ' must be exercised');
  const renders = h.renders();
  for (const targetRow of [0.35, 9, 34, 85]) {
    const ratio = targetRow / 0.35; scale.setValue(ratio);
    for (const rule of rules) {
      const style = rule.props.style;
      const innerScale = style.transform.find((entry) => entry.scaleY !== undefined).scaleY;
      const expected = rule.props.testID === 'pinch-event-edge' ? 2.5 : rule.props.testID === 'pinch-selection-edge' ? 2 :
        rule.props.testID === 'pinch-current-rule' ? 1.5 : 1;
      assert.ok(Math.abs(style.height * number(innerScale) * ratio - expected) < 1e-8,
        `${rule.props.testID} cannot expand into a thick bar at row ${targetRow}`);
    }
    const now = rules.find((node) => node.props.testID === 'pinch-current-rule').props.style;
    const inset = now.transform.find((entry) => entry.translateY !== undefined).translateY;
    assert.ok(Math.abs((now.top + number(inset)) * ratio + now.height - 601 * targetRow) < 1e-8,
      'the current-time rule ends at the bottom of the current minute throughout zoom');
  }
  assert.equal(h.renders(), renders);
});
