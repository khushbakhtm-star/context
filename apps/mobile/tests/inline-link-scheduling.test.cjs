const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { setImmediate: nextTurn } = require('node:timers/promises');

function runtime(t) {
  const rows = new Map(); const pending = new Map(); const links = []; const warnings = [];
  const reviewPromotions = []; const deferred = [];
  class NativeAccountLinkReviewError extends Error {}
  let gate = null; let failed = false; let review = false; let requests = 0; let revision = 0;
  let accountListener; let queueGate = null; let queueFailed = false; const warningStates = [], queueQueries = [];
  const cache = new Map();
  const source = (name) => path.join(__dirname, '../src', name);
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} }; cache.set(filename, module.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, Date, Map, Set, Promise, console, setTimeout, clearTimeout,
      require(name) {
        if (name === '../data/database') return {
          async saveMinuteRange(value) {
            const key = `${value.dateKey}:${value.startMinute}`;
            rows.set(key, { dateKey: value.dateKey, minuteIndex: value.startMinute, text: value.text,
              categoryId: value.categoryId, blockId: 'note' });
            pending.set(key, { dateKey: value.dateKey, minuteIndex: value.startMinute, affectedDates: [value.dateKey], revision: ++revision });
            return [value.dateKey];
          },
          async deleteMinuteEntry(day, minute) { rows.delete(`${day}:${minute}`); },
          async getMinuteEntry(day, minute) { return rows.get(`${day}:${minute}`) ?? null; },
          async getPendingInlineMinuteLinks(limit) { queueQueries.push(limit);
            const snapshot = [...pending.values()].map((value) => ({ ...value }));
            if (queueGate) await queueGate;
            if (queueFailed) throw Error('Synthetic queue read failure');
            return snapshot.slice(0, limit ?? 100); },
          async acknowledgeInlineMinuteLink(ticket) {
            const key = `${ticket.dateKey}:${ticket.minuteIndex}`;
            if (pending.get(key)?.revision === ticket.revision) pending.delete(key);
          },
          async promoteInlineMinuteLinkForAccountReview(ticket) {
            reviewPromotions.push(ticket);
            const key = `${ticket.dateKey}:${ticket.minuteIndex}`;
            const current = pending.get(key);
            if (!current || current.revision !== ticket.revision) return false;
            pending.delete(key); pending.set(key, { ...current, requiresAccountWriter: true }); return true;
          },
          async deferInlineMinuteLink(ticket) { deferred.push(ticket); },
        };
        if (name === '../sync/engine') return {
          subscribeAccountSync(listener) { accountListener = listener; return () => {}; },
          NativeAccountLinkReviewError,
          canAcknowledgeInlineMinuteLink: async () => true,
          async linkActualsToAccounts(dates, source, anchor) { links.push({ dates: [...dates], source, ...anchor });
            if (gate) await gate; if (review) throw new NativeAccountLinkReviewError('Review exact native ownership');
            if (failed) throw Error('Account temporarily unavailable'); },
          // Deliberately return an unresolved cloud promise: the editing boundary
          // must not await this automatic request, even if a connector stalls.
          requestAccountSynchronization() { requests++; return new Promise(() => {}); },
        };
        if (!name.startsWith('.')) throw Error(`Unexpected inline scheduling import ${name}`);
        return load(path.resolve(path.dirname(filename), `${name}.ts`));
      } }, { filename });
    cache.set(filename, module.exports); return module.exports;
  }
  const api = load(source('services/inline-minutes.ts'));
  api.subscribeInlineMinuteLinkWarnings((value, running) => { warnings.push(value); warningStates.push({ value, running }); });
  t.after(() => api.inlineMinuteDrafts.flushAll());
  function edit(minute, text) {
    api.inlineMinuteDrafts.activate({ dateKey: '2026-10-25', minuteIndex: minute, text: '', categoryId: 'work', keepColor: false });
    api.inlineMinuteDrafts.edit('2026-10-25', minute, { text });
  }
  return { api, rows, pending, links, warnings, warningStates, queueQueries, reviewPromotions, deferred, edit,
    emitAccount(value) { accountListener(value); },
    set queueGate(value) { queueGate = value; }, set queueFailed(value) { queueFailed = value; }, get requests() { return requests; },
    set gate(value) { gate = value; }, set failed(value) { failed = value; }, set review(value) { review = value; } };
}

test('local flush and concurrent link retries stay single-flight without awaiting an account request', async (t) => {
  const r = runtime(t); let release; r.gate = new Promise((resolve) => { release = resolve; });
  r.edit(600, 'First thought'); await r.api.flushInlineMinutes(); await nextTurn();
  assert.equal(r.rows.get('2026-10-25:600').text, 'First thought');
  const first = r.api.retryInlineMinuteLinks(); const second = r.api.retryInlineMinuteLinks({ synchronize: false });
  assert.equal(first, second); assert.equal(r.requests, 0);
  r.edit(601, 'Another thought while linking'); await r.api.flushInlineMinutes();
  assert.equal(r.rows.get('2026-10-25:601').text, 'Another thought while linking');
  assert.equal(r.api.retryInlineMinuteLinks(), first);
  release(); r.gate = null; await first;
  assert.deepEqual(r.links.map((value) => value.minuteIndex), [600, 601]);
  assert.equal(r.pending.size, 0); assert.equal(r.requests, 1, 'the shared drain requests one coalesced cloud pass');
  assert.equal(r.warnings.at(-1), false);
});

test('a failed account link leaves its durable ticket and raw text available for an explicit retry', async (t) => {
  const r = runtime(t); r.failed = true;
  r.edit(600, 'Keep this note offline'); await r.api.flushInlineMinutes(); await r.api.retryInlineMinuteLinks();
  assert.equal(r.rows.get('2026-10-25:600').text, 'Keep this note offline');
  assert.equal(r.pending.size, 1); assert.equal(r.warnings.at(-1), true);
  assert.equal(r.reviewPromotions.length, 0, 'ordinary network errors do not promote local ownership');
  const previousRequests = r.requests; r.failed = false;
  await r.api.retryInlineMinuteLinks({ synchronize: false });
  assert.equal(r.pending.size, 0); assert.equal(r.warnings.at(-1), false);
  assert.equal(r.requests, previousRequests, 'manual/poll draining can suppress a redundant automatic network request');
});

test('only an explicit native ownership review promotes and rotates the local ticket without losing text or acknowledging it', async (t) => {
  const r = runtime(t); r.review = true;
  r.edit(600, 'A note attached to an exact native event'); await r.api.flushInlineMinutes();
  await r.api.retryInlineMinuteLinks({ synchronize: false });
  assert.equal(r.reviewPromotions.length, 1); assert.equal(r.pending.size, 1);
  assert.equal([...r.pending.values()][0].requiresAccountWriter, true);
  assert.equal(r.rows.get('2026-10-25:600').text, 'A note attached to an exact native event');
  r.review = false; r.failed = true;
  await r.api.retryInlineMinuteLinks({ synchronize: false });
  assert.equal(r.reviewPromotions.length, 1); assert.equal(r.deferred.length, 1);
  assert.equal(r.pending.size, 1, 'ordinary failures retain the promoted review ticket');
  r.failed = false;
  await r.api.retryInlineMinuteLinks({ synchronize: false });
  assert.equal(r.pending.size, 0, 'only a subsequent permitted link may acknowledge its exact ticket');
});

test('a poll-only empty link drain never schedules a cloud pass', async (t) => {
  const r = runtime(t);
  await r.api.retryInlineMinuteLinks({ synchronize: false });
  assert.equal(r.requests, 0); assert.equal(r.links.length, 0);
});

test('actual account completion clears a stale warning only after checking the whole durable queue', async (t) => {
  const r = runtime(t); r.failed = true;
  r.edit(600, 'Saved local note'); await r.api.flushInlineMinutes(); await r.api.retryInlineMinuteLinks();
  assert.equal(r.warnings.at(-1), true);
  const linkedBeforeRefresh = r.links.length;
  r.emitAccount({ running: true, cycleComplete: false });
  assert.deepEqual(r.warningStates.at(-1), { value: true, running: true });
  const count = r.queueQueries.length;
  r.emitAccount({ running: false, cycleComplete: false }); await nextTurn();
  assert.equal(r.queueQueries.length, count, 'caller release or incomplete cycle cannot clear a warning');
  // A deferred account-review ticket remains in the same queue and must count.
  [...r.pending.values()][0].requiresAccountWriter = true;
  r.emitAccount({ running: false, cycleComplete: true }); await nextTurn();
  assert.equal(r.queueQueries.at(-1), 1); assert.equal(r.warnings.at(-1), true);
  r.pending.clear(); r.emitAccount({ running: false, cycleComplete: true }); await nextTurn();
  assert.equal(r.warnings.at(-1), false);
  assert.equal(r.links.length, linkedBeforeRefresh, 'warning refresh neither links nor acknowledges any ticket');
});

test('ordinary pending work at account completion does not invent a link failure', async (t) => {
  const r = runtime(t);
  r.pending.set('2026-10-25:600', { dateKey: '2026-10-25', minuteIndex: 600,
    affectedDates: ['2026-10-25'], requiresAccountWriter: true, revision: 1 });
  r.emitAccount({ running: true, cycleComplete: false });
  r.emitAccount({ running: false, cycleComplete: true }); await nextTurn();
  assert.equal(r.queueQueries.at(-1), 1); assert.equal(r.pending.size, 1);
  assert.ok(r.warnings.every((value) => value === false));
  assert.equal(r.links.length, 0, 'warning inspection never dispatches pending work');
});

test('queue read failure preserves a warning and an older empty read cannot erase a newer link attempt', async (t) => {
  const r = runtime(t); r.failed = true;
  r.edit(600, 'First saved note'); await r.api.flushInlineMinutes(); await r.api.retryInlineMinuteLinks();
  r.pending.clear(); r.queueFailed = true;
  r.emitAccount({ running: false, cycleComplete: true }); await nextTurn();
  assert.equal(r.warnings.at(-1), true); r.queueFailed = false;
  let release; r.queueGate = new Promise((done) => { release = done; });
  r.emitAccount({ running: false, cycleComplete: true }); await nextTurn();
  const previous = r.warnings.length;
  r.edit(601, 'Newer saved note'); await r.api.flushInlineMinutes();
  const newer = r.api.retryInlineMinuteLinks();
  release(); r.queueGate = null; await newer; await nextTurn();
  assert.ok(r.warnings.slice(previous).every(Boolean), 'no stale empty result clears the newer failure');
  assert.equal(r.pending.size, 1); assert.equal(r.warnings.at(-1), true);
});
