import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { MinuteEditor } from '../components/MinuteEditor';
import { deleteMinuteEntry, getDayEntries, saveMinuteRange } from '../data/database';
import {
  createPlanInSystemCalendar,
  flushPendingActuals,
  loadPlannedEvents,
  openPlannedEvent,
} from '../services/calendar';
import { categoryById, colors } from '../theme';
import { getAccounts } from '../sync/accounts';
import { linkActualsToAccounts, loadAccountPlans, synchronizeAccounts } from '../sync/engine';
import type {
  CalendarPreferences,
  DeviceCalendar,
  MinuteEntry,
  PlannedEvent,
} from '../types';
import {
  addDays,
  calendarMinuteRange,
  dateKey,
  formatDayHeading,
  localDateAtMinute,
  MINUTES_PER_DAY,
  minuteIndexForDate,
  minuteLabel,
} from '../utils/time';

const ROW_HEIGHT = 50;
const MINUTE_ITEMS = Array.from({ length: MINUTES_PER_DAY }, (_, index) => index);

type FocusRequest = { dateKey: string; minuteIndex: number; token: number } | null;

type Props = {
  activeDate: string;
  onDateChange: (value: string) => void;
  calendars: DeviceCalendar[];
  preferences: CalendarPreferences;
  dataVersion: number;
  focusRequest: FocusRequest;
  onFocusConsumed: () => void;
  onDataChanged: () => void;
  onOpenSettings: () => void;
};

export function TodayScreen({
  activeDate,
  onDateChange,
  calendars,
  preferences,
  dataVersion,
  focusRequest,
  onFocusConsumed,
  onDataChanged,
  onOpenSettings,
}: Props) {
  const listRef = useRef<FlatList<number>>(null);
  const activeDateRef = useRef(activeDate);
  const loadTokenRef = useRef(0);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncDatesRef = useRef(new Set<string>());
  const projectionChainRef = useRef<Promise<void>>(Promise.resolve());
  const projectionMessageTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const appStateRef = useRef(AppState.currentState);
  const [entries, setEntries] = useState<MinuteEntry[]>([]);
  const [plans, setPlans] = useState<PlannedEvent[]>([]);
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('Saved locally');
  const [calendarReadError, setCalendarReadError] = useState(false);
  const [now, setNow] = useState(() => new Date());

  activeDateRef.current = activeDate;

  const projectionConfigRef = useRef({
    enabled: preferences.syncActuals,
    calendarId: preferences.writeCalendarId,
  });
  projectionConfigRef.current = {
    enabled: preferences.syncActuals,
    calendarId: preferences.writeCalendarId,
  };

  const reload = useCallback(async () => {
    const requestedDate = activeDate;
    const token = ++loadTokenRef.current;
    let planLoadFailed = false;
    const [saved, planned] = await Promise.all([
      getDayEntries(requestedDate),
      Promise.allSettled([
        loadPlannedEvents(preferences.selectedCalendarIds, requestedDate, calendars),
        loadAccountPlans(requestedDate),
      ]).then((results) => {
        planLoadFailed = results.some((result) => result.status === 'rejected');
        return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
      }),
    ]);
    if (token !== loadTokenRef.current || requestedDate !== activeDateRef.current) return false;
    setEntries(saved);
    setPlans(planned);
    setCalendarReadError(planLoadFailed);
    return true;
  }, [activeDate, calendars, preferences.selectedCalendarIds]);

  useEffect(() => {
    loadTokenRef.current += 1;
    setSelectedMinute(null);
    setEntries([]);
    setPlans([]);
    setCalendarReadError(false);
    setRefreshing(false);
  }, [activeDate]);

  useEffect(() => {
    void reload();
  }, [dataVersion, reload]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const updateAtMinuteBoundary = () => {
      const current = new Date();
      setNow(current);
      const delay =
        60_000 - current.getSeconds() * 1_000 - current.getMilliseconds() + 25;
      timer = setTimeout(updateAtMinuteBoundary, delay);
    };
    updateAtMinuteBoundary();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasAway = appStateRef.current !== 'active';
      appStateRef.current = nextState;
      if (nextState === 'active' && wasAway) {
        setNow(new Date());
        void reload();
      }
    });
    return () => subscription.remove();
  }, [reload]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadTokenRef.current += 1;
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
        const queuedDates = [...pendingSyncDatesRef.current];
        pendingSyncDatesRef.current.clear();
        const config = projectionConfigRef.current;
        if (config.enabled && config.calendarId && queuedDates.length > 0) {
          projectionChainRef.current = projectionChainRef.current
            .then(
              async () =>
                void (await flushPendingActuals(config.calendarId!, queuedDates)),
            )
            .catch(() => {
              // Local SQLite remains authoritative if the app closes before projection finishes.
            });
        }
      }
    };
  }, []);

  const entriesByMinute = useMemo(
    () => new Map(entries.map((entry) => [entry.minuteIndex, entry])),
    [entries],
  );

  const plansByMinute = useMemo(() => {
    const map = new Map<number, PlannedEvent[]>();
    for (const plan of plans) {
      if (plan.allDay) continue;
      const range = calendarMinuteRange(plan.startDate, plan.endDate, activeDate);
      if (!range) continue;
      for (let minute = range.startMinute; minute < range.endMinuteExclusive; minute += 1) {
        const list = map.get(minute) ?? [];
        list.push(plan);
        map.set(minute, list);
      }
    }
    return map;
  }, [activeDate, plans]);

  const today = dateKey(now);
  const currentMinute = activeDate === today ? minuteIndexForDate(now) : -1;

  const jumpToMinute = useCallback((minute: number) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: Math.max(0, minute - 3), animated: true });
    });
  }, []);

  useEffect(() => {
    if (activeDate === today) jumpToMinute(currentMinute);
    // Scroll when the viewed date changes, but do not pull the user back every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDate, jumpToMinute, today]);

  useEffect(() => {
    if (!focusRequest || focusRequest.dateKey !== activeDate) return;
    jumpToMinute(focusRequest.minuteIndex);
    setSelectedMinute(focusRequest.minuteIndex);
    onFocusConsumed();
  }, [activeDate, focusRequest, jumpToMinute, onFocusConsumed]);

  const queueCalendarProjection = useCallback((dates: string[]) => {
    const config = projectionConfigRef.current;
    const messageToken = ++projectionMessageTokenRef.current;
    if (!config.enabled || !config.calendarId) {
      pendingSyncDatesRef.current.clear();
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
      setSyncMessage('Saved locally');
      return;
    }

    for (const value of dates) pendingSyncDatesRef.current.add(value);
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    setSyncMessage('Saved locally · calendar copy pending');

    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      const queuedDates = [...pendingSyncDatesRef.current];
      pendingSyncDatesRef.current.clear();

      const project = async () => {
        const latestConfig = projectionConfigRef.current;
        if (!latestConfig.enabled || !latestConfig.calendarId) {
          if (mountedRef.current && messageToken === projectionMessageTokenRef.current) {
            setSyncMessage('Saved locally');
          }
          return;
        }
        if (mountedRef.current && messageToken === projectionMessageTokenRef.current) {
          setSyncMessage('Copying actuals to calendar…');
        }
        try {
          const result = await flushPendingActuals(latestConfig.calendarId, queuedDates);
          if (mountedRef.current && messageToken === projectionMessageTokenRef.current) {
            setSyncMessage(
              result.failed > 0 || result.remaining > 0
                ? 'Saved locally · calendar copy retry needed'
                : result.attempted > 0
                  ? 'Actuals copied to calendar'
                  : 'Calendar actuals current',
            );
          }
        } catch {
          if (mountedRef.current && messageToken === projectionMessageTokenRef.current) {
            setSyncMessage('Saved locally · calendar copy retry needed');
          }
        }
      };

      projectionChainRef.current = projectionChainRef.current.then(project, project);
    }, 700);
  }, []);

  function refreshLocalEntries(value: string) {
    const token = ++loadTokenRef.current;
    void getDayEntries(value)
      .then((saved) => {
        if (token === loadTokenRef.current && value === activeDateRef.current) {
          setEntries(saved);
        }
      })
      .catch(() => {
        // The committed save remains in SQLite; the next normal reload will refresh the view.
      });
  }

  async function save(text: string, categoryId: string, durationMinutes: number, replacePlan: boolean,
    sourceScope: 'occurrence' | 'series') {
    if (selectedMinute == null) return;
    if (replacePlan && selectedPlan?.accountEvent) {
      const connected = (await getAccounts()).find((account) => account.id === selectedPlan.accountEvent!.accountId);
      if (!connected?.consent.calendarWrite || !connected.consent.replaceOccurrences) {
        throw new Error('Allow source occurrence changes under Settings → Accounts, or turn off plan replacement.');
      }
      if (sourceScope === 'series' && !connected.consent.editSeries) {
        throw new Error('Allow recurring-series changes for this account before selecting that scope.');
      }
      if (selectedPlan.accountEvent.event.isInvitation && !connected.consent.editInvitations) {
        throw new Error('Allow invitation changes for this account before changing the source meeting.');
      }
      if (selectedPlan.accountEvent.event.canEdit === false) {
        throw new Error('The source provider does not allow editing this event. Turn off source replacement to record a separate actual.');
      }
    }
    const targetDate = activeDate;
    const affectedDates = await saveMinuteRange({
      dateKey: targetDate,
      startMinute: selectedMinute,
      durationMinutes,
      text,
      categoryId,
    });
    refreshLocalEntries(targetDate);
    try {
      await linkActualsToAccounts(affectedDates, replacePlan ? selectedPlan : null,
        { dateKey: targetDate, minuteIndex: selectedMinute }, sourceScope);
    } catch {
      setSyncMessage('Saved locally · account link needs review');
    }
    onDataChanged();
    void synchronizeAccounts();
    queueCalendarProjection(affectedDates);
  }

  async function remove() {
    if (selectedMinute == null) return;
    const targetDate = activeDate;
    await deleteMinuteEntry(targetDate, selectedMinute);
    refreshLocalEntries(targetDate);
    await linkActualsToAccounts([targetDate], null, { dateKey: targetDate, minuteIndex: selectedMinute });
    onDataChanged();
    void synchronizeAccounts();
    queueCalendarProjection([targetDate]);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const didApply = await reload();
      if (didApply) setSyncMessage('Calendar plans refreshed');
    } finally {
      if (activeDate === activeDateRef.current) setRefreshing(false);
    }
  }

  async function createPlan() {
    const suggestedMinute = activeDate === today ? currentMinute : 9 * 60;
    setSyncMessage('Opening phone calendar…');
    try {
      await createPlanInSystemCalendar(activeDate, suggestedMinute);
      await reload();
      setSyncMessage('Calendar plans refreshed');
    } catch {
      setSyncMessage('Could not open phone calendar');
    }
  }

  async function openPlan(plan: PlannedEvent) {
    setSyncMessage('Opening calendar plan…');
    try {
      if (plan.accountEvent) {
        const account = (await getAccounts()).find((item) => item.id === plan.accountEvent!.accountId);
        await Linking.openURL(account?.provider === 'microsoft'
          ? 'https://outlook.office.com/calendar/' : 'https://calendar.google.com/calendar/');
      } else await openPlannedEvent(plan);
      await reload();
      setSyncMessage('Calendar plans refreshed');
    } catch {
      setSyncMessage('Could not open calendar plan');
    }
  }

  const selectedEntry = selectedMinute == null ? null : entriesByMinute.get(selectedMinute) ?? null;
  const selectedPlan = selectedMinute == null ? null : plansByMinute.get(selectedMinute)?.[0] ?? null;
  const selectedPlanDuration =
    selectedMinute == null || !selectedPlan || selectedEntry
      ? null
      : Math.max(
          1,
          Math.min(
            MINUTES_PER_DAY,
            Math.ceil(
              (selectedPlan.endDate.getTime() -
                localDateAtMinute(activeDate, selectedMinute).getTime()) /
                60_000,
            ),
          ),
        );
  const allDayPlans = plans.filter((plan) => plan.allDay);

  return (
    <View style={styles.container}>
      <View style={styles.dayHeader}>
        <Pressable
          accessibilityLabel="Previous day"
          onPress={() => onDateChange(dateKey(addDays(activeDate, -1)))}
          style={styles.dayArrow}
        >
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>
        <Pressable onPress={() => onDateChange(today)} style={styles.dayTitleWrap}>
          <Text style={styles.dayTitle}>{formatDayHeading(activeDate)}</Text>
          <Text style={styles.dayMeta}>
            {entries.length} recorded minutes ·{' '}
            {calendarReadError ? 'Calendar plans unavailable' : syncMessage}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Next day"
          onPress={() => onDateChange(dateKey(addDays(activeDate, 1)))}
          style={styles.dayArrow}
        >
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
      </View>

      {preferences.selectedCalendarIds.length === 0 ? (
        <Pressable onPress={onOpenSettings} style={styles.connectBanner}>
          <View>
            <Text style={styles.connectTitle}>Connect your calendars</Text>
            <Text style={styles.connectBody}>Bring your existing plans into the minute ledger.</Text>
          </View>
          <Text style={styles.connectAction}>Set up</Text>
        </Pressable>
      ) : null}

      {allDayPlans.length ? (
        <View style={styles.allDayRow}>
          <Text style={styles.allDayLabel}>ALL DAY</Text>
          <Text numberOfLines={1} style={styles.allDayText}>
            {allDayPlans.map((plan) => plan.title).join(' · ')}
          </Text>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={MINUTE_ITEMS}
        keyExtractor={(minute) => minute.toString()}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        initialNumToRender={28}
        maxToRenderPerBatch={36}
        windowSize={17}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ink} />}
        onScrollToIndexFailed={({ index }) => {
          listRef.current?.scrollToOffset({ offset: index * ROW_HEIGHT, animated: false });
        }}
        renderItem={({ item: minute }) => {
          const entry = entriesByMinute.get(minute);
          const minutePlans = plansByMinute.get(minute) ?? [];
          const plan = minutePlans[0];
          const category = entry ? categoryById(entry.categoryId) : null;
          const isNow = minute === currentMinute;
          return (
            <Pressable
              onPress={() => setSelectedMinute(minute)}
              style={[styles.minuteRow, isNow && styles.currentMinuteRow]}
            >
              <View style={styles.timeRail}>
                <Text style={[styles.minuteTime, isNow && styles.currentMinuteText]}>
                  {minuteLabel(minute)}
                </Text>
                {isNow ? <View style={styles.nowDot} /> : null}
              </View>
              <View style={styles.cell}>
                {entry ? (
                  <>
                    <View style={[styles.activityBar, { backgroundColor: category?.color }]} />
                    <Text numberOfLines={1} style={styles.entryText}>{entry.text}</Text>
                    <Text style={styles.categoryName}>{category?.name}</Text>
                  </>
                ) : plan ? (
                  <>
                    <View style={[styles.planBar, { backgroundColor: plan.color }]} />
                    <Text numberOfLines={1} style={styles.planText}>{plan.title}</Text>
                    {minutePlans.length > 1 ? (
                      <Text style={styles.overlap}>+{minutePlans.length - 1}</Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.emptyPrompt}>Tap to record</Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />

      {activeDate === today ? (
        <Pressable onPress={() => jumpToMinute(currentMinute)} style={styles.nowButton}>
          <Text style={styles.nowButtonText}>Now</Text>
        </Pressable>
      ) : (
        <Pressable onPress={() => onDateChange(today)} style={styles.nowButton}>
          <Text style={styles.nowButtonText}>Today</Text>
        </Pressable>
      )}

      <Pressable
        accessibilityLabel="Create a plan in your phone calendar"
        onPress={() => void createPlan()}
        style={styles.planButton}
      >
        <Text style={styles.planButtonText}>+ Plan</Text>
      </Pressable>

      <MinuteEditor
        visible={selectedMinute != null}
        dateKey={activeDate}
        minuteIndex={selectedMinute ?? 0}
        entry={selectedEntry}
        plan={selectedPlan}
        planDurationMinutes={selectedPlanDuration}
        onClose={() => setSelectedMinute(null)}
        onSave={save}
        onDelete={remove}
        onOpenPlan={selectedPlan ? () => openPlan(selectedPlan) : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.paper,
  },
  dayArrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  arrowText: { color: colors.ink, fontSize: 34, fontWeight: '300' },
  dayTitleWrap: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  dayTitle: { color: colors.ink, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  dayMeta: { marginTop: 3, color: colors.muted, fontSize: 11, textAlign: 'center' },
  connectBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    margin: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.graphite,
  },
  connectTitle: { color: colors.white, fontSize: 14, fontWeight: '700' },
  connectBody: { marginTop: 2, color: '#D6D3CC', fontSize: 12 },
  connectAction: { marginLeft: 12, color: colors.white, fontSize: 13, fontWeight: '700' },
  allDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.panel,
  },
  allDayLabel: { width: 62, color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  allDayText: { flex: 1, color: colors.graphite, fontSize: 12 },
  minuteRow: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  currentMinuteRow: { backgroundColor: '#F1EEE7' },
  timeRail: {
    width: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 10,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.hairline,
  },
  minuteTime: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  currentMinuteText: { color: colors.ink, fontWeight: '700' },
  nowDot: { width: 5, height: 5, marginLeft: 5, borderRadius: 3, backgroundColor: colors.ink },
  cell: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 12 },
  activityBar: { alignSelf: 'stretch', width: 5, marginRight: 10 },
  planBar: { alignSelf: 'stretch', width: 3, marginRight: 10, opacity: 0.68 },
  entryText: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '500' },
  categoryName: { marginLeft: 8, color: colors.muted, fontSize: 10 },
  planText: { flex: 1, color: colors.muted, fontSize: 13 },
  overlap: { color: colors.muted, fontSize: 10 },
  emptyPrompt: { marginLeft: 12, color: '#B0ADA6', fontSize: 12 },
  nowButton: {
    position: 'absolute',
    right: 16,
    bottom: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.ink,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  nowButtonText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  planButton: {
    position: 'absolute',
    left: 16,
    bottom: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 20,
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 3,
  },
  planButtonText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
});
