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
      if (name === '../utils/cell-format' || name === '../utils/google-activity-colors') {
        const utility = { exports: {} };
        const utilityFile = path.join(__dirname, '../src', `${name.slice(3)}.ts`);
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
  const before = (await api.listCategories()).length;
  const color = (await api.listGoogleActivityColors())[0];
  for (let index = 0; index < 30; index += 1) await api.createCategory({ name: `Activity ${index}`, color });
  assert.equal((await api.listCategories()).length, before + 30);
  const category = (await api.listCategories()).find((item) => item.name === 'Activity 10');
  await api.updateCategory(category.id, { archived: true, name: 'Renamed activity' });
  assert.equal((await api.activeCategories()).length, before + 29);
  assert.equal(docs.get(`category:${category.id}`).name, 'Renamed activity');
  assert.equal((await api.listCategories()).find((item) => item.id === category.id).archived, true);
});

test('Google imports the full named label palette and keeps per-calendar label mappings', async () => {
  const labels = Array.from({ length: 200 }, (_, index) => ({ id: `label-${index}`, name: `Focus ${index}`, backgroundColor: '#112233' }));
  const { api } = categoriesRuntime({ calendars: [{ id: 'primary', title: 'My calendar', color: '#445566', providedColor: '#445566' }],
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
  await api.updateCategory(category.id, { name: 'Private display name', color: (await api.listGoogleActivityColors())[0] });
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
  const selectedColor = (await api.listGoogleActivityColors())[0];
  await api.updateCategory(category.id, { name: 'My work', color: selectedColor });
  await api.importDeviceCategories([{ ...calendars[0], title: 'Employer', color: '#778899' }]);
  const customized = (await api.listCategories()).find((item) => item.id === category.id);
  assert.equal(customized.name, 'My work');
  assert.equal(customized.color, selectedColor);
});

test('new activity choices reject arbitrary colors while preserving historical category records and names', async () => {
  const { api, docs } = categoriesRuntime();
  docs.set('category:legacy', { id: 'legacy', name: 'Old activity', color: '#112233' });
  const historical = await api.listCategories();
  assert.equal(historical.find((item) => item.id === 'legacy').color, '#112233');
  assert.equal((await api.listSelectableActivityCategories()).some((item) => item.id === 'legacy'), false);
  await assert.rejects(api.createCategory({ name: 'Arbitrary', color: '#112233' }), /Google Calendar palette/);
  await assert.rejects(api.updateCategory('legacy', { color: '#ABCDEF' }), /Google Calendar palette/);
  await api.updateCategory('legacy', { name: 'Renamed history', archived: true });
  assert.deepEqual(JSON.parse(JSON.stringify(docs.get('category:legacy'))), {
    id: 'legacy', name: 'Renamed history', color: '#112233', archived: true,
    updatedAt: docs.get('category:legacy').updatedAt,
  });
});

test('Google API palette and calendar-label hexes are eligible, while other provider colors do not authorize arbitrary choices', async () => {
  const { api, docs } = categoriesRuntime({ calendars: [{ id: 'primary', title: 'Calendar', color: '#112233', providedColor: '#112233' }],
    handler: async (_account, url) => url.endsWith('/colors')
      ? json({ event: { 1: { background: '#223344' } }, calendar: { 2: { background: '#334455' } } })
      : json({ labelProperties: { eventLabels: [{ id: 'label', name: 'Custom Google label', backgroundColor: '#445566' }] } }) });
  await api.importDeviceCategories([{ id: 'device', title: 'Other provider', color: '#556677' }]);
  await api.importAccountCategories(account('google'));
  const palette = await api.listGoogleActivityColors();
  for (const hex of ['#112233', '#223344', '#334455', '#445566']) assert.ok(palette.includes(hex));
  assert.equal(palette.includes('#556677'), false);
  const label = (await api.listCategories()).find((item) => item.providerLabelId === 'label');
  docs.set(`category:${label.id}`, { ...label, color: '#ABCDEF' });
  assert.equal((await api.listGoogleActivityColors()).includes('#ABCDEF'), false);
  assert.ok((await api.listGoogleActivityColors()).includes('#445566'));
  assert.equal((await api.listSelectableActivityCategories()).some((item) => item.id === label.id), false);
  await api.createCategory({ name: 'Google-provided color', color: '#445566' });
  const genericCalendar = (await api.listCategories()).find((item) => item.name === 'Google calendar color 2');
  assert.deepEqual(Object.keys(api.categoryProviderColor(genericCalendar.id, 'google', 'google:user', 'primary')), []);
});

test('Google calendar display fallbacks and legacy calendar-only records do not authorize new colors', async () => {
  const { api, docs } = categoriesRuntime({ calendars: [
    { id: 'missing', title: 'Missing background', color: '#8E8C86' },
    { id: 'actual', title: 'Actual background', color: '#8E8C86', providedColor: '#112233' },
  ] });
  docs.set('category:old_calendar', { id: 'old_calendar', name: 'Legacy fallback', color: '#8E8C86',
    provider: 'google', accountId: 'google:user', calendarId: 'missing', providerOriginalColor: '#8E8C86' });
  docs.set('category:old_event', { id: 'old_event', name: 'Legacy event palette', color: '#223344',
    provider: 'google', accountId: 'google:user', providerColorId: 'old-event' });
  docs.set('category:old_label', { id: 'old_label', name: 'Legacy label palette', color: '#334455',
    provider: 'google', accountId: 'google:user', calendarId: 'actual', providerLabelId: 'old-label' });
  assert.equal((await api.listGoogleActivityColors()).includes('#8E8C86'), false);
  assert.ok((await api.listGoogleActivityColors()).includes('#223344'));
  assert.ok((await api.listGoogleActivityColors()).includes('#334455'));
  const result = await api.importAccountCategories(account('google', false));
  assert.equal(result.added, 1);
  const categories = await api.listCategories();
  const actual = categories.find((category) => category.calendarId === 'actual' && category.googleColorVerified);
  assert.equal(actual.color, '#112233'); assert.equal(actual.providerOriginalColor, '#112233');
  assert.equal(categories.some((category) => category.name === 'Missing background'), false);
  assert.equal(categories.find((category) => category.id === 'old_calendar').color, '#8E8C86');
  assert.equal((await api.listGoogleActivityColors()).includes('#8E8C86'), false);
  assert.ok((await api.listGoogleActivityColors()).includes('#112233'));
});

test('Google mapping uses returned colors while mismatched local display overrides remain historical only', async () => {
  const { api, docs } = categoriesRuntime({ handler: async () => json({ event: {
    1: { background: '#112233' }, 2: { background: '#223344' },
  } }) });
  await api.importAccountCategories(account('google', false));
  const first = (await api.listCategories()).find((category) => category.providerColorId === '1');
  docs.set(`category:${first.id}`, { ...first, color: '#223344' });
  const custom = await api.createCategory({ name: 'Actual second Google shade', color: '#223344' });
  assert.equal(api.categoryProviderColor(custom.id, 'google', 'google:user', 'primary').colorId, '2');
  assert.equal(api.categoryProviderColor(first.id, 'google', 'google:user', 'primary').colorId, '1',
    'historical provider identity remains readable and unchanged');
  assert.equal((await api.listSelectableActivityCategories()).some((category) => category.id === first.id), false);
  assert.equal((await api.listCategories()).find((category) => category.id === first.id).color, '#223344');
});
