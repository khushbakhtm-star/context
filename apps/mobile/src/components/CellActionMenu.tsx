import { useEffect, useMemo } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';

export type CellActionMenuProps = {
  busy: boolean;
  onCut: () => void;
  onCopy: () => void;
  onAutoFill: () => void;
  onClear: () => void;
  onGroup?: () => void;
  onPaste?: () => void;
  onClose: () => void;
};

export function CellActionMenu({ busy, onCut, onCopy, onAutoFill, onClear, onGroup, onPaste, onClose }: CellActionMenuProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  const actions = [
    ...(onPaste ? [{ label: 'Paste', accessibilityLabel: 'Paste into selected minute cells', onPress: onPaste }] : []),
    { label: 'Cut', accessibilityLabel: 'Cut selected minute cells', onPress: onCut },
    { label: 'Copy', accessibilityLabel: 'Copy selected minute cells', onPress: onCopy },
    { label: 'Auto fill', accessibilityLabel: 'Auto fill selected minute cells', onPress: onAutoFill },
    { label: 'Clear', accessibilityLabel: 'Clear selected minute cells', onPress: onClear },
    ...(onGroup ? [{ label: 'Group', accessibilityLabel: 'Group selected minute cells', onPress: onGroup }] : []),
  ];

  return (
    <View accessibilityRole="toolbar" accessibilityLabel="Selected minute actions" style={styles.bar}>
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}
        bounces={false} style={styles.scroll} contentContainerStyle={styles.actions}>
        {actions.map((action) => (
          <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.accessibilityLabel}
            accessibilityState={{ disabled: busy }} disabled={busy} onPress={action.onPress}
            style={({ pressed }) => [styles.action, pressed && styles.pressed, busy && styles.disabled]}>
            <Text style={styles.label}>{action.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  bar: {
    width: '100%', flexShrink: 1, maxWidth: '100%', minHeight: 48,
    borderRadius: 26, overflow: 'hidden', backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline,
    elevation: 4,
  },
  scroll: { flexGrow: 0 },
  actions: { minHeight: 48, paddingHorizontal: 8, alignItems: 'center' },
  action: { minHeight: 48, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  pressed: { backgroundColor: colors.hairline },
  disabled: { opacity: 0.45 },
  label: { color: colors.ink, fontSize: 15, fontWeight: '400' },
});
