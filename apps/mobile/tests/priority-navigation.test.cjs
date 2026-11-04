const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const file = path.join(__dirname, '../App.tsx');
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const controller = source.statements.find((node) => node.name?.text === 'AppController');
const names = ['CalendarTransitionCancelled', 'awaitCalendarTransition'];
const declarations = names.map((name) => source.statements.find((node) => node.name?.text === name).getText(source));
for (const name of ['transitionFromCalendar', 'returnToCalendar', 'switchPriorityList', 'openSearch', 'createPriorityList', 'renamePriorityList']) {
  const declaration = controller.body.statements.find((node) => node.name?.text === name); assert.ok(declaration, name); declarations.push(declaration.getText(source));
}
const code = ts.transpileModule(declarations.join('\n') + '\nexport { returnToCalendar, switchPriorityList, openSearch, createPriorityList, renamePriorityList };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(options = {}) {
  const events = []; const scopeValues = []; const module = { exports: {} };
  const context = {
    module, exports: module.exports, AbortController, Promise, Error,
    tab: options.tab ?? 'checklist', priorityHideCompleted: true,
    priorityCatalog: { revision: 'fresh-catalog', lists: [{ id: 'main', name: 'Priority' }, { id: 'family', name: 'Family' }] }, selectedPriorityListId: options.listId ?? 'main',
    tabRef: { current: options.tab ?? 'checklist' }, priorityMutationSequence: { current: 0 }, priorityCatalogRequest: { current: 0 },
    overviewDates: ['2026-11-01', '2026-11-03'],
    primaryTabRef: { current: 'checklist' },
    calendarFocusRef: { current: { dateKey: '2026-11-03', minuteIndex: 778 } }, focusSequence: { current: 6 },
    viewChangingRef: { current: false }, controllerMountedRef: { current: true }, lifecycleEpochRef: { current: 0 },
    transitionSequenceRef: { current: 0 }, activeTransitionRef: { current: null }, AppState: { currentState: 'active' },
    checklistBeforeLeaveRef: { current: async () => { events.push('save-task'); return options.saveGate ? options.saveGate : options.save !== false; } },
    notepadBeforeLeaveRef: { current: async () => { events.push('save-note'); return options.saveGate ? options.saveGate : options.save !== false; } },
    Keyboard: { dismiss() {} }, setViewChanging: (value) => events.push(['busy', value]),
    flushInlineMinutes: async () => { events.push('save-minutes'); }, inlineMinuteDrafts: { snapshot: () => [] },
    Alert: { alert: (...value) => events.push(['error', ...value]) },
    setSetting: async (key, value) => events.push(['setting', key, value]),
    setSelectedPriorityListId: (value) => events.push(['list', value]), setPriorityFocusTaskId: (value) => events.push(['focus', value]),
    setSearchScope: (value) => scopeValues.push(value), setTab: (value) => events.push(['tab', value]),
    setFocusRequest: (value) => events.push(['calendar-focus', value]),
    createChecklistList: async (name, expected) => { events.push(['create', name, expected]); if (options.mutationGate) await options.mutationGate;
      return { revision: 'own-create', listId: 'new-list', lists: [{ id: 'new-list', name }] }; },
    renameChecklistList: async (id, name, expected) => { events.push(['rename', id, name, expected]); if (options.mutationGate) await options.mutationGate;
      return { revision: 'own-rename', listId: id, lists: [{ id, name }] }; },
    setPriorityCatalog: (value) => events.push(['catalog', value.revision]), setPriorityCatalogError() {},
    resolvePriorityList: (id) => events.push(['select-created', id]), dataChanged: () => events.push('data-changed'),
  };
  vm.runInNewContext(code, context);
  return { ...module.exports, context, events, scopeValues };
}

test('returning from Priority waits for the task save and restores the saved calendar focus', async () => {
  let release;
  const h = harness({ saveGate: new Promise((resolve) => { release = resolve; }) });
  const transition = h.returnToCalendar();
  await settle();
  assert.equal(h.events.includes('save-task'), true);
  assert.equal(h.events.some((event) => event[0] === 'calendar-focus' || event[0] === 'tab'), false);
  release(true);
  await transition;
  assert.equal(JSON.stringify(h.events.find((event) => event[0] === 'calendar-focus')[1]),
    JSON.stringify({ dateKey: '2026-11-03', minuteIndex: 778, token: 7, openEditor: false }));
  assert.deepEqual(h.events.find((event) => event[0] === 'tab'), ['tab', 'today']);
  const blocked = harness({ save: false });
  await blocked.returnToCalendar();
  assert.equal(blocked.events.some((event) => event[0] === 'calendar-focus' || event[0] === 'tab'), false);
});

test('native checklist switching waits for the original task draft, publishes one selection, and clamps at list ends', async () => {
  let release; const saveGate = new Promise((resolve) => release = resolve); const h = harness({ saveGate });
  const change = h.switchPriorityList(1); await settle();
  assert.equal(h.events.filter((event) => event === 'save-task').length, 1);
  assert.equal(h.events.some((event) => event[0] === 'list'), false);
  await h.switchPriorityList(1); assert.equal(h.events.filter((event) => event === 'save-task').length, 1, 'repeat tap cannot start a second navigation');
  release(true); await change;
  assert.deepEqual(h.events.filter((event) => event[0] === 'list'), [['list', 'family']]);
  assert.deepEqual(h.events.filter((event) => event[0] === 'setting'), [['setting', 'priority.selected-list-id', 'family']]);
  const first = harness(); await first.switchPriorityList(-1); assert.deepEqual(first.events, []);
  const last = harness({ listId: 'family' }); await last.switchPriorityList(1); assert.deepEqual(last.events, []);
});

test('returning from Notepad waits for the note to save and keeps the editor open on a failed save', async () => {
  let release;
  const h = harness({ tab: 'notepad', saveGate: new Promise((resolve) => { release = resolve; }) });
  const transition = h.returnToCalendar();
  await settle();
  assert.ok(h.events.includes('save-note'));
  assert.equal(h.events.some((event) => event[0] === 'tab'), false);
  release(true);
  await transition;
  assert.deepEqual(h.events.find((event) => event[0] === 'tab'), ['tab', 'today']);

  const blocked = harness({ tab: 'notepad', save: false });
  await blocked.returnToCalendar();
  assert.equal(blocked.events.some((event) => event[0] === 'tab'), false);
});

test('a rejected draft or backgrounded continuation cannot change the selected checklist', async () => {
  const refused = harness({ save: false }); await refused.switchPriorityList(1);
  assert.equal(refused.events.some((event) => event[0] === 'list' || event[0] === 'setting'), false);
  let release; const gate = new Promise((resolve) => release = resolve); const h = harness({ saveGate: gate });
  const change = h.switchPriorityList(1); await settle();
  h.context.AppState.currentState = 'background'; h.context.lifecycleEpochRef.current++;
  h.context.activeTransitionRef.current.controller.abort(); release(true); await change;
  assert.equal(h.events.some((event) => event[0] === 'list' || event[0] === 'setting'), false);
});

test('a removed current list is changed only by an explicit arrow after its retained draft permits leaving', async () => {
  const blocked = harness({ listId: 'removed', save: false }); await blocked.switchPriorityList(1);
  assert.equal(blocked.events.some((event) => event[0] === 'list'), false);
  const recovered = harness({ listId: 'removed' }); await recovered.switchPriorityList(1);
  assert.deepEqual(recovered.events.filter((event) => event[0] === 'list'), [['list', 'main']]);
});

test('a downloaded collection missing the active Priority list does not remount its unsaved editor', async () => {
  const effect = controller.body.statements.find((node) => node.getText(source).includes('void getChecklistFlow().then'));
  assert.ok(effect); const code = ts.transpileModule(effect.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const tab of ['checklist', 'today']) {
    const changes = []; const context = {
      ready: true, dataVersion: 1, useEffect: (callback) => callback(),
      priorityCatalogRequest: { current: 0 }, controllerMountedRef: { current: true }, tabRef: { current: tab },
      selectedPriorityListIdRef: { current: 'removed' },
      getChecklistFlow: async () => ({ revision: 'peer-restored', listId: 'main', lists: [{ id: 'main', name: 'Priority', taskCount: 0 }] }),
      setPriorityCatalog: () => changes.push('catalog'), setPriorityCatalogError() {},
      setSelectedPriorityListId: (id) => changes.push(['select', id]), setSetting: async (key, id) => changes.push(['setting', key, id]),
    };
    vm.runInNewContext(code, context); await settle();
    assert.equal(changes.includes('catalog'), true);
    assert.equal(changes.some((value) => value[0] === 'select'), tab !== 'checklist', 'an active Priority editor keeps the missing list and its recoverable words');
  }
});

test('native toolbar Search captures its visible date set or selected checklist while menu Search remains global', async () => {
  const calendar = harness({ tab: 'today' }); await calendar.openSearch();
  calendar.context.overviewDates.push('2026-11-04');
  assert.equal(JSON.stringify(calendar.scopeValues[0]), JSON.stringify({ kind: 'calendar', dates: ['2026-11-01', '2026-11-03'] }));
  const priority = harness({ listId: 'family' }); await priority.openSearch();
  assert.equal(JSON.stringify(priority.scopeValues[0]), JSON.stringify({ kind: 'priority', listId: 'family', hideCompleted: true }));
  await priority.openSearch(true); assert.equal(priority.scopeValues[1], undefined);
  assert.equal(priority.events.filter((event) => event[0] === 'tab' && event[1] === 'search').length, 2);
  const blocked = harness({ save: false }); await blocked.openSearch(); assert.equal(blocked.scopeValues.length, 0);
});

test('Settings create and rename use the opened draft revision rather than adopting the current catalogue', async () => {
  const h = harness({ tab: 'settings' }); await h.createPriorityList('New list', 'opened-revision');
  await h.renamePriorityList('family', 'Family today', 'opened-rename-revision');
  assert.deepEqual(h.events.filter((event) => event[0] === 'create'), [['create', 'New list', 'opened-revision']]);
  assert.deepEqual(h.events.filter((event) => event[0] === 'rename'), [['rename', 'family', 'Family today', 'opened-rename-revision']]);
  assert.deepEqual(h.events.filter((event) => event[0] === 'select-created'), [['select-created', 'new-list']]);
  assert.equal(h.context.priorityCatalogRequest.current, 4, 'reads preceding either mutation are invalidated before and after its acknowledgement');
});

test('a late Settings creation keeps the durable list without replacing a task draft opened after leaving', async () => {
  for (const departure of ['navigate', 'background']) {
    let release; const mutationGate = new Promise((resolve) => release = resolve); const h = harness({ tab: 'settings', mutationGate });
    const save = h.createPriorityList('New list', 'opened-revision'); await settle();
    if (departure === 'navigate') { h.context.tabRef.current = 'checklist'; h.context.transitionSequenceRef.current++; }
    else { h.context.AppState.currentState = 'background'; h.context.lifecycleEpochRef.current++; }
    release(); await save;
    assert.equal(h.events.includes('data-changed'), true, 'the committed list remains available for the next catalogue refresh');
    assert.equal(h.events.some((event) => event[0] === 'select-created' || event[0] === 'catalog'), false, departure);
  }
  const stale = harness(); await assert.rejects(stale.createPriorityList('Late click', 'opened'), /Open Settings/);
  assert.equal(stale.events.some((event) => event[0] === 'create'), false);
});
