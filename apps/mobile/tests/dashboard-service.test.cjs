const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function runtime() {
  const state = { calls: [], rows: [], categories: [], gate: null };
  const filename = path.join(__dirname, '../src/services/dashboard.ts');
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Promise, Error,
    require(name) {
      if (name === '../data/database') return { async getCategoryTimeTotals(start, end) {
        state.calls.push([start, end]); if (state.gate) await state.gate; return state.rows;
      } };
      if (name === './categories') return { async listCategories() { return state.categories; } };
      if (name === '../utils/dashboard') return require('../src/utils/dashboard.ts');
      throw new Error(`Dashboard must not import a calendar or provider: ${name}`);
    },
  }, { filename });
  return { state, api: module.exports };
}

test('Dashboard uses one local grouped query and filters exact selected dates without calendar or provider reads', async () => {
  const { state, api } = runtime();
  state.rows = [{ dateKey: '2026-10-23', categoryId: 'work', minutes: 2 },
    { dateKey: '2026-10-24', categoryId: 'work', minutes: 100 },
    { dateKey: '2026-10-26', categoryId: 'work', minutes: 3 }];
  state.categories = [{ id: 'work', name: 'Work', color: '#AB8B00', archived: true }];
  const summary = await api.getDashboardSummary(['2026-10-26', '2026-10-23']);
  assert.deepEqual(state.calls, [['2026-10-23', '2026-10-26']]);
  assert.equal(summary.recordedMinutes, 5); assert.equal(summary.unrecordedMinutes, 2875);
  assert.equal(summary.categories[0].name, 'Work');
});

test('aborted Dashboard work cannot return a late summary and pre-aborted work does not query', async () => {
  const first = runtime(); const aborted = new AbortController(); aborted.abort();
  await assert.rejects(first.api.getDashboardSummary(['2026-10-25'], { signal: aborted.signal }), { name: 'AbortError' });
  assert.equal(first.state.calls.length, 0);
  const second = runtime(); let release;
  second.state.gate = new Promise((resolve) => { release = resolve; });
  const controller = new AbortController();
  const loading = second.api.getDashboardSummary(['2026-10-25'], { signal: controller.signal });
  controller.abort(); release();
  await assert.rejects(loading, { name: 'AbortError' });
});
