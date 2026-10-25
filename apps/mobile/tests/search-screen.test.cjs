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
function screenHarness() {
  const states = [];
  const requests = [];
  const timers = new Map();
  let hookIndex = 0;
  let nextTimer = 0;
  let stateWrites = 0;
  let nextEffect;
  let previousDependencies;
  let cleanup;
  let dataVersion = 0;
  const element = (type, props) => ({ type, props });
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
      if (name === '../data/database') return { searchEntries(query, limit) {
        const response = deferred();
        requests.push({ query, limit, ...response });
        return response.promise;
      } };
      throw new Error(`Unexpected search test import: ${name}`);
    },
  }), { filename });

  function render() {
    hookIndex = 0;
    const tree = module.exports.SearchScreen({ dataVersion, onOpenResult() {} });
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
    render,
    find,
    get stateWrites() { return stateWrites; },
    setQuery(query) { find('TextInput').props.onChangeText(query); render(); },
    setDataVersion(value) { dataVersion = value; render(); },
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
