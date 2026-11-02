import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKLIST_FLOW_KEY, emptyChecklistFlow, applyChecklistChange } from '../shared/utils/checklist-flow';
import { browserChecklist, changeBrowserChecklist, restoreBrowserChecklist, minuteTaskSnapshot,
  newBrowserTask, browserChecklistVersions } from '../src/checklist-flow';
import { editCells, emptyLedger, getMinute, mergeLedger, undoEdit } from '../src/ledger';
import { encryptBatch, decryptBatch } from '../shared/sync/codec';

test('a source passage and a rectangle become independent exact text snapshots with compact minute references', () => {
  const source = [{ day: '2026-11-02', minute: 519, text: 'Read notes and call Mum about the appointment.' }];
  const passage = minuteTaskSnapshot(source, { start: 15, end: 44 });
  assert.equal(passage.text, source[0]!.text.slice(15, 44));
  assert.deepEqual(passage.source, { ranges: [{ dateKey: '2026-11-02', startMinute: 519, endMinute: 519 }], selection: { start: 15, end: 44 } });
  const rectangle = minuteTaskSnapshot([...source, { day: '2026-11-02', minute: 520, text: 'Buy toothpaste' }, { day: '2026-11-03', minute: 519, text: '' }]);
  assert.equal(rectangle.text, `${source[0]!.text}\nBuy toothpaste`);
  assert.deepEqual(rectangle.source.ranges, [{ dateKey: '2026-11-02', startMinute: 519, endMinute: 520 }, { dateKey: '2026-11-03', startMinute: 519, endMinute: 519 }]);
  assert.equal(source[0]!.text, 'Read notes and call Mum about the appointment.');
  assert.throws(() => minuteTaskSnapshot(source, { start: 5, end: 1000 }), /Highlight/);
  assert.throws(() => minuteTaskSnapshot([{ ...source[0]!, text: '  ' }]), /some text/);
});

test('creating and editing a checklist uses only its document, preserving notes, borders and category metadata byte for byte', () => {
  const initial = editCells(emptyLedger('browser_checklist_fixture'), [{ day: '2026-11-02', minute: 519, text: 'Original minute text' }], 1000).state;
  const task = newBrowserTask('Call Mum');
  const added = changeBrowserChecklist(initial, undefined, { type: 'add', item: task }, 2000);
  assert.deepEqual(added.state.documents.filter((doc) => doc.key !== CHECKLIST_FLOW_KEY), initial.documents);
  assert.deepEqual(added.undo.after.map((doc) => doc.key), [CHECKLIST_FLOW_KEY]);
  const revision = browserChecklist(added.state).revision;
  const edited = changeBrowserChecklist(added.state, revision, { type: 'edit', id: task.id, text: 'Call Mum tomorrow', format: { bold: true, textColor: '#123456' } }, 3000);
  assert.equal(browserChecklist(edited.state).flow.items[0]!.text, 'Call Mum tomorrow');
  assert.deepEqual(browserChecklist(edited.state).flow.items[0]!.format, { bold: true, textColor: '#123456' });
  assert.equal(getMinute(edited.state, '2026-11-02', 519)!.value!.text, 'Original minute text');
  assert.deepEqual(browserChecklist(undoEdit(edited.state, edited.undo, 4000)).flow, browserChecklist(added.state).flow);
});

test('stale browser task edits and restoration cannot overwrite the newest synchronized list', () => {
  const original = changeBrowserChecklist(emptyLedger('browser_checklist_fixture'), undefined, { type: 'add', item: newBrowserTask('First') }, 1000).state;
  const stale = browserChecklist(original);
  const latest = changeBrowserChecklist(original, stale.revision, { type: 'add', item: newBrowserTask('New task from another device') }, 2000).state;
  const before = structuredClone(latest);
  assert.throws(() => changeBrowserChecklist(latest, stale.revision, { type: 'reset' }), /changed on another device/);
  assert.throws(() => restoreBrowserChecklist(latest, stale.revision, emptyChecklistFlow()), /changed/);
  assert.deepEqual(latest, before);
});

test('checklist rows, nested checks, formatting and source coordinates survive existing encrypted transport and LWW preserves the losing list', async () => {
  const first = newBrowserTask('Preparation', { ranges: [{ dateKey: '2026-11-02', startMinute: 519, endMinute: 522 }] });
  const subtask = { ...newBrowserTask('Call dentist'), parentId: first.id, format: { italic: true, underline: true } };
  let browser = changeBrowserChecklist(emptyLedger('browser_checklist_fixture'), undefined, { type: 'add', item: first }, 1000).state;
  browser = changeBrowserChecklist(browser, browserChecklist(browser).revision, { type: 'add', item: subtask }, 1001).state;
  browser = changeBrowserChecklist(browser, browserChecklist(browser).revision, { type: 'check', id: first.id, checked: true }, 1002).state;
  const transport = await encryptBatch({ version: 1, id: 'checklist_transport', documents: browser.documents }, 'synthetic-checklist-passphrase');
  const decoded = await decryptBatch(transport, 'synthetic-checklist-passphrase');
  const phoneLike = mergeLedger(emptyLedger('phone_checklist_fixture'), decoded.documents);
  assert.deepEqual(browserChecklist(phoneLike).flow, browserChecklist(browser).flow);
  assert.ok(browserChecklist(phoneLike).flow.items.every((task) => task.checked));
  const remoteFlow = applyChecklistChange(browserChecklist(browser).flow, { type: 'reset' });
  const remote = { key: CHECKLIST_FLOW_KEY, revision: '0000000000004000:00000000:phone_checklist_fixture', value: remoteFlow as unknown as Record<string, unknown> };
  const merged = mergeLedger(phoneLike, [remote]);
  assert.ok(browserChecklist(merged).flow.items.every((task) => !task.checked));
  assert.equal(browserChecklistVersions(merged).length, 1);
  assert.ok(browserChecklistVersions(merged)[0]!.flow.items.every((task) => task.checked));
});
