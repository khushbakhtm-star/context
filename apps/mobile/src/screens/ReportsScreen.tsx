import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { getCategoryTimeTotals } from '../data/database';
import { listCategories } from '../services/categories';
import { formatRecordedDuration, isReportDate, moveReportPeriod, reportBounds, summarizeCategoryTime } from '../services/reports';
import type { CategoryTimeRow, ReportPeriod } from '../services/reports';
import { useAppTheme } from '../appearance';
import { categoryById } from '../theme';
import type { ActivityCategory, AppColors } from '../theme';
import { dateKey, formatCompactDate } from '../utils/time';

type Props = { dataVersion: number; initialDate?: string };
const PERIODS: ReportPeriod[] = ['day', 'week', 'month', 'year'];

export function ReportsScreen({ dataVersion, initialDate }: Props) {
  const { colors, resolvedMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [anchor, setAnchor] = useState(initialDate ?? dateKey(new Date()));
  const [dateInput, setDateInput] = useState(anchor);
  const [period, setPeriod] = useState<ReportPeriod>('day');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categories, setCategories] = useState<ActivityCategory[]>([]);
  const [rows, setRows] = useState<CategoryTimeRow[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bounds = useMemo(() => reportBounds(anchor, period), [anchor, period]);

  useEffect(() => {
    let active = true;
    setBusy(true); setError(null);
    void Promise.all([listCategories(), getCategoryTimeTotals(bounds.start, bounds.end)])
      .then(([categoryValues, totals]) => {
        if (!active) return;
        setCategories(categoryValues); setRows(totals);
      })
      .catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : 'The report could not be loaded.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [bounds.end, bounds.start, dataVersion]);

  const summary = useMemo(() => summarizeCategoryTime(rows, categoryId), [categoryId, rows]);
  const categoryOptions = useMemo(() => {
    const all = new Map(categories.map((category) => [category.id, category]));
    for (const row of rows) if (!all.has(row.categoryId)) all.set(row.categoryId, categoryById(row.categoryId));
    return [...all.values()].filter((category) => category.name.toLowerCase().includes(search.toLowerCase()));
  }, [categories, rows, search]);
  const breakdown = useMemo(() => [...summary.categoryTotals.entries()].sort((left, right) => right[1] - left[1]), [summary]);
  const daily = useMemo(() => [...summary.dayTotals.entries()].sort((left, right) => left[0].localeCompare(right[0])), [summary]);

  function move(direction: number) {
    const next = moveReportPeriod(anchor, period, direction);
    setAnchor(next); setDateInput(next);
  }
  function useDate() {
    if (!isReportDate(dateInput)) { setError('Choose a real date in YYYY-MM-DD format.'); return; }
    setAnchor(dateInput); setError(null);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>TIME REPORTS</Text>
      <Text style={styles.title}>Where your time went</Text>
      <Text style={styles.intro}>Choose an activity category and a day, week, month, or year.</Text>

      <View style={styles.periods}>{PERIODS.map((value) => <Pressable key={value} onPress={() => setPeriod(value)}
        style={[styles.period, period === value && styles.periodSelected]}>
        <Text style={[styles.periodText, period === value && styles.periodTextSelected]}>{value[0]!.toUpperCase() + value.slice(1)}</Text>
      </Pressable>)}</View>
      <View style={styles.rangeRow}>
        <Pressable accessibilityLabel={`Previous ${period}`} onPress={() => move(-1)} style={styles.arrow}><Text style={styles.arrowText}>‹</Text></Pressable>
        <View style={styles.rangeCopy}><Text style={styles.rangeTitle}>{formatCompactDate(bounds.start)}</Text>
          {bounds.end !== bounds.start ? <Text style={styles.rangeEnd}>through {formatCompactDate(bounds.end)}</Text> : null}</View>
        <Pressable accessibilityLabel={`Next ${period}`} onPress={() => move(1)} style={styles.arrow}><Text style={styles.arrowText}>›</Text></Pressable>
      </View>
      <View style={styles.dateRow}><TextInput keyboardAppearance={resolvedMode} value={dateInput} onChangeText={setDateInput} maxLength={10}
        accessibilityLabel="Report date YYYY-MM-DD" placeholder="YYYY-MM-DD" autoCapitalize="none" autoCorrect={false}
        placeholderTextColor={colors.muted} style={[styles.input, styles.dateInput]} />
        <Pressable onPress={useDate} style={styles.dateButton}><Text style={styles.dateButtonText}>Go to date</Text></Pressable>
      </View>

      <TextInput keyboardAppearance={resolvedMode} value={search} onChangeText={setSearch} placeholder="Find an activity category"
        placeholderTextColor={colors.muted} style={styles.input} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryOptions}>
        <Pressable onPress={() => setCategoryId(null)} style={[styles.chip, categoryId === null && styles.selectedChip]}>
          <Text style={[styles.chipText, categoryId === null && styles.selectedChipText]}>All categories</Text>
        </Pressable>
        {categoryOptions.map((category) => <Pressable key={category.id} onPress={() => setCategoryId(category.id)}
          style={[styles.chip, categoryId === category.id && { borderColor: category.color, backgroundColor: `${category.color}20` }]}>
          <View style={[styles.dot, { backgroundColor: category.color }]} />
          <Text style={styles.chipText}>{category.name}</Text>
        </Pressable>)}
      </ScrollView>

      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>{categoryId ? categoryById(categoryId).name : 'All recorded activities'}</Text>
        {busy ? <ActivityIndicator color={colors.onAccent} style={{ marginVertical: 14 }} /> :
          <Text style={styles.total}>{formatRecordedDuration(summary.total)}</Text>}
        <Text style={styles.totalMeta}>{summary.total.toLocaleString()} recorded minutes in this {period}</Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!busy ? <View style={styles.card}>
        <Text style={styles.cardTitle}>{categoryId ? 'Recorded days' : 'Category breakdown'}</Text>
        {!summary.total ? <Text style={styles.help}>No recorded minutes match this period and category.</Text> : null}
        {(categoryId ? daily : breakdown).map(([id, minutes]) => {
          const category = categoryId ? categoryById(categoryId) : categoryById(id);
          return <View key={id} style={styles.reportRow}>
            <View style={[styles.dot, { backgroundColor: category.color }]} />
            <Text style={styles.rowLabel}>{categoryId ? formatCompactDate(id) : category.name}</Text>
            <Text style={styles.rowValue}>{formatRecordedDuration(minutes)}</Text>
          </View>;
        })}
      </View> : null}
      <Text style={styles.help}>
        Reports count recorded minute rows, including imported actuals. Future calendar plans are
        excluded. Weeks run Monday through Sunday. Totals use the current grid's civil minute slots.
      </Text>
    </ScrollView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper }, content: { padding: 20, paddingBottom: 40 },
  eyebrow: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.1 },
  title: { marginTop: 6, color: colors.ink, fontSize: 28, fontWeight: '700' },
  intro: { marginTop: 8, color: colors.muted, fontSize: 14, lineHeight: 21 },
  periods: { flexDirection: 'row', gap: 7, marginTop: 22 },
  period: { flex: 1, alignItems: 'center', paddingVertical: 11, borderWidth: 1, borderColor: colors.hairline, borderRadius: 10, backgroundColor: colors.surface },
  periodSelected: { borderColor: colors.graphite, backgroundColor: colors.accent },
  periodText: { color: colors.muted, fontSize: 13, fontWeight: '600' }, periodTextSelected: { color: colors.onAccent },
  rangeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  arrow: { width: 40, height: 42, alignItems: 'center', justifyContent: 'center' }, arrowText: { color: colors.ink, fontSize: 32 },
  rangeCopy: { flex: 1, alignItems: 'center' }, rangeTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  rangeEnd: { marginTop: 3, color: colors.muted, fontSize: 12 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { marginTop: 12, padding: 12, borderWidth: 1, borderColor: colors.hairline, borderRadius: 10, backgroundColor: colors.surface, color: colors.ink, fontSize: 13 },
  dateInput: { flex: 1, fontVariant: ['tabular-nums'] },
  dateButton: { marginTop: 12, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.panel },
  dateButtonText: { color: colors.graphite, fontSize: 12, fontWeight: '700' },
  categoryOptions: { paddingVertical: 14, gap: 8 }, chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.hairline, borderRadius: 18, backgroundColor: colors.surface },
  selectedChip: { borderColor: colors.graphite, backgroundColor: colors.accent }, chipText: { color: colors.graphite, fontSize: 12 }, selectedChipText: { color: colors.onAccent },
  dot: { width: 9, height: 9, marginRight: 8, borderRadius: 5 },
  totalCard: { marginTop: 4, padding: 22, borderRadius: 16, backgroundColor: colors.accent },
  totalLabel: { color: colors.onAccentMuted, fontSize: 14, fontWeight: '600' }, total: { marginTop: 9, color: colors.onAccent, fontSize: 38, fontWeight: '700', fontVariant: ['tabular-nums'] },
  totalMeta: { marginTop: 6, color: colors.onAccentMuted, fontSize: 12 },
  card: { marginTop: 20, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 15, backgroundColor: colors.surface },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  reportRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  rowLabel: { flex: 1, color: colors.graphite, fontSize: 13 }, rowValue: { marginLeft: 10, color: colors.ink, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  help: { marginTop: 14, color: colors.muted, fontSize: 12, lineHeight: 18 }, error: { marginTop: 14, color: colors.danger, fontSize: 13, lineHeight: 19 },
});
