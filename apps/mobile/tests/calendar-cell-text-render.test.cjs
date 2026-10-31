const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Run actual components with native animation nodes and explicit React commit,
// effect cleanup and listener flushing. Individual pre-effect frames are retained
// so a stale zoom cannot be hidden by a later corrective effect.
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
      if (!active.slots[i] || !same(active.slots[i].deps, deps)) {
        const previous = active.slots[i], slot = { deps, cleanup: null }; active.slots[i] = slot;
        active.effects.push(() => { previous?.cleanup?.(); const cleanup = work(); slot.cleanup = typeof cleanup === 'function' ? cleanup : null; });
      } },
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
    constructor(value) {
      let current = value; super(() => current); this.listeners = new Map(); this.nextId = 0;
      this.setValue = (next) => { current = next; for (const listener of [...this.listeners.values()]) listener({ value: next }); };
    }
    addListener(listener) { const id = String(++this.nextId); this.listeners.set(id, listener); return id; }
    removeListener(id) { this.listeners.delete(id); }
    listenerCount() { return this.listeners.size; }
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
    const state = { hook: 0, slots: [], effects: [], dirty: true, renders: 0, tree: null, frames: [], disposed: false };
    const props = { text: 'One complete note', width: 200, height: 34, rowHeight: 34, color: '#222222', ...input };
    function render() {
      assert.equal(state.disposed, false, 'an unmounted label subtree cannot render');
      let iterations = 0;
      do {
        assert.ok(iterations++ < 10, 'state effects must settle without a render loop');
        active = state; state.hook = 0; state.dirty = false; state.renders++; state.tree = Render(props);
        state.frames.push(state.tree);
        const effects = state.effects.splice(0); effects.forEach((effect) => effect());
      } while (state.dirty);
    }
    render();
    return { props, update(next) { Object.assign(props, next); render(); },
      flush() { if (state.dirty) render(); },
      unmount() { for (const slot of state.slots) slot?.cleanup?.(); state.disposed = true; state.effects = []; state.dirty = false; },
      text: () => state.tree?.props.children.props.children?.props,
      style: () => state.tree?.props.children.props.style,
      tree: () => state.tree, renders: () => state.renders, frames: () => state.frames, dirty: () => state.dirty,
    };
  }
  return { mount, Value, divide: native.Animated.divide, number,
    mountPreview: (input) => mount(input, load(path.join(__dirname, '../src/components/CalendarPinchPreview.tsx')).CalendarPinchPreview),
    mountPreviewLabels: (input) => mount(input, load(path.join(__dirname, '../src/components/CalendarPinchPreview.tsx')).CalendarPinchLabels) };
}

test('short, long and narrow cell notes share the same font, opacity and reveal threshold at every zoom', () => {
  const { mount } = componentModule();
  const notes = ['Short', 'A much longer paragraph that needs many native lines. '.repeat(300), 'One\nTwo\nThree\nFour', '👨‍👩‍👧‍👦'];
  for (const rowHeight of [0.35, 4, 9, 13, 17, 34, 68, 85]) {
    const cells = notes.map((text, index) => mount({ text, width: [200, 200, 40, 1][index], height: rowHeight, rowHeight }));
    for (const cell of cells) {
      assert.equal(cell.style().opacity, cells[0].style().opacity);
      assert.equal(Boolean(cell.text()), Boolean(cells[0].text()), 'text content and width never hide one note independently');
      if (cell.text()) {
        assert.equal(cell.text().style.fontSize, cells[0].text().style.fontSize);
        assert.equal(cell.text().style.lineHeight, cells[0].text().style.lineHeight);
        assert.equal(cell.style().transform, undefined, 'prewrapped paragraphs are never scaled to fit');
      }
    }
  }
});

test('native text receives the full width and original paragraph at its real zoom font without ellipsis or preset character wrapping', () => {
  const { mount } = componentModule();
  const text = '  Full native width, café 💤 and Unicode.\nSecond line keeps its actual words.  ';
  for (const width of [1, 19, 44, 90, 300]) {
    const h = mount({ text, width, rowHeight: 17, height: 17 });
    assert.equal(h.text().children, text);
    assert.equal(h.text().style.width, width); assert.equal(h.style().width, width);
    assert.equal(h.text().style.fontSize, 8); assert.equal(h.text().style.lineHeight, 10.5);
    assert.equal(h.text().numberOfLines, undefined); assert.equal(h.text().ellipsizeMode, undefined);
    assert.equal(h.text().adjustsFontSizeToFit, undefined); assert.equal(h.text().minimumFontScale, undefined);
    assert.equal(h.text().onTextLayout, undefined, 'paragraph measurement no longer controls visibility');
    assert.equal(h.text().textBreakStrategy, 'simple'); assert.equal(h.text().lineBreakStrategyIOS, 'none');
    assert.equal(h.text().allowFontScaling, false);
  }
});

test('cell clipping shows all complete lines that fit without shrinking the note or exposing part of the next line', () => {
  const { mount } = componentModule();
  for (const rowHeight of [13, 17, 34, 35, 46, 68, 85]) {
    const h = mount({ text: 'Many wrapped lines. '.repeat(1000), rowHeight, height: rowHeight });
    assert.equal(h.tree().props.style.overflow, 'hidden'); assert.equal(h.style().overflow, 'hidden');
    const line = h.text().style.lineHeight;
    assert.equal(h.style().height, Math.floor((rowHeight - 4) / line) * line);
    assert.ok(h.style().height <= rowHeight - 4);
    assert.equal(h.text().style.fontSize, 16 * Math.min(1, rowHeight / 34));
  }
  const centered = mount({ text: '10:15 AM', height: 85, rowHeight: 85, align: 'right', verticalAlign: 'center' });
  assert.equal(centered.text().style.textAlign, 'right');
  assert.equal(centered.style().top, 32); assert.equal(centered.style().height, 21);
});

test('post-commit readiness does not wait for a native measurement or let paragraph length delay the new note', () => {
  const { mount } = componentModule(); let ready = 0;
  const h = mount({ text: 'Short', onReady: () => ready++ });
  assert.equal(ready, 1); assert.equal(h.style().opacity, 1);
  h.update({ text: 'A long replacement. '.repeat(300), width: 44, bold: true });
  assert.equal(ready, 2); assert.equal(h.style().opacity, 1); assert.equal(h.text().style.fontSize, 16);
  assert.equal(h.text().children, h.props.text);
  h.update({ rowHeight: 4, height: 4 });
  assert.equal(ready, 3); assert.equal(h.style().opacity, 0); assert.equal(h.text(), undefined);
});

test('system font scale and text styling preserve common visibility and never trigger per-cell fitting', () => {
  const { mount } = componentModule();
  for (const [fontScale, expected] of [[0.5, 0.5], [0.85, 0.85], [1, 1], [2, 1.4], [0, 1], [-1, 1], [NaN, 1]]) {
    const note = mount({ fontScale, bold: true, italic: true, underline: true });
    const title = mount({ text: 'Title', fontScale, fontSize: 11, lineHeight: 14, inset: 3 });
    assert.equal(note.text().style.fontSize, 16 * expected); assert.equal(note.text().style.lineHeight, 21 * expected);
    assert.equal(note.style().opacity, title.style().opacity);
    assert.ok(Math.abs(title.text().style.fontSize - 11 * expected) < 1e-9);
    assert.ok(Math.abs(title.text().style.lineHeight - 14 * expected) < 1e-9);
    assert.equal(note.text().style.fontWeight, '700'); assert.equal(note.text().style.fontStyle, 'italic');
    assert.equal(note.text().style.textDecorationLine, 'underline');
  }
  const tooSmall = [mount({ height: 20, rowHeight: 20, fontScale: 1.4 }),
    mount({ height: 20, rowHeight: 20, fontScale: 1.4, fontSize: 11, lineHeight: 14 })];
  assert.ok(tooSmall.every((h) => h.style().opacity === 0 && !h.text()), 'all note/title hosts wait for the same complete-line threshold');
});

test('blank notes and invalid dimensions acknowledge the committed host without exposing invalid native text', () => {
  const { mount } = componentModule(); let ready = 0;
  const blank = mount({ text: '', onReady: () => ready++ });
  assert.equal(ready, 1); assert.equal(blank.text(), undefined);
  for (const props of [{ width: 0 }, { height: -1 }, { rowHeight: NaN }, { width: Infinity }]) {
    const h = mount({ ...props, onReady: () => ready++ });
    assert.equal(h.tree(), null);
  }
  assert.equal(ready, 5);
});
const nodes = (node) => !node || typeof node !== 'object' ? [] :
  [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const cellLabels = (tree) => nodes(tree).filter((node) => typeof node.type === 'function' && typeof node.props.text === 'string');
const near = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
const previewProps = (scaleY, overrides = {}) => {
  const day = '2026-10-29';
  return { active: false, days: [day], bands: new Map(), outlines: new Map(),
    annotations: new Map([[day, [{ minute: 600, text: 'Short note', title: 'Activity title', color: '#123456', titleColor: '#FFFFFF', bold: true, italic: true, underline: true },
      { minute: 601, text: '  Long complete paragraph café 💤. '.repeat(300) + '\nLast full original line.  ', color: '#123456', titleColor: '#FFFFFF' }]]]),
    rowHeight: 34, railWidth: 88, dayWidth: 300, colors: { ink: '#FFFFFF', currentTime: '#C4B8E7' }, scaleY,
    anchor: { minute: 600, viewportY: 250, day: 0, viewportX: 110 }, viewportHeight: 500,
    timeLabel: (minute) => String(minute), current: { day, minute: 600 }, backgroundColor: '#000000', gridLineColor: '#3A393D', ...overrides };
};

test('the live label layer bounds a dense 10080-note week and gives narrow columns to minute notes before titles', () => {
  const { mountPreviewLabels, Value } = componentModule(); const scale = new Value(1);
  const days = Array.from({ length: 7 }, (_, index) => `2026-10-${25 + index}`);
  const annotations = new Map(days.map((day) => [day, Array.from({ length: 1440 }, (_, minute) => ({
    minute, text: `${day} precise note ${minute}`, color: '#123456', titleColor: '#FFFFFF',
    bold: minute === 600, italic: minute === 600, underline: minute === 600,
    ...(minute === 600 ? { title: 'Independent event title' } : {}),
  }))]));
  const h = mountPreviewLabels(previewProps(scale, { days, annotations, dayWidth: 44 }));
  const before = cellLabels(h.tree());
  assert.ok(before.length < 200, 'the 10080-note week mounts only visible minute labels');
  for (const day of days) for (let minute = 593; minute <= 607; minute++)
    assert.equal(before.filter((node) => node.props.text === `${day} precise note ${minute}`).length, 1);
  assert.equal(before.some((node) => node.props.text === 'Independent event title'), false, 'a badge never consumes a narrow Week note cell');
  const narrowNote = before.find((node) => node.props.text === `${days[0]} precise note 600`).props;
  assert.equal(narrowNote.width, 32); assert.equal(narrowNote.bold, true); assert.equal(narrowNote.italic, true); assert.equal(narrowNote.underline, true);
  h.update({ dayWidth: 160, active: true });
  assert.equal(cellLabels(h.tree()).filter((node) => node.props.text === 'Independent event title').length, 7);
  for (const row of [13, 17, 34, 68, 85]) {
    scale.setValue(row / 34); h.flush();
    const labels = cellLabels(h.tree());
    assert.ok(labels.length <= (Math.ceil(500 / row) + 6) * 7 + 7, 'only the live viewport and its small overscan reflow');
    assert.ok(labels.every((label) => Math.abs(label.props.rowHeight - row) < 1e-8));
  }
  scale.setValue(9 / 34); h.flush();
  assert.equal(cellLabels(h.tree()).length, 0, 'all notes and titles disappear together below the shared threshold');
  h.unmount(); assert.equal(scale.listenerCount(), 0);
});

test('live pinch labels use the same actual font and physical wrapping width as committed text at every zoom', () => {
  const { mount, mountPreviewLabels, Value } = componentModule(); const scale = new Value(1);
  const props = previewProps(scale, { active: true }); const h = mountPreviewLabels(props);
  const longText = props.annotations.get(props.days[0])[1].text;
  for (const dayWidth of [44, 160, 300]) {
    h.update({ dayWidth });
    for (const row of [9, 13, 17, 34, 68, 85]) {
      scale.setValue(row / 34); h.flush();
      const labels = cellLabels(h.tree());
      if (row === 9) { assert.equal(labels.length, 0); continue; }
      const short = labels.find((label) => label.props.text === 'Short note').props;
      const long = labels.find((label) => label.props.text === longText).props;
      const title = labels.find((label) => label.props.text === 'Activity title');
      assert.equal(Boolean(title), dayWidth >= 112);
      const badge = title ? dayWidth * 0.4 : 0;
      assert.equal(short.width, dayWidth - badge - (title ? 18 : 12)); assert.equal(long.width, dayWidth - 12);
      const committed = mount({ text: 'Committed comparison', width: short.width, height: row, rowHeight: row });
      const shortNative = mount(short); const longNative = mount(long);
      for (const cell of [shortNative, longNative]) {
        near(cell.text().style.fontSize, committed.text().style.fontSize);
        near(cell.text().style.lineHeight, committed.text().style.lineHeight);
        near(cell.style().opacity, committed.style().opacity);
        assert.equal(cell.style().transform, undefined);
        assert.equal(cell.text().textBreakStrategy, 'simple'); assert.equal(cell.text().lineBreakStrategyIOS, 'none');
      }
      near(shortNative.text().style.width, short.width); assert.equal(longNative.text().children, longText);
      assert.equal(shortNative.text().style.fontWeight, '700'); assert.equal(shortNative.text().style.fontStyle, 'italic');
      if (title) { const titleNative = mount(title.props); near(titleNative.style().opacity, shortNative.style().opacity); assert.equal(titleNative.text().children, 'Activity title'); }
      const rowNode = nodes(h.tree()).find((node) => node.props.testID === 'pinch-note-row');
      const wrapper = rowNode.props.style[1];
      near(wrapper.transform[0].scaleY.value * row / 34, 1, 'the native parent scale is countered without scaling text horizontally');
    }
  }
  h.unmount();
});

test('a warm listener captures the first pre-activation pinch frame and never reuses an old gesture scale on a fresh base', () => {
  const { mountPreviewLabels, Value } = componentModule(); const scale = new Value(1);
  const h = mountPreviewLabels(previewProps(scale));
  assert.equal(scale.listenerCount(), 1, 'the inactive prewarmed label layer is already listening');
  // Grant and its first movement can arrive before React commits active=true.
  scale.setValue(1); scale.setValue(0.5); const start = h.frames().length;
  h.update({ active: true });
  for (const frame of h.frames().slice(start)) for (const label of cellLabels(frame)) near(label.props.rowHeight, 17);
  assert.ok(cellLabels(h.tree()).length > 0);
  scale.setValue(2); h.flush();
  assert.ok(cellLabels(h.tree()).every((label) => label.props.rowHeight === 68));
  const newBaseStart = h.frames().length;
  h.update({ active: false, rowHeight: 17 });
  scale.setValue(1); h.flush();
  h.update({ active: true });
  for (const frame of h.frames().slice(newBaseStart)) for (const label of cellLabels(frame)) near(label.props.rowHeight, 17,
    'no pre-effect frame may apply the old ratio2 to the new17px base');
  assert.equal(scale.listenerCount(), 1, 'active changes do not detach or duplicate the warm listener');
  h.unmount(); assert.equal(scale.listenerCount(), 0);
});

test('preview label effects clean up old animation sources and unmount listeners without dropping inactive warmth', () => {
  const { mountPreviewLabels, Value } = componentModule(); const oldScale = new Value(1), nextScale = new Value(1);
  const h = mountPreviewLabels(previewProps(oldScale, { active: true }));
  oldScale.setValue(2); h.flush();
  const sourceChange = h.frames().length;
  h.update({ scaleY: nextScale, rowHeight: 17 });
  for (const frame of h.frames().slice(sourceChange)) for (const label of cellLabels(frame)) near(label.props.rowHeight, 17);
  assert.equal(oldScale.listenerCount(), 0); assert.equal(nextScale.listenerCount(), 1);
  oldScale.setValue(3); assert.equal(h.dirty(), false, 'the retired animation source cannot update this subtree');
  for (const bad of [0, -1, NaN, Infinity]) nextScale.setValue(bad);
  assert.equal(h.dirty(), false, 'invalid native scale events never create invalid row geometry');
  h.update({ active: false }); assert.equal(nextScale.listenerCount(), 1);
  nextScale.setValue(2); h.flush();
  assert.ok(cellLabels(h.tree()).every((label) => label.props.rowHeight === 17), 'inactive labels use committed geometry');
  h.unmount(); assert.equal(nextScale.listenerCount(), 0);
  nextScale.setValue(3); assert.equal(h.dirty(), false, 'unmounted label state receives no listener event');
});

test('pinch background rules retain screen-pixel weight and never rerender while only visible labels reflow', () => {
  const { mountPreview, mountPreviewLabels, Value, number } = componentModule(); const scale = new Value(1), day = '2026-10-29';
  const props = previewProps(scale, { active: true, days: [day],
    outlines: new Map([[day, [{ startMinute: 590, endMinute: 620, groupId: 'event', color: '#FFFFFF' }]]]),
    rowHeight: 0.35, dayWidth: 302, selection: { day, first: 600, last: 600 } });
  const background = mountPreview(props), labels = mountPreviewLabels(props);
  const tree = background.tree(); const initialBackgroundRenders = background.renders(), initialLabelRenders = labels.renders();
  const rules = nodes(tree).filter((node) => /^pinch-(?:current-rule|hour-rule|minute-rule|event-edge|selection-edge)$/.test(node.props.testID ?? ''));
  const selectionBox = nodes(tree).find((node) => node.props.style?.borderLeftWidth === 2 && node.props.style?.borderRightWidth === 2);
  assert.equal(selectionBox.props.style.height, 0.35);
  for (const id of ['pinch-current-rule', 'pinch-hour-rule', 'pinch-minute-rule', 'pinch-event-edge', 'pinch-selection-edge'])
    assert.ok(rules.some((node) => node.props.testID === id), id + ' must be exercised');
  for (const targetRow of [0.35, 9, 34, 85]) {
    const ratio = targetRow / 0.35; scale.setValue(ratio); labels.flush();
    for (const rule of rules) {
      const style = rule.props.style, innerScale = style.transform.find((entry) => entry.scaleY !== undefined).scaleY;
      const expected = rule.props.testID === 'pinch-event-edge' ? 2.5 : rule.props.testID === 'pinch-selection-edge' ? 2 : rule.props.testID === 'pinch-current-rule' ? 1.5 : 1;
      near(style.height * number(innerScale) * ratio, expected, rule.props.testID + ' keeps its screen-pixel weight');
    }
    const now = rules.find((node) => node.props.testID === 'pinch-current-rule').props.style;
    const inset = now.transform.find((entry) => entry.translateY !== undefined).translateY;
    near((now.top + number(inset)) * ratio + now.height, 601 * targetRow);
    assert.equal(background.tree(), tree); assert.equal(background.renders(), initialBackgroundRenders);
  }
  assert.ok(labels.renders() > initialLabelRenders, 'only the bounded native-font label subtree reflows');
  background.unmount(); labels.unmount(); assert.equal(scale.listenerCount(), 0);
});
