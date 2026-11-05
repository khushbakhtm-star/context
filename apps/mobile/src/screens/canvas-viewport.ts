import type { CanvasBoard, CanvasEdge, CanvasNode } from '../utils/canvas';
import { canvasWorkplaneMatrix, projectCanvasWorkplaneVector, unprojectCanvasWorkplane,
  type CanvasWorkplaneOrientation } from '../utils/canvas-workplane';

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Viewport = CanvasBoard['viewport'];
export type DragPreview = { nodeId: string; delta: Point };
export type Route = { edge: CanvasEdge; points: Point[] };

const MIN_ZOOM = 0.12;
const MAX_ZOOM = 3.5;

export function screenPoint(point: Point, viewport: Viewport): Point {
  return { x: (point.x - viewport.x) * viewport.zoom, y: (point.y - viewport.y) * viewport.zoom };
}

export function worldPoint(point: Point, viewport: Viewport): Point {
  return { x: viewport.x + point.x / viewport.zoom, y: viewport.y + point.y / viewport.zoom };
}

export function zoomViewport(viewport: Viewport, zoom: number, before: Point, after = before): Viewport {
  const bounded = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  const anchor = worldPoint(before, viewport);
  return { x: anchor.x - after.x / bounded, y: anchor.y - after.y / bounded, zoom: bounded };
}

export function centerCanvasNode(node: CanvasNode, size: Size, zoom: number): Viewport {
  return { x: node.x + (node.width - size.width / zoom) / 2,
    y: node.y + (node.height - size.height / zoom) / 2, zoom };
}

export function fitCanvas(nodes: (Point & Size)[], size: Size): Viewport {
  if (!nodes.length || size.width <= 0 || size.height <= 0) return { x: 0, y: 0, zoom: 1 };
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.x); right = Math.max(right, node.x + node.width);
    top = Math.min(top, node.y); bottom = Math.max(bottom, node.y + node.height);
  }
  const zoom = Math.max(MIN_ZOOM, Math.min(1, Math.max(1, size.width - 56) / (right - left),
    Math.max(1, size.height - 88) / (bottom - top)));
  return { x: (left + right - size.width / zoom) / 2, y: (top + bottom - size.height / zoom) / 2, zoom };
}

export function fitCanvasWorkplane(bounds: (Point & Size & { elevation?: number })[], size: Size,
  camera: CanvasWorkplaneOrientation | null): Viewport {
  if (camera === null || !bounds.length || size.width <= 0 || size.height <= 0) return fitCanvas(bounds, size);
  const { a, b, c, d } = canvasWorkplaneMatrix(camera);
  const rise = projectCanvasWorkplaneVector({ x: 0, y: 0, z: 1 }, camera);
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const bound of bounds) {
    const x = bound.x + bound.width / 2, y = bound.y + bound.height / 2;
    const projectedX = a * x + c * y, projectedY = b * x + d * y;
    const radiusX = (Math.abs(a) * bound.width + Math.abs(c) * bound.height) / 2;
    const radiusY = (Math.abs(b) * bound.width + Math.abs(d) * bound.height) / 2;
    const liftX = rise.x * (bound.elevation ?? 0), liftY = rise.y * (bound.elevation ?? 0);
    left = Math.min(left, projectedX - radiusX + Math.min(0, liftX));
    right = Math.max(right, projectedX + radiusX + Math.max(0, liftX));
    top = Math.min(top, projectedY - radiusY + Math.min(0, liftY));
    bottom = Math.max(bottom, projectedY + radiusY + Math.max(0, liftY));
  }
  const midpoint = unprojectCanvasWorkplane({ x: (left + right) / 2, y: (top + bottom) / 2 }, { width: 0, height: 0 }, camera);
  const zoom = Math.max(MIN_ZOOM, Math.min(1, Math.max(1, size.width - 56) / Math.max(1, right - left),
    Math.max(1, size.height - 88) / Math.max(1, bottom - top)));
  return { x: midpoint.x - size.width / (2 * zoom), y: midpoint.y - size.height / (2 * zoom), zoom };
}

export function canvasWorkplaneFrame(size: Size, camera: CanvasWorkplaneOrientation) {
  const { a, b, c, d } = canvasWorkplaneMatrix(camera);
  // Find the principal output axis. After undoing this rotation, the two
  // matrix rows are perpendicular, so their lengths are the native scales.
  const outerRotation = Math.atan2(2 * (a * b + c * d), (a * a + c * c) - (b * b + d * d)) / 2;
  const cosine = Math.cos(outerRotation), sine = Math.sin(outerRotation);
  const firstX = cosine * a + sine * b, firstY = cosine * c + sine * d;
  const scaleX = Math.hypot(firstX, firstY);
  const determinant = a * d - b * c;
  const scaleY = determinant / scaleX;
  const innerRotation = Math.atan2(-firstY, firstX);

  const middle = { x: size.width / 2, y: size.height / 2 };
  let halfWidth = middle.x, halfHeight = middle.y;
  for (const x of [-middle.x, middle.x]) for (const y of [-middle.y, middle.y]) {
    const rotated = { x: cosine * x + sine * y, y: -sine * x + cosine * y };
    const scaled = { x: rotated.x / scaleX, y: rotated.y / scaleY };
    const logical = { x: (d * x - c * y) / determinant, y: (a * y - b * x) / determinant };
    // Android inverts the three centered Views independently. Give every
    // intermediate point room without expanding the frame into a large square.
    halfWidth = Math.max(halfWidth, Math.abs(rotated.x), Math.abs(scaled.x), Math.abs(logical.x));
    halfHeight = Math.max(halfHeight, Math.abs(rotated.y), Math.abs(scaled.y), Math.abs(logical.y));
  }
  const width = 2 * halfWidth + 64, height = 2 * halfHeight + 64;
  const offset = { x: middle.x - width / 2, y: middle.y - height / 2 };
  return { size: { width, height }, offset, outerRotation, scaleX, scaleY, innerRotation };
}

export function visibleCanvasBoard(board: CanvasBoard): CanvasBoard {
  const nodeById = new Map(board.nodes.map((node) => [node.id, node]));
  const membership = new Map<string, { hiddenBy?: string; depth: number }>();
  function ancestry(node: CanvasNode) {
    let current: CanvasNode | undefined = node;
    const trail: CanvasNode[] = [];
    const seen = new Set<string>();
    while (current && !membership.has(current.id) && !seen.has(current.id)) {
      trail.push(current);
      seen.add(current.id);
      current = current.groupId ? nodeById.get(current.groupId) : undefined;
    }
    let parent = current;
    let inherited = parent && membership.get(parent.id);
    while (trail.length) {
      const child = trail.pop()!;
      inherited = { depth: inherited ? inherited.depth + 1 : 0,
        hiddenBy: inherited?.hiddenBy ?? (inherited && parent?.collapsed ? parent.id : undefined) };
      membership.set(child.id, inherited);
      parent = child;
    }
    return membership.get(node.id)!;
  }
  const nodes = board.nodes.flatMap((node) => {
    const relation = ancestry(node);
    if (relation.hiddenBy) return [];
    return [node.kind === 'group' && node.collapsed
      ? { ...node, width: Math.min(node.width, 200), height: Math.min(node.height, 86) } : node];
  }).sort((a, b) => {
    const aFrame = a.kind === 'group' && !a.collapsed;
    const bFrame = b.kind === 'group' && !b.collapsed;
    return Number(bFrame) - Number(aFrame) || ancestry(a).depth - ancestry(b).depth;
  });
  const edges = board.edges.flatMap((edge): CanvasEdge[] => {
    const fromNode = nodeById.get(edge.from), toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) return [];
    const from = ancestry(fromNode).hiddenBy ?? edge.from;
    const to = ancestry(toNode).hiddenBy ?? edge.to;
    if (from === to) return [];
    return [from === edge.from && to === edge.to ? edge : { ...edge, from, to }];
  });
  return { ...board, nodes, edges };
}

export function canvasDragNodes(nodes: CanvasNode[], nodeId: string): Set<string> {
  const moving = new Set([nodeId]);
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.groupId) continue;
    const group = children.get(node.groupId);
    if (group) group.push(node.id); else children.set(node.groupId, [node.id]);
  }
  for (const group of moving) for (const id of children.get(group) ?? []) moving.add(id);
  return moving;
}

/** Use the cached obstacle route until drop. Only moved endpoints need a cheap preview. */
export function previewCanvasRoutes(routes: Route[], moving: Set<string>, delta: Point): Route[] {
  const shift = (point: Point) => ({ x: point.x + delta.x, y: point.y + delta.y });
  return routes.map((route) => {
    const { edge, points } = route;
    const fromMoving = moving.has(edge.from), toMoving = moving.has(edge.to);
    if (!fromMoving && !toMoving || points.length < 2) return route;
    if (fromMoving && toMoving) return { edge, points: points.map(shift) };
    const from = fromMoving ? shift(points[0]!) : points[0]!;
    const to = toMoving ? shift(points.at(-1)!) : points.at(-1)!;
    const horizontal = points[0]!.y === points[1]!.y;
    const mid = horizontal ? (from.x + to.x) / 2 : (from.y + to.y) / 2;
    const bends = horizontal ? [{ x: mid, y: from.y }, { x: mid, y: to.y }] :
      [{ x: from.x, y: mid }, { x: to.x, y: mid }];
    return { edge, points: [from, ...bends, to].filter((point, index, all) =>
      index === 0 || point.x !== all[index - 1]!.x || point.y !== all[index - 1]!.y) };
  });
}

export function intersectsCanvasViewport(start: Point, end: Point, size: Size, margin = 24) {
  return Math.max(start.x, end.x) >= -margin && Math.max(start.y, end.y) >= -margin &&
    Math.min(start.x, end.x) <= size.width + margin && Math.min(start.y, end.y) <= size.height + margin;
}
