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

test('an existing Canvas can persist a sketch and one linked card in three overlapping Spaces', async () => {
  const app = storage('Buy milk');
  const initial = await app.loadCanvasDocument();
  const { document, nodeId } = model.addLinkedCanvasNode(initial, { start: 0, end: 8 });
  const companion = model.addCanvasNode(document, { kind: 'note', text: 'Check the fridge' });
  const grouped = model.groupCanvasNodes(companion.document, [nodeId, companion.nodeId], 'Groceries');
  // The stored document has the old Canvas schema, with no Spaces or strokes.
  await app.saveCanvasDocument(initial, grouped.document);
  const old = await app.loadCanvasDocument();
  assert.equal(model.activeCanvasBoard(old).spaces, undefined);
  assert.equal(model.activeCanvasBoard(old).strokes, undefined);

  const shopping = model.addCanvasSpace(old, { title: 'Shopping', x: 0, y: 0, width: 360, height: 260 });
  const finances = model.addCanvasSpace(shopping.document, { title: 'Finances', x: 130, y: 0, width: 360, height: 260 });
  const nutrition = model.addCanvasSpace(finances.document, { title: 'Nutrition', x: 65, y: 100, width: 360, height: 260 });
  const spaces = [shopping.spaceId, finances.spaceId, nutrition.spaceId];
  const shared = model.setCanvasNodeSpaces(nutrition.document, nodeId, spaces);
  const sketch = model.addCanvasStroke(shared, { points: [{ x: 10, y: 10 }, { x: 36, y: 48 }] });
  await app.saveCanvasDocument(old, sketch);

  const reopened = await app.loadCanvasDocument();
  const board = model.activeCanvasBoard(reopened);
  assert.equal(board.nodes.filter((item) => item.text === 'Buy milk').length, 1);
  const card = board.nodes.find((item) => item.id === nodeId);
  assert.equal(card.groupId, grouped.nodeId);
  assert.deepEqual(card.spaceIds, spaces);
  assert.deepEqual(model.canvasSpacesAtPoint(board.spaces, { x: card.x + card.width / 2, y: card.y + card.height / 2 }), spaces);
  assert.deepEqual(board.strokes[0].points, [{ x: 10, y: 10 }, { x: 36, y: 48 }]);
  await app.saveCanvasDocument(reopened, model.updateCanvasNode(reopened, nodeId, { text: 'Buy oat milk' }));
  assert.equal((await app.loadCanvasDocument()).text, 'Buy oat milk');
});
