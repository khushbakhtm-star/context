import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { cellFormatKey, cellEventLabel, formatFromDocument } from '../shared/utils/cell-format';
import { emptyLedger, editCells, getMinute, minuteKey, undoEdit } from '../src/ledger';
import { contiguousMinuteSpan, eventSelectionFingerprint, groupSelection } from '../src/formatting';

function fixture() {
  const source = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const nodes = parsed.statements.filter((node: any) => ['readGroupRange', 'changeGroupRange', 'mutateSelection'].includes(node.name?.text) ||
    ts.isExpressionStatement(node) && /element<HTMLFormElement>\('group-form'\)\.onsubmit/.test(node.getText(parsed)));
  const fields: Record<string, any> = {}; let pending = Promise.resolve(); const errors: string[] = []; let writes = 0; let beforeWrite: (() => void) | null = null;
  const field = (id: string) => fields[id] ??= { value: '', textContent: '', closes: 0, close() { this.closes++; } };
  field('group-title').value = 'Overnight rest'; field('group-color').value = '0';
  field('group-from-date').value = '2026-10-30'; field('group-from-time').value = '23:58';
  field('group-through-date').value = '2026-10-31'; field('group-through-time').value = '00:01';
  const start = editCells(emptyLedger('browser_mouse_fixture'), [{ day: '2026-10-30', minute: 1438, text: 'Read a page' }, { day: '2026-10-31', minute: 1, text: 'Woke briefly' }], 1000).state;
  const store = { state: start, async update(change: any) { writes++; beforeWrite?.(); beforeWrite = null; this.state = change(this.state); return this.state; } };
  const rectangle = [{ day: '2026-10-30', minute: 0 }, { day: '2026-10-31', minute: 0 }];
  const context: any = { store, groupCoordinates: [], groupSelectionStamp: 'selected-rectangle', groupSelectionRevision: null, groupRangeConfirmed: false,
    groupFillOptions: [{ color: '#5A6986', name: 'Muted' }], entryBarMode: null, undo: null,
    element: field, contiguousMinuteSpan, eventSelectionFingerprint, groupSelection, minuteKey, getMinute, cellFormatKey,
    selectionStamp: () => 'selected-rectangle', selectionCells: () => rectangle, render() {}, synchronize() {}, updateBars() {},
    cellCommand(work: () => Promise<void>) { pending = work().catch((error: Error) => { errors.push(error.message); }); return pending; } };
  vm.runInNewContext(ts.transpileModule(nodes.map((node) => node.getText(parsed)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, store, fields, field, errors, get writes() { return writes; }, set beforeWrite(value: (() => void) | null) { beforeWrite = value; },
    change: () => context.changeGroupRange(), async submit() { field('group-form').onsubmit({ preventDefault() {} }); await pending; } };
}

test('the actual Group form sends explicit overnight endpoints, keeps raw minute text and supports guarded Undo', async () => {
  const h = fixture(); h.change(); await h.submit(); assert.deepEqual(h.errors, []); assert.equal(h.writes, 1);
  const span = contiguousMinuteSpan({ day: '2026-10-30', minute: 1438 }, { day: '2026-10-31', minute: 1 });
  for (const point of span) { const note = getMinute(h.store.state, point.day, point.minute)!.value!;
    const format = formatFromDocument(h.store.state.documents.find((doc) => doc.key === cellFormatKey(point.day, point.minute))?.value);
    assert.equal(cellEventLabel(format, String(note.blockId))?.title, 'Overnight rest'); }
  assert.equal(getMinute(h.store.state, '2026-10-30', 1438)!.value!.text, 'Read a page');
  assert.equal(getMinute(h.store.state, '2026-10-31', 1)!.value!.text, 'Woke briefly');
  assert.equal(getMinute(h.store.state, '2026-10-30', 0), undefined, 'the selected rectangle is not silently used as the event span');
  assert.equal(h.field('group-dialog').closes, 1); const undone = undoEdit(h.store.state, h.context.undo, 2000);
  assert.equal(getMinute(undone, '2026-10-30', 1438)!.value!.text, 'Read a page');
  assert.equal(getMinute(undone, '2026-10-30', 1439)?.value, null);
});
test('an unresolved cross-day rectangle or invalid inclusive range cannot group any cells', async () => {
  const h = fixture(); await h.submit(); assert.equal(h.writes, 0); assert.match(h.field('group-range-error').textContent, /Choose From and Through/);
  h.field('group-through-time').value = '23:58'; h.change(); await h.submit(); assert.equal(h.writes, 0); assert.match(h.field('group-range-error').textContent, /24 hours/);
});
test('a synchronized note change after choosing endpoints refuses the stale Group form without overwriting it', async () => {
  const h = fixture(); h.change(); h.store.state = editCells(h.store.state, [{ day: '2026-10-31', minute: 1, text: 'Latest other-device thought' }], 1500).state;
  await h.submit(); assert.equal(h.writes, 0); assert.match(h.errors[0]!, /activity changed/);
  assert.equal(getMinute(h.store.state, '2026-10-31', 1)!.value!.text, 'Latest other-device thought');
});
test('a queued Group write checks endpoint revisions again before committing', async () => {
  const h = fixture(); h.change(); h.beforeWrite = () => { h.store.state = editCells(h.store.state, [{ day: '2026-10-30', minute: 1439, text: 'Concurrent minute' }], 1500).state; };
  await h.submit(); assert.equal(h.writes, 1); assert.match(h.errors[0]!, /activity changed/); assert.equal(h.field('group-dialog').closes, 0);
  assert.equal(getMinute(h.store.state, '2026-10-30', 1439)!.value!.text, 'Concurrent minute');
});
