const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const model = require('../src/utils/checklist-flow.ts');
const dragModel = require('../src/utils/checklist-drag.ts');
const historyModel = require('../src/utils/checklist-history.ts');

const task = (id, text, parentId = null, checked = false) => ({ id, text, parentId, checked, format: {} });
const clone = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Render the real TSX and run its real handlers/effects. The native surface and
// persistence boundary are isolated; checklist mutations use the shared model.
function harness(items, options = {}) {
  let snapshot = { flow: model.readChecklistFlow({ kind: 'checklistFlow', version: 1, items }), revision: 'initial' };
  let revision = 0; let dataVersion = 0; let changed = 0; let failRead = Boolean(options.failRead);
  let conflicts = options.conflicts ?? []; const commands = []; const timers = new Map(); let nextTimer = 0;
  let pendingDelete;
  const beforeLeaveRef = { current: null };
  const controlsRef = { current: null }; let historyState; let hideCompleted = Boolean(options.hideCompleted);
  const receiveHistory = (value) => { historyState = value; };
  const listId = options.listId ?? 'main';
  const fullSnapshot = () => ({ ...clone(snapshot), listId, lists: [{ id: listId, name: options.name ?? 'Priority', taskCount: snapshot.flow.items.length }] });
  const keyboardListeners = new Map();
  const lifecycleListeners = new Set();
  const appState = { currentState: 'active', addEventListener(_event, listener) { lifecycleListeners.add(listener);
    return { remove() { lifecycleListeners.delete(listener); } }; } };
  const root = { slots: [], cursor: 0, effects: [], dirty: true, tree: null, writes: 0 };
  let active = root;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const react = {
    Fragment: 'Fragment',
    useRef(value) { const index = active.cursor++; return active.slots[index] ??= { current: value }; },
    useState(initial) { const owner = active, index = owner.cursor++;
      owner.slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [owner.slots[index].value, (next) => { const value = typeof next === 'function' ? next(owner.slots[index].value) : next;
        if (!Object.is(owner.slots[index].value, value)) { owner.slots[index].value = value; owner.dirty = true; owner.writes++; } }]; },
    useMemo(work, deps) { const index = active.cursor++; if (!active.slots[index] || !same(active.slots[index].deps, deps))
      active.slots[index] = { value: work(), deps }; return active.slots[index].value; },
    useCallback(work, deps) { return react.useMemo(() => work, deps); },
    useEffect(work, deps) { const owner = active, index = owner.cursor++;
      if (!owner.slots[index] || !same(owner.slots[index].deps, deps)) { const prior = owner.slots[index]; const slot = { deps };
        owner.slots[index] = slot; owner.effects.push(() => { prior?.cleanup?.(); slot.cleanup = work(); }); } },
  };
  class Value { constructor(value) { this.value = value; } setValue(value) { this.value = value; } }
  const colors = { ink: '#EEEEEE', graphite: '#DDDDDD', muted: '#AAAAAA', paper: '#202024', panel: '#29292E',
    surface: '#141418', hairline: '#444444', accent: '#EEEEEE', onAccent: '#202024' };
  const native = Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View', 'Switch'].map((name) => [name, name]));
  Object.assign(native, { Animated: { View: 'AnimatedView', Value }, Keyboard: { dismiss() {}, addListener(name, listener) {
    keyboardListeners.set(name, listener); return { remove() { keyboardListeners.delete(name); } };
  } }, AppState: appState,
    Alert: { alert(_title, _body, actions) { const confirm = actions.find((action) => action.text === 'Delete')?.onPress;
      if (options.holdDelete) pendingDelete = confirm; else confirm?.(); } },
    PanResponder: { create: (config) => ({ panHandlers: { responder: config } }) },
    StyleSheet: { create: (styles) => styles, absoluteFill: {}, hairlineWidth: 0.5 } });
  const service = {
    getChecklistFlow: async (requestedId) => { assert.equal(requestedId, listId); if (failRead) throw Error('Invalid checklist'); return fullSnapshot(); },
    getChecklistFlowRevision: async () => snapshot.revision,
    getChecklistFlowConflicts: async () => clone(conflicts),
    changeChecklistFlow: async (command, expected, requestedId) => {
      assert.equal(requestedId, listId);
      if (options.saveGate) await options.saveGate;
      if (snapshot.revision !== expected) throw Error('The checklist changed on another device. Refresh it before applying this edit.');
      commands.push(clone(command)); snapshot = { flow: model.applyChecklistChange(snapshot.flow, command), revision: `edit_${++revision}` }; return fullSnapshot();
    },
    replaceChecklistList: async (requestedId, flow, expected) => {
      assert.equal(requestedId, listId);
      if (options.historyGate) await options.historyGate;
      if (snapshot.revision !== expected) throw Error('The checklist changed on another device. Refresh it before applying this edit.');
      commands.push({ type: 'restore', expected, listId: requestedId }); snapshot = { flow: clone(flow), revision: `history_${++revision}` }; return fullSnapshot();
    },
    restoreChecklistFlowConflict: async (document, expected) => {
      assert.equal(expected, snapshot.revision); snapshot = { flow: model.readChecklistFlow(document.value), revision: `restore_${++revision}` };
      failRead = false; conflicts = []; return fullSnapshot();
    },
    dismissChecklistFlowConflict: async (document) => { conflicts = conflicts.filter((item) => item.revision !== document.revision); },
  };
  const module = { exports: {} }; const filename = path.join(__dirname, '../src/screens/ChecklistFlowScreen.tsx');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module, exports: module.exports, Error, setInterval: (callback) => { timers.set(++nextTimer, callback); return nextTimer; },
    clearInterval: (id) => timers.delete(id), requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react-native') return native;
      if (name === 'expo-crypto') return { randomUUID: () => 'test_task_uuid' };
      if (name === '../appearance') return { useAppTheme: () => ({ colors, resolvedMode: 'dark' }) };
      if (name === '../components/InfoButton') return { InfoButton: 'InfoButton' };
      if (name === '../data/checklist-flow') return service;
      if (name === '../utils/checklist-flow') return model;
      if (name === '../utils/checklist-drag') return dragModel;
      if (name === '../utils/checklist-history') return historyModel;
      throw Error('Unexpected checklist screen import: ' + name);
    } }, { filename });
  function render() { let iterations = 0;
    do { assert.ok(iterations++ < 12); active = root; root.cursor = 0; root.dirty = false;
      root.tree = module.exports.ChecklistFlowScreen({ dataVersion, onDataChanged: () => { changed++; }, beforeLeaveRef,
        listId, hideCompleted, controlsRef, onHistoryChange: receiveHistory });
      for (const effect of root.effects.splice(0)) effect();
    } while (root.dirty); return root.tree;
  }
  function walk(node) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(walk)] : []; }
  function nodes(node) { return walk(node ?? render()); }
  const find = (label) => nodes().find((node) => node.props.accessibilityLabel === label);
  render();
  return { render, nodes, find, commands, get snapshot() { return snapshot; }, get changed() { return changed; },
    async ready() { await settle(); render(); },
    async press(label) { const node = find(label); assert.ok(node, label); assert.equal(Boolean(node.props.disabled), false, label + ' enabled');
      node.props.onPress(); render(); await settle(); render(); },
    setDraft(text) { find('Task text').props.onChangeText(text); render(); },
    remote(items) { snapshot = { flow: model.readChecklistFlow({ kind: 'checklistFlow', version: 1, items }), revision: 'remote' }; },
    async refresh() { dataVersion++; render(); await settle(); render(); },
    async leave() { const result = await beforeLeaveRef.current(); await settle(); render(); return result; },
    setHideCompleted(value) { hideCompleted = value; render(); },
    async history(action) { const pending = controlsRef.current[action](); render(); const result = await pending; await settle(); render(); return result; },
    get historyState() { return historyState; },
    async confirmDelete() { assert.ok(pendingDelete); pendingDelete(); await settle(); render(); },
    keyboard() { keyboardListeners.get('keyboardDidShow')?.(); },
    background() { appState.currentState = 'background'; for (const listener of lifecycleListeners) listener('background'); render(); },
    foreground() { appState.currentState = 'active'; for (const listener of lifecycleListeners) listener('active'); render(); },
    nativeHandle(label) { const node = nodes().find((item) => typeof item.type === 'function' && item.type.name === 'TaskDragHandle' && item.props.label === label);
      assert.ok(node); const child = { slots: [], cursor: 0, effects: [] }; active = child; const result = node.type(node.props); active = root;
      return result.props.responder; },
    layout(id, y, height) { const row = nodes().find((node) => node.type === 'AnimatedView' && node.props.children?.[0]?.props.children?.some?.((item) => item?.props?.accessibilityLabel?.startsWith(`Edit task: ${items.find((item) => item.id === id)?.text}`)));
      assert.ok(row, id); row.props.onLayout({ nativeEvent: { layout: { y, height, x: 0, width: 300 } } }); },
    unmount() { for (const slot of root.slots) slot?.cleanup?.(); },
  };
}

test('native checkbox is single-tap, fades tasks, hides completion and resets every check', async () => {
  const h = harness([task('parent', 'Main task'), task('child', 'Subtask', 'parent')]); await h.ready();
  await h.press('Complete Main task');
  assert.deepEqual(h.snapshot.flow.items.map((item) => item.checked), [true, true]);
  assert.equal(h.commands.length, 1); assert.equal(h.changed, 1);
  assert.ok(h.nodes().some((node) => Array.isArray(node.props.style) && node.props.style.some((value) => value?.opacity === 0.42)));
  assert.equal(h.find('Hide completed tasks'), undefined, 'The preference is in Settings');
  h.setHideCompleted(true);
  assert.equal(h.find('Complete Main task'), undefined);
  await h.press('Reset all task checks');
  assert.deepEqual(h.snapshot.flow.items.map((item) => item.checked), [false, false]);
  assert.ok(h.find('Complete Main task')); h.unmount();
});

test('Priority uses its selected list for edits and native Undo/Redo restores the complete task subtree', async () => {
  const h = harness([task('parent', 'Family'), task('child', 'Call mum', 'parent')], { listId: 'family', name: 'Family plans' }); await h.ready();
  assert.ok(h.nodes().some((node) => node.type === 'Text' && node.props.children === 'Family plans'));
  assert.equal(h.nodes().some((node) => node.props.children === 'Add a task to begin'), false);
  await h.press('Complete Family'); assert.equal(h.historyState.canUndo, true);
  assert.equal(await h.history('undo'), true); assert.deepEqual(h.snapshot.flow.items.map((item) => item.checked), [false, false]);
  assert.equal(h.historyState.canRedo, true);
  assert.equal(await h.history('redo'), true); assert.deepEqual(h.snapshot.flow.items.map((item) => item.checked), [true, true]);
  assert.equal(h.commands.filter((command) => command.type === 'restore').length, 2); h.unmount();
});

test('Priority Undo cannot overwrite a peer update and a refresh drops its stale local history', async () => {
  const h = harness([task('task', 'Before')]); await h.ready(); await h.press('Edit task: Before'); h.setDraft('My edit'); await h.press('Save task');
  assert.equal(h.historyState.canUndo, true); h.remote([task('task', 'Peer update')]);
  assert.equal(await h.history('undo'), false); assert.equal(h.snapshot.flow.items[0].text, 'Peer update');
  assert.equal(h.commands.filter((command) => command.type === 'restore').length, 0);
  await h.refresh(); assert.equal(h.historyState.canUndo, false); assert.equal(h.historyState.canRedo, false); h.unmount();
});

test('Priority history stays unavailable during a text draft and becomes available after its own save', async () => {
  const h = harness([task('task', 'Before')]); await h.ready(); await h.press('Complete Before'); await h.press('Edit task: Before');
  h.setDraft('Not saved yet'); assert.equal(h.historyState.canUndo, false);
  assert.equal(await h.history('undo'), false); assert.equal(h.snapshot.flow.items[0].text, 'Before');
  await h.press('Save task'); assert.equal(h.historyState.canUndo, true); assert.equal(await h.history('undo'), true);
  assert.equal(h.snapshot.flow.items[0].text, 'Before'); h.unmount();
});

test('a retained deletion prompt cannot write after backgrounding or unmounting Priority', async () => {
  for (const lifecycle of ['background', 'unmount']) {
    const h = harness([task('parent', 'Parent'), task('child', 'Child', 'parent')], { holdDelete: true }); await h.ready();
    await h.press('Actions for Parent'); await h.press('Delete task');
    h[lifecycle](); if (lifecycle === 'background') h.foreground();
    await h.confirmDelete(); assert.equal(h.snapshot.flow.items.length, 2); assert.equal(h.commands.length, 0);
    if (lifecycle !== 'unmount') h.unmount();
  }
});

test('native row editing saves text and formatting and preserves minute-source metadata', async () => {
  const source = { ranges: [{ dateKey: '2026-11-02', startMinute: 600, endMinute: 600 }] };
  const h = harness([{ ...task('note', 'Call office'), source }]); await h.ready();
  await h.press('Edit task: Call office'); h.setDraft('Call dentist'); await h.press('Bold');
  h.find('Task text color hex').props.onChangeText('#29527a'); h.render(); await h.press('Save task');
  assert.equal(h.snapshot.flow.items[0].text, 'Call dentist');
  assert.deepEqual(h.snapshot.flow.items[0].format, { bold: true, textColor: '#29527A' });
  assert.deepEqual(h.snapshot.flow.items[0].source, source); assert.equal(h.find('Task text'), undefined); h.unmount();
});

test('an editor opened before a remote revision retains its draft and cannot overwrite the peer', async () => {
  const h = harness([task('note', 'Original')]); await h.ready(); await h.press('Edit task: Original'); h.setDraft('Local unsaved');
  h.remote([task('note', 'Peer saved')]); await h.press('Save task');
  assert.equal(h.snapshot.flow.items[0].text, 'Peer saved'); assert.equal(h.find('Task text').props.value, 'Local unsaved');
  assert.equal(h.commands.length, 0); assert.ok(h.nodes().some((node) => typeof node.props.children === 'string' && node.props.children.includes('changed on another device'))); h.unmount();
});

test('actual native drag gesture moves a parent with its subtasks once', async () => {
  const h = harness([task('parent', 'Main task'), task('child', 'Subtask', 'parent'), task('last', 'Last task')]); await h.ready();
  h.layout('parent', 0, 64); h.layout('child', 64, 64); h.layout('last', 128, 64);
  const handle = h.nativeHandle('Main task');
  assert.equal(handle.onStartShouldSetPanResponder(), true); handle.onPanResponderGrant({ nativeEvent: { pageY: 50 } }); h.render();
  handle.onPanResponderMove({}, { dy: 180, moveY: 230 }); h.render(); handle.onPanResponderRelease(); h.render(); await settle(); h.render();
  assert.deepEqual(h.snapshot.flow.items.map((item) => item.id), ['last', 'parent', 'child']);
  assert.equal(h.commands.length, 1); assert.equal(h.snapshot.flow.items[2].parentId, 'parent'); h.unmount();
});

test('malformed current metadata leaves a retained valid version reachable for recovery', async () => {
  const saved = model.readChecklistFlow({ kind: 'checklistFlow', version: 1, items: [task('saved', 'Recover this task')] });
  const h = harness([], { failRead: true, conflicts: [{ key: model.CHECKLIST_FLOW_KEY, revision: 'older', value: saved }] }); await h.ready();
  const versions = h.nodes().find((node) => node.type === 'Pressable' && node.props.children?.props?.children?.[0] === 'Other versions (');
  assert.ok(versions); versions.props.onPress(); h.render();
  const restore = h.nodes().find((node) => node.type === 'Pressable' && node.props.children?.props?.children === 'Restore list');
  assert.ok(restore); restore.props.onPress(); h.render(); await settle(); h.render();
  assert.equal(h.snapshot.flow.items[0].text, 'Recover this task'); assert.ok(h.find('Complete Recover this task')); h.unmount();
});

test('a lower task editor scrolls above the keyboard using measured window coordinates', async () => {
  const h = harness([task('note', 'Task far down the list')]); await h.ready(); await h.press('Edit task: Task far down the list');
  const scrolls = [];
  const scroll = h.nodes().find((node) => node.type === 'ScrollView' && node.props.ref);
  scroll.props.ref.current = { measureInWindow(callback) { callback(0, 100, 360, 250); }, scrollTo(value) { scrolls.push(value); } };
  const editor = h.nodes().find((node) => node.type === 'View' && node.props.ref && node.props.onLayout);
  editor.props.ref.current = { measureInWindow(callback) { callback(0, 500, 340, 230); } };
  const viewport = h.nodes().find((node) => node.type === 'View' && node.props.ref && !node.props.onLayout);
  viewport.props.ref.current = { measureInWindow(callback) { callback(0, 80, 360, 450); } };
  const avoiding = h.nodes().find((node) => node.type === 'KeyboardAvoidingView');
  assert.equal(avoiding.props.behavior, 'padding'); avoiding.props.onLayout({ nativeEvent: { layout: { y: 0 } } }); h.render();
  assert.equal(h.nodes().find((node) => node.type === 'KeyboardAvoidingView').props.keyboardVerticalOffset, 80);
  h.keyboard(); assert.equal(scrolls.at(-1).y, 392); assert.equal(scrolls.at(-1).animated, true);
  h.unmount();
});

test('drag release uses its start revision and cannot rebase over a newly downloaded subtree', async () => {
  const h = harness([task('parent', 'Main task'), task('child', 'Subtask', 'parent'), task('last', 'Last task')]); await h.ready();
  h.layout('parent', 0, 64); h.layout('child', 64, 64); h.layout('last', 128, 64);
  const handle = h.nativeHandle('Main task'); handle.onPanResponderGrant({ nativeEvent: { pageY: 50 } }); h.render();
  handle.onPanResponderMove({}, { dy: 180, moveY: 230 }); h.render();
  h.remote([task('parent', 'Main task'), task('child', 'Subtask', 'parent'), task('new', 'Peer new subtask', 'parent'), task('last', 'Last task')]);
  await h.refresh(); handle.onPanResponderRelease(); h.render(); await settle(); h.render();
  assert.deepEqual(h.snapshot.flow.items.map((item) => item.id), ['parent', 'child', 'new', 'last']);
  assert.equal(h.commands.length, 0); assert.ok(h.nodes().some((node) => typeof node.props.children === 'string' && node.props.children.includes('changed on another device'))); h.unmount();
});

test('delayed parent deletion cannot delete subtasks added after the confirmation was shown', async () => {
  const h = harness([task('parent', 'Main task'), task('child', 'Subtask', 'parent')], { holdDelete: true }); await h.ready();
  await h.press('Actions for Main task'); await h.press('Delete task');
  h.remote([task('parent', 'Main task'), task('child', 'Subtask', 'parent'), task('new', 'Peer new subtask', 'parent')]); await h.refresh();
  await h.confirmDelete();
  assert.deepEqual(h.snapshot.flow.items.map((item) => item.id), ['parent', 'child', 'new']); assert.equal(h.commands.length, 0); h.unmount();
});

test('leaving the native checklist saves a valid draft with its original revision', async () => {
  const h = harness([task('note', 'Original')]); await h.ready(); await h.press('Edit task: Original'); h.setDraft('Save before back');
  assert.equal(await h.leave(), true); assert.equal(h.snapshot.flow.items[0].text, 'Save before back');
  assert.equal(h.commands.length, 1); assert.equal(h.find('Task text'), undefined); h.unmount();
});

test('leaving refuses a stale or invalid draft and keeps its text available for correction', async () => {
  const h = harness([task('note', 'Original')]); await h.ready(); await h.press('Edit task: Original'); h.setDraft('Keep local draft');
  h.remote([task('note', 'Peer saved')]); assert.equal(await h.leave(), false);
  assert.equal(h.snapshot.flow.items[0].text, 'Peer saved'); assert.equal(h.find('Task text').props.value, 'Keep local draft'); h.unmount();
  const invalid = harness([task('note', 'Original')]); await invalid.ready(); await invalid.press('Edit task: Original'); invalid.setDraft('Still editing');
  invalid.find('Task text color hex').props.onChangeText('#NOPE'); invalid.render(); assert.equal(await invalid.leave(), false);
  assert.equal(invalid.find('Task text').props.value, 'Still editing'); assert.equal(invalid.commands.length, 0); invalid.unmount();
});

test('leaving an empty new task cancels only the blank draft', async () => {
  const h = harness([task('note', 'Keep this')]); await h.ready(); await h.press('Add task');
  assert.equal(await h.leave(), true); assert.equal(h.commands.length, 0); assert.equal(h.find('Task text'), undefined);
  assert.equal(h.snapshot.flow.items[0].text, 'Keep this'); h.unmount();
});

test('Save and Back autosave lock draft controls until their exact acknowledgement', async () => {
  for (const mode of ['save', 'leave']) {
    let release; const gate = new Promise((resolve) => { release = resolve; });
    const h = harness([task('note', 'Original')], { saveGate: gate }); await h.ready();
    await h.press('Edit task: Original'); h.setDraft('Complete text before saving');
    const leaving = mode === 'leave' ? h.leave() : h.press('Save task'); h.render();
    const textInput = h.find('Task text'), colorInput = h.find('Task text color hex');
    assert.equal(textInput.props.editable, false, mode); assert.equal(colorInput.props.editable, false, mode);
    assert.equal(h.find('Bold').props.disabled, true, mode);
    textInput.props.onChangeText('Queued late text'); colorInput.props.onChangeText('#ABCDEF'); h.find('Bold').props.onPress(); h.render();
    assert.equal(h.find('Task text').props.value, 'Complete text before saving', mode);
    assert.equal(h.find('Task text color hex').props.value, '', mode);
    release(); const result = await leaving; await settle(); h.render();
    if (mode === 'leave') assert.equal(result, true);
    assert.equal(h.snapshot.flow.items[0].text, 'Complete text before saving', mode);
    assert.deepEqual(h.snapshot.flow.items[0].format, {}, mode); assert.equal(h.find('Task text'), undefined); h.unmount();
  }
});
