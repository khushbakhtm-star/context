const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function adapter(options = {}) {
  let snapshot = null, exportedText = null, osText = '', writeFailure = false, readFailure = false, writeReturnsFalse = false;
  let reads = 0; const writes = [];
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/system-cell-clipboard.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Error,
    require(name) {
      if (name === 'expo-clipboard') return {
        async setStringAsync(text, writeOptions) {
          writes.push({ text, options: writeOptions });
          if (writeFailure) throw Error('Native clipboard write rejected');
          if (writeReturnsFalse) return false;
          if (options.setString) await options.setString(text);
          osText = text;
          return true;
        },
        async getStringAsync() {
          reads++;
          if (readFailure) throw Error('Native clipboard read rejected');
          return options.getString ? options.getString() : osText;
        },
      };
      if (name === './spreadsheet') return {
        getSpreadsheetClipboard: () => snapshot ? { ...snapshot } : null,
        getSpreadsheetClipboardText: () => exportedText,
      };
      throw Error(`Unexpected clipboard adapter import: ${name}`);
    },
  });
  return { api: module.exports, writes,
    copy(token, text, mode = 'copy') { snapshot = { token, mode, range: { dateKey: '2026-10-25', startMinute: 600, endMinute: 600 }, count: 1 }; exportedText = text; },
    setOS(text) { osText = text; }, clear() { snapshot = null; exportedText = null; },
    set writeFailure(value) { writeFailure = value; }, set readFailure(value) { readFailure = value; },
    set writeReturnsFalse(value) { writeReturnsFalse = value; },
    get reads() { return reads; }, get snapshot() { return snapshot; } };
}

test('clipboard adapter never inspects OS clipboard at import or while publishing an explicit Context copy', async () => {
  const r = adapter(); assert.equal(r.reads, 0); assert.equal(r.writes.length, 0);
  r.copy('copy-a', 'A\tB\nC\tD'); await r.api.copySpreadsheetCellsToSystem();
  assert.equal(r.reads, 0); assert.equal(r.writes.length, 1); assert.equal(r.writes[0].text, 'A\tB\nC\tD');
  assert.equal(r.writes[0].options.android.isSensitive, true);
  assert.equal((await r.api.readSpreadsheetPasteSource()).kind, 'internal'); assert.equal(r.reads, 1);
});

test('a matching published Context copy retains rich internal metadata, while newer external text wins', async () => {
  const r = adapter(); r.copy('copy-a', 'Original Context text'); await r.api.copySpreadsheetCellsToSystem();
  assert.equal((await r.api.readSpreadsheetPasteSource()).kind, 'internal');
  r.setOS('Fresh Sheets cell\tNext day');
  const next = await r.api.readSpreadsheetPasteSource();
  assert.equal(next.kind, 'external'); assert.equal(next.text, 'Fresh Sheets cell\tNext day');
  assert.equal(r.snapshot.token, 'copy-a', 'choosing external text does not delete the immutable Context clipboard');
});

test('denied and empty clipboard reads are actionable and do not alter a pending local Cut', async () => {
  const r = adapter(); r.copy('cut-a', 'Keep source until confirmed Paste', 'cut');
  await r.api.copySpreadsheetCellsToSystem(); r.readFailure = true;
  await assert.rejects(r.api.readSpreadsheetPasteSource(), /Clipboard access|clipboard/i);
  assert.equal(r.snapshot.mode, 'cut'); assert.equal(r.snapshot.token, 'cut-a');
  r.readFailure = false; r.clear(); r.setOS('');
  await assert.rejects(r.api.readSpreadsheetPasteSource(), /Copy cells|copy.*text|clipboard/i);
});

test('an intentionally blank Context clipboard remains a valid rich internal Paste', async () => {
  const r = adapter(); r.copy('blank-format', ''); await r.api.copySpreadsheetCellsToSystem();
  assert.equal((await r.api.readSpreadsheetPasteSource()).kind, 'internal');
});

test('a rejected repeat OS publication cannot invalidate an already valid matching internal clipboard record', async () => {
  const r = adapter(); r.copy('cut-a', 'Retain formatting and the deferred move', 'cut');
  await r.api.copySpreadsheetCellsToSystem(); r.writeFailure = true;
  await r.api.copySpreadsheetCellsToSystem();
  assert.equal(r.snapshot.token, 'cut-a'); assert.equal(r.snapshot.mode, 'cut');
  assert.equal((await r.api.readSpreadsheetPasteSource()).kind, 'internal');
});

test('an internal token changed during an OS read cannot silently select a newer Cut', async () => {
  let resolve; const pending = new Promise((done) => { resolve = done; });
  const r = adapter({ getString: () => pending });
  r.copy('copy-a', 'Old copy'); await r.api.copySpreadsheetCellsToSystem();
  const choosing = r.api.readSpreadsheetPasteSource();
  r.copy('cut-b', 'New pending Cut', 'cut'); await r.api.copySpreadsheetCellsToSystem();
  resolve('New pending Cut');
  await assert.rejects(choosing, /clipboard.*changed|changed.*clipboard|Copy.*again|Paste.*again/i);
  assert.equal(r.snapshot.token, 'cut-b'); assert.equal(r.snapshot.mode, 'cut');
});

test('a delayed older system write cannot associate its text with a newer internal Cut token', async () => {
  let resolve; const pending = new Promise((done) => { resolve = done; });
  const r = adapter({ setString: (text) => text === 'Old copy' ? pending : undefined });
  r.copy('copy-a', 'Old copy'); const oldWrite = r.api.copySpreadsheetCellsToSystem();
  r.copy('cut-b', 'New pending Cut', 'cut'); await r.api.copySpreadsheetCellsToSystem();
  resolve(); await oldWrite;
  const choice = await r.api.readSpreadsheetPasteSource();
  assert.equal(choice.kind, 'external'); assert.equal(choice.text, 'Old copy');
  assert.equal(r.snapshot.token, 'cut-b'); assert.equal(r.snapshot.mode, 'cut');
});

test('an unavailable oversized plain-text export does not read OS contents or discard the Context snapshot', async () => {
  const r = adapter(); r.copy('large-copy', null); await r.api.copySpreadsheetCellsToSystem();
  assert.equal(r.reads, 0); assert.equal(r.writes.length, 0); assert.equal(r.snapshot.token, 'large-copy');
  assert.equal((await r.api.readSpreadsheetPasteSource()).kind, 'internal', 'the rich snapshot remains usable when plain-text export is bounded');
});

test('a failed new export can paste local cells over an empty or known older Context clipboard while fresh external text still wins', async () => {
  const first = adapter(); first.copy('first-local', 'Not published'); first.writeFailure = true;
  await first.api.copySpreadsheetCellsToSystem(); assert.equal((await first.api.readSpreadsheetPasteSource()).kind, 'internal');
  const r = adapter(); r.copy('copy-a', 'Earlier Context copy'); await r.api.copySpreadsheetCellsToSystem();
  r.copy('cut-b', 'New local Cut', 'cut'); r.writeFailure = true; await r.api.copySpreadsheetCellsToSystem();
  assert.equal((await r.api.readSpreadsheetPasteSource()).kind, 'internal'); assert.equal(r.snapshot.token, 'cut-b');
  r.setOS('New Excel matrix\tAnother day'); const source = await r.api.readSpreadsheetPasteSource();
  assert.equal(source.kind, 'external'); assert.equal(source.text, 'New Excel matrix\tAnother day');
  assert.equal(r.snapshot.mode, 'cut', 'external Paste never consumes a pending local Cut');
});

test('a native false write result remains local-only instead of claiming that new text was published', async () => {
  const r = adapter(); r.copy('copy-a', 'Earlier Context copy'); await r.api.copySpreadsheetCellsToSystem();
  r.copy('copy-b', 'Not published'); r.writeReturnsFalse = true; await r.api.copySpreadsheetCellsToSystem();
  assert.equal((await r.api.readSpreadsheetPasteSource()).kind, 'internal');
  r.setOS('New external copy'); assert.equal((await r.api.readSpreadsheetPasteSource()).kind, 'external');
});

test('republishing even the same local token during an OS read invalidates that read’s source decision', async () => {
  let resolve; const pending = new Promise((done) => { resolve = done; });
  const r = adapter({ getString: () => pending }); r.copy('copy-a', 'Context snapshot');
  await r.api.copySpreadsheetCellsToSystem(); const choosing = r.api.readSpreadsheetPasteSource();
  await r.api.copySpreadsheetCellsToSystem(); resolve('Context snapshot');
  await assert.rejects(choosing, /changed|Paste.*again/);
});
