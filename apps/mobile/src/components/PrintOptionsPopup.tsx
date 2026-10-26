import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';
import { isDateKey } from '../utils/date-selection';
import { normalizePrintOptions, printOptionDates, withDashboardPeriod, type ContextPrintOptions, type PrintAction } from '../utils/print-options';
import { parseDateKey } from '../utils/time';
import { DateSelectionPopup } from './DateSelectionPopup';
import { InfoButton } from './InfoButton';

type Props = {
  visible: boolean;
  initialOptions: ContextPrintOptions;
  onClose: () => void;
  onDismiss: () => void;
  onConfirm: (action: PrintAction, options: ContextPrintOptions) => void;
};

const VIEWS: { value: ContextPrintOptions['view']; label: string }[] = [
  { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' },
  { value: 'schedule', label: 'Schedule' }, { value: 'dashboard', label: 'Dashboard' },
];
const COLORS: { value: ContextPrintOptions['colorStyle']; label: string }[] = [
  { value: 'outline', label: 'Outline' }, { value: 'full-color', label: 'Full color' },
  { value: 'grayscale', label: 'Grayscale' }, { value: 'black-white', label: 'Black & white' },
];
const PERIODS: { value: ContextPrintOptions['dashboardPeriod']; label: string }[] = [
  { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' }, { value: 'custom', label: 'Custom' },
];

export function PrintOptionsPopup({ visible, initialOptions, onClose, onDismiss, onConfirm }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [draft, setDraft] = useState<ContextPrintOptions>({ ...initialOptions });
  const [dateField, setDateField] = useState<'startDate' | 'endDate' | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);

  useEffect(() => {
    setDateField(null);
    setControlError(null);
    if (!visible) return;
    Keyboard.dismiss();
    setDraft({ ...initialOptions });
  }, [visible, initialOptions]);

  const validation = useMemo(() => {
    try {
      const options = normalizePrintOptions(draft);
      if (!printOptionDates(options).length) throw new Error('Choose at least one day to print.');
      return { options, error: null };
    } catch (error) {
      return { options: null, error: error instanceof Error ? error.message : 'Check the selected dates.' };
    }
  }, [draft]);
  const dateLabel = (day: string) => isDateKey(day)
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parseDateKey(day)) : 'Choose date';
  const choose = <K extends keyof ContextPrintOptions>(key: K, value: ContextPrintOptions[K]) => {
    setControlError(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const choosePeriod = (period: ContextPrintOptions['dashboardPeriod']) => {
    setControlError(null);
    try { setDraft(period === 'custom' ? { ...draft, dashboardPeriod: 'custom' } :
      withDashboardPeriod({ ...draft, endDate: draft.startDate }, period)); }
    catch (error) { setControlError(error instanceof Error ? error.message : 'Check the selected dates.'); }
  };
  const canConfirm = validation.options != null && !controlError && !dateField;
  const confirm = (action: PrintAction) => {
    if (validation.options && canConfirm) onConfirm(action, validation.options);
  };

  function toggle(label: string, key: 'showWeekends' | 'includeStartEndTimes' | 'includeDescriptions') {
    return <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch accessibilityLabel={label} value={draft[key]} onValueChange={(value) => choose(key, value)}
        trackColor={{ false: colors.hairline, true: colors.graphite }} thumbColor={colors.paper} />
    </View>;
  }

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={onDismiss}>
    <View style={[styles.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <Pressable accessible={false} onPress={onClose} style={styles.backdrop} />
      <View accessibilityViewIsModal onAccessibilityEscape={onClose} style={[styles.card,
        { width: Math.min(500, Math.max(240, width - 24)), maxHeight: Math.max(180, height - insets.top - insets.bottom - 24) }]}>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>Print</Text>
          <InfoButton title="Print options" message="Choose a date range of up to 366 days and a layout. The calendar buttons select the start and end dates. Dashboard periods set a date range; changing either date makes it custom. Recorded percentages compare activity categories with recorded minutes. Unrecorded shows empty minutes as a share of the selected period. Save PDF opens your phone’s sharing and save options. Print opens the system print dialog. Your complete saved descriptions are included when descriptions are enabled. Your calendar and minute entries stay unchanged." />
          <Pressable accessibilityRole="button" accessibilityLabel="Close print options" onPress={onClose} style={styles.iconButton}>
            <Text allowFontScaling={false} style={styles.close}>×</Text>
          </Pressable>
        </View>
        <ScrollView bounces={false} contentContainerStyle={styles.content}>
          <View style={styles.dates}>
            {(['startDate', 'endDate'] as const).map((field) => <Pressable key={field} accessibilityRole="button"
              accessibilityLabel={`${field === 'startDate' ? 'Start date' : 'End date'}, ${dateLabel(draft[field])}`}
              onPress={() => setDateField(field)} style={styles.dateButton}>
              <Text style={styles.dateCaption}>{field === 'startDate' ? 'From' : 'To'}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.dateText}>{dateLabel(draft[field])}</Text>
            </Pressable>)}
          </View>
          <Text style={styles.label}>View</Text>
          <View style={styles.choices}>{VIEWS.map((option) => <Pressable key={option.value} accessibilityRole="button"
            accessibilityState={{ selected: draft.view === option.value }} onPress={() => choose('view', option.value)}
            style={[styles.choice, draft.view === option.value && styles.selected]}>
            <Text style={[styles.choiceText, draft.view === option.value && styles.selectedText]}>{option.label}</Text>
          </Pressable>)}</View>
          {draft.view === 'dashboard' ? <>
            <Text style={styles.label}>Period</Text>
            <View style={styles.choices}>{PERIODS.map((option) => <Pressable key={option.value} accessibilityRole="button"
              accessibilityState={{ selected: draft.dashboardPeriod === option.value }}
              onPress={() => choosePeriod(option.value)}
              style={[styles.choice, draft.dashboardPeriod === option.value && styles.selected]}>
              <Text style={[styles.choiceText, draft.dashboardPeriod === option.value && styles.selectedText]}>{option.label}</Text>
            </Pressable>)}</View>
            <Text style={styles.label}>Time</Text>
            <View style={styles.choices}>{(['recorded', 'unrecorded'] as const).map((metric) => <Pressable key={metric}
              accessibilityRole="button" accessibilityState={{ selected: draft.dashboardMetric === metric }}
              onPress={() => choose('dashboardMetric', metric)} style={[styles.choice, draft.dashboardMetric === metric && styles.selected]}>
              <Text style={[styles.choiceText, draft.dashboardMetric === metric && styles.selectedText]}>
                {metric === 'recorded' ? 'Recorded' : 'Unrecorded'}
              </Text>
            </Pressable>)}</View>
          </> : null}
          <Text style={styles.label}>Orientation</Text>
          <View style={styles.choices}>{(['portrait', 'landscape'] as const).map((orientation) => <Pressable key={orientation}
            accessibilityRole="button" accessibilityState={{ selected: draft.orientation === orientation }}
            onPress={() => choose('orientation', orientation)} style={[styles.choice, draft.orientation === orientation && styles.selected]}>
            <Text style={[styles.choiceText, draft.orientation === orientation && styles.selectedText]}>
              {orientation === 'portrait' ? 'Portrait' : 'Landscape'}
            </Text>
          </Pressable>)}</View>
          <Text style={styles.label}>Color</Text>
          <View style={styles.choices}>{COLORS.map((option) => <Pressable key={option.value} accessibilityRole="button"
            accessibilityState={{ selected: draft.colorStyle === option.value }} onPress={() => choose('colorStyle', option.value)}
            style={[styles.choice, draft.colorStyle === option.value && styles.selected]}>
            <Text style={[styles.choiceText, draft.colorStyle === option.value && styles.selectedText]}>{option.label}</Text>
          </Pressable>)}</View>
          {toggle('Show weekends', 'showWeekends')}
          {draft.view === 'schedule' ? <>
            {toggle('Start and end times', 'includeStartEndTimes')}
            {toggle('Descriptions', 'includeDescriptions')}
          </> : null}
          {validation.error || controlError ? <Text accessibilityRole="alert" style={styles.error}>{validation.error ?? controlError}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.action}><Text style={styles.actionText}>Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={!canConfirm} accessibilityState={{ disabled: !canConfirm }}
            onPress={() => confirm('save')} style={[styles.action, !canConfirm && styles.disabled]}>
            <Text style={styles.actionText}>Save PDF</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!canConfirm} accessibilityState={{ disabled: !canConfirm }}
            onPress={() => confirm('print')} style={[styles.action, styles.printAction, !canConfirm && styles.disabled]}>
            <Text style={styles.printActionText}>Print</Text>
          </Pressable>
        </View>
      </View>
      <DateSelectionPopup visible={visible && dateField != null} singleDate
        selectedDates={dateField ? [draft[dateField]] : []} anchorDate={dateField ? draft[dateField] : draft.startDate}
        onClose={() => setDateField(null)} onApply={(dates) => {
          setControlError(null);
          if (dateField && dates[0]) setDraft((current) => ({ ...current, [dateField]: dates[0]!, dashboardPeriod: 'custom' }));
          setDateField(null);
        }} />
    </View>
  </Modal>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  overlay: { flex: 1, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.scrim },
  card: { backgroundColor: colors.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline,
    borderRadius: 16, overflow: 'hidden', flexShrink: 1 },
  heading: { minHeight: 56, paddingLeft: 20, paddingRight: 4, flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, color: colors.ink, fontSize: 20, fontWeight: '600' },
  iconButton: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  close: { color: colors.muted, fontSize: 28 },
  content: { paddingHorizontal: 20, paddingBottom: 16 },
  dates: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dateButton: { flexGrow: 1, flexBasis: 110, minHeight: 60, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 8, justifyContent: 'center' },
  dateCaption: { color: colors.muted, fontSize: 11, marginBottom: 4 },
  dateText: { color: colors.ink, fontSize: 14 },
  label: { color: colors.graphite, fontSize: 13, fontWeight: '600', marginTop: 18, marginBottom: 8 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice: { minWidth: 64, minHeight: 44, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1,
    borderColor: colors.hairline, justifyContent: 'center', alignItems: 'center' },
  selected: { borderColor: colors.graphite, backgroundColor: colors.panel },
  choiceText: { color: colors.muted, fontSize: 13 },
  selectedText: { color: colors.ink, fontWeight: '600' },
  toggleRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleLabel: { flex: 1, color: colors.graphite, fontSize: 14 },
  error: { marginTop: 8, color: colors.ink, fontSize: 13, lineHeight: 19 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4, padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  action: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
  actionText: { color: colors.graphite, fontSize: 14, fontWeight: '500' },
  printAction: { backgroundColor: colors.ink },
  printActionText: { color: colors.paper, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.35 },
});
