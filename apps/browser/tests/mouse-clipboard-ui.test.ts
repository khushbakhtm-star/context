import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { cellEventLabel, cellFormatKey, formatFromDocument } from '../shared/utils/cell-format';
import { serializeSpreadsheetCells } from '../shared/utils/spreadsheet-paste';
import { emptyLedger, editCells, getMinute, minuteKey, pastedChanges, undoEdit } from '../src/ledger';
import { cellTransferFingerprint, clipboardTransferFingerprint, eventSelectionFingerprint, formatCells,
  groupSelection, resetCellsSelection, transferClipboardCells, ungroupSelection } from '../src/formatting';

function fixture() {
  const source = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ['showCellMenu', 'cellCommand', 'closeCellMenu', 'writeSelectedText', 'mutateSelection', 'paste', 'pasteInternalCells'];
  const nodes = parsed.statements.filter((node: any) => names.includes(node.name?.text));
  class Node {
    textContent = ''; hidden = true; style = {}; className = ''; title = ''; children: Node[] = []; attrs = new Map<string, string>();
    offsetWidth = 500; offsetHeight = 50; onclick: () => void = () => {};
    append(node: Node) { this.children.push(node); }
    replaceChildren(...nodes: Node[]) { this.children = nodes; }
    setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  }
  const elements = new Map<string, Node>(); const element = (id: string) => { if (!elements.has(id)) elements.set(id, new Node()); return elements.get(id)!; };
  const point = { day: '2026-10-30', minute: 100 }; let clipboardText = '', writes = 0, pending = Promise.resolve(); const errors: string[] = [];
  const initial = editCells(emptyLedger('browser_clipboard_fixture'), [{ ...point, text: 'Keep my exact words' }], 1000).state;
  const store = { state: formatCells(initial, [point], { bold: true, underline: true, textColor: '#112233', fill: { color: '#51B749' } }, ['#51B749'], 1100).state,
    async update(change: any) { writes++; this.state = change(this.state); return this.state; } };
  const context: any = { store, selected: { ...point }, rangeEnd: null, cellClipboard: null, entryBarMode: null, commandBusy: false, undo: null,
    document: { createElement: () => new Node() }, navigator: { clipboard: { async writeText(text: string) { clipboardText = text; }, async readText() { return clipboardText; } } },
    innerWidth: 1200, innerHeight: 800, element, getMinute, minuteKey, cellFormatKey, cellEventLabel, formatFromDocument,
    cellTransferFingerprint, clipboardTransferFingerprint, transferClipboardCells, eventSelectionFingerprint, serializeSpreadsheetCells,
    editCells, pastedChanges, groupSelection, ungroupSelection, resetCellsSelection,
    selectionCells() { const end = context.rangeEnd ?? context.selected; const result = [];
      for (let minute = Math.min(context.selected.minute, end.minute); minute <= Math.max(context.selected.minute, end.minute); minute++) result.push({ day: context.selected.day, minute }); return result; },
    selectionStamp: () => JSON.stringify([context.selected, context.rangeEnd]),
    saveEditor: async () => {}, updateBars() {}, render() {}, synchronize() {}, status() {}, planForMinute() {}, showCellFormatting() {},
    report: (error: Error) => errors.push(error.message), info() {}, openGroup() {} };
  vm.runInNewContext(ts.transpileModule(nodes.map((node) => node.getText(parsed)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const command = context.cellCommand; context.cellCommand = (work: () => Promise<void>) => pending = command(work);
  return { context, store, errors, element, get writes() { return writes; },
    setClipboard(text: string) { clipboardText = text; },
    select(minute: number, through?: number) { context.selected = { day: point.day, minute }; context.rangeEnd = through === undefined ? null : { day: point.day, minute: through }; },
    menu: () => context.showCellMenu(100, 100),
    async click(label: string) { const button = element('cell-menu').children.find((value) => value.textContent === label || value.attrs.get('aria-label') === label);
      assert.ok(button, `Expected menu action ${label}`); button.onclick(); await pending; } };
}

test('one Copy click followed by one Paste click copies the full cell text, fill and formatting', async () => {
  const h = fixture(); await h.menu(); await h.click('Copy'); assert.equal(h.writes, 0); assert.ok(h.context.cellClipboard);
  h.select(200); await h.menu(); await h.click('Paste'); assert.deepEqual(h.errors, []); assert.equal(h.writes, 1);
  assert.equal(getMinute(h.store.state, '2026-10-30', 200)!.value!.text, 'Keep my exact words');
  assert.equal(getMinute(h.store.state, '2026-10-30', 200)!.value!.categoryId, getMinute(h.store.state, '2026-10-30', 100)!.value!.categoryId);
  const format = formatFromDocument(h.store.state.documents.find((doc) => doc.key === cellFormatKey('2026-10-30', 200))?.value);
  assert.equal(format.bold, true); assert.equal(format.underline, true); assert.equal(format.textColor, '#112233');
  assert.equal(getMinute(undoEdit(h.store.state, h.context.undo, 2000), '2026-10-30', 200)!.value, null);
});
test('Cut waits for Paste, then moves once without a second click and Undo restores the original', async () => {
  const h = fixture(); await h.menu(); await h.click('Cut'); assert.equal(h.writes, 0); assert.equal(getMinute(h.store.state, '2026-10-30', 100)!.value!.text, 'Keep my exact words');
  h.select(201); await h.menu(); await h.click('Paste'); assert.deepEqual(h.errors, []); assert.equal(h.writes, 1); assert.equal(h.context.cellClipboard, null);
  assert.equal(getMinute(h.store.state, '2026-10-30', 100)!.value, null); assert.equal(getMinute(h.store.state, '2026-10-30', 201)!.value!.text, 'Keep my exact words');
  assert.equal(getMinute(undoEdit(h.store.state, h.context.undo, 2000), '2026-10-30', 100)!.value!.text, 'Keep my exact words');
});
test('a one-cell internal Copy fills every selected destination with its words and formatting in one write', async () => {
  const h = fixture(); await h.menu(); await h.click('Copy'); h.select(200, 202); await h.menu(); await h.click('Paste');
  assert.deepEqual(h.errors, []); assert.equal(h.writes, 1);
  for (let minute = 200; minute <= 202; minute++) {
    assert.equal(getMinute(h.store.state, '2026-10-30', minute)!.value!.text, 'Keep my exact words');
    assert.equal(formatFromDocument(h.store.state.documents.find((doc) => doc.key === cellFormatKey('2026-10-30', minute))?.value).bold, true);
  }
});
test('source changes refuse internal Paste, while unrelated external spreadsheet text stays a text-grid paste', async () => {
  const h = fixture(); await h.menu(); await h.click('Copy'); h.store.state = editCells(h.store.state, [{ day: '2026-10-30', minute: 100, text: 'Newest source words' }], 1500).state;
  h.select(200); await h.menu(); await h.click('Paste'); assert.match(h.errors[0]!, /source cells changed/); assert.equal(h.writes, 0);
  h.setClipboard('External one\nExternal two'); await h.menu(); await h.click('Paste'); assert.equal(h.writes, 1);
  assert.equal(getMinute(h.store.state, '2026-10-30', 200)!.value!.text, 'External one'); assert.equal(getMinute(h.store.state, '2026-10-30', 201)!.value!.text, 'External two');
  assert.equal(h.store.state.documents.find((doc) => doc.key === cellFormatKey('2026-10-30', 200)), undefined);
});
test('stale destructive menu actions refuse newer synchronized words rather than resetting them', async () => {
  const h = fixture(); await h.menu(); h.store.state = editCells(h.store.state, [{ day: '2026-10-30', minute: 100, text: 'Newest source words' }], 1500).state;
  await h.click('Reset cells'); assert.equal(h.writes, 0); assert.match(h.errors[0]!, /cells changed/);
  assert.equal(getMinute(h.store.state, '2026-10-30', 100)!.value!.text, 'Newest source words');
});
test('linked Cut/Paste is safely refused while linked Copy/Paste creates detached full cells', async () => {
  for (const action of ['Cut', 'Copy']) {
    const h = fixture(), original = getMinute(h.store.state, '2026-10-30', 100)!.value!;
    h.store.state.documents.push({ key: 'projection:linked_fixture', revision: '0000000000001200:00000000:phone_actor',
      value: { blockId: original.blockId, state: 'synced', eventId: 'synthetic_source_event' } });
    await h.menu(); await h.click(action); h.select(200); await h.menu(); await h.click('Paste');
    assert.equal(getMinute(h.store.state, '2026-10-30', 100)!.value!.text, 'Keep my exact words');
    if (action === 'Cut') { assert.match(h.errors[0]!, /linked calendar event on your phone/); assert.equal(getMinute(h.store.state, '2026-10-30', 200), undefined); }
    else { assert.deepEqual(h.errors, []); assert.notEqual(getMinute(h.store.state, '2026-10-30', 200)!.value!.blockId, original.blockId); }
  }
});
test('account connection and Lock clear in-memory whole-cell metadata before another session can reuse it', async () => {
  const h = fixture(); await h.menu(); await h.click('Copy'); assert.ok(h.context.cellClipboard);
  const source = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8'); const parsed = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const nodes = parsed.statements.filter((node: any) => node.name?.text === 'connect' || ts.isExpressionStatement(node) && /element\('lock'\)\.onclick/.test(node.getText(parsed)));
  h.context.connection = { async authorize() { throw new Error('Synthetic authorization canceled'); }, lock() {} };
  h.context.navigation = (action: () => void) => action(); h.context.passInput = { value: '' }; h.context.unlockRequest = 0;
  h.context.store.lock = () => {}; h.context.viewGeneration = 0; h.context.passphrase = ''; h.context.plans = []; h.context.liveFillColors = []; h.context.busy = false;
  vm.runInNewContext(ts.transpileModule(nodes.map((node) => node.getText(parsed)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, h.context);
  await h.context.connect(); assert.equal(h.context.cellClipboard, null);
  h.context.cellClipboard = { synthetic: true }; h.element('lock').onclick(); assert.equal(h.context.cellClipboard, null); assert.equal(h.context.store, null);
});
