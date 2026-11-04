import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canvasWorkplaneGrid,
  canvasWorkplaneMatrix,
  nextCanvasWorkplaneTurn,
  projectCanvasWorkplane,
  unprojectCanvasWorkplane,
  type CanvasWorkplaneTurn,
} from '../src/utils/canvas-workplane';

const turns: CanvasWorkplaneTurn[] = [0, 1, 2, 3];
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

test('the adaptive workplane grid has bounded density and touches the visible screen edges', () => {
  const viewports = [
    { x: -200, y: -300, zoom: 0.12 },
    { x: 1_000_000_000, y: -1_000_000_000, zoom: 4 },
    { x: 10, y: -500, zoom: 1 },
  ];
  for (const turn of turns) for (const size of [{ width: 390, height: 800 }, { width: 7_680, height: 4_320 }]) {
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
