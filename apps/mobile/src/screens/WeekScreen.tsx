import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { getEntriesBetween } from '../data/database';
import { CATEGORIES, colors } from '../theme';
import type { MinuteEntry } from '../types';
import { addDays, dateKey, formatCompactDate, startOfWeek } from '../utils/time';

type Props = { dataVersion: number };

type TimelineSegment = {
  key: string;
  categoryId: string | null;
  length: number;
};

function buildDayTimeline(dayEntries: MinuteEntry[]): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  let cursor = 0;

  for (const entry of dayEntries) {
    const minute = Math.max(0, Math.min(1439, entry.minuteIndex));
    if (minute < cursor) continue;

    if (minute > cursor) {
      segments.push({ key: `gap-${cursor}`, categoryId: null, length: minute - cursor });
    }

    const previous = segments.at(-1);
    if (previous?.categoryId === entry.categoryId) {
      previous.length += 1;
    } else {
      segments.push({
        key: `${entry.categoryId}-${minute}`,
        categoryId: entry.categoryId,
        length: 1,
      });
    }
    cursor = minute + 1;
  }

  if (cursor < 1440) {
    segments.push({ key: `gap-${cursor}`, categoryId: null, length: 1440 - cursor });
  }

  return segments;
}

export function WeekScreen({ dataVersion }: Props) {
  const weekStart = useMemo(() => startOfWeek(new Date()), []);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => dateKey(addDays(weekStart, index))),
    [weekStart],
  );
  const [entries, setEntries] = useState<MinuteEntry[]>([]);

  useEffect(() => {
    void getEntriesBetween(days[0]!, days[6]!).then(setEntries);
  }, [dataVersion, days]);

  const counts = useMemo(() => {
    const byDay = new Map<string, Map<string, number>>();
    for (const day of days) byDay.set(day, new Map());
    for (const entry of entries) {
      const day = byDay.get(entry.dateKey);
      if (!day) continue;
      day.set(entry.categoryId, (day.get(entry.categoryId) ?? 0) + 1);
    }
    return byDay;
  }, [days, entries]);

  const timelines = useMemo(() => {
    const entriesByDay = new Map(days.map((day) => [day, [] as MinuteEntry[]]));
    for (const entry of entries) entriesByDay.get(entry.dateKey)?.push(entry);

    return new Map(
      days.map((day) => [
        day,
        buildDayTimeline(
          (entriesByDay.get(day) ?? []).sort(
            (left, right) => left.minuteIndex - right.minuteIndex,
          ),
        ),
      ]),
    );
  }, [days, entries]);

  const categoryColors = useMemo(
    () => new Map<string, string>(CATEGORIES.map((category) => [category.id, category.color])),
    [dataVersion],
  );

  const categoryTotals = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        ...category,
        minutes: entries.filter((entry) => entry.categoryId === category.id).length,
      })).filter((category) => category.minutes > 0),
    [dataVersion, entries],
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>THIS WEEK</Text>
      <Text style={styles.title}>A truthful view of your time</Text>
      <Text style={styles.subtitle}>
        {entries.length} minutes recorded from {formatCompactDate(days[0]!)} through{' '}
        {formatCompactDate(days[6]!)}.
      </Text>

      <View style={styles.weekCard}>
        <Text style={styles.timelineHint}>Pale space is time not yet recorded.</Text>
        <View style={styles.axisRow}>
          <View style={styles.axisLabelSpacer} />
          <View style={styles.axisLabels}>
            <Text style={styles.axisLabel}>12 AM</Text>
            <Text style={styles.axisLabel}>NOON</Text>
            <Text style={styles.axisLabel}>12 AM</Text>
          </View>
        </View>
        {days.map((day) => {
          const dayCounts = counts.get(day) ?? new Map<string, number>();
          const total = [...dayCounts.values()].reduce((sum, value) => sum + value, 0);
          const timeline = timelines.get(day) ?? [];
          return (
            <View key={day} style={styles.dayRow}>
              <View style={styles.dayLabelWrap}>
                <Text style={styles.dayLabel}>{formatCompactDate(day)}</Text>
                <Text style={styles.dayTotal}>{total} min</Text>
              </View>
              <View style={styles.barTrack}>
                {timeline.map((segment) => (
                  <View
                    key={segment.key}
                    style={[
                      styles.barSegment,
                      {
                        backgroundColor: segment.categoryId
                          ? (categoryColors.get(segment.categoryId) ?? colors.silver)
                          : colors.panel,
                        flex: segment.length,
                      },
                    ]}
                  />
                ))}
              </View>
            </View>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>Recorded categories</Text>
      <View style={styles.breakdownCard}>
        {categoryTotals.length === 0 ? (
          <Text style={styles.emptyText}>Your category totals will appear as you record minutes.</Text>
        ) : (
          categoryTotals.map((category) => (
            <View key={category.id} style={styles.categoryRow}>
              <View style={[styles.dot, { backgroundColor: category.color }]} />
              <Text style={styles.categoryName}>{category.name}</Text>
              <Text style={styles.categoryValue}>
                {Math.floor(category.minutes / 60)}h {category.minutes % 60}m
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.noteCard}>
        <Text style={styles.noteTitle}>Plans are not counted as truth yet</Text>
        <Text style={styles.noteBody}>
          This summary counts explicit Context entries. Calendar plans remain visible in Today until
          you confirm or replace them.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, paddingBottom: 40 },
  eyebrow: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.1 },
  title: { marginTop: 6, color: colors.ink, fontSize: 28, fontWeight: '700', lineHeight: 34 },
  subtitle: { marginTop: 8, color: colors.muted, fontSize: 14, lineHeight: 20 },
  weekCard: {
    marginTop: 24,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: 16,
    backgroundColor: colors.white,
  },
  timelineHint: { marginBottom: 10, color: colors.muted, fontSize: 11, lineHeight: 16 },
  axisRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 1 },
  axisLabelSpacer: { width: 92 },
  axisLabels: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  axisLabel: { color: colors.muted, fontSize: 8, fontWeight: '600', letterSpacing: 0.3 },
  dayRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 8 },
  dayLabelWrap: { width: 92 },
  dayLabel: { color: colors.graphite, fontSize: 12, fontWeight: '600' },
  dayTotal: { marginTop: 2, color: colors.muted, fontSize: 10 },
  barTrack: {
    flex: 1,
    height: 12,
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: 6,
    backgroundColor: colors.panel,
  },
  barSegment: { height: 12 },
  sectionTitle: { marginTop: 28, marginBottom: 10, color: colors.ink, fontSize: 16, fontWeight: '700' },
  breakdownCard: {
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: 16,
    backgroundColor: colors.white,
  },
  categoryRow: {
    minHeight: 49,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  dot: { width: 10, height: 10, marginRight: 10, borderRadius: 5 },
  categoryName: { flex: 1, color: colors.graphite, fontSize: 14 },
  categoryValue: { color: colors.ink, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  emptyText: { paddingVertical: 18, color: colors.muted, fontSize: 13, lineHeight: 19 },
  noteCard: { marginTop: 20, padding: 16, borderRadius: 14, backgroundColor: colors.panel },
  noteTitle: { color: colors.graphite, fontSize: 13, fontWeight: '700' },
  noteBody: { marginTop: 5, color: colors.muted, fontSize: 12, lineHeight: 18 },
});
