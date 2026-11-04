import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../appearance';
import { loadCanvasDocument, saveCanvasDocument } from '../data/canvas';
import { useCanvasDraft } from '../hooks/useCanvasDraft';
import type { AppColors } from '../theme';
import { CanvasScreen } from './CanvasScreen';

export function CanvasWorkspace({ beforeLeaveRef, focusNodeId, onFocusConsumed }: {
  beforeLeaveRef: { current: (() => Promise<boolean>) | null };
  focusNodeId: string | null;
  onFocusConsumed: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { value, loadFailed, saveFailed, update, flush, reload } = useCanvasDraft(loadCanvasDocument, saveCanvasDocument);
  useEffect(() => {
    beforeLeaveRef.current = flush;
    return () => { if (beforeLeaveRef.current === flush) beforeLeaveRef.current = null; };
  }, [beforeLeaveRef, flush]);

  return <View style={styles.container}>
    {loadFailed || saveFailed ? <View style={styles.banner}>
      <Text accessibilityRole="alert" style={styles.error}>
        {loadFailed ? 'Could not open Canvas.' : 'Could not save Canvas. Your draft is still open.'}
      </Text>
      <Pressable accessibilityRole="button" style={styles.retry}
        onPress={() => { if (loadFailed) void reload(); else void flush(); }}>
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View> : null}
    {value ? <CanvasScreen document={value} onChange={update} focusNodeId={focusNodeId} onFocusConsumed={onFocusConsumed} />
      : !loadFailed ? <ActivityIndicator accessibilityLabel="Loading Canvas" color={colors.muted} style={styles.spinner} /> : null}
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  banner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8 },
  error: { flex: 1, color: colors.danger, fontSize: 14, lineHeight: 20 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  retryText: { color: colors.ink, fontWeight: '600' },
  spinner: { marginTop: 24 },
});
