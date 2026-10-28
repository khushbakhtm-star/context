const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const turn = async () => { for (let count = 0; count < 15; count++) await Promise.resolve(); };
function runtime(overrides = {}) {
  const timers = new Map(); let serial = 0;
  const scope = { AbortController, Response, Headers, URL, TextEncoder, TextDecoder, console,
    setTimeout(callback) { const id = ++serial; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); }, ...overrides };
  const cache = new Map();
  const account = { id: 'google:fixture_user', provider: 'google', subject: 'fixture_user', label: 'Fixture',
    consent: { calendarRead: true, calendarWrite: true, ledgerStorage: true } };
  const sdk = { configure() {}, getCurrentUser: () => ({ user: { id: 'fixture_user' } }), getTokens: async () => ({ accessToken: 'fixture-token' }) };
  function load(relative) {
    const filename = path.resolve(__dirname, '../src', relative);
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} }; cache.set(filename, module.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { ...scope, module, exports: module.exports, require(name) {
      if (name === 'react-native') return { Platform: { OS: 'android' } };
      if (name === 'expo-auth-session' || name === 'expo-crypto') return {};
      if (name === 'expo/fetch') return { fetch: scope.fetch };
      if (name === 'expo-secure-store') return { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' };
      if (name === 'expo-web-browser') return { maybeCompleteAuthSession() {} };
      if (name === '../data/database') return { getSetting: async () => [account] };
      if (name === './config') return { accountConfig: { googleWebClientId: 'fixture.apps.example.invalid' }, assertGoogleConfiguration() {} };
      if (name === './webdav') return {};
      if (name === '@react-native-google-signin/google-signin') return { GoogleSignin: sdk };
      if (name.startsWith('.')) return load(path.relative(path.resolve(__dirname, '../src'), path.resolve(path.dirname(filename), name + '.ts')));
      throw new Error(`Unexpected request fixture dependency ${name}`);
    } }, { filename });
    cache.set(filename, module.exports); return module.exports;
  }
  return { api: load('utils/account-request-deadline.ts'), load, account, sdk, timers,
    expire() { const jobs = [...timers.values()]; timers.clear(); for (const callback of jobs) callback(); } };
}

test('an unresolved transport times out, aborts once and ignores a late response without blocking local work', async () => {
  const h = runtime(); const pending = deferred(); let signal; let localEdits = 0;
  const request = h.api.accountFetchWithDeadline('https://example.invalid', {}, async (_url, init) => { signal = init.signal; return pending.promise; });
  const rejection = assert.rejects(request, /timed out/);
  await turn(); await Promise.resolve().then(() => localEdits++); assert.equal(localEdits, 1);
  h.expire(); await rejection; assert.equal(signal.aborted, true);
  pending.resolve(new Response('late')); await turn(); assert.equal(h.timers.size, 0);
  assert.equal(await (await h.api.accountFetchWithDeadline('https://example.invalid', {}, async () => new Response('retry'))).text(), 'retry');
});

test('a body that never finishes also times out and cancels the underlying fetch while normal Response methods stay bound', async () => {
  const h = runtime(); const body = deferred(); let signal;
  const original = new Response('placeholder', { status: 200, headers: { 'X-Fixture': 'preserved' } });
  original.text = () => body.promise;
  const response = await h.api.accountFetchWithDeadline('https://example.invalid', {}, async (_url, init) => { signal = init.signal; return original; });
  assert.equal(response.ok, true); assert.equal(response.headers.get('X-Fixture'), 'preserved');
  const reading = response.text(); const rejection = assert.rejects(reading, /timed out/); await turn(); h.expire(); await rejection;
  assert.equal(signal.aborted, true); body.resolve('late private text'); await turn(); assert.equal(h.timers.size, 0);
  const normal = await h.api.accountFetchWithDeadline('https://example.invalid', {}, async () => new Response('{"ok":true}'));
  assert.deepEqual(await normal.clone().json(), { ok: true }); assert.equal(await normal.text(), '{"ok":true}');
});

test('explicit cancellation rejects before sending a request and stops an active body without applying its late result', async () => {
  const h = runtime(); const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(h.api.accountFetchWithDeadline('https://example.invalid', { signal: controller.signal }, async () => { calls++; return new Response('never'); }), /canceled/);
  assert.equal(calls, 0); assert.equal(h.timers.size, 0);
  const active = new AbortController(); const pending = deferred();
  const request = h.api.accountRequestDeadline(() => pending.promise, { signal: active.signal }); const rejection = assert.rejects(request, /canceled/);
  await turn(); active.abort(); await rejection; pending.resolve('late'); await turn(); assert.equal(h.timers.size, 0);
});

test('a stuck native token lookup coalesces, expires and permits a fresh exact-account retry instead of poisoning the token queue', async () => {
  const h = runtime(); const accounts = h.load('sync/accounts.ts'); const old = deferred(); let calls = 0;
  h.sdk.getTokens = () => { calls++; return calls === 1 ? old.promise : Promise.resolve({ accessToken: 'fresh-fixture-token' }); };
  const first = accounts.accessToken(h.account); assert.equal(accounts.accessToken(h.account), first);
  const rejection = assert.rejects(first, /timed out/); await turn(); h.expire(); await rejection;
  assert.equal(await accounts.accessToken(h.account), 'fresh-fixture-token'); assert.equal(calls, 2);
  old.resolve({ accessToken: 'stale-fixture-token' }); await turn();
  assert.equal(await accounts.accessToken(h.account), 'fresh-fixture-token'); assert.equal(calls, 3);
});

test('the production authenticated account path puts a finite deadline on fetch and returns a bounded body', async () => {
  const pending = deferred(); let signal; const h = runtime({ fetch: async (_url, init) => { signal = init.signal; return pending.promise; } });
  const accounts = h.load('sync/accounts.ts');
  const request = accounts.accountFetch(h.account, 'https://www.googleapis.com/calendar/v3/users/me/calendarList');
  const rejection = assert.rejects(request, /timed out/);
  for (let count = 0; count < 20 && !signal; count++) await turn();
  assert.ok(signal, 'the native token resolved and the actual authenticated fetch began');
  h.expire(); await rejection;
  assert.equal(signal.aborted, true); pending.resolve(new Response('{"items":[]}')); await turn(); assert.equal(h.timers.size, 0);
});

test('WebDAV gives the complete stream one deadline instead of renewing it whenever another chunk arrives', async () => {
  let reads = 0; let canceled = 0; let released = 0; const nextChunk = deferred();
  const response = new Response(null, { status: 207 });
  Object.defineProperty(response, 'body', { value: { getReader: () => ({
    read: () => { reads++; return reads === 1 ? Promise.resolve({ done: false, value: new TextEncoder().encode('<d:multistatus') }) : nextChunk.promise; },
    cancel: async () => { canceled++; }, releaseLock: () => { released++; },
  }) } });
  const h = runtime({ fetch: async () => response }); const webdav = h.load('sync/webdav.ts');
  const reading = webdav.probeWebDavFolder('https://fixture.example.invalid/Context/', { username: 'fixture', password: 'fixture' });
  const rejection = assert.rejects(reading, /timed out/);
  for (let count = 0; count < 20 && reads < 2; count++) await turn();
  assert.equal(reads, 2); h.expire(); await rejection; assert.equal(canceled, 1);
  nextChunk.resolve({ done: true }); await turn(); assert.equal(released, 1); assert.equal(h.timers.size, 0);
});
