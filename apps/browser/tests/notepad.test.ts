import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserNotepad } from '../src/notepad';
import { emptyLedger, mergeLedger, validateState, type BrowserLedgerState } from '../src/ledger';

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
