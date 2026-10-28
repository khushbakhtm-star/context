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
          async getPendingInlineMinuteLinks() { return [...pending.values()].map((value) => ({ ...value })); },
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
  api.subscribeInlineMinuteLinkWarnings((value) => warnings.push(value));
  t.after(() => api.inlineMinuteDrafts.flushAll());
  function edit(minute, text) {
    api.inlineMinuteDrafts.activate({ dateKey: '2026-10-25', minuteIndex: minute, text: '', categoryId: 'work', keepColor: false });
    api.inlineMinuteDrafts.edit('2026-10-25', minute, { text });
  }
  return { api, rows, pending, links, warnings, reviewPromotions, deferred, edit, get requests() { return requests; },
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
