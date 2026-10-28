import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useAppTheme } from '../appearance';
import type { ActivityCategory, AppColors } from '../theme';
import { CellActionIcon, type CellActionIconName } from './CellActionIcon';

type MenuFormat = { bold?: boolean; italic?: boolean; underline?: boolean; textColor?: string };

export type CellActionMenuProps = {
  busy: boolean;
  onCut: () => void;
  onCopy: () => void;
  onAutoFill?: () => void;
  onClear?: () => void;
  onReset?: () => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  onEvent?: () => void;
  onEdit?: () => void;
  onPaste?: () => void;
  canPaste?: boolean;
  onClose: () => void;
  format?: MenuFormat;
  textColor?: string;
  fillColor?: string;
  colorChoices?: readonly ActivityCategory[];
  selectedColorId?: string;
  onToggleBold?: () => void;
  onToggleItalic?: () => void;
  onToggleUnderline?: () => void;
  onTextColor?: (color: string | null) => void;
  onCellColor?: (id: string) => void;
  onResetCellColor?: () => void;
  error?: string | null;
  maxHeight?: number;
  maxWidth?: number;
  width?: number;
  onWidthChange?: (width: number) => void;
  onHeightChange?: (height: number) => void;
  onTouchActiveChange?: (active: boolean) => void;
};

export function CellActionMenu({ busy, onCut, onCopy, onAutoFill, onClear, onReset, onGroup, onUngroup, onEvent, onEdit, onPaste,
  canPaste = Boolean(onPaste), onClose, error, maxHeight, maxWidth, width, onWidthChange, onHeightChange, onTouchActiveChange,
}: CellActionMenuProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { height, width: windowWidth } = useWindowDimensions();
  const [actionsWidth, setActionsWidth] = useState<number | null>(null);
  const hasShown = useRef(false);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { if (!busy) onClose(); return true; });
    return () => subscription.remove();
  }, [onClose, busy]);
  const actions: { id: CellActionIconName; label: string; run?: () => void; disabled?: boolean }[] = [
    { id: 'cut', label: 'Cut selected minute cells', run: onCut },
    { id: 'copy', label: 'Copy selected minute cells', run: onCopy },
    { id: 'paste', label: 'Paste into selected minute cells', run: onPaste, disabled: !canPaste || !onPaste },
    ...(onClear ? [{ id: 'clear' as const, label: 'Clear selected minute cells', run: onClear }] : []),
    ...(onAutoFill ? [{ id: 'fill' as const, label: 'Auto fill selected minute cells', run: onAutoFill }] : []),
    ...(onGroup ? [{ id: 'group' as const, label: 'Group selected minute cells', run: onGroup }] : []),
    ...(onUngroup ? [{ id: 'ungroup' as const, label: 'Ungroup selected minute cells', run: onUngroup }] : []),
    ...(onReset ? [{ id: 'reset' as const, label: 'Reset selected minute cells', run: onReset }] : []),
    ...(onEdit ? [{ id: 'edit' as const, label: 'Edit selected minutes and time range', run: onEdit }] : []),
    ...(onEvent ? [{ id: 'event' as const, label: 'Open source calendar event details', run: onEvent }] : []),
  ];
  const menuMaxWidth = Math.max(1, Math.min(440, (windowWidth ?? 456) - 16, maxWidth ?? Infinity));
  const desiredWidth = Math.min(menuMaxWidth, Math.max(48, actionsWidth === null ? menuMaxWidth : actionsWidth + StyleSheet.hairlineWidth * 2));
  useEffect(() => { if (actionsWidth !== null) onWidthChange?.(desiredWidth); }, [actionsWidth, desiredWidth, onWidthChange]);
  const actualWidth = !hasShown.current && actionsWidth === null ? menuMaxWidth : Math.min(menuMaxWidth, width ?? desiredWidth);
  if (actionsWidth !== null && (width === undefined || Math.abs(actualWidth - desiredWidth) <= 1)) hasShown.current = true;
  return <View accessibilityRole="toolbar" accessibilityLabel="Selected minute actions" accessibilityState={{ busy }}
    pointerEvents={hasShown.current ? 'auto' : 'none'}
    onTouchStart={() => onTouchActiveChange?.(true)} onTouchEnd={() => onTouchActiveChange?.(false)}
    onTouchCancel={() => onTouchActiveChange?.(false)} onAccessibilityEscape={() => { if (!busy) onClose(); }}
    onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
    style={[styles.bar, { width: actualWidth, maxHeight: Math.max(80, Math.min(360, height * 0.48, maxHeight ?? Infinity)), opacity: hasShown.current ? 1 : 0 }]}>
    <ScrollView horizontal nestedScrollEnabled keyboardShouldPersistTaps="always" keyboardDismissMode="none"
      showsHorizontalScrollIndicator={false} bounces={false} contentContainerStyle={styles.actions}
      onContentSizeChange={(next) => { if (Number.isFinite(next) && next > 0) setActionsWidth((old) => old !== null && Math.abs(old - next) < 0.5 ? old : next); }}>
      {actions.map((action) => <Pressable key={action.id} accessibilityRole="button" accessibilityLabel={action.label}
        accessibilityState={{ disabled: busy || Boolean(action.disabled) }} disabled={busy || Boolean(action.disabled)}
        onPress={action.run} style={({ pressed }) => [styles.action, pressed && styles.pressed, (busy || action.disabled) && styles.disabled]}>
        <CellActionIcon name={action.id} color={colors.ink} />
      </Pressable>)}
    </ScrollView>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  bar: { flexShrink: 1, minHeight: 48, borderRadius: 24, overflow: 'hidden', backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, elevation: 4 },
  actions: { minHeight: 48, paddingHorizontal: 6, alignItems: 'center', flexGrow: 0 },
  action: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  pressed: { backgroundColor: colors.hairline }, disabled: { opacity: 0.45 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 17, paddingHorizontal: 12, paddingVertical: 8 },
});
