import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
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
import { CalendarViewIcon } from './src/components/CalendarViewIcon';
import { CalendarHeaderIcon } from './src/components/CalendarHeaderIcon';
import { CalendarYearScreen } from './src/screens/CalendarYearScreen';
import { CalendarScheduleScreen } from './src/screens/CalendarScheduleScreen';
import { AppearanceProvider, useAppTheme } from './src/appearance';
import type { AppColors } from './src/theme';
import type { CalendarPreferences, DeviceCalendar, SearchResult } from './src/types';
import { dateKey, minuteIndexForDate } from './src/utils/time';
import { normalizeCalendarZoom } from './src/utils/calendar-layout';
import { createCalendarRefreshBurst } from './src/utils/calendar-refresh';
import { isDateKey, normalizeSelectedDates } from './src/utils/date-selection';
import type { CalendarNavigationTarget } from './src/utils/calendar-navigation';
import { calendarViewDates, calendarViewKind, calendarViewModePageTarget, type CalendarViewMode } from './src/utils/calendar-view-mode';
import { getAccounts } from './src/sync/accounts';
import { subscribeAccountSync, synchronizeAccounts } from './src/sync/engine';
import { listCategories } from './src/services/categories';
import { flushInlineMinutes, inlineMinuteDrafts, retryInlineMinuteLinks, subscribeInlineMinuteCommits } from './src/services/inline-minutes';
import { redoSpreadsheetEdit, spreadsheetEditor, subscribeSpreadsheetCommits, undoSpreadsheetEdit } from './src/services/spreadsheet';
import { ReleaseUpdateNotice, useReleaseUpdates } from './src/components/ReleaseUpdates';
import { useWearBridge } from './src/wear/useWearBridge';

type Tab = 'today' | 'reports' | 'search' | 'settings' | 'accounts' | 'categories';
type DayCount = 1 | 3 | 7;
type NavigationAction = Exclude<Tab, 'today'> | 'plan';

const DEFAULT_PREFERENCES: CalendarPreferences = {
  selectedCalendarIds: [],
  writeCalendarId: null,
  syncActuals: false,
};

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
  const [dayCount, setDayCount] = useState<DayCount>(1);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('day');
  const [viewChanging, setViewChanging] = useState(false);
  const viewChangingRef = useRef(false);
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
        const [savedPreferences, savedDayCount, savedZoom, savedClockFormat, savedSelectedDates, savedViewMode] = await Promise.all([
          getSetting<CalendarPreferences>('calendar.preferences', DEFAULT_PREFERENCES),
          getSetting<unknown>('calendar.day-count', 1),
          getSetting<unknown>('calendar.zoom', 1),
          getSetting<unknown>('calendar.clock-format', '12h'),
          getSetting<unknown>('calendar.selected-date-keys', null),
          getSetting<unknown>('calendar.view-mode', null),
        ]);
        const directWrites = (await getAccounts()).some((account) => account.consent.calendarWrite);
        setAccountCalendarWrites(directWrites);
        if (!mounted) return;
        configureCalendarProjection(
          savedPreferences.syncActuals && !directWrites ? savedPreferences.writeCalendarId : null,
        );
        setPreferences(savedPreferences);
        const normalizedDates = normalizeSelectedDates(savedSelectedDates);
        const restoredMode: CalendarViewMode = normalizedDates.length ? normalizedDates.length > 7 ? 'month' : 'day' :
          savedViewMode === 'day' || savedViewMode === 'three-days' || savedViewMode === 'week' ||
          savedViewMode === 'month' || savedViewMode === 'year' || savedViewMode === 'schedule' ? savedViewMode :
          savedDayCount === 7 ? 'week' : savedDayCount === 3 ? 'three-days' : 'day';
        setViewMode(restoredMode);
        setDayCount(restoredMode === 'week' ? 7 : restoredMode === 'three-days' ? 3 : 1);
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
      if (viewChangingRef.current) return true;
      if (tab !== 'today') {
        setTab('today');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [tab]);

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
    const mode: CalendarViewMode = next === 7 ? 'week' : next === 3 ? 'three-days' : 'day';
    setViewMode(mode);
    setSelectedDateKeys(null);
    setOverviewMonth(null);
    setDayCount(next);
    setCalendarViewResetToken((token) => token + 1);
    changeCalendarZoom(1);
    viewWrites.current = viewWrites.current.catch(() => undefined)
      .then(async () => {
        await setSetting('calendar.selected-date-keys', null);
        await setSetting('calendar.day-count', next);
        await setSetting('calendar.view-mode', mode);
      }).catch(() => undefined);
  }

  async function transitionFromCalendar(change: () => void, failureTitle: string) {
    if (viewChangingRef.current) return;
    viewChangingRef.current = true;
    setViewChanging(true);
    Keyboard.dismiss();
    try {
      // Navigation can unmount the minute editor. Keep its draft in place if saving fails.
      await flushInlineMinutes();
      if (inlineMinuteDrafts.snapshot().some((draft) => draft.error || draft.revision !== draft.savedRevision)) {
        throw new Error('Your current minute could not be saved. Try again.');
      }
      change();
    } catch (error) {
      Alert.alert(failureTitle, error instanceof Error ? error.message : 'Save your current minute and try again.');
    } finally {
      viewChangingRef.current = false;
      setViewChanging(false);
    }
  }

  function changeViewMode(next: CalendarViewMode, anchor = activeDate) {
    return transitionFromCalendar(() => {
      setViewMode(next);
      setActiveDate(anchor);
      setDayCount(next === 'week' ? 7 : next === 'three-days' ? 3 : 1);
      setSelectedDateKeys(null);
      setOverviewMonth(next === 'month' || next === 'schedule' ? anchor.slice(0, 7) + '-01' : null);
      setFocusRequest(null);
      setCalendarViewResetToken((token) => token + 1);
      changeCalendarZoom(1);
      setTab('today');
      viewWrites.current = viewWrites.current.catch(() => undefined).then(async () => {
        await setSetting('calendar.selected-date-keys', null);
        await setSetting('calendar.day-count', next === 'week' ? 7 : next === 'three-days' ? 3 : 1);
        await setSetting('calendar.view-mode', next);
      }).catch(() => undefined);
    }, 'Could not change view');
  }

  function chooseDates(value: string[]) {
    const dates = normalizeSelectedDates(value);
    if (!dates.length) return;
    const mode: CalendarViewMode = dates.length > 7 ? 'month' : 'day';
    setViewMode(mode);
    setSelectedDateKeys(dates);
    setOverviewMonth(dates[0]!.slice(0, 7) + '-01');
    setActiveDate(dates[0]!);
    setFocusRequest(null);
    setCalendarViewResetToken((token) => token + 1);
    changeCalendarZoom(1);
    setDatePickerOpen(false);
    setTab('today');
    viewWrites.current = viewWrites.current.catch(() => undefined)
      .then(async () => {
        await setSetting('calendar.selected-date-keys', dates);
        await setSetting('calendar.view-mode', mode);
      }).catch(() => undefined);
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
    if (isDateKey(month) && (selectedDateKeys?.some((day) => day.slice(0, 7) === month.slice(0, 7)) ||
        (!selectedDateKeys && month.slice(0, 7) === activeDate.slice(0, 7)))) {
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
    return transitionFromCalendar(() => {
      if (action === 'plan') {
        setTab('today');
        void createConnectedPlan();
      } else setTab(action);
    }, action === 'plan' ? 'Could not open calendar' : 'Could not open screen');
  }

  const navigationState = { activeDate, mode: viewMode, selectedDates: selectedDateKeys, overviewMonth };
  const previousView = calendarViewModePageTarget(navigationState, -1);
  const nextView = calendarViewModePageTarget(navigationState, 1);
  const viewKind = calendarViewKind(viewMode, selectedDateKeys);
  const overviewDates = useMemo(() => calendarViewDates(viewMode, activeDate, selectedDateKeys),
    [viewMode, activeDate, selectedDateKeys]);

  return (
    <AppearanceProvider ready={ready}>
      <ApplicationFrame
        ready={ready}
        tab={tab}
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
            <View style={{ flex: 1 }} pointerEvents={viewChanging ? 'none' : 'auto'}>
              {tab === 'today' ? <>
                <CalendarHeader onOpenSettings={() => void navigate('settings')} onOpenSearch={() => void navigate('search')}
                  onOpenReports={() => void navigate('reports')} onJumpToNow={jumpToCurrentMinute}
                  viewMode={viewMode} viewChanging={viewChanging} onViewModeChange={changeViewMode}
                  canGoPrevious={previousView != null} canGoNext={nextView != null}
                  onPrevious={() => shiftCalendarView(previousView)} onNext={() => shiftCalendarView(nextView)}
                  onOpenDatePicker={() => setDatePickerOpen(true)} />
                {viewKind === 'year' ? <CalendarYearScreen activeDate={activeDate} onOpenMinute={openCalendarMinute}
                  onOpenMonth={(month) => void changeViewMode('month', month)} /> : viewKind === 'schedule' ? <CalendarScheduleScreen
                  activeDate={activeDate} selectedDates={overviewDates} calendars={calendars}
                  preferences={accountCalendarWrites ? { ...preferences, syncActuals: false } : preferences}
                  dataVersion={dataVersion} clockFormat={clockFormat} onOpenMinute={openCalendarMinute}
                  onVisibleMonthChange={visibleOverviewMonthChanged}
                /> : viewKind === 'month' ? <MonthOverview
                  selectedDates={overviewDates}
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
                  onOpenSettings={() => void navigate('settings')}
                  dayCount={dayCount}
                  selectedDates={selectedDateKeys}
                  dateSelectionOpen={datePickerOpen}
                  onDayCountChange={() => changeDayCount(1)}
                  zoom={calendarZoom}
                  viewResetToken={calendarViewResetToken}
                  onZoomChange={changeCalendarZoom}
                  clockFormat={clockFormat}
                  onCreatePlan={() => void navigate('plan')}
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
        calendarViewDates(viewMode === 'year' ? 'day' : viewMode, activeDate)} anchorDate={activeDate}
        onApply={chooseDates} onClose={() => setDatePickerOpen(false)} />
    </AppearanceProvider>
  );
}

const CALENDAR_VIEW_OPTIONS: { mode: CalendarViewMode; label: string }[] = [
  { mode: 'day', label: 'Day' },
  { mode: 'week', label: 'Week' },
  { mode: 'month', label: 'Month' },
  { mode: 'year', label: 'Year' },
  { mode: 'schedule', label: 'Schedule' },
];

function CalendarHeader({ onOpenSettings, onOpenSearch, onOpenReports, onJumpToNow, onOpenDatePicker, canGoPrevious, canGoNext, onPrevious, onNext,
  viewMode, viewChanging, onViewModeChange }: {
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  onOpenReports: () => void;
  onJumpToNow: () => void;
  onOpenDatePicker: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  viewMode: CalendarViewMode;
  viewChanging: boolean;
  onViewModeChange: (mode: CalendarViewMode) => Promise<void>;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [current, setCurrent] = useState(() => new Date());
  const held = useRef(false);
  const [history, setHistory] = useState(() => spreadsheetEditor.snapshot());
  const [historyPending, setHistoryPending] = useState(false);
  const historyOperation = useRef(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [viewMenuTop, setViewMenuTop] = useState(48);
  const [viewMenuRight, setViewMenuRight] = useState(8);
  const viewMenuAnchor = useRef<ComponentRef<typeof View>>(null);
  const { width, height } = useWindowDimensions();
  const [availableWidth, setAvailableWidth] = useState(width);
  const controlWidth = Math.max(40, Math.min(44, availableWidth / 9));
  const controlStyle = [styles.menuButton, { width: controlWidth }];
  const navigationBusy = viewChanging || historyPending || history.busy;

  useEffect(() => { setViewMenuOpen(false); }, [width]);

  useEffect(() => {
    const update = () => setHistory(spreadsheetEditor.snapshot());
    const unsubscribe = spreadsheetEditor.subscribe(update);
    update();
    return unsubscribe;
  }, []);

  async function changeHistory(action: 'undo' | 'redo') {
    const snapshot = spreadsheetEditor.snapshot();
    if (viewChanging || historyOperation.current || snapshot.busy || !(action === 'undo' ? snapshot.canUndo : snapshot.canRedo)) return;
    historyOperation.current = true;
    setHistoryPending(true);
    Keyboard.dismiss();
    try {
      await flushInlineMinutes();
      await (action === 'undo' ? undoSpreadsheetEdit() : redoSpreadsheetEdit());
    } catch (error) {
      Alert.alert(action === 'undo' ? 'Could not undo edit' : 'Could not redo edit',
        error instanceof Error ? error.message : 'The edit could not be restored. Try again.');
    } finally {
      historyOperation.current = false;
      setHistoryPending(false);
    }
  }

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

  const currentDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(current);
  const openPicker = () => {
    if (navigationBusy || historyOperation.current) return;
    setViewMenuOpen(false); Keyboard.dismiss(); onOpenDatePicker();
  };
  const openViews = () => {
    if (navigationBusy || historyOperation.current) return;
    Keyboard.dismiss();
    viewMenuAnchor.current?.measureInWindow((x, y, anchorWidth, anchorHeight) => {
      setViewMenuTop(Math.max(8, Math.min(y + anchorHeight + 4, height - 304)));
      setViewMenuRight(Math.max(8, Math.min(width - x - anchorWidth, width - 216)));
      setViewMenuOpen(true);
    });
  };

  return <><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.calendarHeaderScroll}
    contentContainerStyle={styles.calendarHeaderContent} scrollEnabled={availableWidth < controlWidth * 9 - 0.5}
    onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}>
    <View style={[styles.calendarHeader, { minWidth: controlWidth * 9 }]}>
    <Pressable accessibilityRole="button" accessibilityLabel="Open Settings"
      disabled={navigationBusy} accessibilityState={{ disabled: navigationBusy }}
      onPress={onOpenSettings} style={controlStyle}>
      <CalendarHeaderIcon name="settings" />
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Previous calendar view"
      accessibilityState={{ disabled: !canGoPrevious || navigationBusy }} disabled={!canGoPrevious || navigationBusy} onPress={onPrevious}
      style={[controlStyle, (!canGoPrevious || navigationBusy) && styles.disabledCalendarNavigation]}>
      <Text allowFontScaling={false} style={styles.calendarNavigationArrow}>‹</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Go to ${currentDate}, current minute`}
      disabled={navigationBusy} accessibilityState={{ disabled: navigationBusy }}
      accessibilityHint="Touch and hold to choose dates"
      accessibilityActions={[{ name: 'longpress', label: 'Choose dates' }]}
      onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'longpress') { held.current = true; openPicker(); } }}
      onPressIn={() => { held.current = false; }}
      onLongPress={() => { held.current = true; openPicker(); }} delayLongPress={450}
      onPress={() => { if (!held.current) onJumpToNow(); held.current = false; }} style={controlStyle}>
      <CalendarViewIcon mode="day" currentDate={current} />
    </Pressable>
    <View ref={viewMenuAnchor} collapsable={false}>
      <Pressable accessibilityRole="button" accessibilityLabel="Choose calendar view"
        accessibilityState={{ expanded: viewMenuOpen, disabled: navigationBusy }} disabled={navigationBusy}
        onPress={openViews} style={controlStyle}>
        {viewChanging ? <ActivityIndicator size="small" color={colors.graphite} /> :
          <Text allowFontScaling={false} style={styles.viewDropdownArrow}>▼</Text>}
      </Pressable>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Next calendar view"
      accessibilityState={{ disabled: !canGoNext || navigationBusy }} disabled={!canGoNext || navigationBusy} onPress={onNext}
      style={[controlStyle, (!canGoNext || navigationBusy) && styles.disabledCalendarNavigation]}>
      <Text allowFontScaling={false} style={styles.calendarNavigationArrow}>›</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Open Search"
      disabled={navigationBusy} accessibilityState={{ disabled: navigationBusy }}
      onPress={onOpenSearch} style={controlStyle}>
      <CalendarHeaderIcon name="search" />
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Undo Context edit"
      accessibilityState={{ disabled: !history.canUndo || navigationBusy }}
      disabled={!history.canUndo || navigationBusy} onPress={() => void changeHistory('undo')}
      style={[controlStyle, (!history.canUndo || navigationBusy) && styles.disabledCalendarNavigation]}>
      <Text allowFontScaling={false} style={styles.historyArrow}>↶</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Redo Context edit"
      accessibilityState={{ disabled: !history.canRedo || navigationBusy }}
      disabled={!history.canRedo || navigationBusy} onPress={() => void changeHistory('redo')}
      style={[controlStyle, (!history.canRedo || navigationBusy) && styles.disabledCalendarNavigation]}>
      <Text allowFontScaling={false} style={styles.historyArrow}>↷</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Open Reports"
      disabled={navigationBusy} accessibilityState={{ disabled: navigationBusy }}
      onPress={onOpenReports} style={controlStyle}>
      <CalendarHeaderIcon name="reports" />
    </Pressable>
    </View>
  </ScrollView>
    <Modal visible={viewMenuOpen} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent
      onRequestClose={() => setViewMenuOpen(false)}>
      <View style={styles.viewMenuBackdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close calendar views"
          onPress={() => setViewMenuOpen(false)} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.viewMenu, { top: viewMenuTop, right: viewMenuRight,
          maxHeight: Math.max(44, height - viewMenuTop - 8) }]}>
          <ScrollView>
            {CALENDAR_VIEW_OPTIONS.map((option) => {
              const selected = viewMode === option.mode || (viewMode === 'three-days' && option.mode === 'day');
              return <Pressable key={option.mode} accessibilityRole="button" accessibilityLabel={`${option.label} view`}
                accessibilityState={{ selected }} onPress={() => {
                  setViewMenuOpen(false);
                  void onViewModeChange(option.mode);
                }} style={[styles.viewOption, selected && styles.viewOptionSelected]}>
                <CalendarViewIcon mode={option.mode} currentDate={option.mode === 'day' ? current : undefined} />
                <Text maxFontSizeMultiplier={1.5} style={[styles.viewOptionText, selected && styles.viewOptionTextSelected]}>
                  {option.label}
                </Text>
              </Pressable>;
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const SCREEN_TITLES: Record<Tab, string> = {
  today: 'Day', reports: 'Reports', search: 'Search', settings: 'Settings',
  accounts: 'Calendar accounts', categories: 'Activity colors',
};

function ApplicationFrame({
  ready, tab, onReturnToCalendar, children,
}: {
  ready: boolean;
  tab: Tab;
  onReturnToCalendar: () => void;
  children: ReactNode;
}) {
  const { colors, resolvedMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

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
        <View style={styles.screen}>
          {ready && tab !== 'today' ? (
            <View style={styles.screenHeader}>
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
  calendarHeaderScroll: { height: 44, flexGrow: 0, flexShrink: 0, backgroundColor: colors.paper },
  calendarHeaderContent: { flexGrow: 1 },
  calendarHeader: { minHeight: 44, flexGrow: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', backgroundColor: colors.paper },
  calendarNavigationArrow: { color: colors.graphite, fontSize: 29, lineHeight: 34 },
  historyArrow: { color: colors.graphite, fontSize: 27, lineHeight: 34 },
  viewDropdownArrow: { color: colors.graphite, fontSize: 12, lineHeight: 20 },
  disabledCalendarNavigation: { opacity: 0.3 },
  viewMenuBackdrop: { flex: 1 },
  viewMenu: { position: 'absolute', width: 208, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline, borderRadius: 12, backgroundColor: colors.paper,
    shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 8 },
  viewOption: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 16 },
  viewOptionSelected: { backgroundColor: colors.panel },
  viewOptionText: { flex: 1, color: colors.graphite, fontSize: 16 },
  viewOptionTextSelected: { color: colors.ink, fontWeight: '700' },
  screenHeader: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline, backgroundColor: colors.paper,
  },
  menuButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  screenTitle: { flex: 1, marginLeft: 8, color: colors.ink, fontSize: 17, fontWeight: '600' },
  backButton: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
  backText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
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
