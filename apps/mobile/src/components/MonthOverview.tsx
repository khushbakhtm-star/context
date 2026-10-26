import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../appearance';
import { getDaySegments } from '../data/database';
import { loadPlannedEventsResult } from '../services/calendar';
import { loadAccountPlans } from '../sync/engine';
import type { AppColors } from '../theme';
import type { CalendarPreferences, DeviceCalendar } from '../types';
import { isDateKey, monthDateCells, normalizeSelectedDates } from '../utils/date-selection';
import { monthAgendaItems, type MonthAgendaItem } from '../utils/month-agenda';
import { addDays, dateKey, formatDayHeading, minuteIndexForDate, minuteLabel, parseDateKey } from '../utils/time';
import { InfoButton } from './InfoButton';
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
};
type DayState = { items: MonthAgendaItem[]; failed: boolean };

export function MonthOverview({ activeDate, focusRequest, selectedDates, calendars, preferences, dataVersion, clockFormat, onOpenMinute,
  onVisibleMonthChange }: Props) {
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
  const [retry, setRetry] = useState(0);
  const requestMonths = useRef<(months: string[]) => void>(() => {});
  const visibleMonths = useRef<string[]>([]);
  const visibleMonthCallback = useRef(onVisibleMonthChange);
  visibleMonthCallback.current = onVisibleMonthChange;
  const calendarKey = JSON.stringify(calendars);
  const preferenceKey = JSON.stringify(preferences.selectedCalendarIds);
  const viewability = useRef({ itemVisiblePercentThreshold: 5 }).current;
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
    let running = 0;
    const queue: string[] = [];
    const queued = new Set<string>();
    setData({});
    async function readDay(day: string) {
      const results = await Promise.allSettled([
        getDaySegments(day), loadPlannedEventsResult(preferences.selectedCalendarIds, day, calendars), loadAccountPlans(day),
      ]);
      const [actualResult, deviceResult, accountResult] = results;
      const segments = actualResult.status === 'fulfilled' ? actualResult.value : [];
      const plans = [
        ...(deviceResult.status === 'fulfilled' ? deviceResult.value.plans : []),
        ...(accountResult.status === 'fulfilled' ? accountResult.value : []),
      ];
      const failed = results.some((result) => result.status === 'rejected') ||
        (deviceResult.status === 'fulfilled' && deviceResult.value.failures.length > 0);
      if (!cancelled) setData((current) => cancelled ? current : {
        ...current, [day]: { items: monthAgendaItems(day, segments, plans), failed },
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
    const enqueueMonths = (requested: string[]) => {
      if (cancelled) return;
      const requestedSet = new Set(requested);
      for (const day of days) {
        if (!requestedSet.has(day.slice(0, 7)) || queued.has(day)) continue;
        queued.add(day); queue.push(day);
      }
      pump();
    };
    requestMonths.current = enqueueMonths;
    const visible = visibleMonths.current.filter((month) => months.includes(month));
    enqueueMonths(visible.length ? visible : months.slice(0, 1));
    return () => { cancelled = true; queue.length = 0; };
  }, [daysKey, calendarKey, preferenceKey, dataVersion, retry]);

  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(addDays('2026-10-19', index))), []);
  const today = dateKey(new Date());
  const failed = Object.values(data).some((day) => day.failed);
  const openDay = (day: string) => {
    if (isDateKey(day)) onOpenMinute(day, day === dateKey(new Date()) ? minuteIndexForDate(new Date()) : 9 * 60);
  };

  return <View style={styles.container}>
    {failed ? <View style={styles.errorRow}>
      <Text accessibilityRole="alert" style={styles.error}>Some events could not load</Text>
      <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)} style={styles.retry}>
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
      <InfoButton title="Month events" message="The overview shows the available calendar events and recorded activity blocks for your selected dates. Some sources could not be read. Retry, or check the selected calendars and account connection in Settings. Tap a day or event to open its minute cells." />
    </View> : null}
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
              return <View key={cell.dateKey} style={[styles.day, !active && styles.unselectedDay]}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Open ${heading}`} disabled={!isDateKey(cell.dateKey)}
                  accessibilityState={{ selected: cell.dateKey === activeDate }}
                  onPress={() => openDay(cell.dateKey)} style={styles.dateButton}>
                  <View style={[styles.dateCircle, active && styles.selectedDate, cell.dateKey === activeDate && styles.focusedDate, cell.dateKey === today && styles.today]}>
                    <Text maxFontSizeMultiplier={1.5} style={[styles.dayNumber, !cell.inMonth && styles.outsideMonth,
                      cell.dateKey === today && styles.todayText]}>{cell.day}</Text>
                  </View>
                </Pressable>
                {items.slice(0, 3).map((item) => {
                  const time = item.allDay ? 'All day' : minuteLabel(item.startMinute, clockFormat === '12h');
                  return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${heading}, ${time}, ${item.title}`}
                    onPress={() => onOpenMinute(cell.dateKey, item.startMinute)}
                    style={[styles.event, { borderLeftColor: item.color }]}>
                    <Text numberOfLines={1} maxFontSizeMultiplier={1.5} style={styles.eventTime}>{time}</Text>
                    <Text numberOfLines={2} maxFontSizeMultiplier={1.5} style={styles.eventTitle}>{item.title}</Text>
                  </Pressable>;
                })}
                {items.length > 3 ? <Pressable accessibilityRole="button" accessibilityLabel={`${items.length - 3} more events on ${heading}`}
                  onPress={() => openDay(cell.dateKey)} style={styles.more}>
                  <Text style={styles.moreText}>+{items.length - 3}</Text>
                </Pressable> : null}
                {active && !state ? <Text accessibilityLabel={`Loading ${heading}`} style={styles.pending}>…</Text> : null}
                {state?.failed ? <Text accessibilityLabel={`Some events unavailable on ${heading}`} style={styles.failed}>!</Text> : null}
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
  unselectedDay: { backgroundColor: colors.panel, opacity: 0.55 },
  dateButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dateCircle: { minWidth: 28, minHeight: 28, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  selectedDate: { backgroundColor: colors.selectedDay },
  focusedDate: { borderWidth: 1.5, borderColor: colors.graphite },
  today: { backgroundColor: colors.accent },
  dayNumber: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  outsideMonth: { color: colors.muted },
  todayText: { color: colors.onAccent },
  event: { minHeight: 44, paddingLeft: 3, paddingVertical: 3, marginBottom: 3, borderLeftWidth: 3,
    borderRadius: 2, backgroundColor: colors.paper },
  eventTime: { color: colors.muted, fontSize: 9, lineHeight: 12 },
  eventTitle: { color: colors.ink, fontSize: 10, lineHeight: 13 },
  more: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 3 },
  moreText: { color: colors.graphite, fontSize: 11 },
  daySpace: { flex: 1, minHeight: 12 },
  pending: { color: colors.muted, textAlign: 'center', fontSize: 14 },
  failed: { color: colors.danger, textAlign: 'center', fontSize: 12 },
  errorRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 4, gap: 4 },
  error: { flex: 1, color: colors.danger, fontSize: 12 },
  retry: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  retryText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
});
