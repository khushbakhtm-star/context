import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserStore } from '../src/store';
import { editCells, getMinute } from '../src/ledger';

// Small asynchronous IndexedDB contract fixture; browser preview additionally exercises the real implementation.
function memoryIndexedDB() {
  const records = new Map<string, any>();
  const database = {
    createObjectStore() {}, close() {},
    transaction(_table: string, mode: string) {
      let aborted = false; let finished = false; let pending = 0; const writes = new Map<string, any>();
      const tx: any = { error: null, oncomplete: null, onabort: null, onerror: null,
        abort() { aborted = true; setTimeout(() => tx.onabort?.(), 0); },
        objectStore() { return {
          get(key: string) { const value: any = {}; pending++; setTimeout(() => { value.result = structuredClone(records.get(key)); value.onsuccess?.(); pending--; end(); }, 0); return value; },
          put(value: any) { assert.equal(mode, 'readwrite'); writes.set(value.id, structuredClone(value)); end(); },
        }; },
      };
      function end() { setTimeout(() => { if (pending || aborted || finished) return; finished = true; for (const [key, value] of writes) records.set(key, value); tx.oncomplete?.(); }, 0); }
      end(); return tx;
    },
  };
  return { records, api: { open() { const value: any = {}; setTimeout(() => { value.result = database; value.onupgradeneeded?.(); value.onsuccess?.(); }, 0); return value; } } };
}
test('persistent browser cache is encrypted, subject-scoped, authenticated, and never stores a token or passphrase', async () => {
  const original = globalThis.indexedDB; const fixture = memoryIndexedDB(); Object.assign(globalThis, { indexedDB: fixture.api });
  const phrase = 'synthetic persistent browser passphrase';
  try {
    const first = await BrowserStore.unlock('fixture_subject_A', phrase);
    await first.update((state) => editCells(state, [{ day: '2026-10-27', minute: 800, text: 'Synthetic private note must not be plaintext' }]).state);
    const record = fixture.records.get('fixture_subject_A'); assert.deepEqual(Object.keys(record).sort(), ['ciphertext', 'generation', 'id', 'iv', 'salt']);
    const serialized = JSON.stringify(record); assert.ok(!serialized.includes(phrase)); assert.ok(!serialized.includes('Synthetic private note')); assert.ok(record.ciphertext.byteLength > 32);
    const restored = await BrowserStore.unlock('fixture_subject_A', phrase); assert.equal(getMinute(restored.state, '2026-10-27', 800)!.value!.text, 'Synthetic private note must not be plaintext');
    await assert.rejects(BrowserStore.unlock('fixture_subject_A', 'incorrect synthetic passphrase'), /Cannot unlock/);
    const other = await BrowserStore.unlock('fixture_subject_B', phrase); assert.deepEqual(other.state.documents, []); assert.equal(other.hasSavedLedger(), false);
    first.lock(); restored.lock(); other.lock(); assert.equal(first.state, undefined);
  } finally { Object.assign(globalThis, { indexedDB: original }); }
});
test('optimistic generation guard rejects another tab without replacing its newer encrypted cache', async () => {
  const original = globalThis.indexedDB; const fixture = memoryIndexedDB(); Object.assign(globalThis, { indexedDB: fixture.api });
  const phrase = 'synthetic cache concurrency passphrase';
  try {
    const one = await BrowserStore.unlock('shared_fixture_subject', phrase); const two = await BrowserStore.unlock('shared_fixture_subject', phrase);
    await one.update((state) => editCells(state, [{ day: '2026-10-27', minute: 801, text: 'First tab saved' }]).state);
    await assert.rejects(two.update((state) => editCells(state, [{ day: '2026-10-27', minute: 801, text: 'Stale tab must not replace it' }]).state), /another browser tab/);
    const final = await BrowserStore.unlock('shared_fixture_subject', phrase); assert.equal(getMinute(final.state, '2026-10-27', 801)!.value!.text, 'First tab saved');
    one.lock(); two.lock(); final.lock();
  } finally { Object.assign(globalThis, { indexedDB: original }); }
});
