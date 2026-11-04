const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const model = require('../src/utils/canvas.ts');

const settle = () => new Promise((resolve) => setImmediate(resolve));
const file = path.join(__dirname, '../src/screens/NotepadScreen.tsx');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const hookFile = path.join(__dirname, '../src/hooks/useCanvasDraft.ts');
const compiledHook = ts.transpileModule(fs.readFileSync(hookFile, 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;

function mount({ read = async () => '', write = async () => {} } = {}) {
  const slots = [], effects = [], writes = [], documents = [], links = [], opened = [];
  let cursor = 0, stateListener, timeout, frame, historyState;
  const beforeLeaveRef = { current: null };
  const inputRef = { current: null }, addActionsRef = { current: null }, historyControlsRef = { current: null };
  const onHistoryStateChange = (value) => { historyState = value; };
  const appState = { currentState: 'active', addEventListener(_event, listener) {
    stateListener = listener;
    return { remove() { stateListener = undefined; } };
  } };
  const same = (left, right) => left && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useState(initial) {
      const slot = slots[cursor++] ??= { value: initial };
      return [slot.value, (value) => { slot.value = value; }];
    },
    useMemo(factory, deps) {
      const slot = slots[cursor++] ??= {};
      if (!same(slot.deps, deps)) { slot.deps = deps; slot.value = factory(); }
      return slot.value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(run, deps) {
      const slot = slots[cursor++] ??= {};
      if (!same(slot.deps, deps)) { slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = run(); }); }
    },
  };
  const native = Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'Pressable', 'Text', 'TextInput', 'View']
    .map((component) => [component, component]));
  Object.assign(native, { AppState: appState, Platform: { OS: 'android' }, StyleSheet: { create: (styles) => styles } });
  const element = (type, props) => ({ type, props });
  const module = { exports: {} }, hook = { exports: {} };
  const environment = {
    setTimeout(callback) { timeout = callback; return 1; },
    clearTimeout() { timeout = undefined; },
    requestAnimationFrame(callback) { frame = callback; return 1; },
    cancelAnimationFrame() { frame = undefined; },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === 'react-native') return native;
      if (name === '../appearance') return { useAppTheme: () => ({ colors: {}, resolvedMode: 'dark' }) };
      if (name === '../hooks/useCanvasDraft') return hook.exports;
      if (name === '../utils/canvas') return {
        ...model,
        addLinkedCanvasNode(document, range) {
          const result = model.addLinkedCanvasNode(document, range);
          links.push({ text: document.text, range, id: result.nodeId });
          return result;
        },
      };
      if (name === '../data/canvas') return {
        async loadCanvasDocument() { const value = await read(); return typeof value === 'string' ? model.createCanvasDocument(value) : model.readCanvasDocument(value); },
        async saveCanvasDocument(previous, value) { writes.push(value.text); documents.push(value); await write(value.text, previous.text); },
      };
      throw new Error(`Unexpected Notepad import ${name}`);
    },
  };
  vm.runInNewContext(compiledHook, { ...environment, module: hook, exports: hook.exports }, { filename: hookFile });
  vm.runInNewContext(compiled, { ...environment, module, exports: module.exports }, { filename: file });
  function walk(node) {
    return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(walk)] : [];
  }
  function render() {
    cursor = 0;
    const tree = module.exports.NotepadScreen({ beforeLeaveRef, inputRef, addActionsRef, historyControlsRef,
      onHistoryStateChange, onOpenCanvas: (id) => opened.push(id) });
    for (const run of effects.splice(0)) run();
    return walk(tree);
  }
  render();
  return {
    writes, documents, links, opened, inputRef, addActionsRef, historyControlsRef,
    input: () => render().find((node) => node.type === 'TextInput')?.props,
    history() { render(); return historyState; },
    options() { render(); return addActionsRef.current(); },
    frame() { const run = frame; frame = undefined; run?.(); },
    addButton: () => render().find((node) => node.type === 'Pressable' && node.props.children?.props.children === 'Add to Canvas')?.props,
    error: () => render().find((node) => node.props.accessibilityRole === 'alert')?.props.children,
    tick() { const run = timeout; timeout = undefined; run?.(); },
    leave: () => beforeLeaveRef.current(),
    background() { appState.currentState = 'background'; stateListener('background'); },
    unmount() { for (const slot of slots) slot.cleanup?.(); },
  };
}

test('Notepad preserves plain text and navigation waits for the newest edit during an autosave', async () => {
  let resolveRead, resolveWrite;
  const reading = new Promise((resolve) => { resolveRead = resolve; });
  const writing = new Promise((resolve) => { resolveWrite = resolve; });
  const h = mount({ read: () => reading, write: (text) => text === 'first' ? writing : undefined });
  assert.equal(h.input(), undefined, 'the editor must not open over a saved note until loading finishes');
  resolveRead('Previous note\n  ');
  await settle();
  assert.equal(h.input().value, 'Previous note\n  ');
  assert.equal(h.input().multiline, true);
  assert.equal(h.input().autoFocus, true);

  h.input().onChangeText('first');
  assert.deepEqual(h.writes, []);
  h.tick();
  h.input().onChangeText('latest line\n\n  ');
  let finished = false;
  const leaving = h.leave().then((saved) => { finished = true; return saved; });
  await settle();
  assert.equal(finished, false);
  assert.deepEqual(h.writes, ['first']);
  resolveWrite();
  assert.equal(await leaving, true);
  assert.deepEqual(h.writes, ['first', 'latest line\n\n  ']);
  h.unmount();
});

test('Notepad saves its latest text together with the linked card from the highlighted passage', async () => {
  const h = mount({ read: async () => 'Old text' });
  await settle();
  assert.equal(h.addButton(), undefined);
  h.input().onChangeText('Pick up groceries tomorrow');
  h.input().onSelectionChange({ nativeEvent: { selection: { start: 8, end: 17 } } });
  h.addButton().onPress();
  await settle();
  assert.deepEqual(h.writes, ['Pick up groceries tomorrow']);
  assert.ok(h.links[0].id);
  assert.deepEqual(h.links, [{ text: 'Pick up groceries tomorrow', range: { start: 8, end: 17 }, id: h.links[0].id }]);
  assert.deepEqual(h.opened, [h.links[0].id]);
  assert.equal(h.input().value, 'Pick up groceries tomorrow');
  h.unmount();
});

test('Notepad flushes when backgrounded and retains a failed save for retry', async () => {
  let fail = true;
  const h = mount({ write: async () => { if (fail) throw new Error('Database unavailable'); } });
  await settle();
  h.input().onChangeText('Keep this draft');
  h.background();
  await settle();
  assert.deepEqual(h.writes, ['Keep this draft']);
  assert.equal(h.input().value, 'Keep this draft');
  assert.equal(h.error(), 'Could not save the latest changes.');
  assert.equal(await h.leave(), false);
  fail = false;
  assert.equal(await h.leave(), true);
  assert.equal(h.error(), undefined);
  assert.deepEqual(h.writes, ['Keep this draft', 'Keep this draft', 'Keep this draft']);
  h.unmount();
});

test('Notepad header Add focuses a new paragraph and preserves a captured Canvas selection after keyboard dismissal', async () => {
  const initial = model.addLinkedCanvasNode(model.createCanvasDocument('A note'), { start: 2, end: 6 }).document;
  const h = mount({ read: async () => initial }); await settle();
  const native = []; h.inputRef.current = { focus: () => native.push('focus'), setSelection: (start, end) => native.push([start, end]) };
  assert.equal(h.options().map(({ label }) => label).join(), 'Add note');
  h.input().onSelectionChange({ nativeEvent: { selection: { start: 2, end: 6 } } });
  h.options()[0].run(); h.frame();
  assert.equal(h.input().value, 'A note\n\n'); assert.deepEqual(native, ['focus', [8, 8]]);
  h.input().onSelectionChange({ nativeEvent: { selection: { start: 2, end: 6 } } });
  const link = h.options().find(({ label }) => label === 'Add selection to Canvas');
  h.input().onSelectionChange({ nativeEvent: { selection: { start: 6, end: 6 } } });
  link.run(); await settle();
  assert.equal(h.documents.at(-1).boards[0].nodes[0].text, 'note', 'appending a paragraph does not extend a linked tail selection');
  assert.equal(h.links[0].text.slice(h.links[0].range.start, h.links[0].range.end), 'note');
  assert.equal(h.opened[0], h.links[0].id);
  h.unmount(); assert.equal(h.addActionsRef.current, null);
});

test('Notepad header Undo and Redo persist the text and restore a detached Canvas link', async () => {
  const initial = model.addLinkedCanvasNode(model.createCanvasDocument('A linked phrase'), { start: 2, end: 8 }).document;
  const h = mount({ read: async () => initial }); await settle();
  assert.equal(h.history().canUndo, false);
  h.input().onSelectionChange({ nativeEvent: { selection: { start: 2, end: 8 } } });
  h.input().onChangeText('A  phrase'); await h.leave();
  assert.equal(h.documents.at(-1).boards[0].nodes[0].source, undefined);
  assert.equal(h.history().canUndo, true);
  h.historyControlsRef.current.undo(); await h.leave();
  assert.equal(h.input().value, 'A linked phrase');
  assert.equal(h.documents.at(-1).boards[0].nodes[0].source.start, 2);
  assert.equal(h.documents.at(-1).boards[0].nodes[0].source.end, 8);
  assert.equal(h.history().canRedo, true);
  h.historyControlsRef.current.redo(); await h.leave();
  assert.equal(h.input().value, 'A  phrase');
  assert.equal(h.documents.at(-1).boards[0].nodes[0].source, undefined);
  h.historyControlsRef.current.undo(); h.input().onChangeText('A new note'); assert.equal(h.history().canRedo, false);
  h.unmount(); assert.equal(h.historyControlsRef.current, null);
});
