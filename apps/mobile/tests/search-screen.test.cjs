const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

// Exercise the screen's real async effect without loading native SQLite or mounting a native UI.
function screenHarness({ autoTasks = true } = {}) {
  const states = [];
  const requests = [];
  const taskRequests = [];
  const openedMinutes = []; const openedTasks = [];
  const timers = new Map();
  let hookIndex = 0;
  let nextTimer = 0;
  let stateWrites = 0;
  let nextEffect;
  let previousDependencies;
  let cleanup;
  let dataVersion = 0;
  let scope;
  const element = (type, props) => ({ type, props });
  const pureModules = new Map();
  function loadPure(filename) {
    if (pureModules.has(filename)) return pureModules.get(filename);
    const module = { exports: {} }; pureModules.set(filename, module.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require(name) {
      if (name.startsWith('.')) return loadPure(path.resolve(path.dirname(filename), `${name}.ts`));
      throw new Error(`Unexpected search model import: ${name}`);
    } }, { filename });
    return module.exports;
  }
  const filename = path.join(__dirname, '../src/screens/SearchScreen.tsx');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInContext(code, vm.createContext({
    module, exports: module.exports,
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(timer) { timers.delete(timer); },
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === 'react') return {
        useState(initial) {
          const index = hookIndex++;
          if (!(index in states)) states[index] = initial;
          return [states[index], (value) => {
            stateWrites += 1;
            states[index] = typeof value === 'function' ? value(states[index]) : value;
          }];
        },
        useMemo: (create) => create(),
        useEffect: (effect, dependencies) => { nextEffect = { effect, dependencies }; },
      };
      if (name === 'react-native') return { View: 'View', Text: 'Text', TextInput: 'TextInput',
        Pressable: 'Pressable', FlatList: 'FlatList', StyleSheet: { create: (styles) => styles } };
      if (name === '../appearance') return { useAppTheme: () => ({ colors: {}, resolvedMode: 'dark' }) };
      if (name === '../utils/time') return { formatCompactDate: String, minuteLabel: String };
      if (name === '../utils/search-scope') return loadPure(path.join(__dirname, '../src/utils/search-scope.ts'));
      if (name === '../data/checklist-flow') return { getChecklistFlow(listId) {
        const response = deferred(); taskRequests.push({ listId, ...response });
        if (autoTasks) response.resolve({ collection: { lists: [] } });
        return response.promise;
      } };
      if (name === '../data/database') return { searchEntries(query, limit, dates) {
        const response = deferred();
        requests.push({ query, limit, dates, ...response });
        return response.promise;
      } };
      throw new Error(`Unexpected search test import: ${name}`);
    },
  }), { filename });

  function render() {
    hookIndex = 0;
    const tree = module.exports.SearchScreen({ dataVersion, scope,
      onOpenResult(result) { openedMinutes.push(result); }, onOpenTask(result) { openedTasks.push(result); } });
    const changed = !previousDependencies || nextEffect.dependencies.some(
      (dependency, index) => dependency !== previousDependencies[index],
    );
    if (changed) {
      cleanup?.();
      previousDependencies = nextEffect.dependencies;
      cleanup = nextEffect.effect();
    }
    return tree;
  }
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  }
  function find(type, predicate = () => true) {
    return nodes(render()).find((node) => node.type === type && predicate(node.props));
  }
  return {
    requests,
    taskRequests,
    openedMinutes,
    openedTasks,
    render,
    find,
    get stateWrites() { return stateWrites; },
    setQuery(query) { find('TextInput').props.onChangeText(query); render(); },
    setDataVersion(value) { dataVersion = value; render(); },
    setScope(value) { scope = value; render(); },
    startRequests() {
      for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    },
    unmount() { cleanup?.(); },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a slower prior query cannot overwrite the latest search results', async () => {
  const screen = screenHarness();
  screen.setQuery('mum');
  screen.startRequests();
  screen.setQuery('doctor');
  screen.startRequests();
  assert.deepEqual(screen.requests.map(({ query, limit }) => [query, limit]), [['mum', 150], ['doctor', 150]]);
  const latest = [{ id: 'doctor-minute', text: 'Call doctor' }];
  screen.requests[1].resolve(latest);
  await settle();
  screen.requests[0].resolve([{ id: 'old-minute', text: 'Print for mum' }]);
  await settle();
  assert.equal(screen.find('FlatList').props.data, latest);
  screen.unmount();
});

test('a data refresh invalidates the earlier request including its failure path', async () => {
  const screen = screenHarness();
  screen.render();
  screen.startRequests();
  screen.setDataVersion(1);
  screen.startRequests();
  const refreshed = [{ id: 'fresh-minute' }];
  screen.requests[1].resolve(refreshed);
  await settle();
  screen.requests[0].reject(new Error('Old SQLite read failed'));
  await settle();
  assert.equal(screen.find('FlatList').props.data, refreshed);
  assert.equal(screen.find('Text', (props) => props.accessibilityRole === 'alert'), undefined);
  screen.unmount();
});

test('unmount invalidates pending search success and failure callbacks', async () => {
  for (const fails of [false, true]) {
    const screen = screenHarness();
    screen.render();
    screen.startRequests();
    screen.unmount();
    const writesBeforeCompletion = screen.stateWrites;
    if (fails) screen.requests[0].reject(new Error('SQLite unavailable'));
    else screen.requests[0].resolve([{ id: 'late-minute' }]);
    await settle();
    assert.equal(screen.stateWrites, writesBeforeCompletion);
  }
});

test('an active SQLite failure shows a retry action that can recover the search', async () => {
  const screen = screenHarness();
  screen.setQuery('history');
  screen.startRequests();
  screen.requests[0].reject(new Error('SQLite unavailable'));
  await settle();
  assert.ok(screen.find('Text', (props) => props.accessibilityRole === 'alert'));
  assert.equal(screen.find('FlatList').props.data.length, 0);
  assert.equal(screen.find('FlatList').props.ListEmptyComponent, undefined);
  screen.find('Pressable', (props) => props.accessibilityRole === 'button').props.onPress();
  screen.render();
  screen.startRequests();
  assert.equal(screen.requests[1].query, 'history');
  const recovered = [{ id: 'recovered-minute' }];
  screen.requests[1].resolve(recovered);
  await settle();
  assert.equal(screen.find('FlatList').props.data, recovered);
  assert.equal(screen.find('Text', (props) => props.accessibilityRole === 'alert'), undefined);
  screen.unmount();
});

const task = (id, text, checked = false) => ({ id, text, checked, parentId: null, format: {} });
const lists = () => [
  { id: 'main', name: 'Priority', items: [task('mum', 'Call mum'), task('done', 'Call doctor', true)] },
  { id: 'work', name: 'Work', items: [task('proposal', 'Call supplier')] },
];
const plain = (value) => JSON.parse(JSON.stringify(value));

test('current calendar Search passes its exact dates before the result limit and never reads Priority', async () => {
  const screen = screenHarness({ autoTasks: false });
  screen.setScope({ kind: 'calendar', dates: ['2026-11-02', '2026-10-30'] });
  screen.setQuery(' call '); screen.startRequests();
  assert.equal(screen.requests.length, 1); assert.equal(screen.taskRequests.length, 0);
  assert.deepEqual(plain(screen.requests[0].dates), ['2026-11-02', '2026-10-30']);
  assert.equal(screen.requests[0].query, 'call'); assert.equal(screen.requests[0].limit, 150);
  assert.equal(screen.find('TextInput').props.accessibilityLabel, 'Search current view');
  const minute = { id: 'minute', dateKey: '2026-11-02', minuteIndex: 500, text: 'Call dentist' };
  screen.requests[0].resolve([minute]); await settle();
  screen.find('FlatList').props.renderItem({ item: minute }).props.onPress();
  assert.deepEqual(screen.openedMinutes, [minute]); assert.deepEqual(screen.openedTasks, []);
  screen.unmount();
});

test('current Priority Search reads only its selected checklist and follows its hidden-completed setting', async () => {
  const screen = screenHarness({ autoTasks: false });
  screen.setScope({ kind: 'priority', listId: 'main', hideCompleted: true });
  screen.setQuery('Call'); screen.startRequests();
  assert.equal(screen.requests.length, 0); assert.deepEqual(screen.taskRequests.map((request) => request.listId), ['main']);
  screen.taskRequests[0].resolve({ collection: { lists: lists() } }); await settle();
  const hits = screen.find('FlatList').props.data;
  assert.deepEqual(plain(hits.map((hit) => [hit.kind, hit.listId, hit.task.id])), [['priority', 'main', 'mum']]);
  screen.find('FlatList').props.renderItem({ item: hits[0] }).props.onPress();
  assert.deepEqual(plain(screen.openedTasks), [{ listId: 'main', taskId: 'mum' }]);
  assert.deepEqual(screen.openedMinutes, []);
  screen.unmount();
});

test('global Search combines minute history and every checklist, including completed rows and list-name matches', async () => {
  const screen = screenHarness({ autoTasks: false }); screen.setQuery('Call'); screen.startRequests();
  assert.equal(screen.requests[0].dates, undefined); assert.equal(screen.taskRequests[0].listId, undefined);
  screen.requests[0].resolve([{ id: 'minute', text: 'Call in calendar' }]);
  screen.taskRequests[0].resolve({ collection: { lists: lists() } }); await settle();
  const hits = screen.find('FlatList').props.data;
  assert.deepEqual(plain(hits.map((hit) => hit.task?.id ?? hit.id)), ['minute', 'mum', 'done', 'proposal']);
  assert.equal(screen.find('TextInput').props.accessibilityLabel, 'Search all data');
  screen.setQuery('work'); screen.startRequests();
  screen.requests[1].resolve([]); screen.taskRequests[1].resolve({ collection: { lists: lists() } }); await settle();
  assert.deepEqual(plain(screen.find('FlatList').props.data.map((hit) => hit.task.id)), ['proposal']);
  screen.unmount();
});

test('changing scopes invalidates late calendar success and late Priority failures', async () => {
  const screen = screenHarness({ autoTasks: false });
  screen.setScope({ kind: 'calendar', dates: ['2026-11-02'] }); screen.startRequests();
  screen.setScope({ kind: 'priority', listId: 'main' }); screen.startRequests();
  screen.setScope({ kind: 'priority', listId: 'work' }); screen.startRequests();
  screen.taskRequests[1].resolve({ collection: { lists: lists() } }); await settle();
  screen.requests[0].resolve([{ id: 'stale-calendar' }]);
  screen.taskRequests[0].reject(new Error('Old account read failed')); await settle();
  assert.deepEqual(plain(screen.find('FlatList').props.data.map((hit) => hit.task.id)), ['proposal']);
  assert.equal(screen.find('Text', (props) => props.accessibilityRole === 'alert'), undefined);
  screen.unmount();
});

test('scope changes clear displayed data promptly and cancel debounced reads before they start', async () => {
  const screen = screenHarness({ autoTasks: false });
  screen.setScope({ kind: 'calendar', dates: ['2026-11-02'] }); screen.startRequests();
  screen.requests[0].resolve([{ id: 'previous-day' }]); await settle();
  assert.equal(screen.find('FlatList').props.data.length, 1);
  screen.setScope({ kind: 'calendar', dates: ['2026-11-03'] });
  assert.equal(screen.find('FlatList').props.data.length, 0);
  screen.setScope({ kind: 'priority', listId: 'work' }); screen.startRequests();
  assert.equal(screen.requests.length, 1, 'cancelled calendar timer must not reach SQLite');
  assert.equal(screen.taskRequests.length, 1);
  screen.taskRequests[0].resolve({ collection: { lists: lists() } }); await settle();
  screen.unmount();
});

test('same scope values do not requery on rerender, while empty calendar scope stays explicitly scoped', async () => {
  const screen = screenHarness({ autoTasks: false });
  screen.setScope({ kind: 'calendar', dates: [] }); screen.startRequests();
  screen.setScope({ kind: 'calendar', dates: [] }); screen.startRequests();
  assert.equal(screen.requests.length, 1); assert.deepEqual(plain(screen.requests[0].dates), []);
  screen.requests[0].resolve([]); await settle();
  assert.equal(screen.find('FlatList').props.data.length, 0); screen.unmount();
});

test('a live Priority read failure shows Retry and recovery retains the selected list scope', async () => {
  const screen = screenHarness({ autoTasks: false });
  screen.setScope({ kind: 'priority', listId: 'work' }); screen.startRequests();
  screen.taskRequests[0].reject(new Error('Encrypted checklist unavailable')); await settle();
  assert.ok(screen.find('Text', (props) => props.accessibilityRole === 'alert'));
  screen.find('Pressable', (props) => props.accessibilityRole === 'button').props.onPress(); screen.render(); screen.startRequests();
  assert.equal(screen.taskRequests[1].listId, 'work'); assert.equal(screen.requests.length, 0);
  screen.taskRequests[1].resolve({ collection: { lists: lists() } }); await settle();
  assert.equal(screen.find('FlatList').props.data[0].task.id, 'proposal');
  assert.equal(screen.find('Text', (props) => props.accessibilityRole === 'alert'), undefined);
  screen.unmount();
});
