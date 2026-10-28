const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const copy = (value) => JSON.parse(JSON.stringify(value));
function harness() {
  const accounts = [{ id: 'google:person', subject: 'person', provider: 'google', consent: { calendarWrite: true } }];
  const preferences = new Map([['google:person', { selectedCalendarIds: ['personal'], writeCalendarId: null }]]);
  let beforePreferences = null; const calls = [];
  const file = path.join(__dirname, '../src/services/calendar-write-routing.ts');
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports,
    require(name) {
      if (name === '../sync/accounts') return { getAccounts: async () => { calls.push('accounts'); return copy(accounts); } };
      if (name === '../sync/engine') return { getAccountPreferences: async (id) => {
        calls.push('preferences'); if (beforePreferences) await beforePreferences(); return copy(preferences.get(id));
      } };
      throw Error(`Routing must not load provider or calendar transport: ${name}`);
    },
  });
  return { api: module.exports, accounts, preferences, calls, set beforePreferences(value) { beforePreferences = value; } };
}

function nativeWorker(bindings) {
  const file = path.join(__dirname, '../App.tsx'); const text = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'createCoalescedDateWork') callback = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(callback, 'production native worker callback must be exercised');
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(`module.exports = (${callback});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, ...bindings });
  return module.exports;
}

test('granting account calendar writes alone does not suppress the configured phone-calendar writer', async () => {
  const h = harness(); assert.equal(await h.api.hasConfiguredAccountCalendarWriter(), false);
  assert.deepEqual(h.calls, ['accounts', 'preferences', 'accounts']);
  h.preferences.set('google:person', { selectedCalendarIds: [], writeCalendarId: 'personal' });
  assert.equal(await h.api.hasConfiguredAccountCalendarWriter(), true,
    'the actuals destination is distinct from calendars selected for reading');
  h.preferences.set('google:person', { selectedCalendarIds: [], writeCalendarId: '  ' });
  assert.equal(await h.api.hasConfiguredAccountCalendarWriter(), false);
});

test('routing ignores read-only/storage-only accounts and rechecks permission, connection and subject after local preference reads', async () => {
  const h = harness(); h.preferences.set('google:person', { selectedCalendarIds: [], writeCalendarId: 'personal' });
  for (const change of [() => { h.accounts[0].consent.calendarWrite = false; }, () => { h.accounts[0].subject = 'different'; },
    () => { h.accounts.length = 0; }]) {
    h.accounts.splice(0, h.accounts.length, { id: 'google:person', subject: 'person', provider: 'google', consent: { calendarWrite: true } });
    h.beforePreferences = change;
    assert.equal(await h.api.hasConfiguredAccountCalendarWriter(), false);
  }
  h.accounts.push({ id: 'webdav:folder', subject: 'folder', provider: 'webdav', consent: { calendarWrite: true } });
  assert.equal(await h.api.hasConfiguredAccountCalendarWriter(), false);
});

test('the production native worker awaits a safe account cycle then restricts an existing native destination when an account writer is configured', async () => {
  const h = harness(); const calls = []; let release;
  const held = new Promise((resolve) => { release = resolve; });
  const worker = nativeWorker({
    synchronizeAccounts: async () => { calls.push('accounts'); await held; return { running: false, cycleComplete: true, nativeWriteReady: true }; },
    hasConfiguredAccountCalendarWriter: h.api.hasConfiguredAccountCalendarWriter,
    calendarProjectionConfigRef: { current: { ready: true, syncActuals: true, writeCalendarId: 'native-personal', accountCalendarWrites: false } },
    controllerMountedRef: { current: true }, AppState: { currentState: 'active' },
    flushPendingActuals: async (...args) => { calls.push(args); return { failed: 0 }; },
  });
  const job = worker(['2026-10-27']); await Promise.resolve();
  assert.deepEqual(calls, ['accounts'], 'native export must not race an unfinished account source/storage cycle');
  release(); await job;
  assert.deepEqual(copy(calls), ['accounts', ['native-personal', ['2026-10-27'], 90, { existingBindingsOnly: false }]]);
  h.preferences.set('google:person', { selectedCalendarIds: ['personal'], writeCalendarId: 'personal' });
  calls.length = 0; await worker(['2026-10-27']);
  assert.deepEqual(copy(calls), ['accounts', ['native-personal', ['2026-10-27'], 90, { existingBindingsOnly: true }]]);
});

test('the native worker never falls back after failed or incomplete account downloads', async () => {
  for (const status of [{ nativeWriteReady: false }, { nativeWriteReady: true, running: true },
    { nativeWriteReady: true, cycleComplete: false }, {}]) {
    let writes = 0;
    const worker = nativeWorker({ synchronizeAccounts: async () => status,
      hasConfiguredAccountCalendarWriter: async () => true,
      calendarProjectionConfigRef: { current: { ready: true, syncActuals: true, writeCalendarId: 'native', accountCalendarWrites: true } },
      controllerMountedRef: { current: true }, AppState: { currentState: 'active' },
      flushPendingActuals: async () => { writes++; return { failed: 0 }; } });
    await assert.rejects(worker(['2026-10-27']), /remain queued/); assert.equal(writes, 0);
  }
});
