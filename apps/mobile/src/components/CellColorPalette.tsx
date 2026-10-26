import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppTheme } from '../appearance';
import type { ActivityCategory, AppColors } from '../theme';
import { isAllowedGoogleActivityColor } from '../utils/google-activity-colors';

type Props = {
  mode: 'text' | 'cell';
  busy: boolean;
  textColor: string;
  explicitTextColor?: string;
  selectedColorId?: string;
  colorChoices: readonly ActivityCategory[];
  onTextColor: (color: string | null) => void;
  onCellColor: (id: string) => void;
  onClose: () => void;
};

const TEXT_COLORS = ['#FFFFFF', '#D2D2D2', '#96938C', '#171817', '#C4B8E7', '#8DAAB4',
  '#667B69', '#96B59F', '#D2B370', '#B87552', '#B57C8B', '#D7A2A2'];
const HEX = /^#[0-9a-f]{6}$/i;

export function CellColorPalette({ mode, busy, textColor, explicitTextColor, selectedColorId,
  colorChoices, onTextColor, onCellColor, onClose }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [hex, setHex] = useState(explicitTextColor ?? textColor);
  const allowedColors = useMemo(() => colorChoices.filter((item) => !item.archived &&
    !(item.provider === 'google' && item.providerOriginalColor &&
      item.color.toUpperCase() !== item.providerOriginalColor.toUpperCase()) &&
    isAllowedGoogleActivityColor(item.color, colorChoices)), [colorChoices]);
  const selectedColor = allowedColors.find((item) => item.id === selectedColorId);

  return <View style={styles.palette}>
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.title}>{mode === 'text' ? 'Text color' : 'Cell color'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close colors" onPress={onClose} style={styles.closeButton}>
        <Text allowFontScaling={false} style={styles.close}>×</Text>
      </Pressable>
    </View>
    <View accessibilityRole="radiogroup" accessibilityLabel={mode === 'text' ? 'Text colors' : 'Cell colors'} style={styles.choices}>
      {mode === 'text' ? TEXT_COLORS.map((color) => <Pressable key={color} accessibilityRole="radio"
        accessibilityLabel={'Text color ' + color}
        accessibilityState={{ checked: explicitTextColor?.toUpperCase() === color, disabled: busy }}
        disabled={busy} onPress={() => onTextColor(color)}
        style={[styles.choice, explicitTextColor?.toUpperCase() === color && styles.selected, busy && styles.disabled]}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text allowFontScaling={false} style={styles.hex}>{color}</Text>
      </Pressable>) : allowedColors.map((item) => <Pressable key={item.id} accessibilityRole="radio"
        accessibilityLabel={item.name + ', ' + item.color.toUpperCase()}
        accessibilityState={{ checked: selectedColorId === item.id, disabled: busy }} disabled={busy}
        onPress={() => onCellColor(item.id)}
        style={[styles.choice, selectedColorId === item.id && styles.selected, busy && styles.disabled]}>
        <View style={[styles.dot, { backgroundColor: item.color }]} />
        <Text allowFontScaling={false} style={styles.hex}>{item.color.toUpperCase()}</Text>
      </Pressable>)}
    </View>
    {mode === 'text' ? <View style={styles.custom}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: !explicitTextColor, disabled: busy }}
        disabled={busy} onPress={() => onTextColor(null)} style={styles.automatic}>
        <Text style={styles.actionText}>Automatic</Text>
      </Pressable>
      <TextInput value={hex} onChangeText={setHex} accessibilityLabel="Custom text color hexadecimal value"
        placeholder="#RRGGBB" placeholderTextColor={colors.muted} autoCapitalize="characters" autoCorrect={false}
        editable={!busy} maxLength={7} selectTextOnFocus style={styles.hexInput} returnKeyType="done"
        onSubmitEditing={() => { if (!busy && HEX.test(hex)) onTextColor(hex.toUpperCase()); }} />
      <Pressable accessibilityRole="button" accessibilityLabel="Apply custom text color" disabled={busy || !HEX.test(hex)}
        onPress={() => onTextColor(hex.toUpperCase())} style={[styles.apply, (busy || !HEX.test(hex)) && styles.disabled]}>
        <Text style={styles.actionText}>Apply</Text>
      </Pressable>
    </View> : selectedColor ? <Text style={styles.name}>{selectedColor.name} · {selectedColor.color.toUpperCase()}</Text> :
      allowedColors.length === 0 ? <Text style={styles.name}>No colors available</Text> : null}
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  palette: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, paddingHorizontal: 8, paddingBottom: 10 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  closeButton: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  close: { color: colors.muted, fontSize: 25 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  choice: { width: 48, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 5,
    borderColor: 'transparent', gap: 3 },
  selected: { borderColor: colors.muted },
  disabled: { opacity: 0.4 },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: colors.swatchBorder },
  hex: { color: colors.graphite, fontSize: 9, lineHeight: 12 },
  custom: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  automatic: { minHeight: 44, paddingHorizontal: 7, justifyContent: 'center' },
  actionText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  hexInput: { minWidth: 90, flexGrow: 1, minHeight: 44, color: colors.ink, borderWidth: 1, borderColor: colors.hairline,
    paddingHorizontal: 8, borderRadius: 4, fontSize: 13 },
  apply: { minHeight: 44, minWidth: 50, justifyContent: 'center', alignItems: 'center' },
  name: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
});
