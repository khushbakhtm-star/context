import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canvasWorkplaneGrid,
  canvasWorkplaneMatrix,
  canvasWorkplanePreset,
  canvasWorkplaneSolidDepth,
  CANVAS_WORKPLANE_MAX_PITCH,
  nextCanvasWorkplaneTurn,
  projectCanvasWorkplane,
  projectCanvasWorkplaneSolid,
  projectCanvasWorkplaneVector,
  rotateCanvasWorkplane,
  unprojectCanvasWorkplane,
  type CanvasWorkplanePreset,
  type CanvasWorkplaneTurn,
} from '../src/utils/canvas-workplane';

const turns: CanvasWorkplaneTurn[] = [0, 1, 2, 3];
const presets: CanvasWorkplanePreset[] = ['sagittal', 'coronal', 'transverse', 'oblique'];
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} differs from ${b}`);

test('workplane projection keeps the stage midpoint fixed and reverses hit testing at every turn', () => {
  const size = { width: 391, height: 827 };
  const middle = { x: size.width / 2, y: size.height / 2 };
  for (const turn of turns) {
    assert.deepEqual(projectCanvasWorkplane(middle, size, turn), middle);
    for (const point of [{ x: 0, y: 0 }, { x: 329, y: 600 }, { x: -900, y: 1200 }, middle]) {
      const unprojected = unprojectCanvasWorkplane(projectCanvasWorkplane(point, size, turn), size, turn);
      near(unprojected.x, point.x);
      near(unprojected.y, point.y);
    }
    const { a, b, c, d } = canvasWorkplaneMatrix(turn);
    assert.ok(Math.abs(b) > 0.2 && Math.abs(c) > 0.2, 'both axes look tilted');
    near(a * d - b * c, 0.68);
  }
});

test('quarter-turn presets rotate the view without changing its scale or center', () => {
  const size = { width: 600, height: 500 }, midpoint = { x: 300, y: 250 };
  const right = { x: 360, y: 250 }, down = { x: 300, y: 310 };
  for (const turn of turns) {
    const forward = nextCanvasWorkplaneTurn(turn);
    assert.equal(nextCanvasWorkplaneTurn(forward, -1), turn);
    const axisAfter = projectCanvasWorkplane(right, size, forward);
    const axisBefore = projectCanvasWorkplane(down, size, turn);
    near(axisAfter.x, axisBefore.x);
    near(axisAfter.y, axisBefore.y);
    const opposite = projectCanvasWorkplane(right, size, nextCanvasWorkplaneTurn(forward));
    const current = projectCanvasWorkplane(right, size, turn);
    near(opposite.x + current.x, 2 * midpoint.x);
    near(opposite.y + current.y, 2 * midpoint.y);
  }
});

test('named Workplane presets show overhead or the correct axis from the side', () => {
  assert.deepEqual(canvasWorkplaneMatrix(canvasWorkplanePreset('transverse')), { a: 1, b: 0, c: 0, d: 1 });
  const sagittal = canvasWorkplaneMatrix(canvasWorkplanePreset('sagittal'));
  const coronal = canvasWorkplaneMatrix(canvasWorkplanePreset('coronal'));
  // Coronal looks along y, leaving x full width. Sagittal looks along x.
  near(coronal.a, 1); near(coronal.c, 0); near(coronal.b, 0);
  near(sagittal.a, 0); near(sagittal.c, -1); near(sagittal.d, 0);
  const reduced = Math.cos(CANVAS_WORKPLANE_MAX_PITCH * Math.PI / 180);
  near(coronal.d, reduced);
  near(sagittal.b, reduced);
  assert.ok(reduced < 0.11 && reduced > 0.1, 'side views retain a narrow editable plane');
  assert.deepEqual(canvasWorkplaneMatrix(canvasWorkplanePreset('oblique')), canvasWorkplaneMatrix(0));
});

test('a freely rotated camera reverses projection and clockwise roll can be undone', () => {
  const size = { width: 731, height: 622 };
  const middle = { x: size.width / 2, y: size.height / 2 };
  const starting = canvasWorkplanePreset('oblique');
  const camera = rotateCanvasWorkplane(starting, { yaw: -123, pitch: -109, roll: 455 });
  assert.equal(camera.yaw, 267);
  assert.equal(camera.roll, 95);
  assert.ok(camera.pitch < 0);
  assert.deepEqual(projectCanvasWorkplane(middle, size, camera), middle);
  for (const point of [{ x: 3.5, y: 19.75 }, { x: 430, y: 620 }, { x: -2000, y: 2700 }]) {
    const rendered = projectCanvasWorkplane(point, size, camera);
    const unprojected = unprojectCanvasWorkplane(rendered, size, camera);
    near(unprojected.x, point.x);
    near(unprojected.y, point.y);
    const clockwise = rotateCanvasWorkplane(camera, { roll: 90 });
    const rotated = projectCanvasWorkplane(point, size, clockwise);
    near(rotated.x - middle.x, -(rendered.y - middle.y));
    near(rotated.y - middle.y, rendered.x - middle.x);
    assert.deepEqual(rotateCanvasWorkplane(clockwise, { roll: -90 }), camera);
  }
  assert.equal(rotateCanvasWorkplane(camera, { pitch: 500 }).pitch, CANVAS_WORKPLANE_MAX_PITCH);
  assert.equal(rotateCanvasWorkplane(camera, { pitch: -500 }).pitch, -CANVAS_WORKPLANE_MAX_PITCH);
  assert.deepEqual(rotateCanvasWorkplane(camera, { yaw: NaN, pitch: Infinity, roll: -Infinity }), camera);
});

test('3D vectors share the board projection and retain orthographic depth as the camera turns', () => {
  const size = { width: 500, height: 640 };
  const orientations = [...presets.map(canvasWorkplanePreset), { yaw: 238, pitch: -71, roll: 27 }];
  for (const camera of orientations) {
    const x = 72, y = -63, z = 47;
    const board = projectCanvasWorkplane({ x: size.width / 2 + x, y: size.height / 2 + y }, size, camera);
    const vector = projectCanvasWorkplaneVector({ x, y, z: 0 }, camera);
    near(board.x - size.width / 2, vector.x);
    near(board.y - size.height / 2, vector.y);
    const raised = projectCanvasWorkplaneVector({ x, y, z }, camera);
    near(Math.hypot(raised.x, raised.y, raised.depth), Math.hypot(x, y, z));
    const elevation = projectCanvasWorkplaneVector({ x: 0, y: 0, z }, camera);
    near(raised.x - vector.x, elevation.x);
    near(raised.y - vector.y, elevation.y);
    near(raised.depth - vector.depth, elevation.depth);
  }
  const side = projectCanvasWorkplaneVector({ x: 0, y: 0, z: 50 }, canvasWorkplanePreset('coronal'));
  assert.ok(side.y < -49 && side.depth > 0);
  assert.deepEqual(projectCanvasWorkplaneVector({ x: 0, y: 0, z: 50 }, canvasWorkplanePreset('transverse')), { x: 0, y: 0, depth: 50 });
});

test('cube and diamond meshes expose only their visible faces in depth order', () => {
  const dims = { width: 40, height: 40 };
  const overhead = canvasWorkplanePreset('transverse');
  const top = projectCanvasWorkplaneSolid('cube', dims, overhead);
  assert.deepEqual(top.map(({ depth, top }) => ({ depth, top })), [{ depth: 40, top: true }]);
  assert.deepEqual(top[0]?.points, [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }]);
  const oblique = canvasWorkplanePreset('oblique');
  const cube = projectCanvasWorkplaneSolid('cube', dims, oblique);
  assert.equal(cube.length, 3);
  assert.equal(cube.filter((face) => face.top).length, 1);
  assert.equal(projectCanvasWorkplaneSolid('octahedron', dims, overhead).length, 4);
  for (const camera of presets.map(canvasWorkplanePreset)) {
    for (const [shape, vertexCount] of [['cube', 4], ['block', 4], ['octahedron', 3]] as const) {
      const faces = projectCanvasWorkplaneSolid(shape, dims, camera);
      assert.ok(faces.length > 0);
      for (const [index, face] of faces.entries()) {
        assert.equal(face.points.length, vertexCount);
        assert.ok(face.shade >= 0.45 && face.shade <= 1);
        if (index > 0) assert.ok(face.depth >= faces[index - 1]!.depth);
        const [a, b, c] = face.points;
        assert.ok((b!.x - a!.x) * (c!.y - a!.y) - (b!.y - a!.y) * (c!.x - a!.x) > 0);
      }
    }
  }
  assert.deepEqual(projectCanvasWorkplaneSolid('cube', { width: 0, height: 20 }, overhead), []);
});

test('a raised block top follows its footprint plus the projected elevation for consistent labels', () => {
  const camera = { yaw: 74, pitch: 77, roll: 28 };
  const dims = { width: 120, height: 80 };
  const elevation = canvasWorkplaneSolidDepth('block', dims);
  near(elevation, 9.6);
  const face = projectCanvasWorkplaneSolid('block', dims, camera).find((candidate) => candidate.top)!;
  const raised = projectCanvasWorkplaneVector({ x: 0, y: 0, z: elevation }, camera);
  for (const [index, corner] of [{ x: -60, y: -40 }, { x: 60, y: -40 }, { x: 60, y: 40 }, { x: -60, y: 40 }].entries()) {
    const base = projectCanvasWorkplaneVector({ ...corner, z: 0 }, camera);
    near(face.points[index]!.x, base.x + raised.x);
    near(face.points[index]!.y, base.y + raised.y);
  }
});

test('the adaptive workplane grid has bounded density and touches the visible screen edges', () => {
  const viewports = [
    { x: -200, y: -300, zoom: 0.12 },
    { x: 1_000_000_000, y: -1_000_000_000, zoom: 4 },
    { x: 10, y: -500, zoom: 1 },
  ];
  const orientations = [...turns, ...presets.map(canvasWorkplanePreset), { yaw: 216, pitch: -83, roll: 38 }];
  for (const turn of orientations) for (const size of [{ width: 390, height: 800 }, { width: 7_680, height: 4_320 }]) {
    for (const viewport of viewports) {
      const grid = canvasWorkplaneGrid(viewport, size, turn);
      assert.ok(grid.length > 8 && grid.length <= 112, 'grid remains visible and bounded');
      assert.ok(grid.some(({ major }) => major));
      assert.ok(grid.some(({ major }) => !major));
      for (const line of grid) {
        assert.ok(line.start.x === line.end.x || line.start.y === line.end.y, 'unprojected grid is world-aligned');
        for (const point of [line.start, line.end]) {
          const projected = projectCanvasWorkplane(point, size, turn);
          const epsilon = 1e-7;
          assert.ok(projected.x >= -epsilon && projected.x <= size.width + epsilon);
          assert.ok(projected.y >= -epsilon && projected.y <= size.height + epsilon);
          assert.ok(Math.min(Math.abs(projected.x), Math.abs(projected.y),
            Math.abs(size.width - projected.x), Math.abs(size.height - projected.y)) < epsilon);
        }
      }
    }
  }
  assert.deepEqual(canvasWorkplaneGrid({ x: 0, y: 0, zoom: 0 }, { width: 300, height: 300 }, 0), []);
  assert.deepEqual(canvasWorkplaneGrid({ x: 0, y: 0, zoom: 1 }, { width: 0, height: 300 }, 0), []);
});

test('grid axes stay on the same world origin after panning and identify their own direction', () => {
  const size = { width: 800, height: 800 };
  for (const viewport of [{ x: -250, y: -250, zoom: 1.2 }, { x: -227, y: -280, zoom: 1.2 }]) {
    const grid = canvasWorkplaneGrid(viewport, size, 0);
    const horizontal = grid.find(({ axis }) => axis === 'x');
    const vertical = grid.find(({ axis }) => axis === 'y');
    assert.ok(horizontal?.major && vertical?.major);
    near(horizontal.start.y / viewport.zoom + viewport.y, 0);
    near(horizontal.end.y / viewport.zoom + viewport.y, 0);
    near(vertical.start.x / viewport.zoom + viewport.x, 0);
    near(vertical.end.x / viewport.zoom + viewport.x, 0);
  }
});
