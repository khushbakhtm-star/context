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
const calendarFile = path.join(mobile, 'src/services/calendar.ts');
const calendarSource = ts.createSourceFile(calendarFile, fs.readFileSync(calendarFile, 'utf8'), ts.ScriptTarget.Latest, true);
const reviewError = calendarSource.statements.find((node) => node.name?.text === 'NativeCalendarReconciliationError');
assert.ok(reviewError);
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
  const state = { syncing: false, error: null, notice: null, dataVersion: 0, viewChanging: false, updates: [] };
  let accountStatus = options.status ?? success();
  const context = {
    module: { exports: {} }, console, Error, Promise, AbortController,
    ...require('../src/utils/manual-sync-diagnostics.ts'),
    ...require('../src/utils/account-sync-diagnostics-text.ts'),
    ...require('../src/utils/native-sync-diagnostics.ts'),
    getNativeCalendarSyncDiagnostics: () => ({ content: { acknowledged: 2, totalMs: 100, lastMs: 50 },
      color: { acknowledged: 1, totalMs: 20, lastMs: 20 } }),
    Date: class extends Date { static now() { return clock; } },
    ready: true, viewChangingRef: { current: false }, manualSyncAbortRef: { current: null },
    manualSyncAttemptRef: { current: null },
    controllerMountedRef: { current: true }, lifecycleEpochRef: { current: 0 }, activeTransitionRef: { current: null },
    printAbortRef: { current: null }, printOptionsOpenRef: { current: false }, printOptionsClosingRef: { current: false },
    calendarColorContextRef: { current: { dates: ['2026-10-27'], preferences: { selectedCalendarIds: ['calendar'] } } },
    calendarProjectionConfigRef: { current: options.projection ?? { syncActuals: false, writeCalendarId: null, accountCalendarWrites: false } },
    AppState: { currentState: 'active', addEventListener(_type, callback) { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } },
    Platform: { OS: 'android' },
    setManualSyncing(value) { state.syncing = value; state.updates.push(['syncing', value]); },
    setManualSyncError(value) { state.error = value; state.updates.push(['error', value]); },
    setManualSyncNotice(value) { state.notice = value; state.updates.push(['notice', value]); },
    setAccountSyncStatus(value) { accountStatus = value; },
    getAccountSyncStatus: () => accountStatus,
    setViewChanging(value) { state.viewChanging = value; state.updates.push(['viewChanging', value]); },
    setDataVersion(update) { state.dataVersion = typeof update === 'function' ? update(state.dataVersion) : update; state.updates.push(['dataVersion', state.dataVersion]); },
    setTimeout(callback, milliseconds) { const id = ++serial; timers.set(id, { at: clock + milliseconds, milliseconds, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    inlineMinuteDrafts: { snapshot: () => drafts },
    flushInlineMinutes: async () => { calls.push('flush'); return options.flush?.(); },
    refreshCalendars: async () => { calls.push('refresh'); return options.refresh ? options.refresh() : ['calendar']; },
    reconcileLinkedCalendarColors: async (...args) => { calls.push('reconcile'); return options.reconcile?.(...args); },
    retryInlineMinuteLinks: async () => { calls.push('links'); },
    synchronizeAccounts: () => { calls.push('accounts'); return Promise.resolve(options.accounts ? options.accounts() : success()); },
    hasConfiguredAccountCalendarWriter: async () => { calls.push('writer'); return options.directWriter ?? false; },
    flushPendingActuals: async (...args) => { calls.push('native'); nativeArgs.push(args); return options.native ? options.native(...args) : { failed: 0 }; },
    colorDraftObserver: { consumeSkipped() { calls.push('consumeSkipped'); } },
    transitionFromCalendar() { throw new Error('Background synchronization must not acquire the view-transition lock.'); },
    invalidatePrintOptionsAction() { calls.push('invalidatePrint'); },
    calendarReturnRefresh: { cancel() { calls.push('cancelReturn'); }, start() { calls.push('startReturn'); } },
    nativeProjectionWork: { suspend() { calls.push('suspendNative'); }, resume() { calls.push('resumeNative'); }, request() { calls.push('requestNative'); } },
    requestAccountSynchronization() { calls.push('requestAccounts'); },
  };
  const nativeArgs = [];
  vm.runInNewContext(transpile([declaration('CalendarTransitionCancelled'), declaration('MANUAL_SYNC_WAIT_MS'),
    reviewError.getText(calendarSource).replace(/^export\s+/, ''),
    ...['manualSyncStageText', 'accountSyncContinues', 'accountSyncFailure', 'accountSyncProgressText'].map(declaration),
    declaration('awaitCalendarTransition'), synchronize.getText(source),
    controller.body.statements.find((node) => node.name?.text === 'calendarSyncTimingDetails').getText(source),
    `const mount = (${mountEffect}); const lifecycle = (${lifecycleEffect});`,
    'module.exports = { synchronizeCalendar, calendarSyncTimingDetails, mount, lifecycle, deadline: MANUAL_SYNC_WAIT_MS, NativeCalendarReconciliationError, accountSyncProgressText };'].join('\n')), context, { filename: file });
  const api = context.module.exports;
  const cleanupMount = api.mount(), cleanupLifecycle = api.lifecycle();
  return { state, calls, drafts, timers, context, nativeArgs, deadline: api.deadline, sync: api.synchronizeCalendar,
    reviewError: (message) => new api.NativeCalendarReconciliationError([{ blockId: 'review-block', message }]),
    progressText: api.accountSyncProgressText,
    timingDetails: api.calendarSyncTimingDetails,
    setStatus(value) { accountStatus = value; },
    advance(milliseconds) { clock += milliseconds;
      while (true) { const due = [...timers].find(([, timer]) => timer.at <= clock); if (!due) break;
        timers.delete(due[0]); due[1].callback(); } },
    lifecycle(value) { context.AppState.currentState = value; for (const listener of [...listeners]) listener(value); },
    unmount() { cleanupLifecycle(); cleanupMount(); },
  };
}
function success(overrides = {}) { return { running: false, lastSyncedAt: '2026-10-27T12:00:00Z',
  message: 'Accounts synchronized', conflicts: 0, outcome: 'success', phase: 'idle',
  cycleId: 1, cycleComplete: true, nativeWriteReady: true, ...overrides }; }

test('manual timing keeps measuring the exact pending account work after the caller deadline', async () => {
  const pending = deferred(); const h = app({ accounts: () => pending.promise });
  const work = h.sync(); await settle();
  h.advance(35_000); await work;
  const timing = h.context.manualSyncAttemptRef.current.timing;
  assert.equal(timing.finishedAt, undefined); assert.equal(timing.stage, 'accounts');
  h.advance(76_000); pending.resolve(success()); await settle();
  assert.equal(timing.finishedAt, 111_000); assert.equal(timing.elapsed.accounts, 111_000);
  assert.equal(h.calls.includes('native'), false, 'diagnostics cannot resume expired native work');
});

test('the actual App timing payload does not include account messages or generic error state', () => {
  const h = app({ status: success({ message: 'Private account person@example.test and event title' }) });
  h.state.error = 'Private source error and note';
  const payload = h.timingDetails();
  assert.match(payload, /Local phone-provider acknowledgements/);
  assert.match(payload, /Content: 2/); assert.match(payload, /Color: 1/);
  assert.equal(/Private|example.test|source error|event title/.test(payload), false);
});


test('accounts start before a hung phone read; the 35-second caller deadline releases editing as pending progress', async () => {
  const pending = deferred(); const h = app({ refresh: () => pending.promise }); const draft = JSON.stringify(h.drafts);
  const work = h.sync(); await settle();
  assert.equal(h.deadline, 35_000); assert.equal(h.state.syncing, true);
  assert.equal(h.state.viewChanging, false); assert.equal(h.context.viewChangingRef.current, false);
  assert.deepEqual(h.calls, ['flush', 'accounts', 'refresh']);
  h.advance(34_999); await settle(); assert.equal(h.state.syncing, true);
  h.advance(1); await work;
  assert.equal(h.state.syncing, false); assert.equal(h.context.manualSyncAbortRef.current, null); assert.equal(h.timers.size, 0);
  assert.equal(h.state.error, null); assert.match(h.state.notice, /Refreshing phone calendars[\s\S]*still pending/);
  assert.equal(JSON.stringify(h.drafts), draft);
  pending.resolve(['late calendar']); await settle();
  assert.deepEqual(h.calls, ['flush', 'accounts', 'refresh']); assert.equal(h.state.dataVersion, 0);
  assert.equal(h.state.updates.some(([name]) => name === 'viewChanging'), false);
});

test('an exact timed-out account promise can report its completion without resuming expired native work', async () => {
  const pending = deferred(); const h = app({ accounts: () => pending.promise,
    status: success({ running: true, cycleComplete: false, phase: 'uploading', outcome: 'running',
      message: 'Uploading encrypted ledger updates…', progress: { completed: 3, total: 8 } }) });
  const work = h.sync(); await settle(); h.advance(35_000); await work;
  assert.match(h.state.notice, /Uploading encrypted ledger updates.*3 of 8/); assert.equal(h.state.error, null);
  pending.resolve(success()); await settle();
  assert.match(h.state.notice, /Account synchronization finished/);
  assert.deepEqual(h.calls, ['flush', 'accounts']); assert.equal(h.state.error, null);
  assert.equal(h.state.dataVersion, 0);
});

test('a timed-out attempt permits a new retry and cannot overwrite the new attempt notice or run stale writes', async () => {
  const pending = deferred(); let requests = 0;
  const h = app({ accounts: () => ++requests === 1 ? pending.promise : success(),
    projection: { syncActuals: true, writeCalendarId: 'calendar', accountCalendarWrites: true }, directWriter: true });
  const first = h.sync(); await settle(); h.advance(35_000); await first;
  await h.sync(); assert.equal(requests, 2); assert.equal(h.state.error, null); assert.equal(h.state.dataVersion, 1);
  const calls = [...h.calls], updates = [...h.state.updates];
  pending.resolve(success({ outcome: 'error', message: 'Old request failed', nativeWriteReady: false })); await settle();
  assert.deepEqual(h.calls, calls); assert.deepEqual(h.state.updates, updates);
  assert.equal(h.nativeArgs.length, 1); assert.equal(h.nativeArgs[0][3].existingBindingsOnly, true);
});

test('duplicate Sync taps share one pending attempt while saved minute data remains available', async () => {
  const pending = deferred(); const h = app({ accounts: () => pending.promise });
  const first = h.sync(); await settle(); const active = h.context.manualSyncAbortRef.current;
  await h.sync(); await h.sync(); assert.equal(h.context.manualSyncAbortRef.current, active);
  assert.deepEqual(h.calls, ['flush', 'accounts']); assert.equal(h.timers.size, 1);
  assert.equal(h.drafts[0].text, 'Saved local minute'); pending.resolve(success()); await first;
  assert.equal(h.state.syncing, false); assert.equal(h.calls.filter((name) => name === 'accounts').length, 1);
});

test('production background and unmount effects abort the caller and ignore late account success', async () => {
  for (const exit of ['background', 'unmount']) {
    const pending = deferred(); let requests = 0;
    const h = app({ accounts: () => ++requests === 1 ? pending.promise : success() });
    const first = h.sync(); await settle(); const active = h.context.manualSyncAbortRef.current;
    if (exit === 'background') h.lifecycle('background'); else h.unmount();
    await first; assert.equal(active.signal.aborted, true); assert.equal(h.context.manualSyncAbortRef.current, null);
    assert.equal(h.timers.size, 0); const calls = [...h.calls], updates = [...h.state.updates];
    pending.resolve(success()); await settle(); assert.deepEqual(h.calls, calls); assert.deepEqual(h.state.updates, updates);
    if (exit === 'background') {
      h.lifecycle('active'); await settle(); await h.sync(); assert.equal(requests, 2); assert.equal(h.state.dataVersion, 1);
    }
  }
});

test('a failed local minute save stops account and native network work while preserving the draft', async () => {
  const drafts = [{ dateKey: '2026-10-27', minuteIndex: 600, text: 'Unsaved local words', revision: 2, savedRevision: 1, error: true }];
  const h = app({ drafts }); await h.sync(); assert.deepEqual(h.calls, ['flush']);
  assert.equal(h.drafts[0].text, 'Unsaved local words'); assert.match(h.state.error, /minute could not be saved/);
  assert.equal(h.state.syncing, false); assert.equal(h.timers.size, 0);
  drafts[0].error = false; drafts[0].savedRevision = 2; await h.sync(); assert.equal(h.state.error, null);
});

test('successful synchronization preserves newer typing and updates exact native bindings after accounts and preflight', async () => {
  const pending = deferred(); const h = app({ accounts: () => pending.promise, directWriter: true,
    projection: { syncActuals: true, writeCalendarId: 'calendar', accountCalendarWrites: true } });
  const work = h.sync(); await settle(); h.drafts[0].text += ' plus newer typing'; h.drafts[0].revision = 2;
  pending.resolve(success()); await work;
  assert.equal(h.drafts[0].text, 'Saved local minute plus newer typing'); assert.equal(h.drafts[0].revision, 2);
  assert.equal(h.drafts[0].savedRevision, 1); assert.equal(h.state.viewChanging, false); assert.equal(h.state.error, null);
  assert.deepEqual(h.calls, ['flush', 'accounts', 'refresh', 'reconcile', 'writer', 'native', 'consumeSkipped']);
  assert.deepEqual(JSON.parse(JSON.stringify(h.nativeArgs)), [['calendar', [], 90, { existingBindingsOnly: true }]]);
});

test('failed phone preflight cannot prevent independent account synchronization or authorize native writes', async () => {
  for (const phase of ['refresh', 'reconcile']) {
    const h = app({ [phase]: () => { throw Error('Phone calendar review required'); }, directWriter: true,
      projection: { syncActuals: true, writeCalendarId: 'calendar', accountCalendarWrites: true } });
    await h.sync(); assert.equal(h.calls[1], 'accounts'); assert.equal(h.calls.includes('native'), false);
    assert.match(h.state.error, /Phone calendar review required/);
  }
});

test('an isolated binding review reaches guarded native outbox while preserving the review message', async () => {
  let h;
  const optionsSeen = [];
  h = app({ reconcile: (...args) => { optionsSeen.push(args[3]); throw h.reviewError('This linked activity changed in both places.'); },
    directWriter: true, native: () => ({ failed: 1, reviewMessages: ['Choose a connected event color.'] }),
    projection: { syncActuals: true, writeCalendarId: 'calendar', accountCalendarWrites: true } });
  await h.sync();
  assert.deepEqual(JSON.parse(JSON.stringify(optionsSeen)), [{ nativeOnly: true }]);
  assert.deepEqual(h.calls, ['flush', 'accounts', 'refresh', 'reconcile', 'writer', 'native', 'consumeSkipped']);
  assert.equal(h.nativeArgs[0][3].existingBindingsOnly, true);
  assert.match(h.state.error, /changed in both places/);
  assert.match(h.state.error, /Choose a connected event color/);
  assert.equal(h.state.dataVersion, 1);
  assert.equal(h.state.syncing, false);
});

test('Sync details distinguish encryption preparation from actual network uploading', () => {
  const h = app();
  for (const message of ['Preparing encrypted ledger updates…', 'Uploading encrypted ledger updates…']) {
    assert.equal(h.progressText(success({ running: true, outcome: 'running', phase: 'uploading',
      message, progress: { completed: 0 } })), message + ' (0)');
  }
  assert.equal(h.progressText(success({ running: true, phase: 'downloading', message: '',
    progress: { completed: 5, total: 8 } })), 'Checking downloaded ledger updates. (5 of 8)');
});

test('failed or incomplete account storage/provider cycles never permit native fallback writes', async () => {
  for (const status of [
    success({ outcome: 'error', message: 'Unlock private ledger', nativeWriteReady: false }),
    success({ outcome: 'error', message: 'Wrong key', nativeWriteReady: false }),
    success({ outcome: 'error', message: 'Provider authentication failed', nativeWriteReady: false }),
    success({ outcome: 'error', message: 'Review conflicts', conflicts: 1, nativeWriteReady: false }),
    success({ outcome: 'continuing', phase: 'downloading', message: 'Downloads continuing', nativeWriteReady: false }),
    success({ running: true, cycleComplete: false, nativeWriteReady: true }),
    success({ nativeWriteReady: undefined }),
  ]) {
    const h = app({ accounts: () => status, projection: { syncActuals: true, writeCalendarId: 'calendar', accountCalendarWrites: true } });
    await h.sync(); assert.deepEqual(h.calls, ['flush', 'accounts']);
    if (status.outcome === 'error') assert.ok(h.state.error); else assert.equal(h.state.error, null);
  }
});

test('completed guarded native handoff is progress and may flush only the explicitly selected existing bindings', async () => {
  const h = app({ accounts: () => success({ outcome: 'continuing', nativePendingCount: 2,
    message: 'Phone-linked activities are waiting for their original calendar connection.' }), directWriter: true,
    projection: { syncActuals: true, writeCalendarId: 'calendar', accountCalendarWrites: true } });
  await h.sync(); assert.equal(h.state.error, null); assert.match(h.state.notice, /Phone-linked activities/);
  assert.equal(h.nativeArgs[0][0], 'calendar'); assert.equal(h.nativeArgs[0][3].existingBindingsOnly, true);
  const disabled = app({ projection: { syncActuals: false, writeCalendarId: 'calendar', accountCalendarWrites: true } });
  await disabled.sync(); assert.equal(disabled.calls.includes('native'), false);
});

test('a phone-stage timeout keeps its stage warning even when unrelated account work later succeeds', async () => {
  const pending = deferred(); const h = app({ reconcile: () => pending.promise });
  const work = h.sync(); await settle(); h.advance(35_000); await work;
  const notice = h.state.notice; h.setStatus(success({ cycleId: 99 })); await settle();
  assert.match(notice, /Checking linked calendar changes/); assert.equal(h.state.notice, notice);
  pending.resolve(); await settle(); assert.equal(h.calls.includes('native'), false); assert.equal(h.state.notice, notice);
});

test('the production header retains navigation and allows busy Sync details without a duplicate synchronization', async () => {
  const headerFile = path.join(__dirname, 'calendar-header.test.cjs');
  const contents = fs.readFileSync(headerFile, 'utf8'); const prefix = contents.slice(0, contents.indexOf('\ntest('));
  const history = { undo: 0, redo: 0 }, navigation = { previous: 0, next: 0 }; const module = { exports: {} };
  vm.runInNewContext(prefix.replace('undoSpreadsheetEdit: async () => {}, redoSpreadsheetEdit: async () => {},',
    'undoSpreadsheetEdit: async () => { observedHistory.undo++; }, redoSpreadsheetEdit: async () => { observedHistory.redo++; },') +
    '\nmodule.exports = { headerHarness };', { module, exports: module.exports, __dirname, require, console, observedHistory: history });
  const h = module.exports.headerHarness({ syncing: true, syncDetails: () => 'Uploading encrypted ledger updates. (3 of 8)',
    onPrevious() { navigation.previous++; }, onNext() { navigation.next++; } });
  const find = (label) => h.nodes().find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === label);
  for (const label of ['Open menu', 'Previous calendar view', 'Next calendar view', 'Undo Context edit', 'Redo Context edit'])
    assert.equal(find(label).props.disabled, false, label);
  assert.equal(h.binder().props.disabled, false); const button = find('Synchronizing calendars');
  assert.equal(button.props.disabled, false); assert.equal(button.props.accessibilityState.busy, true);
  h.press(button); assert.equal(h.calls.sync, 0); button.props.onPressIn(); button.props.onLongPress(); button.props.onPress();
  assert.equal(h.calls.errors.length, 1); assert.match(h.calls.errors[0][1], /3 of 8/); assert.equal(h.calls.sync, 0);
  h.press(find('Previous calendar view')); h.press(find('Next calendar view'));
  h.press(find('Undo Context edit')); await h.settle(); h.press(find('Redo Context edit')); await h.settle();
  assert.deepEqual(history, { undo: 1, redo: 1 }); assert.deepEqual(navigation, { previous: 1, next: 1 });
  h.press(find('Open menu')); h.render(); assert.ok(h.nodes().some((node) => node.type === 'Modal' && node.props.visible));
});
