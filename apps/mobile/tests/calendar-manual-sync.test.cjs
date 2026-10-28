const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const mobile = path.resolve(__dirname, '..');
const file = path.join(mobile, 'App.tsx');
const text = fs.readFileSync(file, 'utf8');
const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const transpile = (value) => ts.transpileModule(value, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const controller = source.statements.find((node) => node.name?.text === 'AppController');
assert.ok(controller);
function declaration(name) {
  const node = source.statements.find((node) => node.name?.text === name ||
    node.declarationList?.declarations.some((entry) => entry.name?.text === name));
  assert.ok(node, `Missing production declaration ${name}`); return node.getText(source);
}
const synchronize = controller.body.statements.find((node) => node.name?.text === 'synchronizeCalendar');
assert.ok(synchronize);
function effectContaining(value) {
  const node = controller.body.statements.find((entry) => ts.isExpressionStatement(entry) &&
    ts.isCallExpression(entry.expression) && entry.expression.expression.getText(source) === 'useEffect' &&
    entry.expression.arguments[0]?.getText(source).includes(value));
  assert.ok(node, `Missing production lifecycle effect ${value}`);
  return node.expression.arguments[0].getText(source);
}
const mountEffect = effectContaining('controllerMountedRef.current = true;');
const lifecycleEffect = effectContaining("AppState.addEventListener('change'");
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const settle = async () => { for (let index = 0; index < 35; index++) await Promise.resolve(); };

/** Execute the actual App callback and its actual lifecycle cancellation effects.
 * Only native/database/network transports and React state setters are replaced. */
function app(options = {}) {
  let clock = 0, serial = 0;
  const timers = new Map(), listeners = new Set();
  const calls = [], drafts = options.drafts ?? [{ dateKey: '2026-10-27', minuteIndex: 600,
    text: 'Saved local minute', categoryId: 'study', revision: 1, savedRevision: 1, error: false }];
  const state = { syncing: false, error: null, dataVersion: 0, viewChanging: false, updates: [] };
  const context = {
    module: { exports: {} }, console, Error, Promise, AbortController,
    ready: true, viewChangingRef: { current: false }, manualSyncAbortRef: { current: null },
    controllerMountedRef: { current: true }, lifecycleEpochRef: { current: 0 }, activeTransitionRef: { current: null },
    printAbortRef: { current: null }, printOptionsOpenRef: { current: false }, printOptionsClosingRef: { current: false },
    calendarColorContextRef: { current: { dates: ['2026-10-27'], preferences: { selectedCalendarIds: ['calendar'] } } },
    calendarProjectionConfigRef: { current: options.projection ?? { syncActuals: false, writeCalendarId: null, accountCalendarWrites: false } },
    AppState: { currentState: 'active', addEventListener(_type, callback) { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } },
    Platform: { OS: 'android' },
    setManualSyncing(value) { state.syncing = value; state.updates.push(['syncing', value]); },
    setManualSyncError(value) { state.error = value; state.updates.push(['error', value]); },
    setViewChanging(value) { state.viewChanging = value; state.updates.push(['viewChanging', value]); },
    setDataVersion(update) { state.dataVersion = typeof update === 'function' ? update(state.dataVersion) : update; state.updates.push(['dataVersion', state.dataVersion]); },
    setTimeout(callback, milliseconds) { const id = ++serial; timers.set(id, { at: clock + milliseconds, milliseconds, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    inlineMinuteDrafts: { snapshot: () => drafts },
    flushInlineMinutes: async () => { calls.push('flush'); return options.flush?.(); },
    refreshCalendars: async () => { calls.push('refresh'); return options.refresh ? options.refresh() : ['calendar']; },
    reconcileLinkedCalendarColors: async (...args) => { calls.push('reconcile'); return options.reconcile?.(...args); },
    retryInlineMinuteLinks: async () => { calls.push('links'); },
    synchronizeAccounts: async () => { calls.push('accounts'); return options.accounts ? options.accounts() : { message: 'Accounts synchronized', conflicts: 0 }; },
    hasConfiguredAccountCalendarWriter: async () => { calls.push('writer'); return options.directWriter ?? false; },
    flushPendingActuals: async () => { calls.push('native'); return { failed: 0 }; },
    colorDraftObserver: { consumeSkipped() { calls.push('consumeSkipped'); } },
    transitionFromCalendar() { throw new Error('Background synchronization must not acquire the view-transition lock.'); },
    invalidatePrintOptionsAction() { calls.push('invalidatePrint'); },
    calendarReturnRefresh: { cancel() { calls.push('cancelReturn'); }, start() { calls.push('startReturn'); } },
    nativeProjectionWork: { suspend() { calls.push('suspendNative'); }, resume() { calls.push('resumeNative'); }, request() { calls.push('requestNative'); } },
    requestAccountSynchronization() { calls.push('requestAccounts'); },
  };
  vm.runInNewContext(transpile([declaration('CalendarTransitionCancelled'), declaration('MANUAL_SYNC_WAIT_MS'),
    declaration('awaitCalendarTransition'), synchronize.getText(source),
    `const mount = (${mountEffect}); const lifecycle = (${lifecycleEffect});`,
    'module.exports = { synchronizeCalendar, mount, lifecycle, deadline: MANUAL_SYNC_WAIT_MS };'].join('\n')), context, { filename: file });
  const api = context.module.exports;
  const cleanupMount = api.mount(), cleanupLifecycle = api.lifecycle();
  return { state, calls, drafts, timers, context, deadline: api.deadline, sync: api.synchronizeCalendar,
    advance(milliseconds) { clock += milliseconds;
      while (true) { const due = [...timers].find(([, timer]) => timer.at <= clock); if (!due) break;
        timers.delete(due[0]); due[1].callback(); } },
    lifecycle(value) { context.AppState.currentState = value; for (const listener of [...listeners]) listener(value); },
    unmount() { cleanupLifecycle(); cleanupMount(); },
  };
}

test('manual Sync releases its caller after 35 seconds of an unresolved refresh without locking the grid or applying late results', async () => {
  const pending = deferred(); const h = app({ refresh: () => pending.promise }); const draft = JSON.stringify(h.drafts);
  const work = h.sync(); await settle();
  assert.equal(h.deadline, 35_000); assert.equal(h.state.syncing, true);
  assert.equal(h.state.viewChanging, false); assert.equal(h.context.viewChangingRef.current, false);
  assert.deepEqual(h.calls, ['flush', 'refresh']);
  h.advance(34_999); await settle(); assert.equal(h.state.syncing, true);
  h.advance(1); await work;
  assert.equal(h.state.syncing, false); assert.equal(h.context.manualSyncAbortRef.current, null); assert.equal(h.timers.size, 0);
  assert.match(h.state.error, /keep editing/); assert.equal(JSON.stringify(h.drafts), draft);
  pending.resolve(['late calendar']); await settle();
  assert.deepEqual(h.calls, ['flush', 'refresh']); assert.equal(h.state.dataVersion, 0);
  assert.equal(h.state.updates.some(([name]) => name === 'viewChanging'), false);
});

test('a timed-out account synchronization permits a fresh manual retry and cannot run stale follow-on writes', async () => {
  const pending = deferred(); let requests = 0;
  const h = app({ accounts: () => ++requests === 1 ? pending.promise : { message: 'Accounts synchronized', conflicts: 0 },
    projection: { syncActuals: true, writeCalendarId: 'calendar', accountCalendarWrites: false } });
  const first = h.sync(); await settle(); assert.equal(requests, 1);
  h.advance(35_000); await first; assert.equal(h.calls.includes('native'), false);
  await h.sync(); assert.equal(requests, 2); assert.equal(h.state.error, null); assert.equal(h.state.dataVersion, 1);
  const calls = [...h.calls], updates = [...h.state.updates];
  pending.resolve({ message: 'Accounts synchronized', conflicts: 0 }); await settle();
  assert.deepEqual(h.calls, calls); assert.deepEqual(h.state.updates, updates);
  assert.equal(h.calls.filter((name) => name === 'native').length, 1);
});

test('duplicate Sync taps share one pending attempt while saved minute data remains available', async () => {
  const pending = deferred(); const h = app({ refresh: () => pending.promise });
  const first = h.sync(); await settle(); const active = h.context.manualSyncAbortRef.current;
  await h.sync(); await h.sync(); assert.equal(h.context.manualSyncAbortRef.current, active);
  assert.deepEqual(h.calls, ['flush', 'refresh']); assert.equal(h.timers.size, 1);
  assert.equal(h.drafts[0].text, 'Saved local minute');
  pending.resolve(['calendar']); await first;
  assert.equal(h.state.syncing, false); assert.equal(h.calls.filter((name) => name === 'accounts').length, 1);
});

test('production background and unmount effects abort the manual caller and ignore its late completion', async () => {
  for (const exit of ['background', 'unmount']) {
    const pending = deferred(); let reads = 0;
    const h = app({ refresh: () => ++reads === 1 ? pending.promise : ['calendar'] });
    const first = h.sync(); await settle(); const active = h.context.manualSyncAbortRef.current;
    if (exit === 'background') h.lifecycle('background'); else h.unmount();
    await first; assert.equal(active.signal.aborted, true); assert.equal(h.context.manualSyncAbortRef.current, null);
    assert.equal(h.timers.size, 0); assert.equal(h.calls.includes('accounts'), false);
    const calls = [...h.calls], updates = [...h.state.updates];
    pending.resolve(['late calendar']); await settle();
    assert.deepEqual(h.calls, calls); assert.deepEqual(h.state.updates, updates);
    if (exit === 'background') {
      assert.equal(h.state.syncing, false); assert.equal(h.state.error, null);
      h.lifecycle('active'); await settle(); await h.sync();
      assert.equal(h.calls.filter((name) => name === 'accounts').length, 1);
      assert.equal(h.state.dataVersion, 1);
    }
  }
});

test('a failed local minute save stops all manual network work while keeping the draft and a retryable error', async () => {
  const drafts = [{ dateKey: '2026-10-27', minuteIndex: 600, text: 'Unsaved local words', revision: 2, savedRevision: 1, error: true }];
  const h = app({ drafts }); await h.sync();
  assert.deepEqual(h.calls, ['flush']); assert.equal(h.drafts[0].text, 'Unsaved local words');
  assert.match(h.state.error, /minute could not be saved/); assert.equal(h.state.syncing, false); assert.equal(h.timers.size, 0);
  drafts[0].error = false; drafts[0].savedRevision = 2; await h.sync();
  assert.equal(h.state.error, null); assert.equal(h.state.dataVersion, 1);
});

test('successful background Sync preserves text typed after its local flush and leaves editing unlocked', async () => {
  const pending = deferred(); const h = app({ accounts: () => pending.promise,
    projection: { syncActuals: true, writeCalendarId: 'calendar', accountCalendarWrites: false } });
  const work = h.sync(); await settle(); assert.ok(h.calls.includes('accounts'));
  h.drafts[0].text = 'Saved local minute plus newer typing'; h.drafts[0].revision = 2;
  pending.resolve({ message: 'Accounts synchronized', conflicts: 0 }); await work;
  assert.equal(h.drafts[0].text, 'Saved local minute plus newer typing'); assert.equal(h.drafts[0].revision, 2);
  assert.equal(h.drafts[0].savedRevision, 1); assert.equal(h.state.viewChanging, false);
  assert.equal(h.state.syncing, false); assert.equal(h.state.error, null); assert.equal(h.state.dataVersion, 1);
  assert.deepEqual(h.calls, ['flush', 'refresh', 'reconcile', 'links', 'accounts', 'writer', 'native', 'refresh', 'consumeSkipped']);
});

test('the production header keeps menu, date, Undo and Redo enabled while only Sync is busy', async () => {
  const headerFile = path.join(__dirname, 'calendar-header.test.cjs');
  const contents = fs.readFileSync(headerFile, 'utf8'); const prefix = contents.slice(0, contents.indexOf('\ntest('));
  const history = { undo: 0, redo: 0 }, navigation = { previous: 0, next: 0 };
  const module = { exports: {} };
  vm.runInNewContext(prefix.replace('undoSpreadsheetEdit: async () => {}, redoSpreadsheetEdit: async () => {},',
    'undoSpreadsheetEdit: async () => { observedHistory.undo++; }, redoSpreadsheetEdit: async () => { observedHistory.redo++; },') +
    '\nmodule.exports = { headerHarness };', { module, exports: module.exports, __dirname, require, console, observedHistory: history });
  const h = module.exports.headerHarness({ syncing: true, onPrevious() { navigation.previous++; }, onNext() { navigation.next++; } });
  const find = (label) => h.nodes().find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === label);
  for (const label of ['Open menu', 'Previous calendar view', 'Next calendar view', 'Undo Context edit', 'Redo Context edit']) {
    assert.equal(find(label).props.disabled, false, label);
  }
  assert.equal(h.binder().props.disabled, false);
  assert.equal(find('Synchronizing calendars').props.disabled, true);
  h.press(find('Previous calendar view')); h.press(find('Next calendar view'));
  h.press(find('Undo Context edit')); await h.settle(); h.press(find('Redo Context edit')); await h.settle();
  assert.deepEqual(history, { undo: 1, redo: 1 }); assert.deepEqual(navigation, { previous: 1, next: 1 });
  h.press(find('Open menu')); h.render(); assert.ok(h.nodes().some((node) => node.type === 'Modal' && node.props.visible));
  assert.equal(h.calls.sync, 0);
});
