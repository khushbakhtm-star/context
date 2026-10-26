import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar as AndroidNavigationBar } from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';

import {
  enqueueBoundDatesForSync,
  getSetting,
  initializeDatabase,
  setSetting,
} from './src/data/database';
import {
  configureCalendarProjection,
  CalendarPlanConnectionError,
  createPlanInSystemCalendar,
  flushPendingActuals,
  getCalendarPermissionStatus,
  listDeviceCalendars,
  requestCalendarAccess,
} from './src/services/calendar';
import { SearchScreen } from './src/screens/SearchScreen';
import { AccountsScreen } from './src/screens/AccountsScreen';
import { CategoriesScreen } from './src/screens/CategoriesScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TodayScreen } from './src/screens/TodayScreen';
import { DateSelectionPopup } from './src/components/DateSelectionPopup';
import { MonthOverview } from './src/components/MonthOverview';
import { AppearanceProvider, useAppTheme } from './src/appearance';
import type { AppColors } from './src/theme';
import type { CalendarPreferences, DeviceCalendar, SearchResult } from './src/types';
import { dateKey, minuteIndexForDate } from './src/utils/time';
import { normalizeCalendarZoom } from './src/utils/calendar-layout';
import { createCalendarRefreshBurst } from './src/utils/calendar-refresh';
import { dateSelectionMode, isDateKey, normalizeSelectedDates } from './src/utils/date-selection';
import { visibleCalendarDates } from './src/utils/calendar-grid';
import { calendarNavigationTarget, type CalendarNavigationTarget } from './src/utils/calendar-navigation';
import { getAccounts } from './src/sync/accounts';
import { subscribeAccountSync, synchronizeAccounts } from './src/sync/engine';
import { listCategories } from './src/services/categories';
import { flushInlineMinutes, retryInlineMinuteLinks, subscribeInlineMinuteCommits } from './src/services/inline-minutes';
import { subscribeSpreadsheetCommits } from './src/services/spreadsheet';
import { ReleaseUpdateNotice, useReleaseUpdates } from './src/components/ReleaseUpdates';
import { useWearBridge } from './src/wear/useWearBridge';

type Tab = 'today' | 'reports' | 'search' | 'settings' | 'accounts' | 'categories';
type DayCount = 1 | 3 | 7;
type NavigationAction = Exclude<Tab, 'today'> | 'day' | 'three-days' | 'week' | 'plan';

const DEFAULT_PREFERENCES: CalendarPreferences = {
  selectedCalendarIds: [],
  writeCalendarId: null,
  syncActuals: false,
};

const NAVIGATION_ITEMS: { id: NavigationAction; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'day', label: 'Day' },
  { id: 'three-days', label: '3 days' },
  { id: 'week', label: 'Week' },
  { id: 'reports', label: 'Reports' },
  { id: 'search', label: 'Search' },
  { id: 'settings', label: 'Settings' },
  { id: 'accounts', label: 'Calendar accounts & synchronization' },
  { id: 'categories', label: 'Activity colors' },
];

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppController />
    </SafeAreaProvider>
  );
}

function AppController() {
  const [ready, setReady] = useState(false);
  const releaseUpdates = useReleaseUpdates(ready);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('today');
  const [menuOpen, setMenuOpen] = useState(false);
  const [dayCount, setDayCount] = useState<DayCount>(1);
  const [selectedDateKeys, setSelectedDateKeys] = useState<string[] | null>(null);
  const [overviewMonth, setOverviewMonth] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [calendarZoom, setCalendarZoom] = useState(1);
  const [calendarViewResetToken, setCalendarViewResetToken] = useState(0);
  const [clockFormat, setClockFormat] = useState<'12h' | '24h'>('12h');
  const viewWrites = useRef<Promise<unknown>>(Promise.resolve());
  const focusSequence = useRef(0);
  const [activeDate, setActiveDate] = useState(dateKey(new Date()));
  const [dataVersion, setDataVersion] = useState(0);
  const [permissionStatus, setPermissionStatus] = useState('undetermined');
  const [calendars, setCalendars] = useState<DeviceCalendar[]>([]);
  const [preferences, setPreferences] = useState<CalendarPreferences>(DEFAULT_PREFERENCES);
  const [accountCalendarWrites, setAccountCalendarWrites] = useState(false);
  const inlineProjectionChain = useRef<Promise<void>>(Promise.resolve());
  const planOpenRef = useRef(false);
  const calendarProjectionConfigRef = useRef({ ready, syncActuals: preferences.syncActuals,
    writeCalendarId: preferences.writeCalendarId, accountCalendarWrites });
  calendarProjectionConfigRef.current = { ready, syncActuals: preferences.syncActuals,
    writeCalendarId: preferences.writeCalendarId, accountCalendarWrites };
  const [focusRequest, setFocusRequest] = useState<{
    dateKey: string;
    minuteIndex: number;
    token: number;
    openEditor?: boolean;
  } | null>(null);
  const consumeFocus = useCallback((token?: number) => {
    setFocusRequest((current) => token == null || current?.token === token ? null : current);
  }, []);

  const refreshCalendars = useCallback(async () => {
    const status = await getCalendarPermissionStatus().catch(() => 'unavailable');
    setPermissionStatus(status);
    if (status === 'granted') {
      const available = await listDeviceCalendars().catch(() => []);
      setCalendars(available);
    } else {
      setCalendars([]);
    }
  }, []);

  const calendarReturnRefresh = useMemo(() => createCalendarRefreshBurst(() => {
    void refreshCalendars().then(() => setDataVersion((version) => version + 1));
  }, () => AppState.currentState === 'active'), [refreshCalendars]);

  useEffect(() => () => calendarReturnRefresh.cancel(), [calendarReturnRefresh]);

  useEffect(() => {
    let mounted = true;
    async function prepare() {
      setReady(false);
      setInitializationError(null);
      try {
        await initializeDatabase();
        await listCategories();
        const [savedPreferences, savedDayCount, savedZoom, savedClockFormat, savedSelectedDates] = await Promise.all([
          getSetting<CalendarPreferences>('calendar.preferences', DEFAULT_PREFERENCES),
          getSetting<unknown>('calendar.day-count', 1),
          getSetting<unknown>('calendar.zoom', 1),
          getSetting<unknown>('calendar.clock-format', '12h'),
          getSetting<unknown>('calendar.selected-date-keys', null),
        ]);
        const directWrites = (await getAccounts()).some((account) => account.consent.calendarWrite);
        setAccountCalendarWrites(directWrites);
        if (!mounted) return;
        configureCalendarProjection(
          savedPreferences.syncActuals && !directWrites ? savedPreferences.writeCalendarId : null,
        );
        setPreferences(savedPreferences);
        setDayCount(savedDayCount === 3 || savedDayCount === 7 ? savedDayCount : 1);
        const normalizedDates = normalizeSelectedDates(savedSelectedDates);
        setSelectedDateKeys(normalizedDates.length ? normalizedDates : null);
        setOverviewMonth(null);
        if (normalizedDates.length) setActiveDate(normalizedDates[0]!);
        setCalendarZoom(normalizeCalendarZoom(savedZoom));
        setClockFormat(savedClockFormat === '24h' ? '24h' : '12h');
        await refreshCalendars();
        if (mounted) setReady(true);
      } catch (error) {
        if (!mounted) return;
        setInitializationError(
          error instanceof Error ? error.message : 'Context could not open its local ledger.',
        );
      }
    }
    void prepare();
    return () => {
      mounted = false;
    };
  }, [initializationAttempt, refreshCalendars]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        calendarReturnRefresh.cancel();
        // Commit the current cell before the app leaves the foreground. Pending drafts
        // remain in the inline controller if the local database cannot accept a write.
        if (ready) void flushInlineMinutes().catch(() => {});
        return;
      }
      // Some calendar providers publish a saved event shortly after their editor closes.
      calendarReturnRefresh.start();
      if (ready) void flushInlineMinutes().catch(() => {});
      void synchronizeAccounts();
      if (preferences.syncActuals && preferences.writeCalendarId && !accountCalendarWrites) {
        void flushPendingActuals(preferences.writeCalendarId);
      }
    });
    return () => subscription.remove();
  }, [accountCalendarWrites, preferences.syncActuals, preferences.writeCalendarId, ready, calendarReturnRefresh]);

  useEffect(() => {
    if (!ready || accountCalendarWrites || !preferences.syncActuals || !preferences.writeCalendarId) return;
    void flushPendingActuals(preferences.writeCalendarId);
  }, [accountCalendarWrites, preferences.syncActuals, preferences.writeCalendarId, ready]);

  useEffect(() => {
    if (!ready) return;
    const unsubscribe = subscribeAccountSync((next) => {
      if (!next.running) {
        void listCategories().then(() => setDataVersion((version) => version + 1));
      }
    });
    void synchronizeAccounts();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void synchronizeAccounts();
    }, 45000);
    return () => { unsubscribe(); clearInterval(timer); };
  }, [ready]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menuOpen) {
        setMenuOpen(false);
        return true;
      }
      if (tab !== 'today') {
        setTab('today');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [menuOpen, tab]);

  const dataChanged = useCallback(() => {
    setDataVersion((version) => version + 1);
    void getAccounts().then((accounts) => {
      const directWrites = accounts.some((account) => account.consent.calendarWrite);
      setAccountCalendarWrites(directWrites);
      const current = calendarProjectionConfigRef.current;
      configureCalendarProjection(
        current.syncActuals && !directWrites ? current.writeCalendarId : null,
      );
    }).catch(() => { /* Keep the current projection settings; account refresh can retry. */ });
    void synchronizeAccounts();
  }, []);

  const watchDataChanged = useCallback((days: string[]) => {
    dataChanged();
    const current = calendarProjectionConfigRef.current;
    if (current.ready && current.syncActuals && current.writeCalendarId && !current.accountCalendarWrites) {
      void flushPendingActuals(current.writeCalendarId, days);
    }
  }, [dataChanged]);
  useWearBridge(ready, watchDataChanged);

  useEffect(() => {
    if (!ready) return;
    void retryInlineMinuteLinks().catch(() => {});
    // This listener lives above Today so a write that finishes after opening Reports
    // still refreshes the app and queues the affected dates for the chosen calendar.
    const handleCommit = (affectedDates: string[], textChanged = true) => {
      dataChanged();
      if (!textChanged) return;
      const project = async () => {
        const directWrites = (await getAccounts()).some((account) => account.consent.calendarWrite);
        const current = calendarProjectionConfigRef.current;
        if (!current.ready || directWrites || current.accountCalendarWrites || !current.syncActuals || !current.writeCalendarId) return;
        await flushPendingActuals(current.writeCalendarId, affectedDates);
      };
      inlineProjectionChain.current = inlineProjectionChain.current.then(project, project)
        .catch(() => { /* SQLite's durable calendar outbox keeps this work for retry. */ });
    };
    const unsubscribe = subscribeInlineMinuteCommits(({ affectedDates }) => handleCommit(affectedDates));
    const unsubscribeSpreadsheet = subscribeSpreadsheetCommits(({ affectedDates, textChanged }) => handleCommit(affectedDates, textChanged));
    return () => {
      unsubscribe();
      unsubscribeSpreadsheet();
      void flushInlineMinutes().catch(() => {});
    };
  }, [dataChanged, ready]);

  async function askForCalendarAccess() {
    const granted = await requestCalendarAccess();
    await refreshCalendars();
    if (!granted) {
      Alert.alert(
        'Calendar access was not granted',
        'Context remains fully usable as a local minute ledger. You can enable calendar access later in system settings.',
      );
    }
  }

  function changePreferences(next: CalendarPreferences) {
    const sanitized = next.writeCalendarId
      ? next
      : { ...next, syncActuals: false };
    const needsFullReprojection =
      sanitized.syncActuals &&
      sanitized.writeCalendarId !== null &&
      (!preferences.syncActuals || sanitized.writeCalendarId !== preferences.writeCalendarId);
    calendarProjectionConfigRef.current = { ...calendarProjectionConfigRef.current,
      syncActuals: sanitized.syncActuals, writeCalendarId: sanitized.writeCalendarId };
    configureCalendarProjection(
      sanitized.syncActuals && !accountCalendarWrites ? sanitized.writeCalendarId : null,
    );
    setPreferences(sanitized);
    void setSetting('calendar.preferences', sanitized);
    if (needsFullReprojection && !accountCalendarWrites) {
      void enqueueBoundDatesForSync().then(() => {
        if (sanitized.writeCalendarId) void flushPendingActuals(sanitized.writeCalendarId);
      });
    }
  }

  function openSearchResult(result: SearchResult) {
    changeDayCount(1);
    setActiveDate(result.dateKey);
    setFocusRequest({
      dateKey: result.dateKey,
      minuteIndex: result.minuteIndex,
      token: ++focusSequence.current,
    });
    setTab('today');
  }

  function changeDayCount(next: DayCount) {
    setSelectedDateKeys(null);
    setOverviewMonth(null);
    setDayCount(next);
    setCalendarViewResetToken((token) => token + 1);
    changeCalendarZoom(1);
    viewWrites.current = viewWrites.current.catch(() => undefined)
      .then(async () => {
        await setSetting('calendar.selected-date-keys', null);
        await setSetting('calendar.day-count', next);
      }).catch(() => undefined);
  }

  function chooseDates(value: string[]) {
    const dates = normalizeSelectedDates(value);
    if (!dates.length) return;
    setSelectedDateKeys(dates);
    setOverviewMonth(dates[0]!.slice(0, 7) + '-01');
    setActiveDate(dates[0]!);
    setFocusRequest(null);
    setCalendarViewResetToken((token) => token + 1);
    changeCalendarZoom(1);
    setDatePickerOpen(false);
    setTab('today');
    viewWrites.current = viewWrites.current.catch(() => undefined)
      .then(() => setSetting('calendar.selected-date-keys', dates)).catch(() => undefined);
  }

  function openCalendarMinute(day: string, minute: number) {
    changeDayCount(1);
    setActiveDate(day);
    setFocusRequest({ dateKey: day, minuteIndex: minute, token: ++focusSequence.current, openEditor: false });
    setTab('today');
  }

  function jumpToCurrentMinute() {
    const current = new Date();
    openCalendarMinute(dateKey(current), minuteIndexForDate(current));
  }

  function shiftCalendarView(target: CalendarNavigationTarget | null) {
    if (!target) return;
    setActiveDate(target.activeDate);
    setSelectedDateKeys(target.selectedDates);
    setOverviewMonth(target.overviewMonth);
    setFocusRequest(null);
    setCalendarViewResetToken((token) => token + 1);
    viewWrites.current = viewWrites.current.catch(() => undefined)
      .then(() => setSetting('calendar.selected-date-keys', target.selectedDates)).catch(() => undefined);
  }

  function visibleOverviewMonthChanged(month: string) {
    if (isDateKey(month) && selectedDateKeys?.some((day) => day.slice(0, 7) === month.slice(0, 7))) {
      setOverviewMonth(month);
    }
  }

  function changeCalendarZoom(next: number) {
    const value = normalizeCalendarZoom(next);
    setCalendarZoom(value);
    viewWrites.current = viewWrites.current.catch(() => undefined)
      .then(() => setSetting('calendar.zoom', value)).catch(() => undefined);
  }

  function changeClockFormat(next: '12h' | '24h') {
    const value = next === '24h' ? '24h' : '12h';
    setClockFormat(value);
    viewWrites.current = viewWrites.current.catch(() => undefined)
      .then(() => setSetting('calendar.clock-format', value)).catch(() => undefined);
  }

  async function createConnectedPlan() {
    if (planOpenRef.current) return;
    planOpenRef.current = true;
    const current = new Date();
    const minute = activeDate === dateKey(current) ? minuteIndexForDate(current) : 9 * 60;
    try {
      await createPlanInSystemCalendar(activeDate, minute, preferences.selectedCalendarIds);
      dataChanged();
      calendarReturnRefresh.start();
    } catch (error) {
      if (error instanceof CalendarPlanConnectionError) {
        await refreshCalendars();
        Alert.alert('Connect a calendar to Context',
          error.reason === 'permission'
            ? 'Allow calendar access in Settings, then check the Google calendar you use for events under Calendars used for plans. Return here and tap + again.'
            : error.reason === 'selection'
              ? 'Check the calendar you use for events under Settings → Calendars used for plans. Save your event in that same calendar so it appears in Context.'
              : 'Enable calendar synchronization for your account in your phone’s settings, then select its calendar in Context Settings.',
          [{ text: 'Cancel', style: 'cancel' }, { text: 'Open Settings', onPress: () => setTab('settings') }]);
      } else {
        Alert.alert('Could not open a calendar', 'Enable a calendar on this phone, then try again.');
      }
    } finally {
      planOpenRef.current = false;
    }
  }

  function navigate(action: NavigationAction) {
    setMenuOpen(false);
    if (action === 'plan') {
      setTab('today');
      void createConnectedPlan();
      return;
    }
    if (action === 'day' || action === 'three-days' || action === 'week') {
      changeDayCount(action === 'week' ? 7 : action === 'three-days' ? 3 : 1);
      setFocusRequest(null);
      setTab('today');
      return;
    }
    setTab(action);
  }

  const navigationState = { activeDate, dayCount, selectedDates: selectedDateKeys, overviewMonth };
  const previousView = calendarNavigationTarget(navigationState, -1);
  const nextView = calendarNavigationTarget(navigationState, 1);

  return (
    <AppearanceProvider ready={ready}>
      <ApplicationFrame
        ready={ready}
        tab={tab}
        dayCount={dayCount}
        customDatesSelected={selectedDateKeys != null}
        menuOpen={menuOpen}
        onMenuChange={setMenuOpen}
        onNavigate={navigate}
        onReturnToCalendar={() => setTab('today')}
      >
        {!ready ? (
          <LoadingState
            error={initializationError}
            onRetry={() => setInitializationAttempt((attempt) => attempt + 1)}
          />
        ) : (
          <>
            <ReleaseUpdateNotice updates={releaseUpdates} />
            <View style={{ flex: 1 }}>
              {tab === 'today' ? <>
                <CalendarHeader onOpenMenu={() => setMenuOpen(true)} onJumpToNow={jumpToCurrentMinute}
                  canGoPrevious={previousView != null} canGoNext={nextView != null}
                  onPrevious={() => shiftCalendarView(previousView)} onNext={() => shiftCalendarView(nextView)}
                  onOpenDatePicker={() => setDatePickerOpen(true)} />
                {selectedDateKeys && dateSelectionMode(selectedDateKeys) === 'month' ? <MonthOverview
                  selectedDates={selectedDateKeys}
                  calendars={calendars}
                  preferences={accountCalendarWrites ? { ...preferences, syncActuals: false } : preferences}
                  dataVersion={dataVersion}
                  clockFormat={clockFormat}
                  onOpenMinute={openCalendarMinute}
                  onVisibleMonthChange={visibleOverviewMonthChanged}
                /> : <TodayScreen
                  activeDate={activeDate}
                  onDateChange={setActiveDate}
                  calendars={calendars}
                  preferences={accountCalendarWrites ? { ...preferences, syncActuals: false } : preferences}
                  dataVersion={dataVersion}
                  focusRequest={focusRequest}
                  onFocusConsumed={consumeFocus}
                  onDataChanged={dataChanged}
                  onOpenSettings={() => setTab('settings')}
                  dayCount={dayCount}
                  selectedDates={selectedDateKeys}
                  dateSelectionOpen={datePickerOpen}
                  onDayCountChange={() => changeDayCount(1)}
                  zoom={calendarZoom}
                  viewResetToken={calendarViewResetToken}
                  onZoomChange={changeCalendarZoom}
                  clockFormat={clockFormat}
                  onCreatePlan={() => navigate('plan')}
                />
                }
              </> : null}
              {tab === 'reports' ? <ReportsScreen dataVersion={dataVersion} initialDate={activeDate} /> : null}
              {tab === 'search' ? (
                <SearchScreen dataVersion={dataVersion} onOpenResult={openSearchResult} />
              ) : null}
              {tab === 'settings' ? (
                <SettingsScreen
                  activeDate={activeDate}
                  permissionStatus={permissionStatus}
                  calendars={calendars}
                  preferences={preferences}
                  onRequestAccess={askForCalendarAccess}
                  onRefreshCalendars={refreshCalendars}
                  onChange={changePreferences}
                  onOpenAccounts={() => setTab('accounts')}
                  onOpenCategories={() => setTab('categories')}
                  clockFormat={clockFormat}
                  onClockFormatChange={changeClockFormat}
                  updates={releaseUpdates}
                />
              ) : null}
              {tab === 'accounts' ? <AccountsScreen onDataChanged={dataChanged} /> : null}
              {tab === 'categories' ? <CategoriesScreen onDataChanged={dataChanged} calendars={calendars} /> : null}
            </View>
          </>
        )}
      </ApplicationFrame>
      <DateSelectionPopup visible={datePickerOpen && ready} selectedDates={selectedDateKeys ??
        visibleCalendarDates(activeDate, dayCount)} anchorDate={activeDate}
        onApply={chooseDates} onClose={() => setDatePickerOpen(false)} />
    </AppearanceProvider>
  );
}

function CalendarHeader({ onOpenMenu, onJumpToNow, onOpenDatePicker, canGoPrevious, canGoNext, onPrevious, onNext }: {
  onOpenMenu: () => void;
  onJumpToNow: () => void;
  onOpenDatePicker: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [current, setCurrent] = useState(() => new Date());
  const held = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      if (timer) clearTimeout(timer);
      const value = new Date();
      setCurrent(value);
      if (AppState.currentState === 'active') {
        timer = setTimeout(update, 60_000 - value.getSeconds() * 1_000 - value.getMilliseconds() + 25);
      }
    };
    update();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') update();
      else if (timer) { clearTimeout(timer); timer = null; }
    });
    return () => { if (timer) clearTimeout(timer); subscription.remove(); };
  }, []);

  const abbreviatedMonth = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(current).toLocaleUpperCase();
  const currentDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(current);
  const openPicker = () => { Keyboard.dismiss(); onOpenDatePicker(); };

  return <View style={styles.calendarHeader}>
    <Pressable accessibilityRole="button" accessibilityLabel="Open navigation menu"
      onPress={onOpenMenu} style={styles.menuButton}>
      <View style={styles.calendarMenuLine} /><View style={styles.calendarMenuLine} /><View style={styles.calendarMenuLine} />
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Previous calendar view"
      accessibilityState={{ disabled: !canGoPrevious }} disabled={!canGoPrevious} onPress={onPrevious}
      style={[styles.menuButton, !canGoPrevious && styles.disabledCalendarNavigation]}>
      <Text allowFontScaling={false} style={styles.calendarNavigationArrow}>‹</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Go to ${currentDate}, current minute`}
      accessibilityHint="Touch and hold to choose dates"
      accessibilityActions={[{ name: 'longpress', label: 'Choose dates' }]}
      onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'longpress') { held.current = true; openPicker(); } }}
      onPressIn={() => { held.current = false; }}
      onLongPress={() => { held.current = true; openPicker(); }} delayLongPress={450}
      onPress={() => { if (!held.current) onJumpToNow(); held.current = false; }} style={styles.menuButton}>
      <View pointerEvents="none" accessible={false} style={styles.calendarGlyph}>
        <View style={styles.calendarBindings}><View style={styles.calendarBinding} /><View style={styles.calendarBinding} /></View>
        <Text accessible={false} allowFontScaling={false} numberOfLines={1} style={styles.calendarGlyphMonth}>{abbreviatedMonth}</Text>
        <Text accessible={false} allowFontScaling={false} style={styles.calendarGlyphDay}>{current.getDate()}</Text>
      </View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Next calendar view"
      accessibilityState={{ disabled: !canGoNext }} disabled={!canGoNext} onPress={onNext}
      style={[styles.menuButton, !canGoNext && styles.disabledCalendarNavigation]}>
      <Text allowFontScaling={false} style={styles.calendarNavigationArrow}>›</Text>
    </Pressable>
  </View>;
}

const SCREEN_TITLES: Record<Tab, string> = {
  today: 'Today', reports: 'Reports', search: 'Search', settings: 'Settings',
  accounts: 'Calendar accounts', categories: 'Activity colors',
};

function ApplicationFrame({
  ready, tab, dayCount, customDatesSelected, menuOpen, onMenuChange, onNavigate, onReturnToCalendar, children,
}: {
  ready: boolean;
  tab: Tab;
  dayCount: DayCount;
  customDatesSelected: boolean;
  menuOpen: boolean;
  onMenuChange: (open: boolean) => void;
  onNavigate: (action: NavigationAction) => void;
  onReturnToCalendar: () => void;
  children: ReactNode;
}) {
  const { colors, resolvedMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width } = useWindowDimensions();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.paper).catch(() => undefined);
  }, [colors.paper]);

  return (
    <>
      <StatusBar style={resolvedMode === 'dark' ? 'light' : 'dark'} hidden={false} />
      {Platform.OS === 'android' ? (
        <AndroidNavigationBar style={resolvedMode === 'dark' ? 'light' : 'dark'} />
      ) : null}
      <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
        <View
          style={styles.screen}
          importantForAccessibility={menuOpen ? 'no-hide-descendants' : 'auto'}
        >
          {ready && tab !== 'today' ? (
            <View style={styles.screenHeader}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open menu"
                hitSlop={4}
                onPress={() => onMenuChange(true)}
                style={styles.menuButton}
              >
                <Text style={styles.menuIcon}>☰</Text>
              </Pressable>
              <Text style={styles.screenTitle}>{SCREEN_TITLES[tab]}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to calendar"
                onPress={onReturnToCalendar}
                style={styles.backButton}
              >
                <Text style={styles.backText}>Calendar</Text>
              </Pressable>
            </View>
          ) : null}
          {children}
        </View>
      </SafeAreaView>

      <Modal
        visible={ready && menuOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => onMenuChange(false)}
      >
        <View style={styles.drawerBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            onPress={() => onMenuChange(false)}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView
            accessibilityViewIsModal
            edges={['top', 'bottom', 'left']}
            style={[styles.drawer, { width: Math.min(width * 0.86, 360) }]}
          >
            <View style={styles.drawerHeading}>
              <Text style={styles.drawerTitle}>Menu</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close menu"
                onPress={() => onMenuChange(false)}
                style={styles.menuButton}
              >
                <Text style={styles.closeIcon}>×</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.drawerItems}>
              {NAVIGATION_ITEMS.map((item) => {
                const selected = item.id === 'week' ? tab === 'today' && !customDatesSelected && dayCount === 7 :
                  item.id === 'three-days' ? tab === 'today' && !customDatesSelected && dayCount === 3 :
                    item.id === 'day' ? tab === 'today' && !customDatesSelected && dayCount === 1 : item.id === tab;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => onNavigate(item.id)}
                    style={[styles.drawerItem, selected && styles.drawerItemSelected]}
                  >
                    <Text style={[styles.drawerItemText, selected && styles.drawerItemTextSelected]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

function LoadingState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.loading}>
      {error ? (
        <View style={styles.errorPanel}>
          <Text style={styles.errorTitle}>Your ledger could not be opened</Text>
          <Text style={styles.errorText}>Try opening it again.</Text>
          <Text numberOfLines={2} style={styles.errorDetail}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ActivityIndicator color={colors.ink} />
          <Text style={styles.loadingText}>Opening your ledger…</Text>
        </>
      )}
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  screen: { flex: 1 },
  calendarHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.paper },
  calendarMenuLine: { height: 3, width: 28, marginVertical: 2.5, backgroundColor: colors.graphite },
  calendarNavigationArrow: { color: colors.graphite, fontSize: 29, lineHeight: 34 },
  disabledCalendarNavigation: { opacity: 0.3 },
  calendarGlyph: { width: 30, height: 32, borderWidth: 1.5, borderColor: colors.graphite, borderRadius: 4,
    alignItems: 'center', justifyContent: 'center' },
  calendarBindings: { position: 'absolute', left: 5, right: 5, top: -4, flexDirection: 'row', justifyContent: 'space-between' },
  calendarBinding: { height: 6, width: 2, backgroundColor: colors.graphite, borderRadius: 1 },
  calendarGlyphMonth: { width: '100%', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.muted,
    paddingTop: 1, paddingBottom: 1, textAlign: 'center', color: colors.graphite, fontSize: 7, lineHeight: 9, fontWeight: '700' },
  calendarGlyphDay: { color: colors.graphite, fontSize: 16, lineHeight: 18, fontWeight: '500' },
  screenHeader: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline, backgroundColor: colors.paper,
  },
  menuButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  menuIcon: { color: colors.ink, fontSize: 28, lineHeight: 32 },
  screenTitle: { flex: 1, marginLeft: 8, color: colors.ink, fontSize: 17, fontWeight: '600' },
  backButton: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
  backText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  drawerBackdrop: { flex: 1, backgroundColor: colors.scrim },
  drawer: { height: '100%', backgroundColor: colors.paper },
  drawerHeading: { minHeight: 60, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 18 },
  drawerTitle: { color: colors.ink, fontSize: 22, fontWeight: '600' },
  closeIcon: { color: colors.muted, fontSize: 30, lineHeight: 34 },
  drawerItems: { paddingHorizontal: 12, paddingBottom: 20, gap: 4 },
  drawerItem: { minHeight: 52, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10 },
  drawerItemSelected: { backgroundColor: colors.panel },
  drawerItemText: { color: colors.graphite, fontSize: 15 },
  drawerItemTextSelected: { color: colors.ink, fontWeight: '700' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  loadingText: { marginTop: 14, color: colors.muted, fontSize: 13 },
  errorPanel: { width: '82%', maxWidth: 360, alignItems: 'center' },
  errorTitle: { color: colors.ink, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  errorText: { marginTop: 8, color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  errorDetail: { marginTop: 10, color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  retryButton: { minWidth: 132, minHeight: 44, marginTop: 18, alignItems: 'center',
    justifyContent: 'center', borderRadius: 10, backgroundColor: colors.accent },
  retryButtonText: { color: colors.onAccent, fontSize: 14, fontWeight: '700' },
});
