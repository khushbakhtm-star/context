import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../appearance';
import type { ActivityCategory, AppColors } from '../theme';
import type { MinuteSpan, MinuteSpanFillInput } from '../services/spreadsheet';
import { minuteDetailsCount, minuteDetailsDate, minuteDetailsLastCell, minuteDetailsSpan, minuteDetailsTitle } from '../utils/minute-details';
import { minuteLabel } from '../utils/time';
import { DateSelectionPopup } from './DateSelectionPopup';
import { CellColorPalette } from './CellColorPalette';
import { InfoButton } from './InfoButton';

export type MinuteSpanEditorSession = { id: number; span: MinuteSpan; text?: string; categoryId: string;
  event?: { title: string; categoryId: string; blockId?: string } };

export function MinuteSpanEditor({ session, clockFormat, colorChoices, onClose, onSave }: {
  session: MinuteSpanEditorSession | null; clockFormat: '12h' | '24h'; colorChoices: readonly ActivityCategory[];
  onClose: () => void; onSave: (span: MinuteSpan, input: MinuteSpanFillInput) => Promise<boolean>;
}) {
  const { colors } = useAppTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets(); const mounted = useRef(true); const sequence = useRef(0); const busyRef = useRef(false);
  const [text, setText] = useState(''), [textEdited, setTextEdited] = useState(false);
  const [startDate, setStartDate] = useState(''), [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState(''), [endTime, setEndTime] = useState('');
  const [endDateExplicit, setEndDateExplicit] = useState(false), [group, setGroup] = useState(false);
  const [title, setTitle] = useState(''), [titleEdited, setTitleEdited] = useState(false), [categoryId, setCategoryId] = useState('unaccounted');
  const [palette, setPalette] = useState(false), [dateField, setDateField] = useState<'start' | 'end' | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);
  useEffect(() => {
    sequence.current++; busyRef.current = false; setBusy(false); setError(null); setPalette(false); setDateField(null);
    if (!session) return;
    const last = minuteDetailsLastCell(session.span);
    setText(session.text ?? ''); setTextEdited(false); setStartDate(session.span.startDateKey); setEndDate(last.dateKey);
    setStartTime(minuteLabel(session.span.startMinute, clockFormat === '12h')); setEndTime(minuteLabel(last.minuteIndex, clockFormat === '12h'));
    setEndDateExplicit(Boolean(session.event?.blockId)); setGroup(Boolean(session.event));
    setTitle(session.event?.title ?? minuteDetailsTitle(session.text ?? '')); setTitleEdited(Boolean(session.event));
    setCategoryId(session.event?.categoryId ?? session.categoryId);
    // A provider refresh or a clock-format preference update must not reset an open form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);
  const parsed = useMemo(() => {
    try { const span = minuteDetailsSpan({ startDateKey: startDate, startTime, endDateKey: endDate, endTime, endDateExplicit });
      return { span, count: minuteDetailsCount(span), error: null }; }
    catch (failure) { return { span: null, count: 0, error: failure instanceof Error ? failure.message : 'Choose a valid time range.' }; }
  }, [startDate, startTime, endDate, endTime, endDateExplicit]);
  const throughDate = parsed.span ? minuteDetailsLastCell(parsed.span).dateKey : endDate;
  const selectedColor = colorChoices.find((value) => value.id === categoryId);
  const canSave = Boolean(parsed.span && (!group || title.trim()) && !busy && !dateField);
  const close = () => { if (!busyRef.current) onClose(); };
  async function save() {
    if (!session || busyRef.current || !canSave || !parsed.span) return;
    const ticket = ++sequence.current; busyRef.current = true; setBusy(true); setError(null); Keyboard.dismiss();
    const input: MinuteSpanFillInput = { ...((textEdited || session.text !== undefined) ? { text } : {}),
      ...(group ? { event: { title: title.trim(), categoryId, ...(session.event?.blockId ? { blockId: session.event.blockId } : {}) } } : {}) };
    try { const applied = await onSave(parsed.span, input); if (mounted.current && ticket === sequence.current && applied) onClose(); }
    catch (failure) { if (mounted.current && ticket === sequence.current) setError(failure instanceof Error ? failure.message : 'This range could not be saved.'); }
    finally { if (mounted.current && ticket === sequence.current) { busyRef.current = false; setBusy(false); } }
  }
  return <Modal visible={Boolean(session)} transparent animationType="fade" onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <View accessibilityViewIsModal onAccessibilityEscape={close} style={styles.card}>
        <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>Edit minutes</Text>
          <InfoButton title="Edit minutes" message="Through includes the whole final minute: 07:24 fills the 07:24 cell, and the calendar event ends at 07:25. An earlier Through time suggests the following day until you choose a date. Text fills each included minute. Untouched mixed notes stay unchanged; explicitly clearing Text clears the notes. Editing an event replaces its old repeated fill and border; distinct notes outside the new bounds remain private without the old fill. Group as event adds one named border. Text-only edits keep existing colors and borders. Confirmed changes can be undone together." />
        </View>
        <ScrollView keyboardShouldPersistTaps="always" style={styles.scroll} contentContainerStyle={styles.content}>
          <Text style={styles.label}>Text</Text>
          <TextInput accessibilityLabel="Text for selected minutes" editable={!busy} multiline maxLength={50000}
            placeholder={session?.text === undefined ? 'Mixed notes' : 'Record'} placeholderTextColor={colors.muted}
            value={text} onChangeText={(value) => { setText(value); setTextEdited(true); if (!titleEdited) setTitle(minuteDetailsTitle(value)); }} style={styles.text} />
          <Text style={styles.label}>Start</Text><View style={styles.row}>
            <Pressable accessibilityRole="button" accessibilityLabel="Choose start date" disabled={busy}
              onPress={() => { Keyboard.dismiss(); setDateField('start'); }} style={styles.date}><Text style={styles.value}>{minuteDetailsDate(startDate)}</Text></Pressable>
            <TextInput accessibilityLabel="Start time" editable={!busy} value={startTime} onChangeText={setStartTime}
              autoCapitalize="characters" maxLength={12} style={styles.time} />
          </View>
          <Text style={styles.label}>Through</Text><View style={styles.row}>
            <Pressable accessibilityRole="button" accessibilityLabel="Choose end date" disabled={busy}
              onPress={() => { Keyboard.dismiss(); setDateField('end'); }} style={styles.date}><Text style={styles.value}>{minuteDetailsDate(throughDate)}</Text></Pressable>
            <TextInput accessibilityLabel="End time" editable={!busy} value={endTime} onChangeText={setEndTime}
              autoCapitalize="characters" maxLength={12} style={styles.time} />
          </View>
          <View style={styles.row}><Text style={[styles.label, { flex: 1 }]}>Group as event</Text>
            <Switch accessibilityLabel="Group as event" disabled={busy || Boolean(session?.event?.blockId)} value={group} onValueChange={setGroup} />
          </View>
          {group ? <><TextInput accessibilityLabel="Event title" editable={!busy} value={title} maxLength={200}
            placeholder="Event title" placeholderTextColor={colors.muted} onChangeText={(value) => { setTitle(value); setTitleEdited(true); }} style={styles.field} />
            <Pressable accessibilityRole="button" accessibilityLabel="Choose event color" disabled={busy}
              onPress={() => { Keyboard.dismiss(); setPalette((value) => !value); }} style={styles.colorButton}>
              <View style={[styles.swatch, { backgroundColor: selectedColor?.color ?? '#96938C' }]} /><Text style={styles.value}>Color</Text>
            </Pressable>
            {palette ? <CellColorPalette mode="cell" busy={busy} colorChoices={colorChoices} selectedColorId={categoryId} textColor={colors.ink}
              onTextColor={() => {}} onCellColor={(id) => { setCategoryId(id); setPalette(false); }} onClose={() => setPalette(false)} /> : null}</> : null}
          {parsed.count ? <Text style={styles.count}>{parsed.count} {parsed.count === 1 ? 'minute' : 'minutes'}</Text> : null}
          {error || parsed.error ? <Text accessibilityRole="alert" style={styles.error}>{error ?? parsed.error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}><Pressable accessibilityRole="button" accessibilityLabel="Cancel minute details" disabled={busy} onPress={close} style={styles.action}>
          <Text style={styles.value}>Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Save minute range" accessibilityState={{ disabled: !canSave, busy }} disabled={!canSave}
            onPress={() => void save()} style={[styles.action, !canSave && styles.disabled]}><Text style={styles.value}>{busy ? 'Saving…' : 'Save'}</Text></Pressable></View>
      </View>
      <DateSelectionPopup visible={Boolean(session && dateField)} singleDate selectedDates={[dateField === 'start' ? startDate : throughDate]}
        anchorDate={dateField === 'start' ? startDate : throughDate} onClose={() => setDateField(null)}
        onApply={(values) => { if (values[0] && dateField === 'start') setStartDate(values[0]);
          if (values[0] && dateField === 'end') { setEndDate(values[0]); setEndDateExplicit(true); } setDateField(null); }} />
    </KeyboardAvoidingView>
  </Modal>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  overlay: { flex: 1, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: '#00000080' },
  card: { width: '100%', maxWidth: 520, maxHeight: '100%', flexShrink: 1, backgroundColor: colors.paper, borderRadius: 18, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  heading: { minHeight: 50, paddingLeft: 18, paddingRight: 5, flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.ink }, scroll: { flexShrink: 1 }, content: { paddingHorizontal: 18, paddingBottom: 12, gap: 8 },
  label: { color: colors.muted, fontSize: 13 }, value: { color: colors.ink, fontSize: 15 },
  text: { minHeight: 72, maxHeight: 180, padding: 10, color: colors.ink, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 8, textAlignVertical: 'top' },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  date: { flex: 1, minHeight: 44, padding: 10, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 8 },
  time: { width: 112, minHeight: 44, padding: 10, color: colors.ink, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 8 },
  field: { minHeight: 44, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 8, color: colors.ink },
  colorButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }, swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.swatchBorder },
  count: { color: colors.muted, fontSize: 12 }, error: { color: colors.danger, fontSize: 13 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', padding: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  action: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' }, disabled: { opacity: 0.4 },
});
