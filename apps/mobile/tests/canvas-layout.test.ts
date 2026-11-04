import assert from 'node:assert/strict';
import test from 'node:test';

import type { CanvasBoard, CanvasEdge, CanvasNode } from '../src/utils/canvas';
import { arrangeCanvas, routeCanvasEdge, routeCanvasEdges } from '../src/utils/canvas-layout';

function node(id: string, kind: CanvasNode['kind'] = 'note', patch: Partial<CanvasNode> = {}): CanvasNode {
  return { id, kind, text: `Text for ${id}`, x: 140, y: -200, width: 110, height: 62, ...patch };
}

function edge(from: string, to: string, kind: CanvasEdge['kind'] = 'parent'): CanvasEdge {
  return { id: `${from}-${to}`, from, to, kind, directed: kind !== 'related' && kind !== 'partnership', label: `${from} to ${to}` };
}

function board(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasBoard {
  return { id: 'example', title: 'Family and ideas', nodes, edges, viewport: { x: -6, y: 7, zoom: 0.7 } };
}

const center = ({ x, width }: CanvasNode) => x + width / 2;
const row = ({ y, height }: CanvasNode) => y + height / 2;
const withoutPosition = ({ x: _x, y: _y, ...rest }: CanvasNode) => rest;

function assertNoOverlaps(nodes: CanvasNode[]) {
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i]!, b = nodes[j]!;
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
      `${a.id} and ${b.id} overlap`);
  }
}

test('pedigree layout keeps partners and partnership hubs together, and centers siblings below their parents', () => {
  const original = board([node('a', 'person-circle'), node('b', 'person-square', { width: 180 }),
    node('ab', 'partnership', { width: 44, height: 34 }), node('child-one'), node('child-two', 'person-circle', { width: 185 })],
  [edge('a', 'ab', 'partnership'), edge('b', 'ab', 'partnership'), edge('ab', 'child-one'), edge('ab', 'child-two')]);
  const placed = arrangeCanvas(original, 'pedigree');
  const [a, b, partnership, childOne, childTwo] = placed.nodes as [CanvasNode, CanvasNode, CanvasNode, CanvasNode, CanvasNode];
  assert.equal(row(a), row(b));
  assert.equal(row(a), row(partnership));
  assert.ok(center(a) < center(partnership) && center(partnership) < center(b));
  assert.ok(row(childOne) > row(partnership));
  assert.equal(row(childOne), row(childTwo));
  assert.ok(Math.abs((center(childOne) + center(childTwo)) / 2 - center(partnership)) < 0.01);
  assertNoOverlaps(placed.nodes);
  assert.deepEqual(placed.nodes.map(withoutPosition), original.nodes.map(withoutPosition));
  assert.deepEqual(placed.edges, original.edges);
  assert.deepEqual(placed.viewport, original.viewport);
  assert.deepEqual(arrangeCanvas(placed, 'pedigree'), placed, 'Auto Arrange is deterministic');
});

test('pedigree layout supports rejoining family branches and one person in multiple partnerships', () => {
  const input = board(['grand-left', 'grand-right', 'left', 'right', 'other', 'join', 'second', 'child', 'half-sibling']
    .map((id) => node(id, id === 'join' || id === 'second' ? 'partnership' : 'person-circle')),
  [edge('grand-left', 'left'), edge('grand-right', 'right'), edge('left', 'join', 'partnership'),
    edge('right', 'join', 'partnership'), edge('left', 'second', 'partnership'), edge('other', 'second', 'partnership'),
    edge('join', 'child'), edge('second', 'half-sibling')]);
  const output = arrangeCanvas(input, 'pedigree');
  const map = new Map(output.nodes.map((item) => [item.id, item]));
  const at = (id: string) => row(map.get(id)!);
  assert.equal(at('left'), at('right'));
  assert.equal(at('left'), at('other'));
  assert.equal(at('left'), at('join'));
  assert.equal(at('left'), at('second'));
  assert.equal(at('child'), at('half-sibling'));
  assert.ok(at('grand-left') < at('left') && at('left') < at('child'));
  assertNoOverlaps(output.nodes);
  assert.deepEqual(output.edges, input.edges);
});

test('dependency cycles stay on one layer and nested group layouts keep children below their group', () => {
  const input = board([node('a', 'task'), node('b', 'task'), node('c', 'task'),
    node('g', 'group'), node('nested', 'group', { groupId: 'g' }), node('note', 'sticky', { groupId: 'nested', color: '#abc' })],
  [edge('a', 'b', 'dependency'), edge('b', 'a', 'dependency'), edge('b', 'c', 'dependency'), edge('c', 'note', 'related')]);
  const relationship = arrangeCanvas(input);
  assert.equal(row(relationship.nodes[0]!), row(relationship.nodes[1]!));
  assert.ok(row(relationship.nodes[2]!) > row(relationship.nodes[1]!));
  assertNoOverlaps(relationship.nodes);
  const grouped = arrangeCanvas(input, 'groups');
  assert.ok(row(grouped.nodes[3]!) < row(grouped.nodes[4]!));
  assert.ok(row(grouped.nodes[4]!) < row(grouped.nodes[5]!));
  assertNoOverlaps(grouped.nodes);
  assert.deepEqual(grouped.nodes.map(withoutPosition), input.nodes.map(withoutPosition));
});

test('routing uses right angles, clears a blocking card, and recomputes from moved endpoints', () => {
  const relation = edge('a', 'b');
  const input = board([node('a', 'note', { x: -50, y: 0, width: 100, height: 60 }),
    node('blocker', 'note', { x: -60, y: 115, width: 120, height: 80 }),
    node('b', 'note', { x: -50, y: 250, width: 100, height: 60 })], [relation]);
  const points = routeCanvasEdge(input, relation);
  assert.ok(points.length >= 4);
  assert.deepEqual(points[0], { x: 0, y: 60 });
  assert.deepEqual(points.at(-1), { x: 0, y: 250 });
  for (let index = 1; index < points.length; index++) {
    const first = points[index - 1]!, last = points[index]!;
    assert.ok(first.x === last.x || first.y === last.y);
    const crosses = first.x === last.x
      ? Math.abs(first.x) < 60 && Math.min(first.y, last.y) < 195 && Math.max(first.y, last.y) > 115
      : first.y > 115 && first.y < 195 && Math.min(first.x, last.x) < 60 && Math.max(first.x, last.x) > -60;
    assert.equal(crosses, false);
  }
  const moved = { ...input, nodes: input.nodes.map((item) => item.id === 'b' ? { ...item, x: 130 } : item) };
  assert.deepEqual(routeCanvasEdges(input), [{ edge: relation, points }]);
  assert.notDeepEqual(routeCanvasEdge(moved, relation), points);
});

test('a large unconnected board expands onto shelves with unique positions', () => {
  const input = board(Array.from({ length: 1200 }, (_, index) => node(`note-${index}`)), []);
  const output = arrangeCanvas(input);
  assert.equal(output.nodes.length, 1200);
  assert.equal(new Set(output.nodes.map(({ x, y }) => `${x}:${y}`)).size, 1200);
  assert.ok(new Set(output.nodes.map(({ y }) => y)).size > 1);
  assertNoOverlaps(output.nodes);
});

test('Auto Arrange keeps a shared Space card and its group in place', () => {
  const shared = node('milk', 'note', { x: 100, y: 112, groupId: 'errands', spaceIds: ['shopping', 'nutrition'] });
  const group = node('errands', 'group', { x: 85, y: 76, width: 150, height: 150 });
  const independent = node('email', 'note');
  const input: CanvasBoard = { ...board([shared, group, independent], [edge('milk', 'email', 'related')]), spaces: [
    { id: 'shopping', title: 'Shopping', x: 0, y: 0, width: 260, height: 260 },
    { id: 'nutrition', title: 'Nutrition', x: 70, y: 15, width: 260, height: 260 },
  ] };
  const arranged = arrangeCanvas(input);
  assert.deepEqual(arranged.nodes.slice(0, 2), [shared, group]);
  assert.deepEqual(arranged.spaces, input.spaces);
  assert.deepEqual(arranged.edges, input.edges);
  assert.notDeepEqual(arranged.nodes[2], independent);
  for (const space of input.spaces!) {
    const item = arranged.nodes[2]!;
    assert.ok(item.x + item.width <= space.x || item.x >= space.x + space.width ||
      item.y + item.height <= space.y || item.y >= space.y + space.height);
  }
  assert.deepEqual(arrangeCanvas(arranged), arranged);
});

test('multiple connections between the same two cards use separate visible lines', () => {
  const relation = edge('a', 'b', 'related');
  const dependency = edge('b', 'a', 'dependency');
  const input = board([node('a', 'note', { x: 0, y: 0 }), node('b', 'note', { x: 400, y: 0 })], [relation, dependency]);
  const routes = routeCanvasEdges(input);
  assert.equal(routes.length, 2);
  assert.notEqual(routes[0]!.points[0]!.y, routes[1]!.points[0]!.y);
});
