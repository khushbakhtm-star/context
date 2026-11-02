const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

test('a sole checklist metadata document does not suppress first-use activity colors or become a category', async () => {
  const checklist = { kind: 'checklistFlow', version: 1, items: [{ id: 'task_one', parentId: null,
    text: 'Call mum', checked: false, format: {} }] };
  const docs = new Map([['category:checklistFlow:main', checklist]]);
  const defaults = [{ id: 'sleep', name: 'Sleep', color: '#8B8199' }, { id: 'unaccounted', name: 'Unaccounted', color: '#96938C' }];
  const cache = [...defaults]; const settings = new Map(); const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const module = { exports: {} }; modules.set(filename, module.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, Date, Map, Set, Promise, console,
      require(name) {
        if (name === '../data/database') return {
          getSyncDocuments: async (prefix, excluded) => [...docs].filter(([key]) => key.startsWith(prefix) && (!excluded || !key.startsWith(excluded))).map(([key, value]) => ({ key, value })),
          putSyncDocument: async (key, value) => docs.set(key, value),
          getSetting: async (key, fallback) => settings.get(key) ?? fallback,
          setSetting: async (key, value) => settings.set(key, value),
        };
        if (name === '../theme') return { CATEGORIES: cache, DEFAULT_CATEGORIES: defaults, setCategoryCache: (values) => cache.splice(0, cache.length, ...values) };
        if (name === '../sync/accounts') return { getAccounts: async () => [] };
        if (name === '../sync/providers') return { createCalendarAdapter: () => { throw Error('Local category seeding must not need a provider'); } };
        if (name === '../sync/codec') return { hashValue: (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') };
        if (name === 'expo-crypto') return { randomUUID: crypto.randomUUID };
        if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`));
        throw Error(`Unexpected category isolation import ${name}`);
      },
    }, { filename });
    modules.set(filename, module.exports); return module.exports;
  }
  const api = load(path.join(__dirname, '../src/services/categories.ts'));
  const categories = await api.listCategories();
  for (const expected of defaults) {
    assert.ok(categories.some((category) => category.id === expected.id));
    assert.deepEqual(JSON.parse(JSON.stringify(docs.get(`category:${expected.id}`))), expected);
  }
  assert.equal(categories.some((category) => category.kind === 'checklistFlow' || category.id === 'checklistFlow'), false);
  assert.equal(cache.some((category) => category.kind === 'checklistFlow'), false);
  assert.equal(docs.get('category:checklistFlow:main'), checklist, 'category seeding must not mutate task metadata');
  const ids = Array.from(categories, (category) => category.id);
  assert.deepEqual(Array.from(await api.listCategories(), (category) => category.id), ids, 'repeat reads do not reseed or duplicate categories');
});
