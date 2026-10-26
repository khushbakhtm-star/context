import { useMemo, useState } from 'react';
import {
  Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';

type Props = {
  title: string;
  message: string;
  style?: StyleProp<ViewStyle>;
  onDark?: boolean;
};

/** Explanations stay out of the screen and accessibility tree until requested. */
export function InfoButton({ title, message, style, onDark = false }: Props) {
  const [open, setOpen] = useState(false);
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const iconColor = onDark ? colors.onAccentMuted : colors.muted;
  const close = () => setOpen(false);

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`About ${title}`}
      accessibilityHint="Opens an explanation" accessibilityState={{ expanded: open }}
      onPress={() => { Keyboard.dismiss(); setOpen(true); }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, style]}>
      <View pointerEvents="none" accessible={false} style={[styles.circle, { borderColor: iconColor }]}>
        <Text accessible={false} allowFontScaling={false} style={[styles.icon, { color: iconColor }]}>i</Text>
      </View>
    </Pressable>
    {open ? <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={[styles.overlay, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <Pressable accessible={false} onPress={close} style={styles.backdrop} />
        <View accessibilityViewIsModal onAccessibilityEscape={close}
          style={[styles.card, { maxHeight: Math.max(160, height - insets.top - insets.bottom - 48) }]}>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close information"
              onPress={close} style={styles.close}>
              <Text allowFontScaling={false} style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
            <Text selectable style={styles.message}>{message}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal> : null}
  </>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  button: { width: 44, minHeight: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  circle: { width: 18, height: 18, borderWidth: 1.2, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 12, lineHeight: 15, fontWeight: '700' },
  overlay: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  card: { width: '100%', maxWidth: 520, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline, backgroundColor: colors.paper, overflow: 'hidden', flexShrink: 1 },
  heading: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 6, paddingVertical: 6 },
  title: { flex: 1, color: colors.ink, fontSize: 18, lineHeight: 25, fontWeight: '600' },
  close: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.muted, fontSize: 27, lineHeight: 32 },
  scroll: { flexShrink: 1 },
  body: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 22 },
  message: { color: colors.graphite, fontSize: 15, lineHeight: 23 },
});
