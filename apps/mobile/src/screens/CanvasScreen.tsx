import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Alert, Image, KeyboardAvoidingView, Linking, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet,
  Switch, Text, TextInput, View, type GestureResponderEvent, type LayoutChangeEvent, type ViewStyle } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';
import { activeCanvasBoard, addCanvasBoard, addCanvasEdge, addCanvasNode, groupCanvasNodes, removeCanvasEdge, removeCanvasNode,
  renameCanvasBoard, searchCanvas, selectCanvasBoard, updateCanvasBoard, updateCanvasEdge, updateCanvasNode, updateCanvasViewport,
  type CanvasBoard, type CanvasDocument, type CanvasEdge, type CanvasNode } from '../utils/canvas';
import { arrangeCanvas, routeCanvasEdges, type CanvasLayoutMode } from '../utils/canvas-layout';
import { canvasDragNodes, centerCanvasNode, fitCanvas, intersectsCanvasViewport, previewCanvasRoutes, screenPoint, visibleCanvasBoard, worldPoint, zoomViewport,
  type DragPreview, type Point, type Size, type Viewport } from './canvas-viewport';

type Props = {
  document: CanvasDocument;
  onChange: (next: CanvasDocument) => void;
  focusNodeId?: string | null;
  onFocusConsumed?: () => void;
};
type NodeKind = CanvasNode['kind'];
type NodeDraft = {
  id?: string; kind: NodeKind; text: string; url: string; color?: string; checked: boolean;
  x: string; y: string; width: string; height: string;
};
type EdgeDraft = { id?: string; from: string; to: string; kind: CanvasEdge['kind']; directed: boolean; label: string };
type Dialog = { kind: 'boards' | 'group' | 'search'; text: string } | { kind: 'layout' } |
  { kind: 'node'; draft: NodeDraft } | { kind: 'edge'; draft: EdgeDraft } | { kind: 'connections'; nodeId: string };
type Gesture = { boardId: string; origin: Point; viewport: Viewport; nodeId?: string;
  pinch?: { viewport: Viewport; center: Point; distance: number } };
type Preview = { viewport?: Viewport; drag?: DragPreview };
type Touches = GestureResponderEvent['nativeEvent']['touches'];

const NODE_KINDS: { id: NodeKind; name: string }[] = [
  { id: 'sticky', name: 'Sticky note' }, { id: 'note', name: 'Text' }, { id: 'task', name: 'Task' },
  { id: 'heading', name: 'Heading' }, { id: 'checklist', name: 'Checklist' }, { id: 'link', name: 'Link' },
  { id: 'image', name: 'Image' }, { id: 'person-circle', name: 'Person (circle)' },
  { id: 'person-square', name: 'Person (square)' }, { id: 'partnership', name: 'Partnership' },
];
const EDGE_KINDS: { id: CanvasEdge['kind']; name: string }[] = [
  { id: 'related', name: 'Related' }, { id: 'dependency', name: 'Dependency' },
  { id: 'partnership', name: 'Partnership' }, { id: 'parent', name: 'Parent to child' },
];
const CARD_COLORS = [
  { name: 'Default', value: undefined }, { name: 'Sand', value: '#F5E4A6' }, { name: 'Rose', value: '#F2CED4' },
  { name: 'Mint', value: '#CDE7D9' }, { name: 'Blue', value: '#CEDFF2' }, { name: 'Lilac', value: '#DDD5EF' },
];
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
  if (kind === 'person-circle' || kind === 'person-square') return { width: 120, height: 96 };
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

function Tool({ title, onPress, styles, disabled = false, selected, accessibilityLabel }: {
  title: string; onPress: () => void; styles: ReturnType<typeof createStyles>; disabled?: boolean; selected?: boolean; accessibilityLabel?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title}
    accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={[styles.tool, disabled && styles.disabled, selected && styles.activeTool]}>
    <Text numberOfLines={1} style={styles.toolText}>{title}</Text>
  </Pressable>;
}

function Stroke({ from, to, color }: { from: Point; to: Point; color: string }) {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  if (length < 0.5) return null;
  return <View style={{ position: 'absolute', left: (from.x + to.x - length) / 2, top: (from.y + to.y) / 2 - 0.7,
    width: length, height: 1.4, backgroundColor: color, transform: [{ rotate: String(Math.atan2(dy, dx)) + 'rad' }] }} />;
}

function EdgeDrawing({ edge, points, viewport, size, color, styles }: {
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
}

function CanvasGrid({ viewport, size, styles }: { viewport: Viewport; size: Size; styles: ReturnType<typeof createStyles> }) {
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
}

export function CanvasScreen({ document, onChange, focusNodeId, onFocusConsumed }: Props) {
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
  const docRef = useRef(document); docRef.current = document;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const stageRef = useRef<ComponentRef<typeof View>>(null);
  const stageOrigin = useRef<Point>({ x: 0, y: 0 });
  const activeGesture = useRef<Gesture | null>(null);
  const previewRef = useRef<Preview | null>(null);
  const previewFrame = useRef<number | null>(null);
  const history = useRef<{ undo: CanvasDocument[]; redo: CanvasDocument[] }>({ undo: [], redo: [] });
  const focusedRequest = useRef<string | null>(null);
  const lastBoardId = useRef(board.id);

  const layout = useMemo(() => visibleCanvasBoard(board), [board]);
  const stableRoutes = useMemo(() => routeCanvasEdges(layout), [layout]);
  const movingId = preview?.drag?.nodeId;
  const moving = useMemo(() => movingId ? canvasDragNodes(board.nodes, movingId) : null, [board.nodes, movingId]);
  const dragDelta = preview?.drag?.delta;
  const visualNodes = useMemo(() => moving && dragDelta
    ? layout.nodes.map((node) => moving.has(node.id) ? { ...node, x: node.x + dragDelta.x, y: node.y + dragDelta.y } : node)
    : layout.nodes, [layout.nodes, moving, dragDelta]);
  const routes = useMemo(() => moving && dragDelta ? previewCanvasRoutes(stableRoutes, moving, dragDelta) : stableRoutes,
    [stableRoutes, moving, dragDelta]);
  const viewport = preview?.viewport ?? board.viewport;
  const selection = board.nodes.filter(({ id }) => selectedIds.includes(id));
  const selected = selection.length === 1 ? selection[0] : undefined;
  const searchResults = useMemo(() => dialog?.kind === 'search' ? searchCanvas(document, dialog.text) : [], [document, dialog]);

  function apply(next: CanvasDocument, remember = true) {
    const previous = docRef.current;
    if (next === previous) return;
    if (remember) {
      history.current.undo = [...history.current.undo.slice(-29), previous];
      history.current.redo = [];
    }
    docRef.current = next;
    onChangeRef.current(next);
  }

  function safeChange(change: () => void) {
    try { change(); }
    catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Canvas could not apply the change.';
      if (dialog) setDialogError(message);
      else Alert.alert('Canvas', message);
    }
  }

  function openDialog(value: Dialog) { setDialogError(''); setDialog(value); }
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
    stageRef.current?.measureInWindow((x, y) => { stageOrigin.current = { x, y }; });
  }

  useEffect(() => () => { if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current); }, []);
  useEffect(() => {
    if (lastBoardId.current === board.id) return;
    lastBoardId.current = board.id;
    activeGesture.current = null;
    clearPreview();
    setSelectedIds([]);
    setLinkFrom(null);
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
    function stagePoint(touch: Touches[number]): Point {
      return { x: touch.pageX - stageOrigin.current.x, y: touch.pageY - stageOrigin.current.y };
    }
    function pinch(touches: Touches) {
      const a = touches[0] && stagePoint(touches[0]), b = touches[1] && stagePoint(touches[1]);
      return a && b ? { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
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
        const delta = { x: (point.x - gesture.origin.x) / gesture.viewport.zoom,
          y: (point.y - gesture.origin.y) / gesture.viewport.zoom };
        update(gesture.nodeId ? { drag: { nodeId: gesture.nodeId, delta } } :
          { viewport: { ...gesture.viewport, x: gesture.viewport.x - delta.x, y: gesture.viewport.y - delta.y } });
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
      if (last.viewport) { apply(updateCanvasViewport(current, last.viewport), false); return; }
      const drag = last.drag;
      const node = active.nodes.find(({ id }) => id === drag?.nodeId);
      if (!node || !drag || (!drag.delta.x && !drag.delta.y)) return;
      try {
        apply(updateCanvasNode(current, node.id, { x: node.x + drag.delta.x, y: node.y + drag.delta.y }));
        setSelectedIds([node.id]);
      } catch (failure) {
        Alert.alert('Could not move card', failure instanceof Error ? failure.message : undefined);
      }
    }
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: ({ nativeEvent }) => {
        const touch = nativeEvent.touches[0];
        if (!touch) return false;
        if (activeGesture.current && nativeEvent.touches.length > 1) return false;
        const active = activeCanvasBoard(docRef.current);
        activeGesture.current = { boardId: active.id, origin: stagePoint(touch), viewport: active.viewport };
        return false;
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
    if (activeGesture.current) activeGesture.current.nodeId = id;
  }

  function chooseNode(id: string) {
    if (linkFrom && linkFrom !== id) {
      openDialog({ kind: 'edge', draft: { from: linkFrom, to: id, kind: 'related', directed: false, label: '' } });
      setLinkFrom(null);
      return;
    }
    if (multi) setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    else setSelectedIds([id]);
  }

  function editNode(node?: CanvasNode) {
    const point = worldPoint({ x: Math.max(24, size.width * 0.32), y: Math.max(28, size.height * 0.26) }, viewport);
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
    const patch = { text: draft.text, x, y, width, height, color: draft.color, url, checked: draft.checked };
    if (draft.id) {
      apply(updateCanvasNode(docRef.current, draft.id, patch));
      setSelectedIds([draft.id]);
    } else {
      const next = addCanvasNode(docRef.current, { ...patch, kind: draft.kind });
      apply(next.document);
      setSelectedIds([next.nodeId]);
    }
    closeDialog();
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
    const current = docRef.current;
    const active = activeCanvasBoard(current);
    const arranged = arrangeCanvas(active, mode);
    apply(updateCanvasBoard(current, active.id, () => ({ ...arranged, viewport: fitCanvas(visibleCanvasBoard(arranged).nodes, size) })));
    closeDialog();
  }

  function restore(which: 'undo' | 'redo') {
    const stack = history.current[which];
    const previous = stack.pop();
    if (!previous) return;
    history.current[which === 'undo' ? 'redo' : 'undo'].push(docRef.current);
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

  const drawing = visualNodes.map((node) => {
    const start = screenPoint(node, viewport);
    const end = screenPoint({ x: node.x + node.width, y: node.y + node.height }, viewport);
    if (!intersectsCanvasViewport(start, end, size)) return null;
    const scale = viewport.zoom;
    const left = start.x, top = start.y, width = Math.max(1, end.x - left), height = Math.max(1, end.y - top);
    const active = selectedIds.includes(node.id) || linkFrom === node.id;
    const expandedGroup = node.kind === 'group' && !node.collapsed;
    const person = node.kind === 'person-circle' || node.kind === 'person-square';
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
    const symbol = Math.max(8, Math.min(width - 2, height * 0.59, 42 * scale));
    return <Pressable key={node.id} accessibilityRole="button" accessibilityLabel={nodeName(node)}
      accessibilityState={{ selected: active, ...(node.kind === 'group' ? { expanded: false } : {}) }}
      accessibilityActions={[{ name: 'edit', label: 'Edit card' }]} onAccessibilityAction={onAccessibilityAction}
      onTouchStart={() => armNode(node.id)} onPress={onPress} onLongPress={() => { if (!multi && !linkFrom) editNode(node); }}
      style={[styles.card, rect, { backgroundColor: person ? colors.paper : cardColor,
        padding: Math.min(12, 7 * scale), borderColor: active ? colors.accent : colors.hairline,
        borderWidth: active ? 2 : 1 }, person && styles.person, node.kind === 'partnership' && styles.partnership]}>
      {person ? <View style={{ width: symbol, height: symbol, borderWidth: active ? 2 : 1.5, borderColor: active ? colors.accent : colors.graphite,
        backgroundColor: node.color ?? colors.panel, borderRadius: node.kind === 'person-circle' ? symbol / 2 : 2 }} /> : null}
      {node.kind === 'image' && safeWebUrl(node.url) && showText ? <Image source={{ uri: node.url! }}
        style={styles.cardImage} accessibilityLabel={nodeName(node)} resizeMode="contain" /> : null}
      {showText ? <Text numberOfLines={Math.max(1, Math.floor(height / (fontSize * 1.3)) - 1)}
        style={[styles.cardText, { fontSize, color: person ? colors.ink : ink },
          (node.kind === 'heading' || node.kind === 'group') && styles.strong,
          node.checked && styles.checked]}>
        {node.kind === 'task' || node.kind === 'checklist' ? (node.checked ? '☑ ' : '☐ ') : ''}
        {text}
      </Text> : null}
    </Pressable>;
  });

  const dialogTitle = dialog?.kind === 'boards' ? 'Workspaces' : dialog?.kind === 'search' ? 'Search Canvas' :
    dialog?.kind === 'layout' ? 'Auto Arrange' : dialog?.kind === 'group' ? 'Group cards' :
      dialog?.kind === 'connections' ? 'Connections' : dialog?.kind === 'edge' ? 'Connection' :
        dialog?.kind === 'node' && dialog.draft.id ? 'Edit card' : 'Add card';

  return <View style={styles.screen}>
    <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}
      style={styles.bar} contentContainerStyle={styles.barContent}>
      <Tool title={board.title} accessibilityLabel={'Workspaces, current workspace ' + board.title} styles={styles}
        onPress={() => openDialog({ kind: 'boards', text: '' })} />
      <Tool title="+ Card" accessibilityLabel="Add card" styles={styles} onPress={() => editNode()} />
      <Tool title="Auto Arrange" styles={styles} disabled={!board.nodes.length} onPress={() => openDialog({ kind: 'layout' })} />
      <Tool title="Select" styles={styles} selected={multi} onPress={() => {
        setMulti(!multi); setSelectedIds([]); setLinkFrom(null);
      }} />
      <Tool title="Search" styles={styles} onPress={() => openDialog({ kind: 'search', text: '' })} />
      <Tool title="Undo" styles={styles} disabled={!history.current.undo.length} onPress={() => restore('undo')} />
      <Tool title="Redo" styles={styles} disabled={!history.current.redo.length} onPress={() => restore('redo')} />
    </ScrollView>
    {linkFrom ? <View style={styles.hintRow}>
      <Text accessibilityLiveRegion="polite" style={styles.hint}>Tap a destination card to connect it.</Text>
      <Tool title="Cancel" styles={styles} onPress={() => setLinkFrom(null)} />
    </View> : selection.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false}
      style={styles.bar} contentContainerStyle={styles.barContent}>
      {selected ? <>
        <Tool title="Edit" styles={styles} onPress={() => editNode(selected)} />
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

    <View ref={stageRef} collapsable={false} onLayout={stageLayout} style={styles.stage} {...responder.panHandlers}>
      <CanvasGrid viewport={viewport} size={size} styles={styles} />
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {routes.map(({ edge, points }) => <EdgeDrawing key={edge.id} edge={edge} points={points} viewport={viewport}
          size={size} color={edge.kind === 'dependency' ? colors.warning : colors.muted} styles={styles} />)}
      </View>
      {drawing}
      {!board.nodes.length ? <View pointerEvents="none" style={styles.empty}>
        <Text accessibilityRole="header" style={styles.emptyHeading}>Canvas</Text>
        <Text style={styles.emptyText}>Add a card here, or highlight text in Notepad to put it on this board.</Text>
      </View> : null}
    </View>
    <View style={styles.footer}>
      <Text style={styles.hint}>{Math.round(viewport.zoom * 100)}%</Text>
      <View style={styles.footerActions}>
        <Tool title="−" accessibilityLabel="Zoom out" styles={styles} onPress={() => zoomBy(0.8)} />
        <Tool title="Fit" accessibilityLabel="Fit board to screen" styles={styles} onPress={() => goToViewport(fitCanvas(visualNodes, size))} />
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
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.dialogContent}>
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
            {dialog?.kind === 'node' ? <>
              {!dialog.draft.id ? <View style={styles.wrap}>{NODE_KINDS.map(({ id, name }) =>
                <Tool key={id} title={name} styles={styles} selected={dialog.draft.kind === id} onPress={() => {
                  const next = dimensions(id);
                  updateDraft({ kind: id, width: String(next.width), height: String(next.height) });
                }} />)}</View> : null}
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
              <View style={styles.wrap}>
                {([{ key: 'x', label: 'X position' }, { key: 'y', label: 'Y position' },
                  { key: 'width', label: 'Width' }, { key: 'height', label: 'Height' }] as const).map(({ key, label }) => <View key={key} style={styles.dimension}>
                  <Text style={styles.hint}>{label}</Text>
                  <TextInput accessibilityLabel={label} keyboardType="numbers-and-punctuation" value={dialog.draft[key]}
                    onChangeText={(value) => updateDraft({ [key]: value })} style={styles.field} />
                </View>)}
              </View>
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
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  bar: { flexGrow: 0, flexShrink: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  barContent: { minHeight: 50, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, gap: 3 },
  tool: { minHeight: 44, minWidth: 42, maxWidth: 156, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center', borderRadius: 7 },
  toolText: { color: colors.ink, fontSize: 14, fontWeight: '500' },
  activeTool: { backgroundColor: colors.panel },
  disabled: { opacity: 0.42 },
  selectionLabel: { color: colors.muted, paddingHorizontal: 10, fontSize: 13 },
  stage: { flex: 1, overflow: 'hidden', backgroundColor: colors.surface },
  gridVertical: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, opacity: 0.65 },
  gridHorizontal: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, opacity: 0.65 },
  card: { position: 'absolute', overflow: 'hidden', borderWidth: 1, borderRadius: 7, justifyContent: 'center' },
  cardText: { flexShrink: 1, includeFontPadding: false },
  checked: { textDecorationLine: 'line-through', opacity: 0.65 },
  strong: { fontWeight: '700' },
  person: { alignItems: 'center', gap: 3 },
  partnership: { alignItems: 'center', borderRadius: 40 },
  cardImage: { flex: 1, width: '100%', minHeight: 0 },
  groupFrame: { position: 'absolute', borderWidth: 1.5, borderRadius: 9, overflow: 'hidden' },
  groupHeading: { paddingHorizontal: 8, justifyContent: 'center' },
  edgeLabel: { position: 'absolute', maxWidth: 145, paddingHorizontal: 3, color: colors.graphite, backgroundColor: colors.surface, fontSize: 11 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  footerActions: { flexDirection: 'row', alignItems: 'center' },
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
