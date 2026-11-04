import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeCanvasBoard, addCanvasBoard, addCanvasEdge, addCanvasNode, addCanvasSpace, addCanvasStroke,
  addLinkedCanvasNode, CANVAS_STROKE_POINT_LIMIT, canvasSpaceOverlapPoint, canvasSpacesAtPoint, createCanvasDocument,
  groupCanvasNodes, readCanvasDocument, removeCanvasNode, removeCanvasSpace, searchCanvas, selectCanvasBoard,
  setCanvasNodeSpaces, setCanvasText, updateCanvasEdge, updateCanvasNode, updateCanvasSpace, updateCanvasViewport,
  type CanvasDocument, type CanvasSpace,
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

test('ellipse hit testing and overlap placement handle corners, narrow lenses, and tangent spaces', () => {
  const broad: CanvasSpace = { id: 'broad', title: 'Broad', x: 0, y: 0, width: 200, height: 90 };
  const narrow: CanvasSpace = { id: 'narrow', title: 'Narrow', x: 190, y: 26, width: 30, height: 42 };
  assert.deepEqual(canvasSpacesAtPoint([broad, narrow], { x: 0, y: 0 }), []);
  assert.deepEqual(canvasSpacesAtPoint([broad, narrow], { x: 200, y: 45 }), ['broad', 'narrow']);
  const lens = canvasSpaceOverlapPoint([broad, narrow]);
  assert.ok(lens);
  assert.deepEqual(canvasSpacesAtPoint([broad, narrow], lens), ['broad', 'narrow']);
  assert.ok(lens.x >= 190 && lens.x <= 200);
  const tangent: CanvasSpace = { ...narrow, x: 200, y: 24 };
  assert.deepEqual(canvasSpaceOverlapPoint([broad, tangent]), { x: 200, y: 45 });
  assert.equal(canvasSpaceOverlapPoint([broad, { ...tangent, x: 201 }]), undefined);
  assert.equal(canvasSpaceOverlapPoint([broad, narrow, { ...tangent, id: 'third', x: 193, y: 60 }]), undefined);
});

test('cards can belong to several Spaces, and a geometric Space edit moves only members previously inside it', () => {
  const a = addCanvasSpace(createCanvasDocument(), { title: ' Work ', x: 0, y: 0, width: 200, height: 200, color: '#ABCDEF' });
  const b = addCanvasSpace(a.document, { title: 'Evening', x: 150, y: 0, width: 200, height: 200 });
  const note = addCanvasNode(b.document, { kind: 'note', text: 'Read', x: -200, y: -200, width: 40, height: 40 });
  const unassigned = addCanvasNode(note.document, { kind: 'note', text: 'Unassigned', x: 70, y: 70, width: 40, height: 40 });
  const assigned = setCanvasNodeSpaces(unassigned.document, note.nodeId, [a.spaceId, b.spaceId, a.spaceId]);
  const matches = (doc: CanvasDocument) => {
    const card = find(doc, note.nodeId);
    return canvasSpacesAtPoint(activeCanvasBoard(doc).spaces!, { x: card.x + 20, y: card.y + 20 });
  };
  assert.deepEqual(matches(assigned), [a.spaceId, b.spaceId]);
  assert.deepEqual(find(assigned, note.nodeId).spaceIds, [a.spaceId, b.spaceId]);
  assert.equal(setCanvasNodeSpaces(assigned, note.nodeId, [a.spaceId, b.spaceId]), assigned);
  assert.equal(find(unassigned.document, note.nodeId).x, -200);
  assert.deepEqual(searchCanvas(assigned, 'work read').map((item) => item.node.id), [note.nodeId]);

  const resized = updateCanvasSpace(assigned, a.spaceId, { width: 160, title: 'Office', color: null });
  assert.deepEqual(matches(resized), [a.spaceId, b.spaceId]);
  assert.equal(find(resized, unassigned.nodeId), find(assigned, unassigned.nodeId));
  assert.equal(activeCanvasBoard(resized).spaces?.[0]?.color, undefined);
  const disjoint = updateCanvasSpace(resized, a.spaceId, { x: -300 });
  assert.equal(find(disjoint, note.nodeId), find(resized, note.nodeId), 'disjoint membership does not move the card');
  assert.deepEqual(find(disjoint, note.nodeId).spaceIds, [a.spaceId, b.spaceId]);
  assert.deepEqual(find(removeCanvasSpace(disjoint, a.spaceId), note.nodeId).spaceIds, [b.spaceId]);
  const cleared = setCanvasNodeSpaces(disjoint, note.nodeId, []);
  assert.equal(find(cleared, note.nodeId).spaceIds, undefined);
  assert.equal(find(cleared, note.nodeId).text, 'Read');
  assert.throws(() => setCanvasNodeSpaces(disjoint, note.nodeId, ['missing']), /unavailable/);
});

test('drawing strokes and Space membership round-trip independently of legacy groups, and invalid references are rejected', () => {
  const initial = createCanvasDocument();
  const space = addCanvasSpace(initial, { title: 'House' });
  const note = addCanvasNode(space.document, { kind: 'sticky', spaceIds: [space.spaceId] });
  const grouped = groupCanvasNodes(note.document, [note.nodeId], 'Furniture');
  const points = [{ x: 25, y: -14 }, { x: 31, y: -15 }];
  const drawing = addCanvasStroke(grouped.document, { points, color: '#12FA8B', width: 1.5 });
  const withDot = addCanvasStroke(drawing, { points: [{ x: 0, y: 1 }] });
  points[0]!.x = 700;
  assert.equal(activeCanvasBoard(withDot).strokes?.[0]?.points[0]?.x, 25, 'input points are copied');
  assert.equal(activeCanvasBoard(withDot).strokes?.[1]?.width, 2);
  assert.deepEqual(readCanvasDocument(JSON.parse(JSON.stringify(withDot))), withDot);
  const removed = removeCanvasSpace(withDot, space.spaceId);
  assert.equal(find(removed, note.nodeId).spaceIds, undefined);
  assert.equal(find(removed, note.nodeId).groupId, grouped.nodeId);
  assert.equal(activeCanvasBoard(removed).strokes, activeCanvasBoard(withDot).strokes);
  const board = activeCanvasBoard(withDot);
  const invalid = (patch: Partial<typeof board>) => readCanvasDocument({ ...withDot, boards: [{ ...board, ...patch }] });
  assert.throws(() => invalid({ spaces: [] }), /invalid/);
  assert.throws(() => invalid({ spaces: [...board.spaces!, ...board.spaces!] }), /invalid/);
  assert.throws(() => invalid({ strokes: [{ ...board.strokes![0]!, points: [] }] }), /invalid/);
  assert.throws(() => addCanvasStroke(withDot, { points: [{ x: Infinity, y: 0 }] }), /invalid/);
  assert.throws(() => addCanvasStroke(withDot, { points: Array(CANVAS_STROKE_POINT_LIMIT + 1).fill({ x: 0, y: 0 }) }), /invalid/);
  const other = addCanvasBoard(withDot, 'Other');
  assert.throws(() => addCanvasNode(other, { kind: 'note', spaceIds: [space.spaceId] }), /unavailable/);
});
