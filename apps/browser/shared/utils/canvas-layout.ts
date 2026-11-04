import { CANVAS_WORLD_LIMIT, isCanvasPerson, type CanvasBoard, type CanvasEdge, type CanvasFamily, type CanvasNode, type CanvasPoint } from './canvas';

export type CanvasLayoutMode = 'relationships' | 'pedigree' | 'groups';
export type { CanvasPoint } from './canvas';

type Link = { from: string; to: string; directed: boolean; weight: number };
type Unit = { id: string; nodes: CanvasNode[]; width: number; height: number };
type Placed = { node: CanvasNode; x: number; y: number };
type Box = { left: number; right: number; top: number; bottom: number };

const COLUMN_GAP = 68;
const ROW_GAP = 112;
const PARTNER_GAP = 34;
const COMPONENT_GAP = 100;
const MARGIN = 48;

function disjoint(ids: readonly string[]) {
  const parents = new Map(ids.map((id) => [id, id]));
  function root(id: string): string {
    let result = id;
    while (parents.get(result) !== result) result = parents.get(result)!;
    while (id !== result) {
      const next = parents.get(id)!;
      parents.set(id, result);
      id = next;
    }
    return result;
  }
  return { root, join: (a: string, b: string) => parents.set(root(b), root(a)) };
}

function partition<T>(items: readonly T[], key: (item: T) => string): T[][] {
  const parts = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    let part = parts.get(id);
    if (!part) parts.set(id, part = []);
    part.push(item);
  }
  return [...parts.values()];
}

function neighbors(ids: readonly string[], links: readonly Link[], reverse = false) {
  const result = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const { from, to } of links) result.get(reverse ? to : from)?.add(reverse ? from : to);
  return result;
}

/** Rank the condensation graph. A circular dependency remains on one layer. */
function directedRanks(ids: readonly string[], links: readonly Link[]) {
  const outward = neighbors(ids, links);
  const inward = neighbors(ids, links, true);
  const visited = new Set<string>();
  const finished: string[] = [];
  for (const id of ids) {
    if (visited.has(id)) continue;
    visited.add(id);
    const stack = [{ id, children: outward.get(id)!.values() }];
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const child = top.children.next();
      if (child.done) { finished.push(top.id); stack.pop(); }
      else if (!visited.has(child.value)) {
        visited.add(child.value);
        stack.push({ id: child.value, children: outward.get(child.value)!.values() });
      }
    }
  }

  const components = new Map<string, string>();
  for (const id of finished.reverse()) {
    if (components.has(id)) continue;
    const pending = [id];
    components.set(id, id);
    for (const member of pending) for (const parent of inward.get(member)!) {
      if (components.has(parent)) continue;
      components.set(parent, id);
      pending.push(parent);
    }
  }
  const leaders = [...new Set(components.values())];
  const between = links.flatMap((link) => {
    const from = components.get(link.from)!, to = components.get(link.to)!;
    return from === to ? [] : [{ ...link, from, to }];
  });
  const children = neighbors(leaders, between);
  const incoming = new Map([...neighbors(leaders, between, true)].map(([id, set]) => [id, set.size]));
  const ranks = new Map(leaders.map((id) => [id, 0]));
  const ready = leaders.filter((id) => incoming.get(id) === 0);
  for (const id of ready) for (const child of children.get(id)!) {
    ranks.set(child, Math.max(ranks.get(child)!, ranks.get(id)! + 1));
    const remaining = incoming.get(child)! - 1;
    incoming.set(child, remaining);
    if (!remaining) ready.push(child);
  }
  return new Map(ids.map((id) => [id, ranks.get(components.get(id)!)!]));
}

function undirectedRanks(ids: readonly string[], links: readonly Link[]) {
  const adjacency = neighbors(ids, links.flatMap((link) => [link, { ...link, from: link.to, to: link.from }]));
  const root = ids.reduce((best, id) => adjacency.get(id)!.size > adjacency.get(best)!.size ? id : best);
  const ranks = new Map([[root, 0]]);
  const pending = [root];
  for (const id of pending) for (const next of adjacency.get(id)!) {
    if (ranks.has(next)) continue;
    ranks.set(next, ranks.get(id)! + 1);
    pending.push(next);
  }
  return ranks;
}

function orderPartners(nodes: CanvasNode[], links: readonly Link[]) {
  const ids = nodes.map(({ id }) => id);
  const adjacency = neighbors(ids, links.flatMap((link) => [link, { ...link, from: link.to, to: link.from }]));
  for (const connections of adjacency.values()) {
    for (const id of connections) if (!adjacency.has(id)) connections.delete(id);
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const remaining = new Set(ids);
  const ordered: CanvasNode[] = [];
  const starts = [...ids].sort((a, b) => adjacency.get(a)!.size - adjacency.get(b)!.size);
  for (const start of starts) {
    const pending = [start];
    while (pending.length) {
      const id = pending.pop()!;
      if (!remaining.delete(id)) continue;
      ordered.push(byId.get(id)!);
      for (const neighbor of [...adjacency.get(id)!].reverse()) if (remaining.has(neighbor)) pending.push(neighbor);
    }
  }
  return ordered;
}

function canvasUnits(nodes: CanvasNode[], partners: Link[], hierarchy: Link[]) {
  const ids = nodes.map(({ id }) => id);
  const joined = disjoint(ids);
  const outward = neighbors(ids, hierarchy);
  const inward = neighbors(ids, hierarchy, true);
  const members = new Map(ids.map((id) => [id, [id]]));

  // Keep partners on the same generation unless the parent graph already
  // relates them vertically. This also protects imported cross-generation links.
  function connects(from: string, to: string, graph: Map<string, Set<string>>) {
    const pending = [from];
    const visited = new Set(pending);
    for (const unit of pending) for (const id of members.get(unit)!) for (const next of graph.get(id)!) {
      const nextUnit = joined.root(next);
      if (nextUnit === to) return true;
      if (!visited.has(nextUnit)) { visited.add(nextUnit); pending.push(nextUnit); }
    }
    return false;
  }
  for (const { from, to } of partners) {
    const a = joined.root(from), b = joined.root(to);
    if (a === b) continue;
    const aMembers = members.get(a)!, bMembers = members.get(b)!;
    if (connects(a, b, outward) || connects(a, b, inward)) continue;
    joined.join(a, b);
    aMembers.push(...bMembers);
    members.delete(b);
  }
  const units: Unit[] = partition(nodes, ({ id }) => joined.root(id)).map((part) => {
    const ordered = part.length > 1 ? orderPartners(part, partners) : part;
    return { id: joined.root(part[0]!.id), nodes: ordered,
      width: ordered.reduce((total, node) => total + node.width, 0) + (ordered.length - 1) * PARTNER_GAP,
      height: Math.max(...ordered.map((node) => node.height)) };
  });
  return { units, leader: joined.root };
}

function weightedCenter(points: { value: number; weight: number }[], fallback: number) {
  const total = points.reduce((sum, point) => sum + point.weight, 0);
  return total ? points.reduce((sum, point) => sum + point.value * point.weight, 0) / total : fallback;
}

/** Put centers near their preferred x while preserving the gaps and unit order. */
function spacedCenters(layer: Unit[], preferred: number[], gapAfter = (_index: number) => COLUMN_GAP) {
  let width = 0;
  const base = layer.map((unit, index) => {
    const center = width + unit.width / 2;
    width += unit.width + gapAfter(index);
    return center;
  });
  const runs: { first: number; count: number; total: number }[] = [];
  for (let i = 0; i < base.length; i++) {
    runs.push({ first: i, count: 1, total: preferred[i]! - base[i]! });
    while (runs.length > 1) {
      const last = runs[runs.length - 1]!, previous = runs[runs.length - 2]!;
      if (previous.total / previous.count <= last.total / last.count) break;
      runs.pop();
      previous.count += last.count;
      previous.total += last.total;
    }
  }
  return runs.flatMap(({ first, count, total }) =>
    base.slice(first, first + count).map((value) => value + total / count));
}

function layoutComponent(units: Unit[], links: Link[], unitFor: (id: string) => string, mode: CanvasLayoutMode) {
  const ids = units.map(({ id }) => id);
  const mapped = links.map((link) => ({ ...link, original: link, from: unitFor(link.from), to: unitFor(link.to) }))
    .filter(({ from, to }) => from !== to);
  const vertical = mapped.filter((link) => link.directed);
  const ranks = vertical.length || mode !== 'relationships'
    ? directedRanks(ids, vertical) : undirectedRanks(ids, mapped);
  const layers: Unit[][] = [];
  for (const unit of units) (layers[ranks.get(unit.id) ?? 0] ??= []).push(unit);
  const linksByUnit = new Map(ids.map((id) => [id, [] as { other: string; weight: number; otherNode: string; parent: boolean }[]]));
  mapped.forEach(({ from, to, weight, original }) => {
    // Resolve parent/partner anchors against the actual member's center.
    linksByUnit.get(from)!.push({ other: to, weight, otherNode: original.to, parent: false });
    linksByUnit.get(to)!.push({ other: from, weight, otherNode: original.from, parent: original.directed });
  });

  // Alternating barycenter passes reduce crossings while preserving the
  // original stable order for ties and unconnected nodes.
  const order = new Map<string, number>();
  const record = (layer: Unit[]) => layer.forEach((unit, index) => order.set(unit.id, (index + 0.5) / layer.length));
  layers.forEach(record);
  for (const downward of [true, false, true]) {
    const layerOrder = downward ? layers : [...layers].reverse();
    for (const layer of layerOrder) {
      const rank = ranks.get(layer[0]!.id) ?? 0;
      const scores = new Map(layer.map((unit) => {
        const adjacent = linksByUnit.get(unit.id)!.filter(({ other }) => downward
          ? (ranks.get(other) ?? 0) < rank : (ranks.get(other) ?? 0) > rank);
        return [unit.id, weightedCenter(adjacent.map(({ other, weight }) => ({ value: order.get(other)!, weight })), order.get(unit.id)!)];
      }));
      layer.sort((a, b) => scores.get(a.id)! - scores.get(b.id)!);
      record(layer);
    }
  }

  const placed = new Map<string, Placed>();
  let y = 0;
  for (const layer of layers) {
    const height = Math.max(...layer.map((unit) => unit.height));
    const width = layer.reduce((sum, unit) => sum + unit.width, 0) + (layer.length - 1) * COLUMN_GAP;
    let defaultX = -width / 2;
    const desired = layer.map((unit) => {
      const fallback = defaultX + unit.width / 2;
      defaultX += unit.width + COLUMN_GAP;
      const linked = linksByUnit.get(unit.id)!.flatMap(({ otherNode, weight, parent }) => {
        const item = placed.get(otherNode);
        return item ? [{ value: item.x + item.node.width / 2, weight, parent }] : [];
      });
      const parents = mode === 'pedigree' ? linked.filter(({ parent }) => parent) : [];
      return weightedCenter(parents.length ? parents : linked, fallback);
    });
    spacedCenters(layer, desired).forEach((center, index) => {
      const unit = layer[index]!;
      let x = center - unit.width / 2;
      for (const node of unit.nodes) {
        placed.set(node.id, { node, x, y: y + (height - node.height) / 2 });
        x += node.width + PARTNER_GAP;
      }
    });
    y += height + ROW_GAP;
  }
  return [...placed.values()];
}

export function canvasPersonSymbol(node: CanvasNode) {
  const size = Math.max(1, Math.floor(Math.min(42, node.width - 8, node.height * 0.58)));
  const x = node.x + (node.width - size) / 2;
  const y = node.y + Math.min(7, node.height - size);
  return { x, y, width: size, height: size, center: { x: x + size / 2, y: y + size / 2 } };
}

function pedigreeFamilies(board: CanvasBoard) {
  if (!board.families?.length) return [];
  const people = new Set(board.nodes.filter((node) => isCanvasPerson(node.kind)).map(({ id }) => id));
  return board.families.flatMap((family) => family.parents.every((id) => people.has(id))
    ? [{ ...family, children: family.children.filter((id) => people.has(id)) }] : []);
}

function pairedSiblings(families: CanvasFamily[]) {
  return families.flatMap(({ children }) => children.slice(1).map((to, index) => ({
    from: children[index]!, to, directed: false, weight: 1,
  })));
}

function familyDescents(families: CanvasFamily[]) {
  return families.flatMap(({ parents, children }) =>
    children.flatMap((to) => parents.map((from) => ({ from, to, directed: true, weight: 3 }))));
}

function parentSidePreferences(nodes: Map<string, CanvasNode>, families: CanvasFamily[], birthOrder: Link[],
  related: Map<string, Set<string>>, ranks: Map<string, number>) {
  const outward = neighbors([...nodes.keys()], birthOrder);
  const preferences: Link[] = [];
  for (const { parents } of families) {
    const [left, right] = nodes.get(parents[0])!.kind === 'person-square' ? parents : [parents[1], parents[0]];
    if (nodes.get(left)!.kind !== 'person-square' || nodes.get(right)!.kind !== 'person-circle' ||
      related.get(left)!.size > 1 || related.get(right)!.size > 1 || ranks.get(left) !== ranks.get(right)) continue;
    const visited = new Set([right]);
    for (const current of visited) for (const next of outward.get(current)!) visited.add(next);
    if (visited.has(left)) continue;
    outward.get(left)!.add(right);
    preferences.push({ from: left, to: right, directed: false, weight: 1 });
  }
  return preferences;
}

function orderedPedigreeLayer(layer: CanvasNode[], birthOrder: Link[], partners: Map<string, Set<string>>,
  scores: Map<string, number>, stable: Map<string, number>) {
  const ids = layer.map(({ id }) => id);
  const successors = neighbors(ids, birthOrder);
  const incoming = new Map(ids.map((id) => [id, 0]));
  const idSet = new Set(ids);
  for (const list of successors.values()) for (const id of list) {
    if (idSet.has(id)) incoming.set(id, incoming.get(id)! + 1);
  }
  const order = (a: string, b: string) => scores.get(a)! - scores.get(b)! || stable.get(a)! - stable.get(b)!;
  const ready = ids.filter((id) => incoming.get(id) === 0).sort(order);
  const remaining = new Set(ids);
  const byId = new Map(layer.map((node) => [node.id, node]));
  const result: CanvasNode[] = [];
  while (remaining.size) {
    // A free partner can follow the previous person when it does not displace
    // a materially closer branch. The birth order is a hard constraint.
    const previous = result.at(-1)?.id;
    const best = ready[0] ?? [...remaining].sort(order)[0]!;
    const closePartner = previous && ready.find((id) => partners.get(previous)?.has(id) &&
      scores.get(id)! - scores.get(best)! <= 0.23);
    const id = closePartner || best;
    const index = ready.indexOf(id);
    if (index >= 0) ready.splice(index, 1);
    remaining.delete(id);
    result.push(byId.get(id)!);
    for (const successor of successors.get(id)!) {
      if (!remaining.has(successor)) continue;
      const count = incoming.get(successor)! - 1;
      incoming.set(successor, count);
      if (count === 0) {
        const next = ready.findIndex((candidate) => order(successor, candidate) < 0);
        ready.splice(next < 0 ? ready.length : next, 0, successor);
      }
    }
  }
  return result;
}

function preserveBirthOrder(placed: Map<string, Placed>, ranks: Map<string, number>, birthOrder: Link[],
  related: Map<string, Set<string>>, stable: Map<string, number>) {
  const centers = new Map([...placed].map(([id, item]) => [id, item.x + item.node.width / 2]));
  if (!birthOrder.some(({ from, to }) => centers.get(from)! >= centers.get(to)!)) return;

  // A cross-generation partnership may make shared rows impossible. Keep
  // sibling order across the resulting rows as well, then restore clear gaps.
  const ordered = orderedPedigreeLayer([...placed.values()].map(({ node }) => node), birthOrder, new Map(), centers, stable);
  const siblingsBefore = neighbors([...placed.keys()], birthOrder, true);
  const previousByRow = new Map<number, CanvasNode>();
  for (const node of ordered) {
    const rank = ranks.get(node.id)!;
    const previous = previousByRow.get(rank);
    const afterPrevious = previous ? centers.get(previous.id)! + (previous.width + node.width) / 2 +
      (related.get(previous.id)?.has(node.id) ? PARTNER_GAP : COLUMN_GAP) : -Infinity;
    const afterSiblings = [...siblingsBefore.get(node.id)!].map((id) => centers.get(id)! + 12);
    const center = Math.max(centers.get(node.id)!, afterPrevious, ...afterSiblings);
    centers.set(node.id, center);
    placed.get(node.id)!.x = center - node.width / 2;
    previousByRow.set(rank, node);
  }
}

function layoutPedigreeComponent(nodes: CanvasNode[], partners: Link[], families: CanvasFamily[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const birthOrder = pairedSiblings(families);
  // The generated family records define generations. A manual dependency
  // between siblings still draws, but cannot split their row.
  const directed = familyDescents(families);
  const { units, leader } = canvasUnits(nodes, [...birthOrder, ...partners], directed);
  const unitLinks = directed.map((link) => ({ ...link, from: leader(link.from), to: leader(link.to) }))
    .filter(({ from, to }) => from !== to);
  const unitRanks = directedRanks(units.map(({ id }) => id), unitLinks);
  const ranks = new Map(nodes.map(({ id }) => [id, unitRanks.get(leader(id))!]));
  const layers: CanvasNode[][] = [];
  for (const node of nodes) (layers[ranks.get(node.id)!] ??= []).push(node);
  const ids = [...byId.keys()];
  const related = neighbors(ids, partners.flatMap((link) => [link, { ...link, from: link.to, to: link.from }]));
  const orderLinks = [...birthOrder, ...parentSidePreferences(byId, families, birthOrder, related, ranks)];
  const parentOf = neighbors(ids, directed, true);
  const childOf = neighbors(ids, directed);
  const seed = new Set<string>();
  for (const { parents, children } of families) {
    const [first, second] = parents;
    const squareOnRight = byId.get(second)?.kind === 'person-square' && byId.get(first)?.kind === 'person-circle';
    for (const parent of squareOnRight ? [second, first] : parents) seed.add(parent);
    for (const child of children) seed.add(child);
  }
  for (const id of ids) seed.add(id);
  const stable = new Map([...seed].map((id, index) => [id, index]));
  const order = new Map<string, number>();
  const record = (layer: CanvasNode[]) => layer.forEach(({ id }, index) => order.set(id, (index + 0.5) / layer.length));
  layers.forEach((layer) => { layer.sort((a, b) => stable.get(a.id)! - stable.get(b.id)!); record(layer); });
  for (const downward of [true, false, true]) {
    for (const layer of downward ? layers : [...layers].reverse()) {
      const rank = ranks.get(layer[0]!.id)!;
      const anchored = new Set<string>();
      const score = new Map(layer.map(({ id }) => {
        const connections = [...(downward ? parentOf : childOf).get(id)!]
          .filter((other) => downward ? ranks.get(other)! < rank : ranks.get(other)! > rank);
        if (connections.length) anchored.add(id);
        return [id, weightedCenter(connections.map((other) => ({ value: order.get(other)!, weight: 1 })), order.get(id)!)];
      }));
      // Partners without an independent generation anchor inherit the nearby
      // partner's ordering signal, keeping spouses near the relevant branch.
      const ownScore = new Map(score);
      for (const { id } of layer) {
        if (anchored.has(id)) continue;
        const peers = [...related.get(id)!].filter((other) => ranks.get(other) === rank && anchored.has(other));
        if (peers.length) score.set(id, weightedCenter(peers.map((other) => ({ value: ownScore.get(other)!, weight: 1 })), ownScore.get(id)!));
      }
      const ordered = orderedPedigreeLayer(layer, orderLinks, related, score, stable);
      layers[rank] = ordered;
      record(ordered);
    }
  }

  const placed = new Map<string, Placed>();
  let y = 0;
  for (const layer of layers) {
    const gaps = (index: number) => related.get(layer[index]!.id)!.has(layer[index + 1]?.id ?? '') ? PARTNER_GAP : COLUMN_GAP;
    const width = layer.reduce((total, node, index) => total + node.width + gaps(index), 0) - COLUMN_GAP;
    let left = -width / 2;
    const desired = layer.map(({ id, width }, index) => {
      const fallback = left + width / 2;
      left += width + gaps(index);
      const parentPositions = [...parentOf.get(id)!].flatMap((other) => {
        const parent = placed.get(other);
        return parent ? [{ value: parent.x + parent.node.width / 2, weight: 1 }] : [];
      });
      return weightedCenter(parentPositions, fallback);
    });
    const offsets = layer.map((node) => isCanvasPerson(node.kind) ? canvasPersonSymbol(node).center.y - node.y : node.height / 2);
    const alignment = Math.max(...offsets);
    const row = layer.map((node) => ({ id: node.id, width: node.width, height: node.height, nodes: [node] }));
    spacedCenters(row, desired, gaps).forEach((center, index) => {
      const node = layer[index]!;
      placed.set(node.id, { node, x: center - node.width / 2, y: y + alignment - offsets[index]! });
    });
    y += alignment + Math.max(...layer.map((node, index) => node.height - offsets[index]!)) + ROW_GAP;
  }
  preserveBirthOrder(placed, ranks, birthOrder, related, stable);
  return [...placed.values()];
}

/** Reposition the board without editing the contents, membership or connections. */
export function arrangeCanvas(board: CanvasBoard, mode: CanvasLayoutMode = 'relationships'): CanvasBoard {
  if (!board.nodes.length) return board;
  if (board.spaces?.length) return arrangeAroundSpaces(board, mode);
  const ids = board.nodes.map(({ id }) => id);
  const valid = new Set(ids);
  const edges = board.edges.filter(({ from, to }) => valid.has(from) && valid.has(to) && from !== to);
  const membership = board.nodes.flatMap((node) => node.groupId && valid.has(node.groupId) && node.groupId !== node.id
    ? [{ from: node.groupId, to: node.id, directed: mode !== 'pedigree', weight: 1 }] : []);
  const relations = edges.map(({ from, to, directed, kind }) => ({ from, to,
    directed: mode === 'pedigree' ? kind === 'parent' : kind !== 'partnership' && (directed || kind === 'parent' || kind === 'dependency'),
    weight: kind === 'parent' || kind === 'dependency' ? 3 : 1 }));
  const families = pedigreeFamilies(board);
  const familyPartners = families.map(({ parents: [from, to] }) => ({ from, to, directed: false, weight: 2 }));
  const partners = [
    ...(mode === 'pedigree' ? relations.filter((_link, index) => edges[index]!.kind === 'partnership') : []),
    ...familyPartners,
  ];
  const links = [...(mode === 'groups' ? membership : [...relations, ...membership]), ...familyPartners, ...familyDescents(families)];
  const components = disjoint(ids);
  for (const { from, to } of links) components.join(from, to);
  const linksByComponent = new Map(partition(links, ({ from }) => components.root(from)).map((part) => [components.root(part[0]!.from), part]));
  const partnerByComponent = new Map(partition(partners, ({ from }) => components.root(from)).map((part) => [components.root(part[0]!.from), part]));
  const familiesByComponent = new Map(partition(families, ({ parents }) => components.root(parents[0]))
    .map((part) => [components.root(part[0]!.parents[0]), part]));
  const layouts = partition(board.nodes, ({ id }) => components.root(id)).map((nodes) => {
    const id = components.root(nodes[0]!.id);
    const componentLinks = linksByComponent.get(id) ?? [];
    const componentPartners = partnerByComponent.get(id) ?? [];
    const componentFamilies = familiesByComponent.get(id);
    const positions = componentFamilies
      ? layoutPedigreeComponent(nodes, componentPartners, componentFamilies)
      : (() => {
        const { units, leader } = canvasUnits(nodes, componentPartners, componentLinks.filter(({ directed }) => directed));
        return layoutComponent(units, componentLinks, leader, mode);
      })();
    const minX = Math.min(...positions.map(({ x }) => x));
    const width = Math.max(...positions.map(({ x, node }) => x + node.width)) - minX;
    const height = Math.max(...positions.map(({ y, node }) => y + node.height));
    return { positions, minX, width, height };
  });

  const totalArea = layouts.reduce((area, { width, height }) => area + (width + COMPONENT_GAP) * (height + COMPONENT_GAP), 0);
  const shelfWidth = Math.max(760, Math.sqrt(totalArea) * 1.3, ...layouts.map(({ width }) => width));
  const positions = new Map<string, CanvasPoint>();
  let x = MARGIN, y = MARGIN, rowHeight = 0;
  for (const layout of layouts) {
    if (x > MARGIN && x + layout.width > MARGIN + shelfWidth) { x = MARGIN; y += rowHeight + COMPONENT_GAP; rowHeight = 0; }
    for (const entry of layout.positions) positions.set(entry.node.id, { x: entry.x - layout.minX + x, y: entry.y + y });
    x += layout.width + COMPONENT_GAP;
    rowHeight = Math.max(rowHeight, layout.height);
  }
  return { ...board, nodes: board.nodes.map((node) => ({ ...node, ...positions.get(node.id)! })) };
}

function arrangeAroundSpaces(board: CanvasBoard, mode: CanvasLayoutMode): CanvasBoard {
  // Keep a grouped card's frame and siblings in place when it anchors that group to a Space.
  const ids = new Set(board.nodes.map(({ id }) => id));
  const groups = disjoint([...ids]);
  for (const { id, groupId } of board.nodes) if (groupId && ids.has(groupId)) groups.join(groupId, id);
  const families = pedigreeFamilies(board);
  for (const family of families) {
    const [first, second] = family.parents;
    for (const id of [second, ...family.children]) groups.join(first, id);
  }
  const pedigree = new Set(families.map(({ parents }) => groups.root(parents[0])));
  const anchored = new Set(board.nodes.filter((node) => node.spaceIds?.length)
    .map(({ id }) => groups.root(id)).filter((id) => !pedigree.has(id)));
  const fixed: CanvasNode[] = [], movable: CanvasNode[] = [];
  for (const node of board.nodes) (anchored.has(groups.root(node.id)) ? fixed : movable).push(node);
  if (!movable.length) return board;

  const arranged = arrangeCanvas({ ...board, spaces: undefined, nodes: movable }, mode);
  const obstacles = [...(board.spaces ?? []), ...fixed].map((item) => box(item, COMPONENT_GAP / 2));
  const moving = arranged.nodes.map((node) => box(node));
  const envelope = (items: Box[]) => items.reduce((bounds, item) => ({
    left: Math.min(bounds.left, item.left), right: Math.max(bounds.right, item.right),
    top: Math.min(bounds.top, item.top), bottom: Math.max(bounds.bottom, item.bottom),
  }));
  const allMoving = envelope(moving);
  let shift = { x: 0, y: 0 };
  if (obstacles.some((item) => item.left < allMoving.right && allMoving.left < item.right &&
    item.top < allMoving.bottom && allMoving.top < item.bottom)) {
    const allFixed = envelope(obstacles);
    shift = [
      { x: allFixed.right - allMoving.left, y: 0 }, { x: allFixed.left - allMoving.right, y: 0 },
      { x: 0, y: allFixed.bottom - allMoving.top }, { x: 0, y: allFixed.top - allMoving.bottom },
    ].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))
      .find(({ x, y }) => arranged.nodes.every((node) => Math.abs(node.x + x) <= CANVAS_WORLD_LIMIT &&
        Math.abs(node.y + y) <= CANVAS_WORLD_LIMIT)) ?? shift;
    if (!shift.x && !shift.y) return board;
  }
  const byId = new Map(arranged.nodes.map((node) => [node.id, { ...node, x: node.x + shift.x, y: node.y + shift.y }]));
  return { ...board, nodes: board.nodes.map((node) => byId.get(node.id) ?? node) };
}

function box(node: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>, padding = 0): Box {
  return { left: node.x - padding, right: node.x + node.width + padding,
    top: node.y - padding, bottom: node.y + node.height + padding };
}

function crosses(a: CanvasPoint, b: CanvasPoint, obstacle: Box) {
  if (a.x === b.x && a.y === b.y) return false;
  return a.x === b.x
    ? a.x > obstacle.left && a.x < obstacle.right && Math.min(a.y, b.y) < obstacle.bottom && Math.max(a.y, b.y) > obstacle.top
    : a.y > obstacle.top && a.y < obstacle.bottom && Math.min(a.x, b.x) < obstacle.right && Math.max(a.x, b.x) > obstacle.left;
}

function simplify(points: CanvasPoint[]) {
  const result: CanvasPoint[] = [];
  for (const point of points) {
    const last = result.at(-1), previous = result.at(-2);
    if (last && last.x === point.x && last.y === point.y) continue;
    if (last && previous && ((previous.x === last.x && last.x === point.x && (last.y - previous.y) * (point.y - last.y) >= 0) ||
      (previous.y === last.y && last.y === point.y && (last.x - previous.x) * (point.x - last.x) >= 0))) result.pop();
    result.push(point);
  }
  return result;
}

type Obstacle = { id: string; bounds: Box };

function indexObstacles(nodes: (Pick<CanvasNode, 'id' | 'x' | 'y' | 'width' | 'height'>)[]) {
  const bins = (min: 'left' | 'top', max: 'right' | 'bottom') => {
    const buckets = new Map<number, Obstacle[]>();
    const wide: Obstacle[] = [];
    for (const node of nodes) {
      const obstacle = { id: node.id, bounds: box(node, 7) };
      const first = Math.floor(obstacle.bounds[min] / 128), last = Math.floor(obstacle.bounds[max] / 128);
      const span = last - first;
      if (!Number.isFinite(span) || span > 32) { wide.push(obstacle); continue; }
      for (let offset = 0; offset <= span; offset++) {
        const bucket = first + offset;
        let group = buckets.get(bucket);
        if (!group) buckets.set(bucket, group = []);
        group.push(obstacle);
      }
    }
    return (point: number) => {
      const near = buckets.get(Math.floor(point / 128)) ?? [];
      return wide.length ? [...near, ...wide] : near;
    };
  };
  const byX = bins('left', 'right'), byY = bins('top', 'bottom');
  return (a: CanvasPoint, b: CanvasPoint) => a.x === b.x ? byX(a.x) : byY(a.y);
}

function route(from: CanvasNode, to: CanvasNode, edge: CanvasEdge, obstacles: ReturnType<typeof indexObstacles>, lane: number) {
  const center = (node: CanvasNode) => ({ x: node.x + node.width / 2, y: node.y + node.height / 2 });
  const a = center(from), b = center(to);
  const sx = b.x < a.x ? -1 : 1, sy = b.y < a.y ? -1 : 1;
  const verticalDistance = Math.abs(a.y - b.y);
  const hierarchyEdge = edge.kind === 'parent' || edge.kind === 'dependency';
  const prefersVertical = hierarchyEdge && verticalDistance >= (from.height + to.height) / 2
    || verticalDistance > Math.abs(a.x - b.x);
  const between = (first: number, last: number) => (first + last) / 2;
  const portOffset = (size: number) => Math.max(-size * 0.32, Math.min(size * 0.32, lane));

  function candidates(vertical: boolean) {
    const start = vertical ? { x: a.x + portOffset(from.width), y: a.y + sy * from.height / 2 }
      : { x: a.x + sx * from.width / 2, y: a.y + portOffset(from.height) };
    const end = vertical ? { x: b.x + portOffset(to.width), y: b.y - sy * to.height / 2 }
      : { x: b.x - sx * to.width / 2, y: b.y + portOffset(to.height) };
    const out = vertical ? { x: start.x, y: start.y + sy * 12 } : { x: start.x + sx * 12, y: start.y };
    const into = vertical ? { x: end.x, y: end.y - sy * 12 } : { x: end.x - sx * 12, y: end.y };
    const mid = vertical ? between(out.y, into.y) : between(out.x, into.x);
    const path = (spine: number) => vertical
      ? [start, out, { x: out.x, y: spine }, { x: into.x, y: spine }, into, end]
      : [start, out, { x: spine, y: out.y }, { x: spine, y: into.y }, into, end];
    const primary = path(mid);
    return { primary, alternatives: () => {
      const detours: CanvasPoint[][] = [path(mid - 24), path(mid + 24), path(mid - 48), path(mid + 48)];
      const blocking = new Map<string, Box>();
      for (let i = 1; i < primary.length; i++) {
        const first = primary[i - 1]!, last = primary[i]!;
        for (const { id, bounds } of obstacles(first, last)) {
          if (id !== from.id && id !== to.id && crosses(first, last, bounds)) blocking.set(id, bounds);
        }
      }
      for (const bounds of blocking.values()) {
        if (vertical) {
          detours.push(path(bounds.top), path(bounds.bottom));
          for (const x of [bounds.left, bounds.right]) detours.push([start, out, { x, y: out.y }, { x, y: into.y }, into, end]);
        } else {
          detours.push(path(bounds.left), path(bounds.right));
          for (const y of [bounds.top, bounds.bottom]) detours.push([start, out, { x: out.x, y }, { x: into.x, y }, into, end]);
        }
        if (detours.length >= 20) break;
      }
      return detours;
    } };
  }

  function score(points: CanvasPoint[]) {
    let length = 0, blocked = 0;
    for (let i = 1; i < points.length; i++) {
      const first = points[i - 1]!, last = points[i]!;
      length += Math.abs(first.x - last.x) + Math.abs(first.y - last.y);
      for (const { id, bounds } of obstacles(first, last)) if (id !== from.id && id !== to.id && crosses(first, last, bounds)) blocked++;
    }
    return { blocked, length: length + points.length * 6 };
  }

  const preferred = candidates(prefersVertical);
  let best = simplify(preferred.primary), bestScore = score(best);
  if (!bestScore.blocked) return best;
  const fallback = candidates(!prefersVertical);
  for (const candidate of [fallback.primary, ...preferred.alternatives(), ...fallback.alternatives()]) {
    const points = simplify(candidate), value = score(points);
    if (value.blocked < bestScore.blocked || value.blocked === bestScore.blocked && value.length < bestScore.length) {
      best = points;
      bestScore = value;
    }
  }
  return best;
}

/** Compute orthogonal connector polylines from current node geometry. */
export function routeCanvasEdges(board: CanvasBoard): { edge: CanvasEdge; points: CanvasPoint[] }[] {
  const nodes = new Map(board.nodes.map((node) => [node.id, node]));
  const obstacles = indexObstacles(board.nodes);
  const pair = ({ from, to }: CanvasEdge) => JSON.stringify(from < to ? [from, to] : [to, from]);
  const lanes = new Map<string, number>();
  for (const parallel of partition(board.edges, pair)) {
    const gap = Math.min(13, 48 / parallel.length);
    parallel.forEach((edge, index) => lanes.set(edge.id, (index - (parallel.length - 1) / 2) * gap));
  }
  return board.edges.flatMap((edge) => {
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    return from && to && from !== to ? [{ edge, points: route(from, to, edge, obstacles, lanes.get(edge.id) ?? 0) }] : [];
  });
}

export function routeCanvasEdge(board: CanvasBoard, edge: CanvasEdge): CanvasPoint[] {
  return routeCanvasEdges({ ...board, edges: [edge] })[0]?.points ?? [];
}

export type CanvasFamilyRoute = {
  familyId: string;
  points: CanvasPoint[];
  label?: { text: string; x: number; y: number };
};

type PersonSymbol = ReturnType<typeof canvasPersonSymbol> & { id: string; kind: CanvasNode['kind'] };

function sideOfSymbol(symbol: PersonSymbol, side: -1 | 1, y: number) {
  const radius = symbol.width / 2;
  const offset = Math.min(1, Math.abs(y - symbol.center.y) / radius);
  const shape = symbol.kind === 'person-circle' ? Math.sqrt(1 - offset ** 2)
    : symbol.kind === 'person-diamond' ? 1 - offset : 1;
  return { x: symbol.center.x + side * radius * shape, y };
}

/** Route the standard union, shared descent and child stems from actual symbol bounds. */
export function routeCanvasFamilies(board: CanvasBoard): CanvasFamilyRoute[] {
  const families = pedigreeFamilies(board);
  if (!families.length) return [];
  const nodes = new Map(board.nodes.map((node) => [node.id, node]));
  const hidden = (node: CanvasNode) => {
    let id = node.groupId;
    const visited = new Set<string>();
    while (id && !visited.has(id)) {
      visited.add(id);
      const group = nodes.get(id);
      if (group?.collapsed) return true;
      id = group?.groupId;
    }
    return false;
  };
  const symbols = new Map<string, PersonSymbol>(board.nodes.filter((node) => isCanvasPerson(node.kind) && !hidden(node))
    .map((node) => [node.id, { ...canvasPersonSymbol(node), id: node.id, kind: node.kind }]));
  const obstacles = indexObstacles([...symbols.values()]);
  const bars: { min: number; max: number; y: number }[] = [];
  const lines: CanvasFamilyRoute[] = [];

  for (const family of families) {
    const first = symbols.get(family.parents[0]), second = symbols.get(family.parents[1]);
    if (!first || !second) continue;
    const [left, right] = first.center.x <= second.center.x ? [first, second] : [second, first];
    const centerX = (left.center.x + right.center.x) / 2;
    const centerY = (left.center.y + right.center.y) / 2;
    const doubleGap = family.consanguineous ? Math.min(3, left.width / 6, right.width / 6) : 0;
    const children = family.children.flatMap((id) => {
      const child = symbols.get(id);
      return child ? [child] : [];
    });
    const blockers = (a: CanvasPoint, b: CanvasPoint) => obstacles(a, b).filter(({ id, bounds }) =>
      id !== left.id && id !== right.id && crosses(a, b, bounds));
    const span = (y: number) => [{ x: left.center.x, y }, { x: right.center.x, y }] as const;
    const crossing = [...blockers(...span(centerY - doubleGap)), ...blockers(...span(centerY + doubleGap))];
    const unionY = crossing.length ? Math.min(left.y, right.y, ...crossing.map(({ bounds }) => bounds.top)) - 12 : centerY;
    const fromX = left.x + left.width, toX = right.x;
    const shoulder = Math.max(0, Math.min(11, (toX - fromX) / 3));
    const shoulderLeft = fromX + shoulder, shoulderRight = toX - shoulder;
    const addLine = (points: CanvasPoint[], label?: CanvasFamilyRoute['label']) => {
      const clean = simplify(points);
      if (clean.length > 1) lines.push({ familyId: family.id, points: clean, ...(label ? { label } : {}) });
    };

    for (const [index, offset] of (doubleGap ? [-doubleGap, doubleGap] : [0]).entries()) {
      const anchorLeft = sideOfSymbol(left, 1, left.center.y + offset);
      const anchorRight = sideOfSymbol(right, -1, right.center.y + offset);
      const y = unionY + offset;
      const x1 = shoulderLeft - (y === anchorLeft.y ? 0 : offset / 2);
      const x2 = shoulderRight + (y === anchorRight.y ? 0 : offset / 2);
      addLine([anchorLeft, { x: x1, y: anchorLeft.y }, { x: x1, y }, { x: x2, y },
        { x: x2, y: anchorRight.y }, anchorRight],
      index === 0 && family.relationshipLabel ? { text: family.relationshipLabel, x: centerX, y: y - 8 } : undefined);
    }
    if (!children.length) continue;

    const downward = children.filter(({ center }) => center.y >= centerY).length >= children.length / 2;
    const direction = downward ? 1 : -1;
    const unionStart = unionY + direction * doubleGap;
    const childAnchors = children.map((symbol) => ({
      x: symbol.center.x, y: symbol.center.y >= unionStart ? symbol.y : symbol.y + symbol.height,
    }));
    const nearest = downward ? Math.min(...childAnchors.map(({ y }) => y)) : Math.max(...childAnchors.map(({ y }) => y));
    const desiredBarY = (unionStart + nearest) / 2;
    const clampX = (x: number) => Math.max(Math.min(shoulderLeft, shoulderRight), Math.min(Math.max(shoulderLeft, shoulderRight), x));
    const stemCrossing = blockers({ x: centerX, y: unionStart }, { x: centerX, y: desiredBarY });
    const roots = [centerX, shoulderLeft, shoulderRight, ...stemCrossing.flatMap(({ bounds }) => [bounds.left - 2, bounds.right + 2])]
      .map(clampX).sort((a, b) => Math.abs(a - centerX) - Math.abs(b - centerX));
    const rootX = roots.find((x) => !blockers({ x, y: unionStart }, { x, y: desiredBarY }).length) ?? centerX;
    const min = Math.min(rootX, ...childAnchors.map(({ x }) => x)), max = Math.max(rootX, ...childAnchors.map(({ x }) => x));
    const room = Math.floor(Math.abs(nearest - unionStart) / 18);
    let barY = desiredBarY;
    for (let lane = 0; lane < room; lane++) {
      const offset = (lane % 2 === 0 ? 1 : -1) * Math.ceil(lane / 2) * 9;
      const y = desiredBarY + offset;
      if (!bars.some((other) => Math.abs(other.y - y) < 7 && other.min < max && min < other.max)) {
        barY = y;
        break;
      }
    }
    bars.push({ min, max, y: barY });
    addLine([{ x: rootX, y: unionStart }, { x: rootX, y: barY }]);
    addLine([{ x: min, y: barY }, { x: max, y: barY }]);
    for (const child of childAnchors) addLine([{ x: child.x, y: barY }, child]);
  }
  return lines;
}
