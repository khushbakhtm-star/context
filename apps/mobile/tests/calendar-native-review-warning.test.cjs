const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise Today itself with the existing native-view/transport harness.
const fixture = fs.readFileSync(path.join(__dirname, 'today-cell-actions.test.cjs'), 'utf8');
const prefix = fixture.slice(0, fixture.indexOf('\ntest('));
const moduleFixture = { exports: {} };
vm.runInNewContext(prefix + '\nmodule.exports = { screen };', {
  module: moduleFixture, exports: moduleFixture.exports, __dirname, require, console, Error,
});
const { screen } = moduleFixture.exports;

test('Today forwards the actual native review cause to Sync details while preserving notes, then clears it after a successful retry', async (t) => {
  const warnings = []; let fail = true;
  const cause = 'This linked event was edited in your calendar and in Context. Review both versions before synchronizing.';
  const h = screen(t, { props: { onSyncWarningChange: (message) => warnings.push(message) },
    reconcileColors: async () => { if (fail) throw Error(cause); return []; } });
  h.rows.set(`${h.day}:600`, { dateKey: h.day, minuteIndex: 600, text: 'Saved local words', categoryId: 'study', blockId: 'local' });
  await h.start();
  assert.match(warnings.at(-1), /Calendar colors could not refresh/);
  assert.ok(warnings.at(-1).includes(cause)); assert.equal(h.text(600), 'Saved local words');
  fail = false; await h.refresh(); await h.settle();
  assert.equal(warnings.at(-1), null); assert.equal(h.text(600), 'Saved local words');
});

test('a delayed native review error from a previous date cannot replace the active date warning', async (t) => {
  const warnings = []; let reject;
  const pending = new Promise((_resolve, failure) => { reject = failure; });
  const h = screen(t, { props: { onSyncWarningChange: (message) => warnings.push(message) },
    reconcileColors: (day) => day === '2026-10-25' ? pending : Promise.resolve([]) });
  await h.start(); await h.navigate('2026-10-26');
  reject(Error('Previous date needs review')); await h.settle();
  assert.equal(warnings.at(-1), null);
  assert.equal(warnings.some((message) => message?.includes('Previous date needs review')), false);
});


test('a verified palette notification refreshes the selected cell without letting an older request erase newer choices', async (t) => {
  const listeners = new Set(), scopes = []; let phase = 0, finishOld;
  const latest = [{ id: 'verified', name: 'Basil', color: '#0B8043' }];
  const h = screen(t, { subscribePalette: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
    readColors: (options) => { scopes.push(options?.scope); return phase === 1 ? new Promise((resolve) => { finishOld = resolve; }) : Promise.resolve(phase === 2 ? latest : []); } });
  await h.start(); await h.tap(600); h.action('Save minute text and show formatting').onPress(); await h.settle();
  h.action('Choose cell color').onPress(); await h.settle(); assert.equal(h.palette().colorChoices.length, 0);
  phase = 1; for (const callback of listeners) callback(); await h.settle();
  phase = 2; for (const callback of listeners) callback(); await h.settle();
  assert.equal(h.palette().colorChoices[0].id, 'verified');
  finishOld([]); await h.settle(); assert.equal(h.palette().colorChoices[0].id, 'verified');
  assert.ok(scopes.some((scope) => scope?.dateKey === h.day && scope.minuteIndex === 600));
  h.unmount(); assert.equal(listeners.size, 0);
});
