import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../appearance';
import { getDaySegments } from '../data/database';
import { loadPlannedEventsResult } from '../services/calendar';
import { loadAccountPlansResult, loadCachedAccountPlans } from '../sync/engine';
import type { AppColors } from '../theme';
import type { ActivitySegment, CalendarPreferences, DeviceCalendar, PlannedEvent } from '../types';
import { calendarViewDates } from '../utils/calendar-view-mode';
import { isDateKey } from '../utils/date-selection';
import { scheduleAgendaItems, scheduleDescription, scheduleTimeRange, type ScheduleAgendaItem } from '../utils/schedule-agenda';
import { dateKey, formatDayHeading, minuteIndexForDate, parseDateKey } from '../utils/time';
import { createCalendarListFocus, type CalendarViewFocusRequest } from '../utils/calendar-list-focus';

type Props = {
  focusRequest?: CalendarViewFocusRequest | null;
  activeDate: string;
  selectedDates?: readonly string[] | null;
  calendars: DeviceCalendar[];
  preferences: CalendarPreferences;
  dataVersion: number;
  clockFormat: '12h' | '24h';
  onOpenMinute: (day: string, minute: number) => void;
  onVisibleMonthChange?: (month: string) => void;
  onSyncWarningChange?: (message: string | null) => void;
};
type DaySources = { sourceKey: string; segments: ActivitySegment[]; devicePlans: PlannedEvent[]; accountPlans: PlannedEvent[];
  localReady: boolean; deviceReady: boolean; accountReady: boolean; accountFresh: boolean;
  localFailed: boolean; deviceFailed: boolean; accountFailed: boolean };
type DayState = DaySources & { items: ScheduleAgendaItem[]; failed: boolean };

function accessDenied(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; status?: unknown };
  return value.status === 401 || value.status === 403 ||
    typeof value.code === 'string' && /permission|denied|unauthori[sz]ed/i.test(value.code);
}

export function CalendarScheduleScreen({ activeDate, focusRequest, selectedDates, calendars, preferences, dataVersion, clockFormat,
  onOpenMinute, onVisibleMonthChange, onSyncWarningChange }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const daysKey = calendarViewDates('schedule', activeDate, selectedDates).join('|');
  const days = useMemo(() => daysKey ? daysKey.split('|') : [], [daysKey]);
  const list = useRef<FlatList<string>>(null);
  const listFocus = useMemo(() => createCalendarListFocus(() => list.current, () => AppState.currentState === 'active'), []);
  useEffect(() => {
    if (focusRequest && isDateKey(focusRequest.dateKey)) listFocus.request(days.indexOf(focusRequest.dateKey));
    return () => listFocus.cancel();
  }, [focusRequest?.token, focusRequest?.dateKey, daysKey, listFocus]);
  const [data, setData] = useState<Record<string, DayState>>({});
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
    const pools = Array.from({ length: 4 }, () => ({ running: 0, queue: [] as (() => Promise<void>)[] }));
    const queued = new Set<string>();
    const positions = new Map(days.map((day, index) => [day, index]));
    const sourceKey = `${calendarKey}|${preferenceKey}`;
    const compose = (day: string, value: DaySources): DayState => ({ ...value,
      items: scheduleAgendaItems(day, value.segments, [...value.devicePlans, ...value.accountPlans]),
      failed: value.localFailed || value.deviceFailed || value.accountFailed });
    const initial = (previous?: DayState): DaySources => ({ sourceKey, segments: previous?.segments ?? [],
      devicePlans: previous?.sourceKey === sourceKey ? previous.devicePlans : [],
      accountPlans: previous?.sourceKey === sourceKey ? previous.accountPlans : [],
      localReady: false, deviceReady: false, accountReady: false, accountFresh: false,
      localFailed: previous?.localFailed ?? false,
      deviceFailed: previous?.sourceKey === sourceKey && previous.deviceFailed || false,
      accountFailed: previous?.sourceKey === sourceKey && previous.accountFailed || false });
    setData((current) => cancelled ? current : Object.fromEntries(days.map((day) => [day, compose(day, initial(current[day]))])));
    function update(day: string, patch: Partial<DaySources> | ((previous: DayState) => Partial<DaySources>)) {
      if (cancelled) return;
      setData((current) => {
        if (cancelled) return current;
        const previous = current[day] ?? compose(day, initial());
        return { ...current, [day]: compose(day, { ...previous, ...(typeof patch === 'function' ? patch(previous) : patch) }) };
      });
    }
    function pump(index: number) {
      const pool = pools[index]!;
      while (!cancelled && pool.running < 2 && pool.queue.length) {
        const read = pool.queue.shift()!;
        pool.running += 1;
        void read().catch(() => {}).finally(() => { pool.running -= 1; pump(index); });
      }
    }
    function enqueueDay(day: string) {
      pools[0]!.queue.push(async () => {
        try { update(day, { segments: await getDaySegments(day), localReady: true, localFailed: false }); }
        catch { update(day, { localReady: true, localFailed: true }); }
      });
      pools[1]!.queue.push(async () => {
        try {
          const plans = await loadCachedAccountPlans(day);
          update(day, (previous) => previous.accountFresh ? {} : { accountPlans: plans });
        } catch { /* A cache error must not erase local notes or a fresh provider result. */ }
      });
      pools[2]!.queue.push(async () => {
        try {
          const result = await loadPlannedEventsResult(preferences.selectedCalendarIds, day, calendars);
          const unavailable = new Set(result.failures.filter((failure) => !accessDenied(failure)).map((failure) => failure.calendarId));
          update(day, (previous) => ({ deviceReady: true, deviceFailed: result.failures.length > 0,
            devicePlans: [...result.plans, ...previous.devicePlans.filter((plan) => unavailable.has(plan.calendarId))] }));
        } catch (error) { update(day, (previous) => ({ deviceReady: true, deviceFailed: true,
          devicePlans: accessDenied(error) ? [] : previous.devicePlans })); }
      });
      pools[3]!.queue.push(async () => {
        try {
          const result = await loadAccountPlansResult(day);
          update(day, { accountPlans: result.plans, accountReady: true, accountFresh: true, accountFailed: result.failures.length > 0 });
        } catch (error) { update(day, (previous) => ({ accountReady: true, accountFailed: true,
          accountFresh: accessDenied(error) || previous.accountFresh,
          accountPlans: accessDenied(error) ? [] : previous.accountPlans })); }
      });
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
      for (const day of nearby) if (!queued.has(day)) { queued.add(day); enqueueDay(day); }
      pools.forEach((_pool, index) => pump(index));
    };
    requestDays.current = enqueueDays;
    const visible = visibleDays.current.filter((day) => positions.has(day));
    enqueueDays(visible.length ? visible : days.slice(0, 3));
    return () => { cancelled = true; pools.forEach((pool) => { pool.queue.length = 0; }); };
  }, [daysKey, calendarKey, preferenceKey, dataVersion]);

  const warning = Object.values(data).some((day) => day.localFailed)
    ? 'Some saved activity could not load. Your saved ledger is unchanged. Tap Sync to retry.'
    : Object.values(data).some((day) => day.deviceFailed || day.accountFailed)
      ? 'Some calendar events could not load. Showing saved activity and available plans. Tap Sync to retry.' : null;
  useEffect(() => { onSyncWarningChange?.(warning); }, [warning, onSyncWarningChange]);
  useEffect(() => () => onSyncWarningChange?.(null), [onSyncWarningChange]);
  const openDay = (day: string) => {
    const now = new Date();
    onOpenMinute(day, day === dateKey(now) ? minuteIndexForDate(now) : 9 * 60);
  };
  return <View style={styles.container}>
    <FlatList ref={list} key={daysKey} data={days} extraData={data} keyExtractor={(day) => day}
      onScrollToIndexFailed={listFocus.onFailure} onScrollBeginDrag={listFocus.cancel}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
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
          {(!state || !state.items.length && (!state.localReady || !state.deviceReady || !state.accountReady))
          ? <View style={styles.loading} accessibilityLabel={`Loading ${formatDayHeading(day)}`}>
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
          }) : state.failed ? null : <Text style={styles.empty}>No events</Text>}
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
});
