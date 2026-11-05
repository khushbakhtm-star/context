import type { CanvasPoint, CanvasViewport } from './canvas';

export type CanvasWorkplaneTurn = 0 | 1 | 2 | 3;
/** Angles in degrees. Pitch measures tilt from directly overhead. */
export type CanvasWorkplaneCamera = { yaw: number; pitch: number; roll: number };
export type CanvasWorkplanePreset = 'sagittal' | 'coronal' | 'transverse' | 'oblique';
export type CanvasWorkplaneOrientation = CanvasWorkplaneCamera | CanvasWorkplaneTurn;
export type CanvasWorkplaneVector = CanvasPoint & { z: number };
export type CanvasWorkplaneProjection = CanvasPoint & { depth: number };
export type CanvasWorkplaneSolid = 'cube' | 'octahedron' | 'block';
export type CanvasWorkplaneSolidFace = { points: CanvasPoint[]; depth: number; shade: number; top: boolean };
type Size = { width: number; height: number };
type Matrix = { a: number; b: number; c: number; d: number };
export type CanvasWorkplaneGridLine = { start: CanvasPoint; end: CanvasPoint; major: boolean; axis?: 'x' | 'y' };

const RADIANS = Math.PI / 180;
const OBLIQUE_PITCH = Math.acos(0.68) / RADIANS;
// A flat board viewed exactly edge-on loses one editable dimension.
export const CANVAS_WORKPLANE_MAX_PITCH = 84;
const PRESETS: Record<CanvasWorkplanePreset, CanvasWorkplaneCamera> = {
  transverse: { yaw: 0, pitch: 0, roll: 0 },
  coronal: { yaw: 0, pitch: CANVAS_WORKPLANE_MAX_PITCH, roll: 0 },
  sagittal: { yaw: 90, pitch: CANVAS_WORKPLANE_MAX_PITCH, roll: 0 },
  oblique: { yaw: 30, pitch: OBLIQUE_PITCH, roll: 0 },
};
const GRID_STEP = 24;
const GRID_TARGET_PIXELS = 25;
const GRID_LINE_LIMIT = 112;

function angle(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function wrap(value: number) {
  return ((value % 360) + 360) % 360;
}

function pitchLimit(value: number) {
  return Math.max(-CANVAS_WORKPLANE_MAX_PITCH, Math.min(CANVAS_WORKPLANE_MAX_PITCH, value));
}

export function canvasWorkplanePreset(preset: CanvasWorkplanePreset): CanvasWorkplaneCamera {
  return { ...PRESETS[preset] };
}

/** The camera can yaw and roll through a full turn. A small amount of visible
 * plane remains in side views so pointer positions still map back to the board. */
export function rotateCanvasWorkplane(camera: CanvasWorkplaneCamera,
  delta: Partial<CanvasWorkplaneCamera>): CanvasWorkplaneCamera {
  return {
    yaw: wrap(wrap(angle(camera.yaw)) + wrap(angle(delta.yaw))),
    pitch: pitchLimit(pitchLimit(angle(camera.pitch)) + angle(delta.pitch)),
    roll: wrap(wrap(angle(camera.roll)) + wrap(angle(delta.roll))),
  };
}

function cameraBasis(orientation: CanvasWorkplaneOrientation) {
  const camera = typeof orientation === 'number'
    ? { yaw: 30 + orientation * 90, pitch: OBLIQUE_PITCH, roll: 0 }
    : orientation;
  const yaw = wrap(angle(camera.yaw)) * RADIANS;
  const roll = wrap(angle(camera.roll)) * RADIANS;
  const pitch = pitchLimit(angle(camera.pitch)) * RADIANS;
  return { cosYaw: Math.cos(yaw), sinYaw: Math.sin(yaw), cosRoll: Math.cos(roll), sinRoll: Math.sin(roll),
    cosPitch: Math.cos(pitch), sinPitch: Math.sin(pitch) };
}

function rotateVector({ x, y, z }: CanvasWorkplaneVector,
  { cosYaw, sinYaw, cosRoll, sinRoll, cosPitch, sinPitch }: ReturnType<typeof cameraBasis>): CanvasWorkplaneProjection {
  const horizontal = cosYaw * x - sinYaw * y;
  const vertical = sinYaw * x + cosYaw * y;
  const pitched = cosPitch * vertical - sinPitch * z;
  return {
    x: cosRoll * horizontal - sinRoll * pitched,
    y: sinRoll * horizontal + cosRoll * pitched,
    depth: sinPitch * vertical + cosPitch * z,
  };
}

/** Project a 3D offset from the board origin. Positive z rises off the board
 * and larger depth is closer to the viewer. */
export function projectCanvasWorkplaneVector(vector: CanvasWorkplaneVector,
  orientation: CanvasWorkplaneOrientation): CanvasWorkplaneProjection {
  return rotateVector(vector, cameraBasis(orientation));
}

/** Orthographic projection of the flat board. Apply yaw first, tilt it around
 * the horizontal axis, then roll the resulting screen image. */
export function canvasWorkplaneMatrix(orientation: CanvasWorkplaneOrientation): Matrix {
  const basis = cameraBasis(orientation);
  const horizontal = rotateVector({ x: 1, y: 0, z: 0 }, basis);
  const vertical = rotateVector({ x: 0, y: 1, z: 0 }, basis);
  return { a: horizontal.x, b: horizontal.y, c: vertical.x, d: vertical.y };
}

const BOX_FACES = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
const OCTAHEDRON_FACES = [
  [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [1, 0, 5], [2, 1, 5], [3, 2, 5], [0, 3, 5],
];

/** Width and height measure the footprint in x/y. Depth is elevation above it. */
export function canvasWorkplaneSolidDepth(shape: CanvasWorkplaneSolid, { width, height }: Size): number {
  const side = Math.min(width, height);
  return shape === 'block' ? Math.min(10, side * 0.12) : side;
}

/** Visible mesh faces in painter's order, relative to the solid's base center. */
export function projectCanvasWorkplaneSolid(shape: CanvasWorkplaneSolid,
  { width, height, depth }: Size & { depth?: number }, orientation: CanvasWorkplaneOrientation): CanvasWorkplaneSolidFace[] {
  const raised = depth ?? canvasWorkplaneSolidDepth(shape, { width, height });
  if (![width, height, raised].every((value) => Number.isFinite(value) && value > 0)) return [];
  const x = width / 2, y = height / 2;
  const vertices: CanvasWorkplaneVector[] = shape === 'octahedron'
    ? [{ x: 0, y: -y, z: raised / 2 }, { x, y: 0, z: raised / 2 }, { x: 0, y, z: raised / 2 },
      { x: -x, y: 0, z: raised / 2 }, { x: 0, y: 0, z: raised }, { x: 0, y: 0, z: 0 }]
    : [0, raised].flatMap((z) => [{ x: -x, y: -y, z }, { x, y: -y, z }, { x, y, z }, { x: -x, y, z }]);
  const basis = cameraBasis(orientation);
  const projected = vertices.map((point) => rotateVector(point, basis));
  const faces = shape === 'octahedron' ? OCTAHEDRON_FACES : BOX_FACES;
  return faces.flatMap((indices, face): CanvasWorkplaneSolidFace[] => {
    const points = indices.map((index) => projected[index]!);
    const a = points[0]!, b = points[1]!, c = points[2]!;
    const bx = b.x - a.x, by = b.y - a.y, bz = b.depth - a.depth;
    const cx = c.x - a.x, cy = c.y - a.y, cz = c.depth - a.depth;
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
    const normal = Math.hypot(nx, ny, nz);
    if (nz <= normal * 1e-9) return [];
    const illumination = Math.max(0, Math.min(1, (-0.36 * nx - 0.48 * ny + 0.8 * nz) / normal));
    const depth = points.reduce((sum, point) => sum + point.depth, 0) / points.length;
    return [{ points: points.map(({ x, y }) => ({ x, y })), depth,
      shade: 0.45 + 0.55 * illumination, top: shape === 'octahedron' ? face < 4 : face === 1 }];
  }).sort((a, b) => a.depth - b.depth);
}

function mapAroundMidpoint(point: CanvasPoint, { width, height }: Size, { a, b, c, d }: Matrix): CanvasPoint {
  const middleX = width / 2, middleY = height / 2;
  const x = point.x - middleX, y = point.y - middleY;
  return { x: middleX + a * x + c * y, y: middleY + b * x + d * y };
}

export function projectCanvasWorkplane(point: CanvasPoint, size: Size, orientation: CanvasWorkplaneOrientation): CanvasPoint {
  return mapAroundMidpoint(point, size, canvasWorkplaneMatrix(orientation));
}

function invertMatrix({ a, b, c, d }: Matrix): Matrix {
  const determinant = a * d - b * c;
  return { a: d / determinant, b: -b / determinant, c: -c / determinant, d: a / determinant };
}

export function unprojectCanvasWorkplane(point: CanvasPoint, size: Size, orientation: CanvasWorkplaneOrientation): CanvasPoint {
  return mapAroundMidpoint(point, size, invertMatrix(canvasWorkplaneMatrix(orientation)));
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
export function canvasWorkplaneGrid(viewport: CanvasViewport, size: Size, orientation: CanvasWorkplaneOrientation): CanvasWorkplaneGridLine[] {
  const { width, height } = size;
  const { x, y, zoom } = viewport;
  if (![width, height, x, y, zoom].every(Number.isFinite) || width <= 0 || height <= 0 || zoom <= 0) return [];
  const matrix = canvasWorkplaneMatrix(orientation);
  const inverse = invertMatrix(matrix);
  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height }]
    .map((point) => mapAroundMidpoint(point, size, inverse));
  const left = Math.min(...corners.map((corner) => corner.x)), right = Math.max(...corners.map((corner) => corner.x));
  const top = Math.min(...corners.map((corner) => corner.y)), bottom = Math.max(...corners.map((corner) => corner.y));
  const target = Math.max(GRID_TARGET_PIXELS, (right - left + bottom - top) / (GRID_LINE_LIMIT - 4));
  const step = GRID_STEP * 2 ** Math.ceil(Math.log2(target / zoom / GRID_STEP));
  const pixels = step * zoom;
  if (!Number.isFinite(pixels) || pixels <= 0) return [];

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
