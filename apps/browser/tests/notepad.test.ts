import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserNotepad } from '../src/notepad';
import { addLinkedCanvasNode, activeCanvasBoard, updateCanvasNode } from '../shared/utils/canvas';
import { browserCanvas, emptyLedger, mergeLedger, setBrowserCanvas, validateState, type BrowserLedgerState } from '../src/ledger';

function account(device: string) {
  return {
    state: emptyLedger(device),
    async update(change: (state: BrowserLedgerState) => BrowserLedgerState) {
      return this.state = validateState(change(structuredClone(this.state)));
    },
  };
}

function fixture() {
  const input = { value: '', disabled: true } as HTMLTextAreaElement;
  const message = { textContent: '' } as HTMLElement;
  const retry = { hidden: true } as HTMLButtonElement;
  return { input, message, retry, pad: new BrowserNotepad(input, message, retry) };
}

test('the browser notepad saves exact plain text in the local encrypted cache shape without creating sync documents', async () => {
  const { input, pad } = fixture();
  const original = account('notepad_device_a');
  const other = account('notepad_device_b');
  const text = '  One line\n<a>plain text</a>\n';
  pad.bind(original);
  input.value = text;
  input.oninput!(new Event('input'));
  assert.equal(pad.hasDraft(), true);
  await pad.flush();
  assert.equal(pad.hasDraft(), false);
  assert.equal(original.state.notepad, text);
  assert.deepEqual(original.state.documents, []);
  assert.deepEqual(original.state.pending, {});
  original.state = mergeLedger(original.state, []);
  pad.bind(other);
  assert.equal(input.value, '');
  pad.bind(null);
  assert.equal(input.disabled, true);
  pad.bind(original);
  assert.equal(input.value, text);
});

test('edits made during autosave are persisted and a failed save keeps its draft available for retry', async () => {
  const { input, message, retry, pad } = fixture();
  const active = account('notepad_retry_device');
  const update = active.update.bind(active);
  let fail = true;
  active.update = async (change) => {
    if (fail) throw new Error('Cache is unavailable.');
    if (input.value === 'first') input.value = 'newest';
    return update(change);
  };
  pad.bind(active);
  input.value = 'first';
  await assert.rejects(pad.flush(), /unavailable/);
  assert.equal(input.value, 'first');
  assert.equal(retry.hidden, false);
  assert.match(message.textContent!, /Not saved/);
  fail = false;
  await pad.flush();
  assert.equal(active.state.notepad, 'newest');
  assert.equal(retry.hidden, true);
});

test('Notepad and Canvas edit the same linked text and rebase across separate unsaved edits', async () => {
  const { input, pad } = fixture();
  const active = account('browser_canvas_device');
  active.state.notepad = 'First / linked words / Last';
  const { document, nodeId } = addLinkedCanvasNode(browserCanvas(active.state), { start: 8, end: 20 });
  await active.update((state) => setBrowserCanvas(state, document));
  const card = () => activeCanvasBoard(browserCanvas(active.state)).nodes.find((node) => node.id === nodeId)!;
  assert.equal(active.state.notepad, undefined);
  assert.equal(card().text, 'linked words');
  pad.bind(active);
  input.value = 'First draft / linked words / Last';
  input.oninput!(new Event('input'));
  input.value = 'First draft / linked words / Last draft';
  input.oninput!(new Event('input'));
  await pad.flush();
  assert.deepEqual(card().source, { start: 14, end: 26 });
  assert.equal(card().text, 'linked words');
  input.value = 'First draft / linked phrase / Last draft';
  input.oninput!(new Event('input'));
  await pad.flush();
  assert.equal(card().text, 'linked phrase');
  pad.bind(null);
  await active.update((state) => setBrowserCanvas(state, updateCanvasNode(browserCanvas(state), nodeId, { text: 'changed on Canvas' })));
  active.state = mergeLedger(active.state, []);
  pad.bind(active);
  assert.equal(input.value, 'First draft / changed on Canvas / Last draft');
  assert.deepEqual(active.state.documents, []);
  assert.deepEqual(active.state.pending, {});
  pad.bind(account('different_canvas_account'));
  assert.equal(input.value, '');
});
