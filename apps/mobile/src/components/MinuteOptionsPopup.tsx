import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../appearance';

type Props = { visible: boolean; onClose: () => void; children: ReactNode };

export function MinuteOptionsPopup({ visible, onClose, children }: Props) {
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent={false}>
    <KeyboardAvoidingView style={[styles.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close minute options" onPress={onClose}
        style={styles.backdrop} />
      <View accessibilityViewIsModal onAccessibilityEscape={onClose}
        style={[styles.card, { width: Math.min(480, Math.max(240, width - 24)), backgroundColor: colors.panel,
          borderColor: colors.hairline }]}>
        <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>{children}</ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#00000088' },
  card: { maxHeight: '100%', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
});
