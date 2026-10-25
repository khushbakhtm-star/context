import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';

export type SpreadsheetToolbarProps = {
  visible: boolean;
  format: { bold?: boolean; italic?: boolean; textColor?: string };
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  selectionLabel: string;
  error?: string | null;
  onToggleBold: () => void;
  onToggleItalic: () => void;
  onTextColor: (color: string | null) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFill: () => void;
  onDone: () => void;
};

const TEXT_COLORS = ['#FFFFFF', '#D2D2D2', '#96938C', '#171817', '#C4B8E7', '#8DAAB4',
  '#667B69', '#96B59F', '#D2B370', '#B87552', '#B57C8B', '#D7A2A2'];
const HEX = /^#[0-9a-f]{6}$/i;

export function SpreadsheetToolbar({ visible, format, canUndo, canRedo, busy, selectionLabel,
  error, onToggleBold, onToggleItalic, onTextColor, onUndo, onRedo, onFill, onDone,
}: SpreadsheetToolbarProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [textColorsOpen, setTextColorsOpen] = useState(false);
  const [hex, setHex] = useState('');
  useEffect(() => { if (!visible) setTextColorsOpen(false); }, [visible]);
  if (!visible) return null;

  function chooseColor(value: string | null) {
    onTextColor(value);
    setTextColorsOpen(false);
    Keyboard.dismiss();
  }

  return (
    <View style={styles.container}>
      {textColorsOpen ? (
        <View style={styles.palette}>
          <View style={styles.paletteHeading}>
            <Text style={styles.paletteTitle}>Text color</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close text colors"
              onPress={() => setTextColorsOpen(false)} style={styles.smallButton}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>
          <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator
            contentContainerStyle={styles.colorChoices}>
            {TEXT_COLORS.map((color) => (
              <Pressable key={color} accessibilityRole="radio" accessibilityLabel={'Text color ' + color}
                accessibilityState={{ checked: format.textColor?.toUpperCase() === color }}
                disabled={busy} onPress={() => chooseColor(color)}
                style={[styles.colorButton, format.textColor?.toUpperCase() === color && styles.selectedColor]}>
                <View style={[styles.colorDot, { backgroundColor: color }]} />
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.customColorRow}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => chooseColor(null)} style={styles.automatic}>
              <Text style={styles.actionText}>Automatic</Text>
            </Pressable>
            <TextInput value={hex} onChangeText={setHex} accessibilityLabel="Custom text color hexadecimal value"
              placeholder="#RRGGBB" placeholderTextColor={colors.muted} autoCapitalize="characters"
              autoCorrect={false} maxLength={7} selectTextOnFocus style={styles.hexInput}
              returnKeyType="done" onSubmitEditing={() => { if (HEX.test(hex)) chooseColor(hex.toUpperCase()); }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Apply custom text color"
              disabled={busy || !HEX.test(hex)} onPress={() => chooseColor(hex.toUpperCase())}
              style={[styles.apply, (busy || !HEX.test(hex)) && styles.disabled]}>
              <Text style={styles.actionText}>Apply</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      <Text numberOfLines={1} style={styles.selection}>{selectionLabel}</Text>
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tools}>
        <Pressable accessibilityRole="button" accessibilityLabel="Bold" accessibilityState={{ selected: Boolean(format.bold) }}
          disabled={busy} onPress={onToggleBold} style={[styles.tool, format.bold && styles.selected, busy && styles.disabled]}>
          <Text style={[styles.toolText, styles.bold, format.bold && styles.selectedText]}>B</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Italic" accessibilityState={{ selected: Boolean(format.italic) }}
          disabled={busy} onPress={onToggleItalic} style={[styles.tool, format.italic && styles.selected, busy && styles.disabled]}>
          <Text style={[styles.toolText, styles.italic, format.italic && styles.selectedText]}>I</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose text color" accessibilityState={{ expanded: textColorsOpen }}
          disabled={busy} onPress={() => { Keyboard.dismiss(); setHex(format.textColor ?? ''); setTextColorsOpen((open) => !open); }}
          style={[styles.tool, busy && styles.disabled]}>
          <Text style={styles.toolText}>A</Text>
          <View style={[styles.textColorLine, { backgroundColor: format.textColor ?? colors.ink }]} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Undo Context edit" disabled={!canUndo || busy} onPress={onUndo}
          style={[styles.tool, (!canUndo || busy) && styles.disabled]}><Text style={styles.arrow}>↶</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Redo Context edit" disabled={!canRedo || busy} onPress={onRedo}
          style={[styles.tool, (!canRedo || busy) && styles.disabled]}><Text style={styles.arrow}>↷</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Select minutes and fill" disabled={busy}
          onPress={() => { setTextColorsOpen(false); Keyboard.dismiss(); onFill(); }}
          style={[styles.tool, busy && styles.disabled]}><Text style={styles.plus}>＋</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Finish editing" disabled={busy}
          onPress={() => { setTextColorsOpen(false); Keyboard.dismiss(); onDone(); }}
          style={[styles.tool, styles.done, busy && styles.disabled]}><Text style={styles.doneText}>✓</Text></Pressable>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { backgroundColor: colors.paper, borderTopWidth: 1, borderTopColor: colors.hairline },
  selection: { color: colors.muted, fontSize: 10, paddingHorizontal: 10, paddingTop: 4, paddingBottom: 2 },
  tools: { minHeight: 49, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 2 },
  tool: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  toolText: { fontSize: 23, color: colors.ink },
  bold: { fontWeight: '800' },
  italic: { fontStyle: 'italic', fontWeight: '600' },
  selected: { backgroundColor: colors.selectedDay },
  selectedText: { color: colors.onSelectedDay },
  disabled: { opacity: 0.35 },
  textColorLine: { height: 3, width: 24, marginTop: 1 },
  arrow: { color: colors.ink, fontSize: 29 },
  plus: { color: colors.ink, fontSize: 29 },
  done: { backgroundColor: colors.selectedDay, marginLeft: 4 },
  doneText: { color: colors.onSelectedDay, fontSize: 28 },
  palette: { paddingHorizontal: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  paletteHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  paletteTitle: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  smallButton: { minWidth: 44, minHeight: 38, alignItems: 'center', justifyContent: 'center' },
  close: { color: colors.ink, fontSize: 25 },
  colorChoices: { flexDirection: 'row', gap: 2, paddingVertical: 3 },
  colorButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  selectedColor: { borderColor: colors.selectedDay },
  colorDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: colors.swatchBorder },
  customColorRow: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingTop: 3 },
  automatic: { minHeight: 42, paddingHorizontal: 7, justifyContent: 'center' },
  actionText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  hexInput: { flex: 1, minHeight: 40, color: colors.ink, borderWidth: 1, borderColor: colors.hairline, paddingHorizontal: 10, fontSize: 13 },
  apply: { minHeight: 42, minWidth: 50, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12 },
});
