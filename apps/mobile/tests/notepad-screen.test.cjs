const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const settle = () => new Promise((resolve) => setImmediate(resolve));
const file = path.join(__dirname, '../src/screens/NotepadScreen.tsx');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

function mount({ read = async () => '', write = async () => {} } = {}) {
  const slots = [], effects = [], writes = [];
  let cursor = 0, stateListener, timeout;
  const beforeLeaveRef = { current: null };
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
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    setTimeout(callback) { timeout = callback; return 1; },
    clearTimeout() { timeout = undefined; },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === 'react-native') return native;
      if (name === '../appearance') return { useAppTheme: () => ({ colors: {}, resolvedMode: 'dark' }) };
      if (name === '../data/database') return {
        getSetting(key) { assert.equal(key, 'notepad.text.v1'); return read(); },
        async setSetting(key, value) { assert.equal(key, 'notepad.text.v1'); writes.push(value); await write(value); },
      };
      throw new Error(`Unexpected Notepad import ${name}`);
    },
  }, { filename: file });
  function walk(node) {
    return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(walk)] : [];
  }
  function render() {
    cursor = 0;
    const tree = module.exports.NotepadScreen({ beforeLeaveRef });
    for (const run of effects.splice(0)) run();
    return walk(tree);
  }
  render();
  return {
    writes, input: () => render().find((node) => node.type === 'TextInput')?.props,
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
