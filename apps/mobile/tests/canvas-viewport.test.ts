import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasDragNodes, canvasWorkplaneFrame, fitCanvas, fitCanvasWorkplane, previewCanvasRoutes, screenPoint,
  visibleCanvasBoard, worldPoint, zoomViewport } from '../src/screens/canvas-viewport';
import type { CanvasBoard, CanvasEdge, CanvasNode } from '../src/utils/canvas';
import { projectCanvasWorkplane, unprojectCanvasWorkplane } from '../src/utils/canvas-workplane';

const node = (id: string, x: number, y: number, options: Partial<CanvasNode> = {}): CanvasNode =>
  ({ id, x, y, width: 150, height: 100, kind: 'note', text: id, ...options });
const edge = (id: string, from: string, to: string): CanvasEdge =>
  ({ id, from, to, kind: 'related', directed: false });

test('pinch zoom keeps the world point under the fingers and Fit includes negative board coordinates', () => {
  const start = { x: -240, y: 90, zoom: 0.75 };
  const touch = { x: 120, y: 260 };
  const movedTouch = { x: 140, y: 300 };
  const zoomed = zoomViewport(start, 1.5, touch, movedTouch);
  const projected = screenPoint(worldPoint(touch, start), zoomed);
  assert.ok(Math.abs(projected.x - movedTouch.x) < 1e-9);
  assert.ok(Math.abs(projected.y - movedTouch.y) < 1e-9);
  const viewport = fitCanvas([node('a', -300, -400), node('b', 470, 200)], { width: 360, height: 640 });
  assert.ok(screenPoint({ x: -300, y: -400 }, viewport).x >= 0);
  assert.ok(screenPoint({ x: 620, y: 300 }, viewport).x <= 360);
});

test('native workplane transforms keep corner touches interactive and fit projected content at every turn', () => {
  const boards = [{ width: 340, height: 720 }, { width: 720, height: 340 }];
  const cards = [node('west', -300, -230), node('east', 290, 120), node('north', 190, -270)];
  for (const size of boards) for (const turn of [0, 1, 2, 3] as const) {
    const frame = canvasWorkplaneFrame(size, turn);
    const center = { x: size.width / 2, y: size.height / 2 };
    for (const x of [0, size.width]) for (const y of [0, size.height]) {
      const logical = unprojectCanvasWorkplane({ x, y }, size, turn);
      const local = { x: logical.x - frame.offset.x, y: logical.y - frame.offset.y };
      assert.ok(local.x >= 0 && local.x <= frame.size.width && local.y >= 0 && local.y <= frame.size.height);
      const dx = logical.x - center.x, dy = logical.y - center.y;
      const cosine = Math.cos(frame.rotation), sine = Math.sin(frame.rotation);
      const rotated = { x: center.x + cosine * dx - sine * dy, y: center.y + sine * dx + cosine * dy };
      assert.ok(rotated.x >= frame.offset.x && rotated.x <= frame.offset.x + frame.size.width);
      assert.ok(rotated.y >= frame.offset.y && rotated.y <= frame.offset.y + frame.size.height);
      assert.ok(Math.abs(rotated.x - x) < 1e-9);
      assert.ok(Math.abs(center.y + (rotated.y - center.y) * frame.scaleY - y) < 1e-9);
    }
    const viewport = fitCanvasWorkplane(cards, size, turn);
    for (const card of cards) for (const x of [card.x, card.x + card.width]) for (const y of [card.y, card.y + card.height]) {
      const point = projectCanvasWorkplane(screenPoint({ x, y }, viewport), size, turn);
      assert.ok(point.x >= 27 && point.x <= size.width - 27);
      assert.ok(point.y >= 43 && point.y <= size.height - 43);
    }
  }
});

test('a collapsed nested group keeps its external connections and hides internal edges only in the display', () => {
  const nodes = [
    node('a', 50, 80, { groupId: 'inner' }), node('b', 20, 40, { groupId: 'outer' }), node('external', -400, 0),
    node('inner', 40, 60, { kind: 'group', collapsed: true, groupId: 'outer' }),
    node('outer', 0, 0, { kind: 'group', collapsed: true, width: 650, height: 480 }),
  ];
  const edges = [edge('inside', 'a', 'b'), edge('outside', 'a', 'external')];
  const board: CanvasBoard = { id: 'board', title: 'Board', nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } };
  const projected = visibleCanvasBoard(board);
  assert.deepEqual(projected.nodes.map(({ id }) => id), ['external', 'outer']);
  assert.deepEqual(projected.edges, [edge('outside', 'outer', 'external')]);
  assert.equal(projected.nodes[1]?.height, 86);
  assert.equal(board.edges[1]?.from, 'a');
  assert.equal(board.nodes[4]?.height, 480);
});

test('a group drag preview translates internal lines, preserves unrelated cached routes, and keeps external lines orthogonal', () => {
  const nodes = [node('a', 0, 0, { groupId: 'group' }), node('b', 200, 0, { groupId: 'group' }),
    node('c', 400, 100), node('d', 500, 100), node('group', 0, -40, { kind: 'group' })];
  const moved = canvasDragNodes(nodes, 'group');
  assert.deepEqual([...moved], ['group', 'a', 'b']);
  const before = [
    { edge: edge('inside', 'a', 'b'), points: [{ x: 150, y: 50 }, { x: 200, y: 50 }] },
    { edge: edge('outside', 'a', 'c'), points: [{ x: 150, y: 50 }, { x: 375, y: 50 }, { x: 375, y: 150 }, { x: 400, y: 150 }] },
    { edge: edge('unrelated', 'c', 'd'), points: [{ x: 470, y: 150 }, { x: 500, y: 150 }] },
  ];
  const after = previewCanvasRoutes(before, moved, { x: 26, y: -30 });
  assert.deepEqual(after[0]?.points, [{ x: 176, y: 20 }, { x: 226, y: 20 }]);
  assert.deepEqual(after[1]?.points[0], { x: 176, y: 20 });
  assert.deepEqual(after[1]?.points.at(-1), { x: 400, y: 150 });
  assert.ok(after[1]?.points.slice(1).every((point, i) => point.x === after[1]?.points[i]?.x || point.y === after[1]?.points[i]?.y));
  assert.equal(after[2], before[2]);
});
