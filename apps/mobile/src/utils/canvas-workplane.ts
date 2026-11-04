import type { CanvasPoint, CanvasViewport } from './canvas';

export type CanvasWorkplaneTurn = 0 | 1 | 2 | 3;
type Size = { width: number; height: number };
type Matrix = { a: number; b: number; c: number; d: number };
export type CanvasWorkplaneGridLine = { start: CanvasPoint; end: CanvasPoint; major: boolean; axis?: 'x' | 'y' };

const COS_YAW = Math.sqrt(3) / 2;
const TILT = 0.68;
const ROTATIONS = [[COS_YAW, 0.5], [-0.5, COS_YAW], [-COS_YAW, -0.5], [0.5, -COS_YAW]] as const;
const GRID_STEP = 24;
const GRID_TARGET_PIXELS = 25;
const GRID_LINE_LIMIT = 112;

/** Rotate the workplane, then apply the camera's vertical foreshortening. */
export function canvasWorkplaneMatrix(turn: CanvasWorkplaneTurn): Matrix {
  const [cos, sin] = ROTATIONS[turn];
  return { a: cos, b: TILT * sin, c: -sin, d: TILT * cos };
}

function mapAroundMidpoint(point: CanvasPoint, { width, height }: Size, { a, b, c, d }: Matrix): CanvasPoint {
  const middleX = width / 2, middleY = height / 2;
  const x = point.x - middleX, y = point.y - middleY;
  return { x: middleX + a * x + c * y, y: middleY + b * x + d * y };
}

export function projectCanvasWorkplane(point: CanvasPoint, size: Size, turn: CanvasWorkplaneTurn): CanvasPoint {
  return mapAroundMidpoint(point, size, canvasWorkplaneMatrix(turn));
}

export function unprojectCanvasWorkplane(point: CanvasPoint, size: Size, turn: CanvasWorkplaneTurn): CanvasPoint {
  const { a, b, c, d } = canvasWorkplaneMatrix(turn);
  const determinant = a * d - b * c;
  return mapAroundMidpoint(point, size, { a: d / determinant, b: -b / determinant, c: -c / determinant, d: a / determinant });
}

export function nextCanvasWorkplaneTurn(turn: CanvasWorkplaneTurn, direction: 1 | -1 = 1): CanvasWorkplaneTurn {
  return ((turn + direction + 4) % 4) as CanvasWorkplaneTurn;
}

function visibleSegment(start: CanvasPoint, end: CanvasPoint, size: Size, matrix: Matrix) {
  const a = mapAroundMidpoint(start, size, matrix), b = mapAroundMidpoint(end, size, matrix);
  let enter = 0, exit = 1;
  const spans = [[a.x, b.x, size.width], [a.y, b.y, size.height]] as const;
  for (const [from, to, limit] of spans) {
    const delta = to - from;
    if (!delta) {
      if (from < 0 || from > limit) return undefined;
      continue;
    }
    const first = -from / delta, last = (limit - from) / delta;
    enter = Math.max(enter, Math.min(first, last));
    exit = Math.min(exit, Math.max(first, last));
    if (enter >= exit) return undefined;
  }
  const pointAt = (fraction: number) => ({
    x: start.x + (end.x - start.x) * fraction,
    y: start.y + (end.y - start.y) * fraction,
  });
  return { start: pointAt(enter), end: pointAt(exit) };
}

/** Generate world-aligned guides in ordinary screen coordinates for a projected scene. */
export function canvasWorkplaneGrid(viewport: CanvasViewport, size: Size, turn: CanvasWorkplaneTurn): CanvasWorkplaneGridLine[] {
  const { width, height } = size;
  const { x, y, zoom } = viewport;
  if (![width, height, x, y, zoom].every(Number.isFinite) || width <= 0 || height <= 0 || zoom <= 0) return [];
  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height }]
    .map((point) => unprojectCanvasWorkplane(point, size, turn));
  const left = Math.min(...corners.map((corner) => corner.x)), right = Math.max(...corners.map((corner) => corner.x));
  const top = Math.min(...corners.map((corner) => corner.y)), bottom = Math.max(...corners.map((corner) => corner.y));
  const target = Math.max(GRID_TARGET_PIXELS, (right - left + bottom - top) / (GRID_LINE_LIMIT - 4));
  const step = GRID_STEP * 2 ** Math.ceil(Math.log2(target / zoom / GRID_STEP));
  const pixels = step * zoom;
  if (!Number.isFinite(pixels) || pixels <= 0) return [];

  const matrix = canvasWorkplaneMatrix(turn);
  const lines: CanvasWorkplaneGridLine[] = [];
  const addLines = (vertical: boolean) => {
    const origin = vertical ? x : y;
    const first = Math.ceil(origin / step + (vertical ? left : top) / pixels);
    const last = Math.floor(origin / step + (vertical ? right : bottom) / pixels);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return;
    for (let index = first; index <= last; index++) {
      const position = (index - origin / step) * pixels;
      const start = vertical ? { x: position, y: top } : { x: left, y: position };
      const end = vertical ? { x: position, y: bottom } : { x: right, y: position };
      const segment = visibleSegment(start, end, size, matrix);
      if (segment) lines.push({ ...segment, major: index % 5 === 0,
        ...(index === 0 ? { axis: vertical ? 'y' : 'x' } : {}) });
    }
  };
  addLines(true);
  addLines(false);
  return lines;
}
