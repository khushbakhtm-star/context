import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function fixture(view = 'calendar') {
  const text = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const source = ts.createSourceFile('app.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) &&
    ['calendarAddPoint', 'headerAddActions', 'prepareHeaderAdd'].includes(node.name?.text ?? ''));
  const calls: unknown[][] = [];
  const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  const trigger = { getBoundingClientRect: () => ({ bottom: 48 }) };
  const actionButtons: any[] = [];
  const menu = {
    open: false, style: { top: '' },
    matches() { return this.open; },
    hidePopover() { this.open = false; },
    replaceChildren(...children: any[]) { actionButtons.splice(0, actionButtons.length, ...children); },
    querySelector() { return actionButtons.find((button) => !button.disabled); },
  };
  const context = {
    store: {}, priorityScope: {}, commandBusy: false, view,
    currentBrowserView: () => context.view,
    dates: () => ['2026-10-31'], day: '2026-10-31', selectionActivated: true,
    selected: { day: '2026-10-31', minute: 615 }, main: { scrollTop: 16_050 },
    dateKey: () => '2026-11-01',
    element: (id: string) => id === 'add-menu' ? menu : id === 'header-add' ? trigger : { click: record(id) },
    document: { createElement: () => ({ focus: record('focus') }) },
    cell: () => null, scrollMinute: record('scroll'), beginEdit: record('minute'), select: record('select'), openGroup: record('group'),
    cellCommand: (action: () => Promise<void>) => action(), saveEditor: async () => record('save')(),
    checklistUI: { hasSelectedTask: () => true, openComposer: record('task'), openSubtaskComposer: record('subtask') },
    notepad: { focusEnd: record('note') }, notepadInput: { selectionStart: 4, selectionEnd: 8 },
    canvas: { openCreate: record('canvas') }, report: (error: unknown) => { throw error; },
  };
  vm.runInNewContext(ts.transpileModule(functions.map((node) => node.getText(source)).join('\n'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const toggle = () => {
    let allowed = true;
    (context as typeof context & { prepareHeaderAdd(event: { preventDefault(): void }): void })
      .prepareHeaderAdd({ preventDefault() { allowed = false; } });
    if (allowed) menu.open = !menu.open;
  };
  return { context, calls, menu, toggle, actionButtons };
}

test('the browser + menu dispatches each view to its existing create controls', async () => {
  const h = fixture();
  for (const [view, expected] of [
    ['calendar', ['Write a minute', 'Group minutes']],
    ['priority', ['Add task', 'Add subtask']],
    ['notepad', ['Write a note', 'Add selection to Canvas']],
    ['canvas', ['Add card', 'Add family', 'Add space', 'New board']],
  ] as const) {
    h.context.view = view;
    for (let index = 0; index < expected.length; index++) {
      h.toggle();
      assert.equal(h.menu.open, true);
      assert.deepEqual(h.actionButtons.map((button) => button.textContent), expected);
      h.actionButtons[index].onclick();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(h.menu.open, false);
    }
  }
  assert.deepEqual(h.calls.filter(([name]) => name !== 'focus'), [
    ['scroll', 615], ['minute', '2026-10-31', 615, undefined, true], ['save'], ['group'],
    ['task'], ['subtask'], ['note'], ['notepad-to-canvas'],
    ['canvas', 'card'], ['canvas', 'family'], ['canvas', 'space'], ['canvas', 'board'],
  ]);
});

test('the add menu disables unavailable contextual actions and refuses stale account or view commands', async () => {
  const h = fixture('priority');
  h.context.checklistUI.hasSelectedTask = () => false;
  h.toggle();
  assert.equal(h.actionButtons[1].disabled, true);
  h.context.priorityScope = {};
  h.actionButtons[0].onclick();
  await Promise.resolve();
  assert.equal(h.calls.some(([name]) => name === 'task'), false);
  h.context.view = 'notepad';
  h.context.notepadInput.selectionEnd = h.context.notepadInput.selectionStart;
  h.toggle();
  assert.equal(h.actionButtons[1].disabled, true);
  h.toggle();
  assert.equal(h.menu.open, false);
});
