import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasDragNodes, canvasWorkplaneFrame, fitCanvas, fitCanvasWorkplane, previewCanvasRoutes, screenPoint,
  visibleCanvasBoard, worldPoint, zoomViewport } from '../src/screens/canvas-viewport';
import type { CanvasBoard, CanvasEdge, CanvasNode } from '../src/utils/canvas';
import { canvasWorkplanePreset, projectCanvasWorkplane, projectCanvasWorkplaneVector, unprojectCanvasWorkplane } from '../src/utils/canvas-workplane';

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

test('the three native Workplane layers agree with hit testing and Fit for presets and freely orbited cameras', () => {
  const boards = [{ width: 340, height: 720 }, { width: 720, height: 340 }];
  const cards = [node('west', -300, -230), node('east', 290, 120), node('north', 190, -270)];
  const cameras = [0, 1, 2, 3, canvasWorkplanePreset('sagittal'), canvasWorkplanePreset('coronal'),
    canvasWorkplanePreset('transverse'), canvasWorkplanePreset('oblique'),
    { yaw: 61, pitch: 84, roll: 127 }, { yaw: -174, pitch: -84, roll: -63 }, { yaw: 33, pitch: 0, roll: 105 }] as const;
  const rotate = ({ x, y }: { x: number; y: number }, radians: number) => {
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    return { x: cosine * x - sine * y, y: sine * x + cosine * y };
  };
  for (const size of boards) for (const camera of cameras) {
    const frame = canvasWorkplaneFrame(size, camera);
    const center = { x: size.width / 2, y: size.height / 2 };
    assert.ok(Math.abs(frame.offset.x + frame.size.width / 2 - center.x) < 1e-9);
    assert.ok(Math.abs(frame.offset.y + frame.size.height / 2 - center.y) < 1e-9);
    const samples = [];
    for (const x of [0, size.width]) for (const y of [0, size.height]) {
      const logical = unprojectCanvasWorkplane({ x, y }, size, camera);
      const centered = { x: logical.x - center.x, y: logical.y - center.y };
      const rotated = rotate(centered, frame.innerRotation);
      const scaled = { x: rotated.x * frame.scaleX, y: rotated.y * frame.scaleY };
      const physical = rotate(scaled, frame.outerRotation);
      assert.ok(Math.abs(center.x + physical.x - x) < 1e-9);
      assert.ok(Math.abs(center.y + physical.y - y) < 1e-9);
      samples.push(centered, rotated, scaled, physical);
    }
    // Each nested View covers the actual preimage of the stage corners,
    // with only the normal 32-point overscan along each side.
    assert.ok(Math.abs(frame.size.width - (2 * Math.max(...samples.map(({ x }) => Math.abs(x))) + 64)) < 1e-8);
    assert.ok(Math.abs(frame.size.height - (2 * Math.max(...samples.map(({ y }) => Math.abs(y))) + 64)) < 1e-8);
    const viewport = fitCanvasWorkplane(cards, size, camera);
    for (const card of cards) for (const x of [card.x, card.x + card.width]) for (const y of [card.y, card.y + card.height]) {
      const point = projectCanvasWorkplane(screenPoint({ x, y }, viewport), size, camera);
      assert.ok(point.x >= 27 && point.x <= size.width - 27);
      assert.ok(point.y >= 43 && point.y <= size.height - 43);
    }
  }
});

test('Fit leaves room for raised objects in side views and after screen rotation', () => {
  const size = { width: 310, height: 480 };
  const bounds = [{ x: -220, y: -190, width: 100, height: 110, elevation: 75 },
    { x: 300, y: 200, width: 140, height: 150, elevation: 80 }];
  for (const camera of [canvasWorkplanePreset('sagittal'), { yaw: 30, pitch: -84, roll: 51 }]) {
    const viewport = fitCanvasWorkplane(bounds, size, camera);
    for (const box of bounds) for (const x of [box.x, box.x + box.width]) for (const y of [box.y, box.y + box.height]) {
      const origin = projectCanvasWorkplane(screenPoint({ x, y }, viewport), size, camera);
      const lift = projectCanvasWorkplaneVector({ x: 0, y: 0, z: box.elevation * viewport.zoom }, camera);
      assert.ok(origin.x + lift.x >= 27 && origin.x + lift.x <= size.width - 27);
      assert.ok(origin.y + lift.y >= 43 && origin.y + lift.y <= size.height - 43);
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
