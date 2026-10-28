const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { pbkdf2Sync } = require('node:crypto');
const { pbkdf2 } = require('@noble/hashes/pbkdf2');
const { sha256 } = require('@noble/hashes/sha256');

const root = path.join(__dirname, '../modules/context-ledger-crypto');
const salt = '000102030405060708090a0b0c0d0e0f';
const password = 'Context ledger test';
const key = '49e97ef2e63bdbdd95f0c5f37eacbd991de75f217994fa17d3ad2325123b2e81';

function runtime(native, os = 'android', version = 36) {
  const resolutions = []; const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} }; cache.set(filename, module.exports);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, { module, exports: module.exports, require(name) {
      if (name === 'react-native') return { Platform: { OS: os, Version: version } };
      if (name === 'expo') return { requireOptionalNativeModule(name) { resolutions.push(name); return native; } };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`));
      throw Error('Unexpected ledger crypto bridge import');
    } }, { filename });
    cache.set(filename, module.exports); return module.exports;
  }
  return { api: load(path.join(root, 'index.ts')), values: load(path.join(root, 'src/values.ts')), resolutions };
}

test('native ledger derivation forwards exact UTF-16 without normalization and canonical salt bytes', async () => {
  const calls = [];
  const r = runtime({ async deriveKeyAsync(...args) { calls.push(args); return key; } });
  for (const passphrase of [password, '  Cafe\u0301 \u0645\u0631\u062d\u0628\u0627 \ud83d\udcda\u0000  ', 'x'.repeat(1024)]) {
    assert.equal(await r.api.deriveLedgerKeyAsync(passphrase, salt.toUpperCase()), key);
    assert.deepEqual(calls.at(-1), [passphrase, salt]);
  }
  assert.deepEqual(r.resolutions, ['ContextLedgerCrypto', 'ContextLedgerCrypto', 'ContextLedgerCrypto']);
});

test('unsupported platforms, APIs, missing bindings and unmatched UTF-16 opt out without native work', async () => {
  const forbidden = { deriveKeyAsync() { throw Error('Native must not execute'); } };
  for (const [os, version] of [['ios', 26], ['web', 0], ['android', 24], ['android', '25']]) {
    const r = runtime(forbidden, os, version);
    assert.equal(await r.api.deriveLedgerKeyAsync(password, salt), null); assert.equal(r.resolutions.length, 0);
  }
  for (const passphrase of ['Context bad \ud800 text', 'Context bad \udc00 text', 'Context bad \ud800\ud800 text']) {
    const r = runtime(forbidden);
    assert.equal(await r.api.deriveLedgerKeyAsync(passphrase, salt), null); assert.equal(r.resolutions.length, 0);
  }
  for (const native of [null, {}, { deriveKeyAsync: false }]) {
    assert.equal(await runtime(native).api.deriveLedgerKeyAsync(password, salt), null);
  }
  assert.equal(await runtime({ deriveKeyAsync: async () => null }).api.deriveLedgerKeyAsync(password, salt), null);
  assert.equal(await runtime({ deriveKeyAsync: async () => key }, 'android', 26).api.deriveLedgerKeyAsync(password, salt), key);
});

test('malformed requests reject before resolving native and do not echo sensitive request values', async () => {
  const r = runtime({ deriveKeyAsync() { throw Error('Native must not execute'); } });
  for (const [passphrase, saltHex] of [[null, salt], [12, salt], ['short', salt], ['x'.repeat(1025), salt],
    [password, 'secret invalid salt'], [password, '00'.repeat(15)], [password, 'gg'.repeat(16)], [password, null]]) {
    await assert.rejects(r.api.deriveLedgerKeyAsync(passphrase, saltHex), (error) => error.message === 'The ledger key request is invalid.');
  }
  assert.equal(r.resolutions.length, 0);
});

test('malformed native results and provider self-test failures cannot become successful keys', async () => {
  for (const result of [undefined, false, {}, [], '00'.repeat(31), '00'.repeat(33), 'g'.repeat(64), key.toUpperCase(), `${key}\n`]) {
    await assert.rejects(runtime({ deriveKeyAsync: async () => result }).api.deriveLedgerKeyAsync(password, salt), /could not verify/);
  }
  const error = Object.assign(Error('The phone could not verify its ledger key derivation.'), { code: 'ERR_LEDGER_CRYPTO_SELF_TEST' });
  await assert.rejects(runtime({ deriveKeyAsync: async () => { throw error; } }).api.deriveLedgerKeyAsync(password, salt), (actual) => actual === error);
});

test('waiting for native key work does not hold JS timers or unrelated local callbacks', async () => {
  let release; const order = [];
  const r = runtime({ deriveKeyAsync() { return new Promise((resolve) => { release = resolve; }); } });
  const pending = r.api.deriveLedgerKeyAsync(password, salt).then((value) => { order.push('key'); return value; });
  await new Promise((resolve) => setTimeout(() => { order.push('timer'); resolve(); }, 0));
  await Promise.resolve().then(() => order.push('local edit'));
  assert.deepEqual(order, ['timer', 'local edit']); release(key);
  assert.equal(await pending, key); assert.deepEqual(order, ['timer', 'local edit', 'key']);
});

test('all native provider self-test constants match independent Noble and Node UTF-8 PBKDF2', () => {
  const kotlin = fs.readFileSync(path.join(root, 'android/src/main/java/expo/modules/contextledgercrypto/LedgerKeyDerivation.kt'), 'utf8');
  const vectors = [...kotlin.matchAll(/Vector\(("(?:[^"\\]|\\.)*"(?:\.repeat\(\d+\))?), (SALT|HIGH_SALT), "([a-f0-9]{64})"\)/g)];
  assert.equal(vectors.length, 9);
  for (const [, expression, saltName, expected] of vectors) {
    const repeat = expression.match(/^(".*")\.repeat\((\d+)\)$/);
    const passphrase = repeat ? JSON.parse(repeat[1]).repeat(Number(repeat[2])) : JSON.parse(expression);
    const saltHex = saltName === 'SALT' ? salt : 'ffeeddccbbaa99887766554433221100';
    assert.equal(Buffer.from(pbkdf2(sha256, passphrase, Buffer.from(saltHex, 'hex'), { c: 17, dkLen: 32 })).toString('hex'), expected);
    assert.equal(pbkdf2Sync(passphrase, Buffer.from(saltHex, 'hex'), 17, 32, 'sha256').toString('hex'), expected);
  }
  assert.equal(Buffer.from(pbkdf2(sha256, password, Buffer.from(salt, 'hex'), { c: 600_000, dkLen: 32 })).toString('hex'), key);
  assert.equal(pbkdf2Sync(password, Buffer.from(salt, 'hex'), 600_000, 32, 'sha256').toString('hex'), key);
});

test('the Android source module has no new permissions or dependencies and uses a dedicated cancelled serial CPU scope', () => {
  const moduleName = 'expo.modules.contextledgercrypto.ContextLedgerCryptoModule';
  const config = JSON.parse(fs.readFileSync(path.join(root, 'expo-module.config.json'), 'utf8'));
  assert.deepEqual(config, { platforms: ['android'], android: { modules: [moduleName] } });
  const manifest = fs.readFileSync(path.join(root, 'android/src/main/AndroidManifest.xml'), 'utf8');
  assert.doesNotMatch(manifest, /uses-permission|service|provider|activity/);
  const gradle = fs.readFileSync(path.join(root, 'android/build.gradle'), 'utf8');
  assert.doesNotMatch(gradle, /dependencies|implementation|api\(/);
  const native = fs.readFileSync(path.join(root, 'android/src/main/java/expo/modules/contextledgercrypto/ContextLedgerCryptoModule.kt'), 'utf8');
  assert.match(native, /newSingleThreadExecutor/); assert.match(native, /\.runOnQueue\(workScope\)/);
  assert.doesNotMatch(native, /Queues\.DEFAULT|Dispatchers\.(?:Default|IO|Main)|println|Log\./);
  assert.match(native, /SDK_INT < 26/); assert.match(native, /workScope\.cancel\(\)/); assert.match(native, /dispatcher\.close\(\)/);
  assert.equal((native.match(/workScope\.ensureActive\(\)/g) || []).length, 2);
});
