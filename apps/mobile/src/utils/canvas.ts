export const CANVAS_NODE_KINDS = [
  'note', 'sticky', 'task', 'heading', 'link', 'image', 'checklist',
  'person-circle', 'person-square', 'partnership', 'group',
] as const;
export const CANVAS_EDGE_KINDS = ['related', 'dependency', 'partnership', 'parent'] as const;

export type CanvasNodeKind = typeof CANVAS_NODE_KINDS[number];
export type CanvasEdgeKind = typeof CANVAS_EDGE_KINDS[number];
export type CanvasPoint = { x: number; y: number };
export type CanvasViewport = CanvasPoint & { zoom: number };
/** A half-open range of UTF-16 code units in the shared Notepad text. */
export type CanvasTextRange = { start: number; end: number };

export type CanvasNode = CanvasPoint & {
  id: string;
  kind: CanvasNodeKind;
  text: string;
  width: number;
  height: number;
  color?: string;
  groupId?: string;
  spaceIds?: string[];
  collapsed?: boolean;
  source?: CanvasTextRange;
  url?: string;
  checked?: boolean;
};
export type CanvasEdge = {
  id: string;
  from: string;
  to: string;
  kind: CanvasEdgeKind;
  directed: boolean;
  label?: string;
};
/** An elliptical region positioned by the top left of its bounding box. */
export type CanvasSpace = CanvasPoint & {
  id: string;
  title: string;
  width: number;
  height: number;
  color?: string;
};
export type CanvasStroke = { id: string; points: CanvasPoint[]; color?: string; width: number };
export type CanvasBoard = {
  id: string;
  title: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: CanvasViewport;
  spaces?: CanvasSpace[];
  strokes?: CanvasStroke[];
};
export type CanvasDocument = { version: 1; text: string; activeBoardId: string; boards: CanvasBoard[] };
export type CanvasNodeInput = Pick<CanvasNode, 'kind'> &
  Partial<Omit<CanvasNode, 'id' | 'kind' | 'source'>>;
export type CanvasNodePatch = Partial<Omit<CanvasNode, 'id' | 'source' | 'groupId'>> & { groupId?: string | null };
export type CanvasEdgeInput = Pick<CanvasEdge, 'from' | 'to'> & Partial<Omit<CanvasEdge, 'id' | 'from' | 'to'>>;
export type CanvasSpaceInput = Pick<CanvasSpace, 'title'> & Partial<Omit<CanvasSpace, 'id' | 'title'>>;
export type CanvasSpacePatch = Partial<Omit<CanvasSpace, 'id' | 'color'>> & { color?: string | null };
export type CanvasStrokeInput = { points: readonly CanvasPoint[]; color?: string; width?: number };
export type CanvasSearchResult = { boardId: string; boardTitle: string; node: CanvasNode };

const INITIAL_BOARD_ID = 'canvas-main';
const ORIGIN: CanvasViewport = { x: 0, y: 0, zoom: 1 };
const INVALID = 'The saved Canvas document is invalid. Your data has not been replaced.';
// Far beyond useful distances while keeping layout arithmetic precise.
export const CANVAS_WORLD_LIMIT = 1_000_000_000;
const SPACE_LIMIT = 500;
const STROKE_LIMIT = 2_000;
export const CANVAS_STROKE_POINT_LIMIT = 2_000;
let sequence = 0;

function invalid(): never { throw new Error(INVALID); }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function coordinate(value: unknown): value is number {
  return finite(value) && Math.abs(value) <= CANVAS_WORLD_LIMIT;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value);
}

function hexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.some((item) => item === value);
}

function validRange(range: CanvasTextRange, text: string) {
  return Number.isInteger(range.start) && Number.isInteger(range.end) &&
    range.start >= 0 && range.end > range.start && range.end <= text.length;
}

function readViewport(value: unknown): CanvasViewport {
  const viewport = record(value);
  if (!coordinate(viewport.x) || !coordinate(viewport.y) || !finite(viewport.zoom) ||
    viewport.zoom < 0.01 || viewport.zoom > 100) invalid();
  return { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
}

function readNode(value: unknown, text: string): CanvasNode {
  const node = record(value);
  if (!identifier(node.id) || !oneOf(CANVAS_NODE_KINDS, node.kind) ||
    typeof node.text !== 'string' || !coordinate(node.x) || !coordinate(node.y) ||
    !coordinate(node.width) || node.width < 24 || !coordinate(node.height) || node.height < 24) invalid();
  const result: CanvasNode = {
    id: node.id, kind: node.kind, text: node.text,
    x: node.x, y: node.y, width: node.width, height: node.height,
  };
  if (node.color !== undefined) {
    if (!hexColor(node.color)) invalid();
    result.color = node.color;
  }
  if (node.groupId !== undefined) {
    if (!identifier(node.groupId)) invalid();
    result.groupId = node.groupId;
  }
  if (node.spaceIds !== undefined) {
    if (!Array.isArray(node.spaceIds) || node.spaceIds.length > SPACE_LIMIT || !node.spaceIds.every(identifier) ||
      new Set(node.spaceIds).size !== node.spaceIds.length) invalid();
    result.spaceIds = [...node.spaceIds];
  }
  if (node.collapsed !== undefined) {
    if (typeof node.collapsed !== 'boolean' || node.kind !== 'group') invalid();
    result.collapsed = node.collapsed;
  }
  if (node.url !== undefined) {
    if (typeof node.url !== 'string') invalid();
    result.url = node.url;
  }
  if (node.checked !== undefined) {
    if (typeof node.checked !== 'boolean') invalid();
    result.checked = node.checked;
  }
  if (node.source !== undefined) {
    const source = record(node.source);
    if (!finite(source.start) || !finite(source.end)) invalid();
    const range = { start: source.start, end: source.end };
    if (!validRange(range, text) || text.slice(range.start, range.end) !== node.text) invalid();
    result.source = range;
  }
  return result;
}

function readEdge(value: unknown, nodes: Map<string, CanvasNode>): CanvasEdge {
  const edge = record(value);
  if (!identifier(edge.id) || !identifier(edge.from) || !identifier(edge.to) ||
    edge.from === edge.to || !nodes.has(edge.from) || !nodes.has(edge.to) ||
    !oneOf(CANVAS_EDGE_KINDS, edge.kind) || typeof edge.directed !== 'boolean' ||
    (edge.label !== undefined && typeof edge.label !== 'string')) invalid();
  return { id: edge.id, from: edge.from, to: edge.to, kind: edge.kind, directed: edge.directed,
    ...(edge.label !== undefined ? { label: edge.label } : {}) };
}

function readSpace(value: unknown): CanvasSpace {
  const space = record(value);
  if (!identifier(space.id) || typeof space.title !== 'string' || !space.title.trim() ||
    !coordinate(space.x) || !coordinate(space.y) || !coordinate(space.width) || space.width < 24 ||
    !coordinate(space.height) || space.height < 24 || (space.color !== undefined && !hexColor(space.color))) invalid();
  return { id: space.id, title: space.title, x: space.x, y: space.y, width: space.width, height: space.height,
    ...(space.color !== undefined ? { color: space.color } : {}) };
}

function readStroke(value: unknown): CanvasStroke {
  const stroke = record(value);
  if (!identifier(stroke.id) || !Array.isArray(stroke.points) || stroke.points.length === 0 ||
    stroke.points.length > CANVAS_STROKE_POINT_LIMIT || !finite(stroke.width) || stroke.width < 0.5 ||
    stroke.width > 32 || (stroke.color !== undefined && !hexColor(stroke.color))) invalid();
  const points = Array.from(stroke.points, (value: unknown) => {
    const point = record(value);
    if (!coordinate(point.x) || !coordinate(point.y)) invalid();
    return { x: point.x, y: point.y };
  });
  return { id: stroke.id, width: stroke.width, points, ...(stroke.color !== undefined ? { color: stroke.color } : {}) };
}

function readBoardItems<T extends { id: string }>(value: unknown, limit: number, read: (item: unknown) => T) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > limit) invalid();
  const items = Array.from(value, read);
  if (new Set(items.map((item) => item.id)).size !== items.length) invalid();
  return items;
}

function validateSpaceIds(spaceIds: readonly string[] | undefined, spaces: CanvasSpace[] | undefined) {
  if (spaceIds?.length && spaceIds.some((id) => !spaces?.some((space) => space.id === id))) {
    throw new Error('This Canvas space is unavailable.');
  }
}

function validateMembership(nodes: Map<string, CanvasNode>) {
  const validated = new Set<string>();
  for (const node of nodes.values()) {
    if (validated.has(node.id)) continue;
    const chain = new Set<string>();
    let current: CanvasNode | undefined = node;
    while (current && !validated.has(current.id)) {
      if (chain.has(current.id)) invalid();
      chain.add(current.id);
      if (!current.groupId) break;
      current = nodes.get(current.groupId);
      if (current?.kind !== 'group') invalid();
    }
    for (const id of chain) validated.add(id);
  }
}

function readBoard(value: unknown, text: string): CanvasBoard {
  const board = record(value);
  if (!identifier(board.id) || typeof board.title !== 'string' || !board.title.trim() ||
    !Array.isArray(board.nodes) || !Array.isArray(board.edges)) invalid();
  const nodes = board.nodes.map((node) => readNode(node, text));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  if (nodesById.size !== nodes.length) invalid();
  validateMembership(nodesById);
  const spaces = readBoardItems(board.spaces, SPACE_LIMIT, readSpace);
  const strokes = readBoardItems(board.strokes, STROKE_LIMIT, readStroke);
  const spaceIds = new Set(spaces?.map((space) => space.id));
  if (nodes.some((node) => node.spaceIds?.some((id) => !spaceIds.has(id)))) invalid();
  const edges = board.edges.map((edge) => readEdge(edge, nodesById));
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length) invalid();
  return { id: board.id, title: board.title, nodes, edges, viewport: readViewport(board.viewport),
    ...(spaces ? { spaces } : {}), ...(strokes ? { strokes } : {}) };
}

function emptyBoard(id: string, title: string): CanvasBoard {
  return { id, title, nodes: [], edges: [], viewport: { ...ORIGIN } };
}

export function createCanvasDocument(text = ''): CanvasDocument {
  return { version: 1, text, activeBoardId: INITIAL_BOARD_ID, boards: [emptyBoard(INITIAL_BOARD_ID, 'Canvas')] };
}

/** Missing data can migrate from Notepad. Invalid data fails closed. */
export function readCanvasDocument(value: unknown, fallbackText = ''): CanvasDocument {
  if (value === null || value === undefined) return createCanvasDocument(fallbackText);
  const document = record(value);
  if (document.version !== 1 || typeof document.text !== 'string' || !identifier(document.activeBoardId) ||
    !Array.isArray(document.boards) || document.boards.length === 0) invalid();
  const text = document.text;
  const boards = document.boards.map((board) => readBoard(board, text));
  const ids = new Set(boards.map((board) => board.id));
  if (ids.size !== boards.length || !ids.has(document.activeBoardId)) invalid();
  return { version: 1, text, activeBoardId: document.activeBoardId, boards };
}

function nextId(prefix: string, exists: (id: string) => boolean): string {
  let id: string;
  do {
    id = prefix + '-' + Date.now().toString(36) + '-' + (++sequence).toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  } while (exists(id));
  return id;
}

function requireBoard(document: CanvasDocument, boardId: string) {
  const board = document.boards.find((item) => item.id === boardId);
  if (!board) throw new Error('This Canvas board is unavailable.');
  return board;
}

export function activeCanvasBoard(document: CanvasDocument): CanvasBoard {
  return requireBoard(document, document.activeBoardId);
}

function boardTitle(title: string) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('Give this board a name.');
  return trimmed;
}

export function addCanvasBoard(document: CanvasDocument, title: string): CanvasDocument {
  const id = nextId('board', (candidate) => document.boards.some((board) => board.id === candidate));
  return { ...document, activeBoardId: id, boards: [...document.boards, emptyBoard(id, boardTitle(title))] };
}

export function selectCanvasBoard(document: CanvasDocument, boardId: string): CanvasDocument {
  requireBoard(document, boardId);
  return document.activeBoardId === boardId ? document : { ...document, activeBoardId: boardId };
}

/** Trusted callers can apply a layout in one immutable board update. */
export function updateCanvasBoard(document: CanvasDocument, boardId: string,
  update: (board: CanvasBoard) => CanvasBoard): CanvasDocument {
  const previous = requireBoard(document, boardId);
  const next = update(previous);
  if (next === previous) return document;
  if (next.id !== boardId) throw new Error('A Canvas board ID cannot change.');
  return { ...document, boards: document.boards.map((board) => board === previous ? next : board) };
}

export function renameCanvasBoard(document: CanvasDocument, boardId: string, title: string): CanvasDocument {
  const name = boardTitle(title);
  return updateCanvasBoard(document, boardId, (board) => board.title === name ? board : { ...board, title: name });
}

export function removeCanvasBoard(document: CanvasDocument, boardId: string): CanvasDocument {
  requireBoard(document, boardId);
  if (document.boards.length === 1) throw new Error('Keep at least one Canvas board.');
  const index = document.boards.findIndex((board) => board.id === boardId);
  const boards = document.boards.filter((board) => board.id !== boardId);
  const activeBoardId = document.activeBoardId === boardId
    ? boards[Math.min(index, boards.length - 1)]!.id : document.activeBoardId;
  return { ...document, activeBoardId, boards };
}

export function updateCanvasViewport(document: CanvasDocument, viewport: CanvasViewport,
  boardId = document.activeBoardId): CanvasDocument {
  const next = readViewport(viewport);
  return updateCanvasBoard(document, boardId, (board) => {
    const previous = board.viewport;
    return previous.x === next.x && previous.y === next.y && previous.zoom === next.zoom
      ? board : { ...board, viewport: next };
  });
}

function center(bounds: CanvasPoint & { width: number; height: number }): CanvasPoint {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function containsSpacePoint(space: CanvasSpace, point: CanvasPoint) {
  const origin = center(space);
  const dx = (point.x - origin.x) / (space.width / 2);
  const dy = (point.y - origin.y) / (space.height / 2);
  return dx * dx + dy * dy <= 1 + 1e-8;
}

/** Boundaries count as inside. Results follow the board's drawing order. */
export function canvasSpacesAtPoint(spaces: readonly CanvasSpace[], point: CanvasPoint): string[] {
  return spaces.filter((space) => containsSpacePoint(space, point)).map((space) => space.id);
}

function verticalIntersection(spaces: readonly CanvasSpace[], x: number) {
  let top = -Infinity, bottom = Infinity;
  for (const space of spaces) {
    const middle = center(space);
    const offset = (x - middle.x) / (space.width / 2);
    const height = space.height / 2 * Math.sqrt(Math.max(0, 1 - offset * offset));
    top = Math.max(top, middle.y - height);
    bottom = Math.min(bottom, middle.y + height);
  }
  return { top, bottom, gap: top - bottom };
}

/** Find a common point for one or more ellipses. Prefer their average center;
 * when possible, keep clear of other card centers and unselected ellipses. */
export function canvasSpaceOverlapPoint(spaces: readonly CanvasSpace[], board?: CanvasBoard,
  nodeId?: string): CanvasPoint | undefined {
  if (!spaces.length) return undefined;
  let left = -Infinity, right = Infinity;
  const average = { x: 0, y: 0 };
  for (const space of spaces) {
    left = Math.max(left, space.x);
    right = Math.min(right, space.x + space.width);
    const point = center(space);
    average.x += point.x / spaces.length;
    average.y += point.y / spaces.length;
  }
  if (left > right) return undefined;
  const selected = new Set(spaces.map((space) => space.id));
  const otherSpaces = board?.spaces?.filter((space) => !selected.has(space.id)) ?? [];
  const otherCenters = board?.nodes.filter((node) => node.id !== nodeId && node.kind !== 'group').map(center) ?? [];
  const target = board?.nodes.find((node) => node.id === nodeId);
  const clearance = target ? Math.min(target.width, target.height) / 2 : 18;
  let best: CanvasPoint | undefined;
  let fewestExtra = Infinity, fewestCrowded = Infinity, nearest = Infinity;
  function consider(point: CanvasPoint) {
    if (!spaces.every((space) => containsSpacePoint(space, point))) return;
    const extra = otherSpaces.reduce((count, space) => count + Number(containsSpacePoint(space, point)), 0);
    const crowded = otherCenters.reduce((count, position) => count +
      Number(Math.hypot(point.x - position.x, point.y - position.y) < clearance), 0);
    const distance = Math.hypot(point.x - average.x, point.y - average.y);
    if (extra > fewestExtra || (extra === fewestExtra && crowded > fewestCrowded) ||
      (extra === fewestExtra && crowded === fewestCrowded && distance >= nearest)) return;
    best = point;
    fewestExtra = extra;
    fewestCrowded = crowded;
    nearest = distance;
  }
  consider(average);
  if (fewestExtra === 0 && fewestCrowded === 0) return best;

  // The aggregate top boundary is convex and the bottom is concave. Search
  // their gap over the common horizontal span to find even a narrow lens.
  let low = left, high = right;
  for (let i = 0; i < 64 && low < high; i++) {
    const a = low + (high - low) / 3, b = high - (high - low) / 3;
    if (verticalIntersection(spaces, a).gap <= verticalIntersection(spaces, b).gap) high = b;
    else low = a;
  }
  const middle = (low + high) / 2;
  const central = verticalIntersection(spaces, middle);
  consider({ x: middle, y: (central.top + central.bottom) / 2 });
  if (!best) return undefined;

  // Find the ends of the feasible horizontal interval, then sample its
  // interior for alternatives if the average is outside or obstructed.
  function feasibleEnd(edge: number) {
    let inside = best!.x, outside = edge;
    for (let i = 0; i < 40; i++) {
      const x = (inside + outside) / 2;
      if (verticalIntersection(spaces, x).gap <= 0) inside = x;
      else outside = x;
    }
    return inside;
  }
  const from = feasibleEnd(left), to = feasibleEnd(right);
  for (const x of [Math.max(from, Math.min(to, average.x)), ...Array.from({ length: 11 },
    (_, index) => from + (to - from) * index / 10)]) {
    const { top, bottom } = verticalIntersection(spaces, x);
    for (const fraction of [0.15, 0.5, 0.85]) consider({ x, y: top + (bottom - top) * fraction });
  }
  return best;
}

function spaceTitle(title: string) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('Give this space a name.');
  return trimmed;
}

export function addCanvasSpace(document: CanvasDocument, input: CanvasSpaceInput,
  boardId = document.activeBoardId) {
  const board = requireBoard(document, boardId);
  const spaces = board.spaces ?? [];
  if (spaces.length >= SPACE_LIMIT) throw new Error('This Canvas board has reached its space limit.');
  const spaceId = nextId('space', (candidate) => spaces.some((space) => space.id === candidate));
  const offset = spaces.length % 6 * 48;
  const space = readSpace({ ...input, id: spaceId, title: spaceTitle(input.title),
    x: input.x ?? board.viewport.x + 48 + offset, y: input.y ?? board.viewport.y + 48 + offset / 2,
    width: input.width ?? 360, height: input.height ?? 260 });
  return { spaceId, document: updateCanvasBoard(document, boardId, (current) => ({ ...current, spaces: [...spaces, space] })) };
}

export function updateCanvasSpace(document: CanvasDocument, spaceId: string, patch: CanvasSpacePatch,
  boardId = document.activeBoardId): CanvasDocument {
  const board = requireBoard(document, boardId);
  const spaces = board.spaces ?? [];
  const previous = spaces.find((space) => space.id === spaceId);
  if (!previous) throw new Error('This Canvas space is unavailable.');
  const next = readSpace({ id: spaceId, x: patch.x ?? previous.x, y: patch.y ?? previous.y,
    width: patch.width ?? previous.width, height: patch.height ?? previous.height,
    title: patch.title === undefined ? previous.title : spaceTitle(patch.title),
    color: patch.color === null ? undefined : patch.color ?? previous.color });
  const sameGeometry = previous.x === next.x && previous.y === next.y &&
    previous.width === next.width && previous.height === next.height;
  if (sameGeometry && previous.title === next.title && previous.color === next.color) return document;
  let updated = updateCanvasBoard(document, boardId, (current) => ({
    ...current, spaces: spaces.map((space) => space === previous ? next : space),
  }));
  if (sameGeometry) return updated;

  const oldSpaces = new Map(spaces.map((space) => [space.id, space]));
  for (const node of board.nodes) {
    if (!node.spaceIds?.includes(spaceId)) continue;
    const point = center(node);
    if (containsSpacePoint(next, point) || !node.spaceIds.every((id) => containsSpacePoint(oldSpaces.get(id)!, point))) continue;
    updated = setCanvasNodeSpaces(updated, node.id, node.spaceIds, boardId);
  }
  return updated;
}

export function removeCanvasSpace(document: CanvasDocument, spaceId: string,
  boardId = document.activeBoardId): CanvasDocument {
  return updateCanvasBoard(document, boardId, (board) => {
    if (!board.spaces?.some((space) => space.id === spaceId)) return board;
    return { ...board, spaces: board.spaces.filter((space) => space.id !== spaceId),
      nodes: board.nodes.map((node) => {
        if (!node.spaceIds?.includes(spaceId)) return node;
        const { spaceIds, ...card } = node;
        const remaining = spaceIds.filter((id) => id !== spaceId);
        return remaining.length ? { ...card, spaceIds: remaining } : card;
      }) };
  });
}

/** Replaces the card's explicit memberships. Disjoint assignments still
 * persist, while the card stays where the user last positioned it. */
export function setCanvasNodeSpaces(document: CanvasDocument, nodeId: string, spaceIds: readonly string[],
  boardId = document.activeBoardId): CanvasDocument {
  const board = requireBoard(document, boardId);
  const node = board.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error('This Canvas card is unavailable.');
  const ids = [...new Set(spaceIds)];
  const byId = new Map(board.spaces?.map((space) => [space.id, space]));
  const spaces = ids.map((id) => {
    const space = byId.get(id);
    if (!space) throw new Error('This Canvas space is unavailable.');
    return space;
  });
  const point = center(node);
  const target = spaces.every((space) => containsSpacePoint(space, point))
    ? undefined : canvasSpaceOverlapPoint(spaces, board, nodeId);
  const x = target && target.x - node.width / 2, y = target && target.y - node.height / 2;
  if (!target && ids.length === (node.spaceIds?.length ?? 0) &&
    ids.every((id) => node.spaceIds?.includes(id))) return document;
  const position = coordinate(x) && coordinate(y) ? { x, y } : {};
  return updateCanvasNode(document, nodeId, { ...position, spaceIds: ids.length ? ids : undefined }, boardId);
}

export function addCanvasStroke(document: CanvasDocument, input: CanvasStrokeInput,
  boardId = document.activeBoardId): CanvasDocument {
  return updateCanvasBoard(document, boardId, (board) => {
    const strokes = board.strokes ?? [];
    if (strokes.length >= STROKE_LIMIT) throw new Error('This Canvas board has reached its drawing limit.');
    const id = nextId('stroke', (candidate) => strokes.some((stroke) => stroke.id === candidate));
    const stroke = readStroke({ ...input, id, width: input.width ?? 2 });
    return { ...board, strokes: [...strokes, stroke] };
  });
}

type TextEdit = { start: number; end: number; replacement: string };

function detectTextEdit(previous: string, next: string, hint?: CanvasTextRange): TextEdit {
  // DOM beforeinput and some native selection events can give the exact old
  // range. Verify that hint so a stale selection cannot move unrelated anchors.
  if (hint && Number.isInteger(hint.start) && Number.isInteger(hint.end) &&
    hint.start >= 0 && hint.end >= hint.start && hint.end <= previous.length) {
    const before = previous.slice(0, hint.start);
    const after = previous.slice(hint.end);
    if (next.length >= before.length + after.length && next.startsWith(before) && next.endsWith(after)) {
      return { ...hint, replacement: next.slice(hint.start, next.length - after.length) };
    }
  }
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let end = previous.length;
  let nextEnd = next.length;
  while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) {
    end--;
    nextEnd--;
  }
  return { start, end, replacement: next.slice(start, nextEnd) };
}

function rebaseRange(range: CanvasTextRange, edit: TextEdit): CanvasTextRange | undefined {
  const { start, end } = range;
  const replacementEnd = edit.start + edit.replacement.length;
  const delta = replacementEnd - edit.end;
  if (edit.end <= start) return delta ? { start: start + delta, end: end + delta } : range;
  if (edit.start >= end) return range;
  if (edit.start <= start && edit.end >= end) {
    // Replacing the selected phrase itself updates its cards. Erasing it, or
    // overwriting a wider passage, keeps the old card as an independent object.
    return edit.start === start && edit.end === end && replacementEnd > start
      ? { start, end: replacementEnd } : undefined;
  }
  const nextStart = edit.start < start ? replacementEnd : start;
  const nextEnd = edit.end >= end ? replacementEnd : end + delta;
  return nextEnd > nextStart ? { start: nextStart, end: nextEnd } : undefined;
}

function applyTextEdit(document: CanvasDocument, edit: TextEdit, text: string): CanvasDocument {
  const boards = document.boards.map((board) => {
    let changed = false;
    const nodes = board.nodes.map((node) => {
      if (!node.source) return node;
      const source = rebaseRange(node.source, edit);
      if (!source) {
        changed = true;
        const { source: _removed, ...detached } = node;
        return detached;
      }
      const noteText = text.slice(source.start, source.end);
      if (noteText === node.text && source.start === node.source.start && source.end === node.source.end) return node;
      changed = true;
      return { ...node, source, text: noteText };
    });
    return changed ? { ...board, nodes } : board;
  });
  return { ...document, text, boards };
}

export function setCanvasText(document: CanvasDocument, text: string, previousSelection?: CanvasTextRange): CanvasDocument {
  return document.text === text ? document
    : applyTextEdit(document, detectTextEdit(document.text, text, previousSelection), text);
}

function nodeDimensions(kind: CanvasNodeKind) {
  if (kind === 'group') return { width: 240, height: 160 };
  if (kind === 'partnership') return { width: 120, height: 64 };
  if (kind === 'person-circle' || kind === 'person-square') return { width: 120, height: 76 };
  return { width: 180, height: 92 };
}

function addNode(document: CanvasDocument, input: CanvasNodeInput, boardId: string, source?: CanvasTextRange) {
  const board = requireBoard(document, boardId);
  const nodeId = nextId('node', (candidate) => board.nodes.some((node) => node.id === candidate));
  const position = (board.nodes.length % 8) * 22;
  const dimensions = nodeDimensions(input.kind);
  const node = readNode({
    ...input, id: nodeId, source,
    text: input.text ?? '', x: input.x ?? board.viewport.x + 30 + position, y: input.y ?? board.viewport.y + 30 + position,
    width: input.width ?? dimensions.width, height: input.height ?? dimensions.height,
  }, document.text);
  if (node.groupId && !board.nodes.some((item) => item.id === node.groupId && item.kind === 'group')) {
    throw new Error('Choose an existing Canvas group.');
  }
  validateSpaceIds(node.spaceIds, board.spaces);
  return { document: updateCanvasBoard(document, boardId, (current) => ({ ...current, nodes: [...current.nodes, node] })), nodeId };
}

export function addCanvasNode(document: CanvasDocument, input: CanvasNodeInput, boardId = document.activeBoardId) {
  return addNode(document, input, boardId);
}

export function addLinkedCanvasNode(document: CanvasDocument, range: CanvasTextRange,
  position?: CanvasPoint, boardId = document.activeBoardId) {
  if (!validRange(range, document.text)) throw new Error('Highlight text in Notepad to add it to Canvas.');
  return addNode(document, { kind: 'sticky', text: document.text.slice(range.start, range.end), ...position }, boardId, range);
}

function descendantsOf(nodes: CanvasNode[], root: string) {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.groupId) continue;
    const siblings = children.get(node.groupId);
    if (siblings) siblings.push(node.id);
    else children.set(node.groupId, [node.id]);
  }
  const found = new Set<string>([root]);
  for (const id of found) {
    for (const child of children.get(id) ?? []) found.add(child);
  }
  return found;
}

export function updateCanvasNode(document: CanvasDocument, nodeId: string, patch: CanvasNodePatch,
  boardId = document.activeBoardId): CanvasDocument {
  const board = requireBoard(document, boardId);
  const old = board.nodes.find((node) => node.id === nodeId);
  if (!old) throw new Error('This Canvas card is unavailable.');
  const descendants = old.kind === 'group' ? descendantsOf(board.nodes, nodeId) : new Set([nodeId]);
  const groupId = patch.groupId === null ? undefined : patch.groupId ?? old.groupId;
  if (groupId && (descendants.has(groupId) || !board.nodes.some((node) => node.id === groupId && node.kind === 'group'))) {
    throw new Error('A card cannot be placed inside itself or one of its descendants.');
  }
  if (old.kind === 'group' && patch.kind && patch.kind !== 'group' && descendants.size > 1) {
    throw new Error('Move the cards out of this group before changing its type.');
  }
  let updated = document;
  if (old.source && patch.text !== undefined && patch.text !== old.text) {
    const edit = { ...old.source, replacement: patch.text };
    const text = document.text.slice(0, edit.start) + patch.text + document.text.slice(edit.end);
    updated = applyTextEdit(document, edit, text);
  }
  return updateCanvasBoard(updated, boardId, (current) => {
    const node = current.nodes.find((item) => item.id === nodeId)!;
    const next = readNode({ ...node, ...patch, groupId,
      kind: patch.kind ?? node.kind, text: patch.text ?? node.text,
      x: patch.x ?? node.x, y: patch.y ?? node.y, width: patch.width ?? node.width, height: patch.height ?? node.height,
      collapsed: (patch.kind ?? node.kind) === 'group' ? patch.collapsed ?? node.collapsed : undefined }, updated.text);
    validateSpaceIds(next.spaceIds, board.spaces);
    const dx = next.x - old.x;
    const dy = next.y - old.y;
    return { ...current, nodes: current.nodes.map((item) => {
      if (item.id === nodeId) return next;
      if ((dx || dy) && descendants.has(item.id)) {
        const x = item.x + dx;
        const y = item.y + dy;
        if (!coordinate(x) || !coordinate(y)) throw new Error('This Canvas group cannot be moved that far.');
        return { ...item, x, y };
      }
      return item;
    }) };
  });
}

export function removeCanvasNode(document: CanvasDocument, nodeId: string,
  boardId = document.activeBoardId): CanvasDocument {
  return updateCanvasBoard(document, boardId, (board) => {
    const removed = board.nodes.find((node) => node.id === nodeId);
    if (!removed) return board;
    return { ...board, edges: board.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
      nodes: board.nodes.filter((node) => node.id !== nodeId).map((node) =>
        node.groupId === nodeId ? { ...node, groupId: removed.groupId } : node) };
  });
}

export function groupCanvasNodes(document: CanvasDocument, nodeIds: readonly string[], title = 'Group',
  boardId = document.activeBoardId) {
  const board = requireBoard(document, boardId);
  const selected = new Set(nodeIds);
  const byId = new Map(board.nodes.map((node) => [node.id, node]));
  const roots = board.nodes.filter((node) => {
    if (!selected.has(node.id)) return false;
    let groupId = node.groupId;
    while (groupId) {
      if (selected.has(groupId)) return false;
      groupId = byId.get(groupId)?.groupId;
    }
    return true;
  });
  if (roots.length === 0) throw new Error('Select at least one Canvas card to group.');
  const rootIds = new Set(roots.map((node) => node.id));
  const parent = roots[0]!.groupId;
  const groupId = roots.every((node) => node.groupId === parent) ? parent : undefined;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const node of roots) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + node.width);
    bottom = Math.max(bottom, node.y + node.height);
  }
  const grouped = addCanvasNode(document, { kind: 'group', text: boardTitle(title), groupId,
    x: left - 18, y: top - 42, width: right - left + 36, height: bottom - top + 60 }, boardId);
  return {
    nodeId: grouped.nodeId,
    document: updateCanvasBoard(grouped.document, boardId, (current) => ({
      ...current,
      nodes: current.nodes.map((node) => rootIds.has(node.id) ? { ...node, groupId: grouped.nodeId } : node),
    })),
  };
}

export function addCanvasEdge(document: CanvasDocument, input: CanvasEdgeInput,
  boardId = document.activeBoardId): CanvasDocument {
  return updateCanvasBoard(document, boardId, (board) => {
    const kind = input.kind ?? 'related';
    const id = nextId('edge', (candidate) => board.edges.some((edge) => edge.id === candidate));
    const edge = readEdge({ ...input, id, kind,
      directed: input.directed ?? (kind === 'dependency' || kind === 'parent') },
    new Map(board.nodes.map((node) => [node.id, node])));
    return { ...board, edges: [...board.edges, edge] };
  });
}

export function updateCanvasEdge(document: CanvasDocument, edgeId: string, patch: Partial<CanvasEdgeInput>,
  boardId = document.activeBoardId): CanvasDocument {
  return updateCanvasBoard(document, boardId, (board) => {
    const old = board.edges.find((edge) => edge.id === edgeId);
    if (!old) throw new Error('This Canvas connection is unavailable.');
    const edge = readEdge({ ...old, ...patch, id: edgeId }, new Map(board.nodes.map((node) => [node.id, node])));
    return { ...board, edges: board.edges.map((item) => item === old ? edge : item) };
  });
}

export function removeCanvasEdge(document: CanvasDocument, edgeId: string,
  boardId = document.activeBoardId): CanvasDocument {
  return updateCanvasBoard(document, boardId, (board) => {
    const edges = board.edges.filter((edge) => edge.id !== edgeId);
    return edges.length === board.edges.length ? board : { ...board, edges };
  });
}

export function searchCanvas(document: CanvasDocument, query: string): CanvasSearchResult[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const matches: CanvasSearchResult[] = [];
  for (const board of document.boards) {
    const groups = new Map(board.nodes.filter((node) => node.kind === 'group').map((node) => [node.id, node.text]));
    const spaces = new Map(board.spaces?.map((space) => [space.id, space.title]));
    for (const node of board.nodes) {
      const haystack = [node.text, node.kind, node.url, board.title, node.groupId && groups.get(node.groupId),
        ...(node.spaceIds?.map((id) => spaces.get(id)) ?? [])]
        .filter(Boolean).join(' ').toLocaleLowerCase();
      if (words.every((word) => haystack.includes(word))) matches.push({ boardId: board.id, boardTitle: board.title, node });
    }
  }
  return matches;
}
