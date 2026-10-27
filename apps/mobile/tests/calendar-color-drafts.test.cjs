const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const moduleValue = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/calendar-color-drafts.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleValue, exports: moduleValue.exports });
const { calendarColorDraftObserver } = moduleValue.exports;
const entry = { dateKey: '2026-10-26', minuteIndex: 77, text: 'Keep exact raw note', categoryId: 'before' };
const draft = () => ({ ...entry, key: '2026-10-26:77', keepColor: true, revision: 3, savedRevision: 3, saving: false, error: false });
function fixture() {
  let value = draft(); let active = true; let changes = 0; const rebases = [];
  const observer = calendarColorDraftObserver({ get: () => value && { ...value }, rebaseCommitted: (values) => rebases.push(...values) },
    () => active, () => changes++);
  return { observer, rebases, edit: (patch) => { value = { ...value, ...patch }; }, remove: () => { value = null; },
    pause: () => { active = false; }, get changes() { return changes; } };
}
test('calendar color import rebases only an unchanged acknowledged focused draft', () => {
  const f = fixture(); assert.equal(f.observer.canImport([entry]), true);
  f.observer.onImported([{ ...entry, categoryId: 'after' }]);
  assert.equal(f.rebases.length, 1); assert.equal(f.rebases[0].text, entry.text);
  assert.equal(f.rebases[0].categoryId, 'after'); assert.equal(f.rebases[0].keepColor, true); assert.equal(f.changes, 1);
});
test('dirty, saving, failed, stale-text and stale-color drafts veto transaction guards without touching raw text', () => {
  for (const patch of [{ revision: 4 }, { saving: true }, { error: true }, { text: 'New raw text' }, { categoryId: 'explicit-user-color' }]) {
    const f = fixture(); assert.equal(f.observer.canImport([entry]), true); f.edit(patch);
    assert.equal(f.observer.canImport([entry]), false); assert.equal(f.observer.consumeSkipped(), true);
    assert.equal(f.rebases.length, 0);
  }
});
test('typing or explicit recoloring after commit never gets erased by the import acknowledgement', () => {
  for (const patch of [{ text: 'Uncommitted text', revision: 4 }, { revision: 4, savedRevision: 4 },
    { categoryId: 'explicit-user-color' }, { keepColor: false }, { saving: true }, { error: true }]) {
    const f = fixture(); assert.equal(f.observer.canImport([entry]), true); f.edit(patch);
    f.observer.onImported([{ ...entry, categoryId: 'after' }]);
    assert.equal(f.rebases.length, 0); assert.equal(f.observer.consumeSkipped(), true);
  }
});
test('background or unmounted work is rejected and cannot refresh or rebase editor caches', () => {
  const f = fixture(); assert.equal(f.observer.canImport([entry]), true); f.pause();
  assert.equal(f.observer.canImport([entry]), false); f.observer.onImported([{ ...entry, categoryId: 'after' }]);
  assert.equal(f.rebases.length, 0); assert.equal(f.changes, 0); assert.equal(f.observer.consumeSkipped(), true);
});
test('an absent focused draft does not manufacture one after a color import', () => {
  const f = fixture(); f.remove(); assert.equal(f.observer.canImport([entry]), true);
  f.observer.onImported([{ ...entry, categoryId: 'after' }]); assert.equal(f.rebases.length, 0); assert.equal(f.changes, 1);
});

test('a guarded full calendar import rebases changed text and clears a vacated source draft', () => {
  const f = fixture(); assert.equal(f.observer.canImport([entry]), true);
  f.observer.onImported([{ ...entry, text: 'New calendar note', categoryId: 'after', blockId: 'same-event' }], true);
  assert.equal(f.rebases[0].text, 'New calendar note'); assert.equal(f.rebases[0].keepColor, false);
  const removed = fixture(); assert.equal(removed.observer.canImport([entry]), true);
  removed.observer.onImported([{ ...entry, text: '', categoryId: 'unaccounted', blockId: '' }], true);
  assert.equal(removed.rebases[0].text, ''); assert.equal(removed.rebases[0].keepColor, false);
});

test('full imports preserve blank event members but never replace text typed after the reviewed snapshot', () => {
  const f = fixture(); assert.equal(f.observer.canImport([entry]), true);
  f.observer.onImported([{ ...entry, text: '', blockId: 'same-event' }], true);
  assert.equal(f.rebases[0].keepColor, true);
  const changed = fixture(); assert.equal(changed.observer.canImport([entry]), true);
  changed.edit({ text: 'Typing now', revision: 4 });
  changed.observer.onImported([{ ...entry, text: 'Calendar note', blockId: 'same-event' }], true);
  assert.equal(changed.rebases.length, 0);
});
