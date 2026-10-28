const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const filename = path.join(__dirname, '../App.tsx');
const text = fs.readFileSync(filename, 'utf8');
const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const controller = ast.statements.find((node) => node.name?.text === 'AppController');
const effect = controller.body.statements.find((node) => ts.isExpressionStatement(node) &&
  ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect' &&
  node.expression.arguments[0]?.getText(ast).includes('const poll = async () =>'));
assert.ok(effect, 'actual account polling effect is present');
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const success = () => ({ running: false, cycleComplete: true, nativeWriteReady: true });

/** Execute the production effect; only time, lifecycle and source transports are mocked. */
function polling(options = {}) {
  let now = 0, serial = 0; const timers = new Map(), subscribers = new Set(), lifecycle = new Set(), calls = [], statuses = [];
  const schedule = (callback, milliseconds) => { const id = ++serial; timers.set(id, { at: now + milliseconds, callback }); return id; };
  const publish = (status) => { for (const listener of [...subscribers]) listener(status); };
  const context = { module: { exports: {} }, console, ready: options.ready !== false,
    Date: class extends Date { static now() { return now; } },
    controllerMountedRef: { current: true }, readyRef: { current: options.ready !== false }, lifecycleEpochRef: { current: 0 },
    AppState: { currentState: 'active', addEventListener(_type, listener) { lifecycle.add(listener); return { remove: () => lifecycle.delete(listener) }; } },
    calendarColorContextRef: { current: { dates: ['2026-10-28'], calendars: [], preferences: { selectedCalendarIds: [] } } },
    subscribeAccountSync(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    setAccountSyncStatus(status) { statuses.push({ at: now, running: status.running }); },
    listCategories: async () => [], setDataVersion() {},
    setTimeout: schedule, clearTimeout(id) { timers.delete(id); },
    synchronizeAccounts() {
      calls.push({ kind: 'accounts', at: now }); publish({ running: true, cycleComplete: false });
      const work = options.accounts ? options.accounts() : options.cycleMs !== undefined
        ? new Promise((resolve) => schedule(() => resolve(success()), options.cycleMs)) : Promise.resolve(success());
      return Promise.resolve(work).then((result) => { publish(result); return result; });
    },
    reconcileLinkedCalendarColors: async (...args) => { calls.push({ kind: 'preflight', at: now, args }); return options.preflight?.(); },
    nativeProjectionWork: { resume() { calls.push({ kind: 'resume', at: now }); } },
  };
  vm.runInNewContext(ts.transpileModule('module.exports = (' + effect.expression.arguments[0].getText(ast) + ');', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context, { filename });
  const cleanup = context.module.exports();
  const settle = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
  return { calls, statuses, timers, settle, publish,
    invalidateReady() { context.readyRef.current = false; },
    async advance(milliseconds) {
      const end = now + milliseconds;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback(); await settle();
      }
      now = end; await settle();
    },
    async state(value) {
      context.AppState.currentState = value; if (value !== 'active') context.lifecycleEpochRef.current++;
      for (const listener of [...lifecycle]) listener(value); await settle();
    },
    cleanup() { cleanup?.(); },
  };
}

test('a background check waits fifteen seconds after the previous account and source work settles', async () => {
  const account = deferred(), preflight = deferred(); let first = true;
  const h = polling({ accounts: () => first ? (first = false, account.promise) : success(), preflight: () => preflight.promise });
  await h.settle(); await h.advance(40_000);
  assert.equal(h.calls.filter((call) => call.kind === 'accounts').length, 1); assert.equal(h.timers.size, 0);
  account.resolve(success()); await h.settle(); await h.advance(5000);
  assert.equal(h.timers.size, 0, 'native source checking remains part of this poll');
  preflight.resolve(); await h.settle(); assert.equal(h.timers.size, 1);
  await h.advance(14_999); assert.equal(h.calls.filter((call) => call.kind === 'accounts').length, 1);
  await h.advance(1); assert.equal(h.calls.filter((call) => call.kind === 'accounts').length, 2);
  assert.equal(h.calls.filter((call) => call.kind === 'accounts')[1].at, 60_000); h.cleanup();
});

test('near-fifteen-second cycles leave an actual idle interval instead of restarting on the old fixed tick', async () => {
  const h = polling({ cycleMs: 14_900 }); await h.settle(); await h.advance(60_000);
  assert.deepEqual(h.calls.filter((call) => call.kind === 'accounts').map((call) => call.at), [0, 29_900, 59_800]);
  assert.deepEqual(h.statuses.slice(0, 4), [{ at: 0, running: true }, { at: 14_900, running: false },
    { at: 29_900, running: true }, { at: 44_800, running: false }]); h.cleanup();
});

test('a completed independent edit/manual account cycle postpones a redundant background sweep', async () => {
  const h = polling(); await h.settle(); await h.advance(5000);
  h.publish({ running: true, cycleComplete: false }); await h.advance(2000); h.publish(success());
  await h.advance(8000); assert.equal(h.calls.filter((call) => call.kind === 'accounts').length, 1);
  await h.advance(6999); assert.equal(h.calls.filter((call) => call.kind === 'accounts').length, 1);
  await h.advance(1); assert.equal(h.calls.filter((call) => call.kind === 'accounts')[1].at, 22_000); h.cleanup();
});

test('backgrounding cancels the pending timer and foregrounding schedules one new poll', async () => {
  const h = polling(); await h.settle(); assert.equal(h.timers.size, 1);
  await h.state('background'); assert.equal(h.timers.size, 0); await h.advance(60_000);
  assert.equal(h.calls.filter((call) => call.kind === 'accounts').length, 1);
  await h.state('active'); assert.equal(h.timers.size, 1); await h.advance(15_000);
  assert.equal(h.calls.filter((call) => call.kind === 'accounts').length, 2); h.cleanup();
});

test('cleanup or background during a source request cannot rearm a timer or resume native work', async () => {
  for (const exit of ['cleanup', 'background']) {
    const pending = deferred(); const h = polling({ accounts: () => pending.promise }); await h.settle();
    if (exit === 'cleanup') h.cleanup(); else await h.state('background');
    pending.resolve(success()); await h.settle(); await h.advance(60_000);
    assert.equal(h.timers.size, 0); assert.equal(h.calls.filter((call) => call.kind === 'accounts').length, 1);
    assert.equal(h.calls.some((call) => call.kind === 'preflight' || call.kind === 'resume'), false); h.cleanup();
  }
});

test('an unsafe account result retains native readiness gates and a not-ready app starts no poll', async () => {
  const h = polling({ accounts: () => ({ running: false, cycleComplete: true, nativeWriteReady: false }) }); await h.settle();
  assert.equal(h.calls.some((call) => call.kind === 'preflight' || call.kind === 'resume'), false);
  assert.equal(h.timers.size, 1); h.cleanup();
  const notReady = polling({ ready: false }); await notReady.settle(); await notReady.advance(60_000);
  assert.equal(notReady.calls.length, 0); assert.equal(notReady.timers.size, 0);
  const staleReady = polling(); await staleReady.settle(); staleReady.invalidateReady();
  await staleReady.advance(15_000); assert.equal(staleReady.calls.filter((call) => call.kind === 'accounts').length, 1);
  assert.equal(staleReady.timers.size, 0); staleReady.cleanup();
});
