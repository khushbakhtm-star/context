import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppTheme } from '../appearance';
import { getSetting, setSetting } from '../data/database';
import type { AppColors } from '../theme';

// Local settings are outside the calendar, Wear and encrypted ledger upload queues.
const NOTEPAD_KEY = 'notepad.text.v1';
const AUTOSAVE_DELAY = 350;

type Props = {
  beforeLeaveRef?: { current: (() => Promise<boolean>) | null };
  inputRef?: RefObject<ComponentRef<typeof TextInput> | null>;
};

export function NotepadScreen({ beforeLeaveRef, inputRef }: Props) {
  const { colors, resolvedMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const screenRef = useRef<ComponentRef<typeof View>>(null);
  const alive = useRef(false);
  const loadGeneration = useRef(0);
  const buffer = useRef({ draft: '', saved: '' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoadError(false);
    try {
      const value = await getSetting<unknown>(NOTEPAD_KEY, '');
      if (!alive.current || generation !== loadGeneration.current) return;
      const saved = typeof value === 'string' ? value : '';
      buffer.current = { draft: saved, saved };
      setText(saved);
      setLoaded(true);
    } catch {
      if (alive.current && generation === loadGeneration.current) setLoadError(true);
    }
  }, []);

  const flush = useCallback((): Promise<boolean> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) return saving.current;
    if (buffer.current.draft === buffer.current.saved) {
      if (alive.current) setSaveError(false);
      return Promise.resolve(true);
    }

    // Serialize writes and check again after every acknowledgement. An edit
    // that arrives during a save is part of the same navigation or blur flush.
    async function saveLatest() {
      while (buffer.current.draft !== buffer.current.saved) {
        const next = buffer.current.draft;
        await setSetting(NOTEPAD_KEY, next);
        buffer.current.saved = next;
      }
    }

    saving.current = saveLatest().then(
      () => { if (alive.current) setSaveError(false); return true; },
      () => { if (alive.current) setSaveError(true); return false; },
    ).finally(() => { saving.current = null; });
    return saving.current;
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flush();
    });
    return () => {
      alive.current = false;
      loadGeneration.current++;
      subscription.remove();
      void flush();
    };
  }, [load, flush]);

  useEffect(() => {
    if (!beforeLeaveRef) return;
    beforeLeaveRef.current = flush;
    return () => { if (beforeLeaveRef.current === flush) beforeLeaveRef.current = null; };
  }, [beforeLeaveRef, flush]);

  function edit(next: string) {
    buffer.current.draft = next;
    setText(next);
    if (timer.current !== null) clearTimeout(timer.current);
    if (AppState.currentState !== 'active') {
      void flush();
      return;
    }
    timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY);
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
      <Text accessibilityRole="header" style={styles.heading}>Notepad</Text>
      {loadError || saveError ? <View style={styles.errorRow}>
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
          {loadError ? 'Could not open the notepad.' : 'Could not save the latest changes.'}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => { if (loadError) void load(); else void flush(); }}
          style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable>
      </View> : null}
      {loaded ? <TextInput ref={inputRef} accessibilityLabel="Notepad text" autoFocus multiline keyboardAppearance={resolvedMode}
        value={text} onChangeText={edit} onBlur={() => void flush()} placeholder="Start typing…" placeholderTextColor={colors.muted}
        underlineColorAndroid="transparent" style={styles.editor} /> : !loadError ?
        <ActivityIndicator accessibilityLabel="Loading notepad" color={colors.muted} style={styles.loading} /> : null}
    </KeyboardAvoidingView>
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  heading: { color: colors.graphite, fontSize: 16, lineHeight: 23, fontWeight: '500', paddingHorizontal: 20, paddingVertical: 12 },
  editor: { flex: 1, paddingHorizontal: 20, paddingVertical: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 16, lineHeight: 23, color: colors.ink, textAlignVertical: 'top' },
  loading: { marginTop: 24 },
  errorRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 8 },
  error: { flex: 1, color: colors.danger, fontSize: 14, lineHeight: 20 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  retryText: { color: colors.ink, fontWeight: '600' },
});
