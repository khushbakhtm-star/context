const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function fixture(run) {
  const timers = new Map(); let next = 0; let active = true;
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/coalesced-date-work.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, setTimeout: (callback) => { const id = ++next; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id) });
  const work = module.exports.createCoalescedDateWork(run, () => active);
  return { work, timers, pause: () => { active = false; }, tick: () => {
    const due = [...timers]; timers.clear(); for (const [, callback] of due) callback();
  } };
}
const settled = async () => { await Promise.resolve(); await Promise.resolve(); };
test('many commits share one delayed date pass and one coalesced follow-up rather than a promise per commit', async () => {
  let finish; const calls = [];
  const f = fixture(async (dates) => { calls.push([...dates]); if (calls.length === 1) await new Promise((resolve) => { finish = resolve; }); });
  for (let n = 0; n < 100; n++) f.work.request(['2026-10-26']);
  assert.equal(f.timers.size, 1); f.tick(); assert.equal(calls.length, 1);
  for (let n = 0; n < 100; n++) f.work.request(['2026-10-27', '2026-10-26']);
  assert.equal(f.timers.size, 0); finish(); await settled(); assert.equal(f.timers.size, 1);
  f.tick(); await settled(); assert.deepEqual(calls, [['2026-10-26'], ['2026-10-26', '2026-10-27']]);
  assert.equal(f.timers.size, 0);
});
test('a failure retains its dates without a hot retry loop and folds a later request into the retry', async () => {
  const calls = []; const f = fixture(async (dates) => { calls.push([...dates]); if (calls.length === 1) throw Error('Offline'); });
  f.work.request(['2026-10-26']); f.tick(); await settled(); assert.equal(f.timers.size, 0);
  f.work.request(['2026-10-27']); assert.equal(f.timers.size, 1); f.tick(); await settled();
  assert.deepEqual(calls[1], ['2026-10-26', '2026-10-27']); assert.equal(f.timers.size, 0);
});
test('background suspension retains pending dates and disposal prevents delayed or in-flight work from scheduling another pass', async () => {
  const calls = []; let finish;
  const f = fixture(async (dates) => { calls.push([...dates]); await new Promise((resolve) => { finish = resolve; }); });
  f.work.request(['2026-10-26']); f.work.suspend(); assert.equal(f.timers.size, 0); f.tick(); assert.equal(calls.length, 0);
  f.work.resume(); f.tick(); assert.equal(calls.length, 1); f.work.request(['2026-10-27']); f.work.dispose();
  finish(); await settled(); f.work.resume(); f.work.request(['2026-10-28']); assert.equal(f.timers.size, 0); assert.equal(calls.length, 1);
});
