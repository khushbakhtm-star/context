const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadWebDav(handler) {
  const filename = path.join(__dirname, '../src/sync/webdav.ts');
  const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInContext(javascript, vm.createContext({
    module, exports: module.exports, Headers, Response, URL, TextEncoder, TextDecoder,
    require(name) {
      if (name === 'expo/fetch') return { fetch: handler };
      if (name === '../utils/account-request-deadline') return require('../src/utils/account-request-deadline.ts');
      throw new Error(`Unexpected WebDAV test import: ${name}`);
    },
  }), { filename });
  return module.exports;
}

const folder = 'https://cloud.example.com/remote.php/dav/files/user/Context/';
const credentials = { username: 'user', password: 'app-password' };
const account = { id: 'webdav:test', provider: 'webdav', storageUrl: folder };
const file = { id: `${folder}context-batch.json`, name: 'context-batch.json' };
const listing = (inner, prefix = 'd') => `<?xml version="1.0"?><${prefix}:multistatus xmlns:${prefix}="DAV:">${inner}</${prefix}:multistatus>`;
const response = (href, collection = false) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${collection ? '<d:collection/>' : ''}</d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('WebDAV folder normalization rejects insecure URLs, credentials, traversal, and ambiguous paths', () => {
  const { normalizeWebDavFolder } = loadWebDav();
  assert.equal(normalizeWebDavFolder(folder.slice(0, -1)), folder);
  for (const unsafe of [
    'http://cloud.example.com/Context/', 'https://cloud.example.com/',
    'https://user:secret@cloud.example.com/Context/', `${folder}?token=secret`, `${folder}#fragment`,
    `${folder}../outside/`, `${folder}%2e%2e/outside/`, `${folder}%2foutside/`, `${folder}%252e%252e/`,
  ]) assert.throws(() => normalizeWebDavFolder(unsafe));
});

test('WebDAV parser honors DAV namespace identity and successful property statuses', () => {
  const { parseWebDavListing } = loadWebDav();
  const xml = `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:x="urn:foreign">
    <response><href>${file.id}</href><propstat><prop><resourcetype/></prop><status>HTTP/1.1 200 OK</status></propstat></response>
    <x:response><x:href>${folder}context-fake.json</x:href></x:response>
    <response><href>${folder}context-denied.json</href><propstat><prop><resourcetype/></prop><status>HTTP/1.1 403 Forbidden</status></propstat></response>
    </multistatus>`;
  assert.deepEqual(plain(parseWebDavListing(xml, folder)), [file]);
  assert.throws(() => parseWebDavListing('<multistatus xmlns="urn:fake"/>', folder), /directory listing/);
});

test('directory listing only exposes direct Context batches inside the selected origin and folder', () => {
  const { parseWebDavListing } = loadWebDav();
  const xml = listing([
    response(folder, true), response(file.id), response(file.id),
    response('/remote.php/dav/files/user/Context/context-other.json'),
    response(`${folder}nested/context-nested.json`),
    response(`${folder}%2e%2e/context-parent.json`),
    response(`${folder}%2Fcontext-encoded.json`),
    response('https://evil.example.com/Context/context-foreign.json'),
    response('/remote.php/dav/files/user/Elsewhere/context-outside.json'),
    response(`${folder}unrelated.pdf`),
    response(`${folder}context-query.json?secret=1`),
  ].join(''));
  const files = parseWebDavListing(xml, folder);
  assert.equal(files.length, 2);
  assert.equal(files[0].id, file.id);
  assert.equal(files[1].name, 'context-other.json');
});

test('WebDAV XML rejects entity declarations, mismatched tags, and unbound namespace prefixes', () => {
  const { parseWebDavListing } = loadWebDav();
  for (const xml of [
    '<!DOCTYPE x [<!ENTITY ext SYSTEM "https://evil.example.com">]><d:multistatus xmlns:d="DAV:"/>',
    '<d:multistatus xmlns:d="DAV:"><d:response></d:multistatus>',
    '<d:multistatus/>',
  ]) assert.throws(() => parseWebDavListing(xml, folder));
});

test('connection probes an existing folder with Depth 1 and refuses to follow redirects', async () => {
  const requests = [];
  const { probeWebDavFolder } = loadWebDav(async (url, init) => {
    requests.push({ url, init });
    return new Response(listing(response(folder, true)), { status: 207 });
  });
  await probeWebDavFolder(folder, credentials);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, folder);
  assert.equal(requests[0].init.method, 'PROPFIND');
  assert.equal(requests[0].init.headers.get('Depth'), '1');
  assert.equal(requests[0].init.redirect, 'manual');
  assert.equal(requests[0].init.credentials, 'omit');
  assert.equal(requests[0].init.headers.get('Authorization'), `Basic ${Buffer.from('user:app-password').toString('base64')}`);
  let redirects = 0;
  const redirected = loadWebDav(async () => {
    redirects += 1;
    return new Response(null, { status: 302, headers: { Location: 'https://evil.example.com/' } });
  });
  await assert.rejects(redirected.probeWebDavFolder(folder, credentials), /redirects are disabled/);
  assert.equal(redirects, 1);
});

test('WebDAV Basic credentials encode UTF-8 usernames and reject colon ambiguity', async () => {
  let authorization;
  const { probeWebDavFolder } = loadWebDav(async (_url, init) => {
    authorization = init.headers.get('Authorization');
    return new Response(listing(response(folder, true)), { status: 207 });
  });
  await probeWebDavFolder(folder, { username: 'josé', password: 'páss' });
  assert.equal(authorization, `Basic ${Buffer.from('josé:páss').toString('base64')}`);
  await assert.rejects(probeWebDavFolder(folder, { username: 'user:other', password: 'pass' }), /valid WebDAV username/);
});

test('WebDAV PUT is immutable and a lost-response retry verifies the existing bytes', async () => {
  const calls = [];
  const { createWebDavStorage } = loadWebDav(async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'PUT') return new Response(null, { status: 412 });
    return new Response('encrypted-batch', { status: 200 });
  });
  const storage = createWebDavStorage(account, async () => credentials);
  await storage.writeFile(file.name, 'encrypted-batch');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers.get('If-None-Match'), '*');
  assert.equal(calls[0].init.body, 'encrypted-batch');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].url, file.id);
});

test('WebDAV existing-batch conflicts never overwrite a different immutable payload', async () => {
  let puts = 0;
  const { createWebDavStorage } = loadWebDav(async (_url, init) => {
    if (init.method === 'PUT') { puts += 1; return new Response(null, { status: 412 }); }
    return new Response('different-existing-batch');
  });
  const storage = createWebDavStorage(account, async () => credentials);
  await assert.rejects(storage.writeFile(file.name, 'wanted-batch'), /different contents/);
  assert.equal(puts, 1);
});

test('WebDAV reads refuse caller-injected paths before requesting credentials or sending data', async () => {
  let credentialsRead = 0;
  let requests = 0;
  const { createWebDavStorage } = loadWebDav(async () => { requests += 1; throw new Error('unexpected'); });
  const storage = createWebDavStorage(account, async () => { credentialsRead += 1; return credentials; });
  for (const bad of [
    { id: 'https://evil.example.com/context-stolen.json', name: 'context-stolen.json' },
    { id: `${folder}../context-parent.json`, name: 'context-parent.json' },
    { id: `${folder}nested/context-nested.json`, name: 'context-nested.json' },
    { id: file.id, name: 'context-mismatch.json' },
  ]) await assert.rejects(storage.readFile(bad));
  assert.equal(credentialsRead, 0);
  assert.equal(requests, 0);
});

test('WebDAV operations recheck consent through the credential callback', async () => {
  let allowed = true;
  let requests = 0;
  const { createWebDavStorage } = loadWebDav(async () => { requests += 1; return new Response('batch'); });
  const storage = createWebDavStorage(account, async () => {
    if (!allowed) throw new Error('Storage permission disabled');
    return credentials;
  });
  assert.equal(await storage.readFile(file), 'batch');
  allowed = false;
  await assert.rejects(storage.readFile(file), /permission disabled/);
  assert.equal(requests, 1);
});

test('WebDAV caps directory and batch response bodies before parsing them', async () => {
  const { createWebDavStorage } = loadWebDav(async () => new Response('too large', {
    headers: { 'Content-Length': String(16 * 1024 * 1024 + 1) },
  }));
  const storage = createWebDavStorage(account, async () => credentials);
  await assert.rejects(storage.readFile(file), /too large/);
});
