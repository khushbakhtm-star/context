import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useAppTheme } from '../appearance';
import type { ActivityCategory, AppColors } from '../theme';
import { CellColorPalette } from './CellColorPalette';

type MenuFormat = { bold?: boolean; italic?: boolean; underline?: boolean; textColor?: string };

export type CellActionMenuProps = {
  busy: boolean;
  onCut: () => void;
  onCopy: () => void;
  onAutoFill?: () => void;
  onClear?: () => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  onEvent?: () => void;
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

export function CellActionMenu({ busy, onCut, onCopy, onAutoFill, onClear, onGroup, onUngroup, onEvent, onPaste,
  canPaste = Boolean(onPaste), onClose, format = {}, textColor, fillColor, colorChoices = [], selectedColorId,
  onToggleBold, onToggleItalic, onToggleUnderline, onTextColor, onCellColor, onResetCellColor, error, maxHeight, maxWidth, width,
  onWidthChange, onHeightChange, onTouchActiveChange,
}: CellActionMenuProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { height, width: windowWidth } = useWindowDimensions();
  const [palette, setPalette] = useState<'text' | 'cell' | null>(null);
  const [actionsWidth, setActionsWidth] = useState<number | null>(null);
  const [formatWidth, setFormatWidth] = useState<number | null>(null);
  const hasShown = useRef(false);
  const currentTextColor = format.textColor ?? textColor ?? colors.ink;
  const currentFillColor = fillColor ?? colors.calendarCell;
  const menuMaxHeight = Math.max(80, Math.min(360, height * 0.48, maxHeight ?? Number.POSITIVE_INFINITY));

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy) return true;
      if (palette) setPalette(null);
      else onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose, palette, busy]);

  function showPalette(value: 'text' | 'cell') {
    Keyboard.dismiss();
    setPalette((previous) => previous === value ? null : value);
  }

  function chooseTextColor(color: string | null) {
    onTextColor?.(color);
    setPalette(null);
    Keyboard.dismiss();
  }

  const actions = [
    { label: 'Cut', accessibilityLabel: 'Cut selected minute cells', onPress: onCut, disabled: busy },
    { label: 'Copy', accessibilityLabel: 'Copy selected minute cells', onPress: onCopy, disabled: busy },
    { label: 'Paste', accessibilityLabel: 'Paste into selected minute cells', onPress: onPaste,
      disabled: busy || !canPaste || !onPaste },
    ...(onClear ? [{ label: 'Clear', accessibilityLabel: 'Clear selected minute cells', onPress: onClear, disabled: busy }] : []),
    ...(onAutoFill ? [{ label: 'AutoFill', accessibilityLabel: 'Auto fill selected minute cells', onPress: onAutoFill, disabled: busy }] : []),
    ...(onGroup ? [{ label: 'Group', accessibilityLabel: 'Group selected minute cells', onPress: onGroup, disabled: busy }] : []),
    ...(onUngroup ? [{ label: 'Ungroup', accessibilityLabel: 'Ungroup selected minute cells', onPress: onUngroup, disabled: busy }] : []),
    ...(onEvent ? [{ label: 'Event', accessibilityLabel: 'Open source calendar event details', onPress: onEvent, disabled: busy }] : []),
  ];
  const hasFormatting = Boolean(onToggleBold || onToggleItalic || onToggleUnderline || onTextColor || onCellColor);
  const menuMaxWidth = Math.max(1, Math.min(440, (windowWidth ?? 456) - 16, maxWidth ?? Number.POSITIVE_INFINITY));
  const measured = actionsWidth !== null && (!hasFormatting || formatWidth !== null);
  const desiredWidth = !measured || palette ? menuMaxWidth : Math.min(menuMaxWidth,
    Math.max(48, actionsWidth!, hasFormatting ? formatWidth! : 0) + StyleSheet.hairlineWidth * 2);
  useEffect(() => { if (measured) onWidthChange?.(desiredWidth); }, [measured, desiredWidth, onWidthChange]);
  const actualWidth = !measured && !hasShown.current ? menuMaxWidth : Math.min(menuMaxWidth, width ?? desiredWidth);
  if (measured && (width === undefined || Math.abs(actualWidth - desiredWidth) <= 1)) hasShown.current = true;
  const visible = hasShown.current;

  return (
    <View accessibilityRole="toolbar" accessibilityLabel="Selected minute actions" accessibilityState={{ busy }}
      pointerEvents={visible ? 'auto' : 'none'}
      onTouchStart={() => onTouchActiveChange?.(true)} onTouchEnd={() => onTouchActiveChange?.(false)}
      onTouchCancel={() => onTouchActiveChange?.(false)}
      onAccessibilityEscape={() => { if (busy) return; if (palette) setPalette(null); else onClose(); }}
      onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      style={[styles.bar, { maxHeight: menuMaxHeight, width: actualWidth, opacity: visible ? 1 : 0 }, palette && styles.expanded]}>
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="always" keyboardDismissMode="none" bounces={false} style={styles.verticalScroll}>
      <ScrollView horizontal nestedScrollEnabled keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}
        keyboardDismissMode="none" bounces={false} style={styles.scroll} contentContainerStyle={styles.actions}
        onContentSizeChange={(width) => { if (Number.isFinite(width) && width > 0)
          setActionsWidth((previous) => previous !== null && Math.abs(previous - width) < 0.5 ? previous : width); }}>
        {actions.map((action) => (
          <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.accessibilityLabel}
            accessibilityState={{ disabled: action.disabled }} disabled={action.disabled} onPress={action.onPress}
            style={({ pressed }) => [styles.action, pressed && styles.pressed, action.disabled && styles.disabled]}>
            <Text maxFontSizeMultiplier={1.5} style={styles.label}>{action.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {hasFormatting ? <ScrollView horizontal nestedScrollEnabled keyboardShouldPersistTaps="always"
        keyboardDismissMode="none" showsHorizontalScrollIndicator={false} bounces={false} style={styles.formatScroll}
        contentContainerStyle={styles.formatTools}
        onContentSizeChange={(width) => { if (Number.isFinite(width) && width > 0)
          setFormatWidth((previous) => previous !== null && Math.abs(previous - width) < 0.5 ? previous : width); }}>
        {onToggleBold ? <Pressable accessibilityRole="button" accessibilityLabel="Bold"
          accessibilityState={{ selected: Boolean(format.bold), disabled: busy }} disabled={busy} onPress={onToggleBold}
          style={[styles.tool, format.bold && styles.selected, busy && styles.disabled]}>
          <Text allowFontScaling={false} style={[styles.toolText, styles.bold]}>B</Text>
        </Pressable> : null}
        {onToggleItalic ? <Pressable accessibilityRole="button" accessibilityLabel="Italic"
          accessibilityState={{ selected: Boolean(format.italic), disabled: busy }} disabled={busy} onPress={onToggleItalic}
          style={[styles.tool, format.italic && styles.selected, busy && styles.disabled]}>
          <Text allowFontScaling={false} style={[styles.toolText, styles.italic]}>I</Text>
        </Pressable> : null}
        {onToggleUnderline ? <Pressable accessibilityRole="button" accessibilityLabel="Underline"
          accessibilityState={{ selected: Boolean(format.underline), disabled: busy }} disabled={busy} onPress={onToggleUnderline}
          style={[styles.tool, format.underline && styles.selected, busy && styles.disabled]}>
          <Text allowFontScaling={false} style={[styles.toolText, styles.underline]}>U</Text>
        </Pressable> : null}
        {onTextColor ? <Pressable accessibilityRole="button" accessibilityLabel="Choose text color"
          accessibilityState={{ expanded: palette === 'text', disabled: busy }} disabled={busy}
          onPress={() => showPalette('text')} style={[styles.tool, palette === 'text' && styles.selected, busy && styles.disabled]}>
          <Text allowFontScaling={false} style={[styles.toolText, styles.bold]}>A</Text>
          <View style={[styles.textColorLine, { backgroundColor: currentTextColor }]} />
        </Pressable> : null}
        {onCellColor ? <Pressable accessibilityRole="button" accessibilityLabel="Choose cell color"
          accessibilityState={{ expanded: palette === 'cell', disabled: busy }} disabled={busy}
          onPress={() => showPalette('cell')} style={[styles.tool, palette === 'cell' && styles.selected, busy && styles.disabled]}>
          <View style={[styles.fillColorDot, { backgroundColor: currentFillColor }]} />
        </Pressable> : null}
      </ScrollView> : null}
      {palette ? <CellColorPalette key={palette} mode={palette} busy={busy} textColor={currentTextColor}
        explicitTextColor={format.textColor} selectedColorId={selectedColorId} colorChoices={colorChoices}
        onTextColor={chooseTextColor} onCellColor={(id) => { onCellColor?.(id); setPalette(null); }}
        onResetCellColor={() => { onResetCellColor?.(); setPalette(null); }}
        onClose={() => setPalette(null)} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  bar: {
    flexShrink: 1, minHeight: 48,
    borderRadius: 24, overflow: 'hidden', backgroundColor: colors.panel,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline,
    elevation: 4,
  },
  expanded: { borderRadius: 16 },
  verticalScroll: { flexGrow: 0, flexShrink: 1 },
  scroll: { flexGrow: 0 },
  actions: { minHeight: 48, paddingHorizontal: 8, alignItems: 'center', alignSelf: 'flex-start', flexGrow: 0 },
  action: { minHeight: 48, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  pressed: { backgroundColor: colors.hairline },
  disabled: { opacity: 0.45 },
  label: { color: colors.ink, fontSize: 15, fontWeight: '400' },
  formatScroll: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  formatTools: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', flexGrow: 0,
    paddingHorizontal: 6, paddingBottom: 4, gap: 2 },
  tool: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  toolText: { fontSize: 23, lineHeight: 27, color: colors.ink },
  bold: { fontWeight: '800' },
  italic: { fontStyle: 'italic', fontWeight: '600' },
  underline: { textDecorationLine: 'underline', fontWeight: '500' },
  selected: { backgroundColor: colors.selectedDay },
  textColorLine: { height: 3, width: 23, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.swatchBorder },
  fillColorDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.swatchBorder },
  error: { color: colors.danger, fontSize: 12, lineHeight: 17, paddingHorizontal: 12, paddingVertical: 8 },
});
