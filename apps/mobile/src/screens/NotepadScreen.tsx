import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppTheme } from '../appearance';
import { loadCanvasDocument, saveCanvasDocument } from '../data/canvas';
import { useCanvasDraft } from '../hooks/useCanvasDraft';
import type { AppColors } from '../theme';
import { addLinkedCanvasNode, setCanvasText, type CanvasTextRange } from '../utils/canvas';

type Props = {
  beforeLeaveRef?: { current: (() => Promise<boolean>) | null };
  inputRef?: RefObject<ComponentRef<typeof TextInput> | null>;
  onOpenCanvas?: (nodeId: string) => void;
};

export function NotepadScreen({ beforeLeaveRef, inputRef, onOpenCanvas }: Props) {
  const { colors, resolvedMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { value, loadFailed, saveFailed, update, flush, reload, latest } = useCanvasDraft(loadCanvasDocument, saveCanvasDocument);
  const [selected, setSelected] = useState<CanvasTextRange | null>(null);
  const selectionRef = useRef<CanvasTextRange | undefined>(undefined);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const screenRef = useRef<ComponentRef<typeof View>>(null);
  const alive = useRef(false);
  const pendingLink = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
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
    if (!current) return;
    setSelected(null);
    setLinkError(null);
    update(setCanvasText(current, next, selectionRef.current));
  }

  async function sendToCanvas() {
    const current = latest();
    if (pendingLink.current || !selected || !current || selected.end > current.text.length) return;
    setLinking(true);
    setLinkError(null);
    try {
      const result = addLinkedCanvasNode(current, selected);
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
      {value ? <TextInput ref={inputRef} accessibilityLabel="Notepad text" autoFocus multiline editable={!linking} keyboardAppearance={resolvedMode}
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
