import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { emptyLedger, editCells, getMinute, undoEdit } from '../src/ledger';
import { cellTransferDestination, cellTransferFingerprint, transferCells } from '../src/formatting';

function fixture() {
  const source = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = parsed.statements.find((node: any) => node.name?.text === 'completeMove')!;
  const coords = [{ day: '2026-10-30', minute: 100 }, { day: '2026-10-30', minute: 101 }];
  let stamp = 'same-selection', writes = 0, beforeWrite: (() => void) | null = null; const errors: string[] = [];
  const store = { state: editCells(emptyLedger('browser_move_fixture'), coords.map((point, index) => ({ ...point, text: `Minute ${index + 1}` })), 1000).state,
    async update(change: any) { writes++; beforeWrite?.(); beforeWrite = null; this.state = change(this.state); return this.state; } };
  const context: any = { store, moveDraft: { store, coords, origin: coords[0], grabbed: coords[1], fingerprint: cellTransferFingerprint(store.state, coords, coords[0]!), stamp },
    selected: coords[0], rangeEnd: coords[1], undo: null, entryBarMode: null,
    clearMovePreview() { context.moveDraft = null; }, selectionStamp: () => stamp,
    cellCommand: async (work: () => Promise<void>) => { try { await work(); } catch (error) { errors.push((error as Error).message); } },
    cellTransferDestination, cellTransferFingerprint, transferCells, render() {}, synchronize() {}, info() {} };
  vm.runInNewContext(ts.transpileModule(declaration.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, store, coords, errors, get writes() { return writes; }, set beforeWrite(value: (() => void) | null) { beforeWrite = value; },
    changeSelection() { stamp = 'different-selection'; }, drop(copy = false) { return context.completeMove({ day: '2026-10-31', minute: 201 }, copy); } };
}

test('the actual border-drop callback retains grab offset, moves cells once and records Undo', async () => {
  const h = fixture(); await h.drop(); assert.deepEqual(h.errors, []); assert.equal(h.writes, 1); assert.equal(h.context.moveDraft, null);
  assert.equal(getMinute(h.store.state, '2026-10-31', 200)!.value!.text, 'Minute 1');
  assert.equal(getMinute(h.store.state, '2026-10-31', 201)!.value!.text, 'Minute 2');
  assert.equal(getMinute(h.store.state, '2026-10-30', 100)!.value, null);
  assert.equal(h.context.selected.minute, 200); assert.equal(h.context.rangeEnd.minute, 201);
  assert.equal(getMinute(undoEdit(h.store.state, h.context.undo, 2000), '2026-10-30', 100)!.value!.text, 'Minute 1');
});
test('Alt-drop copies full cells and retains the source rather than cutting it', async () => {
  const h = fixture(); await h.drop(true); assert.deepEqual(h.errors, []); assert.equal(h.writes, 1);
  assert.equal(getMinute(h.store.state, '2026-10-30', 100)!.value!.text, 'Minute 1');
  assert.equal(getMinute(h.store.state, '2026-10-31', 200)!.value!.text, 'Minute 1');
});
test('a source revision or selection change during the drag refuses the callback before any queued write', async () => {
  for (const reason of ['revision', 'selection']) { const h = fixture();
    if (reason === 'selection') h.changeSelection(); else h.store.state = editCells(h.store.state, [{ ...h.coords[0]!, text: 'Updated during drag' }], 1500).state;
    await h.drop(); assert.equal(h.writes, 0); assert.match(h.errors[0]!, /selected cells changed/); assert.equal(getMinute(h.store.state, '2026-10-31', 200), undefined); }
});
test('a destination revision arriving after drop but before the queued store write refuses the move atomically', async () => {
  const h = fixture(); h.beforeWrite = () => { h.store.state = editCells(h.store.state, [{ day: '2026-10-31', minute: 200, text: 'Newest destination note' }], 1500).state; };
  await h.drop(); assert.equal(h.writes, 1); assert.match(h.errors[0]!, /cells or their calendar links changed/);
  assert.equal(getMinute(h.store.state, '2026-10-30', 100)!.value!.text, 'Minute 1');
  assert.equal(getMinute(h.store.state, '2026-10-31', 200)!.value!.text, 'Newest destination note');
});
