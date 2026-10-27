import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { emptyLedger, editCells, getMinute } from '../src/ledger';
import { flushBrowserText } from '../src/editor';

function fixture() {
  const source = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8'); const parsed = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions = ['beginEdit', 'saveEditor', 'mirrorDraft', 'setCellNote'];
  const nodes = parsed.statements.filter((node: any) => functions.includes(node.name?.text) ||
    ts.isExpressionStatement(node) && /element\('finish-format'\)\.onclick/.test(node.getText(parsed)));
  const input = { value: '', focusCount: 0, blurCount: 0, focus() { this.focusCount++; }, blur() { this.blurCount++; }, setAttribute() {}, setSelectionRange() {} };
  const node = { textContent: '', classList: { remove() {} }, setAttribute() {}, querySelector: () => null }; const buttons: Record<string, any> = {};
  let gate: Promise<void> | null = null; let writes = 0;
  const store = { state: emptyLedger('browser_fixture'), async update(change: any) { writes++; if (gate) { const wait = gate; gate = null; await wait; } this.state = change(this.state); return this.state; } };
  const module = { exports: {} as any }; const context: any = { module, exports: module.exports, store, editor: null, undo: null,
    entryBarMode: null, commandBusy: false, entryInput: input, selected: { day: '2026-10-27', minute: 800 },
    editCells, getMinute, flushBrowserText, minuteLabel: (minute: number) => String(minute), clock12: true, planForMinute: () => undefined,
    element: (id: string) => buttons[id] ??= {}, cell: () => node, updateBars() {}, render() {}, status() {}, report() {}, options: { showModal() {} },
    select: (point: any) => { context.selected = point; },
  };
  const code = ts.transpileModule(`${nodes.map((value) => value.getText(parsed)).join('\n')}\nexport { beginEdit, saveEditor, mirrorDraft };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, context);
  return { context, input, node, store, api: module.exports, buttons, get writes() { return writes; }, block(value: Promise<void>) { gate = value; } };
}
test('actual browser cell callback opens a bottom draft without focus or writes; first check saves and second closes formatting', async () => {
  const h = fixture(); h.api.beginEdit('2026-10-27', 800);
  assert.equal(h.context.entryBarMode, 'entry'); assert.equal(h.input.focusCount, 0); assert.equal(h.writes, 0);
  h.input.value = 'Raw text\n  keep spaces  '; h.api.mirrorDraft(); assert.equal(h.node.textContent, h.input.value); assert.equal(h.writes, 0);
  await h.api.saveEditor(true); assert.equal(h.context.entryBarMode, 'format'); assert.equal(h.context.editor, null);
  assert.equal(getMinute(h.store.state, '2026-10-27', 800)!.value!.text, h.input.value);
  h.buttons['finish-format'].onclick(); assert.equal(h.context.entryBarMode, null);
  assert.equal(h.context.selected.minute, 800, 'the cell remains selected after both checks');
});
test('first check on an untouched blank cell opens formatting without creating recorded time', async () => {
  const h = fixture(); h.api.beginEdit('2026-10-27', 800); await h.api.saveEditor(true);
  assert.equal(h.context.entryBarMode, 'format'); assert.equal(h.writes, 0); assert.deepEqual(h.store.state.documents, []);
});

test('a planned event title never becomes the draft or a saved minute note', async () => {
  const h = fixture(); h.context.planForMinute = () => ({ title: 'Calendar activity' });
  h.api.beginEdit('2026-10-27', 800); assert.equal(h.input.value, '');
  await h.api.saveEditor(true); assert.equal(h.writes, 0); assert.equal(getMinute(h.store.state, '2026-10-27', 800), undefined);
});

test('raw typing updates only the note span and preserves the independently rendered activity title', () => {
  const h = fixture(); const note = { textContent: '' };
  h.node.textContent = '▣ Calendar activity'; h.node.querySelector = (() => note) as never;
  h.api.beginEdit('2026-10-27', 800); h.input.value = 'A separate minute thought'; h.api.mirrorDraft();
  assert.equal(note.textContent, 'A separate minute thought'); assert.equal(h.node.textContent, '▣ Calendar activity');
  assert.equal(h.writes, 0);
});
test('actual bottom check waits for typing appended during a pending write and preserves all text before format mode', async () => {
  const h = fixture(); let release!: () => void; h.block(new Promise<void>((resolve) => { release = resolve; }));
  h.api.beginEdit('2026-10-27', 800); h.input.value = 'First'; const check = h.api.saveEditor(true);
  await Promise.resolve(); assert.equal(h.context.entryBarMode, 'entry'); h.input.value = 'First and latest tail'; release(); await check;
  assert.equal(h.writes, 2); assert.equal(h.context.entryBarMode, 'format'); assert.equal(getMinute(h.store.state, '2026-10-27', 800)!.value!.text, 'First and latest tail');
});

test('the bottom event-border control opens the existing Group flow once and respects format, busy and locked-state guards', () => {
  const source = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const nodes = parsed.statements.filter((node: any) => node.name?.text === 'updateBars' ||
    ts.isExpressionStatement(node) && /element\('format-border'\)\.onclick/.test(node.getText(parsed)));
  const buttons: Record<string, any> = {}; let opens = 0; let reports = 0;
  const context: any = { store: {}, entryBarMode: null, commandBusy: true,
    document: { body: { classList: { toggle() {} } } }, composerViewport: { refresh() {} },
    element: (id: string) => buttons[id] ??= {}, openGroup() { opens++; }, report() { reports++; } };
  const code = ts.transpileModule(nodes.map((node) => node.getText(parsed)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, context);
  context.updateBars(); assert.equal(buttons['format-border'].disabled, true);
  context.commandBusy = false; context.updateBars(); assert.equal(buttons['format-border'].disabled, false);
  buttons['format-border'].onclick(); assert.equal(opens, 0, 'an entry or closed bar cannot invoke Group');
  context.entryBarMode = 'format'; buttons['format-border'].onclick(); assert.equal(opens, 1);
  context.commandBusy = true; buttons['format-border'].onclick(); assert.equal(opens, 1);
  context.commandBusy = false; context.store = null; buttons['format-border'].onclick(); assert.equal(opens, 1);
  context.store = {}; context.openGroup = () => { throw new Error('Selection changed'); };
  buttons['format-border'].onclick(); assert.equal(reports, 1, 'a stale selection reports an error without a write');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="format-border" aria-label="Apply event border"/);
  assert.ok(html.indexOf('id="format-fill"') < html.indexOf('id="format-border"'));
  assert.ok(html.indexOf('id="format-border"') < html.indexOf('id="finish-format"'));
});
