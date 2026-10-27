import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../appearance';
import { getDaySegments } from '../data/database';
import { loadPlannedEventsResult } from '../services/calendar';
import { loadAccountPlansResult, loadCachedAccountPlans } from '../sync/engine';
import type { AppColors } from '../theme';
import type { ActivitySegment, CalendarPreferences, DeviceCalendar, PlannedEvent } from '../types';
import { isDateKey, monthDateCells, normalizeSelectedDates } from '../utils/date-selection';
import { monthAgendaItems, type MonthAgendaItem } from '../utils/month-agenda';
import { addDays, dateKey, formatDayHeading, minuteIndexForDate, parseDateKey } from '../utils/time';
import { calendarColor } from '../utils/calendar-cell-color';
import { activityTextColor } from '../utils/minute-interactions';
import { createCalendarListFocus, type CalendarViewFocusRequest } from '../utils/calendar-list-focus';

type Props = {
  activeDate?: string;
  focusRequest?: CalendarViewFocusRequest | null;
  selectedDates: string[];
  calendars: DeviceCalendar[];
  preferences: CalendarPreferences;
  dataVersion: number;
  clockFormat: '12h' | '24h';
  onOpenMinute: (day: string, minute: number) => void;
  onVisibleMonthChange?: (month: string) => void;
  onSyncWarningChange?: (message: string | null) => void;
  onFocusedMinuteChange?: (focus: { dateKey: string; minuteIndex: number }) => void;
};
type DaySources = { sourceKey: string; segments: ActivitySegment[]; devicePlans: PlannedEvent[]; accountPlans: PlannedEvent[];
  localReady: boolean; deviceReady: boolean; accountReady: boolean; accountFresh: boolean;
  localFailed: boolean; deviceFailed: boolean; accountFailed: boolean };
type DayState = DaySources & { items: MonthAgendaItem[]; failed: boolean };

function accessDenied(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; status?: unknown };
  return value.status === 401 || value.status === 403 ||
    typeof value.code === 'string' && /permission|denied|unauthori[sz]ed/i.test(value.code);
}

export function MonthOverview({ activeDate, focusRequest, selectedDates, calendars, preferences, dataVersion, onOpenMinute,
  onVisibleMonthChange, onSyncWarningChange, onFocusedMinuteChange }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const daysKey = normalizeSelectedDates(selectedDates).join('|');
  const days = useMemo(() => daysKey ? daysKey.split('|') : [], [daysKey]);
  const selected = useMemo(() => new Set(days), [days]);
  const months = useMemo(() => [...new Set(days.map((day) => day.slice(0, 7)))], [days]);
  const list = useRef<FlatList<string>>(null);
  const listFocus = useMemo(() => createCalendarListFocus(() => list.current, () => AppState.currentState === 'active'), []);
  const pendingFocus = useRef<CalendarViewFocusRequest | null>(null);
  const weekOffsets = useRef(new Map<string, number>());
  const monthKey = months.join('|');
  const focusWeek = (request: CalendarViewFocusRequest) => {
    const month = request.dateKey.slice(0, 7);
    const index = months.indexOf(month);
    if (index < 0) return;
    const week = Math.floor(monthDateCells(`${month}-01`).findIndex((cell) => cell.dateKey === request.dateKey) / 7);
    const offset = weekOffsets.current.get(`${month}:${week}`);
    listFocus.request(index, offset === undefined ? 0 : -offset);
    // Earlier week rows can grow when their events arrive. Keep this explicit
    // focus anchored through those layouts until the user drags or changes view.
  };
  useEffect(() => {
    if (!focusRequest || !isDateKey(focusRequest.dateKey) || !selected.has(focusRequest.dateKey)) return;
    pendingFocus.current = focusRequest;
    focusWeek(focusRequest);
    return () => { listFocus.cancel(); pendingFocus.current = null; };
  }, [focusRequest?.token, focusRequest?.dateKey, monthKey, daysKey, listFocus]);
  useEffect(() => () => listFocus.cancel(), [listFocus]);
  const [data, setData] = useState<Record<string, DayState>>({});
  const requestMonths = useRef<(months: string[]) => void>(() => {});
  const visibleMonths = useRef<string[]>([]);
  const visibleMonthCallback = useRef(onVisibleMonthChange);
  visibleMonthCallback.current = onVisibleMonthChange;
  const calendarKey = JSON.stringify(calendars);
  const preferenceKey = JSON.stringify(preferences.selectedCalendarIds);
  const viewability = useRef({ itemVisiblePercentThreshold: 5 }).current;
  const [today, setToday] = useState(() => dateKey(new Date()));
  useEffect(() => {
    const update = () => setToday(dateKey(new Date()));
    const timer = setInterval(update, 60_000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') update(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { item: string }[] }) => {
    const visible = viewableItems.flatMap((item) => typeof item.item === 'string' && isDateKey(`${item.item}-01`) ? [item.item] : []);
    if (visible.length) {
      visibleMonths.current = visible;
      requestMonths.current(visible);
      visibleMonthCallback.current?.(`${visible[0]}-01`);
    }
  }).current;

  useEffect(() => {
    let cancelled = false;
    const pools = Array.from({ length: 4 }, () => ({ running: 0, queue: [] as (() => Promise<void>)[] }));
    const queued = new Set<string>();
    const sourceKey = `${calendarKey}|${preferenceKey}`;
    const compose = (day: string, value: DaySources): DayState => {
      // Month shows the person's title or note, never an invented category label
      // for a deliberately blank, colored minute. Other agenda views retain
      // their own summary rules in the shared monthAgendaItems helper.
      const actualTitles = new Map(value.segments.map((segment) => [`actual:${segment.segmentKey}`,
        segment.activityTitle?.trim() || segment.entries.find((entry) => entry.text.trim())?.text.trim() || '']));
      return { ...value,
        items: monthAgendaItems(day, value.segments, [...value.devicePlans, ...value.accountPlans]).map((item) =>
          item.kind === 'actual' ? { ...item, title: actualTitles.get(item.id) ?? '' } : item),
        failed: value.localFailed || value.deviceFailed || value.accountFailed };
    };
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
      // Independent bounded readers: neither a phone provider nor an account
      // request can hold the local-ledger or local-cache queue behind it.
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
    const enqueueMonths = (requested: string[]) => {
      if (cancelled) return;
      const requestedSet = new Set(requested);
      for (const day of days) {
        if (!requestedSet.has(day.slice(0, 7)) || queued.has(day)) continue;
        queued.add(day); enqueueDay(day);
      }
      pools.forEach((_pool, index) => pump(index));
    };
    requestMonths.current = enqueueMonths;
    const visible = visibleMonths.current.filter((month) => months.includes(month));
    enqueueMonths(visible.length ? visible : months.slice(0, 1));
    return () => { cancelled = true; pools.forEach((pool) => { pool.queue.length = 0; }); };
  }, [daysKey, calendarKey, preferenceKey, dataVersion]);

  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(addDays('2026-10-19', index))), []);
  const warning = Object.values(data).some((day) => day.localFailed)
    ? 'Some saved activity could not load. Your saved ledger is unchanged. Tap Sync to retry.'
    : Object.values(data).some((day) => day.deviceFailed || day.accountFailed)
      ? 'Some calendar events could not load. Showing saved activity and available plans. Tap Sync to retry.' : null;
  useEffect(() => { onSyncWarningChange?.(warning); }, [warning, onSyncWarningChange]);
  useEffect(() => () => onSyncWarningChange?.(null), [onSyncWarningChange]);
  const openDay = (day: string) => {
    if (!isDateKey(day)) return;
    const minute = focusRequest?.dateKey === day && Number.isInteger(focusRequest.minuteIndex)
      ? Math.max(0, Math.min(1439, focusRequest.minuteIndex!))
      : day === dateKey(new Date()) ? minuteIndexForDate(new Date()) : 9 * 60;
    onFocusedMinuteChange?.({ dateKey: day, minuteIndex: minute });
    onOpenMinute(day, minute);
  };
  const openItem = (day: string, minute: number) => {
    onFocusedMinuteChange?.({ dateKey: day, minuteIndex: minute });
    onOpenMinute(day, minute);
  };

  return <View style={styles.container}>
    <FlatList ref={list} key={daysKey} data={months} keyExtractor={(month) => month} initialNumToRender={1} maxToRenderPerBatch={2} windowSize={3}
      extraData={activeDate} onScrollToIndexFailed={listFocus.onFailure}
      onScrollBeginDrag={() => { listFocus.cancel(); pendingFocus.current = null; }}
      onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewability}
      contentContainerStyle={styles.content} renderItem={({ item: month }) => {
        const cells = monthDateCells(`${month}-01`);
        return <View style={styles.month}>
          <Text accessibilityRole="header" style={styles.monthTitle}>
            {new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(parseDateKey(`${month}-01`))}
          </Text>
          <View style={styles.weekRow}>{weekdays.map((weekday, index) =>
            <Text key={index} numberOfLines={1} maxFontSizeMultiplier={1.3} style={styles.weekday}>{weekday}</Text>)}</View>
          {Array.from({ length: Math.ceil(cells.length / 7) }, (_, week) => <View key={week} style={styles.weekRow}
            onLayout={(event) => {
              weekOffsets.current.set(`${month}:${week}`, event.nativeEvent.layout.y);
              const pending = pendingFocus.current;
              if (pending?.dateKey.slice(0, 7) === month && cells.slice(week * 7, week * 7 + 7).some((cell) => cell.dateKey === pending.dateKey)) focusWeek(pending);
            }}>
            {cells.slice(week * 7, week * 7 + 7).map((cell) => {
              const active = cell.inMonth && selected.has(cell.dateKey);
              const state = active ? data[cell.dateKey] : undefined;
              const items = state?.items ?? [];
              const heading = formatDayHeading(cell.dateKey);
              return <View key={cell.dateKey} style={styles.day}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Open ${heading}`} disabled={!isDateKey(cell.dateKey)}
                  accessibilityState={{ selected: cell.dateKey === activeDate }}
                  onPress={() => openDay(cell.dateKey)} style={styles.dateButton}>
                  <View style={[styles.dateCircle, cell.inMonth && cell.dateKey === today && styles.today]}>
                    <Text maxFontSizeMultiplier={1.5} style={[styles.dayNumber, !cell.inMonth && styles.outsideMonth,
                      cell.inMonth && cell.dateKey === today && styles.todayText]}>{cell.day}</Text>
                  </View>
                </Pressable>
                {items.map((item) => {
                  const fill = calendarColor(item.color);
                  return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${heading}, ${item.title}`}
                    onPress={() => openItem(cell.dateKey, item.startMinute)}
                    style={[styles.event, { backgroundColor: fill ?? colors.paper }]}>
                    <Text numberOfLines={2} ellipsizeMode="clip" maxFontSizeMultiplier={1.5}
                      style={[styles.eventTitle, { color: activityTextColor(fill, colors.ink) }]}>{item.title}</Text>
                  </Pressable>;
                })}
                <Pressable accessibilityRole="button" accessibilityLabel={`Open minutes for ${heading}`} disabled={!isDateKey(cell.dateKey)}
                  onPress={() => openDay(cell.dateKey)} style={styles.daySpace} />
              </View>;
            })}
          </View>)}
        </View>;
      }} />
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: 24 },
  month: { marginBottom: 28 },
  monthTitle: { marginHorizontal: 12, marginTop: 16, marginBottom: 12, color: colors.ink, fontSize: 20, fontWeight: '600' },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, color: colors.muted, fontSize: 11, textAlign: 'center', paddingVertical: 8 },
  day: { flex: 1, minWidth: 0, minHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline,
    backgroundColor: colors.surface, paddingHorizontal: 2, paddingBottom: 4 },
  dateButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dateCircle: { minWidth: 28, minHeight: 28, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  today: { backgroundColor: colors.accent },
  dayNumber: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  outsideMonth: { color: colors.muted },
  todayText: { color: colors.onAccent },
  event: { minHeight: 30, paddingHorizontal: 3, paddingVertical: 3, marginBottom: 3,
    borderRadius: 2, backgroundColor: colors.paper },
  eventTitle: { color: colors.ink, fontSize: 10, lineHeight: 13 },
  daySpace: { flex: 1, minHeight: 12 },
});
