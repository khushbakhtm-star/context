import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../appearance';
import { InfoButton } from '../components/InfoButton';
import { getDaySegments } from '../data/database';
import { loadPlannedEventsResult } from '../services/calendar';
import { loadAccountPlans } from '../sync/engine';
import type { AppColors } from '../theme';
import type { CalendarPreferences, DeviceCalendar } from '../types';
import { calendarViewDates } from '../utils/calendar-view-mode';
import { isDateKey } from '../utils/date-selection';
import { scheduleAgendaItems, scheduleDescription, scheduleTimeRange, type ScheduleAgendaItem } from '../utils/schedule-agenda';
import { dateKey, formatDayHeading, minuteIndexForDate, parseDateKey } from '../utils/time';

type Props = {
  activeDate: string;
  selectedDates?: readonly string[] | null;
  calendars: DeviceCalendar[];
  preferences: CalendarPreferences;
  dataVersion: number;
  clockFormat: '12h' | '24h';
  onOpenMinute: (day: string, minute: number) => void;
  onVisibleMonthChange?: (month: string) => void;
};
type DayState = { items: ScheduleAgendaItem[]; failed: boolean };

export function CalendarScheduleScreen({ activeDate, selectedDates, calendars, preferences, dataVersion, clockFormat,
  onOpenMinute, onVisibleMonthChange }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const daysKey = calendarViewDates('schedule', activeDate, selectedDates).join('|');
  const days = useMemo(() => daysKey ? daysKey.split('|') : [], [daysKey]);
  const [data, setData] = useState<Record<string, DayState>>({});
  const [retry, setRetry] = useState(0);
  const requestDays = useRef<(days: string[]) => void>(() => {});
  const visibleDays = useRef<string[]>([]);
  const visibleMonthCallback = useRef(onVisibleMonthChange);
  visibleMonthCallback.current = onVisibleMonthChange;
  const calendarKey = JSON.stringify(calendars);
  const preferenceKey = JSON.stringify(preferences.selectedCalendarIds);
  const viewability = useRef({ itemVisiblePercentThreshold: 5 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { item: string }[] }) => {
    const visible = viewableItems.flatMap(({ item }) => isDateKey(item) ? [item] : []);
    if (!visible.length) return;
    visibleDays.current = visible;
    requestDays.current(visible);
    visibleMonthCallback.current?.(`${visible[0]!.slice(0, 7)}-01`);
  }).current;

  useEffect(() => {
    let cancelled = false;
    let running = 0;
    const queue: string[] = [];
    const queued = new Set<string>();
    const positions = new Map(days.map((day, index) => [day, index]));
    setData({});
    async function readDay(day: string) {
      const results = await Promise.allSettled([
        getDaySegments(day), loadPlannedEventsResult(preferences.selectedCalendarIds, day, calendars), loadAccountPlans(day),
      ]);
      const [actual, device, accounts] = results;
      const segments = actual.status === 'fulfilled' ? actual.value : [];
      const plans = [...(device.status === 'fulfilled' ? device.value.plans : []),
        ...(accounts.status === 'fulfilled' ? accounts.value : [])];
      const failed = results.some((result) => result.status === 'rejected') ||
        (device.status === 'fulfilled' && device.value.failures.length > 0);
      if (!cancelled) setData((current) => cancelled ? current : {
        ...current, [day]: { items: scheduleAgendaItems(day, segments, plans), failed },
      });
    }
    function pump() {
      while (!cancelled && running < 2 && queue.length) {
        const day = queue.shift()!;
        running += 1;
        void readDay(day).catch(() => {
          if (!cancelled) setData((current) => ({ ...current, [day]: { items: [], failed: true } }));
        }).finally(() => { running -= 1; pump(); });
      }
    }
    const enqueueDays = (requested: string[]) => {
      if (cancelled) return;
      const nearby = new Set<string>();
      for (const day of requested) {
        const index = positions.get(day);
        if (index == null) continue;
        for (let offset = -1; offset <= 1; offset++) {
          const neighbor = days[index + offset];
          if (neighbor) nearby.add(neighbor);
        }
      }
      for (const day of nearby) if (!queued.has(day)) { queued.add(day); queue.push(day); }
      pump();
    };
    requestDays.current = enqueueDays;
    const visible = visibleDays.current.filter((day) => positions.has(day));
    enqueueDays(visible.length ? visible : days.slice(0, 3));
    return () => { cancelled = true; queue.length = 0; };
  }, [daysKey, calendarKey, preferenceKey, dataVersion, retry]);

  const failed = Object.values(data).some((day) => day.failed);
  const openDay = (day: string) => {
    const now = new Date();
    onOpenMinute(day, day === dateKey(now) ? minuteIndexForDate(now) : 9 * 60);
  };
  return <View style={styles.container}>
    {failed ? <View style={styles.errorRow}>
      <Text accessibilityRole="alert" style={styles.error}>Some events could not load</Text>
      <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)} style={styles.retry}>
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
      <InfoButton title="Schedule events" message="Available calendar events and recorded activities appear together. Recorded minutes replace the overlapping part of a plan. Retry missing sources, or check the calendar selection and account connection in Settings. Tap an activity to open its minute cells." />
    </View> : null}
    <FlatList key={daysKey} data={days} extraData={data} keyExtractor={(day) => day}
      initialNumToRender={5} maxToRenderPerBatch={5} windowSize={5}
      onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewability}
      contentContainerStyle={styles.content} renderItem={({ item: day }) => {
        const state = data[day];
        const heading = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
          .format(parseDateKey(day));
        return <View style={styles.day}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Open ${heading}`} onPress={() => openDay(day)} style={styles.dayHeading}>
            <Text accessibilityRole="header" style={styles.dayTitle}>{heading}</Text>
          </Pressable>
          {!state ? <View style={styles.loading} accessibilityLabel={`Loading ${formatDayHeading(day)}`}>
            <ActivityIndicator size="small" color={colors.muted} />
          </View> : state.items.length ? state.items.map((item) => {
            const time = scheduleTimeRange(item, clockFormat);
            const description = scheduleDescription(item, clockFormat, 600);
            return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${heading}, ${time}, ${item.title}`}
              accessibilityHint="Open minute cells" onPress={() => onOpenMinute(day, item.startMinute)} style={styles.event}>
              <View style={[styles.eventMarker, { backgroundColor: item.color }]} />
              <View style={styles.eventContent}>
                <Text maxFontSizeMultiplier={1.5} style={styles.eventTime}>{time}</Text>
                <Text style={styles.eventTitle}>{item.title}</Text>
                {description.trim() ? <Text numberOfLines={3} style={styles.description}>{description}</Text> : null}
              </View>
            </Pressable>;
          }) : <Text style={styles.empty}>{state.failed ? 'Events unavailable' : 'No events'}</Text>}
        </View>;
      }} />
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  day: { paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  dayHeading: { minHeight: 48, justifyContent: 'center', paddingVertical: 10 },
  dayTitle: { color: colors.ink, fontSize: 16, fontWeight: '600' },
  loading: { minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' },
  event: { minHeight: 64, flexDirection: 'row', marginBottom: 8, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surface },
  eventMarker: { width: 4 },
  eventContent: { flex: 1, paddingHorizontal: 12, paddingVertical: 10 },
  eventTime: { color: colors.graphite, fontSize: 12, fontVariant: ['tabular-nums'] },
  eventTitle: { color: colors.ink, fontSize: 16, fontWeight: '500', marginTop: 4 },
  description: { color: colors.graphite, fontSize: 13, lineHeight: 19, marginTop: 6 },
  empty: { color: colors.muted, fontSize: 13, paddingVertical: 8 },
  errorRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 4, gap: 4 },
  error: { flex: 1, color: colors.danger, fontSize: 12 },
  retry: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  retryText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
});
