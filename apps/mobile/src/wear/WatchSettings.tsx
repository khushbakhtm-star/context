import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';
import { formatDayHeading, minuteLabel } from '../utils/time';
import { drainWearInbox, getWearState, refreshWearStatus, resolveWearConflict, setWearEnabled,
  subscribeWearState, type WearConflict } from './service';

export function WatchSettings() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [state, setState] = useState(getWearState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<WearConflict | null>(null);
  useEffect(() => subscribeWearState(() => setState(getWearState())), []);
  useEffect(() => { void refreshWearStatus().catch(() => {}); }, []);
  if (Platform.OS !== 'android') return null;
  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Watch synchronization is waiting.'); }
    finally { setBusy(false); }
  }
  async function resolve(choice: 'watch' | 'append' | 'phone') {
    if (!review) return;
    const snapshot = review;
    await run(async () => {
      try { await resolveWearConflict(snapshot.operationId, choice, snapshot.phone.version); setReview(null); }
      catch (failure) { setReview(null); await refreshWearStatus(); throw failure; }
    });
  }
  return <View style={styles.card}>
    <View style={styles.heading}>
      <Text style={styles.title}>Paired watch</Text>
      {state.available ? <Switch accessibilityLabel="Allow paired watch access to Context"
        value={state.enabled} disabled={busy} onValueChange={(enabled) => void run(() => setWearEnabled(enabled))}
        trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }} thumbColor={colors.switchThumb} /> : null}
    </View>
    <Text style={styles.body}>{state.available
      ? 'Allow a paired Wear OS watch to read requested days and record minute notes. This starts off. Keep Context open on the phone to synchronize; notes remain saved on the watch while waiting.'
      : 'Watch connection is available in the Wear-enabled Android edition of Context.'}</Text>
    {state.available ? <>
      <Text style={styles.body}>{state.enabled
        ? `${state.connectedNodeCount ? 'Paired watch connected' : 'Waiting for the paired watch'} · ${state.pendingCount} in the phone inbox`
        : 'Watch access is off.'}</Text>
      <Pressable accessibilityRole="button" disabled={busy || state.running || !state.enabled}
        onPress={() => void run(async () => { await drainWearInbox(); await refreshWearStatus(); })} style={styles.button}>
        <Text style={styles.buttonText}>{state.running ? 'Synchronizing…' : 'Sync watch now'}</Text>
      </Pressable>
      {error || state.error ? <Text accessibilityRole="alert" style={styles.error}>{error ?? state.error}</Text> : null}
      {state.conflicts.length ? <Text style={styles.reviewTitle}>Notes to review</Text> : null}
      {state.conflicts.map((item) => <Pressable key={item.operationId} accessibilityRole="button"
        accessibilityLabel={'Review watch note, ' + formatDayHeading(item.dateKey) + ', ' + minuteLabel(item.minuteIndex, true)}
        onPress={() => setReview(item)} style={styles.conflict}>
        <Text style={styles.buttonText}>{formatDayHeading(item.dateKey)} · {minuteLabel(item.minuteIndex, true)}</Text>
        <Text numberOfLines={2} style={styles.body}>{item.watchText || 'Blank watch note'}</Text>
        <Text style={styles.link}>Review both notes</Text>
      </Pressable>)}
    </> : null}
    <Modal visible={Boolean(review)} animationType="slide" onRequestClose={() => setReview(null)}>
      <SafeAreaView style={styles.review}>
        <View style={styles.heading}><Text style={styles.title}>Review watch note</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close watch note review" onPress={() => setReview(null)} style={styles.button}>
            <Text style={styles.buttonText}>×</Text>
          </Pressable></View>
        {review ? <>
          <Text style={styles.body}>{formatDayHeading(review.dateKey)} · {minuteLabel(review.minuteIndex, true)}</Text>
          <ScrollView style={styles.notes}>
            <Text style={styles.reviewTitle}>Phone note</Text><Text selectable style={styles.note}>{review.phone.text || 'Blank'}</Text>
            <Text style={styles.reviewTitle}>Watch note</Text><Text selectable style={styles.note}>{review.watchText || 'Blank'}</Text>
          </ScrollView>
          <Text style={styles.body}>Choose the note to keep, or append the watch note to the phone note. A newer phone edit requires another review.</Text>
          {(['phone', 'append', 'watch'] as const).map((choice) => <Pressable key={choice} accessibilityRole="button"
            disabled={busy || !state.enabled} onPress={() => void resolve(choice)} style={styles.button}>
            <Text style={styles.buttonText}>{choice === 'phone' ? 'Keep phone note' : choice === 'append' ? 'Append watch note' : 'Use watch note'}</Text>
          </Pressable>)}
        </> : null}
      </SafeAreaView>
    </Modal>
  </View>;
}
const createStyles = (colors: AppColors) => StyleSheet.create({
  card: { marginTop: 20, padding: 16, backgroundColor: colors.panel, borderColor: colors.hairline, borderWidth: 1, borderRadius: 14 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: colors.ink, fontSize: 18, fontWeight: '600', flex: 1 },
  body: { marginTop: 8, color: colors.muted, fontSize: 13, lineHeight: 20 },
  button: { padding: 12, marginTop: 10, minHeight: 44, borderWidth: 1, borderColor: colors.hairline, borderRadius: 8 },
  buttonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 13, lineHeight: 20, marginTop: 10 },
  conflict: { marginTop: 12, borderTopWidth: 1, borderColor: colors.hairline, paddingTop: 12 },
  reviewTitle: { color: colors.ink, fontSize: 15, fontWeight: '600', marginTop: 18 },
  link: { color: colors.ink, fontSize: 13, marginTop: 8 },
  review: { flex: 1, padding: 18, backgroundColor: colors.paper },
  notes: { flex: 1, marginVertical: 10 },
  note: { color: colors.ink, fontSize: 15, lineHeight: 22, marginTop: 8 },
});
