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
test('actual browser cell callback opens a bottom draft without focus or writes; check saves and closes without a formatting strip', async () => {
  const h = fixture(); h.api.beginEdit('2026-10-27', 800);
  assert.equal(h.context.entryBarMode, 'entry'); assert.equal(h.input.focusCount, 0); assert.equal(h.writes, 0);
  h.input.value = 'Raw text\n  keep spaces  '; h.api.mirrorDraft(); assert.equal(h.node.textContent, h.input.value); assert.equal(h.writes, 0);
  await h.api.saveEditor(); assert.equal(h.context.entryBarMode, null); assert.equal(h.context.editor, null); assert.equal(h.input.blurCount, 1);
  assert.equal(getMinute(h.store.state, '2026-10-27', 800)!.value!.text, h.input.value);
  h.buttons['finish-format'].onclick(); assert.equal(h.context.entryBarMode, null);
  assert.equal(h.context.selected.minute, 800, 'the cell remains selected after both checks');
});
test('check on an untouched blank cell closes the editor without creating recorded time or formatting', async () => {
  const h = fixture(); h.api.beginEdit('2026-10-27', 800); await h.api.saveEditor();
  assert.equal(h.context.entryBarMode, null); assert.equal(h.writes, 0); assert.deepEqual(h.store.state.documents, []);
});

test('a planned event title never becomes the draft or a saved minute note', async () => {
  const h = fixture(); h.context.planForMinute = () => ({ title: 'Calendar activity' });
  h.api.beginEdit('2026-10-27', 800); assert.equal(h.input.value, '');
  await h.api.saveEditor(); assert.equal(h.writes, 0); assert.equal(getMinute(h.store.state, '2026-10-27', 800), undefined);
});

test('raw typing updates only the note span and preserves the independently rendered activity title', () => {
  const h = fixture(); const note = { textContent: '' };
  h.node.textContent = '▣ Calendar activity'; h.node.querySelector = (() => note) as never;
  h.api.beginEdit('2026-10-27', 800); h.input.value = 'A separate minute thought'; h.api.mirrorDraft();
  assert.equal(note.textContent, 'A separate minute thought'); assert.equal(h.node.textContent, '▣ Calendar activity');
  assert.equal(h.writes, 0);
});
test('actual bottom check waits for typing appended during a pending write and preserves all text before closing', async () => {
  const h = fixture(); let release!: () => void; h.block(new Promise<void>((resolve) => { release = resolve; }));
  h.api.beginEdit('2026-10-27', 800); h.input.value = 'First'; const check = h.api.saveEditor();
  await Promise.resolve(); assert.equal(h.context.entryBarMode, 'entry'); h.input.value = 'First and latest tail'; release(); await check;
  assert.equal(h.writes, 2); assert.equal(h.context.entryBarMode, null); assert.equal(getMinute(h.store.state, '2026-10-27', 800)!.value!.text, 'First and latest tail');
});

test('formatting opens only as a compact cell popup and its check closes it without changing selection', () => {
  const source = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const nodes = parsed.statements.filter((node: any) => node.name?.text === 'showCellFormatting' ||
    ts.isExpressionStatement(node) && /element\('finish-format'\)\.onclick/.test(node.getText(parsed)));
  const popup = { hidden: true, style: {} as any, offsetWidth: 250, offsetHeight: 50 }; const buttons: Record<string, any> = { 'cell-format-menu': popup };
  const selection = { day: '2026-10-30', minute: 100 };
  const context: any = { store: null, entryBarMode: null, commandBusy: false, selected: selection, innerWidth: 1000, innerHeight: 700,
    element: (id: string) => buttons[id] ??= {}, updateBars() { popup.hidden = context.entryBarMode !== 'format'; } };
  const code = ts.transpileModule(nodes.map((node) => node.getText(parsed)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, context);
  context.showCellFormatting(990, 690); assert.equal(popup.hidden, true, 'a locked ledger cannot open formatting');
  context.store = {}; context.showCellFormatting(990, 690); assert.equal(popup.hidden, false); assert.equal(popup.style.left, '744px'); assert.equal(popup.style.top, '644px');
  buttons['finish-format'].onclick(); assert.equal(popup.hidden, true); assert.equal(context.selected, selection);
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="cell-format-menu" role="menu"/); assert.doesNotMatch(html, /id="format-bar"|id="format-border"/);
  assert.match(source, /formatButton\.setAttribute\('aria-label', 'Format cells'\)/);
});
