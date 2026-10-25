import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../appearance';
import { CATEGORIES } from '../theme';
import type { ActivityCategory, AppColors } from '../theme';
import { listSelectableActivityCategories } from '../services/categories';
import type { MinuteEntry, PlannedEvent } from '../types';
import { formatDayHeading, minuteLabel } from '../utils/time';

const DURATIONS = [
  { minutes: 1, label: '1 min' },
  { minutes: 5, label: '5 min' },
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 360, label: '6 hours' },
] as const;

type Props = {
  visible: boolean;
  dateKey: string;
  minuteIndex: number;
  clockFormat?: '12h' | '24h';
  entry: MinuteEntry | null;
  plan: PlannedEvent | null;
  planDurationMinutes?: number | null;
  onClose: () => void;
  onSave: (text: string, categoryId: string, durationMinutes: number, replacePlan: boolean,
    sourceScope: 'occurrence' | 'series') => Promise<void>;
  onDelete: () => Promise<void>;
  onOpenPlan?: () => Promise<void>;
};

export function MinuteEditor({
  visible,
  dateKey,
  minuteIndex,
  clockFormat = '12h',
  entry,
  plan,
  planDurationMinutes,
  onClose,
  onSave,
  onDelete,
  onOpenPlan,
}: Props) {
  const { colors, resolvedMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState('unaccounted');
  const [durationMinutes, setDurationMinutes] = useState(1);
  const [replacePlan, setReplacePlan] = useState(false);
  const [sourceScope, setSourceScope] = useState<'occurrence' | 'series'>('occurrence');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableCategories, setAvailableCategories] = useState<ActivityCategory[]>([]);
  const [colorPanelOpen, setColorPanelOpen] = useState(false);

  const selectedColor = availableCategories.find((category) => category.id === categoryId)?.color ??
    CATEGORIES.find((category) => category.id === categoryId)?.color ?? '#96938C';

  const initialText = entry?.text ?? plan?.title ?? '';
  const initialCategoryId = entry?.categoryId ?? plan?.categoryId ?? 'unaccounted';
  const initialDurationMinutes =
    !entry && plan && planDurationMinutes ? planDurationMinutes : 1;
  const dirty =
    text !== initialText ||
    categoryId !== initialCategoryId ||
    durationMinutes !== initialDurationMinutes;

  useEffect(() => {
    if (!visible) return;
    setText(initialText);
    setCategoryId(initialCategoryId);
    setDurationMinutes(initialDurationMinutes);
    setReplacePlan(Boolean(plan?.accountEvent && !entry && !plan.accountEvent.event.projectionId));
    setSourceScope('occurrence');
    setColorPanelOpen(false);
    setError(null);
    // Do not reset an open draft when calendar or database data refreshes in the background.
    // Opening the editor, or moving it to another minute, creates a fresh draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, minuteIndex, visible]);

  useEffect(() => {
    if (!visible) return;
    let current = true;
    void listSelectableActivityCategories().then((values) => {
      if (current) setAvailableCategories(values);
    }).catch(() => {
      if (current) setAvailableCategories([]);
    });
    return () => { current = false; };
  }, [visible]);

  function requestClose() {
    if (busy) return;
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert('Discard this draft?', 'Your unsaved changes will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  }

  async function save() {
    if (!text.trim() || busy) return;
    if (replacePlan && (sourceScope === 'series' || plan?.accountEvent?.event.isInvitation)) {
      const confirmed = await new Promise<boolean>((resolve) => Alert.alert(
        sourceScope === 'series' ? 'Change the recurring series?' : 'Update the source invitation?',
        sourceScope === 'series'
          ? 'This changes the recurring plan, including other occurrences. Your provider may notify attendees.'
          : 'This edits the meeting in its source calendar. Your provider may notify attendees.',
        [{ text: 'Keep editing', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Apply source change', onPress: () => resolve(true) }],
        { cancelable: true, onDismiss: () => resolve(false) },
      ));
      if (!confirmed) return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(text, categoryId, durationMinutes, replacePlan, sourceScope);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save this entry. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!entry || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch {
      setError('Could not delete this entry. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={requestClose}
      statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.backdrop, { paddingTop: Math.max(insets.top, 12),
          paddingLeft: insets.left, paddingRight: insets.right }]}
      >
        <Pressable disabled={busy} style={StyleSheet.absoluteFill} onPress={requestClose} />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          stickyHeaderIndices={[1]}
          style={styles.sheet}
          contentContainerStyle={[styles.sheetContent, { paddingBottom: Math.max(insets.bottom, 12) + 20 }]}
        >
          <View style={styles.handle} />
          <View style={styles.toolbar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={busy ? 'Saving entry' : 'Save entry'}
              accessibilityState={{ disabled: busy || !text.trim(), busy }}
              disabled={busy || !text.trim()}
              onPress={save}
              style={[styles.saveButton, (!text.trim() || busy) && styles.disabled]}
            >
              <Text style={styles.saveText}>Save</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close entry"
              disabled={busy}
              onPress={requestClose}
              style={[styles.closeButton, busy && styles.disabled]}
            >
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>
          <View style={styles.headingRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose color"
              accessibilityHint="Opens the color panel"
              accessibilityState={{ expanded: colorPanelOpen, disabled: busy }}
              disabled={busy}
              onPress={() => setColorPanelOpen((open) => !open)}
              style={[styles.colorToggle, busy && styles.disabled]}
            >
              <View style={[styles.currentColor, { backgroundColor: selectedColor }]} />
              <Text maxFontSizeMultiplier={1.4} style={styles.colorHex}>{selectedColor.toUpperCase()}</Text>
            </Pressable>
            <View style={styles.timestamp}>
              <Text style={styles.eyebrow}>{formatDayHeading(dateKey)}</Text>
              <Text style={styles.time}>{minuteLabel(minuteIndex, clockFormat === '12h')}</Text>
            </View>
          </View>

          {colorPanelOpen ? (
            <ScrollView
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              style={styles.colorPanel}
              contentContainerStyle={styles.colorGrid}
              accessibilityLabel="Activity colors"
            >
              {availableCategories.map((category) => {
                  const selected = category.id === categoryId;
                  return (
                    <Pressable
                      key={category.id}
                      accessibilityRole="radio"
                      accessibilityLabel={category.name + ', ' + category.color.toUpperCase()}
                      accessibilityState={{ checked: selected, disabled: busy }}
                      disabled={busy}
                      onPress={() => {
                        setCategoryId(category.id);
                        setColorPanelOpen(false);
                      }}
                      style={[styles.colorChoice, selected && styles.colorChoiceSelected]}
                    >
                      <View style={[styles.colorSwatch, { backgroundColor: category.color }]} />
                      <Text maxFontSizeMultiplier={1.4} style={styles.colorHex}>{category.color.toUpperCase()}</Text>
                    </Pressable>
                  );
                })}
            </ScrollView>
          ) : null}

          {plan && !entry ? (
            <View style={styles.planCard}>
              <View style={[styles.planDot, { backgroundColor: plan.color }]} />
              <View style={styles.planCopy}>
                <Text style={styles.planLabel}>Calendar plan</Text>
                <Text style={styles.planTitle}>{plan.title}</Text>
              </View>
              {onOpenPlan ? (
                <Pressable
                  disabled={busy}
                  onPress={() => void onOpenPlan()}
                  style={styles.openPlanButton}
                >
                  <Text style={styles.openPlanText}>Open</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {replacePlan && plan?.accountEvent?.event.seriesId ? (
            <View style={styles.scopeRow}>
              {(['occurrence', 'series'] as const).map((scope) => (
                <Pressable key={scope} disabled={busy} onPress={() => setSourceScope(scope)}
                  style={[styles.duration, sourceScope === scope && styles.durationSelected]}>
                  <Text style={[styles.durationText, sourceScope === scope && styles.durationTextSelected]}>
                    {scope === 'occurrence' ? 'This occurrence' : 'Recurring series'}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {plan?.accountEvent && !entry && !plan.accountEvent.event.projectionId ? (
            <View style={styles.replaceRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.replaceTitle}>Replace this plan occurrence</Text>
                <Text style={styles.hint}>Uses your account permission to update this activity’s actual times.</Text>
              </View>
              <Switch value={replacePlan} disabled={busy} onValueChange={setReplacePlan}
                trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }} thumbColor={colors.switchThumb} />
            </View>
          ) : null}

          <TextInput
            keyboardAppearance={resolvedMode}
            autoFocus
            editable={!busy}
            multiline
            value={text}
            onChangeText={setText}
            placeholder="What is happening right now?"
            placeholderTextColor={colors.muted}
            style={styles.input}
            selectionColor={colors.graphite}
            textAlignVertical="top"
          />
          <Text style={styles.sectionLabel}>Duration</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.durations}
          >
            {!entry && plan && planDurationMinutes ? (
              <Pressable
                disabled={busy}
                onPress={() => setDurationMinutes(planDurationMinutes)}
                style={[
                  styles.duration,
                  styles.planDuration,
                  durationMinutes === planDurationMinutes && styles.durationSelected,
                ]}
              >
                <Text
                  style={[
                    styles.durationText,
                    durationMinutes === planDurationMinutes && styles.durationTextSelected,
                  ]}
                >
                  Use plan · {planDurationMinutes} min
                </Text>
              </Pressable>
            ) : null}
            {DURATIONS.map((duration) => {
              const selected = duration.minutes === durationMinutes;
              return (
                <Pressable
                  disabled={busy}
                  key={duration.minutes}
                  onPress={() => setDurationMinutes(duration.minutes)}
                  style={[styles.duration, selected && styles.durationSelected]}
                >
                  <Text style={[styles.durationText, selected && styles.durationTextSelected]}>
                    {duration.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Text style={styles.hint}>
            Fills consecutive minute rows and can continue into the next day.
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {entry ? (
            <Pressable disabled={busy} onPress={remove} style={styles.deleteButton}>
              <Text style={styles.deleteText}>Delete</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
  sheet: {
    maxHeight: '100%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.paper,
  },
  sheetContent: { paddingTop: 10, paddingHorizontal: 20, paddingBottom: 28 },
  handle: {
    width: 42,
    height: 4,
    alignSelf: 'center',
    marginBottom: 10,
    borderRadius: 2,
    backgroundColor: colors.silver,
  },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.paper },
  headingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  timestamp: { flex: 1, marginLeft: 12 },
  eyebrow: { color: colors.muted, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' },
  time: { marginTop: 3, color: colors.ink, fontSize: 28, fontWeight: '600' },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  close: { color: colors.muted, fontSize: 30, lineHeight: 34, fontWeight: '400' },
  colorToggle: { width: 72, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  currentColor: { width: 32, height: 32, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.swatchBorder },
  colorPanel: { maxHeight: 184, marginTop: 12, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline, borderRadius: 14, backgroundColor: colors.surface },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  colorChoice: { width: 72, height: 60, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent', borderRadius: 8 },
  colorChoiceSelected: { borderColor: colors.graphite },
  colorSwatch: { width: 30, height: 30, borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.swatchBorder },
  colorHex: { color: colors.graphite, fontSize: 10, marginTop: 4 },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: 12,
    backgroundColor: colors.panel,
  },
  planDot: { width: 8, height: 32, borderRadius: 4, marginRight: 12 },
  planCopy: { flex: 1 },
  planLabel: { color: colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  planTitle: { marginTop: 2, color: colors.ink, fontSize: 15, fontWeight: '600' },
  replaceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 15 },
  replaceTitle: { color: colors.graphite, fontSize: 13, fontWeight: '600' },
  scopeRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  openPlanButton: {
    marginLeft: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  openPlanText: { color: colors.graphite, fontSize: 12, fontWeight: '700' },
  input: {
    minHeight: 130,
    maxHeight: 240,
    marginTop: 18,
    padding: 15,
    borderWidth: 1,
    borderColor: colors.silver,
    borderRadius: 14,
    color: colors.ink,
    backgroundColor: colors.surface,
    fontSize: 17,
    lineHeight: 24,
  },
  hint: { marginTop: 7, color: colors.muted, fontSize: 12 },
  sectionLabel: {
    marginTop: 20,
    marginBottom: 10,
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  durations: { gap: 8, paddingRight: 20 },
  duration: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  durationSelected: { borderColor: colors.graphite, backgroundColor: colors.accent },
  planDuration: { borderColor: colors.silver },
  durationText: { color: colors.muted, fontSize: 13 },
  durationTextSelected: { color: colors.onAccent, fontWeight: '700' },
  error: { marginTop: 14, color: colors.danger, fontSize: 13 },
  deleteButton: { alignSelf: 'flex-start', marginTop: 24, paddingVertical: 12, paddingRight: 18 },
  deleteText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  saveButton: {
    minWidth: 72,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  saveText: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});
