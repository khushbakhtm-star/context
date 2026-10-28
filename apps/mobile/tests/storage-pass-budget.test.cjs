const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual engine pass/ordering with in-memory I/O. Encryption and
// SQLite correctness have their separate production-code integration suites.
function fixture({ documents = 0, downloads = 0 } = {}) {
  const filename = path.join(__dirname, '../src/sync/engine.ts');
  const source = fs.readFileSync(filename, 'utf8'); const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const names = new Set(['storageSync', 'runSync', 'StorageDownloadPending']);
  const nodes = parsed.statements.filter((node) => names.has(node.name?.text) || ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((item) => ['STORAGE_DOWNLOADS_PER_PASS', 'STORAGE_UPLOADS_PER_PASS'].includes(item.name.getText(parsed))));
  const settings = new Map(); const uploaded = new Set(); const seen = new Set(); const remote = new Map();
  const docs = Array.from({ length: documents }, (_, index) => ({ key: `category:fixture_${index}`, revision: String(index), value: { id: `fixture_${index}` } }));
  for (let index = 0; index < downloads; index++) remote.set(`remote_${index}`, JSON.stringify({ version: 1, id: `remote_${index}`, documents: [{ key: `category:remote_${index}`, value: { id: `remote_${index}` } }] }));
  const counts = { serial: 0, encrypted: [], writes: [], imports: [], continuation: 0, calendar: 0, list: 0 };
  const storage = { async listFiles() { counts.list++; return [...remote.keys()].map((id) => ({ id, name: id })); },
    async readFile(file) { return remote.get(file.id); },
    async writeFile(name, text) { counts.writes.push(name); remote.set(name, text); } };
  const account = { id: 'google:fixture', label: 'Fixture', consent: { ledgerStorage: true, calendarRead: true, calendarWrite: true } };
  const context = { TextEncoder, Date, Map, Set, Error,
    Crypto: { randomUUID: () => `fixture_${++counts.serial}` },
    SecureStore: { getItemAsync: async () => 'fixture-not-a-real-key' }, PASSPHRASE_KEY: 'fixture',
    createLedgerStorage: () => storage, getAccounts: async () => [account],
    getSetting: async (key, fallback) => settings.has(key) ? settings.get(key) : fallback,
    setSetting: async (key, value) => { settings.set(key, value); },
    getDocumentsForUpload: async (_account, limit) => docs.filter((doc) => !uploaded.has(doc.key)).slice(0, limit),
    acknowledgeUploaded: async (_account, batch) => { for (const doc of batch) uploaded.add(doc.key); },
    hasSeenSyncFile: async (_account, id) => seen.has(id), markSyncFileSeen: async (_account, id) => { seen.add(id); },
    encryptBatch: async (batch) => { counts.encrypted.push(batch.documents.length); return JSON.stringify(batch); },
    decryptBatch: async (text) => JSON.parse(text), clearSavedPassphrase: async () => {},
    mergeSyncDocuments: async (batch) => { counts.imports.push(...batch.map((doc) => doc.key)); },
    getPendingInlineMinuteLinks: async () => [], listCategories: async () => [], listProjections: async () => [],
    linkActualsToAccounts: async () => {}, serializeColorReconciliation: async (work) => { counts.calendar++; return work(); },
    requestAccountSynchronization: () => { counts.continuation++; }, status: { running: false, lastSyncedAt: null, message: 'Ready' },
    publish(next) { Object.assign(context.status, next); } };
  const module = { exports: {} };
  const code = ts.transpileModule(nodes.map((node) => node.getText(parsed)).join('\n') + '\nexport { storageSync, runSync };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { ...context, module, exports: module.exports });
  return { api: module.exports, counts, account, context, settings, remote, uploaded, seen };
}

test('one foreground pass uploads at most four 500-document batches across both storage phases and resumes without losing acknowledgements', async () => {
  const h = fixture({ documents: 2501 });
  const first = await h.api.runSync();
  assert.deepEqual(h.counts.encrypted, [500, 500, 500, 500]); assert.equal(h.counts.writes.length, 4);
  assert.equal(h.uploaded.size, 2000); assert.equal(first.running, false); assert.equal(first.lastSyncedAt, null);
  assert.match(first.message, /continuing/); assert.equal(h.counts.continuation, 1);
  const second = await h.api.runSync();
  assert.deepEqual(h.counts.encrypted, [500, 500, 500, 500, 500, 1]); assert.equal(h.uploaded.size, 2501);
  assert.equal(new Set(h.counts.writes).size, 6); assert.equal(second.message, 'Accounts synchronized');
  assert.ok(second.lastSyncedAt); assert.equal(h.counts.continuation, 1);
});

test('bounded downloads preserve checkpoints and block uploads and calendar writes until every remote batch has been checked', async () => {
  const h = fixture({ documents: 1, downloads: 10 });
  const first = await h.api.runSync();
  assert.equal(h.seen.size, 8); assert.equal(h.counts.imports.length, 8); assert.equal(h.counts.writes.length, 0);
  assert.equal(h.counts.calendar, 0); assert.equal(first.running, false); assert.equal(first.lastSyncedAt, null);
  assert.match(first.message, /download is continuing.*Calendar changes will resume/);
  assert.equal(h.counts.continuation, 1);
  const second = await h.api.runSync();
  assert.ok(h.seen.has('remote_9')); assert.equal(h.counts.writes.length, 1);
  for (let index = 0; index < 10; index++) assert.equal(h.counts.imports.filter((key) => key === `category:remote_${index}`).length, 1);
  assert.equal(second.message, 'Accounts synchronized'); assert.ok(second.lastSyncedAt);
});

test('a failed immutable upload retains its exact pending encrypted batch and never marks its documents uploaded', async () => {
  const h = fixture({ documents: 501 });
  const budget = { downloads: 0, uploads: 0, verifiedPassphrase: false };
  // A read-only view of the same provider is enough to inject its lost response.
  const firstWrite = h.context.createLedgerStorage().writeFile;
  h.context.createLedgerStorage().writeFile = async () => { throw new Error('Connection lost'); };
  await assert.rejects(h.api.storageSync(h.account, 'fixture', budget), /Connection lost/);
  const saved = h.settings.get('account.pendingBatch.google:fixture'); assert.ok(saved); assert.equal(h.uploaded.size, 0);
  h.context.createLedgerStorage().writeFile = firstWrite;
  await h.api.storageSync(h.account, 'fixture', budget);
  assert.equal(h.counts.encrypted.length, 2, 'the failed first batch is reused; only the final remaining document needs a fresh salt');
  assert.equal(h.counts.writes[0], saved.name); assert.equal(h.uploaded.size, 501);
});

test('a remote batch arriving in the second storage phase also queues continuation when the shared read budget is spent', async () => {
  const h = fixture({ documents: 1, downloads: 8 });
  const first = await h.api.runSync();
  assert.equal(h.counts.writes.length, 1); assert.equal(h.uploaded.size, 1);
  assert.equal(first.running, false); assert.match(first.message, /download is continuing/);
  assert.equal(first.lastSyncedAt, null); assert.equal(h.counts.continuation, 1);
  const second = await h.api.runSync(); assert.equal(second.message, 'Accounts synchronized');
  assert.equal(h.counts.writes.length, 1, 'continuing the read cannot duplicate the earlier acknowledged upload');
});
