const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const model = require('../src/utils/canvas.ts');

const file = path.join(__dirname, '../src/data/canvas.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;

function storage(legacyText) {
  const settings = new Map([['notepad.text.v1', legacyText]]);
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Promise, JSON,
    require(name) {
      if (name === '../utils/canvas') return model;
      if (name === './database') return {
        async getSetting(key, fallback) { return settings.get(key) ?? fallback; },
        async setSetting(key, value) { settings.set(key, JSON.parse(JSON.stringify(value))); },
      };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { ...module.exports, settings };
}

test('Canvas migrates the existing Notepad and updates both views after either one edits a linked card', async () => {
  const initial = 'Errands: buy dog food';
  const app = storage(initial);
  const legacy = await app.loadCanvasDocument();
  assert.equal(legacy.text, initial);
  const { document, nodeId } = model.addLinkedCanvasNode(legacy, { start: 13, end: 21 });
  await app.saveCanvasDocument(legacy, document);
  const before = await app.loadCanvasDocument();
  assert.equal(model.activeCanvasBoard(before).nodes[0].text, 'dog food');

  await app.saveCanvasDocument(before, model.updateCanvasNode(before, nodeId, { text: 'cat food' }));
  const updated = await app.loadCanvasDocument();
  assert.equal(updated.text, 'Errands: buy cat food');

  await app.saveCanvasDocument(updated, model.setCanvasText(updated, 'Errands: buy cat litter'));
  const final = await app.loadCanvasDocument();
  assert.equal(model.activeCanvasBoard(final).nodes[0].text, 'cat litter');
  assert.equal(app.settings.get('notepad.text.v1'), initial);
});

test('Canvas rejects a stale full-document write without replacing newer Notepad text', async () => {
  const app = storage('Old');
  const before = await app.loadCanvasDocument();
  const typing = app.saveCanvasDocument(before, model.setCanvasText(before, 'New'));
  const arranging = app.saveCanvasDocument(before, model.addCanvasBoard(before, 'Another board'));
  await typing;
  await assert.rejects(arranging, /Canvas changed/);
  assert.equal((await app.loadCanvasDocument()).text, 'New');
  assert.equal((await app.loadCanvasDocument()).boards.length, 1);
});
