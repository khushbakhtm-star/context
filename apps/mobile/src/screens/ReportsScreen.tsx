import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppTheme } from '../appearance';
import { InfoButton } from '../components/InfoButton';
import { getDashboardSummary, type DashboardMetric, type DashboardSummary } from '../services/dashboard';
import { formatRecordedDuration, moveReportPeriod, type ReportPeriod } from '../services/reports';
import type { AppColors } from '../theme';
import { dashboardPeriodDates, dashboardTimeBuckets, formatDashboardPercent } from '../utils/dashboard';
import { isDateKey } from '../utils/date-selection';
import { dateKey, formatCompactDate, parseDateKey } from '../utils/time';

type Props = { dataVersion: number; initialDate?: string; metric?: DashboardMetric; onMetricChange?: (metric: DashboardMetric) => void };
const PERIODS: ReportPeriod[] = ['day', 'week', 'month', 'year'];

export function ReportsScreen({ dataVersion, initialDate, metric: controlledMetric, onMetricChange }: Props) {
  const { colors, resolvedMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [anchor, setAnchor] = useState(() => isDateKey(initialDate) ? initialDate : dateKey(new Date()));
  const [dateInput, setDateInput] = useState(anchor);
  const [period, setPeriod] = useState<ReportPeriod>('day');
  const [localMetric, setLocalMetric] = useState<DashboardMetric>('recorded');
  const metric = controlledMetric ?? localMetric;
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const dates = useMemo(() => dashboardPeriodDates(anchor, period), [anchor, period]);
  const datesKey = dates.join('|');
  const previous = moveReportPeriod(anchor, period, -1);
  const next = moveReportPeriod(anchor, period, 1);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setBusy(true); setError(null);
    void getDashboardSummary(dates, { signal: controller.signal }).then((value) => {
      if (active) setSummary(value);
    }).catch((failure) => {
      if (active && !controller.signal.aborted) {
        setSummary(null); setError(failure instanceof Error ? failure.message : 'The Dashboard could not load.');
      }
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [datesKey, dataVersion, retry]);

  const categoryOptions = useMemo(() => summary?.availableCategories.filter((category) =>
    category.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [], [summary, search]);
  const selectedCategory = summary?.availableCategories.find((category) => category.id === categoryId);
  const selectedMetric = summary?.categories.find((category) => category.categoryId === categoryId);
  const total = metric === 'unrecorded' ? summary?.unrecordedMinutes ?? 0 :
    categoryId ? selectedMetric?.minutes ?? 0 : summary?.recordedMinutes ?? 0;
  const percentage = metric === 'unrecorded' ? (summary?.periodMinutes ? total * 100 / summary.periodMinutes : 0) :
    (summary?.recordedMinutes ? total * 100 / summary.recordedMinutes : 0);
  const breakdown = summary?.categories.filter((category) => !categoryId || category.categoryId === categoryId) ?? [];
  const buckets = useMemo(() => summary ? dashboardTimeBuckets(summary, period, metric, categoryId) : [],
    [summary, period, metric, categoryId]);
  const selectedName = selectedCategory?.name ?? (categoryId ? `Other recorded activity (${categoryId})` : 'All recorded activities');

  function changeMetric(value: DashboardMetric) { setLocalMetric(value); onMetricChange?.(value); }
  function move(target: string) { if (isDateKey(target)) { setAnchor(target); setDateInput(target); } }
  function useDate() {
    if (!isDateKey(dateInput)) { setError('Choose a real date in YYYY-MM-DD format.'); return; }
    setAnchor(dateInput); setError(null);
  }
  const rangeDate = (day: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(parseDateKey(day));
  const bucketLabel = (day: string) => period === 'year'
    ? new Intl.DateTimeFormat(undefined, { month: 'long' }).format(parseDateKey(day)) : formatCompactDate(day);

  return <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>Activity time</Text>
      <InfoButton title="Dashboard" message="Recorded counts actual minute cells, including imported actuals, colored blank cells and blank minutes inside a group. Calendar plans are excluded. Recorded percentages compare an activity with all recorded activity time. Unrecorded shows the remaining minute cells as a percentage of the whole selected period, including future dates. Every civil day has 1,440 minute cells; weeks run Monday through Sunday. Archived activities remain in your history." />
    </View>
    <View style={styles.metricOptions}>{(['recorded', 'unrecorded'] as const).map((value) =>
      <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: metric === value }} onPress={() => changeMetric(value)}
        style={[styles.metric, metric === value && styles.periodSelected]}>
        <Text style={[styles.periodText, metric === value && styles.periodTextSelected]}>{value === 'recorded' ? 'Recorded' : 'Unrecorded'}</Text>
      </Pressable>)}</View>
    <View style={styles.periods}>{PERIODS.map((value) => <Pressable key={value} accessibilityRole="button"
      accessibilityState={{ selected: period === value }} onPress={() => setPeriod(value)} style={[styles.period, period === value && styles.periodSelected]}>
      <Text style={[styles.periodText, period === value && styles.periodTextSelected]}>{value[0]!.toUpperCase() + value.slice(1)}</Text>
    </Pressable>)}</View>
    <View style={styles.rangeRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Previous ${period}`} disabled={!isDateKey(previous)}
        onPress={() => move(previous)} style={[styles.arrow, !isDateKey(previous) && styles.disabled]}><Text allowFontScaling={false} style={styles.arrowText}>‹</Text></Pressable>
      <View style={styles.rangeCopy}><Text style={styles.rangeTitle}>{rangeDate(dates[0]!)}</Text>
        {dates.length > 1 ? <Text style={styles.rangeEnd}>– {rangeDate(dates.at(-1)!)}</Text> : null}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Next ${period}`} disabled={!isDateKey(next)}
        onPress={() => move(next)} style={[styles.arrow, !isDateKey(next) && styles.disabled]}><Text allowFontScaling={false} style={styles.arrowText}>›</Text></Pressable>
    </View>
    <View style={styles.dateRow}><TextInput keyboardAppearance={resolvedMode} value={dateInput} onChangeText={setDateInput} maxLength={10}
      accessibilityLabel="Dashboard date YYYY-MM-DD" placeholder="YYYY-MM-DD" autoCapitalize="none" autoCorrect={false}
      placeholderTextColor={colors.muted} style={[styles.input, styles.dateInput]} returnKeyType="go" onSubmitEditing={useDate} />
      <Pressable accessibilityRole="button" onPress={useDate} style={styles.dateButton}><Text style={styles.dateButtonText}>Go to date</Text></Pressable>
    </View>
    {metric === 'recorded' ? <>
      <TextInput keyboardAppearance={resolvedMode} accessibilityLabel="Find an activity" value={search} onChangeText={setSearch}
        placeholder="Find an activity" placeholderTextColor={colors.muted} style={styles.input} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryOptions}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: categoryId === null }} onPress={() => setCategoryId(null)}
          style={[styles.chip, categoryId === null && styles.selectedChip]}>
          <Text style={[styles.chipText, categoryId === null && styles.selectedChipText]}>All activities</Text>
        </Pressable>
        {categoryOptions.map((category) => <Pressable key={category.id} accessibilityRole="button"
          accessibilityState={{ selected: categoryId === category.id }} onPress={() => setCategoryId(category.id)}
          style={[styles.chip, categoryId === category.id && { borderColor: category.color, backgroundColor: `${category.color}20` }]}>
          <View style={[styles.dot, { backgroundColor: category.color }]} /><Text style={styles.chipText}>{category.name}</Text>
        </Pressable>)}
      </ScrollView>
    </> : null}
    <View style={styles.totalCard}>
      <Text style={styles.totalLabel}>{metric === 'unrecorded' ? 'Unrecorded minutes' : selectedName}</Text>
      {busy ? <ActivityIndicator color={colors.onAccent} style={styles.spinner} /> : <>
        <Text style={styles.total}>{formatRecordedDuration(total)}</Text>
        <Text style={styles.totalMeta}>{total.toLocaleString()} minutes · {formatDashboardPercent(percentage)} {metric === 'unrecorded' ? 'of period' : 'of recorded time'}</Text>
      </>}
    </View>
    {error ? <View style={styles.errorRow}><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable>
    </View> : null}
    {!busy && summary ? <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>{metric === 'unrecorded' ? 'Unrecorded time' : 'Activities'}</Text>
      {metric === 'recorded' && !breakdown.length ? <Text style={styles.empty}>No recorded minutes</Text> : null}
      {metric === 'recorded' ? breakdown.map((category) => <View key={category.categoryId} style={styles.chartRow}
        accessible accessibilityLabel={`${category.name}, ${category.minutes} minutes, ${formatRecordedDuration(category.minutes)}, ${formatDashboardPercent(category.recordedPercent)} of recorded time`}>
        <View style={styles.chartHeading}><Text style={styles.rowLabel}>{category.name}</Text>
          <Text style={styles.rowValue}>{formatRecordedDuration(category.minutes)} · {formatDashboardPercent(category.recordedPercent)}</Text></View>
        <View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.min(100, category.recordedPercent)}%`, backgroundColor: category.color }]} /></View>
        <Text style={styles.minuteValue}>{category.minutes.toLocaleString()} minutes</Text>
      </View>) : buckets.map((bucket) => <View key={bucket.key} style={styles.chartRow} accessible
        accessibilityLabel={`${bucketLabel(bucket.startDate)}, ${bucket.minutes} unrecorded minutes, ${formatDashboardPercent(bucket.percent)} of period`}>
        <View style={styles.chartHeading}><Text style={styles.rowLabel}>{bucketLabel(bucket.startDate)}</Text>
          <Text style={styles.rowValue}>{formatRecordedDuration(bucket.minutes)} · {formatDashboardPercent(bucket.percent)}</Text></View>
        <View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.min(100, bucket.percent)}%`, backgroundColor: colors.muted }]} /></View>
        <Text style={styles.minuteValue}>{bucket.minutes.toLocaleString()} minutes</Text>
      </View>)}
    </View> : null}
    {!busy && summary && metric === 'recorded' && categoryId && period !== 'day' ? <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>{period === 'year' ? 'By month' : 'By day'}</Text>
      {buckets.map((bucket) => <View key={bucket.key} style={styles.chartRow}>
        <View style={styles.chartHeading}><Text style={styles.rowLabel}>{bucketLabel(bucket.startDate)}</Text>
          <Text style={styles.rowValue}>{formatRecordedDuration(bucket.minutes)}</Text></View>
        <View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.min(100, bucket.percent)}%`, backgroundColor: selectedCategory?.color ?? colors.muted }]} /></View>
        <Text style={styles.minuteValue}>{bucket.minutes.toLocaleString()} minutes · {formatDashboardPercent(bucket.percent)} of recorded time</Text>
      </View>)}
    </View> : null}
  </ScrollView>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper }, content: { padding: 20, paddingBottom: 40 },
  heading: { flexDirection: 'row', alignItems: 'center' }, title: { flex: 1, color: colors.ink, fontSize: 25, fontWeight: '600' },
  metricOptions: { flexDirection: 'row', marginTop: 14, gap: 8 },
  metric: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
    borderWidth: 1, borderColor: colors.hairline, borderRadius: 10, backgroundColor: colors.surface },
  periods: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 },
  period: { flex: 1, minHeight: 44, minWidth: 58, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
    borderWidth: 1, borderColor: colors.hairline, borderRadius: 10, backgroundColor: colors.surface },
  periodSelected: { borderColor: colors.graphite, backgroundColor: colors.accent },
  periodText: { color: colors.muted, fontSize: 13, fontWeight: '600' }, periodTextSelected: { color: colors.onAccent },
  rangeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, arrowText: { color: colors.ink, fontSize: 32 },
  disabled: { opacity: 0.35 }, rangeCopy: { flex: 1, alignItems: 'center' },
  rangeTitle: { color: colors.ink, fontSize: 16, fontWeight: '600' }, rangeEnd: { marginTop: 3, color: colors.muted, fontSize: 12 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { minHeight: 44, marginTop: 12, padding: 12, borderWidth: 1, borderColor: colors.hairline, borderRadius: 10,
    backgroundColor: colors.surface, color: colors.ink, fontSize: 13 },
  dateInput: { flex: 1, fontVariant: ['tabular-nums'] },
  dateButton: { marginTop: 12, minHeight: 44, paddingHorizontal: 13, justifyContent: 'center', borderRadius: 10, backgroundColor: colors.panel },
  dateButtonText: { color: colors.graphite, fontSize: 12, fontWeight: '600' },
  categoryOptions: { paddingVertical: 14, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: colors.hairline, borderRadius: 18, backgroundColor: colors.surface },
  selectedChip: { borderColor: colors.graphite, backgroundColor: colors.accent }, chipText: { color: colors.graphite, fontSize: 12 }, selectedChipText: { color: colors.onAccent },
  dot: { width: 9, height: 9, marginRight: 8, borderRadius: 5 },
  totalCard: { marginTop: 14, padding: 20, borderRadius: 16, backgroundColor: colors.accent },
  totalLabel: { color: colors.onAccentMuted, fontSize: 14, fontWeight: '600' },
  total: { marginTop: 9, color: colors.onAccent, fontSize: 34, fontWeight: '600', fontVariant: ['tabular-nums'] },
  totalMeta: { marginTop: 6, color: colors.onAccentMuted, fontSize: 12 }, spinner: { marginVertical: 16 },
  card: { marginTop: 20, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 15, backgroundColor: colors.surface },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '600', marginBottom: 6 },
  chartRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  chartHeading: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 4 },
  rowLabel: { flexGrow: 1, flexShrink: 1, color: colors.graphite, fontSize: 13 },
  rowValue: { color: colors.ink, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barTrack: { height: 12, marginTop: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.panel },
  barFill: { height: '100%', borderRadius: 4 }, minuteValue: { color: colors.muted, fontSize: 11, marginTop: 5 },
  empty: { marginVertical: 12, color: colors.muted, fontSize: 13 },
  errorRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  error: { flex: 1, color: colors.danger, fontSize: 13, lineHeight: 19 },
  retry: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' }, retryText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
});
