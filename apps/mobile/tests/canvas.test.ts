import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeCanvasBoard, addCanvasBoard, addCanvasEdge, addCanvasNode, addLinkedCanvasNode, createCanvasDocument,
  groupCanvasNodes, readCanvasDocument, removeCanvasNode, searchCanvas, selectCanvasBoard, setCanvasText,
  updateCanvasEdge, updateCanvasNode, updateCanvasViewport, type CanvasDocument,
} from '../src/utils/canvas';

function find(document: CanvasDocument, id: string) {
  for (const board of document.boards) {
    const node = board.nodes.find((candidate) => candidate.id === id);
    if (node) return node;
  }
  throw new Error('Card is missing: ' + id);
}

test('a linked card retains the exact Unicode selection and card edits update Notepad and other linked boards', () => {
  const text = 'Ideas:  🧠 errands  after lunch.';
  const start = text.indexOf('  🧠');
  const end = text.indexOf('after');
  const first = addLinkedCanvasNode(createCanvasDocument(text), { start, end });
  assert.equal(find(first.document, first.nodeId).text, '  🧠 errands  ');
  const second = addLinkedCanvasNode(addCanvasBoard(first.document, 'Later'), { start, end });
  const edited = updateCanvasNode(second.document, second.nodeId, { text: ' ** groceries ** ' });
  assert.equal(edited.text, 'Ideas: ** groceries ** after lunch.');
  assert.equal(find(edited, first.nodeId).text, ' ** groceries ** ');
  assert.deepEqual(find(edited, first.nodeId).source, { start, end: start + ' ** groceries ** '.length });
  assert.equal(first.document.text, text, 'updates must not mutate an earlier document');
  assert.deepEqual(readCanvasDocument(JSON.parse(JSON.stringify(edited))), edited);
});

test('Notepad edits rebase links, disambiguate identical text with a range hint, and retain a deleted selection', () => {
  const linked = addLinkedCanvasNode(createCanvasDocument('pay pay'), { start: 4, end: 7 });
  const afterInsert = setCanvasText(linked.document, 'pay pay pay', { start: 0, end: 0 });
  assert.deepEqual(find(afterInsert, linked.nodeId).source, { start: 8, end: 11 });
  const afterReplace = setCanvasText(afterInsert, 'pay pay collect', { start: 8, end: 11 });
  assert.equal(find(afterReplace, linked.nodeId).text, 'collect');
  const afterErase = setCanvasText(afterReplace, 'pay pay ', { start: 8, end: 15 });
  assert.equal(find(afterErase, linked.nodeId).source, undefined);
  assert.equal(find(afterErase, linked.nodeId).text, 'collect');

  const afterTyping = setCanvasText(afterInsert, 'pay pay play');
  assert.equal(find(afterTyping, linked.nodeId).text, 'play', 'a normal insertion within the phrase stays linked');
});

test('nested groups drag as a unit, and removing a group preserves its members and internal relationships', () => {
  const first = addCanvasNode(createCanvasDocument(), { kind: 'sticky', text: 'Groceries', x: -80, y: 20 });
  const second = addCanvasNode(first.document, { kind: 'task', text: 'Dog food', x: 50, y: 80 });
  const inner = groupCanvasNodes(second.document, [first.nodeId, second.nodeId], 'Errands');
  const outer = groupCanvasNodes(inner.document, [inner.nodeId, second.nodeId], 'Weekend');
  const withEdge = addCanvasEdge(outer.document, { from: first.nodeId, to: second.nodeId, kind: 'dependency', label: 'before' });
  const oldOuter = find(withEdge, outer.nodeId);
  const moved = updateCanvasNode(withEdge, outer.nodeId, { x: oldOuter.x + 30, y: oldOuter.y - 10, collapsed: true });
  assert.equal(find(moved, first.nodeId).x, -50);
  assert.equal(find(moved, first.nodeId).y, 10);
  assert.equal(find(moved, second.nodeId).groupId, inner.nodeId, 'nesting is retained when a parent and child are selected');
  assert.throws(() => updateCanvasNode(moved, outer.nodeId, { groupId: inner.nodeId }), /descendant/);
  const ungrouped = removeCanvasNode(moved, inner.nodeId);
  assert.equal(find(ungrouped, first.nodeId).groupId, outer.nodeId);
  assert.deepEqual(activeCanvasBoard(ungrouped).edges, activeCanvasBoard(withEdge).edges);
  const edgeId = activeCanvasBoard(ungrouped).edges[0]!.id;
  const relabeled = updateCanvasEdge(ungrouped, edgeId, { label: 'buy together', kind: 'related', directed: false });
  assert.equal(activeCanvasBoard(relabeled).edges[0]?.label, 'buy together');
  assert.deepEqual(activeCanvasBoard(removeCanvasNode(relabeled, first.nodeId)).edges, []);
});

test('search reaches other boards and saved viewports and rejects connections across boards', () => {
  const first = addCanvasNode(createCanvasDocument('Draft'), { kind: 'sticky', text: 'Pay utilities' });
  const other = addCanvasBoard(first.document, 'Holiday');
  const second = addCanvasNode(other, { kind: 'note', text: 'Buy tickets' });
  const document = updateCanvasViewport(second.document, { x: -200, y: 700, zoom: 0.5 });
  assert.deepEqual(searchCanvas(document, 'holiday buy').map((result) => result.node.id), [second.nodeId]);
  assert.deepEqual(searchCanvas(document, 'PAY').map((result) => result.node.id), [first.nodeId]);
  assert.deepEqual(activeCanvasBoard(document).viewport, { x: -200, y: 700, zoom: 0.5 });
  assert.deepEqual(activeCanvasBoard(selectCanvasBoard(document, 'canvas-main')).viewport, { x: 0, y: 0, zoom: 1 });
  assert.throws(() => addCanvasEdge(document, { from: first.nodeId, to: second.nodeId }), /invalid/);
});

test('legacy Notepad migration is deterministic and corrupted saved Canvas data fails closed', () => {
  const original = createCanvasDocument('  keep the old note\n');
  assert.deepEqual(readCanvasDocument(undefined, original.text), original);
  assert.throws(() => readCanvasDocument({ ...original, activeBoardId: 'missing' }, original.text), /not been replaced/);
  const linked = addLinkedCanvasNode(original, { start: 2, end: 6 });
  assert.throws(() => readCanvasDocument({ ...linked.document, text: 'something unrelated' }), /not been replaced/);
});
