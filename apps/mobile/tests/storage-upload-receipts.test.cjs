const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const plain = (value) => JSON.parse(JSON.stringify(value));
const filename = 'context-upload-receipt.json';
const ciphertext = 'opaque authenticated ciphertext';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const fixtureAccount = (provider) => ({ id: provider + ':fixture', provider, subject: 'fixture',
  storageUrl: 'https://storage.example.test/Context/', consent: { ledgerStorage: true } });

// Only platform/OAuth/HTTP boundaries are replaced; real provider request and
// recovery paths are loaded without accessing any live credentials or network.
function transportFixture(provider, handler) {
  const account = fixtureAccount(provider), settings = new Map(), calls = [], cache = new Map();
  const request = async (url, init = {}, authorized = false) => {
    calls.push({ url: String(url), init, authorized });
    return handler(String(url), init, calls);
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} }; cache.set(file, module.exports);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports, URL, URLSearchParams, Headers, Response,
      TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout, fetch: request,
      require(name) {
        if (name === 'expo-crypto') return { randomUUID: () => 'synthetic-boundary' };
        if (name === 'expo/fetch') return { fetch: request };
        if (name === '../data/database') return { getSetting: async (key, fallback) => settings.get(key) ?? fallback,
          setSetting: async (key, value) => { settings.set(key, value); } };
        if (name === './accounts') return { getAccounts: async () => [account],
          accountFetch: async (_account, url, init) => request(url, init, true),
          getWebDavCredentials: async () => ({ username: 'fixture', password: 'synthetic-app-password' }) };
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('Unexpected storage fixture import: ' + name);
      },
    }, { filename: file });
    cache.set(file, module.exports); return module.exports;
  }
  return { storage: load(path.join(__dirname, '../src/sync/storage.ts')).createLedgerStorage(account),
    account, settings, calls };
}

test('Google returns only the actual confirmed new upload identity', async () => {
  const h = transportFixture('google', async (url, init) => {
    if (url.includes('/files/generateIds')) return json({ ids: ['allocated-1'] });
    if (url.includes('/upload/drive/')) {
      assert.equal(init.method, 'POST'); assert.ok(init.body.includes(ciphertext));
      return json({ id: 'allocated-1', name: filename });
    }
    if (url.includes('/drive/v3/files?')) return json({ files: [] });
    throw Error('Unexpected fixture URL');
  });
  assert.deepEqual(plain(await h.storage.writeFile(filename, ciphertext)), { id: 'allocated-1', name: filename });
});

test('Google lost-response recovery confirms both real metadata and byte-equal immutable contents', async () => {
  let posts = 0, allocations = 0;
  const h = transportFixture('google', async (url, init) => {
    if (url.includes('/files/generateIds')) { allocations++; return json({ ids: ['allocated-1'] }); }
    if (url.includes('/upload/drive/')) {
      assert.equal(init.method, 'POST'); if (++posts === 1) throw Error('Synthetic lost response after commit');
      return json({}, 409);
    }
    if (url.includes('/files/allocated-1?fields=')) return json({ id: 'allocated-1', name: filename });
    if (url.includes('/files/allocated-1?alt=media')) return new Response(ciphertext);
    if (url.includes('/drive/v3/files?')) return json({ files: [] }); // Simulate delayed list visibility.
    throw Error('Unexpected fixture URL');
  });
  await assert.rejects(h.storage.writeFile(filename, ciphertext), /lost response/);
  assert.deepEqual(plain(await h.storage.writeFile(filename, ciphertext)), { id: 'allocated-1', name: filename });
  assert.equal(allocations, 1, 'retry retains the original allocated ID');
  assert.equal(posts, 2);
});

test('existing Google uploads return their real listed ID only after exact contents match', async () => {
  const h = transportFixture('google', async (url) => url.includes('alt=media') ? new Response(ciphertext) :
    json({ files: [{ id: 'existing-1', name: filename }] }));
  assert.deepEqual(plain(await h.storage.writeFile(filename, ciphertext)), { id: 'existing-1', name: filename });
  assert.equal(h.calls.length, 2); assert.equal(h.calls.some((call) => call.init.method === 'POST'), false);
  await assert.rejects(h.storage.writeFile(filename, 'different bytes'), /different immutable/);
});

test('Google cannot acknowledge an inferred ID, changed name, invalid receipt or conflicting recovery contents', async () => {
  for (const response of [{ id: 'different-id', name: filename }, { id: 'allocated-1', name: 'context-other.json' },
    { name: filename }, { id: '', name: filename }]) {
    const h = transportFixture('google', async (url) => url.includes('generateIds') ? json({ ids: ['allocated-1'] }) :
      url.includes('/upload/drive/') ? json(response) : json({ files: [] }));
    await assert.rejects(h.storage.writeFile(filename, ciphertext), /identity|identifier/);
  }
  for (const mismatch of ['name', 'bytes']) {
    const h = transportFixture('google', async (url) => {
      if (url.includes('generateIds')) return json({ ids: ['allocated-1'] });
      if (url.includes('/upload/drive/')) return json({}, 409);
      if (url.includes('?fields=')) return json({ id: 'allocated-1', name: mismatch === 'name' ? 'context-other.json' : filename });
      if (url.includes('alt=media')) return new Response('different bytes');
      return json({ files: [] });
    });
    await assert.rejects(h.storage.writeFile(filename, ciphertext), /identity|differs/);
  }
});

test('Microsoft returns its confirmed create identity and recovers only a byte-equal exact named file', async () => {
  for (const recovered of [false, true]) {
    let lists = 0;
    const h = transportFixture('microsoft', async (url, init) => {
      if (url.includes('/special/approot')) return json({ id: 'root-1' });
      if (url.includes('/children?')) return json({ value: ++lists > 1 ? [{ id: 'actual-1', name: filename, file: {} }] : [] });
      if (init.method === 'PUT') return recovered ? json({}, 412) : json({ id: 'actual-1', name: filename });
      if (url.includes('/items/actual-1?')) return json({ '@microsoft.graph.downloadUrl': 'https://downloads.example.test/item' });
      if (url === 'https://downloads.example.test/item') {
        assert.equal(init.headers, undefined, 'the account token is not forwarded to the download host'); return new Response(ciphertext);
      }
      throw Error('Unexpected fixture URL');
    });
    assert.deepEqual(plain(await h.storage.writeFile(filename, ciphertext)), { id: 'actual-1', name: filename });
  }
});

test('Microsoft existing-byte mismatches and invalid create identities never produce a receipt', async () => {
  for (const badResponse of [{ id: 'item', name: 'context-other.json' }, { name: filename }]) {
    const h = transportFixture('microsoft', async (url, init) => url.includes('/special/approot') ? json({ id: 'root' }) :
      init.method === 'PUT' ? json(badResponse) : json({ value: [] }));
    await assert.rejects(h.storage.writeFile(filename, ciphertext), /identity/);
  }
  const h = transportFixture('microsoft', async (url) => {
    if (url.includes('/special/approot')) return json({ id: 'root' });
    if (url.includes('/children?')) return json({ value: [{ id: 'item', name: filename, file: {} }] });
    if (url.includes('/items/item?')) return json({ '@microsoft.graph.downloadUrl': 'https://downloads.example.test/item' });
    return new Response('different bytes');
  });
  await assert.rejects(h.storage.writeFile(filename, ciphertext), /different immutable/);
});

test('WebDAV confirms its exact successful request resource or byte-equal recovery without following redirects', async () => {
  for (const status of [201, 204, 409, 412]) {
    const h = transportFixture('webdav', async (url, init) => {
      assert.equal(url, 'https://storage.example.test/Context/' + filename);
      assert.equal(init.redirect, 'manual');
      if (init.method === 'GET') return new Response(ciphertext);
      assert.equal(init.headers.get('If-None-Match'), '*'); return new Response(null, { status });
    });
    assert.deepEqual(plain(await h.storage.writeFile(filename, ciphertext)), {
      id: 'https://storage.example.test/Context/' + filename, name: filename });
  }
  const h = transportFixture('webdav', async (_url, init) => init.method === 'GET' ? new Response('different bytes') : new Response(null, { status: 412 }));
  await assert.rejects(h.storage.writeFile(filename, ciphertext), /different contents/);
});

function passFixture({ receipts = true, documents = 501, invalidReceipt, failWrite = false, failAck = false } = {}) {
  const sourceFile = path.join(__dirname, '../src/sync/engine.ts');
  const source = fs.readFileSync(sourceFile, 'utf8'), ast = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, true);
  const names = new Set(['storageSync', 'StorageDownloadPending']);
  const nodes = ast.statements.filter((node) => names.has(node.name?.text) || ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((declaration) => ['STORAGE_DOWNLOADS_PER_PASS', 'STORAGE_UPLOADS_PER_PASS'].includes(declaration.name.getText(ast))));
  const settings = new Map(), seen = new Set(), remote = new Map(), acknowledged = new Set();
  const counts = { reads: [], merged: [], encrypted: 0, writes: 0, marks: [], acks: 0 };
  const docs = Array.from({ length: documents }, (_, index) => ({ key: 'category:item_' + index, revision: 'revision_' + index, value: { index } }));
  const storage = { async listFiles() { return [...remote].map(([id, value]) => ({ id, name: value.name })); },
    async readFile(file) { counts.reads.push(file.id); return remote.get(file.id).body; },
    async writeFile(name, body) {
      counts.writes++; if (failWrite) throw Error('Synthetic failed upload');
      const id = 'confirmed-' + name; remote.set(id, { name, body });
      return invalidReceipt ?? (receipts ? { id, name } : undefined);
    } };
  const module = { exports: {} };
  const javascript = ts.transpileModule(nodes.map((node) => node.getText(ast)).join('\n') + '\nexport { storageSync };',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(javascript, { module, exports: module.exports, Map, Set, Error, TextEncoder,
    createLedgerStorage: () => storage, Crypto: { randomUUID: () => 'batch_' + (++counts.encrypted) },
    getSetting: async (key, fallback) => settings.get(key) ?? fallback, setSetting: async (key, value) => settings.set(key, value),
    hasSeenSyncFile: async (_account, id) => seen.has(id),
    markSyncFileSeen: async (_account, id) => { counts.marks.push(id); seen.add(id); },
    mergeSyncDocuments: async (values) => counts.merged.push(...values),
    getDocumentsForUpload: async (_account, limit) => docs.filter((doc) => !acknowledged.has(doc.key)).slice(0, limit),
    acknowledgeUploaded: async (_account, values) => {
      counts.acks++; if (failAck) throw Error('Synthetic failed local acknowledgement');
      values.forEach((doc) => acknowledged.add(doc.key));
    },
    decryptBatch: async (body) => JSON.parse(body), encryptBatch: async (batch) => JSON.stringify(batch),
    clearSavedPassphrase: async () => {}, publish() {},
  }, { filename: sourceFile });
  const account = fixtureAccount('google');
  const call = (budget = { downloads: 0, uploads: 0, verifiedPassphrase: false }) => module.exports.storageSync(account, 'synthetic passphrase', budget);
  return { call, counts, remote, seen, settings, acknowledged, storage };
}

test('confirmed own uploads skip follow-up downloads while a new peer file is still authenticated and merged', async () => {
  const h = passFixture();
  h.remote.set('older', { name: 'context-old.json', body: JSON.stringify({ documents: [] }) }); h.seen.add('older');
  const budget = { downloads: 0, uploads: 0, verifiedPassphrase: false };
  assert.equal(await h.call(budget), true); assert.deepEqual(h.counts.reads, ['older']);
  assert.equal(h.counts.marks.length, 2); assert.equal(h.acknowledged.size, 501);
  h.remote.set('peer', { name: 'context-peer.json', body: JSON.stringify({ documents: [{ key: 'category:peer' }] }) });
  await h.call(budget);
  assert.deepEqual(h.counts.reads, ['older', 'peer']);
  assert.deepEqual(plain(h.counts.merged), [{ key: 'category:peer' }]);
  assert.equal(h.counts.writes, 2); assert.ok(h.seen.has('peer'));
});

test('own-upload receipts never bypass the next pass passphrase check, including an initially empty account', async () => {
  const h = passFixture({ documents: 1 });
  const budget = { downloads: 0, uploads: 0, verifiedPassphrase: false };
  await h.call(budget); assert.equal(h.counts.reads.length, 0);
  await h.call(budget); assert.equal(h.counts.reads.length, 1, 'one authenticated file is still required before skipping seen files');
  await h.call(); assert.equal(h.counts.reads.length, 2, 'a new pass retains the existing key verification');
});

test('legacy void transports keep normal download behavior and malformed identities are not acknowledged', async () => {
  const old = passFixture({ receipts: false, documents: 1 }); const budget = { downloads: 0, uploads: 0, verifiedPassphrase: true };
  await old.call(budget); assert.equal(old.counts.marks.length, 0);
  await old.call(budget); assert.equal(old.counts.reads.length, 1); assert.equal(old.counts.marks.length, 1);
  for (const invalidReceipt of [{ id: 'wrong-name', name: 'context-other.json' }, { id: '', name: 'context-batch_1.json' }]) {
    const bad = passFixture({ documents: 1, invalidReceipt });
    await assert.rejects(bad.call(), /unexpected uploaded file identity/);
    assert.equal(bad.acknowledged.size, 0); assert.equal(bad.counts.marks.length, 0);
    assert.ok(bad.settings.get('account.pendingBatch.google:fixture'));
  }
});

test('failed writes and failed local acknowledgements retain pending ciphertext and never mark a file seen', async () => {
  for (const failure of [{ failWrite: true }, { failAck: true }]) {
    const h = passFixture({ documents: 1, ...failure });
    await assert.rejects(h.call(), /Synthetic failed/);
    assert.equal(h.counts.marks.length, 0); assert.equal(h.acknowledged.size, 0);
    assert.ok(h.settings.get('account.pendingBatch.google:fixture'));
  }
});
