import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ChecklistFlowUI } from '../src/checklist-flow-ui';
import { applyChecklistChange, emptyChecklistFlow, type ChecklistFlow, type ChecklistTask } from '../shared/utils/checklist-flow';

class Node {
  children: Node[] = []; attrs = new Map<string, string>(); dataset: Record<string, string> = {}; hidden = false; textContent = ''; value = ''; type = ''; checked = false; disabled = false;
  className = ''; parentElement: Node | null = null; scrollHeight = 40; scrollTop = 0; rows = 1; maxLength = 0; placeholder = ''; pointer = 0;
  rect = { top: 0, bottom: 44, height: 44, left: 0, right: 600, width: 600 };
  style: Record<string, any> = { setProperty() {} };
  classList = { add: (..._values: string[]) => {}, remove: (..._values: string[]) => {} };
  onclick?: () => void; onchange?: () => void; onfocus?: () => void; onblur?: () => void; oninput?: () => void; onkeydown?: (event: any) => void;
  onpointerdown?: (event: any) => void; onpointermove?: (event: any) => void; onpointerup?: (event: any) => void; onpointercancel?: () => void; onlostpointercapture?: (event: any) => void; onsubmit?: (event: any) => void;
  constructor(readonly tag = 'div') {}
  append(...nodes: Node[]) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes: Node[]) { this.children = []; this.append(...nodes); }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  getBoundingClientRect() { return this.rect; }
  setPointerCapture(pointer: number) { this.pointer = pointer; }
  contains(node: Node): boolean { return this === node || this.children.some((child) => child.contains(node)); }
  closest() { let node: Node | null = this; while (node && !node.dataset.taskId) node = node.parentElement; return node; }
  focus() { this.onfocus?.(); }
  blur() { this.onblur?.(); }
  requestSubmit() { this.onsubmit?.({ preventDefault() {} }); }
  querySelector(selector: string): Node | null { return walk(this).find((node) => selector.includes('textarea') && node.tag === 'textarea') ?? null; }
}
const walk = (node: Node): Node[] => [node, ...node.children.flatMap(walk)];
const item = (id: string, text: string, parentId: string | null = null): ChecklistTask => ({ id, text, parentId, checked: false, format: {} });
function fixture(t: TestContext, items = [item('parent_task', 'Prepare'), item('child_task', 'Call dentist', 'parent_task'), item('other_task', 'Shop')]) {
  const oldDocument = globalThis.document, oldRAF = globalThis.requestAnimationFrame;
  const host = new Node(); const container = new Node(); container.append(host); let target: Node | null = null;
  Object.assign(globalThis, { document: { createElement: (tag: string) => new Node(tag), createTextNode: (text: string) => Object.assign(new Node('#text'), { textContent: text }), elementFromPoint: () => target }, requestAnimationFrame: (callback: () => void) => { callback(); return 1; } });
  t.after(() => { Object.assign(globalThis, { document: oldDocument, requestAnimationFrame: oldRAF }); });
  let flow: ChecklistFlow = { ...emptyChecklistFlow(), items }; let revision: string | undefined = 'revision_1'; let scope = {}; let sequence = 1; const errors: string[] = []; const commands: any[] = []; const sourceCalls: any[] = [];
  let gate: { promise: Promise<void>; reached(): void } | null = null;
  let acknowledgementGate: { promise: Promise<void>; reached(): void } | null = null;
  const ui = new ChecklistFlowUI(host as unknown as HTMLElement, {
    snapshot: () => ({ scope, flow, revision, versions: [] }),
    async change(command, expected, expectedScope) { const waiting = gate; gate = null; if (waiting) { waiting.reached(); await waiting.promise; } if (scope !== expectedScope || expected !== revision) throw new Error('stale task list'); commands.push(command); flow = applyChecklistChange(flow, command); revision = `revision_${++sequence}`; const acknowledgedRevision = revision;
      const acknowledge = acknowledgementGate; acknowledgementGate = null; if (acknowledge) { acknowledge.reached(); await acknowledge.promise; } return acknowledgedRevision; },
    async restore(next, expected, expectedScope) { if (scope !== expectedScope || expected !== revision) throw new Error('stale task list'); flow = next; revision = `revision_${++sequence}`; },
    source: (source) => sourceCalls.push(source), back() {}, error: (error) => errors.push(error instanceof Error ? error.message : String(error)),
  });
  ui.refresh();
  const label = (text: string) => { const node = walk(host).find((candidate) => candidate.attrs.get('aria-label') === text); assert.ok(node, text); return node; };
  return { host, ui, commands, errors, sourceCalls, label, get flow() { return flow; }, get revision() { return revision; },
    changeRemote() { revision = `revision_${++sequence}`; flow = applyChecklistChange(flow, { type: 'edit', id: 'parent_task', text: 'New remote words' }); },
    changeAccount() { scope = {}; flow = emptyChecklistFlow(); revision = undefined; },
    gateNext() { let reached!: () => void, release!: () => void; const started = new Promise<void>((resolve) => { reached = resolve; }); gate = { promise: new Promise<void>((resolve) => { release = resolve; }), reached }; return { started, release }; },
    gateAcknowledgementNext() { let reached!: () => void, release!: () => void; const started = new Promise<void>((resolve) => { reached = resolve; }); acknowledgementGate = { promise: new Promise<void>((resolve) => { release = resolve; }), reached }; return { started, release }; },
    target(node: Node) { target = node; }, row(id: string) { const node = walk(host).find((candidate) => candidate.dataset.taskId === id); assert.ok(node); return node; },
    async click(text: string) { label(text).onclick?.(); await ui.flush(); } };
}

test('browser checks fade parent and subtasks, hide completed removes them, Reset restores all checks', async (t) => {
  const h = fixture(t); const checkbox = h.label('Complete: Prepare'); checkbox.checked = true; checkbox.onchange?.(); await h.ui.flush();
  assert.ok(h.flow.items.slice(0, 2).every((task) => task.checked)); assert.match(h.row('parent_task').className, /completed/);
  h.ui.setHideCompleted(true); await h.ui.flush();
  assert.equal(walk(h.host).filter((node) => node.dataset.taskId).length, 1);
  await h.ui.resetChecks(); await h.ui.flush(); assert.ok(h.flow.items.every((task) => !task.checked)); assert.equal(walk(h.host).filter((node) => node.dataset.taskId).length, 3); assert.deepEqual(h.errors, []);
});

test('task options apply typed formatting and accessible subtree reordering with one action', async (t) => {
  const h = fixture(t); await h.click('Bold'); assert.equal(h.flow.items[0]!.format.bold, true);
  await h.click('Move task down'); assert.deepEqual(h.flow.items.map((task) => task.id), ['other_task', 'parent_task', 'child_task']); assert.equal(h.flow.items[2]!.parentId, 'parent_task');
  assert.deepEqual(h.errors, []);
});

test('pointer drag moves a parent together with its nested task', async (t) => {
  const h = fixture(t); const handle = h.label('Drag Prepare to reorder'); const target = h.row('other_task'); target.rect = { top: 100, bottom: 144, height: 44, left: 0, right: 600, width: 600 }; h.target(target);
  handle.onpointerdown?.({ button: 0, pointerId: 1, preventDefault() {} }); handle.onpointermove?.({ pointerId: 1, clientX: 100, clientY: 140 }); handle.onpointerup?.({ pointerId: 1 }); await h.ui.flush();
  assert.deepEqual(h.flow.items.map((task) => task.id), ['other_task', 'parent_task', 'child_task']); assert.deepEqual(h.errors, []);
});

test('stale row actions do not replace newly downloaded task content or formatting', async (t) => {
  const h = fixture(t); h.changeRemote(); await h.click('Bold'); assert.match(h.errors[0]!, /changed/); assert.equal(h.flow.items[0]!.text, 'New remote words'); assert.equal(h.flow.items[0]!.format.bold, undefined); assert.equal(h.commands.length, 0);
});

test('a peer revision arriving while a row command yields for draft flush never becomes authority for the old command', async (t) => {
  const h = fixture(t); h.label('Bold').onclick?.(); await Promise.resolve(); h.changeRemote(); await h.ui.flush();
  assert.equal(h.flow.items[0]!.text, 'New remote words'); assert.equal(h.flow.items[0]!.format.bold, undefined);
  assert.equal(h.commands.length, 0); assert.match(h.errors[0]!, /changed/);
});

test('saving task text keeps text as plain text and opens source navigation without changing the source', async (t) => {
  const source = { ranges: [{ dateKey: '2026-11-02', startMinute: 519, endMinute: 520 }] };
  const h = fixture(t, [{ ...item('parent_task', 'Call Mum'), source }]); const input = h.label('Edit task: Call Mum'); input.onfocus?.(); input.value = '<script>still plain task words</script>'; input.onblur?.(); await h.ui.flush();
  assert.equal(h.flow.items[0]!.text, '<script>still plain task words</script>'); assert.deepEqual(h.flow.items[0]!.source, source);
  await h.click('Open source minute'); assert.deepEqual(h.sourceCalls, [source]); assert.equal(h.commands.length, 1); assert.deepEqual(h.errors, []);
});

test('canceling or losing capture during a drag leaves every task and subtask unchanged', async (t) => {
  const h = fixture(t); const before = structuredClone(h.flow); const handle = h.label('Drag Prepare to reorder'); const target = h.row('other_task'); h.target(target);
  handle.onpointerdown?.({ button: 0, pointerId: 1, preventDefault() {} }); handle.onpointermove?.({ pointerId: 1, clientX: 100, clientY: 40 }); handle.onpointercancel?.(); await h.ui.flush();
  assert.deepEqual(h.flow, before); assert.equal(h.commands.length, 0);
  handle.onpointerdown?.({ button: 0, pointerId: 2, preventDefault() {} }); handle.onlostpointercapture?.({ pointerId: 2 }); handle.onpointerup?.({ pointerId: 2 }); await h.ui.flush();
  assert.deepEqual(h.flow, before); assert.equal(h.commands.length, 0);
});

test('a failed draft save keeps the exact editable words visible rather than replacing them with a remote task', async (t) => {
  const h = fixture(t); const input = h.label('Edit task: Prepare'); input.onfocus?.(); input.value = 'My unsaved draft stays here'; h.changeRemote(); input.onblur?.();
  await assert.rejects(h.ui.flush(), /stale/); assert.equal(input.value, 'My unsaved draft stays here'); assert.equal(h.flow.items[0]!.text, 'New remote words'); assert.ok(h.ui.hasDraft());
});

test('a queued composer command cannot copy task text into a different newly unlocked account with the same absent revision', async (t) => {
  const h = fixture(t, []); h.changeAccount(); h.ui.clear(); h.ui.refresh(); await h.ui.openComposer();
  const composer = walk(h.host).find((node) => node.className === 'checklist-add')!; const input = composer.children[0]!; input.value = 'Private task from first account';
  composer.onsubmit?.({ preventDefault() {} }); h.changeAccount(); await assert.rejects(h.ui.flush(), /account changed/);
  assert.equal(h.flow.items.length, 0); assert.equal(h.commands.length, 0); assert.match(h.errors[0]!, /changed/);
});

test('a remote refresh preserves the new-task composer text, and flushing adds it without replacing incoming tasks', async (t) => {
  const h = fixture(t); await h.ui.openComposer(); const input = h.label('Add a task'); input.value = 'Unsaved new task'; input.oninput?.(); assert.ok(h.ui.hasDraft()); h.changeRemote(); h.ui.refresh();
  const retained = h.label('Add a task'); assert.equal(retained, input); assert.equal(retained.value, 'Unsaved new task');
  await h.ui.flush(); assert.equal(h.flow.items[0]!.text, 'New remote words'); assert.equal(h.flow.items.at(-1)!.text, 'Unsaved new task'); assert.equal(h.ui.hasDraft(), false); assert.deepEqual(h.errors, []);
});

test('typing while a composer write is pending updates the same new task instead of losing the tail or creating duplicates', async (t) => {
  const h = fixture(t); await h.ui.openComposer(); const input = h.label('Add a task'); input.value = 'First'; input.oninput?.(); const gate = h.gateNext(); const pending = h.ui.flush(); await gate.started;
  input.value = 'First and newest tail'; input.oninput?.(); gate.release(); await pending;
  assert.equal(h.flow.items.length, 4); assert.equal(h.flow.items.at(-1)!.text, 'First and newest tail'); assert.deepEqual(h.commands.map((command) => command.type), ['add', 'edit']); assert.equal(h.ui.hasDraft(), false);
});

test('typing during an existing task save preserves the latest tail before navigation can close it', async (t) => {
  const h = fixture(t); const input = h.label('Edit task: Prepare'); input.onfocus?.(); input.value = 'First edit'; const gate = h.gateNext(); const pending = h.ui.flush(); await gate.started;
  input.value = 'First edit with newest tail'; gate.release(); await pending;
  assert.equal(h.flow.items[0]!.text, 'First edit with newest tail'); assert.deepEqual(h.commands.map((command) => command.type), ['edit', 'edit']); assert.equal(h.ui.hasDraft(), false);
});

test('a peer revision arriving between pointerdown and the ready microtask never becomes authority for the old drag target', async (t) => {
  const h = fixture(t); const handle = h.label('Drag Prepare to reorder'); const target = h.row('other_task'); h.target(target);
  handle.onpointerdown?.({ button: 0, pointerId: 1, preventDefault() {} }); h.changeRemote(); handle.onpointermove?.({ pointerId: 1, clientX: 100, clientY: 40 }); handle.onpointerup?.({ pointerId: 1 }); await h.ui.flush();
  assert.equal(h.commands.length, 0); assert.equal(h.flow.items[0]!.text, 'New remote words'); assert.match(h.errors[0]!, /stale/);
});

test('a late successful acknowledgement from a locked account cannot clear the newly unlocked account composer', async (t) => {
  const h = fixture(t); await h.ui.openComposer(); const first = h.label('Add a task'); first.value = 'First account private task'; first.oninput?.();
  const gate = h.gateAcknowledgementNext(); const oldSave = h.ui.flush(); await gate.started;
  h.changeAccount(); h.ui.clear(); h.ui.refresh(); await h.ui.openComposer(); const second = h.label('Add a task'); second.value = 'Second account unsaved task'; second.oninput?.();
  gate.release(); await oldSave;
  assert.equal(h.flow.items.length, 0); assert.equal(h.label('Add a task').value, 'Second account unsaved task'); assert.ok(h.ui.hasDraft());
  await h.ui.flush(); assert.deepEqual(h.flow.items.map((task) => task.text), ['Second account unsaved task']); assert.deepEqual(h.errors, []);
});

test('empty Priority has only its floating add action until the user opens the composer', async (t) => {
  const h = fixture(t, []);
  assert.equal(walk(h.host).some((node) => node.tag === 'textarea'), false);
  assert.equal(walk(h.host).some((node) => /Add your first|Checklist task flow|Hide completed|Back to calendar/.test(node.textContent)), false);
  assert.equal(h.label('Add a task').className, 'priority-add');
  h.label('Add a task').onclick?.(); await h.ui.flush();
  const input = h.label('Add a task'); assert.equal(input.tag, 'textarea');
  input.value = 'New task from plus'; input.oninput?.(); await h.ui.flush();
  assert.deepEqual(h.flow.items.map((task) => task.text), ['New task from plus']);
  assert.equal(h.label('Add a task').className, 'priority-add');
});

test('an old queued row action cannot apply to another selected list with the same task identities', async (t) => {
  const h = fixture(t); const button = h.label('Bold'); h.changeAccount();
  button.onclick?.(); await h.ui.flush();
  assert.equal(h.commands.length, 0); assert.match(h.errors[0]!, /changed/);
});
