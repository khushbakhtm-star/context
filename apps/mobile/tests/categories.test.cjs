const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

function categoriesRuntime({ calendars = [], handler = async () => new Response('{}') } = {}) {
  const docs = new Map();
  const settings = new Map();
  const defaults = [{ id: 'sleep', name: 'Sleep', color: '#8B8199' },
    { id: 'unaccounted', name: 'Unaccounted', color: '#96938C' }];
  const cache = [...defaults];
  const filename = path.join(__dirname, '../src/services/categories.ts');
  const module = { exports: {} };
  const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(javascript, {
    module, exports: module.exports, Date, Map, Set, Promise, Response, console,
    require(name) {
      if (name === '../utils/cell-format') {
        const utility = { exports: {} };
        const utilityFile = path.join(__dirname, '../src/utils/cell-format.ts');
        const utilityCode = ts.transpileModule(fs.readFileSync(utilityFile, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        vm.runInNewContext(utilityCode, { module: utility, exports: utility.exports, Date }, { filename: utilityFile });
        return utility.exports;
      }
      if (name === 'expo-crypto') return { randomUUID: crypto.randomUUID };
      if (name === '../data/database') return {
        getSetting: async (key, fallback) => settings.get(key) ?? fallback,
        setSetting: async (key, value) => settings.set(key, value),
        getSyncDocuments: async (prefix, excluded) => [...docs.entries()].filter(([key]) => key.startsWith(prefix) &&
          (!excluded || !key.startsWith(excluded))).map(([key, value]) => ({ key, value })),
        putSyncDocument: async (key, value) => docs.set(key, value),
      };
      if (name === '../sync/accounts') return { accountFetch: handler };
      if (name === '../sync/providers') return { createCalendarAdapter: () => ({ listCalendars: async () => calendars }) };
      if (name === '../sync/codec') return { hashValue: (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') };
      if (name === '../theme') return { CATEGORIES: cache, DEFAULT_CATEGORIES: defaults,
        setCategoryCache: (values) => cache.splice(0, cache.length, ...values) };
      throw new Error(`Unexpected category test import: ${name}`);
    },
  }, { filename });
  return { api: module.exports, docs, cache };
}
const account = (provider, categoryRead = true) => ({ id: `${provider}:user`, provider,
  consent: { calendarRead: true, categoryRead } });
const json = (value) => new Response(JSON.stringify(value), { status: 200 });

test('categories are not limited to nine, synchronize as documents, and archive without deleting history', async () => {
  const { api, docs } = categoriesRuntime();
  for (let index = 0; index < 30; index += 1) await api.createCategory({ name: `Activity ${index}`, color: '#AABBCC' });
  assert.equal((await api.listCategories()).length, 32);
  const category = (await api.listCategories()).find((item) => item.name === 'Activity 10');
  await api.updateCategory(category.id, { archived: true, name: 'Renamed activity' });
  assert.equal((await api.activeCategories()).length, 31);
  assert.equal(docs.get(`category:${category.id}`).name, 'Renamed activity');
  assert.equal((await api.listCategories()).find((item) => item.id === category.id).archived, true);
});

test('Google imports the full named label palette and keeps per-calendar label mappings', async () => {
  const labels = Array.from({ length: 200 }, (_, index) => ({ id: `label-${index}`, name: `Focus ${index}`, backgroundColor: '#112233' }));
  const { api } = categoriesRuntime({ calendars: [{ id: 'primary', title: 'My calendar', color: '#445566' }],
    handler: async (_account, url) => url.endsWith('/colors')
      ? json({ event: { 1: { background: '#778899' } } }) : json({ labelProperties: { eventLabels: labels } }) });
  const result = await api.importAccountCategories(account('google'));
  assert.equal(result.added, 202);
  const imported = (await api.listCategories()).find((item) => item.providerLabelId === 'label-199');
  assert.equal(api.categoryProviderColor(imported.id, 'google', 'google:user', 'primary').eventLabelId, 'label-199');
  assert.equal(Object.keys(api.categoryProviderColor(imported.id, 'google', 'google:user', 'other')).length, 0);
  assert.equal((await api.importAccountCategories(account('google'))).added, 0);
});

test('Outlook imports every named category and retains original categoryName after local rename', async () => {
  const { api } = categoriesRuntime({ handler: async () => json({ value: Array.from({ length: 45 }, (_, index) => ({
    id: `outlook-${index}`, displayName: `Project ${index}`, color: `preset${index % 25}`,
  })) }) });
  const result = await api.importAccountCategories(account('microsoft'));
  assert.equal(result.added, 45);
  const category = (await api.listCategories()).find((item) => item.name === 'Project 44');
  await api.updateCategory(category.id, { name: 'Private display name', color: '#ABCDEF' });
  assert.equal(api.categoryProviderColor(category.id, 'microsoft', 'microsoft:user').categoryName, 'Project 44');
});

test('category import does not request Outlook mailbox categories without separate permission', async () => {
  let requests = 0;
  const { api } = categoriesRuntime({ calendars: [{ id: 'cal', title: 'Work', color: '#123456' }],
    handler: async () => { requests += 1; return json({}); } });
  const result = await api.importAccountCategories(account('microsoft', false));
  assert.equal(result.added, 1);
  assert.equal(requests, 0);
  assert.match(result.note, /category reading/);
});

test('long imported IDs do not collide through prefix truncation', async () => {
  const { api } = categoriesRuntime();
  const prefix = 'calendar-'.repeat(30);
  await api.importDeviceCategories([
    { id: `${prefix}a`, title: 'A', color: '#112233' },
    { id: `${prefix}b`, title: 'B', color: '#112233' },
  ]);
  const imported = (await api.listCategories()).filter((item) => item.provider === 'device');
  assert.equal(imported.length, 2);
  assert.notEqual(imported[0].id, imported[1].id);
});

test('reimport refreshes provider changes while preserving a deliberate local display override', async () => {
  const { api } = categoriesRuntime();
  const calendars = [{ id: 'calendar', title: 'Work', color: '#112233' }];
  await api.importDeviceCategories(calendars);
  const category = (await api.listCategories()).find((item) => item.provider === 'device');
  await api.importDeviceCategories([{ ...calendars[0], title: 'Projects', color: '#445566' }]);
  const refreshed = (await api.listCategories()).find((item) => item.id === category.id);
  assert.equal(refreshed.name, 'Projects');
  assert.equal(refreshed.color, '#445566');
  await api.updateCategory(category.id, { name: 'My work', color: '#AABBCC' });
  await api.importDeviceCategories([{ ...calendars[0], title: 'Employer', color: '#778899' }]);
  const customized = (await api.listCategories()).find((item) => item.id === category.id);
  assert.equal(customized.name, 'My work');
  assert.equal(customized.color, '#AABBCC');
});
