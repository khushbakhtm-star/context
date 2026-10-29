import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useAppTheme } from '../appearance';
import type { ActivityCategory, AppColors } from '../theme';
import { CellActionIcon, type CellActionIconName } from './CellActionIcon';
import { CellColorPalette } from './CellColorPalette';

type MenuFormat = { bold?: boolean; italic?: boolean; underline?: boolean; textColor?: string };

export type CellActionMenuProps = {
  busy: boolean;
  onCut: () => void;
  onCopy: () => void;
  onAutoFill?: () => void;
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

export function CellActionMenu({ busy, onCut, onCopy, onAutoFill, onReset, onGroup, onUngroup, onEvent, onEdit, onPaste,
  canPaste = Boolean(onPaste), onClose, error, maxHeight, maxWidth, width, onWidthChange, onHeightChange, onTouchActiveChange,
  format = {}, textColor, fillColor, colorChoices = [], selectedColorId,
  onToggleBold, onToggleItalic, onToggleUnderline, onTextColor, onCellColor, onResetCellColor,
}: CellActionMenuProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { height, width: windowWidth } = useWindowDimensions();
  const [actionsWidth, setActionsWidth] = useState<number | null>(null);
  const [formatOpen, setFormatOpen] = useState(false);
  const [palette, setPalette] = useState<'text' | 'cell' | null>(null);
  const hasShown = useRef(false);
  function closePanel() {
    if (busy) return;
    if (palette) setPalette(null);
    else if (formatOpen) setFormatOpen(false);
    else onClose();
  }
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { closePanel(); return true; });
    return () => subscription.remove();
  }, [onClose, busy, formatOpen, palette]);
  const canFormat = Boolean(onToggleBold || onToggleItalic || onToggleUnderline || onTextColor || onCellColor);
  const actions: { id: CellActionIconName; label: string; run?: () => void; disabled?: boolean }[] = [
    { id: 'cut', label: 'Cut selected minute cells', run: onCut },
    { id: 'copy', label: 'Copy selected minute cells', run: onCopy },
    { id: 'paste', label: 'Paste into selected minute cells', run: onPaste, disabled: !canPaste || !onPaste },
    ...(onAutoFill ? [{ id: 'fill' as const, label: 'Auto fill selected minute cells', run: onAutoFill }] : []),
    ...(onGroup ? [{ id: 'group' as const, label: 'Group selected minute cells', run: onGroup }] : []),
    ...(onUngroup ? [{ id: 'ungroup' as const, label: 'Ungroup selected minute cells', run: onUngroup }] : []),
    ...(onReset ? [{ id: 'reset' as const, label: 'Reset selected minute cells', run: onReset }] : []),
    ...(onEdit ? [{ id: 'edit' as const, label: 'Edit selected minutes and time range', run: onEdit }] : []),
    ...(onEvent ? [{ id: 'event' as const, label: 'Open source calendar event details', run: onEvent }] : []),
    ...(canFormat ? [{ id: 'format' as const, label: 'Format selected minute cells', run: () => {
      setPalette(null); setFormatOpen((open) => !open);
    } }] : []),
  ];
  const formatControls = [
    ...(onToggleBold ? [{ id: 'bold', label: 'Bold', glyph: 'B', selected: Boolean(format.bold), run: onToggleBold,
      textStyle: { fontWeight: '800' as const } }] : []),
    ...(onToggleItalic ? [{ id: 'italic', label: 'Italic', glyph: 'I', selected: Boolean(format.italic), run: onToggleItalic,
      textStyle: { fontStyle: 'italic' as const } }] : []),
    ...(onToggleUnderline ? [{ id: 'underline', label: 'Underline', glyph: 'U', selected: Boolean(format.underline), run: onToggleUnderline,
      textStyle: { textDecorationLine: 'underline' as const } }] : []),
    ...(onTextColor ? [{ id: 'text', label: 'Choose text color', glyph: 'A', selected: palette === 'text',
      run: () => setPalette((mode) => mode === 'text' ? null : 'text'), textStyle: { color: textColor ?? colors.ink } }] : []),
    ...(onCellColor ? [{ id: 'cell', label: 'Choose cell color', glyph: '', selected: palette === 'cell',
      run: () => setPalette((mode) => mode === 'cell' ? null : 'cell'), textStyle: {} }] : []),
  ];
  const menuMaxWidth = Math.max(1, Math.min(440, (windowWidth ?? 456) - 16, maxWidth ?? Infinity));
  const formatWidth = formatOpen ? palette ? menuMaxWidth : formatControls.length * 44 + 12 : 0;
  const desiredWidth = Math.min(menuMaxWidth, Math.max(48, formatWidth,
    actionsWidth === null ? menuMaxWidth : actionsWidth + StyleSheet.hairlineWidth * 2));
  useEffect(() => { if (actionsWidth !== null) onWidthChange?.(desiredWidth); }, [actionsWidth, desiredWidth, onWidthChange]);
  const actualWidth = !hasShown.current && actionsWidth === null ? menuMaxWidth : Math.min(menuMaxWidth, width ?? desiredWidth);
  if (actionsWidth !== null && (width === undefined || Math.abs(actualWidth - desiredWidth) <= 1)) hasShown.current = true;
  const menuMaxHeight = Math.max(48, Math.min(360, height * 0.48, maxHeight ?? Infinity));
  return <View accessibilityRole="toolbar" accessibilityLabel="Selected minute actions" accessibilityState={{ busy }}
    pointerEvents={hasShown.current ? 'auto' : 'none'}
    onTouchStart={() => onTouchActiveChange?.(true)} onTouchEnd={() => onTouchActiveChange?.(false)}
    onTouchCancel={() => onTouchActiveChange?.(false)} onAccessibilityEscape={closePanel}
    onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
    style={[styles.bar, { width: actualWidth, maxHeight: menuMaxHeight, opacity: hasShown.current ? 1 : 0 }]}>
    <ScrollView horizontal nestedScrollEnabled keyboardShouldPersistTaps="always" keyboardDismissMode="none"
      showsHorizontalScrollIndicator={false} bounces={false} contentContainerStyle={styles.actions} style={styles.actionScroll}
      onContentSizeChange={(next) => { if (Number.isFinite(next) && next > 0) setActionsWidth((old) => old !== null && Math.abs(old - next) < 0.5 ? old : next); }}>
      {actions.map((action) => <Pressable key={action.id} accessibilityRole="button" accessibilityLabel={action.label}
        accessibilityState={{ disabled: busy || Boolean(action.disabled) }} disabled={busy || Boolean(action.disabled)}
        {...(action.id === 'format' ? { accessibilityState: { disabled: busy, expanded: formatOpen } } : {})}
        onPress={() => { if (!busy && !action.disabled) action.run?.(); }}
        style={({ pressed }) => [styles.action, action.id === 'format' && formatOpen && styles.pressed,
          pressed && styles.pressed, (busy || action.disabled) && styles.disabled]}>
        {({ pressed }) => <CellActionIcon name={action.id} color={colors.ink}
          backgroundColor={pressed || action.id === 'format' && formatOpen ? colors.hairline : colors.panel}
          secondaryColor={colors.muted} />}
      </Pressable>)}
    </ScrollView>
    {formatOpen ? <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="always" keyboardDismissMode="none"
      style={{ flexGrow: 0, flexShrink: 1, maxHeight: Math.max(0, menuMaxHeight - 48) }}>
      <ScrollView horizontal nestedScrollEnabled keyboardShouldPersistTaps="always" keyboardDismissMode="none"
        accessibilityRole="toolbar" accessibilityLabel="Cell formatting" showsHorizontalScrollIndicator={false}
        bounces={false} style={styles.actionScroll} contentContainerStyle={[styles.actions, styles.formatActions]}>
        {formatControls.map((control) => <Pressable key={control.id} accessibilityRole="button" accessibilityLabel={control.label}
          disabled={busy} accessibilityState={{ disabled: busy, selected: control.selected,
            ...(control.id === 'text' || control.id === 'cell' ? { expanded: control.selected } : {}) }}
          onPress={() => { if (!busy) control.run(); }}
          style={({ pressed }) => [styles.action, control.selected && styles.pressed, pressed && styles.pressed, busy && styles.disabled]}>
          {control.id === 'cell' ? <View style={[styles.fillDot, { backgroundColor: fillColor ?? colors.paper }]} /> : <>
            <Text allowFontScaling={false} style={[styles.formatLetter, control.textStyle]}>{control.glyph}</Text>
            {control.id === 'text' ? <View style={[styles.textColorLine, { backgroundColor: textColor ?? colors.ink }]} /> : null}
          </>}
        </Pressable>)}
      </ScrollView>
      {palette ? <CellColorPalette key={palette} mode={palette} busy={busy} textColor={textColor ?? colors.ink}
        explicitTextColor={format.textColor} selectedColorId={selectedColorId} colorChoices={colorChoices}
        onTextColor={(color) => { if (!busy && onTextColor) { setPalette(null); onTextColor(color); } }}
        onCellColor={(id) => { if (!busy && onCellColor) { setPalette(null); onCellColor(id); } }}
        onResetCellColor={onResetCellColor ? () => { if (!busy) { setPalette(null); onResetCellColor(); } } : undefined}
        onClose={() => { if (!busy) setPalette(null); }} /> : null}
    </ScrollView> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  bar: { flexShrink: 1, minHeight: 48, borderRadius: 24, overflow: 'hidden', backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, elevation: 4 },
  actions: { minHeight: 48, paddingHorizontal: 6, alignItems: 'center', flexGrow: 0 },
  actionScroll: { height: 48, flexGrow: 0, flexShrink: 0 },
  action: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  formatActions: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  formatLetter: { color: colors.ink, fontSize: 23, lineHeight: 27, includeFontPadding: false },
  textColorLine: { position: 'absolute', bottom: 7, width: 23, height: 2, borderRadius: 1 },
  fillDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.swatchBorder },
  pressed: { backgroundColor: colors.hairline }, disabled: { opacity: 0.45 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 17, paddingHorizontal: 12, paddingVertical: 8 },
});
