import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type MutableRefObject } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import * as Crypto from 'expo-crypto';

import { useAppTheme } from '../appearance';
import { changeChecklistFlow, dismissChecklistFlowConflict, getChecklistFlow, getChecklistFlowConflicts, getChecklistFlowRevision,
  replaceChecklistCollection, replaceChecklistList, restoreChecklistFlowConflict, transferChecklistTask } from '../data/checklist-flow';
import type { SyncDocument } from '../sync/types';
import type { AppColors } from '../theme';
import { applyChecklistChange, checklistRows, checklistSubtreeIds, emptyChecklistFlow,
  prioritizeChecklistRows, readChecklistCollection, type ChecklistCollection, type ChecklistFlow,
  type ChecklistTask, type ChecklistListSummary } from '../utils/checklist-flow';
import { checklistDragDestination, type ChecklistRowLayout } from '../utils/checklist-drag';
import { createCalendarPeriodSwipe, type CalendarPeriodDirection } from '../utils/calendar-period-swipe';
import { acknowledgeChecklistHistory, checklistHistoryTarget, emptyChecklistHistory, observeChecklistHistory,
  recordChecklistHistory, type ChecklistHistoryAction } from '../utils/checklist-history';

type Props = { dataVersion: number; onDataChanged: () => void;
  listId?: string; hideCompleted?: boolean; focusTaskId?: string | null; onFocusConsumed?: () => void;
  onListResolved?: (listId: string) => void; onHistoryChange?: (state: PriorityHistoryState) => void;
  onSwipeList?: (direction: CalendarPeriodDirection) => void;
  controlsRef?: MutableRefObject<PriorityScreenControls | null>;
  beforeLeaveRef?: MutableRefObject<(() => Promise<boolean>) | null> };

export type PriorityHistoryState = { canUndo: boolean; canRedo: boolean; busy: boolean };
export type PriorityScreenControls = { addTask: () => void; jumpToTop: () => void;
  undo: () => Promise<boolean>; redo: () => Promise<boolean> };
type Snapshot = { flow: ChecklistFlow; revision: string | null; collection?: ChecklistCollection; lists?: ChecklistListSummary[] };
type Command = Parameters<typeof applyChecklistChange>[1];
type Draft = { id: string; text: string; format: ChecklistTask['format']; revision: string | null; isNew: boolean;
  parentId: string | null; afterId?: string };
type Drag = { id: string; parentId: string | null; origin: number; originScroll: number; offset: number;
  beforeId: string | null; revision: string | null };
type MoveChoice = { taskId: string; revision: string | null; epoch: number };
const CONTENT_BOTTOM_PADDING = 88;

export function ChecklistFlowScreen({ dataVersion, onDataChanged, beforeLeaveRef, listId = 'main', hideCompleted = false,
  controlsRef, onHistoryChange, focusTaskId, onFocusConsumed, onListResolved, onSwipeList }: Props) {
  const { colors, resolvedMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({ flow: emptyChecklistFlow(), revision: null }));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useRef(emptyChecklistHistory(listId, null));
  const [revealedTaskId, setRevealedTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SyncDocument[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [moveChoice, setMoveChoice] = useState<MoveChoice | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [tailSpace, setTailSpace] = useState(0);
  const latest = useRef({ snapshot, busy, draft, moveChoice }); latest.current = { snapshot, busy, draft, moveChoice };
  const saveDraftRef = useRef<() => Promise<boolean>>(async () => true);
  const mounted = useRef(true);
  const lifecycleEpoch = useRef(0);
  const requestId = useRef(0);
  const recoveryRevision = useRef<string | null>(null);
  const layouts = useRef(new Map<string, ChecklistRowLayout>());
  const dragRef = useRef<Drag | null>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const viewportRef = useRef<ComponentRef<typeof View>>(null);
  const editorRef = useRef<ComponentRef<typeof View>>(null);
  const pendingFocus = useRef<string | null>(null);
  const positionedList = useRef(false);
  const avoidingLayoutY = useRef(0);
  const scrollOffset = useRef(0);
  const scrollBounds = useRef({ top: 0, height: 0, contentHeight: 0 });
  const rowsEnd = useRef<number | null>(null);
  const dragPointer = useRef({ dy: 0, pageY: 0 });
  const dragMoveRef = useRef<(dy: number) => void>(() => undefined);
  const translate = useRef(new Animated.Value(0)).current;
  const rows = useMemo(() => {
    const visible = checklistRows(snapshot.flow, hideCompleted);
    if (!hideCompleted || !revealedTaskId) return prioritizeChecklistRows(visible);
    const forced = new Set<string>(); let task = snapshot.flow.items.find((item) => item.id === revealedTaskId);
    while (task) { forced.add(task.id); const parentId = task.parentId;
      task = parentId ? snapshot.flow.items.find((item) => item.id === parentId) : undefined; }
    const ids = new Set(visible.map((row) => row.task.id));
    return prioritizeChecklistRows(checklistRows(snapshot.flow).filter((row) => ids.has(row.task.id) || forced.has(row.task.id)));
  }, [snapshot.flow, hideCompleted, revealedTaskId]);
  const firstUnfinished = rows.find(({ task }) => !task.checked)?.task.id;
  const draftAnchor = useMemo(() => {
    if (!draft?.isNew || !draft.parentId || !snapshot.flow.items.some((task) => task.id === draft.parentId)) return null;
    const ids = new Set(checklistSubtreeIds(snapshot.flow, draft.parentId));
    const parentDepth = rows.find(({ task }) => task.id === draft.parentId)?.depth ?? 0;
    const anchorId = rows.filter(({ task }) => ids.has(task.id)).at(-1)?.task.id;
    return anchorId ? { id: anchorId, depth: parentDepth + 1 } : null;
  }, [draft?.isNew, draft?.parentId, snapshot.flow, rows]);
  const dragIds = useMemo(() => {
    const root = drag && snapshot.flow.items.find((task) => task.id === drag.id);
    if (!root) return new Set<string>();
    const subtree = new Set(checklistSubtreeIds(snapshot.flow, root.id));
    return new Set(rows.filter(({ task }) => task.checked === root.checked && subtree.has(task.id)).map(({ task }) => task.id));
  }, [snapshot.flow, rows, drag?.id]);
  const checkedCount = snapshot.flow.items.filter((task) => task.checked).length;
  const listName = snapshot.lists?.find((list) => list.id === listId)?.name ?? 'Priority';
  const otherLists = snapshot.lists?.filter((list) => list.id !== listId) ?? [];
  const listIndex = snapshot.lists?.findIndex((list) => list.id === listId) ?? -1;
  const canSwipe = Boolean(onSwipeList && ready && otherLists.length && !busy && !draft && !drag && !showVersions && !moveChoice);
  const swipeState = useRef({ canSwipe, onSwipeList });
  swipeState.current = { canSwipe, onSwipeList };
  const swipe = useMemo(() => {
    const gesture = createCalendarPeriodSwipe();
    let origin: { pageX: number; pageY: number } | undefined;
    let startedAt = -1;
    const blocked = () => !swipeState.current.canSwipe || latest.current.busy || Boolean(dragRef.current) ||
      !mounted.current || startedAt !== lifecycleEpoch.current || AppState.currentState !== 'active';
    const displacement = ({ nativeEvent }: GestureResponderEvent) => {
      const point = nativeEvent.touches[0] ?? nativeEvent.changedTouches[0];
      return { dx: point && origin ? point.pageX - origin.pageX : 0,
        dy: point && origin ? point.pageY - origin.pageY : 0, numberActiveTouches: nativeEvent.touches.length };
    };
    const cancel = () => { origin = undefined; gesture.cancel(); };
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: ({ nativeEvent }) => {
        origin = nativeEvent.touches.length === 1 ? nativeEvent.touches[0] : undefined;
        startedAt = lifecycleEpoch.current;
        gesture.start(nativeEvent.touches.length, blocked());
        return false;
      },
      onMoveShouldSetPanResponderCapture: (event) => gesture.move(displacement(event), blocked()),
      onPanResponderStart: ({ nativeEvent }) => { if (nativeEvent.touches.length !== 1) cancel(); },
      onPanResponderMove: (event) => { gesture.move(displacement(event), blocked()); },
      onPanResponderRelease: (event) => {
        const direction = gesture.finish(displacement(event), blocked());
        origin = undefined;
        if (direction !== null) swipeState.current.onSwipeList?.(direction);
      },
      onPanResponderTerminate: cancel,
      onPanResponderReject: cancel,
    });
  }, []);
  function publishHistory(next = history.current) { history.current = next; setHistoryVersion((value) => value + 1); }
  useEffect(() => { onHistoryChange?.({ canUndo: ready && !draft && history.current.revision === snapshot.revision && history.current.undo.length > 0,
    canRedo: ready && !draft && history.current.revision === snapshot.revision && history.current.redo.length > 0, busy: busy || Boolean(drag) }); },
  [historyVersion, ready, busy, Boolean(draft), Boolean(drag), snapshot.revision, onHistoryChange]);

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { lifecycleEpoch.current++; closeMoveChoice(); if (dragRef.current) finishDrag(true); }
    });
    return () => { mounted.current = false; lifecycleEpoch.current++; requestId.current++; subscription.remove(); };
  }, []);
  function measureKeyboardOffset() {
    viewportRef.current?.measureInWindow((_x, y) => {
      if (mounted.current && Number.isFinite(y)) setKeyboardOffset(y - avoidingLayoutY.current);
    });
  }
  const positionUnfinished = useCallback(() => {
    if (!ready) return;
    if (!firstUnfinished) { positionedList.current = true; setTailSpace(0); return; }
    const y = layouts.current.get(firstUnfinished)?.y;
    const { height, contentHeight } = scrollBounds.current;
    if (y === undefined || !height || rowsEnd.current === null) return;
    // Even a single unfinished row must be able to align to the top.
    setTailSpace(y > 0 ? Math.max(0, Math.ceil(height - (rowsEnd.current - y) - CONTENT_BOTTOM_PADDING)) : 0);
    if (positionedList.current || !scrollRef.current) return;
    if (focusTaskId) { positionedList.current = true; return; }
    if (y > 0 && y > contentHeight - height + 1) return;
    positionedList.current = true;
    if (y > 0) scrollRef.current.scrollTo({ y, animated: false });
  }, [ready, firstUnfinished, focusTaskId]);
  useEffect(positionUnfinished, [positionUnfinished]);
  const revealEditor = useCallback(() => {
    if (!latest.current.draft) return;
    scrollRef.current?.measureInWindow((_x, viewportY, _width, viewportHeight) => {
      editorRef.current?.measureInWindow((_editorX, editorY, _editorWidth, editorHeight) => {
        if (!mounted.current || !latest.current.draft || !Number.isFinite(editorY) || !viewportHeight) return;
        if (editorY < viewportY || editorY + editorHeight > viewportY + viewportHeight) {
          scrollRef.current?.scrollTo({ y: Math.max(0, scrollOffset.current + editorY - viewportY - 8), animated: true });
        }
      });
    });
  }, []);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', revealEditor);
    const changed = Keyboard.addListener('keyboardDidChangeFrame', revealEditor);
    return () => { shown.remove(); changed.remove(); };
  }, [revealEditor]);
  const load = useCallback(async () => {
    const request = ++requestId.current;
    try {
      const [revision, versions] = await Promise.all([getChecklistFlowRevision(), getChecklistFlowConflicts()]);
      if (!mounted.current || request !== requestId.current) return;
      recoveryRevision.current = revision; setConflicts(versions);
      const next = await getChecklistFlow(listId);
      if (!mounted.current || request !== requestId.current) return;
      recoveryRevision.current = next.revision; setSnapshot(next); setReady(true); setError(null);
      publishHistory(observeChecklistHistory(history.current, listId, next.revision));
    } catch (failure) {
      if (mounted.current && request === requestId.current) { setReady(false); setError(failure instanceof Error ? failure.message : 'The checklist could not load.'); }
    }
  }, [listId]);
  useEffect(() => { if (!latest.current.busy) void load(); }, [dataVersion, load]);
  useEffect(() => {
    if (!draft?.isNew) return;
    const frame = requestAnimationFrame(() => {
      if (!draft.parentId) scrollRef.current?.scrollToEnd({ animated: true });
      else { const layout = layouts.current.get(draft.parentId); if (layout) scrollRef.current?.scrollTo({ y: Math.max(0, layout.y - 20), animated: true }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [draft?.id]);

  async function perform(command: Command, expected = latest.current.snapshot.revision) {
    if (!mounted.current || AppState.currentState !== 'active' || latest.current.busy) return false;
    const before = latest.current.snapshot;
    if (before.revision !== expected) { setError('This Priority list changed on another device. Reload it before applying the edit.'); return false; }
    latest.current.busy = true; setBusy(true); setError(null); requestId.current++;
    try {
      const next = await changeChecklistFlow(command, expected, listId);
      if (mounted.current) { recoveryRevision.current = next.revision; setSnapshot(next); setReady(true);
        publishHistory(recordChecklistHistory(history.current, listId, before, next)); }
      onDataChanged(); return true;
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'The checklist change could not be saved.');
      return false;
    } finally { latest.current.busy = false; if (mounted.current) setBusy(false); }
  }

  async function changeHistory(action: ChecklistHistoryAction): Promise<boolean> {
    if (!mounted.current || AppState.currentState !== 'active' || latest.current.busy || latest.current.draft || dragRef.current || !ready) return false;
    const expected = latest.current.snapshot.revision; const previous = history.current;
    let target: ChecklistFlow;
    try { target = checklistHistoryTarget(previous, action, listId, expected); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The Priority history changed.'); return false; }
    latest.current.busy = true; setBusy(true); setError(null); requestId.current++;
    try {
      const transfer = previous[action].at(-1)?.transfer;
      const next = transfer ? await replaceChecklistCollection(listId, action === 'undo' ? transfer.before : transfer.after, expected)
        : await replaceChecklistList(listId, target, expected);
      if (mounted.current) { recoveryRevision.current = next.revision; setSnapshot(next); setReady(true); setSelectedId(null);
        publishHistory(acknowledgeChecklistHistory(previous, action, expected, next.revision)); }
      onDataChanged(); return true;
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'The Priority edit could not be restored.'); return false; }
    finally { latest.current.busy = false; if (mounted.current) setBusy(false); }
  }

  async function moveToList(choice: MoveChoice, destinationListId: string) {
    const before = latest.current.snapshot;
    if (!mounted.current || latest.current.moveChoice !== choice || choice.epoch !== lifecycleEpoch.current || AppState.currentState !== 'active' ||
        latest.current.busy || latest.current.draft || dragRef.current || !before.collection) return;
    if (choice.revision !== before.revision) {
      setError('This Priority list changed on another device. Choose the task again before moving it.');
      closeMoveChoice();
      return;
    }
    latest.current.busy = true; setBusy(true); setError(null); closeMoveChoice(); requestId.current++;
    try {
      const next = await transferChecklistTask(listId, choice.taskId, destinationListId, choice.revision);
      if (mounted.current) {
        recoveryRevision.current = next.revision;
        setSnapshot(next); setSelectedId(null);
        publishHistory(recordChecklistHistory(history.current, listId, before, next,
          { before: before.collection, after: next.collection }));
      }
      onDataChanged();
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'The task could not be moved.');
    } finally { latest.current.busy = false; if (mounted.current) setBusy(false); }
  }

  function closeMoveChoice() {
    latest.current.moveChoice = null;
    setMoveChoice(null);
  }

  function startNew(parentId: string | null = null, afterId?: string) {
    if (!mounted.current || AppState.currentState !== 'active' || !ready || busy || draft) return;
    setSelectedId(null);
    setDraft({ id: `task_${Crypto.randomUUID().replaceAll('-', '')}`, text: '', format: {}, revision: snapshot.revision,
      isNew: true, parentId, afterId });
  }
  function edit(task: ChecklistTask) {
    if (!mounted.current || AppState.currentState !== 'active' || !ready || busy || draft) return;
    setSelectedId(task.id);
    setDraft({ id: task.id, text: task.text, format: { ...task.format }, revision: snapshot.revision,
      isNew: false, parentId: task.parentId });
  }
  async function saveDraft(): Promise<boolean> {
    if (!draft) return true;
    if (!draft.text.trim() || busy) return false;
    if (draft.format.textColor && !/^#[0-9a-f]{6}$/i.test(draft.format.textColor)) { setError('Enter a text color as six hex digits, for example #333333.'); return false; }
    const current = draft;
    const command: Command = current.isNew ? { type: 'add', item: { id: current.id, text: current.text,
      checked: false, parentId: current.parentId, format: current.format }, ...(current.afterId ? { afterId: current.afterId } : {}) } :
      { type: 'edit', id: current.id, text: current.text, format: current.format };
    if (await perform(command, current.revision)) { setDraft(null); setSelectedId(current.id); Keyboard.dismiss(); return true; }
    return false;
  }
  saveDraftRef.current = saveDraft;
  const commands = useRef({ addTask: () => startNew(), undo: () => changeHistory('undo'), redo: () => changeHistory('redo') });
  commands.current = { addTask: () => startNew(), undo: () => changeHistory('undo'), redo: () => changeHistory('redo') };
  const jumpToUnfinished = useRef(() => {});
  jumpToUnfinished.current = () => scrollRef.current?.scrollTo({
    y: (firstUnfinished && layouts.current.get(firstUnfinished)?.y) || 0, animated: true,
  });
  useEffect(() => {
    if (!controlsRef) return;
    const controls: PriorityScreenControls = { addTask: () => commands.current.addTask(),
      jumpToTop: () => jumpToUnfinished.current(),
      undo: () => commands.current.undo(), redo: () => commands.current.redo() };
    controlsRef.current = controls;
    return () => { if (controlsRef.current === controls) controlsRef.current = null; };
  }, [controlsRef]);
  useEffect(() => {
    if (!focusTaskId || !ready || busy || draft || !snapshot.flow.items.some((task) => task.id === focusTaskId)) return;
    pendingFocus.current = focusTaskId;
    setRevealedTaskId(focusTaskId); setSelectedId(focusTaskId);
    const frame = requestAnimationFrame(() => {
      const layout = layouts.current.get(focusTaskId);
      if (layout && pendingFocus.current === focusTaskId) {
        scrollRef.current?.scrollTo({ y: Math.max(0, layout.y - 8), animated: true });
        pendingFocus.current = null; onFocusConsumed?.();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [focusTaskId, ready, busy, Boolean(draft), snapshot.flow, onFocusConsumed]);
  useEffect(() => {
    if (!beforeLeaveRef) return;
    const beforeLeave = async () => {
      if (latest.current.busy) { setError('Finish the current checklist change before leaving.'); return false; }
      if (dragRef.current) finishDrag(true);
      const current = latest.current.draft;
      if (!current) return true;
      if (!current.text.trim()) { setDraft(null); setError(null); Keyboard.dismiss(); return true; }
      return saveDraftRef.current();
    };
    beforeLeaveRef.current = beforeLeave;
    return () => { if (beforeLeaveRef.current === beforeLeave) beforeLeaveRef.current = null; };
  }, [beforeLeaveRef]);
  function remove(task: ChecklistTask) {
    const count = checklistSubtreeIds(snapshot.flow, task.id).length;
    const displayedRevision = snapshot.revision;
    const epoch = lifecycleEpoch.current;
    const erase = () => {
      if (!mounted.current || epoch !== lifecycleEpoch.current || AppState.currentState !== 'active') return;
      void perform({ type: 'delete', id: task.id }, displayedRevision).then((saved) => { if (saved && mounted.current) setSelectedId(null); });
    };
    if (count > 1) Alert.alert('Delete this task and its subtasks?', `${count - 1} ${count === 2 ? 'subtask will' : 'subtasks will'} also be deleted.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: erase }]);
    else erase();
  }
  function canChange(command: Command) {
    try { return JSON.stringify(applyChecklistChange(snapshot.flow, command)) !== JSON.stringify(snapshot.flow); } catch { return false; }
  }
  function relativeMove(task: ChecklistTask, direction: 'up' | 'down'): Command | null {
    const siblings = rows.map((row) => row.task).filter((item) => item.parentId === task.parentId && item.checked === task.checked);
    const index = siblings.findIndex((item) => item.id === task.id);
    if (index < 0 || !siblings[index + (direction === 'up' ? -1 : 1)]) return null;
    return { type: 'move', id: task.id, parentId: task.parentId, beforeId: siblings[index + (direction === 'up' ? -1 : 2)]?.id ?? null };
  }
  function beginDrag(id: string, pageY: number) {
    if (!mounted.current || AppState.currentState !== 'active' || latest.current.busy || latest.current.draft) return;
    const current = latest.current.snapshot.flow.items.find((task) => task.id === id); const layout = layouts.current.get(id);
    if (!current || !layout) return;
    const siblings = rows.map((row) => row.task).filter((task) => task.parentId === current.parentId && task.checked === current.checked);
    const next = siblings[siblings.findIndex((task) => task.id === id) + 1];
    const value: Drag = { id, parentId: current.parentId, origin: layout.y + layout.height / 2, originScroll: scrollOffset.current,
      offset: 0, beforeId: next?.id ?? null, revision: latest.current.snapshot.revision };
    dragPointer.current = { dy: 0, pageY };
    dragRef.current = value; translate.setValue(0); setDrag(value); setSelectedId(null);
  }
  function moveDrag(dy: number) {
    const value = dragRef.current; if (!value) return;
    const effectiveOffset = dy + scrollOffset.current - value.originScroll;
    const checked = latest.current.snapshot.flow.items.find((task) => task.id === value.id)?.checked;
    const visibleIds = new Set(rows.filter(({ task }) => task.checked === checked).map(({ task }) => task.id));
    const destination = checklistDragDestination(latest.current.snapshot.flow, value.id, layouts.current, visibleIds, value.origin + effectiveOffset);
    if (!destination) { finishDrag(true); return; }
    const beforeId = destination.beforeId;
    const destinationChanged = value.beforeId !== beforeId;
    value.offset = effectiveOffset; value.beforeId = beforeId; translate.setValue(effectiveOffset);
    if (destinationChanged) setDrag({ ...value });
  }
  dragMoveRef.current = moveDrag;
  useEffect(() => {
    if (!drag?.id) return;
    const timer = setInterval(() => {
      if (!dragRef.current) return;
      const { top, height, contentHeight } = scrollBounds.current; const pointer = dragPointer.current;
      if (!height) return;
      const direction = pointer.pageY < top + 48 ? -1 : pointer.pageY > top + height - 48 ? 1 : 0;
      if (!direction) return;
      const next = Math.max(0, Math.min(Math.max(0, contentHeight - height), scrollOffset.current + direction * 18));
      if (next === scrollOffset.current) return;
      scrollOffset.current = next; scrollRef.current?.scrollTo({ y: next, animated: false }); dragMoveRef.current(pointer.dy);
    }, 60);
    return () => clearInterval(timer);
  }, [drag?.id]);
  function finishDrag(cancelled = false) {
    const value = dragRef.current; dragRef.current = null; setDrag(null); translate.setValue(0);
    if (!value || cancelled || Math.abs(value.offset) < 8) return;
    void perform({ type: 'move', id: value.id, parentId: value.parentId, beforeId: value.beforeId }, value.revision);
  }
  function measure(id: string, event: LayoutChangeEvent) {
    const layout = event.nativeEvent.layout; layouts.current.set(id, layout);
    if (id === firstUnfinished) positionUnfinished();
    if (pendingFocus.current === id) {
      pendingFocus.current = null;
      requestAnimationFrame(() => { if (mounted.current) { scrollRef.current?.scrollTo({ y: Math.max(0, layout.y - 8), animated: true }); onFocusConsumed?.(); } });
    }
  }

  async function restoreVersion(document: SyncDocument) {
    if (!mounted.current || AppState.currentState !== 'active' || latest.current.busy || latest.current.draft) return;
    latest.current.busy = true; setBusy(true); setError(null); requestId.current++;
    try {
      const next = await restoreChecklistFlowConflict(document, recoveryRevision.current, listId);
      const versions = await getChecklistFlowConflicts();
      if (mounted.current) { recoveryRevision.current = next.revision; setSnapshot(next); setReady(true); setConflicts(versions); setShowVersions(false);
        publishHistory(emptyChecklistHistory(next.listId, next.revision)); if (next.listId !== listId) onListResolved?.(next.listId); }
      onDataChanged();
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'The earlier checklist could not be restored.'); }
    finally { latest.current.busy = false; if (mounted.current) setBusy(false); }
  }
  async function dismissVersion(document: SyncDocument) {
    if (!mounted.current || AppState.currentState !== 'active' || latest.current.busy) return;
    latest.current.busy = true; setBusy(true);
    try { await dismissChecklistFlowConflict(document); const versions = await getChecklistFlowConflicts(); if (mounted.current) setConflicts(versions); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'The earlier version could not be dismissed.'); }
    finally { latest.current.busy = false; if (mounted.current) setBusy(false); }
  }

  const editor = draft ? <View ref={editorRef} collapsable={false} style={styles.editor} onLayout={revealEditor}>
    <TextInput accessibilityLabel={draft.parentId ? 'Subtask text' : 'Task text'} value={draft.text} multiline autoFocus editable={!busy}
      maxLength={50000} keyboardAppearance={resolvedMode} placeholder={draft.parentId ? 'Add subtask' : 'Add task'}
      onFocus={revealEditor}
      placeholderTextColor={colors.muted} onChangeText={(text) => { if (!latest.current.busy) setDraft((value) => value ? { ...value, text } : value); }}
      style={[styles.input, { fontWeight: draft.format.bold ? '700' : '400', fontStyle: draft.format.italic ? 'italic' : 'normal',
        textDecorationLine: draft.format.underline ? 'underline' : 'none', color: /^#[0-9a-f]{6}$/i.test(draft.format.textColor ?? '') ? draft.format.textColor : colors.ink }]} />
    <View style={styles.formatRow}>
      {(['bold', 'italic', 'underline'] as const).map((kind) => <Pressable key={kind} accessibilityRole="button"
        accessibilityLabel={kind[0]!.toUpperCase() + kind.slice(1)} accessibilityState={{ selected: Boolean(draft.format[kind]) }}
        disabled={busy} onPress={() => { if (!latest.current.busy) setDraft((value) => value ? { ...value, format: { ...value.format, [kind]: !value.format[kind] } } : value); }}
        style={[styles.formatButton, draft.format[kind] && styles.selectedButton, busy && styles.disabled]}>
        <Text allowFontScaling={false} style={[styles.formatGlyph, kind === 'bold' && { fontWeight: '800' }, kind === 'italic' && { fontStyle: 'italic' },
          kind === 'underline' && { textDecorationLine: 'underline' }]}>{kind === 'bold' ? 'B' : kind === 'italic' ? 'I' : 'U'}</Text>
      </Pressable>)}
      <TextInput accessibilityLabel="Task text color hex" value={draft.format.textColor ?? ''} autoCapitalize="characters" autoCorrect={false} editable={!busy}
        maxLength={7} placeholder="#RRGGBB" placeholderTextColor={colors.muted} keyboardAppearance={resolvedMode}
        onChangeText={(text) => { if (!latest.current.busy) setDraft((value) => value ? { ...value, format: { ...value.format, textColor: text || undefined } } : value); }} style={styles.colorInput} />
      <Pressable accessibilityRole="button" accessibilityLabel="Reset task text color" disabled={busy} onPress={() => { if (!latest.current.busy) setDraft((value) => value ?
        { ...value, format: { ...value.format, textColor: undefined } } : value); }} style={styles.formatButton}><Text style={styles.formatGlyph}>↺</Text></Pressable>
    </View>
    <View style={styles.editorActions}><Pressable accessibilityRole="button" onPress={() => { if (!latest.current.busy) { setDraft(null); setError(null); Keyboard.dismiss(); } }}
      disabled={busy} style={styles.textButton}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Save task" onPress={() => void saveDraft()} disabled={busy || !draft.text.trim()}
        style={[styles.saveButton, (busy || !draft.text.trim()) && styles.disabled]}><Text style={styles.saveText}>✓</Text></Pressable></View>
  </View> : null;

  return <KeyboardAvoidingView style={styles.container} behavior="padding" keyboardVerticalOffset={keyboardOffset}
    onLayout={(event) => { avoidingLayoutY.current = event.nativeEvent.layout.y; measureKeyboardOffset(); }}>
    <View ref={viewportRef} collapsable={false} style={styles.container} {...swipe.panHandlers}>
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.listName}
        accessibilityHint={canSwipe ? 'Swipe left or right to switch checklists.' : undefined}
        accessibilityActions={canSwipe ? [
          ...(listIndex > 0 ? [{ name: 'previousChecklist', label: 'Previous checklist' }] : []),
          ...(listIndex < (snapshot.lists?.length ?? 0) - 1 ? [{ name: 'nextChecklist', label: 'Next checklist' }] : []),
        ] : undefined}
        onAccessibilityAction={(event) => {
          if (!canSwipe) return;
          if (event.nativeEvent.actionName === 'previousChecklist') onSwipeList?.(-1);
          if (event.nativeEvent.actionName === 'nextChecklist') onSwipeList?.(1);
        }}>{listName}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Reset all task checks" disabled={!ready || !checkedCount || busy || Boolean(draft)}
        onPress={() => void perform({ type: 'reset' })} style={[styles.textButton, (!ready || !checkedCount || busy || Boolean(draft)) && styles.disabled]}>
        <Text style={styles.resetGlyph}>↺</Text></Pressable></View>
    {conflicts.length ? <Pressable accessibilityRole="button" disabled={busy || Boolean(draft)} onPress={() => setShowVersions(true)} style={styles.versionsButton}>
      <Text style={styles.secondaryText}>Other versions ({conflicts.length})</Text></Pressable> : null}
    {error ? <View accessibilityLiveRegion="polite" style={styles.errorRow}><Text style={styles.error}>{error}</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void load()} style={styles.textButton}><Text style={styles.secondaryText}>Reload list</Text></Pressable></View> : null}
    {!ready && !error ? <ActivityIndicator color={colors.muted} style={styles.loading} /> : null}
    <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: CONTENT_BOTTOM_PADDING + tailSpace }]}
      keyboardShouldPersistTaps="handled" directionalLockEnabled scrollEnabled={!drag}
      onLayout={() => { measureKeyboardOffset(); scrollRef.current?.measureInWindow((_x, y, _width, height) => {
        scrollBounds.current = { ...scrollBounds.current, top: y, height }; positionUnfinished(); revealEditor(); }); }}
      onContentSizeChange={(_width, height) => { scrollBounds.current.contentHeight = height; positionUnfinished(); }}
      onScroll={(event) => { scrollOffset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
      {rows.map(({ task, depth }) => {
        const active = selectedId === task.id; const editing = draft?.id === task.id && !draft.isNew;
        const currentDrag = dragIds.has(task.id); const before = drag?.beforeId === task.id;
        const moveUp = active ? relativeMove(task, 'up') : null;
        const moveDown = active ? relativeMove(task, 'down') : null;
        return <Fragment key={task.id}><Animated.View onLayout={(event) => measure(task.id, event)}
          style={[styles.rowContainer, { marginLeft: Math.min(depth, 8) * 16 }, before && styles.dropBefore,
            currentDrag && { zIndex: 10, transform: [{ translateY: translate }], backgroundColor: colors.panel }]}>
          <View style={[styles.row, task.checked && styles.completed]}>
            <Pressable accessibilityRole="checkbox" accessibilityLabel={`Complete ${task.text}`} accessibilityState={{ checked: task.checked, disabled: !ready || busy || Boolean(draft) }}
              disabled={!ready || busy || Boolean(draft)} onPress={() => void perform({ type: 'check', id: task.id, checked: !task.checked })} style={styles.checkButton}>
              <View style={[styles.checkbox, task.checked && styles.checked]}>{task.checked ? <Text style={styles.checkGlyph}>✓</Text> : null}</View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit task: ${task.text}`} disabled={!ready || busy || Boolean(draft)} onPress={() => edit(task)}
              onLongPress={() => setSelectedId(active ? null : task.id)} style={styles.taskBody}>
              <Text style={[styles.taskText, { color: task.format.textColor ?? colors.ink, fontWeight: task.format.bold ? '700' : '400',
                fontStyle: task.format.italic ? 'italic' : 'normal', textDecorationLine: task.checked ? task.format.underline ? 'underline line-through' : 'line-through' :
                  task.format.underline ? 'underline' : 'none' }]}>{task.text}</Text>
              {task.source?.ranges.length ? <Text style={styles.sourceLabel}>From {task.source.ranges[0]!.dateKey}</Text> : null}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${task.text}`} accessibilityState={{ expanded: active }} disabled={!ready || busy || Boolean(draft)}
              onPress={() => setSelectedId(active ? null : task.id)} style={styles.moreButton}><Text style={styles.moreGlyph}>⋯</Text></Pressable>
            <TaskDragHandle disabled={!ready || busy || Boolean(draft)} label={task.text} onBegin={(pageY) => beginDrag(task.id, pageY)}
              onMove={(dy, pageY) => { dragPointer.current = { dy, pageY }; moveDrag(dy); }}
              onEnd={finishDrag} onStep={(direction) => {
                const command = relativeMove(task, direction);
                if (command) void perform(command);
              }} styles={styles} />
          </View>
          {editing ? editor : null}
          {active && !draft && ready ? <View style={styles.rowActions}>
            <Action label="Subtask" accessibilityLabel="Add subtask" onPress={() => startNew(task.id)} styles={styles} />
            <Action label="↑" accessibilityLabel="Move task up" disabled={!moveUp}
              onPress={() => { if (moveUp) void perform(moveUp); }} styles={styles} />
            <Action label="↓" accessibilityLabel="Move task down" disabled={!moveDown}
              onPress={() => { if (moveDown) void perform(moveDown); }} styles={styles} />
            <Action label="→" accessibilityLabel="Indent task" disabled={!canChange({ type: 'indent', id: task.id })}
              onPress={() => void perform({ type: 'indent', id: task.id })} styles={styles} />
            <Action label="←" accessibilityLabel="Outdent task" disabled={!canChange({ type: 'outdent', id: task.id })}
              onPress={() => void perform({ type: 'outdent', id: task.id })} styles={styles} />
            {otherLists.length ? <Action label="Move to checklist" accessibilityLabel="Move task to checklist" disabled={busy}
              onPress={() => setMoveChoice({ taskId: task.id, revision: snapshot.revision, epoch: lifecycleEpoch.current })} styles={styles} /> : null}
            <Action label="Delete" accessibilityLabel="Delete task" onPress={() => remove(task)} styles={styles} />
          </View> : null}
        </Animated.View>{draftAnchor?.id === task.id ? <View style={{ marginLeft: Math.min(draftAnchor.depth, 8) * 16 }}>{editor}</View> : null}</Fragment>;
      })}
      {draft && (draft.isNew ? !draftAnchor : !rows.some(({ task }) => task.id === draft.id)) ? editor : null}
      <View collapsable={false} onLayout={(event) => { rowsEnd.current = event.nativeEvent.layout.y; positionUnfinished(); }} />
    </ScrollView>
    {ready && !draft ? <Pressable accessibilityRole="button" accessibilityLabel="Add task" disabled={busy || Boolean(drag)} onPress={() => startNew()}
      style={[styles.floatingAdd, (busy || Boolean(drag)) && styles.disabled]}><Text style={styles.floatingAddGlyph}>+</Text></Pressable> : null}
    <Modal visible={showVersions} transparent animationType="fade" onRequestClose={() => setShowVersions(false)}>
      <View style={styles.modalOverlay}><Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={() => setShowVersions(false)} />
        <View accessibilityViewIsModal style={styles.versionsCard}>
          <View style={styles.modalHeading}><Text accessibilityRole="header" style={styles.title}>Other Priority versions</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close other checklist versions" style={styles.moreButton} onPress={() => setShowVersions(false)}>
              <Text style={styles.moreGlyph}>×</Text></Pressable></View>
          <ScrollView keyboardShouldPersistTaps="handled">{conflicts.map((document) => {
            const collection = readChecklistCollection(document.value); const items = collection.lists.flatMap((list) => list.items);
            return <View key={document.revision} style={styles.versionRow}>
              <Text style={styles.secondaryText}>{collection.lists.map((list) => list.name).join(' · ')}</Text>
              <Text style={styles.secondaryText}>{items.length} {items.length === 1 ? 'task' : 'tasks'}</Text>
              {items.slice(0, 5).map((item, index) => <Text key={index} numberOfLines={2} style={styles.versionPreview}>
                {item && typeof item === 'object' && 'text' in item && typeof item.text === 'string' ? item.text : 'Task'}</Text>)}
              {items.length > 5 ? <Text style={styles.secondaryText}>…</Text> : null}
              <View style={styles.editorActions}><Pressable accessibilityRole="button" disabled={busy} onPress={() => void dismissVersion(document)} style={styles.textButton}>
                <Text style={styles.secondaryText}>Dismiss</Text></Pressable><Pressable accessibilityRole="button" disabled={busy || Boolean(draft)}
                onPress={() => void restoreVersion(document)} style={styles.textButton}><Text style={styles.secondaryText}>Restore list</Text></Pressable></View>
            </View>;
          })}</ScrollView>
        </View>
      </View>
    </Modal>
    <Modal visible={Boolean(moveChoice)} transparent animationType="fade" onRequestClose={closeMoveChoice}>
      <View style={styles.modalOverlay}><Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={closeMoveChoice} />
        <View accessibilityViewIsModal style={styles.versionsCard}>
          <View style={styles.modalHeading}><Text accessibilityRole="header" style={styles.title}>Move to checklist</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel moving task" style={styles.moreButton} onPress={closeMoveChoice}>
              <Text style={styles.moreGlyph}>×</Text></Pressable></View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {otherLists.map((list) => <Pressable key={list.id} accessibilityRole="button" accessibilityLabel={`Move to ${list.name}`}
              style={styles.destinationRow} onPress={() => { if (moveChoice) void moveToList(moveChoice, list.id); }}>
              <Text style={styles.taskText}>{list.name}</Text></Pressable>)}
          </ScrollView>
        </View>
      </View>
    </Modal>
    </View>
  </KeyboardAvoidingView>;
}

function Action({ label, accessibilityLabel, disabled = false, onPress, styles }: { label: string; accessibilityLabel: string;
  disabled?: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[styles.actionButton, disabled && styles.disabled]}><Text style={styles.secondaryText}>{label}</Text></Pressable>;
}

function TaskDragHandle({ disabled, label, onBegin, onMove, onEnd, onStep, styles }: { disabled: boolean; label: string;
  onBegin: (pageY: number) => void; onMove: (dy: number, pageY: number) => void; onEnd: (cancelled?: boolean) => void;
  onStep: (direction: 'up' | 'down') => void; styles: ReturnType<typeof createStyles> }) {
  const latest = useRef({ disabled, onBegin, onMove, onEnd }); latest.current = { disabled, onBegin, onMove, onEnd };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: (_, gesture) => !latest.current.disabled && Math.abs(gesture.dy) > 4,
    onPanResponderGrant: (event) => latest.current.onBegin(event.nativeEvent.pageY),
    onPanResponderMove: (_, gesture) => latest.current.onMove(gesture.dy, gesture.moveY),
    onPanResponderRelease: () => latest.current.onEnd(),
    onPanResponderTerminate: () => latest.current.onEnd(true),
    onPanResponderTerminationRequest: () => false,
  }), []);
  return <View {...responder.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel={`Drag to reorder ${label}`}
    accessibilityHint="Drag up or down. Task actions also provide Move up and Move down."
    accessibilityState={{ disabled }} accessibilityActions={[{ name: 'increment', label: 'Move task down' }, { name: 'decrement', label: 'Move task up' }]}
    onAccessibilityAction={(event) => { if (!disabled) { if (event.nativeEvent.actionName === 'increment') onStep('down');
      else if (event.nativeEvent.actionName === 'decrement') onStep('up'); } }}
    style={[styles.dragHandle, disabled && styles.disabled]}><View style={styles.dragLine} /><View style={styles.dragLine} /><View style={styles.dragLine} /></View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  heading: { paddingLeft: 20, paddingRight: 8, paddingTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 2 },
  listName: { color: colors.graphite, flex: 1, fontSize: 16, lineHeight: 23, fontWeight: '500' },
  resetGlyph: { color: colors.muted, fontSize: 24, lineHeight: 30 },
  floatingAdd: { position: 'absolute', right: 16, bottom: 16, width: 56, height: 56, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center', backgroundColor: colors.accent },
  floatingAddGlyph: { color: colors.onAccent, fontSize: 34, fontWeight: '400', lineHeight: 40 },
  title: { flex: 1, color: colors.ink, fontSize: 20, lineHeight: 27, fontWeight: '600' },
  secondaryText: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  textButton: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  disabled: { opacity: 0.35 },
  scroll: { flex: 1 }, content: { paddingHorizontal: 12 },
  rowContainer: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, backgroundColor: colors.paper },
  dropBefore: { borderTopWidth: 2, borderTopColor: colors.graphite },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center' },
  completed: { opacity: 0.42 },
  checkButton: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  checked: { borderColor: colors.muted, backgroundColor: colors.panel },
  checkGlyph: { color: colors.graphite, fontSize: 16, lineHeight: 20, fontWeight: '600' },
  taskBody: { flex: 1, minWidth: 0, paddingVertical: 16, paddingRight: 4 },
  taskText: { color: colors.ink, fontSize: 16, lineHeight: 23 },
  sourceLabel: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  moreButton: { width: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  moreGlyph: { color: colors.muted, fontSize: 25, lineHeight: 30 },
  dragHandle: { width: 36, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3 },
  dragLine: { width: 16, height: 1.5, borderRadius: 1, backgroundColor: colors.muted },
  rowActions: { paddingLeft: 36, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 1 },
  actionButton: { paddingHorizontal: 11, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  editor: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 10, padding: 12, marginVertical: 8, backgroundColor: colors.surface },
  input: { color: colors.ink, fontSize: 16, lineHeight: 24, minHeight: 80, maxHeight: 280, textAlignVertical: 'top', padding: 2 },
  formatRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  formatButton: { width: 40, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  selectedButton: { backgroundColor: colors.panel },
  formatGlyph: { color: colors.graphite, fontSize: 18, lineHeight: 24 },
  colorInput: { color: colors.ink, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 6, minHeight: 40, paddingHorizontal: 8, width: 100, fontSize: 13 },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 6 },
  saveButton: { width: 48, minHeight: 42, backgroundColor: colors.accent, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: colors.onAccent, fontSize: 23, lineHeight: 28 },
  errorRow: { paddingHorizontal: 20, paddingVertical: 8 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 21 },
  loading: { marginTop: 32 },
  versionsButton: { minHeight: 44, paddingHorizontal: 22, justifyContent: 'center' },
  modalOverlay: { flex: 1, paddingHorizontal: 24, paddingVertical: 40, justifyContent: 'center', backgroundColor: colors.scrim },
  versionsCard: { maxHeight: '85%', backgroundColor: colors.paper, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, padding: 16 },
  modalHeading: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  destinationRow: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  versionRow: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, paddingVertical: 14 },
  versionPreview: { color: colors.graphite, fontSize: 14, lineHeight: 20, marginTop: 5 },
});
