import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import ts from 'typescript';
import { emptyLedger, editCells, getMinute, undoEdit, type BrowserLedgerState } from '../src/ledger';
import { browserChecklist, changeBrowserChecklist, createBrowserChecklistList, minuteTaskSnapshot, newBrowserTask, renameBrowserChecklistList } from '../src/checklist-flow';
import { DEFAULT_CHECKLIST_LIST_ID, CHECKLIST_FLOW_KEY, checklistRows, type ChecklistTask } from '../shared/utils/checklist-flow';

const app = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('app.ts', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function functions(names: string[], context: any) {
  const nodes = parsed.statements.filter((node: any) => names.includes(node.name?.text));
  assert.equal(nodes.length, names.length);
  vm.runInNewContext(ts.transpileModule(nodes.map((node) => node.getText(parsed)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context;
}
const task = (id: string, text: string): ChecklistTask => ({ id, text, parentId: null, checked: false, format: {} });
const copy = (value: unknown) => JSON.parse(JSON.stringify(value));
function sample() {
  let state = editCells(emptyLedger('browser_priority_fixture'), [
    { day: '2026-11-02', minute: 510, text: 'Dentist drive' },
    { day: '2026-11-03', minute: 600, text: 'Dentist follow-up' },
  ], 1000).state;
  let result = changeBrowserChecklist(state, undefined, { type: 'add', item: task('task_dental_main', 'Dentist first list') }, 1100);
  state = createBrowserChecklistList(result.state, browserChecklist(result.state).revision, 'list_other', 'Later', 1200).state;
  state = changeBrowserChecklist(state, browserChecklist(state).revision, { type: 'add', item: task('task_dental_other', 'Dentist second list') }, 1300, 'list_other').state;
  return state;
}
function gate() {
  let release!: () => void, reached!: () => void;
  return { promise: new Promise<void>((resolve) => { release = resolve; }), started: new Promise<void>((resolve) => { reached = resolve; }), release: () => release(), reached: () => reached() };
}

function destinationFixture(state: BrowserLedgerState, checklistDestination = '') {
  const choices = { buttons: [] as HTMLButtonElement[], replaceChildren() { this.buttons = []; }, append(button: HTMLButtonElement) { this.buttons.push(button); } };
  let onClose: () => void = () => {};
  const dialog = { opens: 0, returnValue: '', showModal() { this.opens++; }, addEventListener(_event: string, listener: () => void) { onClose = listener; },
    close(value = '') { this.returnValue = value; onClose(); } };
  const active = { state, writes: 0, async update(change: (state: BrowserLedgerState) => BrowserLedgerState) { this.writes++; this.state = change(this.state); } };
  const visited: string[] = [];
  const context = functions(['addEditorTextToChecklist', 'createChecklistTask', 'pickChecklistDestination'], { store: active, priorityScope: { store: active },
    browserChecklist, changeBrowserChecklist, minuteTaskSnapshot, newBrowserTask, activeChecklistId: 'main', priorityUndos: new Map(), synchronize() {},
    settings: { checklistDestination },
    element: (id: string) => id === 'checklist-destination' ? dialog : choices, document: { createElement: () => ({}) },
    async choosePriorityList(id: string) { visited.push(id); }, async showChecklistView() { visited.push('main'); } });
  const snapshot = minuteTaskSnapshot([{ day: '2026-11-02', minute: 510, text: 'Call dentist' }]);
  return { active, choices, context, dialog, visited, add: () => context.createChecklistTask(snapshot) as Promise<void> };
}

test('Add to Priority opens the chosen destination, and a sole list needs no prompt', async () => {
  const h = destinationFixture(sample()); const pending = h.add();
  assert.deepEqual(h.choices.buttons.map((button) => button.textContent), ['Priority', 'Later']);
  assert.equal(h.active.writes, 0);
  h.choices.buttons[1]!.onclick!(new Event('click') as PointerEvent);
  await pending;
  assert.deepEqual(h.visited, ['list_other']);
  assert.deepEqual(browserChecklist(h.active.state, 'list_other').flow.items.map((item) => item.text), ['Dentist second list', 'Call dentist']);
  assert.deepEqual(browserChecklist(h.active.state).flow.items.map((item) => item.text), ['Dentist first list']);

  const single = destinationFixture(emptyLedger('browser_priority_single'));
  await single.add();
  assert.equal(single.dialog.opens, 0); assert.deepEqual(single.visited, ['main']);
  assert.equal(browserChecklist(single.active.state).flow.items[0]?.text, 'Call dentist');
});

test('canceling the destination or changing accounts while it is open cannot add a task', async () => {
  const h = destinationFixture(sample()); const canceled = h.add(); h.dialog.close(); await canceled;
  const stale = h.add(); h.context.store = {}; h.dialog.close('list_other'); await assert.rejects(stale, /account or checklist changed/);
  assert.equal(h.active.writes, 0); assert.deepEqual(h.visited, []);
});

test('a configured checklist receives captured text directly while a missing destination still asks', async () => {
  const selected = destinationFixture(sample(), 'list_other');
  await selected.add();
  assert.equal(selected.dialog.opens, 0);
  assert.deepEqual(selected.visited, ['list_other']);
  assert.equal(browserChecklist(selected.active.state, 'list_other').flow.items.at(-1)?.text, 'Call dentist');

  const missing = destinationFixture(sample(), 'list_deleted');
  const pending = missing.add();
  assert.equal(missing.dialog.opens, 1);
  missing.dialog.close();
  await pending;
  assert.equal(missing.active.writes, 0);
});

test('highlighted minute text uses the same destination prompt and saves only the passage', async () => {
  const h = destinationFixture(sample());
  h.context.editor = { day: '2026-11-02', minute: 510, input: { value: 'Call dentist now', selectionStart: 5, selectionEnd: 12 } };
  h.context.saveEditor = async () => {};
  const pending = h.context.addEditorTextToChecklist();
  await setImmediate();
  assert.deepEqual(h.choices.buttons.map((button) => button.textContent), ['Priority', 'Later']);
  h.dialog.close('list_other');
  await pending;
  const captured = browserChecklist(h.active.state, 'list_other').flow.items.at(-1);
  assert.equal(captured?.text, 'dentist');
  assert.deepEqual(copy(captured?.source?.selection), { start: 5, end: 12 });
});

test('top Search restricts the actual list or exact visible dates, while menu Search includes every list and minute', () => {
  const context = functions(['browserSearch'], { browserChecklist, checklistRows, DEFAULT_CHECKLIST_LIST_ID, settings: { hideCompleted: false } });
  const state = sample();
  assert.deepEqual(copy(context.browserSearch(state, 'Dentist', { kind: 'calendar', dates: ['2026-11-02'] })).map((hit: any) => hit.day), ['2026-11-02']);
  assert.deepEqual(copy(context.browserSearch(state, 'Dentist', { kind: 'calendar', dates: [] })), []);
  assert.deepEqual(copy(context.browserSearch(state, 'Dentist', { kind: 'priority', listId: 'list_other' })).map((hit: any) => hit.text), ['Dentist second list']);
  assert.equal(context.browserSearch(state, 'Dentist', { kind: 'all' }).length, 4);
  assert.throws(() => context.browserSearch(state, 'Dentist', { kind: 'priority', listId: 'list_missing' }), /changed|available/);
});

test('Hide completed filters current Priority search and never conceals completed tasks from the all-history search', () => {
  let state = sample(); state = changeBrowserChecklist(state, browserChecklist(state).revision,
    { type: 'check', id: 'task_dental_main', checked: true }, 1400).state;
  const context = functions(['browserSearch'], { browserChecklist, checklistRows, DEFAULT_CHECKLIST_LIST_ID, settings: { hideCompleted: true } });
  assert.equal(context.browserSearch(state, 'Dentist', { kind: 'priority', listId: 'main' }).length, 0);
  assert.equal(context.browserSearch(state, 'Dentist', { kind: 'all' }).length, 4);
});

test('current Priority search also hides an unchecked descendant beneath a completed parent exactly like the visible rows', () => {
  let state = sample(); state = changeBrowserChecklist(state, browserChecklist(state).revision,
    { type: 'add', item: { ...task('task_dental_nested', 'Dentist child under hidden parent'), parentId: 'task_dental_main' } }, 1400).state;
  const collection = state.documents.find((document) => document.key === CHECKLIST_FLOW_KEY)!.value as any;
  collection.lists[0].items.find((item: ChecklistTask) => item.id === 'task_dental_main').checked = true;
  const context = functions(['browserSearch'], { browserChecklist, checklistRows, DEFAULT_CHECKLIST_LIST_ID, settings: { hideCompleted: true } });
  assert.equal(context.browserSearch(state, 'Dentist', { kind: 'priority', listId: 'main' }).length, 0);
  assert.equal(context.browserSearch(state, 'Dentist', { kind: 'all' }).length, 5);
});

test('changing lists waits for its draft and cannot redirect a newer selected list after the old acknowledgement', async () => {
  const pending = gate(); const active = { state: sample() }; const scope = {}; let switches = 0;
  const context = functions(['choosePriorityList'], { store: active, priorityScope: scope, priorityNavigation: 0,
    browserChecklist, async saveEditor() {}, checklistUI: { async flush() { pending.reached(); await pending.promise; }, clear() {} },
    bindPriorityList() { switches++; }, setChecklistVisible() {} });
  const move = context.choosePriorityList('list_other'); await pending.started;
  context.priorityScope = {}; pending.release(); await move;
  assert.equal(switches, 0);
});

test('a missing selected list is resolved only by explicit list navigation, using catalog IDs without adopting another list for edits', async () => {
  const active = { state: sample() }; const chosen: string[] = [];
  const context = functions(['stepPriorityList'], { store: active, priorityScope: { store: active }, activeChecklistId: 'list_removed_by_peer', browserChecklist,
    async choosePriorityList(id: string) { chosen.push(id); } });
  assert.equal(context.activeChecklistId, 'list_removed_by_peer');
  await context.stepPriorityList(1); assert.deepEqual(chosen, ['main']);
  assert.equal(context.activeChecklistId, 'list_removed_by_peer', 'the edit identity itself remains owned by guarded navigation');
});

test('Priority Undo flushes the newest task draft and undoes that list while leaving the calendar and other list intact', async () => {
  const state = sample(); const active = { state, async update(change: (state: BrowserLedgerState) => BrowserLedgerState) { this.state = change(this.state); } };
  const map = new Map(); const scope = {}; let renders = 0;
  const context = functions(['undoCurrentView'], { store: active, priorityScope: scope, activeChecklistId: 'main', checklistVisible: true,
    priorityUndos: map, undo: null, undoEdit, async saveEditor() {}, checklistUI: { async flush() {
      const result = changeBrowserChecklist(active.state, browserChecklist(active.state).revision,
        { type: 'edit', id: 'task_dental_main', text: 'Newest draft before Undo' }, 1500);
      active.state = result.state; map.set('main', { store: active, edit: result.undo });
    } }, render() { renders++; }, status() {}, synchronize() {} });
  await context.undoCurrentView();
  assert.equal(browserChecklist(active.state).flow.items[0]!.text, 'Dentist first list');
  assert.equal(browserChecklist(active.state, 'list_other').flow.items[0]!.text, 'Dentist second list');
  assert.equal(getMinute(active.state, '2026-11-02', 510)!.value!.text, 'Dentist drive');
  assert.equal(map.size, 0); assert.equal(renders, 1);
});

test('an old Undo acknowledgement cannot clear the newly selected account undo or render its view', async () => {
  const pending = gate(); const state = sample(); const edited = changeBrowserChecklist(state, browserChecklist(state).revision,
    { type: 'edit', id: 'task_dental_main', text: 'Old account edit' }, 1600);
  const active = { state: edited.state, async update(change: any) { this.state = change(this.state); pending.reached(); await pending.promise; } };
  const map = new Map([['main', { store: active, edit: edited.undo }]]); let renders = 0;
  const context = functions(['undoCurrentView'], { store: active, priorityScope: {}, activeChecklistId: 'main', checklistVisible: true,
    priorityUndos: map, undo: null, undoEdit, async saveEditor() {}, checklistUI: { async flush() {} }, render() { renders++; }, status() {}, synchronize() {} });
  const work = context.undoCurrentView(); await pending.started;
  const replacement = { store: {}, edit: edited.undo }; context.store = replacement.store; context.priorityScope = {}; map.set('main', replacement as any);
  pending.release(); await work; assert.equal(map.get('main'), replacement); assert.equal(renders, 0);
});

function catalogFixture() {
  const state = sample(); const scope = {}; const pending = gate(); const elements: Record<string, any> = {};
  const element = (id: string) => elements[id] ??= { value: '', textContent: '', querySelectorAll() { return []; } };
  let beforeApply: (() => void) | undefined; let acknowledge = false; let renders = 0; let retained: Map<string, string> | undefined;
  const active = { state, async update(change: any) { if (!acknowledge) { pending.reached(); await pending.promise; } beforeApply?.(); this.state = change(this.state); if (acknowledge) { pending.reached(); await pending.promise; } } };
  const session = { store: active, scope, revision: browserChecklist(active.state).revision };
  const input = { value: 'My new name', dataset: { listId: 'main' } }; element('priority-lists').querySelectorAll = () => [input];
  const context = functions(['changePriorityCatalog'], { Error, store: active, priorityScope: scope, prioritySettingsSession: session,
    prioritySettingsBusy: false, element, createBrowserChecklistList, renameBrowserChecklistList,
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' },
    renderPrioritySettings(drafts: Map<string, string>) { renders++; retained = drafts; }, checklistUI: { refresh() {} }, updateHeader() {}, synchronize() {} });
  return { context, active, session, pending, input, element, get renders() { return renders; }, get retained() { return retained; },
    set beforeApply(value: () => void) { beforeApply = value; }, set acknowledge(value: boolean) { acknowledge = value; } };
}

test('Settings rename uses the displayed catalog revision and preserves the typed name when a peer changes the collection', async () => {
  const h = catalogFixture();
  const work = h.context.changePriorityCatalog(h.session, () => h.input.value, 'main', h.input); await h.pending.started;
  h.beforeApply = () => { h.active.state = createBrowserChecklistList(h.active.state, browserChecklist(h.active.state).revision, 'list_peer', 'Peer list', 2000).state; };
  h.pending.release(); await work;
  assert.match(h.element('priority-settings-error').textContent, /changed/); assert.equal(h.input.value, 'My new name');
  assert.equal(browserChecklist(h.active.state).lists[0]!.name, 'Priority'); assert.equal(h.renders, 0);
});

test('typing a newer checklist name during save survives its earlier successful acknowledgement', async () => {
  const h = catalogFixture(); h.acknowledge = true;
  const work = h.context.changePriorityCatalog(h.session, () => h.input.value, 'main', h.input); await h.pending.started;
  h.input.value = 'My newer unsaved name'; h.pending.release(); await work;
  assert.equal(browserChecklist(h.active.state).lists[0]!.name, 'My new name');
  assert.equal(h.retained?.get('main'), 'My newer unsaved name'); assert.equal(h.renders, 1);
});

test('an old catalog creation acknowledgement cannot clear a name entered for another account', async () => {
  const h = catalogFixture(); h.acknowledge = true; h.element('priority-new-name').value = 'Old account list';
  const work = h.context.changePriorityCatalog(h.session, () => h.element('priority-new-name').value); await h.pending.started;
  h.context.store = {}; h.context.priorityScope = {}; h.context.prioritySettingsSession = {}; h.element('priority-new-name').value = 'New account draft';
  h.pending.release(); await work;
  assert.equal(h.element('priority-new-name').value, 'New account draft'); assert.equal(h.renders, 0);
});

test('Priority uses the shared header, clipboard binder, scoped Search and settings-only completion preference', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../app.css', import.meta.url), 'utf8');
  const header = /<header>[\s\S]*?<\/header>/.exec(html)![0];
  for (const id of ['menu', 'previous', 'now', 'next', 'undo', 'search', 'sync']) assert.match(header, new RegExp(`id="${id}"`));
  assert.match(header, /class="priority-binder"/); assert.match(html, /id="view-checklist"><svg/);
  assert.match(html, /id="priority-options"[\s\S]*id="hide-completed"[\s\S]*id="priority-hide-info"/);
  assert.doesNotMatch(css, /view-checklist[^{}]*header[^{}]*\{[^}]*display:none/);
  assert.doesNotMatch(html, /Checklist task flow|Add your first task/);
});
