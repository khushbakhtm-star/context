import { isCanvasPerson, type CanvasNode, type CanvasPoint, type CanvasViewport } from '../shared/utils/canvas';
import { canvasPersonSymbol } from '../shared/utils/canvas-layout';
import { canvasWorkplaneSolidDepth, projectCanvasWorkplane, projectCanvasWorkplaneSolid, projectCanvasWorkplaneVector,
  type CanvasWorkplaneCamera } from '../shared/utils/canvas-workplane';

type Size = { width: number; height: number };
type Layers = { people: SVGSVGElement; blocks: SVGSVGElement };
type CardDrag = { ids: ReadonlySet<string>; x: number; y: number };
const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const result = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) result.setAttribute(name, String(value));
  return result;
}

function sphereLighting() {
  const light = svg('radialGradient', { id: 'canvas-sphere-light', cx: '32%', cy: '27%', r: '76%' });
  for (const [offset, color, opacity] of [[0, '#fff', 0.66], [0.47, '#fff', 0.04], [0.79, '#000', 0.18], [1, '#000', 0.49]]) {
    light.append(svg('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
  }
  const defs = svg('defs', {});
  defs.append(light);
  return defs;
}

function shadedFace(color: string, shade: number) {
  const contrast = Math.round(Math.min(48, Math.abs(shade - 0.72) * 68));
  return `color-mix(in srgb, ${color} ${100 - contrast}%, ${shade < 0.72 ? '#18181b' : '#fff'})`;
}

/** Draw meshes at projected screen positions while leaving the board geometry intact. */
export function paintCanvasSolids(layers: Layers, nodes: readonly CanvasNode[], selected: ReadonlySet<string>,
  viewport: CanvasViewport, size: Size, camera: CanvasWorkplaneCamera, drag?: CardDrag) {
  const people: { depth: number; group: SVGGElement }[] = [];
  const blocks: { depth: number; group: SVGGElement }[] = [];
  const { zoom } = viewport;
  for (const node of nodes) {
    if (node.kind === 'group') continue;
    const person = isCanvasPerson(node.kind);
    const symbol = person ? canvasPersonSymbol(node) : undefined;
    const bounds = symbol ?? node;
    const moving = drag?.ids.has(node.id) ? drag : undefined;
    const x = bounds.x + bounds.width / 2 + (moving?.x ?? 0), y = bounds.y + bounds.height / 2 + (moving?.y ?? 0);
    const anchor = projectCanvasWorkplane({ x: (x - viewport.x) * zoom, y: (y - viewport.y) * zoom }, size, camera);
    const radius = Math.max(bounds.width, bounds.height) * zoom + 36;
    if (anchor.x < -radius || anchor.x > size.width + radius || anchor.y < -radius || anchor.y > size.height + radius) continue;
    const color = node.color ?? (node.kind === 'sticky' ? '#d5b970' : 'var(--surface)');
    const shape = !person ? 'block' : node.kind === 'person-circle' ? 'sphere'
      : node.kind === 'person-square' ? 'cube' : 'octahedron';
    const depth = person ? Math.min(bounds.width, bounds.height) : canvasWorkplaneSolidDepth('block', bounds);
    const group = svg('g', { 'data-solid-shape': shape });
    let bottom = anchor.y;
    if (shape === 'sphere') {
      const shift = projectCanvasWorkplaneVector({ x: 0, y: 0, z: depth / 2 }, camera);
      const cx = anchor.x + shift.x * zoom, cy = anchor.y + shift.y * zoom, r = depth * zoom / 2;
      group.append(svg('circle', { cx, cy, r, fill: color }), svg('circle', { cx, cy, r,
        fill: 'url(#canvas-sphere-light)', class: 'canvas-solid-outline' }));
      bottom = cy + r;
    } else {
      for (const face of projectCanvasWorkplaneSolid(shape, { width: bounds.width, height: bounds.height, depth }, camera)) {
        const points = face.points.map(({ x: px, y: py }): CanvasPoint => ({ x: anchor.x + px * zoom, y: anchor.y + py * zoom }));
        for (const point of points) bottom = Math.max(bottom, point.y);
        group.append(svg('polygon', { points: points.map((point) => point.x + ',' + point.y).join(' '),
          fill: shadedFace(color, face.shade), class: 'canvas-solid-outline' }));
      }
    }
    const order = projectCanvasWorkplaneVector({ x, y, z: depth / 2 }, camera).depth;
    if (!person) { blocks.push({ depth: order, group }); continue; }
    group.setAttribute('class', 'canvas-solid-object' + (selected.has(node.id) ? ' is-selected' : ''));
    group.setAttribute('data-node', node.id);
    const text = node.text.trim();
    if (text && zoom >= 0.34) {
      const caption = svg('text', { x: anchor.x, y: bottom + 13, 'text-anchor': 'middle', class: 'canvas-solid-label' });
      caption.textContent = text.length <= 32 ? text : text.slice(0, 31) + '…';
      group.append(caption);
    }
    people.push({ depth: order, group });
  }
  const ordered = (objects: typeof people) => objects.sort((a, b) => a.depth - b.depth).map(({ group }) => group);
  layers.blocks.replaceChildren(...ordered(blocks));
  layers.people.replaceChildren(sphereLighting(), ...ordered(people));
}
