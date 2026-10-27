import test from 'node:test';
import assert from 'node:assert/strict';
import { flushBrowserText } from '../src/editor';

test('typing during a gated local write saves the latest tail before allowing editor close', async () => {
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const draft = { input: { value: 'first text' }, original: '', revision: undefined as string | undefined }; const writes: [string, string | undefined][] = [];
  const flushing = flushBrowserText(draft, () => true, async (text, expected) => { writes.push([text, expected]); if (writes.length === 1) await gate; return `revision_${writes.length}`; });
  await Promise.resolve(); draft.input.value = 'first text and newest typing'; release();
  assert.equal(await flushing, true); assert.deepEqual(writes, [['first text', undefined], ['first text and newest typing', 'revision_1']]);
  assert.equal(draft.original, 'first text and newest typing'); assert.equal(draft.revision, 'revision_2');
});
test('a failed or superseded write leaves the unsaved tail and never approves closing another editor', async () => {
  const draft = { input: { value: 'keep my text' }, original: '', revision: 'old' }; let current = true;
  assert.equal(await flushBrowserText(draft, () => current, async () => { current = false; return 'new'; }), false);
  assert.equal(draft.original, ''); assert.equal(draft.input.value, 'keep my text');
  await assert.rejects(flushBrowserText(draft, () => true, async () => { throw new Error('Synthetic storage failure'); }), /storage failure/);
  assert.equal(draft.original, ''); assert.equal(draft.input.value, 'keep my text');
});
