const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { setImmediate: nextTurn } = require('node:timers/promises');

function categoriesRuntime({ calendars = [], handler = async () => new Response('{}'), accounts = [], nativePalette = [], preferences = {}, entries = [], bindings = [] } = {}) {
  const docs = new Map();
  const settings = new Map(Object.entries(preferences));
  const defaults = [{ id: 'sleep', name: 'Sleep', color: '#8B8199' },
    { id: 'unaccounted', name: 'Unaccounted', color: '#96938C' }];
  const cache = [...defaults];
  const filename = path.join(__dirname, '../src/services/categories.ts');
  const module = { exports: {} };
  let colorUtilities;
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
        if (name === '../utils/google-activity-colors') colorUtilities = utility.exports;
        return utility.exports;
      }
      if (name === 'expo-crypto') return { randomUUID: crypto.randomUUID };
      if (name === '../data/database') return {
        getMinuteEntry: async (day, minute) => entries.find((entry) => entry.dateKey === day && entry.minuteIndex === minute),
        getSyncBindingsForBlock: async (id) => bindings.filter((binding) => binding.blockId === id),
        getSetting: async (key, fallback) => settings.get(key) ?? fallback,
        setSetting: async (key, value) => settings.set(key, value),
        getSyncDocuments: async (prefix, excluded) => [...docs.entries()].filter(([key]) => key.startsWith(prefix) &&
          (!excluded || !key.startsWith(excluded))).map(([key, value]) => ({ key, value })),
        putSyncDocument: async (key, value) => docs.set(key, value),
      };
      if (name === '../sync/accounts') return { accountFetch: handler, getAccounts: async () => accounts };
      if (name === '../../modules/context-calendar-colors') return { getEventPaletteAsync: async () => typeof nativePalette === 'function' ? nativePalette() : nativePalette };
      if (name === '../sync/providers') return { createCalendarAdapter: () => ({ listCalendars: async () => calendars }) };
      if (name === '../sync/codec') return { hashValue: (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') };
      if (name === '../theme') return { CATEGORIES: cache, DEFAULT_CATEGORIES: defaults,
        setCategoryCache: (values) => cache.splice(0, cache.length, ...values) };
      throw new Error(`Unexpected category test import: ${name}`);
    },
  }, { filename });
  return { api: module.exports, docs, cache, settings, colorUtilities };
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

test('a first user-edited plan minute can retain its exact source color through saved metadata without expanding the manual palette', async () => {
  const { api, docs } = categoriesRuntime();
  const category = await api.ensureSourceColorCategory({ color: '#123456', name: 'Personal calendar · #123456',
    calendarId: 'calendar', provider: 'device' });
  assert.equal(docs.get(`category:${category.id}`).color, '#123456');
  assert.equal((await api.listCategories()).find((item) => item.id === category.id).color, '#123456');
  const again = await api.ensureSourceColorCategory({ color: '#123456', name: 'Personal calendar · #123456', calendarId: 'calendar', provider: 'device' });
  assert.equal(again.id, category.id);
  assert.equal((await api.listSelectableActivityCategories()).some((item) => item.id === category.id), false);
});

test('a stalled account palette request cannot block local first-note color preparation', async () => {
  let release; let entered;
  const waiting = new Promise((resolve) => { release = resolve; });
  const requested = new Promise((resolve) => { entered = resolve; });
  const { api, docs } = categoriesRuntime({ calendars: [{ id: 'primary', title: 'Work', color: '#445566', providedColor: '#445566' }],
    handler: async () => { entered(); return waiting; } });
  await api.listCategories();
  const importing = api.importAccountCategories(account('google', false));
  await requested;
  let prepared = false;
  const local = api.ensureSourceColorCategory({ color: '#123456', name: 'Reading', calendarId: 'primary', provider: 'device' })
    .then((category) => { prepared = true; return category; });
  await nextTurn();
  const completedBeforeNetwork = prepared;
  // Always release the provider fixture, including on regression, so no test
  // leaves a pending category queue or relies on an elapsed-time threshold.
  release(json({ event: { 1: { background: '#778899' } } }));
  const [, category] = await Promise.all([importing, local]);
  assert.equal(completedBeforeNetwork, true, 'local save preparation must not acquire a lock held across account HTTP');
  assert.equal(docs.get(`category:${category.id}`).color, '#123456');
  assert.ok((await api.listCategories()).some((item) => item.providerColorId === '1'));
});

test('source color inheritance preserves explicit or customized historical category colors', async () => {
  const { api, docs } = categoriesRuntime();
  const source = { color: '#123456', name: 'Personal calendar · #123456', calendarId: 'calendar', provider: 'device' };
  const original = await api.ensureSourceColorCategory(source);
  const chosen = (await api.listGoogleActivityColors())[0];
  await api.updateCategory(original.id, { name: 'My chosen activity', color: chosen });
  const fresh = await api.ensureSourceColorCategory({ ...source, preferredCategoryId: original.id });
  assert.notEqual(fresh.id, original.id); assert.equal(fresh.color, source.color);
  assert.equal(docs.get(`category:${original.id}`).color, chosen);
  assert.equal(docs.get(`category:${original.id}`).name, 'My chosen activity');
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
  assert.equal(api.categoryProviderColor(first.id, 'google', 'google:user', 'primary').colorId, '2',
    'a deliberate display-color change maps only to the exact new provider shade');
  assert.equal(docs.get(`category:${first.id}`).providerColorId, '1', 'historical stored provenance remains intact');
  assert.equal((await api.listSelectableActivityCategories()).some((category) => category.id === first.id), false);
  assert.equal((await api.listCategories()).find((category) => category.id === first.id).color, '#223344');
});

test('Google writers refresh verified event choices in the background without blocking the picker or offering calendar-only colors', async () => {
  let release; const gate = new Promise((resolve) => { release = resolve; }); const requests = [];
  const writer = { id: 'google:writer', subject: 'writer', provider: 'google', consent: { calendarRead: true, calendarWrite: true, categoryRead: true } };
  const h = categoriesRuntime({ accounts: [writer], preferences: { 'account.calendars.google:writer': { writeCalendarId: 'target' } },
    handler: async (_account, url) => { requests.push(url); await gate; return url.endsWith('/colors') ? json({ event: { 10: { background: '#51B749' } } }) :
      json({ labelProperties: { eventLabels: [{ id: 'label', name: 'Target label', backgroundColor: '#123456' }] } }); } });
  let notified = 0; const stop = h.api.subscribeWritablePaletteChanges(() => { notified++; });
  const initial = await Promise.all(Array.from({ length: 15 }, () => h.api.listSelectableActivityCategories()));
  assert.ok(initial.every((choices) => choices.length === 0), 'uncached account colors cannot pretend calendar-only hexes are writable event IDs');
  assert.equal(requests.length, 1, 'the unresolved provider lookup is not awaited or duplicated by picker bursts');
  release(); for (let turn = 0; turn < 20 && !notified; turn++) await nextTurn();
  const choices = await h.api.listSelectableActivityCategories(); stop();
  assert.ok(choices.some((category) => category.providerColorId === '10')); assert.ok(choices.some((category) => category.providerLabelId === 'label'));
  assert.equal(choices.some((category) => category.id === 'google_palette_2952a3'), false);
  assert.ok((await h.api.listCategories()).some((category) => category.id === 'google_palette_2952a3'), 'historical local categories are retained');
  assert.equal(requests.length, 2); assert.ok(requests[1].includes('/target?')); assert.ok(notified > 0);
  assert.ok((await h.api.listSelectableActivityCategories({ writableOnly: false })).some((category) => category.id === 'google_palette_2952a3'),
    'offline data commands retain historical Google-proven categories');
});

test('named custom categories remain distinct and selectable through the exact scoped writable Google color', async () => {
  const writer = { id: 'google:writer', subject: 'writer', provider: 'google', consent: { calendarRead: true, calendarWrite: true } };
  const h = categoriesRuntime({ accounts: [writer], preferences: { 'account.calendars.google:writer': { writeCalendarId: 'primary' } },
    entries: [{ dateKey: '2026-10-25', minuteIndex: 600, blockId: 'owned' }],
    handler: async () => json({ event: { 10: { background: '#51B749' } } }) });
  h.docs.set('projection:owned', { accountId: writer.id, calendarId: 'primary', blockId: 'owned', state: 'synced' });
  await h.api.importAccountCategories(writer);
  const defaultCategory = JSON.parse(JSON.stringify(h.docs.get('category:sleep')));
  const first = await h.api.createCategory({ name: '  Professional study  ', color: '#51b749' });
  const second = await h.api.createCategory({ name: 'Family care', color: '#51B749' });
  const sameName = await h.api.createCategory({ name: 'Professional study', color: '#51B749' });
  assert.equal(new Set([first.id, second.id, sameName.id]).size, 3, 'neither a shared shade nor label collapses saved identities');
  assert.equal(first.name, 'Professional study'); assert.equal(first.color, '#51B749');
  const choices = await h.api.listSelectableActivityCategories({ scope: { dateKey: '2026-10-25', minuteIndex: 600 } });
  for (const category of [first, second, sameName]) {
    assert.equal(choices.find((choice) => choice.id === category.id)?.name, category.name);
    assert.equal(h.docs.get(`category:${category.id}`).name, category.name);
    assert.equal(h.api.categoryProviderColor(category.id, 'google', writer.id, 'primary').colorId, '10');
    assert.equal(h.docs.get(`category:${category.id}`).providerColorId, undefined, 'a custom label maps by exact shade without stealing provider identity');
  }
  assert.ok(choices.every((category) => category.color.toUpperCase() === '#51B749'), 'the custom labels do not expand source-writable colors');
  const renamed = await h.api.updateCategory(first.id, { name: 'Independent study' });
  assert.equal(renamed.id, first.id); assert.equal(renamed.color, first.color);
  assert.equal((await h.api.listSelectableActivityCategories()).find((choice) => choice.id === first.id).name, 'Independent study');
  assert.deepEqual(JSON.parse(JSON.stringify(h.docs.get('category:sleep'))), defaultCategory, 'default labels are not reassigned to arbitrary imported colors');
});

test('category ledger replay retains separate same-color labels and provider refresh preserves deliberate names', async () => {
  const writer = { id: 'google:writer', subject: 'writer', provider: 'google', consent: { calendarRead: true, calendarWrite: true } };
  const options = { accounts: [writer], preferences: { 'account.calendars.google:writer': { writeCalendarId: 'primary' } },
    handler: async () => json({ event: { 10: { background: '#51B749' } } }) };
  const a = categoriesRuntime(options); await a.api.importAccountCategories(writer);
  const first = await a.api.createCategory({ name: 'Client calls', color: '#51B749' });
  const second = await a.api.createCategory({ name: 'Family calls', color: '#51B749' });
  const providerCategory = (await a.api.listCategories()).find((category) => category.providerColorId === '10');
  await a.api.updateCategory(providerCategory.id, { name: 'My calendar label' });
  await a.api.importAccountCategories(writer);
  const b = categoriesRuntime(options);
  // Category documents travel unchanged through the existing private ledger.
  for (const [key, value] of a.docs) b.docs.set(key, JSON.parse(JSON.stringify(value)));
  const choices = await b.api.listSelectableActivityCategories();
  assert.equal(choices.find((category) => category.id === first.id).name, 'Client calls');
  assert.equal(choices.find((category) => category.id === second.id).name, 'Family calls');
  const restored = choices.find((category) => category.id === providerCategory.id);
  assert.equal(restored.name, 'My calendar label'); assert.equal(restored.providerOriginalName, 'Google event color 10');
  assert.equal(b.api.categoryProviderColor(restored.id, 'google', writer.id, 'primary').colorId, '10');
  await assert.rejects(b.api.createCategory({ name: 'Unsupported shade', color: '#123456' }), /Google Calendar palette/);
  assert.equal((await b.api.listCategories()).some((category) => category.name === 'Unsupported shade'), false);
});

test('selected native Google bindings use their exact native palette while account-owned cells use exact account identities', async () => {
  const writer = { id: 'google:writer', subject: 'writer', provider: 'google', consent: { calendarRead: true, calendarWrite: true } };
  const h = categoriesRuntime({ accounts: [writer], preferences: { 'calendar.preferences': { writeCalendarId: 'phone', selectedCalendarIds: ['phone'] } },
    nativePalette: [{ calendarId: 'phone', key: 'native-key', color: '#0B8043' }], entries: [{ dateKey: '2026-10-25', minuteIndex: 600, blockId: 'native_block' },
      { dateKey: '2026-10-25', minuteIndex: 601, blockId: 'account_block' }], bindings: [{ blockId: 'native_block', calendarId: 'phone' }],
    handler: async () => json({ event: { 10: { background: '#51B749' } } }) });
  h.docs.set('projection:owner', { accountId: writer.id, calendarId: 'account-cal', blockId: 'account_block', state: 'synced' });
  await h.api.listSelectableActivityCategories(); for (let turn = 0; turn < 12; turn++) await nextTurn();
  const native = await h.api.listSelectableActivityCategories({ scope: { dateKey: '2026-10-25', minuteIndex: 600 } });
  const accountChoices = await h.api.listSelectableActivityCategories({ scope: { dateKey: '2026-10-25', minuteIndex: 601 } });
  assert.ok(native.some((category) => category.color === '#0B8043')); assert.equal(native.some((category) => category.color === '#51B749'), false);
  assert.ok(accountChoices.some((category) => category.color === '#51B749')); assert.equal(accountChoices.some((category) => category.color === '#0B8043'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.categoryProviderColor(native[0].id, 'google', writer.id, 'account-cal'))), {},
    'a native Basil key is never guessed to be a different API Basil hex');
});

test('deliberate custom hex categories remain selectable without inventing Google colors or provider mappings', async () => {
  const writer = { id: 'google:writer', subject: 'writer', provider: 'google', consent: { calendarRead: true, calendarWrite: true } };
  const h = categoriesRuntime({ accounts: [writer], preferences: { 'account.calendars.google:writer': { writeCalendarId: 'primary' } } });
  const category = await h.api.createCategory({ name: '  My own label  ', color: '#12ab34', customColor: true });
  assert.match(category.id, /^custom_/); assert.equal(category.name, 'My own label'); assert.equal(category.color, '#12AB34');
  assert.equal(category.customColor, true); assert.equal(category.provider, undefined); assert.equal(category.providerColorId, undefined);
  assert.ok((await h.api.listSelectableActivityCategories()).some((choice) => choice.id === category.id));
  assert.ok((await h.api.listSelectableActivityCategories({ writableOnly: false })).some((choice) => choice.id === category.id));
  assert.equal((await h.api.listGoogleActivityColors()).includes('#12AB34'), false);
  assert.deepEqual(Object.keys(h.api.categoryProviderColor(category.id, 'google', writer.id, 'primary')), []);
  assert.equal(h.api.categoryProviderDisplayColor(category.id, 'google', writer.id, 'primary'), undefined);
  assert.equal(h.colorUtilities.isAllowedGoogleActivityColor('#12AB34', h.cache), false);
  assert.equal(h.colorUtilities.isSelectableActivityCategory(category, h.cache), true);
  const clock = category.colorUpdatedAt;
  const renamed = await h.api.updateCategory(category.id, { name: 'Renamed everywhere' });
  assert.equal(renamed.id, category.id); assert.equal(renamed.customColor, true); assert.equal(renamed.colorUpdatedAt, clock);
  assert.equal(h.cache.find((entry) => entry.id === category.id).name, 'Renamed everywhere');
  for (const color of ['#123', '#GGGGGG', 'red']) await assert.rejects(h.api.createCategory({ name: 'Invalid', color, customColor: true }), /hexadecimal/);
  await assert.rejects(h.api.createCategory({ name: '   ', color: '#123456', customColor: true }), /label/);
  await assert.rejects(h.api.createCategory({ name: 'Implicit arbitrary', color: '#123456' }), /Google Calendar palette/);
});

test('custom Google mapping uses exact verified target colors, nearest distance and deterministic ties without crossing accounts', async () => {
  const h = categoriesRuntime();
  for (const category of [
    { id: 'black', providerColorId: '1', color: '#000000', accountId: 'google:one' },
    { id: 'blue_two', providerColorId: '2', color: '#000002', accountId: 'google:one' },
    { id: 'other_account', providerColorId: '9', color: '#123456', accountId: 'google:other' },
    { id: 'target_label', providerLabelId: 'target', calendarId: 'primary', color: '#123456', accountId: 'google:one' },
    { id: 'foreign_label', providerLabelId: 'foreign', calendarId: 'elsewhere', color: '#123455', accountId: 'google:one' },
    { id: 'unverified', providerColorId: '10', color: '#123456', accountId: 'google:one', googleColorVerified: false },
  ]) h.docs.set(`category:${category.id}`, { name: category.id, provider: 'google', googleColorVerified: true, ...category });
  const exact = await h.api.createCategory({ name: 'Exact custom', color: '#123456', customColor: true });
  assert.equal(h.api.categoryProviderColor(exact.id, 'google', 'google:one', 'primary').eventLabelId, 'target');
  assert.equal(h.api.categoryProviderDisplayColor(exact.id, 'google', 'google:one', 'primary'), '#123456');
  assert.equal(h.api.categoryProviderColor(exact.id, 'google', 'google:one', 'another').colorId, '2', 'foreign labels and unverified exact colors are excluded');
  assert.equal(h.api.categoryProviderColor(exact.id, 'google', 'google:other', 'primary').colorId, '9');
  assert.deepEqual(Object.keys(h.api.categoryProviderColor(exact.id, 'google', 'google:unknown', 'primary')), []);
  const tied = await h.api.createCategory({ name: 'Between black and blue', color: '#000001', customColor: true });
  assert.equal(h.api.categoryProviderColor(tied.id, 'google', 'google:one', 'another').colorId, '1');
  assert.equal(h.api.categoryProviderDisplayColor(tied.id, 'google', 'google:one', 'another'), '#000000');
  const native = [{ key: 'z', color: '#000002', calendarId: 'phone' }, { key: 'a', color: '#000000', calendarId: 'phone' }];
  for (const candidates of [native, [...native].reverse()]) {
    assert.equal(h.colorUtilities.nearestVerifiedGoogleColor('#000001', candidates).key, 'a');
    assert.equal(h.colorUtilities.nearestVerifiedGoogleColor('#000002', candidates).key, 'z');
  }
  assert.equal(h.colorUtilities.nearestVerifiedGoogleColor('#000001', []), undefined);
  assert.equal(h.colorUtilities.nearestVerifiedGoogleColor('invalid', native), undefined);
});

test('stable provider category overrides preserve hidden verified proofs and user color clocks across provider refreshes', async () => {
  const writer = { id: 'google:writer', subject: 'writer', provider: 'google', consent: { calendarRead: true, calendarWrite: true } };
  let sourceColor = '#112233'; const h = categoriesRuntime({ accounts: [writer], handler: async () => json({ event: { 1: { background: sourceColor } } }) });
  await h.api.importAccountCategories(writer);
  const source = (await h.api.listCategories()).find((category) => category.providerColorId === '1');
  assert.equal(h.api.categoryUserColorUpdatedAt(source.id), null, 'provider import-now is not user color authority');
  const updated = await h.api.updateCategory(source.id, { name: 'My stable category', color: '#ABCDEF', customColor: true });
  assert.equal(updated.id, source.id); assert.equal(updated.providerColorId, '1'); assert.equal(updated.providerOriginalColor, '#112233');
  assert.equal(updated.customColor, true); assert.ok(Number.isFinite(h.api.categoryUserColorUpdatedAt(updated.id)));
  assert.equal(h.api.categoryProviderColor(updated.id, 'google', writer.id, 'primary').colorId, '1');
  assert.equal(h.api.categoryProviderDisplayColor(updated.id, 'google', writer.id, 'primary'), '#112233');
  const proof = [...h.docs.entries()].find(([key]) => key.startsWith('category:minuteFormat:providerPalette:'));
  assert.ok(proof); assert.equal(proof[1].color, '#112233'); assert.equal(proof[1].customColor, undefined);
  assert.equal((await h.api.listCategories()).some((category) => category.paletteOnly), false);
  assert.equal((await h.api.listSelectableActivityCategories()).some((category) => category.paletteOnly), false);
  assert.equal(h.settings.get('activity.categories.v2').some((category) => category.paletteOnly), false);
  assert.equal((await h.api.listGoogleActivityColors()).includes('#ABCDEF'), false);
  const colorClock = updated.colorUpdatedAt;
  sourceColor = '#334455'; await h.api.importAccountCategories(writer);
  const refreshed = (await h.api.listCategories()).find((category) => category.id === source.id);
  assert.equal(refreshed.color, '#ABCDEF'); assert.equal(refreshed.name, 'My stable category'); assert.equal(refreshed.colorUpdatedAt, colorClock);
  assert.equal(refreshed.providerOriginalColor, '#334455');
  assert.equal(h.api.categoryProviderDisplayColor(source.id, 'google', writer.id, 'primary'), '#334455');
  assert.equal(h.api.categoryForProviderColor('google', writer.id, 'primary', { colorId: '1' }), undefined, 'an external color never resolves to the overridden user row or hidden proof');
  const renamed = await h.api.updateCategory(source.id, { name: 'Renamed label' }); assert.equal(renamed.colorUpdatedAt, colorClock);
  const same = await h.api.updateCategory(source.id, { color: '#ABCDEF' }); assert.equal(same.colorUpdatedAt, colorClock);
  const recolored = await h.api.updateCategory(source.id, { color: '#123456', customColor: true });
  assert.ok(Date.parse(recolored.colorUpdatedAt) > Date.parse(colorClock)); assert.equal(recolored.id, source.id);
  h.docs.set(`category:${source.id}`, { ...recolored, colorUpdatedAt: '2026-10-31' }); await h.api.listCategories();
  assert.equal(h.api.categoryUserColorUpdatedAt(source.id), null, 'noncanonical timestamp strings are not authority');
  const defaultOverride = await h.api.updateCategory('sleep', { name: 'Local rest', color: '#654321', customColor: true });
  assert.equal(defaultOverride.id, 'sleep'); assert.equal(defaultOverride.color, '#654321');
});

test('a non-Google selected phone calendar does not erase the local Google-only palette when no writable native proof exists', async () => {
  const h = categoriesRuntime({ preferences: { 'calendar.preferences': { writeCalendarId: 'other-provider' } } });
  const choices = await h.api.listSelectableActivityCategories();
  assert.ok(choices.some((category) => category.id === 'google_palette_2952a3'));
  await h.api.importDeviceCategories([{ id: 'other-provider', title: 'Other calendar', color: '#123456' }]);
  assert.ok((await h.api.listSelectableActivityCategories()).some((category) => category.id === 'google_palette_2952a3'));
});


test('a same-account label from another calendar maps only an exact verified target event shade', async () => {
  const h = categoriesRuntime();
  h.docs.set('category:source_label', { id: 'source_label', name: 'Source label', color: '#112233',
    provider: 'google', accountId: 'google:writer', calendarId: 'source', providerLabelId: 'source-only', googleColorVerified: true });
  h.docs.set('category:target_shade', { id: 'target_shade', name: 'Target event color', color: '#112233',
    provider: 'google', accountId: 'google:writer', providerColorId: '7', googleColorVerified: true });
  await h.api.listCategories();
  assert.equal(h.api.categoryProviderColor('source_label', 'google', 'google:writer', 'target').colorId, '7');
  assert.equal(h.api.categoryProviderColor('source_label', 'google', 'google:writer', 'source').eventLabelId, 'source-only');
  assert.deepEqual(Object.keys(h.api.categoryProviderColor('source_label', 'google', 'google:other', 'target')), []);
});

test('late background account palettes cannot import or notify after disconnection, revocation or target changes', async () => {
  for (const change of ['disconnect', 'revoke', 'target']) {
    let release; const gate = new Promise((resolve) => { release = resolve; });
    const writer = { id: 'google:writer', subject: 'writer', provider: 'google', consent: { calendarRead: true, calendarWrite: true, categoryRead: true } };
    const accounts = [writer];
    const h = categoriesRuntime({ accounts, preferences: { 'account.calendars.google:writer': { writeCalendarId: 'first' } },
      handler: async (_account, url) => { await gate; return url.endsWith('/colors') ? json({ event: { 10: { background: '#51B749' } } }) :
        json({ labelProperties: { eventLabels: [{ id: 'late-label', name: 'Old target', backgroundColor: '#123456' }] } }); } });
    let notified = 0; h.api.subscribeWritablePaletteChanges(() => { notified++; });
    await h.api.listSelectableActivityCategories();
    if (change === 'disconnect') accounts.splice(0);
    if (change === 'revoke') writer.consent.calendarWrite = false;
    if (change === 'target') h.settings.set('account.calendars.google:writer', { writeCalendarId: 'second' });
    release(); for (let turn = 0; turn < 20; turn++) await nextTurn();
    assert.equal([...h.docs.values()].some((category) => category.accountId === writer.id), false, change);
    assert.equal(notified, 0, change);
    assert.ok((await h.api.listCategories()).some((category) => category.id === 'google_palette_2952a3'), 'historical cached choices remain');
  }
});

test('late native palette results do not populate a newly selected phone calendar', async () => {
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const h = categoriesRuntime({ preferences: { 'calendar.preferences': { writeCalendarId: 'old' } },
    nativePalette: async () => { await gate; return [{ calendarId: 'old', key: 'old-shade', color: '#0B8043' }]; } });
  let notified = 0; h.api.subscribeWritablePaletteChanges(() => { notified++; });
  await h.api.listSelectableActivityCategories(); h.settings.set('calendar.preferences', { writeCalendarId: 'new' });
  release(); for (let turn = 0; turn < 15; turn++) await nextTurn();
  assert.equal([...h.docs.values()].some((category) => category.providerColorId === 'old-shade'), false);
  assert.equal(notified, 0);
});
