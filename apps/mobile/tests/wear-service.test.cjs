const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const { setImmediate } = require('node:timers/promises');
const plain = (value) => JSON.parse(JSON.stringify(value));
const day = '2026-10-25';
const op = (patch = {}) => ({ version: 1, operationId: crypto.randomUUID(), dateKey: day, minuteIndex: 1039,
  text: 'Read Codex and follow instructions', baseKnown: false, expectedVersion: null, ...patch });

function harness(t, available = true) {
  const sqlite = new DatabaseSync(':memory:');
  let onRun, onRead, failAck = false, nativeEnabled = false, nativeError, scanGate, dayGate, ackGate, statusGate;
  let transactions = Promise.resolve();
  const listeners = new Set(); const queue = []; const acks = []; const days = [];
  const app = { currentState: 'active' }; let scanCount = 0;
  const native = {
    async setEnabledAsync(value) { nativeEnabled = value; },
    async scanPendingAsync() { scanCount += 1; if (scanGate) await scanGate; for (const listener of listeners) listener({ pendingCount: queue.length }); },
    async drainInboxAsync() { return queue.slice(0, 128); },
    async acknowledgeInboxAsync(id) { const index = queue.findIndex((item) => item.id === id); if (index >= 0) queue.splice(index, 1);
      for (const listener of listeners) listener({ pendingCount: queue.length }); },
    async publishDayAsync(json) { if (dayGate) await dayGate; if (!nativeEnabled) throw Error('Watch disabled'); days.push(JSON.parse(json)); },
    async publishAckAsync(json) { if (ackGate) await ackGate; if (failAck) throw Error('Disconnected during ACK'); if (!nativeEnabled) throw Error('Watch disabled'); acks.push(JSON.parse(json)); },
    async getStatusAsync() { if (statusGate) await statusGate; return { enabled: nativeEnabled, connectedNodeCount: 1, pendingCount: queue.length, error: nativeError }; },
    addListener(_name, listener) { listeners.add(listener); return { remove: () => listeners.delete(listener) }; },
  };
  const database = {
    async execAsync(sql) { sqlite.exec(sql); },
    async runAsync(sql, ...params) { if (onRun) await onRun(sql, params); return { changes: sqlite.prepare(sql).run(...params).changes }; },
    async getFirstAsync(sql, ...params) { const result = sqlite.prepare(sql).get(...params) ?? null; if (onRead) await onRead(sql, params, result); return result; },
    async getAllAsync(sql, ...params) { return sqlite.prepare(sql).all(...params); },
    withExclusiveTransactionAsync(work) {
      const job = transactions.then(async () => { sqlite.exec('BEGIN IMMEDIATE'); try { await work(database); sqlite.exec('COMMIT'); }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; } });
      transactions = job.catch(() => {}); return job;
    },
  };
  const cache = new Map(); const source = (file) => path.join(__dirname, '../src', file);
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} }; cache.set(filename, module.exports);
    const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(javascript, { module, exports: module.exports, console, Date, Math, Intl, JSON,
      Map, Set, Promise, Error, TypeError, RangeError, TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout,
      require(name) {
        if (name === 'expo') return { requireOptionalNativeModule: () => available ? native : null };
        if (name === 'react-native') return { Platform: { OS: 'android' }, AppState: app };
        if (name === 'expo-sqlite') return { openDatabaseAsync: async () => database };
        if (name === 'expo-crypto') return { randomUUID: crypto.randomUUID };
        if (name.startsWith('@noble/')) return require(name);
        if (!name.startsWith('.')) throw Error(`Unexpected wear import: ${name}`);
        const file = path.resolve(path.dirname(filename), `${name}.ts`);
        if (file === source('sync/engine.ts')) return { linkActualsToAccounts: async () => {}, subscribeAccountSync: () => () => {}, requestAccountSynchronization: () => {}, synchronizeAccounts: async () => {} };
        if (file === source('sync/accounts.ts')) return { accountFetch: async () => { throw Error('Unexpected account request'); } };
        if (file === source('sync/providers.ts')) return { createCalendarAdapter: () => { throw Error('Unexpected calendar request'); } };
        return load(file);
      },
    }, { filename });
    cache.set(filename, module.exports); return module.exports;
  }
  const api = load(source('data/database.ts')); const service = load(source('wear/service.ts'));
  // Local draining no longer waits for radio replies/snapshots. With an available
  // mock radio, let their real promise chains settle before legacy ACK assertions.
  const drainLocal = service.drainWearInbox;
  service.drainWearInbox = async (...args) => { await drainLocal(...args); await setImmediate(); };
  const sheet = load(source('services/spreadsheet.ts')); const inline = load(source('services/inline-minutes.ts'));
  t.after(async () => { service.stopWearBridge(); await inline.flushInlineMinutes(); sqlite.close(); });
  const push = (operation) => { const item = { id: crypto.randomUUID(), path: `/context/v1/watch/edit/${operation.operationId}`,
    payload: JSON.stringify(operation), receivedAt: Date.now() }; queue.push(item); return item; };
  async function ready(enabled = true) { await api.initializeDatabase(); await service.initializeWearBridge();
    if (enabled) await service.setWearEnabled(true); await service.drainWearInbox(); await service.refreshWearStatus(); }
  async function version(minute = 1039) { const cell = (await api.getSpreadsheetCells({ dateKey: day, startMinute: minute, endMinute: minute }))[0];
    return JSON.stringify([cell.version.minuteRevision, cell.version.formatRevision]); }
  return { api, service, sheet, inline, sqlite, native, queue, acks, days, app, push, ready, version,
    async settle() { await setImmediate(); await setImmediate(); },
    get scanCount() { return scanCount; }, get listenerCount() { return listeners.size; },
    get nativeEnabled() { return nativeEnabled; }, set nativeEnabled(value) { nativeEnabled = value; },
    set nativeError(value) { nativeError = value; },
    set scanGate(value) { scanGate = value; }, set dayGate(value) { dayGate = value; },
    set ackGate(value) { ackGate = value; }, set statusGate(value) { statusGate = value; },
    emitInbox() { for (const listener of listeners) listener({ pendingCount: queue.length }); },
    set failAck(value) { failAck = value; }, set onRun(value) { onRun = value; }, set onRead(value) { onRead = value; } };
}

test('watch access starts off, a missing optional module is safe, and disabled/background inboxes cannot edit the ledger', async (t) => {
  const h = harness(t); await h.ready(false); h.push(op());
  await h.service.drainWearInbox(); assert.equal(await h.api.getMinuteEntry(day, 1039), null); assert.equal(h.acks.length, 0);
  await h.service.setWearEnabled(true); await h.service.drainWearInbox();
  assert.equal((await h.api.getMinuteEntry(day, 1039)).text, 'Read Codex and follow instructions');
  h.app.currentState = 'background'; h.push(op({ minuteIndex: 1040 })); await h.service.drainWearInbox();
  assert.equal(await h.api.getMinuteEntry(day, 1040), null);
  h.app.currentState = 'active'; await h.service.drainWearInbox(); assert.ok(await h.api.getMinuteEntry(day, 1040));
  const missing = harness(t, false); await missing.ready();
  assert.equal(missing.service.getWearState().available, false); assert.equal(missing.service.getWearState().enabled, false);
});

test('a watch capture preserves phone activity/group/format, deduplicates retries, and publishes canonical sparse versions', async (t) => {
  const h = harness(t); await h.ready();
  await h.api.saveMinuteEntry({ dateKey: day, minuteIndex: 1039, text: 'Phone note', categoryId: 'work' });
  await h.sheet.groupMinuteRange({ dateKey: day, startMinute: 1039, endMinute: 1040 },
    { title: 'Read instructions', categoryId: 'google_palette_2952a3' });
  await h.sheet.applyCellFormat({ dateKey: day, startMinute: 1039, endMinute: 1039 }, { bold: true, textColor: '#123456' });
  const original = await h.api.getMinuteEntry(day, 1039);
  const operation = op({ baseKnown: true, expectedVersion: await h.version(), text: 'Watch dictation' });
  h.push(operation); await h.service.drainWearInbox();
  const entry = await h.api.getMinuteEntry(day, 1039);
  assert.equal(entry.text, 'Watch dictation'); assert.equal(entry.categoryId, original.categoryId); assert.equal(entry.blockId, original.blockId);
  const format = (await h.sheet.getDayCellFormats(day)).get(1039);
  assert.equal(format.bold, true); assert.equal(format.textColor, '#123456');
  assert.equal(format.activityGroup.id, original.blockId); assert.equal(format.activityGroup.title, 'Read instructions');
  assert.equal((await h.api.getMinuteEntry(day, 1040)).blockId, original.blockId);
  const afterVersion = await h.version();
  h.push(operation); await h.service.drainWearInbox(); assert.equal(await h.version(), afterVersion);
  assert.equal(h.acks.at(-1).status, 'applied'); assert.equal(h.acks.at(-1).entry.version, afterVersion);
  const snapshot = h.days.filter((value) => value.dateKey === day).at(-1);
  assert.equal(snapshot.entries.find((cell) => cell.minuteIndex === 1039).text, 'Watch dictation');
  assert.ok(snapshot.categories.some((category) => category.selectable)); assert.equal(snapshot.clockFormat, '12h');
  assert.equal((await h.api.getSyncDocuments('wear.')).length, 0, 'device receipts never enter the cloud journal');
});

test('unknown baselines cannot overwrite notes or resurrect tombstones; stale and ABA edits remain reviewable', async (t) => {
  const h = harness(t); await h.ready();
  await h.api.saveMinuteEntry({ dateKey: day, minuteIndex: 1039, text: 'Phone original', categoryId: 'family' });
  const old = await h.version();
  await h.api.saveMinuteEntry({ dateKey: day, minuteIndex: 1039, text: 'Changed', categoryId: 'family' });
  await h.api.saveMinuteEntry({ dateKey: day, minuteIndex: 1039, text: 'Phone original', categoryId: 'family' });
  const operation = op({ baseKnown: true, expectedVersion: old, text: 'Watch thought' });
  h.push(operation); await h.service.drainWearInbox();
  assert.equal(h.acks.at(-1).status, 'conflict'); assert.equal((await h.api.getMinuteEntry(day, 1039)).text, 'Phone original');
  const conflict = h.service.getWearState().conflicts[0]; assert.equal(conflict.watchText, 'Watch thought');
  await h.service.resolveWearConflict(operation.operationId, 'append', conflict.phone.version);
  assert.equal((await h.api.getMinuteEntry(day, 1039)).text, 'Phone original\nWatch thought');
  assert.equal(h.acks.at(-1).status, 'applied'); assert.equal(h.service.getWearState().conflicts.length, 0);
  await h.api.deleteMinuteEntry(day, 1039); const unknown = op({ text: 'Old unknown thought' });
  h.push(unknown); await h.service.drainWearInbox(); assert.equal(h.acks.at(-1).status, 'conflict');
  assert.equal(await h.api.getMinuteEntry(day, 1039), null);
});

test('Keep phone works when a watch color is no longer available and a changed review token never overwrites a fresh note', async (t) => {
  const h = harness(t); await h.ready();
  await h.api.saveMinuteEntry({ dateKey: day, minuteIndex: 1039, text: 'Phone', categoryId: 'family' });
  const operation = op({ text: 'Watch' }); h.push(operation); await h.service.drainWearInbox();
  let conflict = h.service.getWearState().conflicts[0];
  await h.api.saveMinuteEntry({ dateKey: day, minuteIndex: 1039, text: 'New phone', categoryId: 'family' });
  await assert.rejects(h.service.resolveWearConflict(operation.operationId, 'watch', conflict.phone.version), /changed again/);
  assert.equal((await h.api.getMinuteEntry(day, 1039)).text, 'New phone');
  const receipt = await h.api.getSetting(`wear.receipt.${operation.operationId}`, null);
  receipt.request.categoryId = 'removed_watch_color'; await h.api.setSetting(`wear.receipt.${operation.operationId}`, receipt);
  await h.service.refreshWearStatus(); conflict = h.service.getWearState().conflicts[0];
  await h.service.resolveWearConflict(operation.operationId, 'phone', conflict.phone.version);
  assert.equal((await h.api.getMinuteEntry(day, 1039)).text, 'New phone'); assert.equal(h.acks.at(-1).status, 'applied');
});

test('ledger and receipt writes are atomic, reconnect replays pending ACKs, and equivalent-effect recovery does not duplicate a note', async (t) => {
  const h = harness(t); await h.ready(); const operation = op(); h.push(operation);
  h.sqlite.exec(`CREATE TRIGGER reject_wear_receipt BEFORE INSERT ON settings WHEN NEW.key LIKE 'wear.receipt.%'
    BEGIN SELECT RAISE(ABORT, 'injected watch receipt failure'); END;`);
  await h.service.drainWearInbox(); assert.equal(await h.api.getMinuteEntry(day, 1039), null); assert.equal(h.queue.length, 1);
  h.sqlite.exec('DROP TRIGGER reject_wear_receipt'); h.failAck = true;
  await h.service.drainWearInbox(); assert.ok(await h.api.getMinuteEntry(day, 1039));
  assert.equal((await h.api.getSetting(`wear.receipt.${operation.operationId}`, null)).pendingAck, true);
  const saved = await h.version(); h.failAck = false; h.service.stopWearBridge(); await h.service.initializeWearBridge();
  await h.service.drainWearInbox(); assert.equal(await h.version(), saved); assert.equal(h.queue.length, 0);
  h.sqlite.prepare('DELETE FROM settings WHERE key = ?').run(`wear.receipt.${operation.operationId}`);
  h.push(operation); await h.service.drainWearInbox(); assert.equal(await h.version(), saved);
  assert.equal(h.acks.at(-1).status, 'applied');
});

test('immutable UUID reuse is rejected and request receipts can replay an already delivered conflict resolution', async (t) => {
  const h = harness(t); await h.ready(); const operation = op(); h.push(operation); await h.service.drainWearInbox();
  h.push({ ...operation, text: 'Different payload' }); await h.service.drainWearInbox();
  assert.equal(h.acks.at(-1).status, 'error'); assert.equal((await h.api.getMinuteEntry(day, 1039)).text, operation.text);
  const requestId = crypto.randomUUID(); h.queue.push({ id: requestId, path: `/context/v1/watch/request/${requestId}`,
    payload: JSON.stringify({ version: 1, requestId, dateKey: day, pendingOperationIds: [operation.operationId] }), receivedAt: 0 });
  await h.service.drainWearInbox(); assert.equal(h.acks.at(-1).status, 'applied');
});

test('late initialization and stop cannot resurrect revoked consent or leak listeners', async (t) => {
  const h = harness(t); await h.api.initializeDatabase(); await h.api.setSetting('wear.enabled', true); h.nativeEnabled = true;
  let release; const gate = new Promise((resolve) => { release = resolve; }); let entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  h.onRead = async (sql, params) => { if (sql.includes('FROM settings') && params[0] === 'wear.enabled') { entered(); await gate; } };
  const initialization = h.service.initializeWearBridge(); await waiting;
  await h.service.setWearEnabled(false); release(); await initialization; h.onRead = undefined;
  assert.equal(h.service.getWearState().enabled, false); assert.equal(h.nativeEnabled, false); assert.equal(h.listenerCount, 0);
  await h.service.initializeWearBridge(); h.service.stopWearBridge(); assert.equal(h.listenerCount, 0);
  assert.equal(h.days.length, 0);
});

test('empty native inbox hints and acknowledgment hints do not create a live rescan loop', async (t) => {
  const h = harness(t); await h.ready(); const before = h.scanCount;
  for (let index = 0; index < 10; index += 1) await h.native.scanPendingAsync();
  await setImmediate(); await setImmediate();
  assert.equal(h.scanCount, before + 10);
  h.push(op()); await h.service.drainWearInbox(); await h.service.refreshWearStatus();
  const stable = h.scanCount; await setImmediate(); await setImmediate(); assert.equal(h.scanCount, stable);
  assert.ok(h.scanCount < before + 20, 'real inbox/ACK events are coalesced');
});

test('an authorized full native inbox can drain on startup without revoking watch consent', async (t) => {
  const h = harness(t); await h.api.initializeDatabase(); await h.api.setSetting('wear.enabled', true);
  h.nativeEnabled = true; h.nativeError = 'ERR_WEAR_INBOX_FULL'; h.push(op());
  await h.service.initializeWearBridge(); await h.service.drainWearInbox(); await h.service.refreshWearStatus();
  assert.equal(h.service.getWearState().enabled, true); assert.equal(h.nativeEnabled, true);
  assert.equal(h.queue.length, 0); assert.ok(await h.api.getMinuteEntry(day, 1039));
});

test('durable watch edits and UI notifications do not wait for a stalled scan, day snapshot, ACK or status query', async (t) => {
  const h = harness(t); await h.ready(); await h.settle();
  let release; const gate = new Promise((done) => { release = done; });
  h.scanGate = gate; h.dayGate = gate; h.ackGate = gate; h.statusGate = gate;
  const changed = []; const stop = h.service.subscribeWearCommits((days) => changed.push(...days));
  const snapshot = h.service.publishWearDay(day);
  try {
    await h.service.drainWearInbox();
    const first = op({ text: 'Offline watch note' }); const second = op({ minuteIndex: 1040, text: 'Another nearby note' });
    h.push(first); h.push(second); h.emitInbox(); await h.service.drainWearInbox();
    assert.equal((await h.api.getMinuteEntry(day, 1039)).text, first.text);
    assert.equal((await h.api.getMinuteEntry(day, 1040)).text, second.text);
    assert.deepEqual(changed, [day, day]); assert.equal(h.acks.length, 0);
    assert.equal((await h.api.getSetting(`wear.receipt.${first.operationId}`, null)).pendingAck, true);
    assert.equal((await h.api.getSetting(`wear.receipt.${second.operationId}`, null)).pendingAck, true);
    assert.equal(h.queue.length, 2, 'source items survive until an actual reply succeeds');
  } finally { release(); h.scanGate = h.dayGate = h.ackGate = h.statusGate = null; stop(); }
  await snapshot; await h.settle(); await h.service.drainWearInbox();
  assert.equal(h.queue.length, 0); assert.equal(h.acks.length, 2);
});

test('a large day request cannot hold a following edit or its committed ACK', async (t) => {
  const h = harness(t); await h.ready(); await h.settle();
  let release; h.dayGate = new Promise((done) => { release = done; });
  const requestId = crypto.randomUUID(); h.queue.push({ id: requestId, path: `/context/v1/watch/request/${requestId}`,
    payload: JSON.stringify({ version: 1, requestId, dateKey: day }), receivedAt: 0 });
  const operation = op({ text: 'Edit ahead of snapshot' }); h.push(operation);
  try {
    await h.service.drainWearInbox(); await h.settle();
    assert.equal((await h.api.getMinuteEntry(day, 1039)).text, operation.text);
    assert.equal(h.acks.at(-1).status, 'applied');
    assert.deepEqual(h.queue.map((item) => item.id), [requestId]);
  } finally { release(); h.dayGate = null; }
  await h.settle(); await h.service.drainWearInbox(); assert.equal(h.queue.length, 0);
});

test('withdrawing consent during an in-flight reply cannot mark its durable receipt acknowledged or remove its source', async (t) => {
  const h = harness(t); await h.ready(); await h.settle();
  let release; h.ackGate = new Promise((done) => { release = done; });
  const operation = op({ text: 'Retain until paired access returns' }); h.push(operation);
  await h.service.drainWearInbox(); const version = await h.version();
  await h.service.setWearEnabled(false); release(); h.ackGate = null; await h.settle();
  assert.equal(h.acks.length, 0); assert.equal(h.queue.length, 1);
  assert.equal((await h.api.getSetting(`wear.receipt.${operation.operationId}`, null)).pendingAck, true);
  assert.equal((await h.api.getMinuteEntry(day, 1039)).text, operation.text);
  await h.service.setWearEnabled(true); await h.service.drainWearInbox(); await h.settle();
  assert.equal(await h.version(), version); assert.equal(h.queue.length, 0);
  assert.equal(h.acks.at(-1).status, 'applied');
});

test('repeated day refreshes coalesce while an independent edit still commits immediately', async (t) => {
  const h = harness(t); await h.ready(); await h.settle();
  let release; h.dayGate = new Promise((done) => { release = done; }); const before = h.days.length;
  const first = h.service.publishWearDay(day);
  const joined = Array.from({ length: 40 }, () => h.service.publishWearDay(day));
  assert.ok(joined.every((job) => job === first));
  h.push(op()); await h.service.drainWearInbox(); assert.ok(await h.api.getMinuteEntry(day, 1039));
  release(); h.dayGate = null; await Promise.all(joined); await h.settle();
  assert.ok(h.days.length - before <= 3, 'bursts do not append forty full-day payloads');
});

test('an explicit Settings status request cannot hold the local watch-commit lane', async (t) => {
  const h = harness(t); await h.ready(); await h.settle();
  let release; h.statusGate = new Promise((done) => { release = done; });
  const status = h.service.refreshWearStatus();
  try {
    h.push(op({ text: 'While Settings checks the radio' })); await h.service.drainWearInbox();
    assert.equal((await h.api.getMinuteEntry(day, 1039)).text, 'While Settings checks the radio');
  } finally { release(); h.statusGate = null; }
  await status;
});

test('an ACK pending after conflict resolution cannot hold the next watch edit', async (t) => {
  const h = harness(t); await h.ready(); await h.settle();
  await h.api.saveMinuteEntry({ dateKey: day, minuteIndex: 1039, text: 'Phone original', categoryId: 'family' });
  const operation = op({ text: 'Watch alternative' }); h.push(operation); await h.service.drainWearInbox();
  const review = h.service.getWearState().conflicts[0]; assert.ok(review);
  let release; h.ackGate = new Promise((done) => { release = done; });
  const resolution = h.service.resolveWearConflict(operation.operationId, 'append', review.phone.version);
  try {
    await h.settle(); h.push(op({ minuteIndex: 1040, text: 'Next watch minute' }));
    await h.service.drainWearInbox();
    assert.equal((await h.api.getMinuteEntry(day, 1039)).text, 'Phone original\nWatch alternative');
    assert.equal((await h.api.getMinuteEntry(day, 1040)).text, 'Next watch minute');
  } finally { release(); h.ackGate = null; }
  await resolution; await h.settle();
});

test('thirty-two older replies waiting for the radio cannot hide the next edit in the bounded native inbox', async (t) => {
  const h = harness(t); await h.ready(); await h.settle();
  let release; h.ackGate = new Promise((done) => { release = done; });
  try {
    for (let index = 0; index < 32; index++) h.push(op({ minuteIndex: 1000 + index, text: `Earlier note ${index}` }));
    await h.service.drainWearInbox(); assert.equal(h.queue.length, 32);
    h.push(op({ minuteIndex: 1100, text: 'Newest nearby note' })); await h.service.drainWearInbox();
    assert.equal((await h.api.getMinuteEntry(day, 1100)).text, 'Newest nearby note');
    assert.equal(h.queue.length, 33); assert.equal(h.acks.length, 0);
  } finally { release(); h.ackGate = null; }
  await h.settle(); await h.service.drainWearInbox();
});
