import {
  activeCanvasBoard, addCanvasBoard, addCanvasEdge, addCanvasNode, groupCanvasNodes, removeCanvasEdge, removeCanvasNode,
  renameCanvasBoard, searchCanvas, selectCanvasBoard, updateCanvasBoard, updateCanvasEdge, updateCanvasNode, updateCanvasViewport,
  CANVAS_NODE_KINDS, CANVAS_EDGE_KINDS, type CanvasBoard, type CanvasDocument, type CanvasEdgeKind, type CanvasNode,
  type CanvasNodeKind, type CanvasPoint, type CanvasViewport,
} from '../shared/utils/canvas';
import { arrangeCanvas, routeCanvasEdges, type CanvasLayoutMode } from '../shared/utils/canvas-layout';
import { browserCanvas, setBrowserCanvas } from './ledger';
import type { BrowserStore } from './store';

type Store = Pick<BrowserStore, 'state' | 'update'>;
type Gesture = { id: number; start: CanvasPoint; viewport: CanvasViewport; node?: CanvasNode; dx: number; dy: number };
type Pinch = { distance: number; center: CanvasPoint; viewport: CanvasViewport };
type Edit = (document: CanvasDocument) => CanvasDocument;
const NODE_LABELS: Record<CanvasNodeKind, string> = {
  sticky: 'Sticky note', note: 'Text card', task: 'Task', heading: 'Heading', link: 'Link',
  image: 'Image', checklist: 'Checklist', 'person-circle': 'Person · Circle', 'person-square': 'Person · Square',
  partnership: 'Partnership', group: 'Group',
};
const EDGE_LABELS: Record<CanvasEdgeKind, string> = {
  related: 'Related to', dependency: 'Depends on', partnership: 'Partners', parent: 'Parent → child',
};
const SVG = 'http://www.w3.org/2000/svg';
const MAX_HISTORY = 24;

function html<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}
function label(title: string, control: HTMLElement) {
  const result = html('label', title);
  result.append(control);
  return result;
}
function action(title: string, run: () => void) {
  const button = html('button', title);
  button.type = 'button';
  button.onclick = run;
  return button;
}
function option(value: string, title: string) {
  const result = html('option', title);
  result.value = value;
  return result;
}
function safeUrl(text: string | undefined): string | undefined {
  try {
    const url = new URL(text ?? '');
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch { /* Raw text is still shown in the editor. */ }
}
function groupAncestors(node: CanvasNode, byId: Map<string, CanvasNode>) {
  const ancestors: CanvasNode[] = [];
  let parent = node.groupId;
  while (parent) {
    const group = byId.get(parent);
    if (!group) break;
    ancestors.push(group);
    parent = group.groupId;
  }
  return ancestors;
}

/** A local, account-bound workspace. All persisted mutations run through BrowserStore. */
export class BrowserCanvas {
  private store: Store | null = null;
  private document: CanvasDocument | null = null;
  private pending: Promise<boolean> | null = null;
  private viewTimer: ReturnType<typeof setTimeout> | undefined;
  private viewportDraft: { boardId: string; viewport: CanvasViewport } | undefined;
  private viewport: CanvasViewport = { x: 0, y: 0, zoom: 1 };
  private undoStack: CanvasDocument[] = [];
  private redoStack: CanvasDocument[] = [];
  private selected = new Set<string>();
  private multiple = false;
  private gesture: Gesture | undefined;
  private pinch: Pinch | undefined;
  private pointers = new Map<number, CanvasPoint>();
  private lastTap: { id: string; time: number } | undefined;
  private cards = new Map<string, HTMLButtonElement>();

  private boards = html('select');
  private newBoard = action('New board', () => this.boardDialog(false));
  private rename = action('Rename board', () => this.boardDialog(true));
  private add = action('Add card', () => this.cardDialog());
  private edit = action('Edit card', () => this.cardDialog([...this.selected][0]));
  private multi = action('Select multiple', () => {
    this.multiple = !this.multiple;
    this.updateSelection();
  });
  private group = action('Group', () => this.groupDialog());
  private connect = action('Connect', () => this.edgeDialog());
  private layout = html('select');
  private arrange = action('Auto Arrange', () => { void this.autoArrange(); });
  private search = action('Search', () => this.focusSearch());
  private undoButton = action('Undo', () => { void this.history(this.undoStack, this.redoStack); });
  private redoButton = action('Redo', () => { void this.history(this.redoStack, this.undoStack); });
  private zoomOut = action('−', () => this.zoomBy(0.8));
  private zoomIn = action('+', () => this.zoomBy(1.25));
  private fit = action('Fit board', () => this.fitBoard());
  private status = html('p');
  private surface = html('div');
  private scene = html('div');
  private wires = document.createElementNS(SVG, 'svg');
  private cardLayer = html('div');
  private dialog = html('dialog');
  private dialogHeading = html('h2');
  private dialogContent = html('div');
  private dialogError = html('p');
  private dialogActions = html('div');

  constructor(private host: HTMLElement) {
    const toolbar = html('div');
    toolbar.className = 'canvas-toolbar';
    this.boards.setAttribute('aria-label', 'Canvas board');
    this.boards.onchange = () => {
      const id = this.boards.value;
      void this.flush().then(() => this.commit((current) => selectCanvasBoard(current, id), false))
        .catch((error: unknown) => this.error(error));
      this.selected.clear();
    };
    this.layout.setAttribute('aria-label', 'Canvas layout strategy');
    this.layout.append(option('relationships', 'Relationships'), option('pedigree', 'Pedigree'), option('groups', 'Groups'));
    this.zoomOut.setAttribute('aria-label', 'Zoom out');
    this.zoomIn.setAttribute('aria-label', 'Zoom in');
    toolbar.append(this.boards, this.newBoard, this.rename, this.add, this.edit, this.multi, this.group, this.connect,
      this.layout, this.arrange, this.search, this.undoButton, this.redoButton, this.zoomOut, this.zoomIn, this.fit);
    this.status.className = 'canvas-status';
    this.status.setAttribute('role', 'status');
    this.surface.className = 'canvas-surface';
    this.surface.setAttribute('aria-label', 'Canvas board. Drag the background to pan and cards to move them.');
    this.surface.tabIndex = 0;
    this.scene.className = 'canvas-scene';
    this.wires.classList.add('canvas-wires');
    this.wires.setAttribute('aria-hidden', 'true');
    this.cardLayer.className = 'canvas-cards';
    this.scene.append(this.wires, this.cardLayer);
    this.surface.append(this.scene);
    this.dialog.className = 'canvas-dialog';
    this.dialogHeading.id = 'canvas-dialog-title';
    this.dialog.setAttribute('aria-labelledby', this.dialogHeading.id);
    this.dialogError.className = 'canvas-dialog-error';
    this.dialogError.setAttribute('role', 'alert');
    this.dialogActions.className = 'canvas-dialog-actions';
    this.dialog.append(this.dialogHeading, this.dialogContent, this.dialogError, this.dialogActions);
    this.host.append(toolbar, this.status, this.surface, this.dialog);
    this.bindGestures();
    this.render();
  }

  bind(store: Store | null) {
    if (this.store === store) return;
    this.store = store;
    this.document = store ? browserCanvas(store.state) : null;
    this.pending = null;
    this.viewportDraft = undefined;
    clearTimeout(this.viewTimer);
    this.undoStack = [];
    this.redoStack = [];
    this.selected.clear();
    this.pointers.clear();
    this.gesture = undefined;
    this.pinch = undefined;
    this.lastTap = undefined;
    this.dialog.close();
    this.dialogContent.replaceChildren();
    this.dialogActions.replaceChildren();
    this.dialogError.textContent = '';
    this.viewport = this.board()?.viewport ?? { x: 0, y: 0, zoom: 1 };
    this.status.textContent = store ? '' : 'Unlock Context to use Canvas.';
    this.render();
  }

  hasDraft() { return Boolean(this.pending || this.viewportDraft); }

  async flush() {
    clearTimeout(this.viewTimer);
    if (this.pending && !await this.pending) throw new Error('The Canvas change was not saved.');
    const draft = this.viewportDraft;
    if (!draft) return;
    this.viewportDraft = undefined;
    if (!await this.commit((current) => updateCanvasViewport(current, draft.viewport, draft.boardId), false)) {
      this.viewportDraft = draft;
      throw new Error('The Canvas position was not saved.');
    }
  }

  private board() { return this.document ? activeCanvasBoard(this.document) : undefined; }

  private commit(edit: Edit, remember = true): Promise<boolean> {
    const store = this.store;
    if (!store || this.pending) return Promise.resolve(false);
    let before: CanvasDocument | undefined;
    let changed = false;
    const pending = store.update((state) => {
      if (this.store !== store) throw new Error('The account changed before this Canvas edit was saved.');
      before = browserCanvas(state);
      const next = edit(before);
      changed = next !== before;
      return changed ? setBrowserCanvas(state, next) : state;
    }).then((state) => {
      if (this.store !== store) return false;
      this.document = browserCanvas(state);
      this.viewport = this.board()?.viewport ?? this.viewport;
      if (changed && remember && before) {
        this.undoStack = [...this.undoStack.slice(-(MAX_HISTORY - 1)), before];
        this.redoStack = [];
      }
      this.status.textContent = 'Saved on this browser.';
      this.render();
      return true;
    }).catch((error: unknown) => {
      if (this.store === store) {
        this.error(error);
        this.render();
      }
      return false;
    }).finally(() => {
      if (this.pending === pending) {
        this.pending = null;
        this.updateSelection();
      }
    });
    this.pending = pending;
    this.updateSelection();
    return pending;
  }

  private async history(source: CanvasDocument[], destination: CanvasDocument[]) {
    const next = source.at(-1);
    if (!next || !this.document) return;
    const original = this.document;
    try { await this.flush(); } catch (error) { this.error(error); return; }
    if (await this.commit(() => next, false)) {
      source.pop();
      destination.push(original);
      this.selected.clear();
      this.updateSelection();
    }
  }

  private error(error: unknown) {
    const target = this.dialog.open ? this.dialogError : this.status;
    target.textContent = error instanceof Error ? error.message : 'The Canvas change was not saved.';
  }

  private updateSelection() {
    const board = this.board();
    for (const [id, card] of this.cards) card.setAttribute('aria-pressed', String(this.selected.has(id)));
    const disabled = !board || Boolean(this.pending);
    for (const control of [this.boards, this.newBoard, this.rename, this.add, this.multi, this.layout, this.search,
      this.zoomOut, this.zoomIn, this.fit]) control.disabled = disabled;
    this.edit.disabled = disabled || this.selected.size !== 1;
    this.group.disabled = disabled || this.selected.size < 2;
    this.connect.disabled = disabled || this.selected.size !== 2;
    this.arrange.disabled = disabled || !board?.nodes.length;
    this.undoButton.disabled = disabled || !this.undoStack.length;
    this.redoButton.disabled = disabled || !this.redoStack.length;
    this.multi.setAttribute('aria-pressed', String(this.multiple));
  }

  private render() {
    const board = this.board();
    this.boards.replaceChildren(...(this.document?.boards.map((item) => option(item.id, item.title)) ?? []));
    if (board) this.boards.value = board.id;
    this.cards.clear();
    this.wires.replaceChildren();
    this.cardLayer.replaceChildren();
    if (board) {
      const byId = new Map(board.nodes.map((node) => [node.id, node]));
      const hierarchy = new Map(board.nodes.map((node) => [node.id, groupAncestors(node, byId)]));
      const visible = board.nodes.filter((node) => !hierarchy.get(node.id)!.some((group) => group.collapsed));
      const visibleIds = new Set(visible.map((node) => node.id));
      this.selected = new Set([...this.selected].filter((id) => visibleIds.has(id)));
      this.renderConnections(board);
      const ordered = visible.slice().sort((a, b) => Number(b.kind === 'group') - Number(a.kind === 'group') ||
        hierarchy.get(a.id)!.length - hierarchy.get(b.id)!.length);
      for (const node of ordered) {
        const card = action('', () => {});
        card.className = 'canvas-card canvas-' + node.kind;
        card.dataset.node = node.id;
        card.style.left = node.x + 'px';
        card.style.top = node.y + 'px';
        card.style.width = node.width + 'px';
        card.style.height = node.height + 'px';
        if (node.color) card.style.setProperty('--card-color', node.color);
        if (node.collapsed) card.classList.add('is-collapsed');
        if (node.checked) card.classList.add('is-checked');
        card.setAttribute('aria-label', NODE_LABELS[node.kind] + ': ' + (node.text || node.url || 'Untitled'));
        if (node.source) {
          const linked = html('small', 'Linked to Notepad');
          linked.className = 'canvas-linked';
          card.append(linked);
        }
        const imageUrl = node.kind === 'image' ? safeUrl(node.url) : undefined;
        if (imageUrl) {
          const image = html('img');
          image.src = imageUrl;
          image.loading = 'lazy';
          image.referrerPolicy = 'no-referrer';
          image.alt = '';
          card.append(image);
        }
        const content = html('span', node.text || node.url || NODE_LABELS[node.kind]);
        content.className = 'canvas-card-text';
        card.append(content);
        card.onclick = (event) => { if (event.detail === 0) this.pickCard(node.id, event.shiftKey, event.timeStamp); };
        this.cards.set(node.id, card);
        this.cardLayer.append(card);
      }
      if (!visible.length) {
        const empty = html('p', 'Add a card, or select text in Notepad to put it on this board.');
        empty.className = 'canvas-empty';
        this.cardLayer.append(empty);
      }
    }
    this.paintViewport();
    this.updateSelection();
  }

  private renderConnections(board: CanvasBoard) {
    const defs = document.createElementNS(SVG, 'defs');
    const marker = document.createElementNS(SVG, 'marker');
    marker.setAttribute('id', 'canvas-arrow');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '7');
    marker.setAttribute('refY', '4');
    marker.setAttribute('orient', 'auto');
    const arrow = document.createElementNS(SVG, 'path');
    arrow.setAttribute('d', 'M0 0 L8 4 L0 8 Z');
    arrow.setAttribute('fill', 'currentColor');
    marker.append(arrow);
    defs.append(marker);
    this.wires.append(defs);
    for (const { edge, points } of routeCanvasEdges(board)) {
      if (points.length < 2) continue;
      const wire = document.createElementNS(SVG, 'polyline');
      wire.setAttribute('points', points.map(({ x, y }) => x + ',' + y).join(' '));
      wire.setAttribute('class', 'canvas-wire');
      if (edge.directed) wire.setAttribute('marker-end', 'url(#canvas-arrow)');
      wire.onclick = () => this.edgeDialog(edge.id);
      this.wires.append(wire);
      if (edge.label) {
        const middle = points[Math.floor(points.length / 2)]!;
        const caption = document.createElementNS(SVG, 'text');
        caption.textContent = edge.label;
        caption.setAttribute('x', String(middle.x + 5));
        caption.setAttribute('y', String(middle.y - 5));
        caption.setAttribute('class', 'canvas-wire-label');
        this.wires.append(caption);
      }
    }
  }

  private pickCard(id: string, toggle: boolean, time: number) {
    if (toggle || this.multiple) {
      if (this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
      this.lastTap = undefined;
    } else {
      this.selected = new Set([id]);
      if (this.lastTap?.id === id && time - this.lastTap.time < 420) this.cardDialog(id);
      this.lastTap = { id, time };
    }
    this.updateSelection();
  }

  private paintViewport() {
    const { x, y, zoom } = this.viewport;
    this.scene.style.transform = 'translate(' + -x * zoom + 'px,' + -y * zoom + 'px) scale(' + zoom + ')';
    this.surface.style.backgroundSize = 24 * zoom + 'px ' + 24 * zoom + 'px';
    this.surface.style.backgroundPosition = -x * zoom + 'px ' + -y * zoom + 'px';
  }

  private point(event: PointerEvent | WheelEvent) {
    const bounds = this.surface.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  private setZoom(zoom: number, point: CanvasPoint, baseline = this.viewport, target = point) {
    const next = Math.max(0.15, Math.min(4, zoom));
    this.viewport = { zoom: next, x: baseline.x + point.x / baseline.zoom - target.x / next,
      y: baseline.y + point.y / baseline.zoom - target.y / next };
    this.paintViewport();
  }

  private zoomBy(factor: number) {
    this.setZoom(this.viewport.zoom * factor, { x: this.surface.clientWidth / 2, y: this.surface.clientHeight / 2 });
    this.scheduleViewport();
  }

  private scheduleViewport() {
    const board = this.board();
    if (!board) return;
    this.viewportDraft = { boardId: board.id, viewport: { ...this.viewport } };
    clearTimeout(this.viewTimer);
    this.viewTimer = setTimeout(() => { void this.flush().catch((error: unknown) => this.error(error)); }, 240);
  }

  private fitBoard() {
    const board = this.board();
    if (!board?.nodes.length) return;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const node of board.nodes) {
      left = Math.min(left, node.x);
      right = Math.max(right, node.x + node.width);
      top = Math.min(top, node.y);
      bottom = Math.max(bottom, node.y + node.height);
    }
    const zoom = Math.max(0.15, Math.min(1.8, (this.surface.clientWidth - 48) / (right - left),
      (this.surface.clientHeight - 48) / (bottom - top)));
    this.viewport = { zoom, x: (left + right) / 2 - this.surface.clientWidth / (2 * zoom),
      y: (top + bottom) / 2 - this.surface.clientHeight / (2 * zoom) };
    this.paintViewport();
    this.scheduleViewport();
  }

  private bindGestures() {
    this.surface.addEventListener('wheel', (event) => {
      if (!this.store || this.pending) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) this.setZoom(this.viewport.zoom * Math.exp(-event.deltaY * 0.003), this.point(event));
      else {
        this.viewport = { ...this.viewport, x: this.viewport.x + (event.shiftKey ? event.deltaY : event.deltaX) / this.viewport.zoom,
          y: this.viewport.y + (event.shiftKey ? 0 : event.deltaY) / this.viewport.zoom };
        this.paintViewport();
      }
      this.scheduleViewport();
    }, { passive: false });
    this.surface.onpointerdown = (event) => {
      if (!this.store || this.pending || (event.button !== 0 && event.button !== 1) ||
        (event.target as Element).closest('.canvas-wire')) return;
      const point = this.point(event);
      this.pointers.set(event.pointerId, point);
      this.surface.setPointerCapture(event.pointerId);
      if (this.pointers.size === 2) {
        const [first, second] = [...this.pointers.values()];
        this.clearCardPreview();
        this.gesture = undefined;
        this.pinch = { distance: Math.max(1, Math.hypot(first!.x - second!.x, first!.y - second!.y)),
          center: { x: (first!.x + second!.x) / 2, y: (first!.y + second!.y) / 2 }, viewport: this.viewport };
        return;
      }
      if (this.pointers.size > 1) return;
      const id = (event.target as Element).closest<HTMLElement>('.canvas-card')?.dataset.node;
      const node = event.button === 0 ? this.board()?.nodes.find((item) => item.id === id) : undefined;
      this.gesture = { id: event.pointerId, start: point, viewport: this.viewport, node, dx: 0, dy: 0 };
    };
    this.surface.onpointermove = (event) => {
      if (!this.pointers.has(event.pointerId)) return;
      const point = this.point(event);
      this.pointers.set(event.pointerId, point);
      if (this.pinch && this.pointers.size === 2) {
        const [first, second] = [...this.pointers.values()];
        const distance = Math.hypot(first!.x - second!.x, first!.y - second!.y);
        this.setZoom(this.pinch.viewport.zoom * distance / this.pinch.distance, this.pinch.center, this.pinch.viewport,
          { x: (first!.x + second!.x) / 2, y: (first!.y + second!.y) / 2 });
        return;
      }
      const gesture = this.gesture;
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = point.x - gesture.start.x, dy = point.y - gesture.start.y;
      if (Math.hypot(dx, dy) < 4 && !gesture.dx && !gesture.dy) return;
      gesture.dx = dx / gesture.viewport.zoom;
      gesture.dy = dy / gesture.viewport.zoom;
      if (gesture.node) this.previewCardMove(gesture);
      else {
        this.viewport = { ...gesture.viewport, x: gesture.viewport.x - gesture.dx, y: gesture.viewport.y - gesture.dy };
        this.paintViewport();
      }
    };
    const end = (event: PointerEvent, cancelled: boolean) => {
      if (!this.pointers.delete(event.pointerId)) return;
      if (this.pinch) {
        if (!this.pointers.size) { this.pinch = undefined; this.scheduleViewport(); }
        return;
      }
      const gesture = this.gesture;
      if (!gesture || gesture.id !== event.pointerId) return;
      this.gesture = undefined;
      if (!gesture.node) {
        if (gesture.dx || gesture.dy) this.scheduleViewport();
        else if (!cancelled) { this.selected.clear(); this.updateSelection(); }
        return;
      }
      this.clearCardPreview();
      if (cancelled) return;
      if (!gesture.dx && !gesture.dy) {
        this.pickCard(gesture.node.id, event.shiftKey, event.timeStamp);
        return;
      }
      const node = gesture.node;
      const boardId = this.board()?.id;
      this.selected = new Set([node.id]);
      void this.flush().then(() => this.commit((current) =>
        updateCanvasNode(current, node.id, { x: node.x + gesture.dx, y: node.y + gesture.dy }, boardId)))
        .catch((error: unknown) => this.error(error));
    };
    this.surface.onpointerup = (event) => end(event, false);
    this.surface.onpointercancel = this.surface.onlostpointercapture = (event) => end(event, true);
    this.surface.onkeydown = (event) => {
      if (event.target !== this.surface || !this.store || this.pending || this.dialog.open) return;
      const directions: Record<string, CanvasPoint> = {
        ArrowLeft: { x: -50, y: 0 }, ArrowRight: { x: 50, y: 0 },
        ArrowUp: { x: 0, y: -50 }, ArrowDown: { x: 0, y: 50 },
      };
      const direction = directions[event.key];
      if (direction) {
        event.preventDefault();
        this.viewport = { ...this.viewport, x: this.viewport.x + direction.x / this.viewport.zoom,
          y: this.viewport.y + direction.y / this.viewport.zoom };
        this.paintViewport();
        this.scheduleViewport();
      } else if (event.key === '+' || event.key === '=') this.zoomBy(1.25);
      else if (event.key === '-') this.zoomBy(0.8);
      else if (event.key.toLowerCase() === 'n') this.cardDialog();
    };
  }

  private previewCardMove(gesture: Gesture) {
    const board = this.board();
    if (!board || !gesture.node) return;
    const nodeId = gesture.node.id;
    const byId = new Map(board.nodes.map((node) => [node.id, node]));
    const moving = new Set(board.nodes.filter((node) => node.id === nodeId ||
      groupAncestors(node, byId).some((parent) => parent.id === nodeId)).map((node) => node.id));
    for (const id of moving) {
      const card = this.cards.get(id);
      if (card) card.style.transform = 'translate(' + gesture.dx + 'px,' + gesture.dy + 'px)';
    }
    // Keep attached lines aligned while dragging manageable boards. The final
    // save reroutes the complete graph regardless of its size.
    if (board.edges.length <= 100) {
      const preview = { ...board, nodes: board.nodes.map((node) => moving.has(node.id)
        ? { ...node, x: node.x + gesture.dx, y: node.y + gesture.dy } : node) };
      this.wires.replaceChildren();
      this.renderConnections(preview);
    }
  }

  private clearCardPreview() {
    for (const card of this.cards.values()) card.style.transform = '';
    const board = this.board();
    if (board) {
      this.wires.replaceChildren();
      this.renderConnections(board);
    }
  }

  private openDialog(title: string, controls: HTMLElement[], buttons: HTMLButtonElement[]) {
    if (!this.store || this.pending) return;
    this.dialogHeading.textContent = title;
    this.dialogError.textContent = '';
    this.dialogContent.replaceChildren(...controls);
    this.dialogActions.replaceChildren(...buttons, action('Cancel', () => this.dialog.close()));
    if (!this.dialog.open) this.dialog.showModal();
  }

  private saveDialog(edit: Edit, after?: () => void) {
    const store = this.store;
    const current = this.dialogContent.firstChild;
    this.dialogError.textContent = '';
    void this.flush().then(() => this.store === store && this.dialog.open &&
      this.dialogContent.firstChild === current && this.commit(edit)).then((saved) => {
      if (saved) { this.dialog.close(); after?.(); }
    }).catch((error: unknown) => this.error(error));
  }

  private boardDialog(rename: boolean) {
    const current = this.board();
    if (!current) return;
    const name = html('input');
    name.value = rename ? current.title : '';
    this.openDialog(rename ? 'Rename board' : 'New Canvas board', [label('Board name', name)], [
      action('Save', () => this.saveDialog((doc) => rename ? renameCanvasBoard(doc, current.id, name.value) : addCanvasBoard(doc, name.value),
        () => { this.selected.clear(); this.updateSelection(); })),
    ]);
    name.focus();
  }

  private cardDialog(id?: string) {
    const board = this.board();
    if (!board) return;
    const existing = board.nodes.find((node) => node.id === id);
    const kind = html('select');
    kind.append(...CANVAS_NODE_KINDS.map((value) => option(value, NODE_LABELS[value])));
    kind.value = existing?.kind ?? 'sticky';
    const content = html('textarea');
    content.value = existing?.text ?? '';
    content.rows = 5;
    const color = html('input');
    color.type = 'color';
    color.value = existing?.color?.length === 7 ? existing.color : '#eed798';
    let changedColor = false;
    color.oninput = () => { changedColor = true; };
    const url = html('input');
    url.type = 'url';
    url.value = existing?.url ?? '';
    const checked = html('input');
    checked.type = 'checkbox';
    checked.checked = Boolean(existing?.checked);
    const width = html('input'), height = html('input');
    for (const item of [width, height]) { item.type = 'number'; item.min = '24'; item.max = '1000000000'; }
    width.value = existing ? String(existing.width) : '';
    height.value = existing ? String(existing.height) : '';
    const collapsed = html('input');
    collapsed.type = 'checkbox';
    collapsed.checked = Boolean(existing?.collapsed);
    const controls: HTMLElement[] = [label('Card type', kind), label(existing?.source ? 'Text linked to Notepad' : 'Card text', content),
      label('Card color', color), label('Link or image URL', url), label('Completed', checked),
      label('Width', width), label('Height', height), label('Collapse group', collapsed)];
    const href = safeUrl(existing?.url);
    if (href && existing?.kind === 'link') {
      const link = html('a', 'Open link');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      controls.push(link);
    }
    const connectionList = html('div');
    if (existing) {
      const edges = board.edges.filter((edge) => edge.from === existing.id || edge.to === existing.id);
      for (const edge of edges) {
        const counterpart = board.nodes.find((node) => node.id === (edge.from === existing.id ? edge.to : edge.from));
        connectionList.append(action('Edit connection · ' + (edge.label || counterpart?.text || EDGE_LABELS[edge.kind]), () => this.edgeDialog(edge.id)));
      }
      if (edges.length) controls.push(connectionList);
    }
    const buttons = [action('Save card', () => {
      let nodeId = id;
      this.saveDialog((doc) => {
        const chosen = kind.value as CanvasNodeKind;
        const fields = { kind: chosen, text: content.value, url: url.value || undefined,
          color: changedColor ? color.value : existing?.color,
          ...(chosen === 'task' || chosen === 'checklist' ? { checked: checked.checked } : {}),
          ...(chosen === 'group' ? { collapsed: collapsed.checked } : {}),
          ...(width.value ? { width: Number(width.value) } : {}), ...(height.value ? { height: Number(height.value) } : {}) };
        if (nodeId) return updateCanvasNode(doc, nodeId, fields, board.id);
        const added = addCanvasNode(doc, fields, board.id);
        nodeId = added.nodeId;
        return added.document;
      }, () => {
        if (nodeId) { this.selected = new Set([nodeId]); this.updateSelection(); }
      });
    })];
    if (existing) buttons.push(action(existing.kind === 'group' ? 'Ungroup' : 'Delete card', () =>
      this.saveDialog((doc) => removeCanvasNode(doc, existing.id, board.id))));
    this.openDialog(existing ? 'Edit Canvas card' : 'Add Canvas card', controls, buttons);
    content.focus();
  }

  private groupDialog() {
    const board = this.board();
    if (!board || this.selected.size < 2) return;
    const ids = [...this.selected];
    const title = html('input');
    title.value = 'Group';
    this.openDialog('Group selected cards', [label('Group name', title)], [action('Create group', () => {
      let id = '';
      this.saveDialog((doc) => {
        const result = groupCanvasNodes(doc, ids, title.value, board.id);
        id = result.nodeId;
        return result.document;
      }, () => { this.selected = new Set([id]); this.updateSelection(); });
    })]);
    title.select();
  }

  private edgeDialog(id?: string) {
    const board = this.board();
    if (!board) return;
    const existing = board.edges.find((edge) => edge.id === id);
    const [from, to] = existing ? [existing.from, existing.to] : [...this.selected];
    if (!from || !to) return;
    const kind = html('select');
    kind.append(...CANVAS_EDGE_KINDS.map((value) => option(value, EDGE_LABELS[value])));
    kind.value = existing?.kind ?? 'related';
    const directed = html('input');
    directed.type = 'checkbox';
    directed.checked = Boolean(existing?.directed);
    kind.onchange = () => { directed.checked = kind.value === 'parent' || kind.value === 'dependency'; };
    const caption = html('input');
    caption.value = existing?.label ?? '';
    const names = [from, to].map((endpoint) => board.nodes.find((node) => node.id === endpoint)?.text || 'Untitled');
    const reverse = html('input');
    reverse.type = 'checkbox';
    const buttons = [action('Save connection', () => this.saveDialog((doc) => {
      const input = { from: reverse.checked ? to : from, to: reverse.checked ? from : to,
        kind: kind.value as CanvasEdgeKind, directed: directed.checked, label: caption.value || undefined };
      return existing ? updateCanvasEdge(doc, existing.id, input, board.id) : addCanvasEdge(doc, input, board.id);
    }))];
    if (existing) buttons.push(action('Delete connection', () => this.saveDialog((doc) => removeCanvasEdge(doc, existing.id, board.id))));
    this.openDialog(existing ? 'Edit connection' : 'Connect selected cards', [
      html('p', names.join(' → ')), label('Relationship', kind), label('Show direction', directed),
      label('Reverse endpoints', reverse), label('Label', caption),
    ], buttons);
  }

  private async autoArrange() {
    const board = this.board();
    if (!board) return;
    const mode = this.layout.value as CanvasLayoutMode;
    try {
      await this.flush();
      if (await this.commit((doc) => updateCanvasBoard(doc, board.id, (current) => arrangeCanvas(current, mode)))) this.fitBoard();
    } catch (error) { this.error(error); }
  }

  focusSearch() {
    if (!this.document) return;
    const input = html('input');
    input.type = 'search';
    const results = html('div');
    results.className = 'canvas-results';
    input.oninput = () => {
      const matches = this.document ? searchCanvas(this.document, input.value) : [];
      results.replaceChildren(...matches.slice(0, 100).map(({ boardId, boardTitle, node }) =>
        action(boardTitle + ' · ' + (node.text || node.url || NODE_LABELS[node.kind]), () => {
          this.dialog.close();
          void this.reveal(node.id, boardId);
        })));
      if (input.value.trim() && !matches.length) results.append(html('p', 'No matching cards.'));
    };
    this.openDialog('Search Canvas', [label('Find a card or board', input), results], []);
    input.focus();
  }

  async reveal(id: string, boardId = this.board()?.id) {
    if (!boardId) return;
    try {
      await this.flush();
      const saved = await this.commit((doc) => {
        const selected = selectCanvasBoard(doc, boardId);
        const board = activeCanvasBoard(selected);
        const node = board.nodes.find((item) => item.id === id);
        if (!node) throw new Error('This Canvas card is unavailable.');
        const byId = new Map(board.nodes.map((item) => [item.id, item]));
        const parents = new Set(groupAncestors(node, byId).filter((group) => group.collapsed).map((group) => group.id));
        const zoom = board.viewport.zoom;
        return updateCanvasBoard(selected, boardId, (current) => ({ ...current,
          nodes: current.nodes.map((item) => parents.has(item.id) ? { ...item, collapsed: false } : item),
          viewport: { zoom, x: node.x + node.width / 2 - this.surface.clientWidth / (2 * zoom),
            y: node.y + node.height / 2 - this.surface.clientHeight / (2 * zoom) },
        }));
      }, false);
      if (saved) { this.selected = new Set([id]); this.updateSelection(); this.cards.get(id)?.focus(); }
    } catch (error) { this.error(error); }
  }
}
