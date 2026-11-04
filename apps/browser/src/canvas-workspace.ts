import {
  activeCanvasBoard, addCanvasBoard, addCanvasEdge, addCanvasNode, addCanvasSpace, addCanvasStroke, canvasFamilyPositionIds, canvasSpacesAtPoint,
  groupCanvasNodes, isCanvasPerson, removeCanvasEdge, removeCanvasFamily, removeCanvasNode, removeCanvasSpace, renameCanvasBoard,
  saveCanvasFamily, searchCanvas,
  selectCanvasBoard, setCanvasNodeSpaces, updateCanvasBoard, updateCanvasEdge, updateCanvasNode, updateCanvasSpace, updateCanvasViewport,
  CANVAS_NODE_KINDS, CANVAS_EDGE_KINDS, CANVAS_FAMILY_LABEL_LIMIT, CANVAS_STROKE_POINT_LIMIT, type CanvasBoard, type CanvasDocument, type CanvasEdgeKind, type CanvasNode,
  type CanvasFamilyPersonInput, type CanvasNodeKind, type CanvasPoint, type CanvasSpace, type CanvasStroke, type CanvasViewport,
} from '../shared/utils/canvas';
import { arrangeCanvas, canvasPersonSymbol, routeCanvasEdges, routeCanvasFamilies, type CanvasLayoutMode } from '../shared/utils/canvas-layout';
import { canvasWorkplaneGrid, canvasWorkplaneMatrix, nextCanvasWorkplaneTurn, projectCanvasWorkplane,
  unprojectCanvasWorkplane, type CanvasWorkplaneTurn } from '../shared/utils/canvas-workplane';
import { browserCanvas, setBrowserCanvas } from './ledger';
import type { BrowserStore } from './store';

type Store = Pick<BrowserStore, 'state' | 'update'>;
type Tool = 'select' | 'draw' | 'space';
type SpaceBounds = Pick<CanvasSpace, 'x' | 'y' | 'width' | 'height'>;
type Gesture = { id: number; start: CanvasPoint; viewport: CanvasViewport; dx: number; dy: number; moved: boolean } &
  ({ kind: 'pan'; captureText: boolean } | { kind: 'card'; node: CanvasNode; fixed: boolean } | { kind: 'draw'; points: CanvasPoint[] } |
    { kind: 'create-space' } | { kind: 'move-space' | 'resize-space'; space: CanvasSpace });
type SpaceElements = { shape: SVGEllipseElement; title: HTMLButtonElement; resize: HTMLButtonElement };
type Pinch = { distance: number; center: CanvasPoint; viewport: CanvasViewport };
type Edit = (document: CanvasDocument) => CanvasDocument;
const NODE_LABELS: Record<CanvasNodeKind, string> = {
  sticky: 'Sticky note', note: 'Text card', task: 'Task', heading: 'Heading', link: 'Link',
  image: 'Image', checklist: 'Checklist', 'person-circle': 'Female · Circle', 'person-square': 'Male · Square',
  'person-diamond': 'Unknown · Diamond',
  partnership: 'Partnership', group: 'Group',
};
const EDGE_LABELS: Record<CanvasEdgeKind, string> = {
  related: 'Related to', dependency: 'Depends on', partnership: 'Partners', parent: 'Parent → child',
};
const SVG = 'http://www.w3.org/2000/svg';
const MAX_HISTORY = 24;
const SPACE_COLORS = ['#8d8277', '#748795', '#778879', '#887993'];
const SPACE_MIN_SIZE = 80;
const STROKE_WIDTH = 3;

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

const PERSON_KINDS = ['person-square', 'person-circle', 'person-diamond'] as const;
type PersonKind = typeof PERSON_KINDS[number];

function familyPersonField(people: CanvasNode[], kind: PersonKind, id?: string) {
  const field = html('fieldset');
  field.className = 'canvas-family-person';
  const legend = html('legend');
  const person = html('select');
  person.append(option('', 'New person'), ...people.map((node) => option(node.id, node.text || NODE_LABELS[node.kind])));
  person.value = id ?? '';
  const name = html('input');
  name.placeholder = 'Name';
  const symbol = html('select');
  symbol.append(...PERSON_KINDS.map((value) => option(value, NODE_LABELS[value])));
  symbol.value = kind;
  const entry = html('div');
  entry.className = 'canvas-family-entry';
  entry.hidden = Boolean(person.value);
  person.onchange = () => { entry.hidden = Boolean(person.value); };
  entry.append(label('Name', name), label('Symbol', symbol));
  field.append(legend, label('Person', person), entry);
  const read = (): CanvasFamilyPersonInput => person.value ? { id: person.value } : { name: name.value, kind: symbol.value as PersonKind };
  return { field, legend, read };
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
function boardPoint(point: CanvasPoint, viewport: CanvasViewport) {
  return { x: viewport.x + point.x / viewport.zoom, y: viewport.y + point.y / viewport.zoom };
}
function viewPoint(point: CanvasPoint, viewport: CanvasViewport) {
  return { x: (point.x - viewport.x) * viewport.zoom, y: (point.y - viewport.y) * viewport.zoom };
}
function cardSpaceIds(board: CanvasBoard, node: CanvasNode) {
  return canvasSpacesAtPoint(board.spaces ?? [], { x: node.x + node.width / 2, y: node.y + node.height / 2 });
}
function placedSpace(gesture: Gesture): SpaceBounds {
  const point = boardPoint(gesture.start, gesture.viewport);
  if (!gesture.moved) return { ...point, width: 360, height: 240 };
  const width = Math.max(SPACE_MIN_SIZE, Math.abs(gesture.dx));
  const height = Math.max(SPACE_MIN_SIZE, Math.abs(gesture.dy));
  return { x: point.x + (gesture.dx < 0 ? -width : 0), y: point.y + (gesture.dy < 0 ? -height : 0), width, height };
}
function changedSpace(gesture: Extract<Gesture, { space: CanvasSpace }>): SpaceBounds {
  const { x, y, width, height } = gesture.space;
  return gesture.kind === 'resize-space'
    ? { x, y, width: Math.max(SPACE_MIN_SIZE, width + gesture.dx * Math.SQRT2),
      height: Math.max(SPACE_MIN_SIZE, height + gesture.dy * Math.SQRT2) }
    : { x: x + gesture.dx, y: y + gesture.dy, width, height };
}

/** A local, account-bound workspace. All persisted mutations run through BrowserStore. */
export class BrowserCanvas {
  private store: Store | null = null;
  private document: CanvasDocument | null = null;
  private pending: Promise<boolean> | null = null;
  private viewTimer: ReturnType<typeof setTimeout> | undefined;
  private viewportDraft: { boardId: string; viewport: CanvasViewport } | undefined;
  private viewport: CanvasViewport = { x: 0, y: 0, zoom: 1 };
  private workplane = false;
  private turn: CanvasWorkplaneTurn = 0;
  private undoStack: CanvasDocument[] = [];
  private redoStack: CanvasDocument[] = [];
  private historyOperation: object | null = null;
  private lastHistoryState = { undo: false, redo: false };
  private selected = new Set<string>();
  private selectedSpace: string | undefined;
  private tool: Tool = 'select';
  private multiple = false;
  private gesture: Gesture | undefined;
  private pinch: Pinch | undefined;
  private pointers = new Map<number, CanvasPoint>();
  private lastTap: { id: string; time: number } | undefined;
  private cards = new Map<string, HTMLButtonElement>();
  private fixedFamilyCards = new Set<string>();
  private spaces = new Map<string, SpaceElements>();
  private inlineDraft: { boardId: string; point: CanvasPoint; input: HTMLTextAreaElement; form: HTMLFormElement } | undefined;
  private inlineSave: Promise<void> | undefined;

  private boards = html('select');
  private newBoard = action('New board', () => this.boardDialog(false));
  private rename = action('Rename board', () => this.boardDialog(true));
  private add = action('Add card', () => this.cardDialog());
  private addFamily = action('Add family', () => this.familyDialog());
  private families = action('Families', () => this.familyList());
  private edit = action('Edit card', () => this.cardDialog([...this.selected][0]));
  private selectTool = action('Select', () => this.changeTool('select'));
  private drawTool = action('Draw', () => this.changeTool('draw'));
  private spaceTool = action('Space', () => this.changeTool('space'));
  private editSpace = action('Edit space', () => this.spaceDialog(this.selectedSpace));
  private multi = action('Select multiple', () => {
    this.multiple = !this.multiple;
    this.updateSelection();
  });
  private group = action('Group', () => this.groupDialog());
  private connect = action('Connect', () => this.edgeDialog());
  private layout = html('select');
  private arrange = action('Auto Arrange', () => { void this.autoArrange(); });
  private search = action('Search', () => this.focusSearch());
  private undoButton = action('↶', () => { void this.undo(); });
  private redoButton = action('↷', () => { void this.redo(); });
  private zoomOut = action('−', () => this.zoomBy(0.8));
  private zoomIn = action('+', () => this.zoomBy(1.25));
  private fit = action('Fit board', () => this.fitBoard());
  private flatView = action('Flat', () => this.changeWorkplane(false));
  private planeView = action('3D', () => this.changeWorkplane(true));
  private rotateView = action('Rotate', () => {
    if (!this.workplane || this.pointers.size) return;
    this.turn = nextCanvasWorkplaneTurn(this.turn);
    this.paintViewport();
  });
  private status = html('p');
  private surface = html('div');
  private plane = html('div');
  private planeGrid = document.createElementNS(SVG, 'svg');
  private gridPaths = {
    minor: document.createElementNS(SVG, 'path'), major: document.createElementNS(SVG, 'path'),
    x: document.createElementNS(SVG, 'path'), y: document.createElementNS(SVG, 'path'),
  };
  private scene = html('div');
  private spaceShapes = document.createElementNS(SVG, 'svg');
  private spaceControls = html('div');
  private spacePreview = document.createElementNS(SVG, 'ellipse');
  private strokes = document.createElementNS(SVG, 'svg');
  private strokePreview = document.createElementNS(SVG, 'polyline');
  private wires = document.createElementNS(SVG, 'svg');
  private cardLayer = html('div');
  private dialog = html('dialog');
  private dialogHeading = html('h2');
  private dialogContent = html('div');
  private dialogError = html('p');
  private dialogActions = html('div');

  constructor(private host: HTMLElement, private onHistoryChange?: () => void) {
    const toolbar = html('div');
    toolbar.className = 'canvas-toolbar';
    this.boards.setAttribute('aria-label', 'Canvas board');
    this.boards.onchange = () => {
      const id = this.boards.value;
      void this.flush().then(() => this.commit((current) => selectCanvasBoard(current, id), false))
        .catch((error: unknown) => this.error(error));
      this.selected.clear();
      this.selectedSpace = undefined;
    };
    this.layout.setAttribute('aria-label', 'Canvas layout strategy');
    this.layout.append(option('relationships', 'Relationships'), option('pedigree', 'Pedigree'), option('groups', 'Groups'));
    this.zoomOut.setAttribute('aria-label', 'Zoom out');
    this.zoomIn.setAttribute('aria-label', 'Zoom in');
    const tools = html('div');
    tools.className = 'canvas-tools';
    tools.setAttribute('role', 'group');
    tools.setAttribute('aria-label', 'Canvas tools');
    tools.append(this.selectTool, this.drawTool, this.spaceTool);
    this.selectTool.title = 'Select and move cards. Click empty space to write.';
    this.drawTool.title = 'Draw freehand on the board.';
    this.spaceTool.title = 'Click or drag to create an overlapping space.';
    const views = html('div');
    views.className = 'canvas-tools';
    views.setAttribute('role', 'group');
    views.setAttribute('aria-label', 'Canvas view');
    this.planeView.title = 'View the same board on the angled Workplane.';
    this.rotateView.title = 'Rotate the Workplane by a quarter turn.';
    views.append(this.flatView, this.planeView, this.rotateView);
    for (const [button, name] of [[this.undoButton, 'Undo'], [this.redoButton, 'Redo']] as const) {
      button.className = 'canvas-history-icon';
      button.setAttribute('aria-label', name);
      button.title = name + ' Canvas edit';
    }
    const history = html('div');
    history.className = 'canvas-tools';
    history.setAttribute('role', 'group');
    history.setAttribute('aria-label', 'Canvas edit history');
    history.append(this.undoButton, this.redoButton);
    toolbar.append(this.boards, views);
    if (!this.onHistoryChange) toolbar.append(history);
    toolbar.append(this.newBoard, this.rename, tools, this.add, this.addFamily, this.families, this.edit,
      this.editSpace, this.multi, this.group, this.connect, this.layout, this.arrange, this.search, this.zoomOut, this.zoomIn, this.fit);
    this.status.className = 'canvas-status';
    this.status.setAttribute('role', 'status');
    this.surface.className = 'canvas-surface';
    this.surface.setAttribute('aria-label', 'Canvas board. Click empty space to write. Drag the background to pan.');
    this.surface.tabIndex = 0;
    this.plane.className = 'canvas-plane';
    this.planeGrid.classList.add('canvas-plane-grid');
    this.planeGrid.setAttribute('aria-hidden', 'true');
    for (const [kind, path] of Object.entries(this.gridPaths)) {
      path.setAttribute('class', 'canvas-plane-grid-' + kind);
      this.planeGrid.append(path);
    }
    this.scene.className = 'canvas-scene';
    this.spaceShapes.classList.add('canvas-spaces');
    this.spaceShapes.setAttribute('aria-hidden', 'true');
    this.spaceControls.className = 'canvas-space-controls';
    this.spacePreview.setAttribute('class', 'canvas-space canvas-space-preview');
    this.strokes.classList.add('canvas-strokes');
    this.strokes.setAttribute('aria-hidden', 'true');
    this.wires.classList.add('canvas-wires');
    this.wires.setAttribute('aria-hidden', 'true');
    this.cardLayer.className = 'canvas-cards';
    this.scene.append(this.spaceShapes, this.strokes, this.wires, this.spaceControls, this.cardLayer);
    this.plane.append(this.planeGrid, this.scene);
    this.surface.append(this.plane, this.status);
    this.dialog.className = 'canvas-dialog';
    this.dialogHeading.id = 'canvas-dialog-title';
    this.dialog.setAttribute('aria-labelledby', this.dialogHeading.id);
    this.dialogError.className = 'canvas-dialog-error';
    this.dialogError.setAttribute('role', 'alert');
    this.dialogActions.className = 'canvas-dialog-actions';
    this.dialog.append(this.dialogHeading, this.dialogContent, this.dialogError, this.dialogActions);
    this.host.append(toolbar, this.surface, this.dialog);
    this.bindGestures();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.paintViewport()).observe(this.surface);
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
    this.historyOperation = null;
    this.selected.clear();
    this.selectedSpace = undefined;
    this.tool = 'select';
    this.closeInline();
    this.pointers.clear();
    this.gesture = undefined;
    this.pinch = undefined;
    this.lastTap = undefined;
    this.inlineSave = undefined;
    this.dialog.close();
    this.dialogContent.replaceChildren();
    this.dialogActions.replaceChildren();
    this.dialogError.textContent = '';
    this.viewport = this.board()?.viewport ?? { x: 0, y: 0, zoom: 1 };
    this.status.textContent = store ? '' : 'Unlock Context to use Canvas.';
    this.render();
  }

  hasDraft() { return Boolean(this.pending || this.viewportDraft || this.inlineDraft?.input.value.trim()); }

  historyState() {
    const ready = Boolean(this.store && !this.pending && !this.historyOperation);
    const inline = Boolean(this.inlineDraft?.input.value.trim());
    return { undo: ready && (inline || this.undoStack.length > 0), redo: ready && !inline && this.redoStack.length > 0 };
  }

  async undo() { await this.history('undo'); }
  async redo() { await this.history('redo'); }

  openCreate(kind: 'card' | 'family' | 'space' | 'board') {
    if (!this.store || this.pending) return;
    switch (kind) {
      case 'card': this.cardDialog(); break;
      case 'family': this.familyDialog(); break;
      case 'space': this.changeTool('space'); break;
      case 'board': this.boardDialog(false); break;
    }
  }

  async flush() {
    await this.flushViewport();
    if (this.inlineSave) return this.inlineSave;
    const inline = this.inlineDraft;
    if (!inline) return;
    const value = inline.input.value;
    if (!value.trim()) { this.closeInline(); return; }
    inline.input.readOnly = true;
    const pending = this.commit((current) => {
      const added = addCanvasNode(current, { kind: 'note', ...inline.point, text: value }, inline.boardId);
      return this.assignCardSpaces(added.document, inline.boardId, added.nodeId);
    }).then((saved) => {
      if (!saved) throw new Error('The Canvas note was not saved.');
      if (this.inlineDraft === inline) this.closeInline();
    }).finally(() => {
      inline.input.readOnly = false;
      if (this.inlineSave === pending) this.inlineSave = undefined;
    });
    this.inlineSave = pending;
    return pending;
  }

  private async flushViewport() {
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

  private assignCardSpaces(doc: CanvasDocument, boardId: string, nodeId: string) {
    const board = doc.boards.find((item) => item.id === boardId);
    const node = board?.nodes.find((item) => item.id === nodeId);
    if (!board || !node) return doc;
    return setCanvasNodeSpaces(doc, nodeId, cardSpaceIds(board, node), boardId);
  }

  private changeTool(tool: Tool) {
    if (tool === this.tool) return;
    const store = this.store;
    void this.flush().then(() => {
      if (this.store !== store) return;
      this.tool = tool;
      this.updateSelection();
    }).catch((error: unknown) => this.error(error));
  }

  private changeWorkplane(enabled: boolean) {
    if (this.workplane === enabled || this.pointers.size) return;
    this.workplane = enabled;
    this.updateSelection();
    this.paintViewport();
  }

  private startInline(point: CanvasPoint) {
    const board = this.board();
    if (!board) return;
    const form = html('form');
    form.className = 'canvas-inline';
    const input = html('textarea');
    input.rows = 2;
    input.placeholder = 'Write here';
    input.setAttribute('aria-label', 'Canvas note');
    input.oninput = () => this.updateHistoryControls();
    const finish = () => { void this.flush().catch((error: unknown) => this.error(error)); };
    const save = action('✓', finish);
    save.setAttribute('aria-label', 'Save Canvas note');
    form.append(input, save);
    form.onsubmit = (event) => { event.preventDefault(); finish(); };
    input.onkeydown = (event) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); this.closeInline(); this.surface.focus(); }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(); }
    };
    this.inlineDraft = { boardId: board.id, point, input, form };
    this.surface.append(form);
    this.positionInline();
    input.focus({ preventScroll: true });
  }

  private positionInline() {
    if (!this.inlineDraft) return;
    const { form, point } = this.inlineDraft;
    const screen = viewPoint(point, this.viewport);
    const { width, height } = this.surfaceSize();
    const anchor = this.workplane ? projectCanvasWorkplane(screen, { width, height }, this.turn) : screen;
    form.style.left = Math.max(0, Math.min(anchor.x, width - form.offsetWidth)) + 'px';
    form.style.top = Math.max(0, Math.min(anchor.y, height - form.offsetHeight)) + 'px';
  }

  private closeInline() {
    this.inlineDraft?.form.remove();
    this.inlineDraft = undefined;
    this.updateHistoryControls();
  }

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

  private async history(direction: 'undo' | 'redo') {
    if (!this.historyState()[direction]) return;
    const operation = {};
    this.historyOperation = operation;
    this.updateSelection();
    try {
      await this.flush();
      if (this.historyOperation !== operation || !this.document) return;
      const source = direction === 'undo' ? this.undoStack : this.redoStack;
      const destination = direction === 'undo' ? this.redoStack : this.undoStack;
      const next = source.at(-1);
      if (!next) return;
      const original = this.document;
      if (await this.commit((current) => {
        if (JSON.stringify(current) !== JSON.stringify(original)) throw new Error('Canvas changed before the history action could be applied.');
        return next;
      }, false) && this.historyOperation === operation) {
        source.pop();
        destination.push(original);
        this.selected.clear();
      }
    } catch (error) {
      if (this.historyOperation === operation) this.error(error);
    } finally {
      if (this.historyOperation === operation) {
        this.historyOperation = null;
        this.updateSelection();
      }
    }
  }

  private updateHistoryControls() {
    const next = this.historyState();
    this.undoButton.disabled = !next.undo;
    this.redoButton.disabled = !next.redo;
    if (next.undo === this.lastHistoryState.undo && next.redo === this.lastHistoryState.redo) return;
    this.lastHistoryState = next;
    this.onHistoryChange?.();
  }

  private error(error: unknown) {
    const target = this.dialog.open ? this.dialogError : this.status;
    target.textContent = error instanceof Error ? error.message : 'The Canvas change was not saved.';
  }

  private updateSelection() {
    const board = this.board();
    for (const [id, card] of this.cards) card.setAttribute('aria-pressed', String(this.selected.has(id)));
    for (const [id, space] of this.spaces) {
      const selected = this.selectedSpace === id;
      space.shape.classList.toggle('is-selected', selected);
      space.title.setAttribute('aria-pressed', String(selected));
      space.resize.hidden = !selected;
    }
    const disabled = !board || Boolean(this.pending || this.historyOperation);
    for (const control of [this.boards, this.newBoard, this.rename, this.add, this.addFamily, this.multi, this.layout, this.search,
      this.selectTool, this.drawTool, this.spaceTool, this.zoomOut, this.zoomIn, this.fit, this.flatView, this.planeView]) control.disabled = disabled;
    this.flatView.setAttribute('aria-pressed', String(!this.workplane));
    this.planeView.setAttribute('aria-pressed', String(this.workplane));
    this.rotateView.disabled = disabled || !this.workplane;
    this.surface.dataset.tool = this.tool;
    this.selectTool.setAttribute('aria-pressed', String(this.tool === 'select'));
    this.drawTool.setAttribute('aria-pressed', String(this.tool === 'draw'));
    this.spaceTool.setAttribute('aria-pressed', String(this.tool === 'space'));
    this.edit.disabled = disabled || this.selected.size !== 1;
    this.families.hidden = !board?.families?.length;
    this.families.disabled = disabled;
    this.editSpace.hidden = !this.selectedSpace;
    this.editSpace.disabled = disabled;
    this.group.disabled = disabled || this.selected.size < 2;
    this.connect.disabled = disabled || this.selected.size !== 2;
    this.arrange.disabled = disabled || !board?.nodes.length;
    this.updateHistoryControls();
    this.multi.setAttribute('aria-pressed', String(this.multiple));
  }

  private render() {
    const board = this.board();
    this.boards.replaceChildren(...(this.document?.boards.map((item) => option(item.id, item.title)) ?? []));
    if (board) this.boards.value = board.id;
    this.cards.clear();
    this.fixedFamilyCards.clear();
    this.spaces.clear();
    this.spaceShapes.replaceChildren();
    this.spaceControls.replaceChildren();
    this.strokes.replaceChildren();
    this.wires.replaceChildren();
    this.cardLayer.replaceChildren();
    if (board) {
      if (!board.spaces?.some((space) => space.id === this.selectedSpace)) this.selectedSpace = undefined;
      for (const space of board.spaces ?? []) this.renderSpace(space);
      for (const stroke of board.strokes ?? []) this.renderStroke(stroke);
      const byId = new Map(board.nodes.map((node) => [node.id, node]));
      this.fixedFamilyCards = canvasFamilyPositionIds(board);
      const hierarchy = new Map(board.nodes.map((node) => [node.id, groupAncestors(node, byId)]));
      const visible = board.nodes.filter((node) => !hierarchy.get(node.id)!.some((group) => group.collapsed));
      const visibleIds = new Set(visible.map((node) => node.id));
      this.selected = new Set([...this.selected].filter((id) => visibleIds.has(id)));
      this.renderConnections(board);
      const ordered = visible.slice().sort((a, b) => Number(b.kind === 'group') - Number(a.kind === 'group') ||
        hierarchy.get(a.id)!.length - hierarchy.get(b.id)!.length);
      for (const node of ordered) {
        const card = action('', () => {});
        const person = isCanvasPerson(node.kind);
        card.className = 'canvas-card canvas-' + node.kind + (person ? ' canvas-person' : '');
        card.dataset.node = node.id;
        card.style.left = node.x + 'px';
        card.style.top = node.y + 'px';
        card.style.width = node.width + 'px';
        card.style.height = node.height + 'px';
        if (node.color) card.style.setProperty('--card-color', node.color);
        if (node.collapsed) card.classList.add('is-collapsed');
        if (node.checked) card.classList.add('is-checked');
        if (this.fixedFamilyCards.has(node.id)) {
          card.classList.add('canvas-family-fixed');
          card.title = 'Position follows the pedigree layout.';
        }
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
        if (person) {
          const geometry = canvasPersonSymbol(node);
          const symbol = html('span');
          symbol.className = 'canvas-person-symbol';
          symbol.setAttribute('aria-hidden', 'true');
          symbol.style.left = (geometry.x - node.x) + 'px';
          symbol.style.top = (geometry.y - node.y) + 'px';
          symbol.style.width = geometry.width + 'px';
          symbol.style.height = geometry.height + 'px';
          card.style.setProperty('--canvas-person-label-top', (geometry.y - node.y + geometry.height + 4) + 'px');
          card.append(symbol);
        }
        const content = html('span', node.text || node.url || NODE_LABELS[node.kind]);
        content.className = 'canvas-card-text';
        card.append(content);
        card.onclick = (event) => { if (event.detail === 0) this.pickCard(node.id, event.shiftKey, event.timeStamp); };
        this.cards.set(node.id, card);
        this.cardLayer.append(card);
      }
      if (!visible.length && !board.spaces?.length && !board.strokes?.length && !this.inlineDraft) {
        const empty = html('p', 'Click anywhere to write.');
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
    const byId = new Map(board.nodes.map((node) => [node.id, node]));
    const people = board.nodes.filter((node) => isCanvasPerson(node.kind) && !groupAncestors(node, byId).some((group) => group.collapsed));
    for (const { familyId, points, label: caption } of routeCanvasFamilies({ ...board, nodes: people })) {
      const wire = document.createElementNS(SVG, 'polyline');
      wire.setAttribute('points', points.map(({ x, y }) => x + ',' + y).join(' '));
      wire.setAttribute('class', 'canvas-wire canvas-family-wire');
      wire.dataset.family = familyId;
      wire.onclick = () => this.familyDialog(familyId);
      this.wires.append(wire);
      if (caption) {
        const note = document.createElementNS(SVG, 'text');
        note.textContent = caption.text;
        note.setAttribute('x', String(caption.x));
        note.setAttribute('y', String(caption.y));
        note.setAttribute('text-anchor', 'middle');
        note.setAttribute('class', 'canvas-wire-label');
        this.wires.append(note);
      }
    }
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

  private renderSpace(space: CanvasSpace) {
    const shape = document.createElementNS(SVG, 'ellipse');
    shape.setAttribute('class', 'canvas-space');
    shape.style.setProperty('--space-color', space.color ?? SPACE_COLORS[0]!);
    const title = action(space.title, () => {});
    title.onclick = (event) => { if (event.detail === 0) this.pickSpace(space.id, event.timeStamp); };
    title.className = 'canvas-space-title';
    title.title = 'Drag to move. Double-click to edit.';
    const resize = action('', () => {});
    resize.onclick = (event) => { if (event.detail === 0) this.spaceDialog(space.id); };
    resize.className = 'canvas-space-resize';
    resize.setAttribute('aria-label', 'Resize ' + space.title);
    for (const element of [shape, title, resize]) element.dataset.space = space.id;
    const elements = { shape, title, resize };
    this.positionSpace(space, elements);
    this.spaces.set(space.id, elements);
    this.spaceShapes.append(shape);
    this.spaceControls.append(title, resize);
  }

  private positionSpace(bounds: SpaceBounds, elements: SpaceElements | { shape: SVGEllipseElement }) {
    const { x, y, width, height } = bounds;
    elements.shape.setAttribute('cx', String(x + width / 2));
    elements.shape.setAttribute('cy', String(y + height / 2));
    elements.shape.setAttribute('rx', String(width / 2));
    elements.shape.setAttribute('ry', String(height / 2));
    if ('title' in elements) {
      elements.title.style.left = x + width / 2 + 'px';
      elements.title.style.top = y + 'px';
      elements.resize.style.left = x + (0.5 + 0.5 / Math.SQRT2) * width + 'px';
      elements.resize.style.top = y + (0.5 + 0.5 / Math.SQRT2) * height + 'px';
    }
  }

  private renderStroke(stroke: CanvasStroke) {
    const first = stroke.points[0];
    if (!first) return;
    if (stroke.points.length === 1) {
      const dot = document.createElementNS(SVG, 'circle');
      dot.setAttribute('class', 'canvas-stroke-dot');
      dot.setAttribute('cx', String(first.x));
      dot.setAttribute('cy', String(first.y));
      dot.setAttribute('r', String(stroke.width / 2));
      if (stroke.color) dot.style.color = stroke.color;
      this.strokes.append(dot);
      return;
    }
    const line = document.createElementNS(SVG, 'polyline');
    this.paintStroke(line, stroke.points, stroke.width);
    if (stroke.color) line.style.color = stroke.color;
    this.strokes.append(line);
  }

  private paintStroke(line: SVGPolylineElement, points: CanvasPoint[], width: number) {
    line.setAttribute('class', 'canvas-stroke');
    line.setAttribute('stroke-width', String(width));
    line.setAttribute('points', points.map(({ x, y }) => x + ',' + y).join(' '));
  }

  private pickSpace(id: string, time?: number) {
    this.selected.clear();
    this.selectedSpace = id;
    if (time !== undefined && this.lastTap?.id === id && time - this.lastTap.time < 420) this.spaceDialog(id);
    this.lastTap = time === undefined ? undefined : { id, time };
    this.updateSelection();
  }

  private pickCard(id: string, toggle: boolean, time: number) {
    this.selectedSpace = undefined;
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
    this.surface.dataset.workplane = String(this.workplane);
    this.surface.dataset.workplaneTurn = String(this.turn);
    if (this.workplane) {
      this.surface.style.backgroundSize = '';
      this.surface.style.backgroundPosition = '';
      const { a, b, c, d } = canvasWorkplaneMatrix(this.turn);
      this.plane.style.transform = `matrix(${a},${b},${c},${d},0,0)`;
      const determinant = a * d - b * c;
      this.plane.style.setProperty('--canvas-upright', `matrix(${d / determinant},${-b / determinant},${-c / determinant},${a / determinant},0,0)`);
      this.paintWorkplaneGrid();
    } else {
      this.plane.style.transform = '';
      this.surface.style.backgroundSize = 24 * zoom + 'px ' + 24 * zoom + 'px';
      this.surface.style.backgroundPosition = -x * zoom + 'px ' + -y * zoom + 'px';
    }
    this.positionInline();
  }

  private paintWorkplaneGrid() {
    const commands: Record<keyof typeof this.gridPaths, string[]> = { minor: [], major: [], x: [], y: [] };
    for (const { start, end, major, axis } of canvasWorkplaneGrid(this.viewport, this.surfaceSize(), this.turn)) {
      commands[axis ?? (major ? 'major' : 'minor')].push(`M${start.x.toFixed(2)},${start.y.toFixed(2)}L${end.x.toFixed(2)},${end.y.toFixed(2)}`);
    }
    this.gridPaths.minor.setAttribute('d', commands.minor.join(''));
    this.gridPaths.major.setAttribute('d', commands.major.join(''));
    this.gridPaths.x.setAttribute('d', commands.x.join(''));
    this.gridPaths.y.setAttribute('d', commands.y.join(''));
  }

  private surfaceSize() {
    return { width: this.surface.clientWidth, height: this.surface.clientHeight };
  }

  private point(event: PointerEvent | WheelEvent) {
    const bounds = this.surface.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  private unproject(point: CanvasPoint) {
    return this.workplane ? unprojectCanvasWorkplane(point, this.surfaceSize(), this.turn) : point;
  }

  private panBy(delta: CanvasPoint) {
    // A displacement needs the linear inverse, without the stage-center offset.
    const offset = this.workplane ? unprojectCanvasWorkplane(delta, { width: 0, height: 0 }, this.turn) : delta;
    this.viewport = { ...boardPoint(offset, this.viewport), zoom: this.viewport.zoom };
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
    this.viewTimer = setTimeout(() => { void this.flushViewport().catch((error: unknown) => this.error(error)); }, 240);
  }

  private fitBoard() {
    const board = this.board();
    if (!board) return;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    const extend = (x: number, y: number, width: number, height: number) => {
      left = Math.min(left, x);
      right = Math.max(right, x + width);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + height);
    };
    for (const { x, y, width, height } of [...board.nodes, ...(board.spaces ?? [])]) extend(x, y, width, height);
    for (const stroke of board.strokes ?? []) {
      const radius = stroke.width / 2;
      for (const point of stroke.points) extend(point.x - radius, point.y - radius, stroke.width, stroke.width);
    }
    if (left === Infinity) return;
    const size = this.surfaceSize();
    const { a, b, c, d } = this.workplane ? canvasWorkplaneMatrix(this.turn) : { a: 1, b: 0, c: 0, d: 1 };
    const width = Math.abs(a) * (right - left) + Math.abs(c) * (bottom - top);
    const height = Math.abs(b) * (right - left) + Math.abs(d) * (bottom - top);
    const zoom = Math.max(0.15, Math.min(1.8, (size.width - 48) / width, (size.height - 48) / height));
    this.viewport = { zoom, x: (left + right) / 2 - size.width / (2 * zoom),
      y: (top + bottom) / 2 - size.height / (2 * zoom) };
    this.paintViewport();
    this.scheduleViewport();
  }

  private bindGestures() {
    this.surface.addEventListener('wheel', (event) => {
      if (!this.store || this.pending || (event.target as Element).closest('.canvas-inline')) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) this.setZoom(this.viewport.zoom * Math.exp(-event.deltaY * 0.003), this.unproject(this.point(event)));
      else {
        this.panBy({ x: event.shiftKey ? event.deltaY : event.deltaX, y: event.shiftKey ? 0 : event.deltaY });
        this.paintViewport();
      }
      this.scheduleViewport();
    }, { passive: false });
    this.surface.onpointerdown = (event) => {
      const target = event.target as Element;
      if (!this.store || this.pending || (event.button !== 0 && event.button !== 1) || target.closest('.canvas-inline') ||
        (this.tool === 'select' && event.button === 0 && target.closest('.canvas-wire'))) return;
      const screen = this.point(event);
      this.pointers.set(event.pointerId, screen);
      this.surface.setPointerCapture(event.pointerId);
      if (this.pointers.size === 2) {
        const [first, second] = [...this.pointers.values()];
        if (this.gesture) this.clearPreview(this.gesture);
        this.gesture = undefined;
        this.pinch = { distance: Math.max(1, Math.hypot(first!.x - second!.x, first!.y - second!.y)),
          center: this.unproject({ x: (first!.x + second!.x) / 2, y: (first!.y + second!.y) / 2 }), viewport: this.viewport };
        return;
      }
      if (this.pointers.size > 1) return;
      const point = this.unproject(screen);
      const base = { id: event.pointerId, start: point, viewport: this.viewport, dx: 0, dy: 0, moved: false };
      const board = this.board();
      if (event.button === 1 || this.inlineDraft) this.gesture = { ...base, kind: 'pan', captureText: event.button === 0 };
      else if (this.tool === 'draw') {
        this.gesture = { ...base, kind: 'draw', points: [boardPoint(point, this.viewport)] };
        this.strokes.append(this.strokePreview);
      } else if (this.tool === 'space') {
        this.gesture = { ...base, kind: 'create-space' };
      } else {
        const nodeId = target.closest<HTMLElement>('.canvas-card')?.dataset.node;
        const spaceId = target.closest<HTMLElement | SVGElement>('[data-space]')?.dataset.space;
        const node = board?.nodes.find((item) => item.id === nodeId);
        const space = board?.spaces?.find((item) => item.id === spaceId);
        if (node) this.gesture = { ...base, kind: 'card', node, fixed: this.fixedFamilyCards.has(node.id) };
        else if (space) this.gesture = { ...base, kind: target.closest('.canvas-space-resize') ? 'resize-space' : 'move-space', space };
        else this.gesture = { ...base, kind: 'pan', captureText: true };
      }
    };
    this.surface.onpointermove = (event) => {
      if (!this.pointers.has(event.pointerId)) return;
      const screen = this.point(event);
      this.pointers.set(event.pointerId, screen);
      if (this.pinch && this.pointers.size === 2) {
        const [first, second] = [...this.pointers.values()];
        const distance = Math.hypot(first!.x - second!.x, first!.y - second!.y);
        this.setZoom(this.pinch.viewport.zoom * distance / this.pinch.distance, this.pinch.center, this.pinch.viewport,
          this.unproject({ x: (first!.x + second!.x) / 2, y: (first!.y + second!.y) / 2 }));
        return;
      }
      const gesture = this.gesture;
      if (!gesture || gesture.id !== event.pointerId) return;
      const point = this.unproject(screen);
      if (gesture.kind === 'draw') {
        this.recordStrokePoint(gesture, point);
        this.paintStroke(this.strokePreview, gesture.points, STROKE_WIDTH);
        return;
      }
      const dx = point.x - gesture.start.x, dy = point.y - gesture.start.y;
      if (Math.hypot(dx, dy) < 4 && !gesture.moved) return;
      gesture.moved = true;
      gesture.dx = dx / gesture.viewport.zoom;
      gesture.dy = dy / gesture.viewport.zoom;
      if (gesture.kind === 'card') {
        if (!gesture.fixed) this.previewCardMove(gesture);
      }
      else if (gesture.kind === 'create-space') {
        this.positionSpace(placedSpace(gesture), { shape: this.spacePreview });
        if (!this.spacePreview.parentNode) this.spaceShapes.append(this.spacePreview);
      }
      else if (gesture.kind === 'move-space' || gesture.kind === 'resize-space') {
        const elements = this.spaces.get(gesture.space.id);
        if (elements) this.positionSpace(changedSpace(gesture), elements);
      } else {
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
      this.clearPreview(gesture);
      if (gesture.kind === 'pan') {
        if (gesture.moved) {
          if (cancelled) { this.viewport = gesture.viewport; this.paintViewport(); }
          else this.scheduleViewport();
        } else if (!cancelled && gesture.captureText) this.blankClick(gesture);
        return;
      }
      if (cancelled) return;
      const board = this.board();
      if (!board) return;
      if (gesture.kind === 'draw') {
        this.recordStrokePoint(gesture, this.unproject(this.point(event)));
        this.saveGesture((doc) => addCanvasStroke(doc, { points: gesture.points, width: STROKE_WIDTH }, board.id));
        return;
      }
      if (gesture.kind === 'create-space') {
        this.tool = 'select';
        this.updateSelection();
        this.spaceDialog(undefined, this.newSpaceBounds(gesture, board));
        return;
      }
      if (gesture.kind === 'move-space' || gesture.kind === 'resize-space') {
        this.pickSpace(gesture.space.id, gesture.moved ? undefined : event.timeStamp);
        if (gesture.moved) {
          this.saveGesture((doc) => updateCanvasSpace(doc, gesture.space.id, changedSpace(gesture), board.id));
        }
        return;
      }
      if (gesture.kind !== 'card') return;
      if (!gesture.moved) { this.pickCard(gesture.node.id, event.shiftKey, event.timeStamp); return; }
      if (gesture.fixed) return;
      const node = gesture.node;
      this.selectedSpace = undefined;
      this.selected = new Set([node.id]);
      this.saveGesture((doc) => {
        const moved = updateCanvasNode(doc, node.id, { x: node.x + gesture.dx, y: node.y + gesture.dy }, board.id);
        if (node.kind !== 'group') return this.assignCardSpaces(moved, board.id, node.id);
        const original = new Map(board.nodes.map((item) => [item.id, item]));
        return updateCanvasBoard(moved, board.id, (current) => ({ ...current, nodes: current.nodes.map((item) => {
          const previous = original.get(item.id);
          return previous && (item.x !== previous.x || item.y !== previous.y)
            ? { ...item, spaceIds: cardSpaceIds(current, item) }
            : item;
        }) }));
      });
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
        this.panBy(direction);
        this.paintViewport();
        this.scheduleViewport();
      } else if (event.key === '+' || event.key === '=') this.zoomBy(1.25);
      else if (event.key === '-') this.zoomBy(0.8);
      else if (event.key.toLowerCase() === 'n') {
        this.startInline(boardPoint({ x: this.surface.clientWidth / 2, y: this.surface.clientHeight / 2 }, this.viewport));
      }
    };
  }

  private blankClick(gesture: Gesture) {
    if (this.inlineDraft) {
      void this.flush().catch((error: unknown) => this.error(error));
    } else if (this.selected.size || this.selectedSpace) {
      this.selected.clear();
      this.selectedSpace = undefined;
      this.lastTap = undefined;
      this.updateSelection();
    } else {
      this.startInline(boardPoint(gesture.start, gesture.viewport));
    }
  }

  private newSpaceBounds(gesture: Gesture, board: CanvasBoard) {
    const bounds = placedSpace(gesture);
    if (gesture.moved) return bounds;
    const nearby = (board.spaces ?? []).filter((space) =>
      Math.abs(space.x - bounds.x) <= 150 && Math.abs(space.y - bounds.y) <= 110).length;
    const offset = nearby % 4;
    return { ...bounds, x: bounds.x + 44 * offset, y: bounds.y + 26 * offset };
  }

  private recordStrokePoint(gesture: Extract<Gesture, { kind: 'draw' }>, point: CanvasPoint) {
    const sample = boardPoint(point, gesture.viewport);
    const last = gesture.points.at(-1)!;
    if (Math.hypot(sample.x - last.x, sample.y - last.y) < 0.5 / gesture.viewport.zoom) return;
    if (gesture.points.length === CANVAS_STROKE_POINT_LIMIT) gesture.points = gesture.points.filter((_, index) => index % 2 === 0);
    gesture.points.push(sample);
  }

  private clearPreview(gesture: Gesture) {
    if (gesture.kind === 'card') this.clearCardPreview();
    else if (gesture.kind === 'create-space') this.spacePreview.remove();
    else if (gesture.kind === 'draw') {
      this.strokePreview.remove();
      this.strokePreview.removeAttribute('points');
    } else if (gesture.kind === 'move-space' || gesture.kind === 'resize-space') {
      const elements = this.spaces.get(gesture.space.id);
      if (elements) this.positionSpace(gesture.space, elements);
    }
  }

  private saveGesture(edit: Edit) {
    const store = this.store;
    void this.flush().then(() => this.store === store && this.commit(edit))
      .catch((error: unknown) => this.error(error));
  }

  private previewCardMove(gesture: Extract<Gesture, { kind: 'card' }>) {
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
    if (board.edges.length + (board.families?.length ?? 0) <= 100) {
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

  private spaceDialog(id?: string, placement?: SpaceBounds) {
    const board = this.board();
    if (!board) return;
    const existing = board.spaces?.find((space) => space.id === id);
    const initial = existing ?? placement;
    if (!initial) return;
    const name = html('input');
    name.value = existing?.title ?? 'Space';
    const color = html('input');
    color.type = 'color';
    color.value = existing?.color?.length === 7 ? existing.color : SPACE_COLORS[(board.spaces?.length ?? 0) % SPACE_COLORS.length]!;
    const dimension = (value: number, minimum: number) => {
      const input = html('input');
      input.type = 'number';
      input.min = String(minimum);
      input.value = String(Math.round(value));
      return input;
    };
    const width = dimension(initial.width, SPACE_MIN_SIZE);
    const height = dimension(initial.height, SPACE_MIN_SIZE);
    const bounds = html('div');
    bounds.className = 'canvas-dimensions';
    bounds.append(label('Width', width), label('Height', height));
    const buttons = [action(existing ? 'Save space' : 'Create space', () => {
      let savedId = id;
      this.saveDialog((doc) => {
        const fields = { title: name.value, color: color.value, width: width.valueAsNumber, height: height.valueAsNumber };
        if (id) return updateCanvasSpace(doc, id, fields, board.id);
        const added = addCanvasSpace(doc, { ...initial, ...fields }, board.id);
        savedId = added.spaceId;
        return added.document;
      }, () => { this.selected.clear(); this.selectedSpace = savedId; this.updateSelection(); });
    })];
    if (id) buttons.push(action('Delete space', () => this.saveDialog((doc) => removeCanvasSpace(doc, id, board.id))));
    this.openDialog(existing ? 'Edit Space' : 'New Space', [label('Space name', name), label('Space color', color), bounds], buttons);
    name.focus();
    name.select();
  }

  private familyList() {
    const board = this.board();
    if (!board) return;
    const names = new Map(board.nodes.map((node) => [node.id, node.text || NODE_LABELS[node.kind]]));
    const list = html('div');
    list.className = 'canvas-results';
    for (const family of board.families ?? []) {
      const title = family.parents.map((id) => names.get(id)).join(' + ');
      list.append(action(title, () => this.familyDialog(family.id)));
    }
    this.openDialog('Families', [list], [action('Add family', () => this.familyDialog())]);
  }

  private familyDialog(id?: string) {
    const board = this.board();
    if (!board) return;
    const family = board.families?.find((item) => item.id === id);
    if (id && !family) return;
    const people = board.nodes.filter((node) => isCanvasPerson(node.kind));
    const selected = [...this.selected].filter((nodeId) => people.some((node) => node.id === nodeId));
    const [firstId, secondId] = family?.parents ?? selected;
    const first = familyPersonField(people, 'person-square', firstId);
    const second = familyPersonField(people, 'person-circle', secondId);
    first.legend.textContent = 'Parent 1';
    second.legend.textContent = 'Parent 2';
    const parents = html('div');
    parents.className = 'canvas-family-parents';
    parents.append(first.field, second.field);
    const related = html('input');
    related.type = 'checkbox';
    related.checked = Boolean(family?.consanguineous);
    const relatedLabel = label('Parents are biologically related (double line)', related);
    relatedLabel.className = 'canvas-family-related';
    const relationship = html('input');
    relationship.maxLength = CANVAS_FAMILY_LABEL_LIMIT;
    relationship.value = family?.relationshipLabel ?? '';
    relationship.placeholder = 'For example, second cousins';
    const relationshipField = label('Relationship note (optional)', relationship);

    const rows = html('div');
    rows.className = 'canvas-family-children';
    const children: ReturnType<typeof familyPersonField>[] = [];
    function renderChildren() {
      for (const [index, child] of children.entries()) {
        child.legend.textContent = 'Child ' + (index + 1);
        const up = action('↑', () => shiftChild(index, -1));
        up.setAttribute('aria-label', `Move child ${index + 1} earlier`);
        up.disabled = index === 0;
        const down = action('↓', () => shiftChild(index, 1));
        down.setAttribute('aria-label', `Move child ${index + 1} later`);
        down.disabled = index === children.length - 1;
        const remove = action('Remove', () => {
          children.splice(index, 1);
          child.field.remove();
          renderChildren();
        });
        remove.setAttribute('aria-label', `Remove child ${index + 1}`);
        const actions = html('div');
        actions.className = 'canvas-family-order';
        actions.append(up, down, remove);
        child.field.querySelector('.canvas-family-order')?.remove();
        child.field.append(actions);
        rows.append(child.field);
      }
    }
    function shiftChild(index: number, delta: number) {
      const next = index + delta;
      if (next < 0 || next >= children.length) return;
      const [child] = children.splice(index, 1);
      children.splice(next, 0, child!);
      renderChildren();
      child!.field.querySelector<HTMLSelectElement>('select')?.focus();
    }
    for (const child of family?.children ?? []) children.push(familyPersonField(people, 'person-diamond', child));
    renderChildren();
    const addChild = action('Add child', () => {
      const child = familyPersonField(people, 'person-diamond');
      children.push(child);
      renderChildren();
      child.field.querySelector<HTMLInputElement>('input')?.focus();
    });
    const save = action('Save family', () => this.saveDialog((doc) => {
      const result = saveCanvasFamily(doc, { id, parents: [first.read(), second.read()],
        children: children.map((child) => child.read()), consanguineous: related.checked,
        relationshipLabel: relationship.value }, board.id);
      return updateCanvasBoard(result.document, board.id, (current) => arrangeCanvas(current, 'pedigree'));
    }, () => { this.layout.value = 'pedigree'; this.fitBoard(); }));
    const actions = [save];
    if (id) actions.push(action('Remove family link', () => this.saveDialog((doc) => removeCanvasFamily(doc, id, board.id))));
    const note = html('p', 'Add children from oldest to youngest. This order stays left to right in the chart.');
    note.className = 'canvas-family-note';
    this.openDialog(id ? 'Edit family' : 'Add family', [parents, relatedLabel, relationshipField, note, rows, addChild], actions);
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
    const spaceOptions = (board.spaces ?? []).map((space) => {
      const checkbox = html('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(existing?.spaceIds?.includes(space.id));
      return { space, checkbox };
    });
    if (spaceOptions.length) {
      const memberships = html('fieldset');
      memberships.className = 'canvas-memberships';
      memberships.append(html('legend', 'Spaces'));
      for (const { space, checkbox } of spaceOptions) {
        const row = html('label');
        const swatch = html('span');
        swatch.className = 'canvas-space-swatch';
        swatch.style.backgroundColor = space.color ?? SPACE_COLORS[0]!;
        row.append(checkbox, swatch, space.title);
        memberships.append(row);
      }
      controls.push(memberships);
    }
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
        const spaceIds = spaceOptions.filter(({ checkbox }) => checkbox.checked).map(({ space }) => space.id);
        if (nodeId) {
          const updated = updateCanvasNode(doc, nodeId, fields, board.id);
          const withSpaces = spaceIds.length !== (existing?.spaceIds?.length ?? 0) ||
            spaceIds.some((spaceId) => !existing?.spaceIds?.includes(spaceId))
            ? setCanvasNodeSpaces(updated, nodeId, spaceIds, board.id) : updated;
          const symbolOrSizeChanged = existing && isCanvasPerson(existing.kind) && (chosen !== existing.kind ||
            (fields.width !== undefined && fields.width !== existing.width) ||
            (fields.height !== undefined && fields.height !== existing.height));
          return this.fixedFamilyCards.has(nodeId) && symbolOrSizeChanged
            ? updateCanvasBoard(withSpaces, board.id, (current) => arrangeCanvas(current, 'pedigree')) : withSpaces;
        }
        const added = addCanvasNode(doc, fields, board.id);
        nodeId = added.nodeId;
        return spaceIds.length ? setCanvasNodeSpaces(added.document, nodeId, spaceIds, board.id)
          : this.assignCardSpaces(added.document, board.id, nodeId);
      }, () => {
        if (nodeId) { this.selected = new Set([nodeId]); this.selectedSpace = undefined; this.updateSelection(); }
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
