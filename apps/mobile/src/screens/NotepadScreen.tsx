import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppTheme } from '../appearance';
import { loadCanvasDocument, saveCanvasDocument } from '../data/canvas';
import { useCanvasDraft } from '../hooks/useCanvasDraft';
import type { AppColors } from '../theme';
import { addLinkedCanvasNode, setCanvasText, type CanvasDocument, type CanvasTextRange } from '../utils/canvas';
import type { ViewAddAction, ViewAddActionsRef } from './view-add-actions';
import type { ViewHistoryControls, ViewHistoryState } from './view-history';

type Props = {
  beforeLeaveRef?: { current: (() => Promise<boolean>) | null };
  inputRef?: RefObject<ComponentRef<typeof TextInput> | null>;
  onOpenCanvas?: (nodeId: string) => void;
  addActionsRef?: ViewAddActionsRef;
  historyControlsRef?: { current: ViewHistoryControls | null };
  onHistoryStateChange?: (state: ViewHistoryState) => void;
};

const NOTEPAD_HISTORY_LIMIT = 30;

function restoreNoteText(current: CanvasDocument, revision: CanvasDocument): CanvasDocument {
  const restored = setCanvasText(current, revision.text);
  const snapshots = new Map(revision.boards.map((board) => [board.id, new Map(board.nodes.map((node) => [node.id, node]))]));
  return { ...restored, boards: restored.boards.map((board, index) => {
    const recorded = snapshots.get(board.id);
    if (!recorded) return board;
    let changed = false;
    const nodes = board.nodes.map((node, nodeIndex) => {
      const wanted = recorded.get(node.id);
      const previous = current.boards[index]?.nodes[nodeIndex];
      if (!wanted || !previous || (!previous.source && !wanted.source)) return node;
      // Restoring the exact source also restores a link detached by a text deletion.
      // Keep the live board and card geometry, along with independently added cards.
      changed = true;
      const { source: _source, ...base } = node;
      return { ...base, text: wanted.text, ...(wanted.source ? { source: wanted.source } : {}) };
    });
    return changed ? { ...board, nodes } : board;
  }) };
}

export function NotepadScreen({ beforeLeaveRef, inputRef, onOpenCanvas, addActionsRef,
  historyControlsRef, onHistoryStateChange }: Props) {
  const { colors, resolvedMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { value, loadFailed, saveFailed, update, flush, reload, latest } = useCanvasDraft(loadCanvasDocument, saveCanvasDocument);
  const [selected, setSelected] = useState<CanvasTextRange | null>(null);
  const selectionRef = useRef<CanvasTextRange | undefined>(undefined);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const screenRef = useRef<ComponentRef<typeof View>>(null);
  const ownInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const input = inputRef ?? ownInputRef;
  const alive = useRef(false);
  const pendingLink = useRef<Promise<boolean> | null>(null);
  const caretFrame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const history = useRef<{ undo: CanvasDocument[]; redo: CanvasDocument[] }>({ undo: [], redo: [] });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (caretFrame.current !== null) cancelAnimationFrame(caretFrame.current);
    };
  }, []);

  const beforeLeave = useCallback(async () => {
    await pendingLink.current;
    return flush();
  }, [flush]);

  useEffect(() => {
    if (!beforeLeaveRef) return;
    beforeLeaveRef.current = beforeLeave;
    return () => { if (beforeLeaveRef.current === beforeLeave) beforeLeaveRef.current = null; };
  }, [beforeLeaveRef, beforeLeave]);

  function edit(next: string) {
    const current = latest();
    if (!current || pendingLink.current || current.text === next) return;
    const { undo } = history.current;
    history.current = { undo: [...undo.slice(-(NOTEPAD_HISTORY_LIMIT - 1)), current], redo: [] };
    setSelected(null);
    setLinkError(null);
    update(setCanvasText(current, next, selectionRef.current));
  }

  function restoreHistory(action: keyof typeof history.current) {
    const current = latest();
    if (!alive.current || !current || pendingLink.current || AppState.currentState !== 'active') return;
    const revision = history.current[action].pop();
    if (!revision) return;
    history.current[action === 'undo' ? 'redo' : 'undo'].push(current);
    setSelected(null);
    selectionRef.current = undefined;
    setLinkError(null);
    update(restoreNoteText(current, revision));
  }

  function addNote() {
    const current = latest();
    if (!alive.current || !current || pendingLink.current || AppState.currentState !== 'active') return;
    const separator = !current.text || current.text.endsWith('\n\n') ? '' : current.text.endsWith('\n') ? '\n' : '\n\n';
    const next = current.text + separator;
    if (separator) {
      const tail = current.text.length;
      selectionRef.current = { start: tail, end: tail };
      edit(next);
    }
    const end = next.length;
    setSelected(null);
    selectionRef.current = { start: end, end };
    input.current?.focus();
    if (caretFrame.current !== null) cancelAnimationFrame(caretFrame.current);
    caretFrame.current = requestAnimationFrame(() => {
      caretFrame.current = null;
      if (alive.current && latest()?.text === next) input.current?.setSelection(end, end);
    });
  }

  async function sendToCanvas(range = selected) {
    const current = latest();
    if (!alive.current || AppState.currentState !== 'active' || pendingLink.current || !range || !current || range.end > current.text.length) return;
    setLinking(true);
    setLinkError(null);
    try {
      const result = addLinkedCanvasNode(current, range);
      setSelected(null);
      update(result.document);
      const saving = flush();
      pendingLink.current = saving;
      if (await saving && alive.current && AppState.currentState === 'active') onOpenCanvas?.(result.nodeId);
    } catch (error) {
      if (alive.current) setLinkError(error instanceof Error ? error.message : 'Could not add this text to Canvas.');
    } finally {
      pendingLink.current = null;
      if (alive.current) setLinking(false);
    }
  }

  const actions = useRef<() => ViewAddAction[]>(() => []);
  actions.current = () => {
    const text = latest()?.text;
    if (text === undefined || pendingLink.current) return [];
    const options: ViewAddAction[] = [{ label: 'Add note', run: addNote }];
    if (onOpenCanvas && selected && selected.end <= text.length && selected.start < selected.end) {
      const range = { ...selected };
      options.push({ label: 'Add selection to Canvas', run: () => {
        if (latest()?.text === text) void sendToCanvas(range);
      } });
    }
    return options;
  };
  const historyActions = useRef<ViewHistoryControls>({ undo: () => {}, redo: () => {} });
  historyActions.current = { undo: () => restoreHistory('undo'), redo: () => restoreHistory('redo') };
  const canUndo = Boolean(value && !linking && history.current.undo.length);
  const canRedo = Boolean(value && !linking && history.current.redo.length);
  useEffect(() => {
    if (!addActionsRef) return;
    const get = () => actions.current();
    addActionsRef.current = get;
    return () => { if (addActionsRef.current === get) addActionsRef.current = null; };
  }, [addActionsRef]);
  useEffect(() => {
    if (!historyControlsRef) return;
    const controls: ViewHistoryControls = { undo: () => historyActions.current.undo(), redo: () => historyActions.current.redo() };
    historyControlsRef.current = controls;
    return () => { if (historyControlsRef.current === controls) historyControlsRef.current = null; };
  }, [historyControlsRef]);
  useEffect(() => { onHistoryStateChange?.({ canUndo, canRedo }); }, [canUndo, canRedo, onHistoryStateChange]);

  function measureKeyboardOffset() {
    if (Platform.OS !== 'ios') return;
    screenRef.current?.measureInWindow((_x, y) => {
      if (alive.current && Number.isFinite(y)) setKeyboardOffset(y);
    });
  }

  return <View ref={screenRef} collapsable={false} onLayout={measureKeyboardOffset} style={styles.screen}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={keyboardOffset}>
      <View style={styles.toolbar}>
        <Text accessibilityRole="header" style={styles.heading}>Notepad</Text>
        {onOpenCanvas && selected ? <Pressable accessibilityRole="button" disabled={linking}
          onPress={() => void sendToCanvas()} style={styles.retry}>
          <Text style={styles.retryText}>{linking ? 'Adding…' : 'Add to Canvas'}</Text>
        </Pressable> : null}
      </View>
      {loadFailed || saveFailed || linkError ? <View style={styles.errorRow}>
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
          {loadFailed ? 'Could not open the notepad.' : saveFailed ? 'Could not save the latest changes.' : linkError}
        </Text>
        {loadFailed || saveFailed ? <Pressable accessibilityRole="button" onPress={() => { if (loadFailed) void reload(); else void flush(); }}
          style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable> : null}
      </View> : null}
      {value ? <TextInput ref={input} accessibilityLabel="Notepad text" autoFocus multiline editable={!linking} keyboardAppearance={resolvedMode}
        value={value.text} onChangeText={edit} onBlur={() => void flush()} placeholder="Start typing…" placeholderTextColor={colors.muted}
        onSelectionChange={({ nativeEvent: { selection } }) => {
          selectionRef.current = selection;
          setSelected(selection.end > selection.start ? selection : null);
        }}
        underlineColorAndroid="transparent" style={styles.editor} /> : !loadFailed ?
        <ActivityIndicator accessibilityLabel="Loading notepad" color={colors.muted} style={styles.loading} /> : null}
    </KeyboardAvoidingView>
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  heading: { color: colors.graphite, fontSize: 16, lineHeight: 23, fontWeight: '500', paddingVertical: 12 },
  editor: { flex: 1, paddingHorizontal: 20, paddingVertical: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 16, lineHeight: 23, color: colors.ink, textAlignVertical: 'top' },
  loading: { marginTop: 24 },
  errorRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 8 },
  error: { flex: 1, color: colors.danger, fontSize: 14, lineHeight: 20 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  retryText: { color: colors.ink, fontWeight: '600' },
});
