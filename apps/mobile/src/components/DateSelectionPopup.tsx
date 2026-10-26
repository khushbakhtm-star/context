import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';
import { isDateKey, monthDateCells, normalizeSelectedDates, shiftCalendarMonth, toggleSelectedDate } from '../utils/date-selection';
import { dateKey, formatDayHeading, parseDateKey } from '../utils/time';

type Props = {
  visible: boolean;
  selectedDates: readonly string[];
  anchorDate?: string;
  onApply: (dates: string[]) => void;
  onClose: () => void;
};

export function DateSelectionPopup({ visible, selectedDates, anchorDate, onApply, onClose }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [draft, setDraft] = useState<string[]>([]);
  const [month, setMonth] = useState(dateKey(new Date()));
  const dateTappedRef = useRef(false);
  const selectedKey = selectedDates.join('|');
  useEffect(() => {
    if (!visible) return;
    Keyboard.dismiss();
    dateTappedRef.current = false;
    const dates = normalizeSelectedDates(selectedDates);
    setDraft(dates);
    setMonth(isDateKey(anchorDate) ? anchorDate : dates[0] ?? dateKey(new Date()));
  }, [visible, selectedKey, anchorDate]);

  const selected = useMemo(() => new Set(draft), [draft]);
  const cells = useMemo(() => monthDateCells(month), [month]);
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, index) => cells.slice(index * 7, index * 7 + 7)), [cells]);
  const today = dateKey(new Date());
  const monthTitle = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(parseDateKey(month));
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(undefined, { weekday: 'narrow' })
    .format(new Date(2026, 0, 5 + index, 12)));
  const close = () => onClose();
  const apply = () => {
    if (!dateTappedRef.current) { close(); return; }
    if (draft.length) onApply(normalizeSelectedDates(draft));
  };

  if (!visible) return null;
  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <View style={[styles.overlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <Pressable accessible={false} style={styles.backdrop} onPress={close} />
      <View accessibilityViewIsModal onAccessibilityEscape={close} style={[styles.card,
        { width: Math.min(480, Math.max(240, width - 24)), maxHeight: Math.max(180, height - insets.top - insets.bottom - 32) }]}>
        <ScrollView bounces={false} contentContainerStyle={styles.content}>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={styles.title}>Select dates</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close date selection" style={styles.iconButton} onPress={close}>
              <Text allowFontScaling={false} style={styles.close}>×</Text>
            </Pressable>
          </View>
          <View style={styles.monthRow}>
            <Text accessibilityRole="header" style={styles.month}>{monthTitle}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous month" style={styles.iconButton}
              disabled={shiftCalendarMonth(month, -1) === month} onPress={() => setMonth((value) => shiftCalendarMonth(value, -1))}>
              <Text allowFontScaling={false} style={styles.arrow}>‹</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next month" style={styles.iconButton}
              disabled={shiftCalendarMonth(month, 1) === month} onPress={() => setMonth((value) => shiftCalendarMonth(value, 1))}>
              <Text allowFontScaling={false} style={styles.arrow}>›</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
          <View style={{ width: Math.max(308, Math.min(480, Math.max(240, width - 24)) - 24) }}>
          <View style={styles.week}>
            {weekdays.map((day, index) => <Text key={index} maxFontSizeMultiplier={1.4} style={styles.weekday}>{day}</Text>)}
          </View>
          {weeks.map((week, index) => <View key={index} style={styles.week}>
            {week.map((cell) => <Pressable key={cell.dateKey} accessibilityRole="checkbox"
              accessibilityLabel={formatDayHeading(cell.dateKey) + ', ' + cell.dateKey.slice(0, 4) + (cell.dateKey === today ? ', today' : '')}
              accessibilityState={{ checked: selected.has(cell.dateKey) }}
              onPress={() => {
                const startNewSelection = !dateTappedRef.current;
                dateTappedRef.current = true;
                setDraft((value) => toggleSelectedDate(value, cell.dateKey, startNewSelection));
              }}
              style={({ pressed }) => [styles.day, pressed && styles.pressed]}>
              <View style={[styles.dayCircle, cell.dateKey === today && styles.today,
                selected.has(cell.dateKey) && styles.selected]}>
                <Text maxFontSizeMultiplier={1.4} style={[styles.dayText, !cell.inMonth && styles.otherMonth,
                  selected.has(cell.dateKey) && styles.selectedText]}>{cell.day}</Text>
              </View>
            </Pressable>)}
          </View>)}
          </View>
          </ScrollView>
          <View style={styles.footer}>
            <Text accessibilityLiveRegion="polite" style={styles.count}>{draft.length} {draft.length === 1 ? 'day' : 'days'}</Text>
            <Pressable accessibilityRole="button" onPress={close} style={styles.action}><Text style={styles.actionText}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: draft.length === 0 }} disabled={draft.length === 0}
              onPress={apply} style={[styles.action, styles.done, draft.length === 0 && styles.disabled]}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  overlay: { flex: 1, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim },
  card: { backgroundColor: colors.paper, borderColor: colors.hairline, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, overflow: 'hidden' },
  content: { padding: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8 },
  title: { flex: 1, color: colors.ink, fontSize: 18, fontWeight: '600' },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  close: { color: colors.muted, fontSize: 27 },
  arrow: { color: colors.ink, fontSize: 30 },
  monthRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingVertical: 6 },
  month: { flex: 1, color: colors.ink, fontSize: 18, fontWeight: '500', flexShrink: 1 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, color: colors.muted, textAlign: 'center', fontSize: 12, paddingVertical: 8 },
  day: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.65 },
  dayCircle: { minWidth: 36, minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  today: { borderColor: colors.muted },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayText: { color: colors.ink, fontSize: 15, lineHeight: 23, textAlign: 'center' },
  otherMonth: { color: colors.muted },
  selectedText: { color: colors.onAccent },
  footer: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 12, gap: 4 },
  count: { flexGrow: 1, color: colors.muted, fontSize: 13, paddingHorizontal: 8 },
  action: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center' },
  actionText: { color: colors.graphite, fontSize: 15, fontWeight: '500' },
  done: { backgroundColor: colors.accent, borderRadius: 22 },
  doneText: { color: colors.onAccent, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.35 },
});
