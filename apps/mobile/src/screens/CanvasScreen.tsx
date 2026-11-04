import { memo, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Alert, AppState, Image, KeyboardAvoidingView, Linking, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet,
  Switch, Text, TextInput, View, type GestureResponderEvent, type LayoutChangeEvent, type ViewStyle } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';
import { activeCanvasBoard, addCanvasBoard, addCanvasEdge, addCanvasNode, addCanvasSpace, addCanvasStroke, CANVAS_STROKE_POINT_LIMIT,
  canvasFamilyPositionIds, canvasSpacesAtPoint,
  groupCanvasNodes, isCanvasPerson, removeCanvasEdge, removeCanvasFamily, removeCanvasNode, removeCanvasSpace, renameCanvasBoard,
  saveCanvasFamily, searchCanvas, selectCanvasBoard,
  setCanvasNodeSpaces, updateCanvasBoard, updateCanvasEdge, updateCanvasNode, updateCanvasSpace, updateCanvasViewport,
  type CanvasDocument, type CanvasEdge, type CanvasFamily, type CanvasNode, type CanvasSpace, type CanvasStroke } from '../utils/canvas';
import { arrangeCanvas, canvasPersonSymbol, routeCanvasEdges, routeCanvasFamilies, type CanvasLayoutMode } from '../utils/canvas-layout';
import { canvasWorkplaneGrid, nextCanvasWorkplaneTurn, projectCanvasWorkplane, unprojectCanvasWorkplane,
  type CanvasWorkplaneTurn } from '../utils/canvas-workplane';
import { CanvasFamilyEditor, type FamilyForm } from './CanvasFamilyEditor';
import type { ViewAddAction, ViewAddActionsRef } from './view-add-actions';
import { EMPTY_VIEW_HISTORY, type ViewHistoryControls, type ViewHistoryState } from './view-history';
import { canvasDragNodes, canvasWorkplaneFrame, centerCanvasNode, fitCanvasWorkplane, intersectsCanvasViewport,
  previewCanvasRoutes, screenPoint, visibleCanvasBoard, worldPoint, zoomViewport,
  type DragPreview, type Point, type Size, type Viewport } from './canvas-viewport';

type Props = {
  document: CanvasDocument;
  onChange: (next: CanvasDocument) => void;
  focusNodeId?: string | null;
  onFocusConsumed?: () => void;
  beforeLeaveRef?: { current: (() => boolean) | null };
  addActionsRef?: ViewAddActionsRef;
  historyControlsRef?: { current: ViewHistoryControls | null };
  onHistoryStateChange?: (state: ViewHistoryState) => void;
};
type NodeKind = CanvasNode['kind'];
type NodeDraft = {
  id?: string; kind: NodeKind; text: string; url: string; color?: string; checked: boolean;
  x: string; y: string; width: string; height: string;
};
type EdgeDraft = { id?: string; from: string; to: string; kind: CanvasEdge['kind']; directed: boolean; label: string };
type SpaceDraft = { id?: string; title: string; color?: string; x: string; y: string; width: string; height: string };
type Dialog = { kind: 'boards' | 'group' | 'search'; text: string } | { kind: 'layout' } |
  { kind: 'node'; draft: NodeDraft } | { kind: 'edge'; draft: EdgeDraft } | { kind: 'connections'; nodeId: string } |
  { kind: 'space'; draft: SpaceDraft } | { kind: 'membership'; nodeId: string; spaceIds: string[] } |
  { kind: 'family'; familyId?: string; seedPersonId?: string } | { kind: 'families'; personId?: string };
type BoardMode = 'text' | 'draw' | 'spaces';
type Capture = { boardId: string; point: Point; text: string };
type SpaceDrag = { id: string; resize: boolean };
type Gesture = { boardId: string; origin: Point; viewport: Viewport; nodeId?: string;
  space?: SpaceDrag; points?: Point[]; pinch?: { viewport: Viewport; center: Point; distance: number } };
type Preview = { viewport?: Viewport; drag?: DragPreview; space?: SpaceDrag & { delta: Point }; points?: Point[] };
type Touches = GestureResponderEvent['nativeEvent']['touches'];

const NODE_KINDS: { id: NodeKind; name: string }[] = [
  { id: 'sticky', name: 'Sticky note' }, { id: 'note', name: 'Text' }, { id: 'task', name: 'Task' },
  { id: 'heading', name: 'Heading' }, { id: 'checklist', name: 'Checklist' }, { id: 'link', name: 'Link' },
  { id: 'image', name: 'Image' }, { id: 'person-circle', name: 'Female (circle)' },
  { id: 'person-square', name: 'Male (square)' }, { id: 'person-diamond', name: 'Unknown (diamond)' },
  { id: 'partnership', name: 'Partnership' },
];
const EDGE_KINDS: { id: CanvasEdge['kind']; name: string }[] = [
  { id: 'related', name: 'Related' }, { id: 'dependency', name: 'Dependency' },
  { id: 'partnership', name: 'Partnership' }, { id: 'parent', name: 'Parent to child' },
];
const CARD_COLORS = [
  { name: 'Default', value: undefined }, { name: 'Sand', value: '#F5E4A6' }, { name: 'Rose', value: '#F2CED4' },
  { name: 'Mint', value: '#CDE7D9' }, { name: 'Blue', value: '#CEDFF2' }, { name: 'Lilac', value: '#DDD5EF' },
];
const SPACE_COLORS = [
  { name: 'Sand', value: '#AB872E' }, { name: 'Rose', value: '#B95A6C' }, { name: 'Mint', value: '#458B67' },
  { name: 'Blue', value: '#4D7BAB' }, { name: 'Lilac', value: '#8A71B0' },
];
const BOARD_MODES: { id: BoardMode; name: string }[] = [
  { id: 'text', name: 'Text' }, { id: 'draw', name: 'Draw' }, { id: 'spaces', name: 'Spaces' },
];
const SPACE_MIN = 24;
const LAYOUTS: { id: CanvasLayoutMode; title: string; detail: string }[] = [
  { id: 'relationships', title: 'Relationships', detail: 'Lay out connected cards and dependencies.' },
  { id: 'pedigree', title: 'Pedigree', detail: 'Arrange people, partnerships, and descendants in generations.' },
  { id: 'groups', title: 'Groups', detail: 'Space out groups and ungrouped cards.' },
];

const nodeName = (node?: CanvasNode) => node?.text.trim().split('\n')[0]?.slice(0, 75) ||
  NODE_KINDS.find(({ id }) => id === node?.kind)?.name || 'Group';
const edgeName = (kind: CanvasEdge['kind']) => EDGE_KINDS.find(({ id }) => id === kind)?.name ?? 'Connection';
const safeWebUrl = (value?: string) => Boolean(value && /^https?:\/\/[^\s]+$/i.test(value));

function dimensions(kind: NodeKind): Size {
  if (isCanvasPerson(kind)) return { width: 120, height: 96 };
  if (kind === 'partnership') return { width: 120, height: 64 };
  if (kind === 'image') return { width: 200, height: 160 };
  return { width: 180, height: 104 };
}

function nodeDraft(node: CanvasNode | undefined, point: Point): NodeDraft {
  const kind = node?.kind ?? 'sticky';
  const size = node ?? dimensions(kind);
  return { id: node?.id, kind, text: node?.text ?? '', url: node?.url ?? '', color: node?.color,
    checked: Boolean(node?.checked), x: String(node?.x ?? Math.round(point.x)), y: String(node?.y ?? Math.round(point.y)),
    width: String(size.width), height: String(size.height) };
}

function Tool({ title, onPress, styles, disabled = false, selected, accessibilityLabel, compact }: {
  title: string; onPress: () => void; styles: ReturnType<typeof createStyles>; disabled?: boolean; selected?: boolean;
  accessibilityLabel?: string; compact?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title}
    accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={[styles.tool, compact && styles.compactTool, disabled && styles.disabled, selected && styles.activeTool]}>
    <Text numberOfLines={1} style={styles.toolText}>{title}</Text>
  </Pressable>;
}

function Stroke({ from, to, color, thickness = 1.4 }: { from: Point; to: Point; color: string; thickness?: number }) {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  if (length < 0.5) return null;
  return <View style={{ position: 'absolute', left: (from.x + to.x - length) / 2, top: (from.y + to.y - thickness) / 2,
    width: length + thickness / 2, height: thickness, borderRadius: thickness / 2,
    backgroundColor: color, transform: [{ rotate: String(Math.atan2(dy, dx)) + 'rad' }] }} />;
}

const InkDrawing = memo(function InkDrawing({ stroke, viewport, size, fallback }: {
  stroke: Pick<CanvasStroke, 'points' | 'width' | 'color'>; viewport: Viewport; size: Size; fallback: string;
}) {
  const color = stroke.color ?? fallback;
  const thickness = Math.max(0.8, stroke.width * viewport.zoom);
  const first = stroke.points[0];
  if (!first) return null;
  const dot = screenPoint(first, viewport);
  if (stroke.points.length === 1) return intersectsCanvasViewport(dot, dot, size) ? <View style={{
    position: 'absolute', left: dot.x - thickness / 2, top: dot.y - thickness / 2,
    width: thickness, height: thickness, borderRadius: thickness / 2, backgroundColor: color,
  }} /> : null;
  const lines = [];
  let previous = dot;
  for (let index = 1; index < stroke.points.length; index++) {
    const point = screenPoint(stroke.points[index]!, viewport);
    if (intersectsCanvasViewport(previous, point, size)) {
      lines.push(<Stroke key={index} from={previous} to={point} color={color} thickness={thickness} />);
    }
    previous = point;
  }
  return <>{lines}</>;
});

function fillOpacity(color: string): string {
  if (color.length === 7) return color + '30';
  const [, r, g, b] = color;
  return '#' + r + r + g + g + b + b + '30';
}

function spaceGeometry(space: CanvasSpace, resize: boolean, delta: Point) {
  return resize ? { width: Math.max(SPACE_MIN, space.width + delta.x), height: Math.max(SPACE_MIN, space.height + delta.y) } :
    { x: space.x + delta.x, y: space.y + delta.y };
}

function placeCardInSpaces(document: CanvasDocument, nodeId: string, boardId: string) {
  const board = document.boards.find(({ id }) => id === boardId);
  const node = board?.nodes.find(({ id }) => id === nodeId);
  if (!board?.spaces?.length || !node || node.kind === 'group') return document;
  const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  return setCanvasNodeSpaces(document, node.id, canvasSpacesAtPoint(board.spaces, center), board.id);
}

const EdgeDrawing = memo(function EdgeDrawing({ edge, points, viewport, size, color, styles }: {
  edge: CanvasEdge; points: Point[]; viewport: Viewport; size: Size; color: string; styles: ReturnType<typeof createStyles>;
}) {
  const projected = points.map((point) => screenPoint(point, viewport));
  const tip = projected.at(-1), previous = projected.at(-2);
  const mid = Math.max(0, Math.floor((projected.length - 1) / 2));
  const a = projected[mid], b = projected[mid + 1];
  const visible = projected.slice(1).some((point, index) => intersectsCanvasViewport(projected[index]!, point, size));
  if (!visible) return null;
  const arrow = tip && previous && edge.directed && intersectsCanvasViewport(tip, tip, size);
  const angle = tip && previous ? Math.atan2(tip.y - previous.y, tip.x - previous.x) : 0;
  const clip = ({ x, y }: Point): Point => ({ x: Math.max(-24, Math.min(size.width + 24, x)),
    y: Math.max(-24, Math.min(size.height + 24, y)) });
  return <>
    {projected.slice(1).map((point, index) => intersectsCanvasViewport(projected[index]!, point, size)
      ? <Stroke key={index} from={clip(projected[index]!)} to={clip(point)} color={color} /> : null)}
    {arrow && tip ? [-0.55, 0.55].map((offset) => <Stroke key={offset} from={tip}
      to={{ x: tip.x - 9 * Math.cos(angle + offset), y: tip.y - 9 * Math.sin(angle + offset) }} color={color} />) : null}
    {a && b && edge.label && viewport.zoom >= 0.4 && intersectsCanvasViewport(a, b, size, 0) ?
      <Text numberOfLines={1} style={[styles.edgeLabel, { left: (a.x + b.x) / 2 + 3, top: (a.y + b.y) / 2 - 18 }]}>{edge.label}</Text>
      : null}
  </>;
});

const FamilyDrawing = memo(function FamilyDrawing({ points, viewport, size, color, label, styles }: {
  points: Point[]; viewport: Viewport; size: Size; color: string; label?: Point & { text: string };
  styles: ReturnType<typeof createStyles>;
}) {
  const projected = points.map((point) => screenPoint(point, viewport));
  const clip = ({ x, y }: Point): Point => ({ x: Math.max(-24, Math.min(size.width + 24, x)),
    y: Math.max(-24, Math.min(size.height + 24, y)) });
  const caption = label && screenPoint(label, viewport);
  return <>{projected.slice(1).map((point, index) => {
    const previous = projected[index]!;
    return intersectsCanvasViewport(previous, point, size) ?
      <Stroke key={index} from={clip(previous)} to={clip(point)} color={color} /> : null;
  })}
    {caption && label && viewport.zoom >= 0.4 && intersectsCanvasViewport(caption, caption, size, 80) ?
      <Text numberOfLines={1} style={[styles.familyLabel, { left: caption.x - 80, top: caption.y - 14 }]}>{label.text}</Text> : null}
  </>;
});

const CanvasGrid = memo(function CanvasGrid({ viewport, size, styles }: { viewport: Viewport; size: Size; styles: ReturnType<typeof createStyles> }) {
  const base = 48 * viewport.zoom;
  const spacing = base * Math.max(1, Math.ceil(24 / base));
  const startX = ((-viewport.x * viewport.zoom) % spacing + spacing) % spacing;
  const startY = ((-viewport.y * viewport.zoom) % spacing + spacing) % spacing;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {Array.from({ length: Math.ceil(size.width / spacing) }, (_, index) =>
      <View key={'x' + index} style={[styles.gridVertical, { left: startX + index * spacing }]} />)}
    {Array.from({ length: Math.ceil(size.height / spacing) }, (_, index) =>
      <View key={'y' + index} style={[styles.gridHorizontal, { top: startY + index * spacing }]} />)}
  </View>;
});

const WorkplaneGrid = memo(function WorkplaneGrid({ viewport, size, offset, turn, colors }: {
  viewport: Viewport; size: Size; offset: Point; turn: CanvasWorkplaneTurn; colors: AppColors;
}) {
  const lines = canvasWorkplaneGrid(viewport, size, turn);
  const offsetPoint = ({ x, y }: Point) => ({ x: x - offset.x, y: y - offset.y });
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {lines.map(({ start, end, major, axis }, index) => <Stroke key={index}
      from={offsetPoint(start)} to={offsetPoint(end)}
      color={axis ? colors.muted : major ? colors.silver : colors.hairline}
      thickness={axis ? 1.6 : major ? 1 : StyleSheet.hairlineWidth} />)}
  </View>;
});

export function CanvasScreen({ document, onChange, focusNodeId, onFocusConsumed, beforeLeaveRef, addActionsRef,
  historyControlsRef, onHistoryStateChange }: Props) {
  const { colors, resolvedMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const board = activeCanvasBoard(document);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [multi, setMulti] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<BoardMode>('text');
  const [workplane, setWorkplane] = useState<CanvasWorkplaneTurn | null>(null);
  const lastWorkplaneTurn = useRef<CanvasWorkplaneTurn>(0);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const modeRef = useRef(mode); modeRef.current = mode;
  const camera = useRef({ workplane, size }); camera.current = { workplane, size };
  const captureRef = useRef<Capture | null>(null);
  const docRef = useRef(document); docRef.current = document;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const stageRef = useRef<ComponentRef<typeof View>>(null);
  const stageOrigin = useRef<Point>({ x: 0, y: 0 });
  const activeGesture = useRef<Gesture | null>(null);
  const previewRef = useRef<Preview | null>(null);
  const previewFrame = useRef<number | null>(null);
  const history = useRef<{ undo: CanvasDocument[]; redo: CanvasDocument[] }>({ undo: [], redo: [] });
  const restoreHistory = useRef<(action: 'undo' | 'redo') => void>(restore);
  restoreHistory.current = restore;
  const addChoices = useRef<() => ViewAddAction[]>(() => []);
  addChoices.current = () => [
    { label: 'Add card', run: () => editNode() },
    { label: 'Add family', run: () => openDialog({ kind: 'family' }) },
    { label: 'Add space', run: () => editSpace() },
    { label: 'New board', run: () => openDialog({ kind: 'boards', text: '' }) },
  ];
  useEffect(() => {
    if (!addActionsRef) return;
    const actions = () => addChoices.current();
    addActionsRef.current = actions;
    return () => { if (addActionsRef.current === actions) addActionsRef.current = null; };
  }, [addActionsRef]);
  useEffect(() => {
    if (!historyControlsRef) return;
    const controls = { undo: () => restoreHistory.current('undo'), redo: () => restoreHistory.current('redo') };
    historyControlsRef.current = controls;
    return () => { if (historyControlsRef.current === controls) historyControlsRef.current = null; };
  }, [historyControlsRef]);
  useEffect(() => () => onHistoryStateChange?.(EMPTY_VIEW_HISTORY), [onHistoryStateChange]);
  const focusedRequest = useRef<string | null>(null);
  const lastBoardId = useRef(board.id);

  const layout = useMemo(() => visibleCanvasBoard(board), [board.nodes, board.edges, board.families]);
  const stableRoutes = useMemo(() => routeCanvasEdges(layout), [layout]);
  const movingId = preview?.drag?.nodeId;
  const moving = useMemo(() => movingId ? canvasDragNodes(board.nodes, movingId) : null, [board.nodes, movingId]);
  const dragDelta = preview?.drag?.delta;
  const visualNodes = useMemo(() => moving && dragDelta
    ? layout.nodes.map((node) => moving.has(node.id) ? { ...node, x: node.x + dragDelta.x, y: node.y + dragDelta.y } : node)
    : layout.nodes, [layout.nodes, moving, dragDelta]);
  const routes = useMemo(() => moving && dragDelta ? previewCanvasRoutes(stableRoutes, moving, dragDelta) : stableRoutes,
    [stableRoutes, moving, dragDelta]);
  const familyRoutes = useMemo(() => routeCanvasFamilies(visualNodes === layout.nodes ? layout : { ...layout, nodes: visualNodes }),
    [layout, visualNodes]);
  const viewport = preview?.viewport ?? board.viewport;
  const scene = useMemo(() => {
    if (workplane === null || !size.width || !size.height) return null;
    const frame = canvasWorkplaneFrame(size, workplane);
    // Android decomposes a raw affine into view properties. Nested views preserve the exact transform and its hit testing.
    const style: ViewStyle = { position: 'absolute', left: frame.offset.x, top: frame.offset.y, ...frame.size,
      transform: [{ scaleY: frame.scaleY }] };
    const rotation: ViewStyle = { transform: [{ rotate: frame.rotation + 'rad' }] };
    return { size: frame.size, offset: frame.offset, style, rotation };
  }, [size, workplane]);
  const sceneSize = scene?.size ?? size;
  const sceneViewport = useMemo(() => scene ? { ...viewport, x: viewport.x + scene.offset.x / viewport.zoom,
    y: viewport.y + scene.offset.y / viewport.zoom } : viewport, [viewport, scene]);
  const selection = board.nodes.filter(({ id }) => selectedIds.includes(id));
  const selected = selection.length === 1 ? selection[0] : undefined;
  const people = useMemo(() => board.nodes.filter(({ kind }) => isCanvasPerson(kind)), [board.nodes]);
  const positionLocked = useMemo(() => canvasFamilyPositionIds(board), [board.families, board.nodes]);
  const selectedSpace = board.spaces?.find(({ id }) => id === spaceId);
  const ink = useMemo(() => board.strokes?.map((stroke) => ({
    stroke, bounds: stroke.points.reduce<Point & { right: number; bottom: number }>(({ x, y, right, bottom }, point) =>
      ({ x: Math.min(x, point.x), y: Math.min(y, point.y), right: Math.max(right, point.x), bottom: Math.max(bottom, point.y) }),
    { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity }),
  })) ?? [], [board.strokes]);
  const searchResults = useMemo(() => dialog?.kind === 'search' ? searchCanvas(document, dialog.text) : [], [document, dialog]);

  function apply(next: CanvasDocument, remember = true) {
    const previous = docRef.current;
    if (next === previous) return;
    if (remember) {
      history.current.undo = [...history.current.undo.slice(-29), previous];
      history.current.redo = [];
      publishHistory();
    }
    docRef.current = next;
    onChangeRef.current(next);
  }

  function publishHistory() {
    onHistoryStateChange?.({ canUndo: history.current.undo.length > 0, canRedo: history.current.redo.length > 0 });
  }

  function safeChange(change: () => void) {
    try { change(); }
    catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Canvas could not apply the change.';
      if (dialog) setDialogError(message);
      else Alert.alert('Canvas', message);
    }
  }

  function finishCapture(save: boolean) {
    const draft = captureRef.current;
    if (!draft) return true;
    if (save && draft.text.trim()) {
      try {
        const next = addCanvasNode(docRef.current, { kind: 'note', text: draft.text, ...draft.point, ...dimensions('note') }, draft.boardId);
        apply(placeCardInSpaces(next.document, next.nodeId, draft.boardId));
      } catch (failure) {
        Alert.alert('Could not save text', failure instanceof Error ? failure.message : undefined);
        return false;
      }
    }
    captureRef.current = null;
    setCapture(null);
    return true;
  }

  function changeMode(next: BoardMode) {
    if (!finishCapture(true)) return;
    setMode(next);
    setSpaceId(null);
    setSelectedIds([]);
    setLinkFrom(null);
    setMulti(false);
  }

  function changeWorkplane(next: CanvasWorkplaneTurn | null) {
    if (!finishCapture(true)) return;
    activeGesture.current = null;
    clearPreview();
    if (next !== null) lastWorkplaneTurn.current = next;
    setWorkplane(next);
  }

  function worldFromStage(point: Point) {
    return worldPoint(workplane === null ? point : unprojectCanvasWorkplane(point, size, workplane), viewport);
  }

  function tapBackdrop(event: GestureResponderEvent) {
    if (captureRef.current) { finishCapture(true); return; }
    if (mode === 'draw') return;
    const point = worldFromStage({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY });
    if (mode === 'spaces') {
      setSelectedIds([]);
      setSpaceId(canvasSpacesAtPoint(board.spaces ?? [], point).at(-1) ?? null);
      return;
    }
    if (selectedIds.length || multi || linkFrom) {
      setSelectedIds([]);
      setMulti(false);
      setLinkFrom(null);
      return;
    }
    const draft = { boardId: board.id, point, text: '' };
    captureRef.current = draft;
    setCapture(draft);
  }

  function openDialog(value: Dialog) { if (finishCapture(true)) { setDialogError(''); setDialog(value); } }
  function closeDialog() { setDialog(null); setDialogError(''); }
  function goToViewport(next: Viewport) { apply(updateCanvasViewport(docRef.current, next), false); }
  function zoomBy(factor: number) {
    const center = { x: size.width / 2, y: size.height / 2 };
    goToViewport(zoomViewport(viewport, viewport.zoom * factor, center));
  }

  function clearPreview() {
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
    previewFrame.current = null;
    previewRef.current = null;
    setPreview(null);
  }

  function stageLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
    stageRef.current?.measure((_x, _y, _width, _height, pageX, pageY) => { stageOrigin.current = { x: pageX, y: pageY }; });
  }

  useEffect(() => () => { if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current); }, []);
  useEffect(() => {
    const save = () => finishCapture(true);
    if (beforeLeaveRef) beforeLeaveRef.current = save;
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'background') save(); });
    return () => {
      if (beforeLeaveRef && beforeLeaveRef.current === save) beforeLeaveRef.current = null;
      subscription.remove();
    };
  }, [beforeLeaveRef]);
  useEffect(() => {
    if (lastBoardId.current === board.id) return;
    lastBoardId.current = board.id;
    activeGesture.current = null;
    clearPreview();
    setSelectedIds([]);
    setLinkFrom(null);
    setSpaceId(null);
  }, [board.id]);

  function revealNode(nodeId: string, boardId: string) {
    let next = docRef.current;
    const target = next.boards.find(({ id }) => id === boardId);
    const node = target?.nodes.find(({ id }) => id === nodeId);
    if (!target || !node) return false;
    const ancestry = new Set<string>();
    let parentId = node.groupId;
    while (parentId && !ancestry.has(parentId)) {
      ancestry.add(parentId);
      parentId = target.nodes.find(({ id }) => id === parentId)?.groupId;
    }
    next = updateCanvasBoard(selectCanvasBoard(next, boardId), boardId, (value) => ({
      ...value,
      nodes: value.nodes.map((item) => item.collapsed && ancestry.has(item.id) ? { ...item, collapsed: false } : item),
      viewport: centerCanvasNode(node.kind === 'group' && node.collapsed
        ? { ...node, width: Math.min(node.width, 200), height: Math.min(node.height, 86) } : node,
      size, Math.max(0.75, target.viewport.zoom)),
    }));
    // Keep the selection after changing boards in a search result.
    lastBoardId.current = boardId;
    activeGesture.current = null;
    clearPreview();
    setSelectedIds([nodeId]);
    setLinkFrom(null);
    apply(next, false);
    return true;
  }

  useEffect(() => {
    if (!focusNodeId) { focusedRequest.current = null; return; }
    if (focusedRequest.current === focusNodeId || !size.width || !size.height) return;
    const target = document.boards.find((candidate) => candidate.nodes.some(({ id }) => id === focusNodeId));
    if (target && revealNode(focusNodeId, target.id)) {
      focusedRequest.current = focusNodeId;
      onFocusConsumed?.();
    }
  }, [focusNodeId, document, size.width, size.height, onFocusConsumed]);

  const responder = useMemo(() => {
    function physicalPoint(touch: Touches[number]): Point {
      return { x: touch.pageX - stageOrigin.current.x, y: touch.pageY - stageOrigin.current.y };
    }
    function logicalPoint(point: Point): Point {
      const { workplane, size } = camera.current;
      return workplane === null ? point : unprojectCanvasWorkplane(point, size, workplane);
    }
    function stagePoint(touch: Touches[number]): Point { return logicalPoint(physicalPoint(touch)); }
    function pinch(touches: Touches) {
      const a = touches[0] && physicalPoint(touches[0]), b = touches[1] && physicalPoint(touches[1]);
      return a && b ? { center: logicalPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
        distance: Math.max(12, Math.hypot(a.x - b.x, a.y - b.y)) } : null;
    }
    function update(next: Preview) {
      previewRef.current = next;
      if (previewFrame.current === null) previewFrame.current = requestAnimationFrame(() => {
        previewFrame.current = null;
        setPreview(previewRef.current);
      });
    }
    function move(touches: Touches) {
      const gesture = activeGesture.current;
      if (!gesture) return;
      const pinchNow = pinch(touches);
      if (pinchNow) {
        gesture.pinch ??= { ...pinchNow, viewport: previewRef.current?.viewport ?? gesture.viewport };
        const start = gesture.pinch;
        update({ viewport: zoomViewport(start.viewport, start.viewport.zoom * pinchNow.distance / start.distance, start.center, pinchNow.center) });
      } else if (!gesture.pinch && touches[0]) {
        const point = stagePoint(touches[0]);
        if (gesture.points) {
          const world = worldPoint(point, gesture.viewport);
          const last = gesture.points.at(-1);
          if (!last || Math.hypot(last.x - world.x, last.y - world.y) * gesture.viewport.zoom >= 1.5) {
            if (gesture.points.length >= CANVAS_STROKE_POINT_LIMIT) {
              gesture.points = gesture.points.filter((_value, index) => index % 2 === 0);
            }
            gesture.points.push(world);
          } else if (previewRef.current?.points) return;
          update({ points: gesture.points.slice() });
          return;
        }
        const delta = { x: (point.x - gesture.origin.x) / gesture.viewport.zoom,
          y: (point.y - gesture.origin.y) / gesture.viewport.zoom };
        if (gesture.space) update({ space: { ...gesture.space, delta } });
        else if (gesture.nodeId) update({ drag: { nodeId: gesture.nodeId, delta } });
        else update({ viewport: { ...gesture.viewport, x: gesture.viewport.x - delta.x, y: gesture.viewport.y - delta.y } });
      }
    }
    function release() {
      const gesture = activeGesture.current;
      const last = previewRef.current;
      activeGesture.current = null;
      clearPreview();
      if (!gesture || !last) return;
      const current = docRef.current;
      const active = activeCanvasBoard(current);
      if (active.id !== gesture.boardId) return;
      try {
        if (last.viewport) { apply(updateCanvasViewport(current, last.viewport), false); return; }
        if (last.points) { apply(addCanvasStroke(current, { points: last.points, width: 2 }, active.id)); return; }
        if (last.space) {
          const { id, resize, delta } = last.space;
          const space = active.spaces?.find((item) => item.id === id);
          if (space && (delta.x || delta.y)) {
            apply(updateCanvasSpace(current, id, spaceGeometry(space, resize, delta), active.id));
            setSpaceId(id);
          }
          return;
        }
        const drag = last.drag;
        const node = active.nodes.find(({ id }) => id === drag?.nodeId);
        if (node && drag && (drag.delta.x || drag.delta.y)) {
          const moved = updateCanvasNode(current, node.id, { x: node.x + drag.delta.x, y: node.y + drag.delta.y });
          apply(placeCardInSpaces(moved, node.id, active.id));
          setSelectedIds([node.id]);
        }
      } catch (failure) {
        Alert.alert('Could not update Canvas', failure instanceof Error ? failure.message : undefined);
      }
    }
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: ({ nativeEvent }) => {
        const touch = nativeEvent.touches[0];
        if (!touch) return false;
        if (captureRef.current) { activeGesture.current = null; return false; }
        if (activeGesture.current && nativeEvent.touches.length > 1) return false;
        const active = activeCanvasBoard(docRef.current);
        const origin = stagePoint(touch);
        const drawing = modeRef.current === 'draw';
        activeGesture.current = { boardId: active.id, origin, viewport: active.viewport,
          points: drawing ? [worldPoint(origin, active.viewport)] : undefined };
        return drawing;
      },
      onMoveShouldSetPanResponderCapture: ({ nativeEvent }) => {
        const start = activeGesture.current, touch = nativeEvent.touches[0];
        if (!start || !touch) return false;
        if (nativeEvent.touches.length >= 2) return true;
        const point = stagePoint(touch);
        return Math.hypot(point.x - start.origin.x, point.y - start.origin.y) >= 6;
      },
      onPanResponderGrant: ({ nativeEvent }) => move(nativeEvent.touches),
      onPanResponderStart: ({ nativeEvent }) => { if (nativeEvent.touches.length > 1) move(nativeEvent.touches); },
      onPanResponderMove: ({ nativeEvent }) => move(nativeEvent.touches),
      onPanResponderRelease: release,
      onPanResponderTerminate: () => { activeGesture.current = null; clearPreview(); },
      onPanResponderTerminationRequest: () => false,
    });
  }, []);

  function armNode(id: string) {
    if (activeGesture.current && !positionLocked.has(id)) activeGesture.current.nodeId = id;
  }

  function armSpace(id: string, resize = false) {
    if (activeGesture.current) activeGesture.current.space = { id, resize };
  }

  function chooseNode(id: string) {
    if (!finishCapture(true)) return;
    if (linkFrom && linkFrom !== id) {
      openDialog({ kind: 'edge', draft: { from: linkFrom, to: id, kind: 'related', directed: false, label: '' } });
      setLinkFrom(null);
      return;
    }
    if (multi) setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    else setSelectedIds([id]);
  }

  function editNode(node?: CanvasNode) {
    const point = worldFromStage({ x: Math.max(24, size.width * 0.32), y: Math.max(28, size.height * 0.26) });
    const stored = node && activeCanvasBoard(docRef.current).nodes.find(({ id }) => id === node.id);
    openDialog({ kind: 'node', draft: nodeDraft(stored, point) });
  }

  function saveNode(draft: NodeDraft) {
    const numeric = [draft.x, draft.y, draft.width, draft.height];
    if (numeric.some((value) => !value.trim() || !Number.isFinite(Number(value)))) throw new Error('Enter valid coordinates and dimensions.');
    const [x, y, width, height] = numeric.map(Number);
    if (width! < 24 || height! < 24) throw new Error('Width and height must be at least 24.');
    const url = draft.url.trim();
    if (url && !safeWebUrl(url)) throw new Error('Enter a web address starting with https:// or http://.');
    const geometry = draft.id && positionLocked.has(draft.id) ? {} : { x, y, width, height };
    const patch = { ...geometry, kind: draft.kind, text: draft.text, color: draft.color, url, checked: draft.checked };
    if (draft.id) {
      const current = docRef.current;
      const active = activeCanvasBoard(current);
      const original = active.nodes.find(({ id }) => id === draft.id);
      const moved = original && !positionLocked.has(draft.id) &&
        (original.x !== x || original.y !== y || original.width !== width || original.height !== height);
      const next = updateCanvasNode(current, draft.id, patch);
      apply(moved ? placeCardInSpaces(next, draft.id, active.id) : next);
      setSelectedIds([draft.id]);
    } else {
      const next = addCanvasNode(docRef.current, { ...patch, kind: draft.kind });
      apply(placeCardInSpaces(next.document, next.nodeId, board.id));
      setSelectedIds([next.nodeId]);
    }
    closeDialog();
  }

  function editSpace(space?: CanvasSpace) {
    const count = board.spaces?.length ?? 0;
    const offset = [{ x: 0.12, y: 0.12 }, { x: 0.28, y: 0.12 }, { x: 0.2, y: 0.23 }][count % 3]!;
    const point = worldFromStage({ x: size.width * offset.x, y: size.height * offset.y });
    openDialog({ kind: 'space', draft: {
      id: space?.id, title: space?.title ?? '', color: space?.color ?? SPACE_COLORS[count % SPACE_COLORS.length]!.value,
      x: String(Math.round(space?.x ?? point.x)), y: String(Math.round(space?.y ?? point.y)),
      width: String(Math.round(space?.width ?? Math.max(SPACE_MIN, Math.min(260, size.width * 0.63) / viewport.zoom))),
      height: String(Math.round(space?.height ?? Math.max(SPACE_MIN, Math.min(210, size.height * 0.56) / viewport.zoom))),
    } });
  }

  function saveSpace(draft: SpaceDraft) {
    const numeric = [draft.x, draft.y, draft.width, draft.height];
    if (numeric.some((value) => !value.trim() || !Number.isFinite(Number(value)))) throw new Error('Enter valid coordinates and dimensions.');
    const [x, y, width, height] = numeric.map(Number);
    if (width! < SPACE_MIN || height! < SPACE_MIN) throw new Error('Width and height must be at least ' + SPACE_MIN + '.');
    const patch = { title: draft.title.trim(), color: draft.color, x, y, width, height };
    if (draft.id) apply(updateCanvasSpace(docRef.current, draft.id, patch));
    else {
      const next = addCanvasSpace(docRef.current, patch);
      apply(next.document);
      setSpaceId(next.spaceId);
    }
    setMode('spaces');
    setSelectedIds([]);
    setLinkFrom(null);
    closeDialog();
  }

  function updateSpaceDraft(patch: Partial<SpaceDraft>) {
    setDialog((current) => current?.kind === 'space' ? { ...current, draft: { ...current.draft, ...patch } } : current);
    setDialogError('');
  }

  function deleteSpace(space: CanvasSpace) {
    Alert.alert('Delete ' + space.title + '?', 'Its cards will stay on the board.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => safeChange(() => {
        apply(removeCanvasSpace(docRef.current, space.id)); setSpaceId(null);
      }) },
    ]);
  }

  function saveEdge(draft: EdgeDraft) {
    if (draft.id) {
      apply(updateCanvasEdge(docRef.current, draft.id, { kind: draft.kind, directed: draft.directed, label: draft.label.trim() }));
    } else {
      apply(addCanvasEdge(docRef.current, { from: draft.from, to: draft.to, kind: draft.kind, directed: draft.directed, label: draft.label.trim() }));
    }
    closeDialog();
  }

  function runLayout(mode: CanvasLayoutMode) {
    apply(arrangeAndFit(docRef.current, mode));
    closeDialog();
  }

  function arrangeAndFit(current: CanvasDocument, mode: CanvasLayoutMode, focusFamilyId?: string) {
    const active = activeCanvasBoard(current);
    const arranged = arrangeCanvas(active, mode);
    const visible = visibleCanvasBoard(arranged).nodes;
    const family = arranged.families?.find(({ id }) => id === focusFamilyId);
    const people = new Set(family ? [...family.parents, ...family.children] : []);
    const familyBounds = visible.filter(({ id }) => people.has(id));
    return updateCanvasBoard(current, active.id, () => ({
      ...arranged, viewport: fitCanvasWorkplane(familyBounds.length ? familyBounds : [...visible, ...(arranged.spaces ?? [])], size, workplane),
    }));
  }

  function saveFamily(form: FamilyForm) {
    const next = saveCanvasFamily(docRef.current, form);
    apply(arrangeAndFit(next.document, 'pedigree', next.familyId));
    setSelectedIds([]);
    setLinkFrom(null);
    setMulti(false);
    setMode('text');
    closeDialog();
  }

  function deleteFamily(family: CanvasFamily) {
    Alert.alert('Remove family?', 'The people stay on the board.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => safeChange(() => {
        apply(removeCanvasFamily(docRef.current, family.id));
        openDialog({ kind: 'families' });
      }) },
    ]);
  }

  function restore(which: 'undo' | 'redo') {
    if (!finishCapture(true)) return;
    const stack = history.current[which];
    const previous = stack.pop();
    if (!previous) return;
    history.current[which === 'undo' ? 'redo' : 'undo'].push(docRef.current);
    publishHistory();
    setSelectedIds([]);
    setLinkFrom(null);
    apply(previous, false);
  }

  function removeSelected(node: CanvasNode) {
    const detail = node.kind === 'group' ? 'Its cards will stay on the board.' : 'Connections to this card will also be removed.';
    Alert.alert('Delete ' + nodeName(node) + '?', detail, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => safeChange(() => {
        apply(removeCanvasNode(docRef.current, node.id)); setSelectedIds([]);
      }) },
    ]);
  }

  function updateDraft(patch: Partial<NodeDraft>) {
    setDialog((current) => current?.kind === 'node' ? { ...current, draft: { ...current.draft, ...patch } } : current);
    setDialogError('');
  }

  function updateEdgeDraft(patch: Partial<EdgeDraft>) {
    setDialog((current) => current?.kind === 'edge' ? { ...current, draft: { ...current.draft, ...patch } } : current);
    setDialogError('');
  }

  function updateDialogText(value: string) {
    setDialog((current) => current && 'text' in current ? { ...current, text: value } : current);
    setDialogError('');
  }

  const ellipses = (board.spaces ?? []).map((stored) => {
    const movingSpace = preview?.space;
    const space = movingSpace?.id === stored.id ? { ...stored, ...spaceGeometry(stored, movingSpace.resize, movingSpace.delta) } : stored;
    const start = screenPoint(space, sceneViewport);
    const width = space.width * sceneViewport.zoom, height = space.height * sceneViewport.zoom;
    if (!intersectsCanvasViewport(start, { x: start.x + width, y: start.y + height }, sceneSize)) return null;
    const diameter = Math.min(width, height);
    const color = space.color ?? SPACE_COLORS[0]!.value;
    const active = space.id === spaceId && mode === 'spaces';
    const showHandles = mode === 'spaces';
    return <View key={space.id} pointerEvents="box-none" style={[styles.space, { left: start.x, top: start.y, width, height }]}>
      <View pointerEvents="none" style={{ position: 'absolute', width: diameter, height: diameter, borderRadius: diameter / 2,
        left: (width - diameter) / 2, top: (height - diameter) / 2, backgroundColor: fillOpacity(color),
        borderColor: color, borderWidth: active ? 2 : 1, transform: [{ scaleX: width / diameter }, { scaleY: height / diameter }] }} />
      {showHandles ? <Pressable accessibilityRole="button" accessibilityLabel={'Select or drag ' + space.title}
        accessibilityState={{ selected: active }} onPress={() => { setSpaceId(space.id); setSelectedIds([]); }}
        onTouchStart={() => armSpace(space.id)} style={[styles.spaceTitle, { maxWidth: Math.max(44, width * 0.58) }]}>
        <Text numberOfLines={1} style={styles.spaceTitleText}>{space.title}</Text>
      </Pressable> : width >= 40 ? <View pointerEvents="none" style={[styles.spaceTitle, { maxWidth: width * 0.65 }]}>
        <Text numberOfLines={1} style={styles.spaceTitleText}>{space.title}</Text>
      </View> : null}
      {active ? <Pressable accessibilityRole="button" accessibilityLabel={'Resize ' + space.title}
        accessibilityHint="Drag to resize or tap to enter dimensions"
        onTouchStart={() => armSpace(space.id, true)} onPress={() => editSpace(stored)}
        style={[styles.spaceResize, { left: width * 0.85 - 22, top: height * 0.85 - 22 }]}>
        <View pointerEvents="none" style={[styles.resizeDot, { backgroundColor: color }]} />
      </Pressable> : null}
    </View>;
  });

  const captureLogical = capture && screenPoint(capture.point, viewport);
  const capturePoint = captureLogical && (workplane === null ? captureLogical : projectCanvasWorkplane(captureLogical, size, workplane));
  const captureWidth = Math.min(290, Math.max(120, size.width - 16));
  const fitBounds = [...visualNodes, ...(board.spaces ?? []), ...ink.map(({ bounds }) => ({ x: bounds.x, y: bounds.y,
    width: Math.max(1, bounds.right - bounds.x), height: Math.max(1, bounds.bottom - bounds.y) }))];

  const drawing = visualNodes.map((node) => {
    const start = screenPoint(node, sceneViewport);
    const end = screenPoint({ x: node.x + node.width, y: node.y + node.height }, sceneViewport);
    if (!intersectsCanvasViewport(start, end, sceneSize)) return null;
    const scale = sceneViewport.zoom;
    const left = start.x, top = start.y, width = Math.max(1, end.x - left), height = Math.max(1, end.y - top);
    const active = selectedIds.includes(node.id) || linkFrom === node.id;
    const expandedGroup = node.kind === 'group' && !node.collapsed;
    const rect: ViewStyle = { left, top, width, height };
    const fontSize = Math.max(9, Math.min(34, 14 * scale));
    const showText = scale >= 0.36 && width >= 28;
    const cardColor = node.color ?? colors.panel;
    const ink = node.color ? '#242126' : colors.ink;
    const onPress = () => chooseNode(node.id);
    const onAccessibilityAction = (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === 'edit') editNode(node);
    };
    const text = node.text || nodeName(node);
    if (expandedGroup) {
      return <View key={node.id} pointerEvents="box-none" style={[styles.groupFrame, rect,
        { borderColor: active ? colors.accent : node.color ?? colors.silver }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={'Group ' + nodeName(node)}
          accessibilityState={{ selected: active, expanded: true }} accessibilityActions={[{ name: 'edit', label: 'Edit group' }]}
          onAccessibilityAction={onAccessibilityAction} onTouchStart={() => armNode(node.id)} onPress={onPress}
          style={[styles.groupHeading, { height: Math.max(19, Math.min(58, 26 * scale)), backgroundColor: cardColor }]}>
          <Text numberOfLines={1} style={{ fontSize, color: ink, fontWeight: '600' }}>{text}</Text>
        </Pressable>
      </View>;
    }
    const tapProps = {
      accessibilityRole: 'button' as const, accessibilityLabel: nodeName(node),
      accessibilityActions: [{ name: 'edit', label: 'Edit card' }], onAccessibilityAction,
      onTouchStart: () => armNode(node.id), onPress, onLongPress: () => { if (!multi && !linkFrom) editNode(node); },
    };
    if (isCanvasPerson(node.kind)) {
      const bounds = canvasPersonSymbol(node);
      const symbol = bounds.width * scale;
      const diamond = node.kind === 'person-diamond';
      const side = diamond ? symbol / Math.SQRT2 : symbol;
      const inset = (symbol - side) / 2;
      const nameTop = (bounds.y - node.y + bounds.height + 5) * scale;
      return <Pressable key={node.id} {...tapProps} accessibilityState={{ selected: active }} style={[styles.person, rect]}>
        <View pointerEvents="none" style={{
          position: 'absolute', left: (bounds.x - node.x) * scale + inset, top: (bounds.y - node.y) * scale + inset,
          width: side, height: side, borderWidth: active ? 2 : 1.4, borderColor: active ? colors.accent : colors.ink,
          backgroundColor: node.color ?? colors.surface, borderRadius: node.kind === 'person-circle' ? symbol / 2 : 0,
          transform: diamond ? [{ rotate: '45deg' }] : undefined,
        }} />
        {showText && node.text.trim() ? <Text numberOfLines={Math.max(1, Math.floor((height - nameTop) / (fontSize * 1.2)))}
          style={[styles.personName, { top: nameTop, fontSize, color: colors.ink, fontWeight: active ? '700' : '500' }]}>
          {node.text}
        </Text> : null}
      </Pressable>;
    }
    return <Pressable key={node.id} {...tapProps}
      accessibilityState={{ selected: active, ...(node.kind === 'group' ? { expanded: false } : {}) }}
      style={[styles.card, scene && styles.workplaneCard, rect, { backgroundColor: cardColor,
        padding: Math.min(12, 7 * scale), borderColor: active ? colors.accent : colors.hairline,
        borderWidth: active ? 2 : 1 }, node.kind === 'partnership' && styles.partnership]}>
      {node.kind === 'image' && safeWebUrl(node.url) && showText ? <Image source={{ uri: node.url! }}
        style={styles.cardImage} accessibilityLabel={nodeName(node)} resizeMode="contain" /> : null}
      {showText ? <Text numberOfLines={Math.max(1, Math.floor(height / (fontSize * 1.3)) - 1)}
        style={[styles.cardText, { fontSize, color: ink },
          (node.kind === 'heading' || node.kind === 'group') && styles.strong,
          node.checked && styles.checked]}>
        {node.kind === 'task' || node.kind === 'checklist' ? (node.checked ? '☑ ' : '☐ ') : ''}
        {text}
      </Text> : null}
    </Pressable>;
  });

  const familyBeingEdited = dialog?.kind === 'family' ? board.families?.find(({ id }) => id === dialog.familyId) : undefined;
  const familiesShown = dialog?.kind === 'families' ? (board.families ?? []).filter((family) =>
    !dialog.personId || family.parents.includes(dialog.personId) || family.children.includes(dialog.personId)) : [];
  const dialogTitle = dialog?.kind === 'boards' ? 'Workspaces' : dialog?.kind === 'search' ? 'Search Canvas' :
    dialog?.kind === 'layout' ? 'Auto Arrange' : dialog?.kind === 'group' ? 'Group cards' :
      dialog?.kind === 'connections' ? 'Connections' : dialog?.kind === 'edge' ? 'Connection' :
        dialog?.kind === 'space' ? (dialog.draft.id ? 'Edit space' : 'Add space') :
          dialog?.kind === 'membership' ? 'Card spaces' : dialog?.kind === 'families' ? 'Families' :
            dialog?.kind === 'family' ? (dialog.familyId ? 'Edit family' : 'Add family') :
              dialog?.kind === 'node' && dialog.draft.id ? 'Edit card' : 'Add card';

  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
    <View style={[styles.bar, styles.commandBar]}>
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}
        style={styles.commandScroll} contentContainerStyle={styles.barContent}>
        <Tool title={board.title} accessibilityLabel={'Workspaces, current workspace ' + board.title} styles={styles} compact
          onPress={() => openDialog({ kind: 'boards', text: '' })} />
        <Tool title="+ Family" accessibilityLabel="Add family" styles={styles} onPress={() => openDialog({ kind: 'family' })} />
        <Tool title="+ Card" accessibilityLabel="Add card" styles={styles} onPress={() => editNode()} />
        <Tool title="Auto Arrange" styles={styles} disabled={!board.nodes.length} onPress={() => openDialog({ kind: 'layout' })} />
        <Tool title="Select" styles={styles} selected={multi} onPress={() => {
          setMulti(!multi); setSelectedIds([]); setLinkFrom(null);
        }} />
        <Tool title="Search" styles={styles} onPress={() => openDialog({ kind: 'search', text: '' })} />
      </ScrollView>
    </View>
    {mode === 'spaces' && !selection.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false}
      style={styles.bar} contentContainerStyle={styles.barContent}>
      <Tool title="+ Space" accessibilityLabel="Add space" styles={styles} onPress={() => editSpace()} />
      {selectedSpace ? <>
        <Text style={styles.selectionLabel} numberOfLines={1}>{selectedSpace.title}</Text>
        <Tool title="Edit" accessibilityLabel="Edit selected space" styles={styles} onPress={() => editSpace(selectedSpace)} />
        <Tool title="Delete" accessibilityLabel="Delete selected space" styles={styles} onPress={() => deleteSpace(selectedSpace)} />
      </> : <Text style={styles.hint}>Drag a space by its label.</Text>}
    </ScrollView> : null}
    {linkFrom ? <View style={styles.hintRow}>
      <Text accessibilityLiveRegion="polite" style={styles.hint}>Tap a destination card to connect it.</Text>
      <Tool title="Cancel" styles={styles} onPress={() => setLinkFrom(null)} />
    </View> : selection.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false}
      style={styles.bar} contentContainerStyle={styles.barContent}>
      {selected ? <>
        <Tool title="Edit" styles={styles} onPress={() => editNode(selected)} />
        {isCanvasPerson(selected.kind) ? <Tool title="Families" styles={styles}
          onPress={() => openDialog({ kind: 'families', personId: selected.id })} /> : null}
        {selected.kind !== 'group' && board.spaces?.length ? <Tool
          title={selected.spaceIds?.length ? 'Spaces (' + selected.spaceIds.length + ')' : 'Spaces'} accessibilityLabel="Assign card to spaces"
          styles={styles} onPress={() => openDialog({ kind: 'membership', nodeId: selected.id, spaceIds: selected.spaceIds ?? [] })} /> : null}
        <Tool title="Connect" styles={styles} onPress={() => setLinkFrom(selected.id)} />
        <Tool title="Connections" styles={styles} onPress={() => openDialog({ kind: 'connections', nodeId: selected.id })} />
        {selected.kind === 'group' ? <Tool title={selected.collapsed ? 'Expand' : 'Collapse'} styles={styles}
          onPress={() => safeChange(() => apply(updateCanvasNode(docRef.current, selected.id, { collapsed: !selected.collapsed })))} /> : null}
        {selected.groupId ? <Tool title="Remove from group" styles={styles}
          onPress={() => safeChange(() => apply(updateCanvasNode(docRef.current, selected.id, { groupId: null })))} /> : null}
        {(selected.kind === 'task' || selected.kind === 'checklist') ? <Tool title={selected.checked ? 'Mark open' : 'Mark done'} styles={styles}
          onPress={() => safeChange(() => apply(updateCanvasNode(docRef.current, selected.id, { checked: !selected.checked })))} /> : null}
        {selected.kind === 'link' && safeWebUrl(selected.url) ? <Tool title="Open link" styles={styles}
          onPress={() => void Linking.openURL(selected.url!).catch(() => Alert.alert('Could not open the link'))} /> : null}
        <Tool title="Delete" styles={styles} onPress={() => removeSelected(selected)} />
      </> : <>
        <Text style={styles.selectionLabel}>{selection.length} selected</Text>
        <Tool title="Group" styles={styles} onPress={() => openDialog({ kind: 'group', text: '' })} />
      </>}
      <Tool title="Deselect" styles={styles} onPress={() => { setSelectedIds([]); setMulti(false); }} />
    </ScrollView> : null}

    <View style={styles.stageHost}>
      <View ref={stageRef} collapsable={false} onLayout={stageLayout} style={[styles.stage, scene && styles.workplaneStage]}
        {...responder.panHandlers}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={tapBackdrop} />
        <View pointerEvents="box-none" collapsable={false} style={scene?.style ?? StyleSheet.absoluteFill}>
          <View pointerEvents="box-none" collapsable={false} style={[StyleSheet.absoluteFill, scene?.rotation]}>
            {scene && workplane !== null ? <WorkplaneGrid viewport={viewport} size={size} offset={scene.offset} turn={workplane} colors={colors} /> :
              <CanvasGrid viewport={viewport} size={size} styles={styles} />}
            {ellipses}
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {ink.map(({ stroke, bounds }) => intersectsCanvasViewport(screenPoint(bounds, sceneViewport),
                screenPoint({ x: bounds.right, y: bounds.bottom }, sceneViewport), sceneSize) ?
                <InkDrawing key={stroke.id} stroke={stroke} viewport={sceneViewport} size={sceneSize} fallback={colors.ink} /> : null)}
              {preview?.points ? <InkDrawing stroke={{ points: preview.points, width: 2 }} viewport={sceneViewport}
                size={sceneSize} fallback={colors.ink} /> : null}
            </View>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {routes.map(({ edge, points }) => <EdgeDrawing key={edge.id} edge={edge} points={points} viewport={sceneViewport}
                size={sceneSize} color={edge.kind === 'dependency' ? colors.warning : colors.muted} styles={styles} />)}
              {familyRoutes.map(({ familyId, points, label }, index) => <FamilyDrawing key={familyId + ':' + index} points={points}
                label={label} viewport={sceneViewport} size={sceneSize} color={colors.ink} styles={styles} />)}
            </View>
            {drawing}
          </View>
        </View>
        {capture && capturePoint ? <View style={[styles.capture, {
          left: Math.max(8, Math.min(size.width - captureWidth - 8, capturePoint.x)),
          top: Math.max(8, Math.min(size.height - 116, capturePoint.y)), width: captureWidth,
        }]}>
          <TextInput accessibilityLabel="Canvas text" placeholder="Type here" placeholderTextColor={colors.muted} autoFocus multiline
            defaultValue={capture.text} onChangeText={(value) => { if (captureRef.current) captureRef.current.text = value; }}
            keyboardAppearance={resolvedMode} style={[styles.field, styles.captureInput]} />
          <View style={styles.captureActions}>
            <Tool title="×" accessibilityLabel="Cancel canvas text" styles={styles} onPress={() => finishCapture(false)} />
            <Tool title="✓" accessibilityLabel="Save canvas text" styles={styles} onPress={() => finishCapture(true)} />
          </View>
        </View> : null}
        {!board.nodes.length && !board.spaces?.length && !board.strokes?.length && !capture && mode === 'text' ? <View pointerEvents="none" style={styles.empty}>
          <Text accessibilityRole="header" style={styles.emptyHeading}>Canvas</Text>
          <Text style={styles.emptyText}>Tap anywhere to type.</Text>
        </View> : null}
      </View>
      {!capture ? <View pointerEvents="box-none" style={styles.workplaneActions}>
        {workplane !== null ? <Tool title="↻" accessibilityLabel="Rotate workplane" styles={styles}
          onPress={() => changeWorkplane(nextCanvasWorkplaneTurn(workplane))} /> : null}
        <Tool title={workplane === null ? '3D' : 'Flat'} accessibilityLabel={workplane === null ? '3D Workplane' : 'Flat canvas'}
          styles={styles} onPress={() => changeWorkplane(workplane === null ? lastWorkplaneTurn.current : null)} />
      </View> : null}
    </View>
    <View style={styles.footer}>
      <View style={styles.footerActions}>{BOARD_MODES.map(({ id, name }) => <Tool key={id} title={name} styles={styles}
        selected={mode === id} onPress={() => changeMode(id)} />)}</View>
      <View style={styles.footerActions}>
        <Tool title="−" accessibilityLabel="Zoom out" styles={styles} onPress={() => zoomBy(0.8)} />
        <Tool title="Fit" accessibilityLabel="Fit board to screen" styles={styles}
          onPress={() => goToViewport(fitCanvasWorkplane(fitBounds, size, workplane))} />
        <Tool title="+" accessibilityLabel="Zoom in" styles={styles} onPress={() => zoomBy(1.25)} />
      </View>
    </View>

    <Modal visible={Boolean(dialog)} transparent animationType="fade" onRequestClose={closeDialog}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.scrim}>
        <View accessibilityViewIsModal style={styles.dialog}>
          <View style={styles.dialogHeading}>
            <Text accessibilityRole="header" style={styles.dialogTitle}>{dialogTitle}</Text>
            <Tool title="Close" styles={styles} onPress={closeDialog} />
          </View>
          <ScrollView key={dialog?.kind === 'family' ? dialog.familyId ?? 'new-family' : dialog?.kind === 'families' ? 'families' : 'dialog'}
            keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogContent}>
            {dialog?.kind === 'boards' ? <>
              {document.boards.map((item) => <Tool key={item.id} title={item.title} selected={item.id === board.id} styles={styles}
                onPress={() => safeChange(() => { apply(selectCanvasBoard(docRef.current, item.id), false); closeDialog(); })} />)}
              <TextInput accessibilityLabel="Workspace name" placeholder="Workspace name" placeholderTextColor={colors.muted}
                value={dialog.text} onChangeText={updateDialogText} maxLength={120} style={styles.field} />
              <View style={styles.wrap}>
                <Tool title="New workspace" styles={styles} disabled={!dialog.text.trim()} onPress={() => safeChange(() => {
                  apply(addCanvasBoard(docRef.current, dialog.text.trim())); closeDialog();
                })} />
                <Tool title="Rename current" styles={styles} disabled={!dialog.text.trim()} onPress={() => safeChange(() => {
                  apply(renameCanvasBoard(docRef.current, board.id, dialog.text.trim())); closeDialog();
                })} />
              </View>
            </> : null}
            {dialog?.kind === 'search' ? <>
              <TextInput accessibilityLabel="Search cards and workspaces" placeholder="Search cards and workspaces"
                placeholderTextColor={colors.muted} autoFocus value={dialog.text} onChangeText={updateDialogText} style={styles.field} />
              {dialog.text.trim() && !searchResults.length ? <Text style={styles.hint}>No matching cards.</Text> : null}
              {searchResults.slice(0, 80).map(({ boardId, boardTitle, node }) => <Pressable key={boardId + ':' + node.id}
                accessibilityRole="button" style={styles.result} onPress={() => { if (revealNode(node.id, boardId)) closeDialog(); }}>
                <Text style={styles.toolText} numberOfLines={2}>{nodeName(node)}</Text>
                <Text style={styles.hint}>{boardTitle}</Text>
              </Pressable>)}
              {searchResults.length > 80 ? <Text style={styles.hint}>Refine the search to see more matches.</Text> : null}
            </> : null}
            {dialog?.kind === 'layout' ? LAYOUTS.map(({ id, title, detail }) => <Pressable key={id} accessibilityRole="button"
              style={styles.result} onPress={() => safeChange(() => runLayout(id))}>
              <Text style={styles.toolText}>{title}</Text>
              <Text style={styles.hint}>{detail}</Text>
            </Pressable>) : null}
            {dialog?.kind === 'group' ? <>
              <TextInput accessibilityLabel="Group name" placeholder="Group name" placeholderTextColor={colors.muted}
                autoFocus value={dialog.text} onChangeText={updateDialogText} maxLength={120} style={styles.field} />
              <Tool title="Create group" styles={styles} disabled={!dialog.text.trim()} onPress={() => safeChange(() => {
                const next = groupCanvasNodes(docRef.current, selectedIds, dialog.text.trim());
                apply(next.document); setSelectedIds([next.nodeId]); setMulti(false); closeDialog();
              })} />
            </> : null}
            {dialog?.kind === 'space' ? <>
              <TextInput accessibilityLabel="Space name" placeholder="Space name" placeholderTextColor={colors.muted}
                autoFocus value={dialog.draft.title} maxLength={120} onChangeText={(title) => updateSpaceDraft({ title })}
                style={styles.field} />
              <Text style={styles.hint}>Color</Text>
              <View style={styles.wrap}>{SPACE_COLORS.map(({ name, value }) => <Pressable key={name}
                accessibilityRole="button" accessibilityLabel={name + ' space color'} accessibilityState={{ selected: dialog.draft.color === value }}
                onPress={() => updateSpaceDraft({ color: value })} style={styles.swatchTarget}>
                <View style={[styles.swatch, { backgroundColor: value,
                  borderColor: dialog.draft.color === value ? colors.ink : colors.hairline }]} />
              </Pressable>)}</View>
              <View style={styles.wrap}>
                {([{ key: 'x', label: 'X position' }, { key: 'y', label: 'Y position' },
                  { key: 'width', label: 'Width' }, { key: 'height', label: 'Height' }] as const).map(({ key, label }) => <View key={key} style={styles.dimension}>
                  <Text style={styles.hint}>{label}</Text>
                  <TextInput accessibilityLabel={label} keyboardType="numbers-and-punctuation" value={dialog.draft[key]}
                    onChangeText={(value) => updateSpaceDraft({ [key]: value })} style={styles.field} />
                </View>)}
              </View>
              <Tool title="Save space" styles={styles} disabled={!dialog.draft.title.trim()} onPress={() => safeChange(() => saveSpace(dialog.draft))} />
            </> : null}
            {dialog?.kind === 'membership' ? <>
              {(board.spaces ?? []).map((space) => <Pressable key={space.id} accessibilityRole="checkbox"
                accessibilityState={{ checked: dialog.spaceIds.includes(space.id) }} accessibilityLabel={space.title}
                style={styles.membershipRow} onPress={() => setDialog((current) => current?.kind === 'membership' ? {
                  ...current, spaceIds: current.spaceIds.includes(space.id) ? current.spaceIds.filter((id) => id !== space.id) : [...current.spaceIds, space.id],
                } : current)}>
                <View style={[styles.membershipDot, { backgroundColor: space.color ?? SPACE_COLORS[0]!.value }]} />
                <Text numberOfLines={1} style={[styles.toolText, styles.membershipName]}>{space.title}</Text>
                <Text style={styles.toolText}>{dialog.spaceIds.includes(space.id) ? '☑' : '☐'}</Text>
              </Pressable>)}
              <Tool title="Save memberships" styles={styles} onPress={() => safeChange(() => {
                apply(setCanvasNodeSpaces(docRef.current, dialog.nodeId, dialog.spaceIds)); closeDialog();
              })} />
            </> : null}
            {dialog?.kind === 'families' ? <>
              {familiesShown.map((family) => {
                const title = family.parents.map((id) => nodeName(people.find((person) => person.id === id))).join(' + ');
                return <Pressable key={family.id} accessibilityRole="button" style={styles.result}
                  onPress={() => openDialog({ kind: 'family', familyId: family.id })}>
                  <Text style={styles.toolText}>{title}</Text>
                  <Text style={styles.hint}>{family.children.length + (family.children.length === 1 ? ' child' : ' children')}
                    {family.relationshipLabel ? ' · ' + family.relationshipLabel : ''}</Text>
                </Pressable>;
              })}
              {!familiesShown.length ? <Text style={styles.hint}>No families here yet.</Text> : null}
              <Tool title="+ Family" accessibilityLabel="Add family" styles={styles}
                onPress={() => openDialog({ kind: 'family', seedPersonId: dialog.personId })} />
            </> : null}
            {dialog?.kind === 'family' && (!dialog.familyId || familyBeingEdited) ?
              <CanvasFamilyEditor key={dialog.familyId ?? 'new:' + (dialog.seedPersonId ?? '')} family={familyBeingEdited}
                people={people} seedPersonId={dialog.seedPersonId} onSave={(form) => safeChange(() => saveFamily(form))}
                onManage={board.families?.length ? () => openDialog({ kind: 'families' }) : undefined}
                onRemove={familyBeingEdited ? () => deleteFamily(familyBeingEdited) : undefined} /> : null}
            {dialog?.kind === 'node' ? <>
              {!dialog.draft.id ? <View style={styles.wrap}>{NODE_KINDS.map(({ id, name }) =>
                <Tool key={id} title={name} styles={styles} selected={dialog.draft.kind === id} onPress={() => {
                  const next = dimensions(id);
                  updateDraft({ kind: id, width: String(next.width), height: String(next.height) });
                }} />)}</View> : null}
              {dialog.draft.id && isCanvasPerson(dialog.draft.kind) ? <View style={styles.wrap}>
                {NODE_KINDS.filter(({ id }) => isCanvasPerson(id)).map(({ id, name }) =>
                  <Tool key={id} title={name} styles={styles} selected={dialog.draft.kind === id} onPress={() => updateDraft({ kind: id })} />)}
              </View> : null}
              <TextInput accessibilityLabel="Card text" placeholder="Card text" placeholderTextColor={colors.muted} autoFocus
                value={dialog.draft.text} onChangeText={(value) => updateDraft({ text: value })} multiline
                keyboardAppearance={resolvedMode} style={[styles.field, styles.noteField]} />
              {dialog.draft.id && board.nodes.find(({ id }) => id === dialog.draft.id)?.source ?
                <Text style={styles.hint}>Edits to this card also update its text in Notepad.</Text> : null}
              {dialog.draft.kind === 'link' || dialog.draft.kind === 'image' ? <TextInput accessibilityLabel="Web address"
                placeholder="https://" placeholderTextColor={colors.muted} keyboardType="url" autoCapitalize="none" autoCorrect={false}
                value={dialog.draft.url} onChangeText={(value) => updateDraft({ url: value })} style={styles.field} /> : null}
              <Text style={styles.hint}>Color</Text>
              <View style={styles.wrap}>{CARD_COLORS.map(({ name, value }) => <Pressable key={name}
                accessibilityRole="button" accessibilityLabel={name + ' card color'} accessibilityState={{ selected: dialog.draft.color === value }}
                onPress={() => updateDraft({ color: value })} style={styles.swatchTarget}>
                <View style={[styles.swatch, { backgroundColor: value ?? colors.panel,
                  borderColor: dialog.draft.color === value ? colors.accent : colors.hairline }]} />
              </Pressable>)}</View>
              {dialog.draft.id && positionLocked.has(dialog.draft.id) ?
                <Text style={styles.hint}>Pedigree layout positions this card. Edit the family to reorder children.</Text> : <View style={styles.wrap}>
                {([{ key: 'x', label: 'X position' }, { key: 'y', label: 'Y position' },
                  { key: 'width', label: 'Width' }, { key: 'height', label: 'Height' }] as const).map(({ key, label }) => <View key={key} style={styles.dimension}>
                  <Text style={styles.hint}>{label}</Text>
                  <TextInput accessibilityLabel={label} keyboardType="numbers-and-punctuation" value={dialog.draft[key]}
                    onChangeText={(value) => updateDraft({ [key]: value })} style={styles.field} />
                </View>)}
              </View>}
              <Tool title="Save card" styles={styles} onPress={() => safeChange(() => saveNode(dialog.draft))} />
            </> : null}
            {dialog?.kind === 'edge' ? <>
              <Text style={styles.hint}>{nodeName(board.nodes.find(({ id }) => id === dialog.draft.from))} → {' '}
                {nodeName(board.nodes.find(({ id }) => id === dialog.draft.to))}</Text>
              <View style={styles.wrap}>{EDGE_KINDS.map(({ id, name }) => <Tool key={id} title={name} styles={styles}
                selected={dialog.draft.kind === id}
                onPress={() => updateEdgeDraft({ kind: id, directed: id === 'parent' || id === 'dependency' })} />)}</View>
              <View style={styles.toggleRow}><Text style={styles.toolText}>Directional</Text>
                <Switch accessibilityLabel="Directional connection" value={dialog.draft.directed}
                  onValueChange={(directed) => updateEdgeDraft({ directed })} />
              </View>
              <TextInput accessibilityLabel="Connection label" placeholder="Optional label" placeholderTextColor={colors.muted}
                value={dialog.draft.label} maxLength={200} onChangeText={(label) => updateEdgeDraft({ label })} style={styles.field} />
              <Tool title="Save connection" styles={styles} onPress={() => safeChange(() => saveEdge(dialog.draft))} />
            </> : null}
            {dialog?.kind === 'connections' ? (() => {
              const edges = board.edges.filter((edge) => edge.from === dialog.nodeId || edge.to === dialog.nodeId);
              if (!edges.length) return <Text style={styles.hint}>This card has no connections.</Text>;
              return edges.map((edge) => <View key={edge.id} style={styles.connectionRow}>
                <View style={styles.connectionTitle}>
                  <Text style={styles.toolText}>{nodeName(board.nodes.find(({ id }) => id === edge.from))}
                    {edge.directed ? ' → ' : ' — '}{nodeName(board.nodes.find(({ id }) => id === edge.to))}</Text>
                  <Text style={styles.hint}>{edge.label || edgeName(edge.kind)}</Text>
                </View>
                <Tool title="Edit" styles={styles} onPress={() => openDialog({ kind: 'edge', draft: { ...edge, label: edge.label ?? '' } })} />
                <Tool title="Remove" styles={styles} onPress={() => safeChange(() => apply(removeCanvasEdge(docRef.current, edge.id)))} />
              </View>);
            })() : null}
            {dialogError ? <Text accessibilityRole="alert" style={styles.error}>{dialogError}</Text> : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </KeyboardAvoidingView>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  bar: { flexGrow: 0, flexShrink: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  commandBar: { flexDirection: 'row', alignItems: 'center', minHeight: 50 },
  commandScroll: { flex: 1 },
  barContent: { minHeight: 50, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, gap: 3 },
  tool: { minHeight: 44, minWidth: 42, maxWidth: 156, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center', borderRadius: 7 },
  compactTool: { maxWidth: 88, paddingHorizontal: 7 },
  toolText: { color: colors.ink, fontSize: 14, fontWeight: '500' },
  activeTool: { backgroundColor: colors.panel },
  disabled: { opacity: 0.42 },
  selectionLabel: { color: colors.muted, paddingHorizontal: 10, fontSize: 13, maxWidth: 160 },
  stageHost: { flex: 1 },
  stage: { flex: 1, overflow: 'hidden', backgroundColor: colors.surface },
  workplaneStage: { backgroundColor: colors.panel },
  workplaneActions: { position: 'absolute', top: 7, right: 7, flexDirection: 'row', borderRadius: 8,
    borderColor: colors.hairline, borderWidth: StyleSheet.hairlineWidth, backgroundColor: colors.paper },
  workplaneCard: { boxShadow: '1px 3px 0px 0px rgba(0, 0, 0, 0.12)' },
  gridVertical: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, opacity: 0.65 },
  gridHorizontal: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, opacity: 0.65 },
  card: { position: 'absolute', overflow: 'hidden', borderWidth: 1, borderRadius: 7, justifyContent: 'center' },
  cardText: { flexShrink: 1, includeFontPadding: false },
  checked: { textDecorationLine: 'line-through', opacity: 0.65 },
  strong: { fontWeight: '700' },
  person: { position: 'absolute' },
  personName: { position: 'absolute', left: 0, right: 0, textAlign: 'center', includeFontPadding: false },
  familyLabel: { position: 'absolute', width: 160, textAlign: 'center', color: colors.ink, fontSize: 11 },
  partnership: { alignItems: 'center', borderRadius: 40 },
  cardImage: { flex: 1, width: '100%', minHeight: 0 },
  groupFrame: { position: 'absolute', borderWidth: 1.5, borderRadius: 9, overflow: 'hidden' },
  groupHeading: { paddingHorizontal: 8, justifyContent: 'center' },
  edgeLabel: { position: 'absolute', maxWidth: 145, paddingHorizontal: 3, color: colors.graphite, backgroundColor: colors.surface, fontSize: 11 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  footerActions: { flexDirection: 'row', alignItems: 'center' },
  space: { position: 'absolute' },
  spaceTitle: { position: 'absolute', left: '7%', top: 0, minHeight: 32, borderRadius: 6,
    backgroundColor: colors.panel, justifyContent: 'center', paddingHorizontal: 6 },
  spaceTitleText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  spaceResize: { position: 'absolute', width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  resizeDot: { width: 13, height: 13, borderRadius: 7, borderWidth: 1, borderColor: colors.surface },
  capture: { position: 'absolute', padding: 5, borderWidth: 1, borderColor: colors.accent,
    borderRadius: 9, backgroundColor: colors.panel },
  captureInput: { minHeight: 50, maxHeight: 60, textAlignVertical: 'top' },
  captureActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  membershipRow: { flexDirection: 'row', minHeight: 44, alignItems: 'center', gap: 9, paddingHorizontal: 9 },
  membershipDot: { width: 14, height: 14, borderRadius: 7 },
  membershipName: { flex: 1 },
  empty: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 35, gap: 8 },
  emptyHeading: { fontSize: 24, fontWeight: '600', color: colors.ink },
  emptyText: { maxWidth: 340, color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  hintRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, backgroundColor: colors.panel },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  scrim: { flex: 1, padding: 18, justifyContent: 'center', backgroundColor: colors.scrim },
  dialog: { alignSelf: 'center', maxWidth: 540, width: '100%', maxHeight: '85%', borderRadius: 15,
    backgroundColor: colors.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  dialogHeading: { minHeight: 55, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  dialogTitle: { fontSize: 18, fontWeight: '600', color: colors.ink },
  dialogContent: { padding: 13, gap: 7 },
  field: { minHeight: 44, borderWidth: 1, borderColor: colors.hairline, color: colors.ink,
    backgroundColor: colors.surface, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7, fontSize: 15 },
  noteField: { minHeight: 100, maxHeight: 220, textAlignVertical: 'top' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  dimension: { flexBasis: '46%', flexGrow: 1, minWidth: 100 },
  swatchTarget: { minWidth: 40, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  swatch: { width: 25, height: 25, borderRadius: 13, borderWidth: 2 },
  result: { minHeight: 50, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingLeft: 7, minHeight: 44 },
  connectionRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  connectionTitle: { flex: 1 },
  error: { color: colors.danger, paddingVertical: 5 },
});
