const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function runtime(native, platform = 'android') {
  const resolutions = []; const cache = new Map();
  const directory = path.join(__dirname, '../modules/context-calendar-colors');
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} }; cache.set(filename, module.exports);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, { module, exports: module.exports, require(name) {
      if (name === 'react-native') return { Platform: { OS: platform } };
      if (name === 'expo') return { requireOptionalNativeModule(moduleName) { resolutions.push(moduleName); return native; } };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`));
      throw Error(`Unexpected color bridge import ${name}`);
    } }, { filename });
    cache.set(filename, module.exports); return module.exports;
  }
  return { api: load(path.join(directory, 'index.ts')), values: load(path.join(directory, 'src/values.ts')), resolutions };
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const request = () => ({ calendarId: '12', eventId: '9223372036854775807', color: '#aAbBcC', expectedColor: '#0b8043',
  startMs: 1_792_934_400_000, endMs: 1_792_934_580_000, title: '  Exact source title  ', notes: 'First note\r\n  Keep whitespace  ' });

test('an explicit color write forwards exact source snapshots and returns only a confirmed canonical result', async () => {
  const calls = [];
  const r = runtime({ async setEventColorAsync(...args) { calls.push(args); return { color: '#AABBCC', changed: true, accountName: 'never-export' }; } });
  const input = request(); const before = JSON.stringify(input);
  assert.deepEqual(plain(await r.api.setEventColorAsync(input)), { color: '#AABBCC', changed: true });
  assert.deepEqual(calls, [['12', '9223372036854775807', '#AABBCC', '#0B8043', input.startMs, input.endMs,
    '  Exact source title  ', 'First note\r\n  Keep whitespace  ']]);
  assert.equal(JSON.stringify(input), before); assert.deepEqual(r.resolutions, ['ContextCalendarColors']);
});

test('bad native identities, colors, ranges and oversized source fields fail before resolving or calling a module', async () => {
  const r = runtime({ async setEventColorAsync() { throw Error('Must not call native'); } });
  for (const patch of [{ calendarId: '01' }, { eventId: '-1' }, { eventId: '9223372036854775808' },
    { calendarId: '1 OR 1=1' }, { color: 'red' }, { color: '#AABBCCDD' }, { expectedColor: 'inherit' },
    { startMs: NaN }, { startMs: 0.5 }, { endMs: request().startMs },
    { endMs: request().startMs + r.values.MAX_COLOR_INTERVAL_MS + 1 },
    { title: 'x'.repeat(100_001) }, { notes: 'x'.repeat(2_000_001) }, { notes: null }]) {
    await assert.rejects(r.api.setEventColorAsync({ ...request(), ...patch }), /request is invalid/);
  }
  assert.equal(r.resolutions.length, 0);
  assert.equal(r.values.eventColorWriteRequest(null), null);
});

test('unavailable platforms/modules and provider permission or stale-source errors never become an acknowledged color', async () => {
  for (const platform of ['ios', 'web']) {
    const r = runtime({ setEventColorAsync() { throw Error('Must not call native'); } }, platform);
    await assert.rejects(r.api.setEventColorAsync(request()), /unavailable/); assert.equal(r.resolutions.length, 0);
  }
  for (const native of [null, {}, { getEventColorsAsync: async () => ({}) }]) {
    await assert.rejects(runtime(native).api.setEventColorAsync(request()), /Update Context/);
  }
  for (const code of ['ERR_CALENDAR_COLOR_PERMISSION', 'ERR_CALENDAR_COLOR_CHANGED', 'ERR_CALENDAR_COLOR_UNSUPPORTED']) {
    const failure = Object.assign(Error('Provider refused this guarded write'), { code });
    const r = runtime({ async setEventColorAsync() { throw failure; } });
    await assert.rejects(r.api.setEventColorAsync(request()), (error) => error === failure);
  }
});

test('wrong, missing and malformed native confirmations fail closed; confirmed no-op is distinct from a changed color', async () => {
  for (const result of [null, false, '#AABBCC', [], {}, { color: '#AABBCC' }, { changed: true },
    { color: '#aabbcc', changed: true }, { color: '#FFFFFF', changed: true }, { color: '#AABBCC', changed: 1 }]) {
    await assert.rejects(runtime({ setEventColorAsync: async () => result }).api.setEventColorAsync(request()), /did not confirm/);
  }
  assert.deepEqual(plain(await runtime({ setEventColorAsync: async () => ({ color: '#AABBCC', changed: false }) }).api.setEventColorAsync(request())),
    { color: '#AABBCC', changed: false });
});

test('an in-flight color request owns a detached source snapshot instead of reading later UI mutations', async () => {
  let release; let captured;
  const r = runtime({ setEventColorAsync(...args) { captured = args; return new Promise((resolve) => { release = resolve; }); } });
  const input = request(); const pending = r.api.setEventColorAsync(input);
  input.color = '#FFFFFF'; input.title = 'Later title'; input.notes = 'Newer raw note';
  release({ color: '#AABBCC', changed: true });
  assert.deepEqual(plain(await pending), { color: '#AABBCC', changed: true });
  assert.equal(captured[2], '#AABBCC'); assert.equal(captured[6], '  Exact source title  ');
  assert.equal(captured[7], 'First note\r\n  Keep whitespace  ');
  assert.equal(input.notes, 'Newer raw note');
});

test('palette reads retain only selected calendar IDs and valid exact provider keys/colors without exporting account metadata', async () => {
  const calls = [];
  const r = runtime({ async getEventPaletteAsync(ids) { calls.push(ids); return [
    { calendarId: '12', key: 'exact-google-key', color: '#0b8043', accountName: 'private' },
    { calendarId: '13', key: 'same-key', color: '#ffffff' },
    { calendarId: '99', key: 'unselected', color: '#FF0000' },
    { calendarId: '012', key: 'invalid-native-id', color: '#FF0000' },
    { calendarId: '12', key: 'control\nkey', color: '#FF0000' },
    { calendarId: '12', key: '', color: '#FF0000' },
    { calendarId: '12', key: 'arbitrary-style', color: 'url(unsafe)' },
  ]; } });
  assert.deepEqual(plain(await r.api.getEventPaletteAsync(['12', '13', '12'])), [
    { calendarId: '12', key: 'exact-google-key', color: '#0B8043' }, { calendarId: '13', key: 'same-key', color: '#FFFFFF' },
  ]);
  assert.deepEqual(plain(calls), [['12', '13']]);
  assert.deepEqual(plain(await r.api.getEventPaletteAsync(['012'])), []);
  assert.equal(calls.length, 1);
  assert.deepEqual(plain(r.values.eventPaletteValues(Array.from({ length: r.values.MAX_COLOR_ROWS + 1 }, () => ({})), ['12'])), []);
});

test('palette availability is optional, while a real provider failure stays visible for a permitted read', async () => {
  assert.deepEqual(plain(await runtime(null).api.getEventPaletteAsync(['12'])), []);
  const r = runtime(null, 'ios'); assert.deepEqual(plain(await r.api.getEventPaletteAsync(['12'])), []); assert.equal(r.resolutions.length, 0);
  const failure = Object.assign(Error('Calendar permission changed'), { code: 'ERR_CALENDAR_COLOR_PERMISSION' });
  await assert.rejects(runtime({ async getEventPaletteAsync() { throw failure; } }).api.getEventPaletteAsync(['12']), (error) => error === failure);
});
