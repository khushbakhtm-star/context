import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  AppState, FlatList, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../appearance';
import { MinuteEditor } from '../components/MinuteEditor';
import { deleteMinuteEntry, getDayEntries, getMinuteEntry, saveMinuteRange } from '../data/database';
import { flushPendingActuals, loadPlannedEvents, openPlannedEvent } from '../services/calendar';
import { listCategories } from '../services/categories';
import { flushInlineMinutes, inlineMinuteDrafts, subscribeInlineMinuteCommits,
  subscribeInlineMinuteLinkWarnings } from '../services/inline-minutes';
import { CATEGORIES, categoryById, type ActivityCategory, type AppColors } from '../theme';
import { inlineMinuteKey } from '../utils/inline-minute-drafts';
import { getAccounts } from '../sync/accounts';
import { linkActualsToAccounts, loadAccountPlans, synchronizeAccounts } from '../sync/engine';
import type { CalendarPreferences, DeviceCalendar, MinuteEntry, PlannedEvent } from '../types';
import {
  calendarEntriesAreCurrent, calendarLoadIsCurrent, calendarSelectionIsCurrent, indexCalendarDay,
  loadCalendarMinuteSelection, parseCalendarDateInput, visibleCalendarDates,
  type CalendarDayCount, type CalendarMinuteSelection,
} from '../utils/calendar-grid';
import {
  addDays, dateKey, formatDayHeading, MINUTES_PER_DAY, minuteIndexForDate, minuteLabel, parseDateKey,
} from '../utils/time';

const ROW_HEIGHT = 44;
const MINUTE_ITEMS = Array.from({ length: MINUTES_PER_DAY }, (_, index) => index);
const DAY_COUNTS: CalendarDayCount[] = [1, 3, 7];

type FocusRequest = { dateKey: string; minuteIndex: number; token: number; openEditor?: boolean } | null;
type DayData = { entries: MinuteEntry[]; plans: PlannedEvent[]; calendarReadError: boolean };
type Props = {
  activeDate: string;
  onDateChange: (value: string) => void;
  calendars: DeviceCalendar[];
  preferences: CalendarPreferences;
  dataVersion: number;
  focusRequest: FocusRequest;
  onFocusConsumed: (token?: number) => void;
  onDataChanged: () => void;
  onOpenSettings: () => void;
  dayCount?: CalendarDayCount;
  onDayCountChange?: (count: CalendarDayCount) => void;
  onOpenMenu?: () => void;
  planRequest?: number;
};

export function TodayScreen({
  activeDate, onDateChange, calendars, preferences, dataVersion, focusRequest,
  onFocusConsumed, onDataChanged, onOpenSettings, dayCount = 1, onDayCountChange, onOpenMenu,
}: Props) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const days = useMemo(() => visibleCalendarDates(activeDate, dayCount), [activeDate, dayCount]);
  const dayLabels = useMemo(() => new Map(days.map((day) => [day, formatDayHeading(day)])), [days]);
  const rangeKey = days.join('|');
  const rangeRef = useRef(rangeKey);
  const visibleDaysRef = useRef(days);
  const listRef = useRef<FlatList<number>>(null);
  const loadTokenRef = useRef(0);
  const selectionTokenRef = useRef(0);
  const focusTokenRef = useRef<number | null>(null);
  const currentFocusRef = useRef(focusRequest);
  const localEpochsRef = useRef(new Map<string, number>());
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncDatesRef = useRef(new Set<string>());
  const projectionChainRef = useRef<Promise<void>>(Promise.resolve());
  const projectionMessageTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const appStateRef = useRef(AppState.currentState);
  const [dayData, setDayData] = useState<Record<string, DayData>>({});
  const [editor, setEditor] = useState<CalendarMinuteSelection | null>(null);
  const [inlineSelection, setInlineSelection] = useState<CalendarMinuteSelection | null>(null);
  const inlineSelectionRef = useRef(inlineSelection);
  const inlineInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [inlineVersion, setInlineVersion] = useState(0);
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  const [availableColors, setAvailableColors] = useState<ActivityCategory[]>(() => CATEGORIES.filter((item) => !item.archived));
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [projectionWarning, setProjectionWarning] = useState<string | null>(null);
  const [accountWarning, setAccountWarning] = useState<string | null>(null);
  const [inlineLinkWarning, setInlineLinkWarning] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [dateInputOpen, setDateInputOpen] = useState(false);
  const [dateInput, setDateInput] = useState('');
  const [dateInputError, setDateInputError] = useState(false);
  const dayDataRef = useRef(dayData);
  const editorRef = useRef(editor);
  const clockDayRef = useRef(dateKey(now));
  const pendingRolloverRef = useRef<{ from: string; to: string } | null>(null);
  rangeRef.current = rangeKey;
  visibleDaysRef.current = days;
  dayDataRef.current = dayData;
  editorRef.current = editor;
  inlineSelectionRef.current = inlineSelection;
  currentFocusRef.current = focusRequest;

  const projectionConfigRef = useRef({ enabled: preferences.syncActuals, calendarId: preferences.writeCalendarId });
  projectionConfigRef.current = { enabled: preferences.syncActuals, calendarId: preferences.writeCalendarId };

  const reload = useCallback(async () => {
    const requestedRange = rangeKey;
    const requestedDays = [...days];
    const epochs = new Map(requestedDays.map((day) => [day, localEpochsRef.current.get(day) ?? 0]));
    const token = ++loadTokenRef.current;
    const request = { rangeKey: requestedRange, token, entryEpochs: epochs };
    const currentLoadState = () => ({ mounted: mountedRef.current, rangeKey: rangeRef.current,
      token: loadTokenRef.current });
    const results = await Promise.allSettled(requestedDays.map(async (day) => {
      const [entries, planResults] = await Promise.all([
        getDayEntries(day),
        Promise.allSettled([
          loadPlannedEvents(preferences.selectedCalendarIds, day, calendars), loadAccountPlans(day),
        ]),
      ]);
      return { day, entries, plans: planResults.flatMap((result) => result.status === 'fulfilled' ? result.value : []),
        calendarReadError: planResults.some((result) => result.status === 'rejected') };
    }));
    if (!calendarLoadIsCurrent(request, currentLoadState())) return false;
    setDayData((previous) => {
      if (!calendarLoadIsCurrent(request, currentLoadState())) return previous;
      const next: Record<string, DayData> = {};
      for (const day of requestedDays) if (previous[day]) next[day] = previous[day]!;
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const value = result.value;
        const entriesStillCurrent = calendarEntriesAreCurrent(value.day, request, localEpochsRef.current);
        next[value.day] = { entries: entriesStillCurrent ? value.entries : previous[value.day]?.entries ?? [],
          plans: value.plans, calendarReadError: value.calendarReadError };
      }
      return next;
    });
    setLoadError(results.some((result) => result.status === 'rejected'));
    return true;
  }, [rangeKey, days, calendars, preferences.selectedCalendarIds]);

  useEffect(() => {
    loadTokenRef.current += 1;
    selectionTokenRef.current += 1;
    const previous = inlineSelectionRef.current;
    if (previous) inlineMinuteDrafts.close(inlineMinuteKey(previous.dateKey, previous.minuteIndex));
    setInlineSelection(null);
    setColorPanelOpen(false);
    Keyboard.dismiss();
    setLoadError(false);
    setRefreshing(false);
  }, [rangeKey]);

  useEffect(() => inlineMinuteDrafts.subscribe(() => setInlineVersion((value) => value + 1)), []);
  useEffect(() => subscribeInlineMinuteLinkWarnings(setInlineLinkWarning), []);

  useEffect(() => {
    let current = true;
    void listCategories(false).then((values) => { if (current) setAvailableColors(values); }).catch(() => {});
    return () => { current = false; };
  }, [dataVersion, colorPanelOpen]);

  const inlineDrafts = useMemo(() => inlineMinuteDrafts.snapshot(), [inlineVersion]);
  const draftsByKey = useMemo(() => new Map(inlineDrafts.map((draft) => [draft.key, draft])), [inlineDrafts]);
  const inlineError = inlineDrafts.some((draft) => draft.error);

  useEffect(() => { void reload(); }, [dataVersion, reload]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const updateAtMinuteBoundary = () => {
      const current = new Date();
      setNow(current);
      timer = setTimeout(updateAtMinuteBoundary,
        60_000 - current.getSeconds() * 1_000 - current.getMilliseconds() + 25);
    };
    updateAtMinuteBoundary();
    return () => { if (timer) clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const wasAway = appStateRef.current !== 'active';
      appStateRef.current = state;
      if (state !== 'active') {
        const selected = inlineSelectionRef.current;
        if (selected) inlineMinuteDrafts.close(inlineMinuteKey(selected.dateKey, selected.minuteIndex));
        setInlineSelection(null);
        setColorPanelOpen(false);
      }
      if (state === 'active' && wasAway) { setNow(new Date()); void reload(); }
    });
    return () => subscription.remove();
  }, [reload]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadTokenRef.current += 1;
      selectionTokenRef.current += 1;
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
        const queuedDates = [...pendingSyncDatesRef.current];
        pendingSyncDatesRef.current.clear();
        const config = projectionConfigRef.current;
        if (config.enabled && config.calendarId && queuedDates.length) {
          projectionChainRef.current = projectionChainRef.current
            .then(async () => void (await flushPendingActuals(config.calendarId!, queuedDates)))
            .catch(() => { /* The durable outbox retains work if the screen closes. */ });
        }
      }
    };
  }, []);

  const indexedDays = useMemo(() => new Map(days.map((day) => {
    const data = dayData[day];
    return [day, indexCalendarDay(day, data?.entries ?? [], data?.plans ?? [])];
  })), [days, dayData]);
  const today = dateKey(now);
  const currentMinute = minuteIndexForDate(now);
  const calendarReadError = days.some((day) => dayData[day]?.calendarReadError);
  const hasAllDay = days.some((day) => dayData[day]?.plans.some((plan) => plan.allDay));

  useEffect(() => {
    if (clockDayRef.current !== today) {
      if (activeDate === clockDayRef.current) pendingRolloverRef.current = { from: activeDate, to: today };
      clockDayRef.current = today;
    }
    const pending = pendingRolloverRef.current;
    if (!pending) return;
    if (activeDate !== pending.from) { pendingRolloverRef.current = null; return; }
    // Follow the current day after midnight, but finish any dated draft or date selection first.
    if (!editor && !inlineSelection && !dateInputOpen) {
      pendingRolloverRef.current = null;
      onDateChange(pending.to);
    }
  }, [activeDate, today, editor, inlineSelection, dateInputOpen, onDateChange]);

  const jumpToMinute = useCallback((minute: number) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: Math.max(0, Math.min(1439, minute - 3)), animated: false });
    });
  }, []);

  useEffect(() => {
    if (!editorRef.current) jumpToMinute(visibleDaysRef.current.includes(dateKey(new Date()))
      ? minuteIndexForDate(new Date()) : 9 * 60);
    // Changing the viewed range positions the ledger; refreshes and clock ticks do not move it.
  }, [rangeKey, jumpToMinute]);

  const openMinute = useCallback(async (day: string, minute: number) => {
    const token = ++selectionTokenRef.current;
    const requestedRange = rangeRef.current;
    const request = { dateKey: day, minuteIndex: minute, rangeKey: requestedRange, token };
    const currentSelectionState = () => ({ mounted: mountedRef.current, rangeKey: rangeRef.current,
      token: selectionTokenRef.current, visibleDays: visibleDaysRef.current });
    try {
      // Read the local minute before opening so a fast tap during a calendar refresh cannot
      // initialize an existing entry as an empty draft. The editor keeps this dated snapshot.
      const selection = await loadCalendarMinuteSelection(request, {
        readEntry: getMinuteEntry,
        readPlans: (value) => dayDataRef.current[value]?.plans ?? [],
        currentState: currentSelectionState,
      });
      if (!selection || !calendarSelectionIsCurrent(request, currentSelectionState())) return;
      setActionError(null);
      setEditor((previous) => calendarSelectionIsCurrent(request, currentSelectionState()) ? selection : previous);
    } catch {
      if (mountedRef.current && token === selectionTokenRef.current) {
        setActionError('This minute could not be opened. Please try again.');
      }
    }
  }, []);

  const revealInlineMinute = useCallback((minute: number) => {
    requestAnimationFrame(() => listRef.current?.scrollToIndex({ index: minute, viewPosition: 0.3, animated: false }));
  }, []);

  const openInlineMinute = useCallback(async (day: string, minute: number, showColors = false) => {
    const token = ++selectionTokenRef.current;
    const request = { dateKey: day, minuteIndex: minute, rangeKey: rangeRef.current, token };
    const currentState = () => ({ mounted: mountedRef.current, rangeKey: rangeRef.current,
      token: selectionTokenRef.current, visibleDays: visibleDaysRef.current });
    try {
      const selection = await loadCalendarMinuteSelection(request, { readEntry: getMinuteEntry,
        readPlans: (value) => dayDataRef.current[value]?.plans ?? [], currentState });
      if (!selection || !calendarSelectionIsCurrent(request, currentState())) return;
      inlineMinuteDrafts.activate({ dateKey: day, minuteIndex: minute,
        text: selection.entry?.text ?? selection.plan?.title ?? '',
        categoryId: selection.entry?.categoryId ?? selection.plan?.categoryId ?? 'unaccounted',
        keepColor: Boolean(selection.entry && !selection.entry.text.trim()) });
      setActionError(null);
      setEditor(null);
      setInlineSelection(selection);
      setColorPanelOpen(showColors);
      if (showColors) Keyboard.dismiss();
      revealInlineMinute(minute);
    } catch {
      if (mountedRef.current && token === selectionTokenRef.current) setActionError('This minute could not be opened. Please try again.');
    }
  }, [revealInlineMinute]);

  useEffect(() => {
    if (inlineSelection && !colorPanelOpen) requestAnimationFrame(() => inlineInputRef.current?.focus());
  }, [inlineSelection?.dateKey, inlineSelection?.minuteIndex, colorPanelOpen]);

  useEffect(() => {
    const keyboard = Keyboard.addListener('keyboardDidShow', () => {
      const selected = inlineSelectionRef.current;
      if (selected) revealInlineMinute(selected.minuteIndex);
    });
    return () => keyboard.remove();
  }, [revealInlineMinute]);

  useEffect(() => subscribeInlineMinuteCommits((commit) => {
    markLocalChange(commit.affectedDates);
    setDayData((previous) => {
      const data = previous[commit.dateKey];
      if (!data || commit.readBackFailed) return previous;
      const entries = data.entries.filter((entry) => entry.minuteIndex !== commit.minuteIndex);
      if (commit.entry) entries.push(commit.entry);
      return { ...previous, [commit.dateKey]: { ...data, entries } };
    });
    for (const day of commit.affectedDates) refreshLocalEntries(day);
  }), []);

  useEffect(() => () => {
    const selection = inlineSelectionRef.current;
    if (selection) inlineMinuteDrafts.close(inlineMinuteKey(selection.dateKey, selection.minuteIndex));
    void flushInlineMinutes();
  }, []);

  async function showMinuteDetails(day: string, minute: number) {
    const token = ++selectionTokenRef.current;
    await inlineMinuteDrafts.flushAll();
    if (inlineMinuteDrafts.get(day, minute)?.error || token !== selectionTokenRef.current) return;
    inlineMinuteDrafts.close(inlineMinuteKey(day, minute));
    Keyboard.dismiss();
    setInlineSelection(null);
    setColorPanelOpen(false);
    await openMinute(day, minute);
  }

  useEffect(() => {
    if (!focusRequest || !days.includes(focusRequest.dateKey) || focusTokenRef.current === focusRequest.token) return;
    focusTokenRef.current = focusRequest.token;
    jumpToMinute(focusRequest.minuteIndex);
    const focusToken = focusRequest.token;
    if (focusRequest.openEditor === false) { onFocusConsumed(focusToken); return; }
    void openInlineMinute(focusRequest.dateKey, focusRequest.minuteIndex).finally(() => {
      if (currentFocusRef.current?.token === focusToken) onFocusConsumed(focusToken);
    });
  }, [days, focusRequest, jumpToMinute, openInlineMinute, onFocusConsumed]);

  const queueCalendarProjection = useCallback((values: string[]) => {
    const config = projectionConfigRef.current;
    const messageToken = ++projectionMessageTokenRef.current;
    if (!config.enabled || !config.calendarId) {
      pendingSyncDatesRef.current.clear();
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
      return;
    }
    for (const value of values) pendingSyncDatesRef.current.add(value);
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      const queuedDates = [...pendingSyncDatesRef.current];
      pendingSyncDatesRef.current.clear();
      const project = async () => {
        const latest = projectionConfigRef.current;
        if (!latest.enabled || !latest.calendarId) return;
        try {
          const result = await flushPendingActuals(latest.calendarId, queuedDates);
          if (mountedRef.current && messageToken === projectionMessageTokenRef.current) {
            setProjectionWarning(result.failed > 0 || result.remaining > 0 ? 'Calendar copy needs a retry.' : null);
          }
        } catch {
          if (mountedRef.current && messageToken === projectionMessageTokenRef.current) {
            setProjectionWarning('Calendar copy needs a retry.');
          }
        }
      };
      projectionChainRef.current = projectionChainRef.current.then(project, project);
    }, 700);
  }, []);

  function markLocalChange(values: string[]) {
    for (const value of values) localEpochsRef.current.set(value, (localEpochsRef.current.get(value) ?? 0) + 1);
  }

  function refreshLocalEntries(value: string) {
    const epoch = localEpochsRef.current.get(value) ?? 0;
    void getDayEntries(value).then((entries) => {
      if (!mountedRef.current || !visibleDaysRef.current.includes(value) ||
          (localEpochsRef.current.get(value) ?? 0) !== epoch) return;
      setDayData((previous) => {
        if (!visibleDaysRef.current.includes(value) || (localEpochsRef.current.get(value) ?? 0) !== epoch) return previous;
        return { ...previous, [value]: {
          entries, plans: previous[value]?.plans ?? [], calendarReadError: previous[value]?.calendarReadError ?? false,
        } };
      });
    }).catch(() => { /* The committed ledger entry remains durable and refresh can retry. */ });
  }

  async function save(text: string, categoryId: string, durationMinutes: number, replacePlan: boolean,
    sourceScope: 'occurrence' | 'series') {
    const selection = editor;
    if (!selection) return;
    const selectedPlan = selection.plan;
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
    const potentialDates = [selection.dateKey];
    if (selection.minuteIndex + durationMinutes > MINUTES_PER_DAY) {
      potentialDates.push(dateKey(addDays(selection.dateKey, 1)));
    }
    markLocalChange(potentialDates);
    const affectedDates = await saveMinuteRange({ dateKey: selection.dateKey,
      startMinute: selection.minuteIndex, durationMinutes, text, categoryId });
    for (const value of affectedDates) refreshLocalEntries(value);
    try {
      await linkActualsToAccounts(affectedDates, replacePlan ? selectedPlan : null,
        { dateKey: selection.dateKey, minuteIndex: selection.minuteIndex }, sourceScope);
      setAccountWarning(null);
    } catch { setAccountWarning('Account synchronization needs review.'); }
    onDataChanged();
    void synchronizeAccounts();
    queueCalendarProjection(affectedDates);
  }

  async function remove() {
    const selection = editor;
    if (!selection) return;
    markLocalChange([selection.dateKey]);
    await deleteMinuteEntry(selection.dateKey, selection.minuteIndex);
    refreshLocalEntries(selection.dateKey);
    await linkActualsToAccounts([selection.dateKey], null,
      { dateKey: selection.dateKey, minuteIndex: selection.minuteIndex });
    onDataChanged();
    void synchronizeAccounts();
    queueCalendarProjection([selection.dateKey]);
  }

  async function refresh() {
    const requestedRange = rangeRef.current;
    setRefreshing(true);
    try { await reload(); }
    finally { if (mountedRef.current && requestedRange === rangeRef.current) setRefreshing(false); }
  }

  async function openPlan(plan: PlannedEvent) {
    try {
      if (plan.accountEvent) {
        const account = (await getAccounts()).find((item) => item.id === plan.accountEvent!.accountId);
        await Linking.openURL(account?.provider === 'microsoft'
          ? 'https://outlook.office.com/calendar/' : 'https://calendar.google.com/calendar/');
      } else await openPlannedEvent(plan);
      await reload();
    } catch { setActionError('The calendar plan could not be opened.'); }
  }

  function goToEnteredDate() {
    const next = parseCalendarDateInput(dateInput);
    if (!next) { setDateInputError(true); return; }
    setDateInputError(false);
    setDateInputOpen(false);
    onDateChange(next);
  }

  const firstDay = parseDateKey(days[0]!);
  const lastDay = parseDateKey(days[days.length - 1]!);
  const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long' });
  const monthTitle = firstDay.getMonth() === lastDay.getMonth() && firstDay.getFullYear() === lastDay.getFullYear()
    ? monthFormat.format(firstDay) : monthFormat.format(firstDay) + ' – ' + monthFormat.format(lastDay);
  const notice = (inlineError ? 'A minute could not be saved. Tap to retry; your draft is kept.' : null) ?? actionError ??
    (inlineLinkWarning ? 'Account synchronization needs a retry. Your minute is saved.' : null) ?? accountWarning ?? projectionWarning ??
    (loadError ? 'Some ledger rows could not refresh. Pull down to retry.' :
      calendarReadError ? 'Some calendar plans could not load. Pull down to retry.' : null);
  const selectedDraft = inlineSelection
    ? draftsByKey.get(inlineMinuteKey(inlineSelection.dateKey, inlineSelection.minuteIndex)) : undefined;
  const selectedColor = selectedDraft ? categoryById(selectedDraft.categoryId) : undefined;
  const pickerColors = selectedColor && !availableColors.some((item) => item.id === selectedColor.id)
    ? [...availableColors, selectedColor] : availableColors;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}>
      <View style={styles.monthToolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose date" accessibilityState={{ expanded: dateInputOpen }}
          onPress={() => { setDateInput(activeDate); setDateInputError(false); setDateInputOpen((open) => !open); }}
          style={styles.monthButton}>
          <Text numberOfLines={1} style={styles.monthTitle}>{monthTitle}</Text>
          <Text style={styles.year}>{firstDay.getFullYear() === lastDay.getFullYear()
            ? firstDay.getFullYear() : firstDay.getFullYear() + ' – ' + lastDay.getFullYear()}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Calendar view" accessibilityState={{ expanded: modeMenuOpen }}
          onPress={() => setModeMenuOpen((open) => !open)} style={styles.modeButton}>
          <Text style={styles.modeLabel}>{dayCount === 1 ? 'Day' : dayCount + ' days'} ▾</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous dates"
          onPress={() => onDateChange(dateKey(addDays(activeDate, -dayCount)))} style={styles.dateArrow}>
          <Text style={styles.arrow}>‹</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Next dates"
          onPress={() => onDateChange(dateKey(addDays(activeDate, dayCount)))} style={styles.dateArrow}>
          <Text style={styles.arrow}>›</Text>
        </Pressable>
      </View>

      {modeMenuOpen ? (
        <View style={styles.modeChoices}>
          {DAY_COUNTS.map((count) => (
            <Pressable key={count} accessibilityRole="radio" accessibilityState={{ checked: count === dayCount }}
              onPress={() => { onDayCountChange?.(count); setModeMenuOpen(false); }}
              style={[styles.modeChoice, count === dayCount && styles.selectedModeChoice]}>
              <Text style={[styles.modeChoiceText, count === dayCount && styles.selectedModeText]}>
                {count === 1 ? 'Day' : count + ' days'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {dateInputOpen ? (
        <View style={styles.dateJump}>
          <TextInput autoFocus value={dateInput} onChangeText={setDateInput}
            onSubmitEditing={goToEnteredDate} returnKeyType="go" accessibilityLabel="Go to date"
            placeholder="MM/DD/YYYY" placeholderTextColor={colors.muted} style={styles.dateInput} />
          <Pressable accessibilityRole="button" onPress={goToEnteredDate} style={styles.goButton}>
            <Text style={styles.goText}>Go</Text>
          </Pressable>
          {dateInputError ? <Text style={styles.dateError}>Enter a valid date.</Text> : null}
        </View>
      ) : null}

      <View style={styles.dateHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open navigation menu"
          onPress={onOpenMenu ?? onOpenSettings} style={styles.menuButton}>
          <View style={styles.menuLine} /><View style={styles.menuLine} /><View style={styles.menuLine} />
        </Pressable>
        {days.map((day) => (
          <Pressable key={day} accessibilityRole="button" accessibilityLabel={dayLabels.get(day)}
            onPress={() => { onDateChange(day); onDayCountChange?.(1); }} style={styles.dateColumn}>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={styles.weekday}>
              {new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(parseDateKey(day))}
            </Text>
            <View style={[styles.dateCircle, day === today && styles.todayCircle]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.dateNumber, day === today && styles.todayNumber]}>
                {parseDateKey(day).getDate()}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      {colorPanelOpen && inlineSelection ? (
        <View style={styles.colorPanel}>
          <View style={styles.colorPanelHeading}>
            <Text numberOfLines={1} style={styles.colorPanelTime}>
              {formatDayHeading(inlineSelection.dateKey)} · {minuteLabel(inlineSelection.minuteIndex, true)}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void showMinuteDetails(inlineSelection.dateKey, inlineSelection.minuteIndex)}
              style={styles.colorPanelAction}><Text style={styles.colorPanelActionText}>Details</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Close colors" onPress={() => setColorPanelOpen(false)}
              style={styles.colorPanelAction}><Text style={styles.colorPanelActionText}>×</Text></Pressable>
          </View>
          <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator
            contentContainerStyle={styles.colorChoices}>
            {pickerColors.map((item) => (
              <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={item.name + ', ' + item.color}
                accessibilityState={{ checked: selectedDraft?.categoryId === item.id }}
                onPress={() => {
                  const current = inlineMinuteDrafts.get(inlineSelection.dateKey, inlineSelection.minuteIndex);
                  if (!current) return;
                  markLocalChange([current.dateKey]);
                  inlineMinuteDrafts.edit(current.dateKey, current.minuteIndex,
                    { categoryId: item.id, keepColor: !current.text.trim() });
                }} style={[styles.colorChoice, selectedDraft?.categoryId === item.id && styles.selectedColorChoice]}>
                <View style={[styles.colorCircle, { backgroundColor: item.color }]} />
              </Pressable>
            ))}
          </ScrollView>
          {selectedColor ? <Text style={styles.colorName}>{selectedColor.name}</Text> : null}
        </View>
      ) : null}

      {notice ? (
        <Pressable onPress={inlineError || inlineLinkWarning ? () => void flushInlineMinutes() : calendarReadError ? onOpenSettings : () => void refresh()} style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </Pressable>
      ) : null}

      {hasAllDay ? (
        <View style={styles.allDayRow}>
          <Text style={styles.allDayLabel}>All day</Text>
          {days.map((day) => {
            const plans = dayData[day]?.plans.filter((plan) => plan.allDay) ?? [];
            return <Pressable key={day} disabled={!plans.length} onPress={() => void openPlan(plans[0]!)}
              style={styles.allDayCell}>
              <Text numberOfLines={2} style={styles.allDayText}>{plans.map((plan) => plan.title).join(' · ')}</Text>
            </Pressable>;
          })}
        </View>
      ) : null}

      <FlatList ref={listRef} data={MINUTE_ITEMS} keyExtractor={(minute) => minute.toString()}
        style={styles.minuteList} contentContainerStyle={styles.minuteListContent}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        initialNumToRender={24} maxToRenderPerBatch={24} windowSize={9} keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag" removeClippedSubviews={false}
        onLayout={() => {
          const selected = inlineSelectionRef.current;
          if (selected) revealInlineMinute(selected.minuteIndex);
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ink}
          colors={[colors.currentTime]} progressBackgroundColor={colors.surface} />}
        onScrollToIndexFailed={({ index }) => listRef.current?.scrollToOffset({ offset: index * ROW_HEIGHT, animated: false })}
        renderItem={({ item: minute }) => (
          <View style={styles.minuteRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={minuteLabel(minute, true) + ', choose minute color'}
              accessibilityState={{ expanded: colorPanelOpen && inlineSelection?.minuteIndex === minute }}
              onPress={() => void openInlineMinute(inlineSelectionRef.current?.dateKey ?? activeDate, minute, true)}
              style={styles.timeRail}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.minuteTime,
                minute === currentMinute && days.includes(today) && styles.currentMinuteText]}>{minuteLabel(minute)}</Text>
            </Pressable>
            {days.map((day) => {
              const index = indexedDays.get(day);
              const entry = index?.entriesByMinute.get(minute);
              const draft = draftsByKey.get(inlineMinuteKey(day, minute));
              const plans = index?.plansByMinute.get(minute) ?? [];
              const plan = plans[0];
              const color = draft ? categoryById(draft.categoryId).color : entry ? categoryById(entry.categoryId).color : plan?.color;
              const inline = inlineSelection?.dateKey === day && inlineSelection.minuteIndex === minute;
              const displayedText = draft?.text ?? entry?.text ?? plan?.title;
              const isCurrent = day === today && minute === currentMinute;
              return (
                <Pressable key={day} accessibilityRole={inline ? undefined : 'button'}
                  accessibilityLabel={inline ? undefined : dayLabels.get(day) + ', ' + minuteLabel(minute, true) +
                    (displayedText ? ', ' + displayedText : ', tap to record')}
                  accessibilityHint={inline ? undefined : 'Type in this cell. Hold for minute details.'}
                  onPress={() => { if (!inline || colorPanelOpen) void openInlineMinute(day, minute); }}
                  onLongPress={inline ? undefined : () => { void showMinuteDetails(day, minute); }}
                  style={[styles.dayCell, inline && styles.editingCell]}>
                  <View pointerEvents="none" style={[styles.cellBackground,
                    color && /^#[0-9a-f]{6}$/i.test(color) ? { backgroundColor: color + '30' } : null]} />
                  {color ? <View pointerEvents="none" style={[styles.activityBar, { backgroundColor: color,
                    opacity: entry ? 1 : 0.65 }]} /> : null}
                  {inline && draft ? <TextInput ref={inlineInputRef} value={draft.text}
                    multiline scrollEnabled returnKeyType="done" submitBehavior="blurAndSubmit"
                    accessibilityLabel={dayLabels.get(day) + ', ' + minuteLabel(minute, true) + ', minute text'}
                    placeholder="Tap to record" placeholderTextColor={colors.muted} selectionColor={colors.currentTime}
                    onChangeText={(text) => {
                      markLocalChange([day]);
                      const current = inlineMinuteDrafts.get(day, minute);
                      inlineMinuteDrafts.edit(day, minute, { text, keepColor: text.trim() ? false : current?.keepColor ?? false });
                    }}
                    onBlur={() => { void inlineMinuteDrafts.flush(inlineMinuteKey(day, minute)); }}
                    onFocus={() => revealInlineMinute(minute)}
                    onSubmitEditing={() => {
                      inlineMinuteDrafts.close(inlineMinuteKey(day, minute));
                      setInlineSelection(null); setColorPanelOpen(false); Keyboard.dismiss();
                    }} style={[styles.cellText, styles.inlineInput, dayCount === 7 && styles.narrowText]} />
                    : <Text numberOfLines={1} maxFontSizeMultiplier={1.4}
                      style={[styles.cellText, !entry && !draft && styles.planText,
                        !displayedText && styles.placeholder, dayCount === 7 && styles.narrowText]}>
                      {displayedText || 'Tap to record'}
                    </Text>}
                  {isCurrent ? <View pointerEvents="none" style={styles.currentLine}>
                    <View style={styles.currentDot} />
                  </View> : null}
                </Pressable>
              );
            })}
          </View>
        )}
      />

      <MinuteEditor visible={editor != null} dateKey={editor?.dateKey ?? activeDate}
        minuteIndex={editor?.minuteIndex ?? 0} entry={editor?.entry ?? null} plan={editor?.plan ?? null}
        planDurationMinutes={editor?.planDuration} onClose={() => setEditor(null)} onSave={save} onDelete={remove}
        onOpenPlan={editor?.plan ? () => openPlan(editor.plan!) : undefined} />
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.paper },
    monthToolbar: { minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
    monthButton: { flex: 1, minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
    monthTitle: { color: colors.ink, fontSize: 24, fontWeight: '500' },
    year: { marginTop: 1, color: colors.muted, fontSize: 10 },
    modeButton: { minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
    modeLabel: { color: colors.graphite, fontSize: 12, fontWeight: '600' },
    dateArrow: { width: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    arrow: { color: colors.graphite, fontSize: 29, fontWeight: '400' },
    modeChoices: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
    modeChoice: { minHeight: 44, minWidth: 70, paddingHorizontal: 10, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel },
    selectedModeChoice: { backgroundColor: colors.accent },
    modeChoiceText: { color: colors.graphite, fontSize: 12, fontWeight: '600' },
    selectedModeText: { color: colors.onAccent },
    dateJump: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
    dateInput: { flex: 1, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.hairline,
      borderRadius: 10, backgroundColor: colors.surface, color: colors.ink, fontSize: 14 },
    goButton: { minHeight: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.accent,
      justifyContent: 'center' },
    goText: { color: colors.onAccent, fontWeight: '600' },
    dateError: { width: '100%', color: colors.danger, fontSize: 12 },
    dateHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 68, paddingRight: 2, paddingBottom: 5 },
    menuButton: { width: 50, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 4 },
    menuLine: { height: 2, width: 23, backgroundColor: colors.graphite },
    dateColumn: { flex: 1, minHeight: 62, alignItems: 'center', justifyContent: 'center' },
    weekday: { color: colors.muted, fontSize: 11, fontWeight: '600' },
    dateCircle: { width: 34, height: 34, marginTop: 5, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    todayCircle: { backgroundColor: colors.selectedDay },
    dateNumber: { color: colors.graphite, fontSize: 20, fontWeight: '500' },
    todayNumber: { color: colors.onSelectedDay },
    notice: { paddingVertical: 7, paddingHorizontal: 14, backgroundColor: colors.panel },
    noticeText: { color: colors.warning, fontSize: 11, lineHeight: 16 },
    allDayRow: { flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingRight: 2, paddingBottom: 4 },
    allDayLabel: { width: 50, paddingHorizontal: 5, color: colors.muted, fontSize: 9, textAlign: 'right' },
    allDayCell: { flex: 1, minHeight: 32, paddingHorizontal: 5, justifyContent: 'center' },
    allDayText: { color: colors.graphite, fontSize: 10 },
    minuteList: { flex: 1 },
    minuteListContent: { paddingBottom: 12 },
    minuteRow: { height: ROW_HEIGHT, flexDirection: 'row', paddingRight: 2 },
    timeRail: { width: 50, justifyContent: 'center', alignItems: 'flex-end', paddingRight: 7 },
    minuteTime: { color: colors.muted, fontSize: 10, fontVariant: ['tabular-nums'] },
    currentMinuteText: { color: colors.currentTime, fontWeight: '700' },
    colorPanel: { paddingHorizontal: 12, paddingBottom: 7, borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.hairline, backgroundColor: colors.panel },
    colorPanelHeading: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
    colorPanelTime: { flex: 1, color: colors.graphite, fontSize: 11 },
    colorPanelAction: { minHeight: 40, minWidth: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
    colorPanelActionText: { color: colors.graphite, fontSize: 12, fontWeight: '600' },
    colorChoices: { gap: 5, alignItems: 'center', paddingHorizontal: 2, paddingBottom: 3 },
    colorChoice: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: 'transparent',
      alignItems: 'center', justifyContent: 'center' },
    selectedColorChoice: { borderColor: colors.ink },
    colorCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.swatchBorder },
    colorName: { color: colors.muted, fontSize: 10, paddingLeft: 5, paddingTop: 2 },
    dayCell: { flex: 1, height: ROW_HEIGHT, justifyContent: 'center', paddingLeft: 9, paddingRight: 5 },
    cellBackground: { position: 'absolute', left: 2, right: 2, top: 2, bottom: 2,
      borderRadius: 7, backgroundColor: colors.calendarCell },
    activityBar: { position: 'absolute', left: 2, width: 3, top: 5, bottom: 5, borderRadius: 2 },
    cellText: { color: colors.ink, fontSize: 13, fontWeight: '500' },
    editingCell: { borderWidth: 1, borderColor: colors.currentTime, borderRadius: 7 },
    inlineInput: { flex: 1, paddingVertical: 5, paddingHorizontal: 0, margin: 0, maxHeight: ROW_HEIGHT - 2,
      textAlignVertical: 'center', backgroundColor: 'transparent' },
    placeholder: { color: colors.muted, fontWeight: '400', fontSize: 11 },
    planText: { color: colors.graphite, fontWeight: '400' },
    narrowText: { fontSize: 10 },
    currentLine: { position: 'absolute', left: 2, right: 2, top: ROW_HEIGHT / 2,
      height: 1.5, backgroundColor: colors.currentTime },
    currentDot: { position: 'absolute', left: -3, top: -3.25, width: 8, height: 8,
      borderRadius: 4, backgroundColor: colors.currentTime },
  });
}
