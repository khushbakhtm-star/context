import { useEffect, useState } from 'react';
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

import { CATEGORIES, colors } from '../theme';
import type { ActivityCategory } from '../theme';
import { listCategories } from '../services/categories';
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
  entry,
  plan,
  planDurationMinutes,
  onClose,
  onSave,
  onDelete,
  onOpenPlan,
}: Props) {
  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState('unaccounted');
  const [durationMinutes, setDurationMinutes] = useState(1);
  const [replacePlan, setReplacePlan] = useState(false);
  const [sourceScope, setSourceScope] = useState<'occurrence' | 'series'>('occurrence');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableCategories, setAvailableCategories] = useState<ActivityCategory[]>(CATEGORIES);
  const [categorySearch, setCategorySearch] = useState('');

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
    setCategorySearch('');
    setError(null);
    // Do not reset an open draft when calendar or database data refreshes in the background.
    // Opening the editor, or moving it to another minute, creates a fresh draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, minuteIndex, visible]);

  useEffect(() => {
    if (!visible) return;
    let current = true;
    void listCategories().then((values) => {
      if (current) setAvailableCategories(values);
    }).catch(() => {
      if (current) setAvailableCategories([...CATEGORIES]);
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={requestClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <Pressable disabled={busy} style={StyleSheet.absoluteFill} onPress={requestClose} />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={styles.sheet}
          contentContainerStyle={styles.sheetContent}
        >
          <View style={styles.handle} />
          <View style={styles.headingRow}>
            <View>
              <Text style={styles.eyebrow}>{formatDayHeading(dateKey)}</Text>
              <Text style={styles.time}>{minuteLabel(minuteIndex, true)}</Text>
            </View>
            <Pressable disabled={busy} hitSlop={12} onPress={requestClose}>
              <Text style={[styles.close, busy && styles.disabled]}>Close</Text>
            </Pressable>
          </View>

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
                trackColor={{ false: '#D5D2CB', true: '#7A8079' }} thumbColor={colors.white} />
            </View>
          ) : null}

          <TextInput
            autoFocus
            editable={!busy}
            multiline
            value={text}
            onChangeText={setText}
            placeholder="What is happening right now?"
            placeholderTextColor="#96938C"
            style={styles.input}
            selectionColor={colors.graphite}
            textAlignVertical="top"
          />
          <Text style={styles.hint}>Type or use the microphone on your phone keyboard.</Text>

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

          <Text style={styles.sectionLabel}>Category</Text>
          {availableCategories.length > 12 ? (
            <TextInput value={categorySearch} onChangeText={setCategorySearch} editable={!busy}
              placeholder="Find a category" placeholderTextColor={colors.muted}
              accessibilityLabel="Find an activity category" style={styles.categorySearch} />
          ) : null}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categories}
          >
            {availableCategories.filter((category) => (!category.archived || category.id === categoryId) &&
              category.name.toLowerCase().includes(categorySearch.toLowerCase())).map((category) => {
              const selected = category.id === categoryId;
              return (
                <Pressable
                  disabled={busy}
                  key={category.id}
                  onPress={() => setCategoryId(category.id)}
                  style={[
                    styles.category,
                    selected && { borderColor: category.color, backgroundColor: `${category.color}18` },
                  ]}
                >
                  <View style={[styles.categoryDot, { backgroundColor: category.color }]} />
                  <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>
                    {category.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            {entry ? (
              <Pressable disabled={busy} onPress={remove} style={styles.deleteButton}>
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Pressable
              disabled={busy || !text.trim()}
              onPress={save}
              style={[styles.saveButton, (!text.trim() || busy) && styles.disabled]}
            >
              <Text style={styles.saveText}>
                {busy
                  ? 'Saving…'
                  : durationMinutes === 1
                    ? 'Save minute'
                    : `Save ${durationMinutes} minutes`}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.paper,
  },
  sheetContent: { paddingTop: 10, paddingHorizontal: 20, paddingBottom: 28 },
  handle: {
    width: 42,
    height: 4,
    alignSelf: 'center',
    marginBottom: 20,
    borderRadius: 2,
    backgroundColor: colors.silver,
  },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  eyebrow: { color: colors.muted, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' },
  time: { marginTop: 3, color: colors.ink, fontSize: 28, fontWeight: '600' },
  close: { color: colors.muted, fontSize: 14, fontWeight: '600' },
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
    backgroundColor: colors.white,
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
    backgroundColor: colors.white,
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
  categories: { gap: 8, paddingRight: 20 },
  categorySearch: { padding: 11, marginBottom: 10, borderWidth: 1, borderColor: colors.hairline,
    borderRadius: 10, backgroundColor: colors.white, color: colors.ink, fontSize: 13 },
  durations: { gap: 8, paddingRight: 20 },
  duration: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 18,
    backgroundColor: colors.white,
  },
  durationSelected: { borderColor: colors.graphite, backgroundColor: colors.graphite },
  planDuration: { borderColor: colors.silver },
  durationText: { color: colors.muted, fontSize: 13 },
  durationTextSelected: { color: colors.white, fontWeight: '700' },
  category: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 18,
    backgroundColor: colors.white,
  },
  categoryDot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  categoryText: { color: colors.muted, fontSize: 13 },
  categoryTextSelected: { color: colors.ink, fontWeight: '600' },
  error: { marginTop: 14, color: colors.danger, fontSize: 13 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
  },
  deleteButton: { paddingVertical: 12, paddingRight: 18 },
  deleteText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  saveButton: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.ink,
  },
  saveText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});
