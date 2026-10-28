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
import * as Clipboard from 'expo-clipboard';
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
  getNativeCalendarSyncDiagnostics,
  listDeviceCalendars,
  NativeCalendarReconciliationError,
  reconcileLinkedCalendarColors,
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
import { CalendarPeriodSwipe } from './src/components/CalendarPeriodSwipe';
import { PrintOptionsPopup } from './src/components/PrintOptionsPopup';
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
import { hasConfiguredAccountCalendarWriter } from './src/services/calendar-write-routing';
import { configureCalendarColorImports, getAccountSyncStatus, requestAccountSynchronization, subscribeAccountSync, synchronizeAccounts } from './src/sync/engine';
import type { AccountSyncStatus } from './src/sync/types';
import { listCategories } from './src/services/categories';
import { printContextSchedule } from './src/services/print';
import { defaultPrintOptions, normalizePrintOptions, printOptionDates, type ContextPrintOptions, type PrintAction } from './src/utils/print-options';
import { flushInlineMinutes, inlineMinuteDrafts, subscribeInlineMinuteCommits } from './src/services/inline-minutes';
import { redoSpreadsheetEdit, spreadsheetEditor, subscribeSpreadsheetCommits, undoSpreadsheetEdit } from './src/services/spreadsheet';
import { ReleaseUpdateNotice, useReleaseUpdates } from './src/components/ReleaseUpdates';
import { useWearBridge } from './src/wear/useWearBridge';
import { calendarColorDraftObserver } from './src/utils/calendar-color-drafts';
import { createCoalescedDateWork } from './src/utils/coalesced-date-work';
import { createCalendarBinderPress } from './src/utils/calendar-binder-press';
import { advanceManualSyncTiming, createManualSyncTiming, finishManualSyncTiming,
  manualSyncDiagnosticsText, type ManualSyncStage, type ManualSyncTiming } from './src/utils/manual-sync-diagnostics';
import { nativeSyncDiagnosticsText } from './src/utils/native-sync-diagnostics';
import { accountSyncDiagnosticsText } from './src/utils/account-sync-diagnostics-text';

type Tab = 'today' | 'reports' | 'search' | 'settings' | 'accounts' | 'categories';
type DayCount = 1 | 3 | 7;
type NavigationAction = Exclude<Tab, 'today'> | 'plan';

const DEFAULT_PREFERENCES: CalendarPreferences = {
  selectedCalendarIds: [],
  writeCalendarId: null,
  syncActuals: false,
};

class CalendarTransitionCancelled extends Error {}
const MANUAL_SYNC_WAIT_MS = 35_000;
type ManualSyncAttempt = { epoch: number; stage: ManualSyncStage; timedOut: boolean;
  accountJob?: Promise<AccountSyncStatus>; accountCycleId?: number; timing: ManualSyncTiming };

function manualSyncStageText(stage: ManualSyncStage) {
  return { saving: 'Saving local minutes.', accounts: 'Synchronizing accounts.',
    'phone-calendars': 'Refreshing phone calendars.', 'linked-changes': 'Checking linked calendar changes.',
    'phone-updates': 'Updating linked phone-calendar events.', complete: 'Synchronization finished.' }[stage];
}

function accountSyncContinues(status: AccountSyncStatus) {
  return status.running || status.cycleComplete === false || status.outcome === 'running' || status.outcome === 'continuing' ||
    status.message === 'Private ledger synchronization is continuing.';
}

function accountSyncFailure(status: AccountSyncStatus) {
  const messages: string[] = [];
  const ordinary = ['Accounts synchronized', 'Ready to connect', 'Connect an account to sync your phones'];
  if (status.outcome === 'error' || (!status.outcome && !accountSyncContinues(status) && status.message && !ordinary.includes(status.message))) {
    if (status.message) messages.push(status.message);
  }
  if (status.conflicts) messages.push('Review calendar conflicts in Settings → Calendar accounts.');
  return [...new Set(messages)].join('\n') || null;
}

function accountSyncProgressText(status: AccountSyncStatus) {
  const phases = { idle: 'Account synchronization is ready.', 'checking-storage': 'Checking encrypted ledger storage.',
    downloading: 'Checking downloaded ledger updates.', uploading: 'Uploading encrypted ledger updates.',
    calendar: 'Synchronizing calendar activities.' };
  // The worker distinguishes key preparation from network upload even though
  // both share a phase. Keep its actual step visible in Sync details.
  const message = status.message || (status.phase ? phases[status.phase] : phases.idle);
  const progress = status.progress;
  const count = progress && Number.isSafeInteger(progress.completed) && progress.completed >= 0
    ? Number.isSafeInteger(progress.total) && progress.total! >= progress.completed
      ? ` (${progress.completed} of ${progress.total})` : ` (${progress.completed})` : '';
  return (message || phases.idle) + count;
}

/** Cancellation releases the UI while the existing read/save promise finishes safely. */
function awaitCalendarTransition<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new CalendarTransitionCancelled()); };
    signal.addEventListener('abort', abort, { once: true });
    work.then((value) => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(new CalendarTransitionCancelled());
      else resolve(value);
    }, (error: unknown) => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppController />
    </SafeAreaProvider>
  );
}

function AppController() {
  const [ready, setReady] = useState(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const releaseUpdates = useReleaseUpdates(ready);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('today');
  const [dayCount, setDayCount] = useState<DayCount>(1);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('day');
  const [viewChanging, setViewChanging] = useState(false);
  const viewChangingRef = useRef(false);
  const controllerMountedRef = useRef(true);
  const lifecycleEpochRef = useRef(0);
  const transitionSequenceRef = useRef(0);
  const activeTransitionRef = useRef<{ sequence: number; controller: AbortController } | null>(null);
  const [printPreparing, setPrintPreparing] = useState(false);
  const [printPreparationAction, setPrintPreparationAction] = useState<PrintAction>('print');
  const [dashboardMetric, setDashboardMetric] = useState<ContextPrintOptions['dashboardMetric']>('recorded');
  const printAbortRef = useRef<AbortController | null>(null);
  const [manualSyncing, setManualSyncing] = useState(false);
  const [manualSyncError, setManualSyncError] = useState<string | null>(null);
  const [manualSyncNotice, setManualSyncNotice] = useState<string | null>(null);
  const [accountSyncStatus, setAccountSyncStatus] = useState(getAccountSyncStatus);
  const [calendarLoadWarning, setCalendarLoadWarning] = useState<{ scope: string; message: string | null } | null>(null);
  const manualSyncAbortRef = useRef<AbortController | null>(null);
  const manualSyncAttemptRef = useRef<ManualSyncAttempt | null>(null);
  const calendarColorContextRef = useRef<{ dates: string[]; calendars: DeviceCalendar[]; preferences: CalendarPreferences }>({
    dates: [], calendars: [], preferences: DEFAULT_PREFERENCES,
  });
  const colorDraftObserver = useMemo(() => calendarColorDraftObserver(inlineMinuteDrafts,
    () => controllerMountedRef.current && readyRef.current && AppState.currentState === 'active',
    () => { if (controllerMountedRef.current) setDataVersion((version) => version + 1); }), []);
  const [printOptionsInitial, setPrintOptionsInitial] = useState<ContextPrintOptions | null>(null);
  const [printOptionsOpen, setPrintOptionsOpen] = useState(false);
  const printOptionsOpenRef = useRef(false);
  const printOptionsClosingRef = useRef(false);
  const printOptionsSequence = useRef(0);
  const printOptionsActionFrame = useRef<number | null>(null);
  const pendingPrintOptionsAction = useRef<{ sequence: number; epoch: number; action: PrintAction; options: ContextPrintOptions } | null>(null);
  const [selectedDateKeys, setSelectedDateKeys] = useState<string[] | null>(null);
  const [overviewMonth, setOverviewMonth] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [calendarZoom, setCalendarZoom] = useState(1);
  const [calendarViewResetToken, setCalendarViewResetToken] = useState(0);
  const [clockFormat, setClockFormat] = useState<'12h' | '24h'>('12h');
  const viewWrites = useRef<Promise<unknown>>(Promise.resolve());
  const focusSequence = useRef(0);
  const [activeDate, setActiveDate] = useState(dateKey(new Date()));
  const calendarFocusRef = useRef({ dateKey: activeDate, minuteIndex: minuteIndexForDate(new Date()) });
  const [dataVersion, setDataVersion] = useState(0);
  const [permissionStatus, setPermissionStatus] = useState('undetermined');
  const [calendars, setCalendars] = useState<DeviceCalendar[]>([]);
  const [preferences, setPreferences] = useState<CalendarPreferences>(DEFAULT_PREFERENCES);
  const [accountCalendarWrites, setAccountCalendarWrites] = useState(false);
  const accountRefreshSequence = useRef(0);
  const planOpenRef = useRef(false);
  const calendarProjectionConfigRef = useRef({ ready, syncActuals: preferences.syncActuals,
    writeCalendarId: preferences.writeCalendarId, accountCalendarWrites });
  calendarProjectionConfigRef.current = { ready, syncActuals: preferences.syncActuals,
    writeCalendarId: preferences.writeCalendarId, accountCalendarWrites };
  const nativeProjectionWork = useMemo(() => createCoalescedDateWork(async (dates) => {
    const requested = calendarProjectionConfigRef.current;
    if (!controllerMountedRef.current || AppState.currentState !== 'active' || !requested.ready ||
        !requested.syncActuals || !requested.writeCalendarId) return;
    // The account worker drains a bounded durable-link pass and validates its
    // storage first. A phone-provider read cannot prevent that independent work.
    const accountResult = await synchronizeAccounts();
    if (accountResult.running || accountResult.cycleComplete === false || accountResult.nativeWriteReady !== true) {
      throw new Error('Phone-calendar updates remain queued until account synchronization is ready.');
    }
    const directWrites = await hasConfiguredAccountCalendarWriter();
    const current = calendarProjectionConfigRef.current;
    if (!controllerMountedRef.current || AppState.currentState !== 'active' || !current.ready ||
        !current.syncActuals || !current.writeCalendarId || current.writeCalendarId !== requested.writeCalendarId) return;
    const result = await flushPendingActuals(current.writeCalendarId, dates, 90,
      { existingBindingsOnly: directWrites || current.accountCalendarWrites });
    if (result.failed) throw new Error(result.reviewMessages?.join('\n') || 'Calendar projection remains queued.');
  }, () => controllerMountedRef.current && readyRef.current && AppState.currentState === 'active'), []);
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
    if (!controllerMountedRef.current) return [] as DeviceCalendar[];
    setPermissionStatus(status);
    if (status === 'granted') {
      const available = await listDeviceCalendars().catch(() => []);
      if (controllerMountedRef.current) setCalendars(available);
      return available;
    } else {
      setCalendars([]);
      return [] as DeviceCalendar[];
    }
  }, []);

  const calendarReturnRefresh = useMemo(() => createCalendarRefreshBurst(() => {
    const epoch = lifecycleEpochRef.current;
    void refreshCalendars().then(async (available) => {
      if (!controllerMountedRef.current || epoch !== lifecycleEpochRef.current || AppState.currentState !== 'active') return;
      const current = calendarColorContextRef.current;
      try {
        if (readyRef.current) await reconcileLinkedCalendarColors(current.dates, available, current.preferences, { nativeOnly: true });
      } catch { /* Keep raw drafts and retry on the next foreground/manual refresh. */ }
      if (controllerMountedRef.current && epoch === lifecycleEpochRef.current && AppState.currentState === 'active') {
        setDataVersion((version) => version + 1);
      }
    }).catch(() => { /* Calendar reads can retry without interrupting entry. */ });
  }, () => AppState.currentState === 'active'), [refreshCalendars]);

  useEffect(() => () => calendarReturnRefresh.cancel(), [calendarReturnRefresh]);
  useEffect(() => {
    nativeProjectionWork.resume();
    return () => nativeProjectionWork.suspend();
  }, [nativeProjectionWork]);
  useEffect(() => {
    controllerMountedRef.current = true;
    return () => {
      controllerMountedRef.current = false;
      lifecycleEpochRef.current += 1;
      activeTransitionRef.current?.controller.abort();
      activeTransitionRef.current = null;
      viewChangingRef.current = false;
      printAbortRef.current?.abort();
      printAbortRef.current = null;
      manualSyncAbortRef.current?.abort();
      manualSyncAbortRef.current = null;
      manualSyncAttemptRef.current = null;
      invalidatePrintOptionsAction();
      printOptionsOpenRef.current = false;
      printOptionsClosingRef.current = false;
    };
  }, []);

  useEffect(() => {
    configureCalendarColorImports(colorDraftObserver);
    // An in-flight source read must retain a closed guard after unmount rather than
    // dropping the observer and accidentally permitting its late database write.
    return () => configureCalendarColorImports({ canImport: () => false });
  }, [colorDraftObserver]);

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
        const directWrites = await hasConfiguredAccountCalendarWriter();
        setAccountCalendarWrites(directWrites);
        if (!mounted) return;
        configureCalendarProjection(savedPreferences.syncActuals ? savedPreferences.writeCalendarId : null);
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
        const current = new Date();
        const focusDay = normalizedDates[0] ?? dateKey(current);
        const restoredFocus = { dateKey: focusDay, minuteIndex: focusDay === dateKey(current) ? minuteIndexForDate(current) : 9 * 60 };
        calendarFocusRef.current = restoredFocus; setActiveDate(focusDay);
        setFocusRequest({ ...restoredFocus, token: ++focusSequence.current, openEditor: false });
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
        lifecycleEpochRef.current += 1;
        activeTransitionRef.current?.controller.abort();
        printAbortRef.current?.abort();
        manualSyncAbortRef.current?.abort();
        manualSyncAttemptRef.current = null;
        invalidatePrintOptionsAction();
        calendarReturnRefresh.cancel();
        nativeProjectionWork.suspend();
        // Commit the current cell before the app leaves the foreground. Pending drafts
        // remain in the inline controller if the local database cannot accept a write.
        if (ready) void flushInlineMinutes().catch(() => {});
        return;
      }
      if (Platform.OS !== 'ios' && !printOptionsOpenRef.current) printOptionsClosingRef.current = false;
      setAccountSyncStatus(getAccountSyncStatus());
      // Some calendar providers publish a saved event shortly after their editor closes.
      calendarReturnRefresh.start();
      nativeProjectionWork.resume();
      const epoch = lifecycleEpochRef.current;
      if (ready) void flushInlineMinutes().then(() => {
        if (!controllerMountedRef.current || epoch !== lifecycleEpochRef.current || AppState.currentState !== 'active') return;
        requestAccountSynchronization();
        nativeProjectionWork.request(calendarColorContextRef.current.dates);
      }).catch(() => {});
    });
    return () => subscription.remove();
  }, [ready, calendarReturnRefresh, nativeProjectionWork]);

  useEffect(() => {
    if (!ready || !preferences.syncActuals || !preferences.writeCalendarId) return;
    nativeProjectionWork.request(calendarColorContextRef.current.dates);
  }, [accountCalendarWrites, preferences.syncActuals, preferences.writeCalendarId, ready, nativeProjectionWork]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastAccountCompletionAt: number | null = null;
    const unsubscribe = subscribeAccountSync((next) => {
      if (!cancelled && controllerMountedRef.current && AppState.currentState === 'active') setAccountSyncStatus(next);
      if (!next.running && next.cycleComplete === true) lastAccountCompletionAt = Date.now();
      if (!next.running) {
        void listCategories().then(() => {
          if (!cancelled && controllerMountedRef.current && AppState.currentState === 'active') setDataVersion((version) => version + 1);
        }).catch(() => { /* Categories can refresh on the next pass. */ });
      }
    });
    let polling = false;
    const schedule = (delay = 15000) => {
      if (cancelled || polling || timer !== null || !controllerMountedRef.current ||
          !readyRef.current || AppState.currentState !== 'active') return;
      timer = setTimeout(() => { timer = null; void poll(); }, delay);
    };
    const poll = async () => {
      if (polling || cancelled || !controllerMountedRef.current || !readyRef.current || AppState.currentState !== 'active') return;
      // Saved edits and manual Sync have their own prompt workers. A recently
      // completed independent cycle makes another full background sweep redundant.
      const sinceCompletion = lastAccountCompletionAt === null ? null : Date.now() - lastAccountCompletionAt;
      if (sinceCompletion !== null && sinceCompletion >= 0 && sinceCompletion < 15000) {
        schedule(15000 - sinceCompletion); return;
      }
      polling = true;
      const epoch = lifecycleEpochRef.current;
      const currentPass = () => !cancelled && controllerMountedRef.current && readyRef.current &&
        epoch === lifecycleEpochRef.current && AppState.currentState === 'active';
      try {
        const current = calendarColorContextRef.current;
        let accountReady = false;
        try {
          const result = await synchronizeAccounts();
          accountReady = !result.running && result.cycleComplete !== false && result.nativeWriteReady === true;
        }
        catch { /* Accounts can retry independently of device-calendar reads. */ }
        if (!currentPass() || !accountReady) return;
        // Native preflight still precedes native writes. It no longer holds up
        // authenticated account synchronization or its storage validation.
        try { await reconcileLinkedCalendarColors(current.dates, current.calendars, current.preferences, { nativeOnly: true }); }
        catch { /* Retain the source guard; the native worker rechecks each binding. */ }
        if (currentPass()) nativeProjectionWork.resume();
      }
      finally { polling = false; schedule(); }
    };
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') schedule();
      else { if (timer !== null) clearTimeout(timer); timer = null; }
    });
    void poll();
    return () => {
      cancelled = true; unsubscribe(); appStateSubscription.remove();
      if (timer !== null) clearTimeout(timer); timer = null;
    };
  }, [ready, nativeProjectionWork]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (printAbortRef.current) { printAbortRef.current.abort(); return true; }
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
    if (!controllerMountedRef.current) return;
    setDataVersion((version) => version + 1);
    const sequence = ++accountRefreshSequence.current;
    void hasConfiguredAccountCalendarWriter().then((directWrites) => {
      if (!controllerMountedRef.current || sequence !== accountRefreshSequence.current) return;
      setAccountCalendarWrites(directWrites);
      const current = calendarProjectionConfigRef.current;
      configureCalendarProjection(current.syncActuals ? current.writeCalendarId : null);
    }).catch(() => { /* Keep the current projection settings; account refresh can retry. */ });
    requestAccountSynchronization();
  }, []);

  const watchDataChanged = useCallback((days: string[]) => {
    dataChanged();
    const current = calendarProjectionConfigRef.current;
    if (current.ready && current.syncActuals && current.writeCalendarId) {
      nativeProjectionWork.request(days);
    }
  }, [dataChanged, nativeProjectionWork]);
  useWearBridge(ready, watchDataChanged);

  useEffect(() => {
    if (!ready) return;
    // This listener lives above Today so a write that finishes after opening Reports
    // still refreshes the app and queues the affected dates for the chosen calendar.
    const handleCommit = (affectedDates: string[], textChanged = true) => {
      dataChanged();
      if (!textChanged) return;
      nativeProjectionWork.request(affectedDates);
    };
    const unsubscribe = subscribeInlineMinuteCommits(({ affectedDates }) => handleCommit(affectedDates));
    const unsubscribeSpreadsheet = subscribeSpreadsheetCommits(({ affectedDates, textChanged }) => handleCommit(affectedDates, textChanged));
    return () => {
      unsubscribe();
      unsubscribeSpreadsheet();
      void flushInlineMinutes().catch(() => {});
    };
  }, [dataChanged, ready, nativeProjectionWork]);

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
    configureCalendarProjection(sanitized.syncActuals ? sanitized.writeCalendarId : null);
    setPreferences(sanitized);
    void setSetting('calendar.preferences', sanitized);
    if (needsFullReprojection) {
      void enqueueBoundDatesForSync().then(() => {
        if (sanitized.writeCalendarId) nativeProjectionWork.request(calendarColorContextRef.current.dates);
      });
    }
  }

  function openSearchResult(result: SearchResult) {
    calendarFocusRef.current = { dateKey: result.dateKey, minuteIndex: result.minuteIndex };
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

  async function transitionFromCalendar(change: () => void | Promise<void>, failureTitle: string, signal?: AbortSignal,
    onFailure?: (message: string) => void) {
    if (viewChangingRef.current || !controllerMountedRef.current || AppState.currentState !== 'active' || signal?.aborted) return;
    const epoch = lifecycleEpochRef.current;
    const sequence = ++transitionSequenceRef.current;
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    if (signal?.aborted) controller.abort();
    activeTransitionRef.current = { sequence, controller };
    const current = () => controllerMountedRef.current && lifecycleEpochRef.current === epoch &&
      activeTransitionRef.current?.sequence === sequence && !controller.signal.aborted && AppState.currentState === 'active';
    viewChangingRef.current = true;
    setViewChanging(true);
    Keyboard.dismiss();
    try {
      // Navigation can unmount the minute editor. Keep its draft in place if saving fails.
      await awaitCalendarTransition(flushInlineMinutes(), controller.signal);
      if (!current()) throw new CalendarTransitionCancelled();
      if (inlineMinuteDrafts.snapshot().some((draft) => draft.error || draft.revision !== draft.savedRevision)) {
        throw new Error('Your current minute could not be saved. Try again.');
      }
      await awaitCalendarTransition(Promise.resolve().then(() => {
        if (!current()) throw new CalendarTransitionCancelled();
        return change();
      }), controller.signal);
    } catch (error) {
      if (!(error instanceof CalendarTransitionCancelled) && current()) {
        const message = error instanceof Error ? error.message : 'Save your current minute and try again.';
        if (onFailure) onFailure(message);
        else Alert.alert(failureTitle, message);
      }
    } finally {
      signal?.removeEventListener('abort', forwardAbort);
      if (activeTransitionRef.current?.sequence === sequence) {
        activeTransitionRef.current = null;
        viewChangingRef.current = false;
        if (controllerMountedRef.current) setViewChanging(false);
      }
    }
  }

  function changeViewMode(next: CalendarViewMode, anchor?: string) {
    return transitionFromCalendar(() => {
      const focus = calendarFocusRef.current;
      const targetDate = anchor ?? focus.dateKey;
      calendarFocusRef.current = { dateKey: targetDate, minuteIndex: focus.minuteIndex };
      setViewMode(next);
      setActiveDate(targetDate);
      setDayCount(next === 'week' ? 7 : next === 'three-days' ? 3 : 1);
      setSelectedDateKeys(null);
      setOverviewMonth(next === 'month' || next === 'schedule' ? targetDate.slice(0, 7) + '-01' : null);
      setFocusRequest({ dateKey: targetDate, minuteIndex: focus.minuteIndex, token: ++focusSequence.current, openEditor: false });
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
    calendarFocusRef.current = { ...calendarFocusRef.current, dateKey: dates[0]! };
    setFocusRequest({ ...calendarFocusRef.current, token: ++focusSequence.current, openEditor: false });
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

  function returnToCalendar() {
    setFocusRequest({ ...calendarFocusRef.current, token: ++focusSequence.current, openEditor: false });
    setTab('today');
  }

  function openCalendarMinute(day: string, minute: number) {
    calendarFocusRef.current = { dateKey: day, minuteIndex: minute };
    changeDayCount(1);
    setActiveDate(day);
    setFocusRequest({ dateKey: day, minuteIndex: minute, token: ++focusSequence.current, openEditor: false });
    setTab('today');
  }

  function jumpToCurrentMinute() {
    return transitionFromCalendar(() => {
      const current = new Date();
      const today = dateKey(current);
      calendarFocusRef.current = { dateKey: today, minuteIndex: minuteIndexForDate(current) };
      // Keep the current view and zoom. Clear a custom past-only selection so
      // the present can be displayed inside that same kind of view.
      setActiveDate(today);
      setSelectedDateKeys(null);
      setOverviewMonth(viewMode === 'month' || viewMode === 'schedule' ? today.slice(0, 7) + '-01' : null);
      setFocusRequest({ dateKey: today, minuteIndex: minuteIndexForDate(current),
        token: ++focusSequence.current, openEditor: false });
      setCalendarViewResetToken((token) => token + 1);
      setTab('today');
      viewWrites.current = viewWrites.current.catch(() => undefined)
        .then(() => setSetting('calendar.selected-date-keys', null)).catch(() => undefined);
    }, 'Could not go to the current time');
  }

  function shiftCalendarView(target: CalendarNavigationTarget | null) {
    if (!target) return;
    setActiveDate(target.activeDate);
    calendarFocusRef.current = { ...calendarFocusRef.current, dateKey: target.activeDate };
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
  const calendarFocusScope = viewKind + '|' + activeDate + '|' + (selectedDateKeys?.join(',') ?? '') + '|' + calendarViewResetToken;
  const calendarFocusScopeRef = useRef(calendarFocusScope);
  calendarFocusScopeRef.current = calendarFocusScope;
  const reportFocusedMinute = useMemo(() => (point: { dateKey: string; minuteIndex: number }) => {
    if (calendarFocusScopeRef.current !== calendarFocusScope || !isDateKey(point.dateKey) ||
        !Number.isInteger(point.minuteIndex) || point.minuteIndex < 0 || point.minuteIndex > 1439) return;
    calendarFocusRef.current = { ...point };
  }, [calendarFocusScope]);
  function swipeCalendarPeriod(direction: -1 | 1) {
    if (tab !== 'today' || datePickerOpen || viewChangingRef.current) return;
    const target = direction < 0 ? previousView : nextView;
    if (target) return transitionFromCalendar(() => shiftCalendarView(target), 'Could not change dates');
  }
  const syncWarningScope = JSON.stringify([tab, viewKind, activeDate, selectedDateKeys]);
  const syncWarningScopeRef = useRef(syncWarningScope);
  syncWarningScopeRef.current = syncWarningScope;
  const reportCalendarSyncWarning = useCallback((message: string | null) => {
    if (syncWarningScopeRef.current !== syncWarningScope) return;
    setCalendarLoadWarning((previous) => previous?.scope === syncWarningScope && previous.message === message
      ? previous : { scope: syncWarningScope, message });
  }, [syncWarningScope]);
  const calendarSyncError = [...new Set([manualSyncError, accountSyncFailure(accountSyncStatus),
    calendarLoadWarning?.scope === syncWarningScope ? calendarLoadWarning.message : null].filter(Boolean))].join('\n\n') || null;
  const overviewDates = useMemo(() => calendarViewDates(viewMode, activeDate, selectedDateKeys),
    [viewMode, activeDate, selectedDateKeys]);
  calendarColorContextRef.current = { dates: overviewDates, calendars, preferences };

  function calendarSyncTimingDetails() {
    const attempt = manualSyncAttemptRef.current;
    const parts = attempt && attempt.epoch === lifecycleEpochRef.current
      ? [manualSyncDiagnosticsText(attempt.timing, Date.now())] : [];
    parts.push(accountSyncDiagnosticsText(getAccountSyncStatus().diagnostics, Date.now()));
    parts.push(nativeSyncDiagnosticsText(getNativeCalendarSyncDiagnostics()));
    return parts.filter(Boolean).join('\n\n');
  }

  function calendarSyncDetails() {
    const attempt = manualSyncAttemptRef.current;
    const status = getAccountSyncStatus();
    const active = attempt && attempt.epoch === lifecycleEpochRef.current;
    const parts = [active ? attempt.stage === 'accounts' ? manualSyncStageText('accounts') : manualSyncNotice : null,
      accountSyncProgressText(status)];
    if (active && attempt.timedOut && status.running && attempt.stage === 'accounts') {
      parts.push('This account work is continuing in the background. Saved minutes remain available for editing.');
    }
    parts.push(calendarSyncTimingDetails());
    return [...new Set(parts.filter(Boolean))].join('\n\n');
  }

  async function synchronizeCalendar() {
    if (!ready || viewChangingRef.current || manualSyncAbortRef.current || !controllerMountedRef.current || AppState.currentState !== 'active') return;
    const controller = new AbortController();
    const epoch = lifecycleEpochRef.current;
    const attempt: ManualSyncAttempt = { epoch, stage: 'saving', timedOut: false, timing: createManualSyncTiming(Date.now()) };
    manualSyncAttemptRef.current = attempt;
    manualSyncAbortRef.current = controller;
    setManualSyncing(true);
    setManualSyncError(null);
    setManualSyncNotice(manualSyncStageText('saving'));
    const isVisibleAttempt = () => manualSyncAttemptRef.current === attempt && controllerMountedRef.current &&
      lifecycleEpochRef.current === epoch && AppState.currentState === 'active';
    const requireCurrent = () => {
      if (controller.signal.aborted || !isVisibleAttempt()) throw new CalendarTransitionCancelled();
    };
    const stage = (next: ManualSyncStage) => {
      requireCurrent(); advanceManualSyncTiming(attempt.timing, next, Date.now());
      attempt.stage = next; setManualSyncNotice(manualSyncStageText(next));
    };
    // Release only this caller's wait. The shared account worker retains its
    // storage/version guards and can finish without holding the minute editor.
    const deadline = setTimeout(() => {
      if (manualSyncAbortRef.current !== controller) return;
      attempt.timedOut = true;
      if (isVisibleAttempt()) {
        const detail = attempt.stage === 'accounts' ? accountSyncProgressText(getAccountSyncStatus()) : manualSyncStageText(attempt.stage);
        setManualSyncNotice(detail + '\nThis step is still pending. You can keep editing saved minutes and hold Sync for details.');
      }
      controller.abort();
    }, MANUAL_SYNC_WAIT_MS);
    try {
      await awaitCalendarTransition((async () => {
        try {
        await flushInlineMinutes();
        requireCurrent();
        if (inlineMinuteDrafts.snapshot().some((draft) => draft.error)) {
          throw new Error('Your current minute could not be saved. Try again.');
        }
        stage('accounts');
        // synchronizeAccounts drains a bounded durable-link pass itself. Neither
        // an unbounded local-link drain nor phone-provider reads precede it.
        const accountJob = synchronizeAccounts();
        attempt.accountJob = accountJob;
        const snapshot = getAccountSyncStatus();
        if (snapshot.running && snapshot.cycleComplete === false) attempt.accountCycleId = snapshot.cycleId;
        const observe = (result: AccountSyncStatus | null, error?: unknown) => {
          if (!isVisibleAttempt() || !attempt.timedOut || attempt.stage !== 'accounts' || attempt.accountJob !== accountJob) return;
          if (result && attempt.accountCycleId !== undefined && result.cycleId !== undefined && result.cycleId !== attempt.accountCycleId) return;
          const failure = result ? accountSyncFailure(result) : error instanceof Error ? error.message : 'Account synchronization needs a retry.';
          setManualSyncError(failure);
          setManualSyncNotice(result && accountSyncContinues(result) ? accountSyncProgressText(result) : failure ? null :
            'Account synchronization finished. Linked phone-calendar updates can be checked with Sync.');
          // This observer intentionally does not resume the expired native steps.
        };
        void accountJob.then((result) => observe(result), (error) => observe(null, error));
        const accountResult = await accountJob;
        requireCurrent();
        const messages: string[] = [];
        const accountFailure = accountSyncFailure(accountResult);
        if (accountFailure) messages.push(accountFailure);
        if (accountResult.running || accountResult.cycleComplete === false || accountResult.nativeWriteReady !== true) {
          setManualSyncNotice(accountSyncProgressText(accountResult));
          if (messages.length) setManualSyncError(messages.join('\n'));
          return;
        }
        const continuing = accountSyncContinues(accountResult);
        // Account work has settled before any native preflight or mutation.
        // A failure here cannot undo account success or authorize blind writes.
        stage('phone-calendars');
        const available = await refreshCalendars();
        requireCurrent();
        const current = calendarColorContextRef.current;
        stage('linked-changes');
        try { await reconcileLinkedCalendarColors(current.dates, available, current.preferences, { nativeOnly: true }); }
        catch (error) {
          requireCurrent();
          messages.push(error instanceof Error ? error.message : 'Linked phone-calendar changes need review.');
          if (!(error instanceof NativeCalendarReconciliationError)) {
            setManualSyncError([...new Set(messages)].join('\n'));
            setManualSyncNotice('Account work finished; linked phone-calendar updates remain queued for review.');
            return; // A whole-source/permission failure still stops every native write.
          }
          // Individual binding reviews remain protected by the outbox's own
          // fresh per-binding preflight. Other checked activities may proceed.
        }
        requireCurrent();
        const beforeWriterCheck = calendarProjectionConfigRef.current;
        const directWrites = await hasConfiguredAccountCalendarWriter();
        requireCurrent();
        const config = calendarProjectionConfigRef.current;
        if (config.syncActuals && config.writeCalendarId && config.writeCalendarId === beforeWriterCheck.writeCalendarId) {
          stage('phone-updates');
          const result = await flushPendingActuals(config.writeCalendarId, [], 90,
            { existingBindingsOnly: config.accountCalendarWrites || directWrites });
          requireCurrent();
          if (result.failed) messages.push(...(result.reviewMessages?.length ? result.reviewMessages :
            ['Some linked phone-calendar updates need review. Check calendar synchronization in Settings.']));
        }
        requireCurrent();
        setDataVersion((version) => version + 1);
        colorDraftObserver.consumeSkipped();
        stage('complete');
        setManualSyncNotice(continuing ? accountSyncProgressText(accountResult) : manualSyncStageText('complete'));
        if (messages.length) setManualSyncError([...new Set(messages)].join('\n'));
        } finally { finishManualSyncTiming(attempt.timing, Date.now()); }
      })(), controller.signal);
    } catch (error) {
      if (!(error instanceof CalendarTransitionCancelled) && !controller.signal.aborted && isVisibleAttempt()) {
        setManualSyncError(error instanceof Error ? error.message : 'Synchronization will retry.');
      }
    } finally {
      clearTimeout(deadline);
      if (manualSyncAbortRef.current === controller) {
        manualSyncAbortRef.current = null;
        if (controllerMountedRef.current) setManualSyncing(false);
      }
    }
  }

  function invalidatePrintOptionsAction() {
    printOptionsSequence.current += 1;
    pendingPrintOptionsAction.current = null;
    if (printOptionsActionFrame.current != null) {
      cancelAnimationFrame(printOptionsActionFrame.current);
      printOptionsActionFrame.current = null;
    }
  }

  function openPrintOptions() {
    if (printOptionsClosingRef.current || printOptionsOpenRef.current) return;
    return transitionFromCalendar(() => {
      invalidatePrintOptionsAction();
      setPrintOptionsInitial({ ...defaultPrintOptions(overviewDates, viewMode), dashboardMetric });
      printOptionsOpenRef.current = true;
      setPrintOptionsOpen(true);
    }, 'Could not open print options');
  }

  function closePrintOptions() {
    if (!controllerMountedRef.current) return;
    invalidatePrintOptionsAction();
    printOptionsClosingRef.current = printOptionsOpenRef.current || printOptionsClosingRef.current;
    printOptionsOpenRef.current = false;
    setPrintOptionsOpen(false);
    if (Platform.OS !== 'ios') {
      const sequence = printOptionsSequence.current;
      printOptionsActionFrame.current = requestAnimationFrame(() => {
        printOptionsActionFrame.current = null;
        if (controllerMountedRef.current && sequence === printOptionsSequence.current) printOptionsClosingRef.current = false;
      });
    }
  }

  function finishPrintOptionsAction(expectedSequence?: number) {
    const pending = pendingPrintOptionsAction.current;
    if (!pending || (expectedSequence != null && pending.sequence !== expectedSequence)) return;
    pendingPrintOptionsAction.current = null;
    if (printOptionsActionFrame.current != null) { cancelAnimationFrame(printOptionsActionFrame.current); printOptionsActionFrame.current = null; }
    if (!controllerMountedRef.current || AppState.currentState !== 'active' || pending.epoch !== lifecycleEpochRef.current ||
        pending.sequence !== printOptionsSequence.current || viewChangingRef.current) return;
    printOptionsSequence.current += 1;
    void printCurrentDates(pending.action, pending.options);
  }

  function confirmPrintOptions(action: PrintAction, options: ContextPrintOptions) {
    if (!controllerMountedRef.current || AppState.currentState !== 'active' || viewChangingRef.current ||
        !printOptionsOpenRef.current || printOptionsClosingRef.current || pendingPrintOptionsAction.current) return;
    let normalized: ContextPrintOptions;
    try { normalized = normalizePrintOptions(options); printOptionDates(normalized); }
    catch (error) {
      Alert.alert('Check print options', error instanceof Error ? error.message : 'Check the selected dates.');
      return;
    }
    const sequence = ++printOptionsSequence.current;
    pendingPrintOptionsAction.current = { action, options: normalized, sequence, epoch: lifecycleEpochRef.current };
    printOptionsOpenRef.current = false;
    printOptionsClosingRef.current = true;
    setPrintOptionsOpen(false);
    if (Platform.OS !== 'ios') printOptionsActionFrame.current = requestAnimationFrame(() => {
      printOptionsActionFrame.current = null;
      printOptionsClosingRef.current = false;
      finishPrintOptionsAction(sequence);
    });
  }

  async function printCurrentDates(action: PrintAction, options: ContextPrintOptions) {
    if (viewChangingRef.current || !controllerMountedRef.current || AppState.currentState !== 'active') return;
    const controller = new AbortController();
    printAbortRef.current = controller;
    if (options.view === 'dashboard') setDashboardMetric(options.dashboardMetric);
    setPrintPreparationAction(action);
    setPrintPreparing(true);
    try {
      await transitionFromCalendar(async () => {
        await printContextSchedule({ dates: printOptionDates(options), calendars, preferences, clockFormat,
          signal: controller.signal, options, action });
      }, action === 'save' ? 'Could not save PDF' : 'Could not print schedule', controller.signal);
    } finally {
      if (printAbortRef.current === controller) {
        printAbortRef.current = null;
        if (controllerMountedRef.current) setPrintPreparing(false);
      }
    }
  }

  return (
    <AppearanceProvider ready={ready}>
      <ApplicationFrame
        ready={ready}
        tab={tab}
        onReturnToCalendar={returnToCalendar}
      >
        {!ready ? (
          <LoadingState
            error={initializationError}
            onRetry={() => setInitializationAttempt((attempt) => attempt + 1)}
          />
        ) : (
          <>
            <ReleaseUpdateNotice updates={releaseUpdates} />
            {printPreparing ? <PrintPreparationNotice action={printPreparationAction} onCancel={() => printAbortRef.current?.abort()} /> : null}
            <View style={{ flex: 1 }} pointerEvents={viewChanging ? 'none' : 'auto'}>
              {tab === 'today' ? <>
                <CalendarHeader onOpenSettings={() => void navigate('settings')} onOpenSearch={() => void navigate('search')}
                  onPrint={() => void openPrintOptions()}
                  onSync={() => void synchronizeCalendar()} syncing={manualSyncing || accountSyncStatus.running} syncError={calendarSyncError}
                  syncDetails={calendarSyncDetails} syncTimingDetails={calendarSyncTimingDetails}
                  onOpenReports={() => void navigate('reports')} onJumpToNow={jumpToCurrentMinute}
                  viewMode={viewMode} viewChanging={viewChanging} onViewModeChange={changeViewMode}
                  canGoPrevious={previousView != null} canGoNext={nextView != null}
                  onPrevious={() => shiftCalendarView(previousView)} onNext={() => shiftCalendarView(nextView)}
                  onOpenDatePicker={() => void transitionFromCalendar(() => setDatePickerOpen(true), 'Could not choose dates')} />
                <CalendarPeriodSwipe scope={viewKind + '|' + activeDate + '|' + (selectedDateKeys?.join(',') ?? '')}
                  enabled={viewKind !== 'minutes' && viewKind !== 'year' && !viewChanging && !datePickerOpen}
                  onPage={(direction) => void swipeCalendarPeriod(direction)}>
                {viewKind === 'year' ? <CalendarYearScreen activeDate={activeDate} onOpenMinute={openCalendarMinute} focusRequest={focusRequest}
                  onFocusedMinuteChange={reportFocusedMinute}
                  onOpenMonth={(month) => void changeViewMode('month', month)} /> : viewKind === 'schedule' ? <CalendarScheduleScreen
                  activeDate={activeDate} selectedDates={overviewDates} calendars={calendars}
                  preferences={accountCalendarWrites ? { ...preferences, syncActuals: false } : preferences}
                  dataVersion={dataVersion} clockFormat={clockFormat} onOpenMinute={openCalendarMinute}
                  onSyncWarningChange={reportCalendarSyncWarning}
                  focusRequest={focusRequest} onFocusedMinuteChange={reportFocusedMinute}
                  onVisibleMonthChange={visibleOverviewMonthChanged}
                /> : viewKind === 'month' ? <MonthOverview
                  activeDate={activeDate} focusRequest={focusRequest} onFocusedMinuteChange={reportFocusedMinute}
                  onSyncWarningChange={reportCalendarSyncWarning}
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
                  onSyncWarningChange={reportCalendarSyncWarning}
                  focusRequest={focusRequest}
                  onFocusConsumed={consumeFocus} onFocusedMinuteChange={reportFocusedMinute}
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
                  onPeriodSwipe={(direction) => void swipeCalendarPeriod(direction)}
                />
                }
                </CalendarPeriodSwipe>
              </> : null}
              {tab === 'reports' ? <ReportsScreen dataVersion={dataVersion} initialDate={activeDate}
                metric={dashboardMetric} onMetricChange={setDashboardMetric} /> : null}
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
                  onRefreshCalendars={async () => { await refreshCalendars(); }}
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
      {printOptionsInitial ? <PrintOptionsPopup visible={printOptionsOpen && ready} initialOptions={printOptionsInitial}
        onClose={closePrintOptions} onConfirm={confirmPrintOptions} onDismiss={() => {
          if (Platform.OS === 'ios') { printOptionsClosingRef.current = false; finishPrintOptionsAction(); }
          else if (!printOptionsOpenRef.current && !pendingPrintOptionsAction.current) printOptionsClosingRef.current = false;
        }} /> : null}
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

function CalendarHeader({ onOpenSettings, onPrint, onOpenSearch, onOpenReports, onSync, syncing, syncError, syncDetails, syncTimingDetails, onJumpToNow, onOpenDatePicker, canGoPrevious, canGoNext, onPrevious, onNext,
  viewMode, viewChanging, onViewModeChange }: {
  onOpenSettings: () => void;
  onPrint: () => void;
  onOpenSearch: () => void;
  onOpenReports: () => void;
  onSync: () => void;
  syncing: boolean;
  syncError: string | null;
  syncDetails?: string | (() => string) | null;
  syncTimingDetails?: () => string;
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
  const [history, setHistory] = useState(() => spreadsheetEditor.snapshot());
  const [historyPending, setHistoryPending] = useState(false);
  const historyOperation = useRef(false);
  const syncLongPress = useRef(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [viewMenuTop, setViewMenuTop] = useState(48);
  const [viewMenuRight, setViewMenuRight] = useState(8);
  const viewMenuAnchor = useRef<ComponentRef<typeof View>>(null);
  const viewVisibleRef = useRef(false);
  const viewClosingRef = useRef(false);
  const [gearMenuOpen, setGearMenuOpen] = useState(false);
  const [gearMenuTop, setGearMenuTop] = useState(48);
  const [gearMenuLeft, setGearMenuLeft] = useState(8);
  const gearMenuAnchor = useRef<ComponentRef<typeof View>>(null);
  const pendingGearAction = useRef<{ action: 'settings' | 'print' | 'search' | 'reports' | 'dates'; sequence: number } | null>(null);
  const gearVisibleRef = useRef(false);
  const gearClosingRef = useRef(false);
  const headerMountedRef = useRef(true);
  const menuRequestSequence = useRef(0);
  const gearActionFrame = useRef<number | null>(null);
  const dispatchingGearAction = useRef(false);
  const preparingViews = useRef(false);
  const { width, height } = useWindowDimensions();
  const [availableWidth, setAvailableWidth] = useState(width);
  const controlWidth = Math.max(40, Math.min(44, availableWidth / 7));
  const controlStyle = [styles.menuButton, { width: controlWidth }];
  const navigationBusy = viewChanging || historyPending || history.busy;
  const hasSyncDetails = Boolean(syncDetails || syncError || syncing);
  const showSyncDetails = () => {
    const detail = typeof syncDetails === 'function' ? syncDetails() : syncDetails;
    const message = [...new Set([detail, syncError].filter(Boolean))].join('\n\n');
    if (message) {
      if (syncTimingDetails) Alert.alert('Calendar synchronization', message, [
        { text: 'Copy timings', onPress: () => {
          const timing = syncTimingDetails();
          if (timing) void Clipboard.setStringAsync(timing).catch(() => {
            Alert.alert('Could not copy timings', 'Try Copy timings again.');
          });
        } },
        { text: 'OK', style: 'cancel' },
      ]);
      else Alert.alert('Calendar synchronization', message);
    }
  };
  const navigationBusyRef = useRef(navigationBusy);
  navigationBusyRef.current = navigationBusy;
  const binderActions = useRef({ single: () => {}, double: () => {}, long: () => {} });
  const binderPress = useMemo(() => createCalendarBinderPress({ allowed: () => headerMayNavigate(),
    single: () => binderActions.current.single(), double: () => binderActions.current.double(),
    long: () => binderActions.current.long() }), []);

  function invalidateMenus(render = true) {
    binderPress.cancel();
    menuRequestSequence.current += 1;
    pendingGearAction.current = null;
    if (gearActionFrame.current != null) { cancelAnimationFrame(gearActionFrame.current); gearActionFrame.current = null; }
    dispatchingGearAction.current = false;
    const closing = gearVisibleRef.current || gearClosingRef.current;
    const viewClosing = viewVisibleRef.current || viewClosingRef.current;
    gearVisibleRef.current = false;
    gearClosingRef.current = render && closing;
    viewVisibleRef.current = false;
    viewClosingRef.current = render && viewClosing;
    if (render && headerMountedRef.current) { setViewMenuOpen(false); setGearMenuOpen(false); }
    if (render && (closing || viewClosing) && Platform.OS !== 'ios') {
      const sequence = menuRequestSequence.current;
      gearActionFrame.current = requestAnimationFrame(() => {
        gearActionFrame.current = null;
        if (headerMountedRef.current && sequence === menuRequestSequence.current) {
          gearClosingRef.current = false; viewClosingRef.current = false;
        }
      });
    }
  }

  function headerMayNavigate() {
    return headerMountedRef.current && AppState.currentState === 'active' && !navigationBusyRef.current &&
      !historyOperation.current && !spreadsheetEditor.snapshot().busy && !dispatchingGearAction.current && !preparingViews.current;
  }

  useEffect(() => {
    headerMountedRef.current = true;
    return () => { headerMountedRef.current = false; invalidateMenus(false); };
  }, []);

  useEffect(() => { invalidateMenus(); }, [width, viewMode]);
  // Dismissing an open keyboard can change only the window height. Cancel a
  // pending tap, but keep the dropdown the user just requested visible.
  useEffect(() => { binderPress.cancel(); }, [height]);
  useEffect(() => {
    if (navigationBusy) binderPress.cancel();
    if (!navigationBusy) dispatchingGearAction.current = false;
  }, [navigationBusy]);

  useEffect(() => {
    const update = () => setHistory(spreadsheetEditor.snapshot());
    const unsubscribe = spreadsheetEditor.subscribe(update);
    update();
    return unsubscribe;
  }, []);

  async function changeHistory(action: 'undo' | 'redo') {
    const snapshot = spreadsheetEditor.snapshot();
    if (viewChanging || historyOperation.current || snapshot.busy || !(action === 'undo' ? snapshot.canUndo : snapshot.canRedo)) return;
    binderPress.cancel();
    historyOperation.current = true;
    setHistoryPending(true);
    Keyboard.dismiss();
    try {
      await flushInlineMinutes();
      await (action === 'undo' ? undoSpreadsheetEdit() : redoSpreadsheetEdit());
    } catch (error) {
      if (headerMountedRef.current && AppState.currentState === 'active') {
        Alert.alert(action === 'undo' ? 'Could not undo edit' : 'Could not redo edit',
          error instanceof Error ? error.message : 'The edit could not be restored. Try again.');
      }
    } finally {
      historyOperation.current = false;
      if (headerMountedRef.current) setHistoryPending(false);
    }
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      if (!headerMountedRef.current) return;
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
      else {
        invalidateMenus();
        if (timer) { clearTimeout(timer); timer = null; }
      }
    });
    return () => { if (timer) clearTimeout(timer); subscription.remove(); };
  }, []);

  const openViews = async () => {
    if (!headerMayNavigate() || gearClosingRef.current || viewClosingRef.current || pendingGearAction.current) return;
    invalidateMenus();
    const sequence = menuRequestSequence.current;
    Keyboard.dismiss(); preparingViews.current = true;
    try {
      await flushInlineMinutes();
      if (inlineMinuteDrafts.snapshot().some((draft) => draft.error || draft.revision !== draft.savedRevision)) {
        throw new Error('Your current minute could not be saved. Try again.');
      }
    } catch (error) {
      if (headerMountedRef.current && sequence === menuRequestSequence.current && AppState.currentState === 'active')
        Alert.alert('Could not open calendar views', error instanceof Error ? error.message : 'Save your minute and try again.');
      return;
    } finally { preparingViews.current = false; }
    if (sequence !== menuRequestSequence.current || !headerMayNavigate()) return;
    viewMenuAnchor.current?.measureInWindow((x, y, anchorWidth, anchorHeight) => {
      if (sequence !== menuRequestSequence.current || !headerMayNavigate() || gearClosingRef.current || viewClosingRef.current || pendingGearAction.current) return;
      setViewMenuTop(Math.max(8, Math.min(y + anchorHeight + 4, height - 304)));
      setViewMenuRight(Math.max(8, Math.min(width - x - anchorWidth, width - 216)));
      viewVisibleRef.current = true;
      setViewMenuOpen(true);
    });
  };

  const openGear = () => {
    if (!headerMayNavigate() || gearClosingRef.current || viewClosingRef.current || pendingGearAction.current) return;
    invalidateMenus();
    const sequence = menuRequestSequence.current;
    Keyboard.dismiss();
    gearMenuAnchor.current?.measureInWindow((x, y, _anchorWidth, anchorHeight) => {
      if (sequence !== menuRequestSequence.current || !headerMayNavigate() || gearClosingRef.current || viewClosingRef.current || pendingGearAction.current) return;
      setGearMenuTop(Math.max(8, Math.min(y + anchorHeight + 4, height - 248)));
      setGearMenuLeft(Math.max(8, Math.min(x, width - 216)));
      gearVisibleRef.current = true;
      setGearMenuOpen(true);
    });
  };
  const finishGearAction = (expectedSequence?: number) => {
    const pending = pendingGearAction.current;
    if (!pending || (expectedSequence != null && pending.sequence !== expectedSequence)) return;
    pendingGearAction.current = null;
    if (gearActionFrame.current != null) { cancelAnimationFrame(gearActionFrame.current); gearActionFrame.current = null; }
    if (pending.sequence !== menuRequestSequence.current || !headerMayNavigate()) return;
    menuRequestSequence.current += 1;
    dispatchingGearAction.current = true;
    if (pending.action === 'settings') onOpenSettings();
    else if (pending.action === 'print') onPrint();
    else if (pending.action === 'search') onOpenSearch();
    else if (pending.action === 'dates') onOpenDatePicker();
    else onOpenReports();
    // Also release the local lock when a transition finishes within the same React batch.
    gearActionFrame.current = requestAnimationFrame(() => {
      gearActionFrame.current = null;
      if (headerMountedRef.current && !navigationBusyRef.current) dispatchingGearAction.current = false;
    });
  };
  const chooseGearAction = (action: 'settings' | 'print' | 'search' | 'reports') => {
    if (!headerMayNavigate() || !gearVisibleRef.current || gearClosingRef.current || pendingGearAction.current) return;
    const sequence = ++menuRequestSequence.current;
    pendingGearAction.current = { action, sequence };
    gearVisibleRef.current = false;
    gearClosingRef.current = true;
    setGearMenuOpen(false);
    // iOS presents its print controller after the dropdown has fully dismissed.
    if (Platform.OS !== 'ios') gearActionFrame.current = requestAnimationFrame(() => {
      gearActionFrame.current = null;
      gearClosingRef.current = false;
      finishGearAction(sequence);
    });
  };
  const chooseDateSelection = () => {
    if (!headerMayNavigate() || !viewVisibleRef.current || viewClosingRef.current || pendingGearAction.current) return;
    const sequence = ++menuRequestSequence.current;
    pendingGearAction.current = { action: 'dates', sequence };
    viewVisibleRef.current = false; viewClosingRef.current = true; setViewMenuOpen(false);
    if (Platform.OS !== 'ios') gearActionFrame.current = requestAnimationFrame(() => {
      gearActionFrame.current = null; viewClosingRef.current = false; finishGearAction(sequence);
    });
  };
  binderActions.current = { single: openViews, double: onJumpToNow, long: () => {} };
  const viewLabel = CALENDAR_VIEW_OPTIONS.find((option) => option.mode === viewMode)?.label ?? 'Day';

  return <><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.calendarHeaderScroll}
    keyboardShouldPersistTaps="always" keyboardDismissMode="none" onScrollBeginDrag={() => binderPress.cancelPress()}
    contentContainerStyle={styles.calendarHeaderContent} scrollEnabled={availableWidth < controlWidth * 7 - 0.5}
    onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}>
    <View style={[styles.calendarHeader, { minWidth: controlWidth * 7 }]}>
    <View ref={gearMenuAnchor} collapsable={false}>
    <Pressable accessibilityRole="button" accessibilityLabel="Open menu"
      disabled={navigationBusy} accessibilityState={{ disabled: navigationBusy, expanded: gearMenuOpen }}
      onPressIn={() => binderPress.cancel()} onPress={openGear} style={controlStyle}>
      <CalendarHeaderIcon name="menu" />
    </Pressable>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Previous calendar view"
      accessibilityState={{ disabled: !canGoPrevious || navigationBusy }} disabled={!canGoPrevious || navigationBusy}
      onPressIn={() => binderPress.cancel()} onPress={() => { binderPress.cancel(); onPrevious(); }}
      style={[controlStyle, (!canGoPrevious || navigationBusy) && styles.disabledCalendarNavigation]}>
      <Text allowFontScaling={false} style={styles.calendarNavigationArrow}>‹</Text>
    </Pressable>
    <View ref={viewMenuAnchor} collapsable={false}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${viewLabel} view. Choose a view`}
        accessibilityHint="Tap to change view. Double tap to go to the current minute."
        accessibilityState={{ expanded: viewMenuOpen, disabled: navigationBusy, busy: viewChanging }} disabled={navigationBusy}
        accessibilityActions={[{ name: 'showViews', label: 'Choose calendar view' }, { name: 'goToNow', label: 'Go to the current minute' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'showViews') { binderPress.cancel(); openViews(); }
          else if (event.nativeEvent.actionName === 'goToNow' && headerMayNavigate()) { binderPress.cancel(); onJumpToNow(); }
        }}
        onPressIn={(event) => { if (event.nativeEvent.touches?.length > 1) binderPress.cancelPress(); else binderPress.pressIn(); }}
        onTouchStart={(event) => { if (event.nativeEvent.touches?.length > 1) binderPress.cancelPress(); }}
        onLongPress={() => binderPress.longPress()} delayLongPress={450}
        onTouchEnd={() => binderPress.touchEnd()} onTouchCancel={() => binderPress.cancelPress()}
        onPress={() => binderPress.press()} style={controlStyle}>
        <CalendarViewIcon mode={viewMode} currentDate={current} />
      </Pressable>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Next calendar view"
      accessibilityState={{ disabled: !canGoNext || navigationBusy }} disabled={!canGoNext || navigationBusy}
      onPressIn={() => binderPress.cancel()} onPress={() => { binderPress.cancel(); onNext(); }}
      style={[controlStyle, (!canGoNext || navigationBusy) && styles.disabledCalendarNavigation]}>
      <Text allowFontScaling={false} style={styles.calendarNavigationArrow}>›</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Undo Context edit"
      accessibilityState={{ disabled: !history.canUndo || navigationBusy }}
      disabled={!history.canUndo || navigationBusy} onPressIn={() => binderPress.cancel()} onPress={() => void changeHistory('undo')}
      style={[controlStyle, (!history.canUndo || navigationBusy) && styles.disabledCalendarNavigation]}>
      <Text allowFontScaling={false} style={styles.historyArrow}>↶</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Redo Context edit"
      accessibilityState={{ disabled: !history.canRedo || navigationBusy }}
      disabled={!history.canRedo || navigationBusy} onPressIn={() => binderPress.cancel()} onPress={() => void changeHistory('redo')}
      style={[controlStyle, (!history.canRedo || navigationBusy) && styles.disabledCalendarNavigation]}>
      <Text allowFontScaling={false} style={styles.historyArrow}>↷</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={syncing ? 'Synchronizing calendars' : syncError ? 'Calendar sync needs attention. Tap to retry' : 'Sync attached calendars'}
      accessibilityHint={hasSyncDetails ? 'Touch and hold for sync details' : undefined}
      disabled={navigationBusy} accessibilityState={{ disabled: navigationBusy, busy: syncing }}
      onPressIn={() => { syncLongPress.current = false; binderPress.cancel(); }}
      onLongPress={() => { syncLongPress.current = true; showSyncDetails(); }}
      accessibilityActions={hasSyncDetails ? [{ name: 'longpress', label: 'Show sync details' }] : []}
      onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'longpress') showSyncDetails(); }}
      onPress={() => { binderPress.cancel(); if (syncLongPress.current) { syncLongPress.current = false; return; } if (!syncing) onSync(); }} style={controlStyle}>
      <View style={styles.syncIconWrap}>
        {syncing ? <ActivityIndicator size="small" color={colors.graphite} /> : <CalendarHeaderIcon name="sync" />}
        {syncError ? <Text accessible={false} importantForAccessibility="no" allowFontScaling={false}
          style={styles.syncAttention}>!</Text> : null}
      </View>
    </Pressable>
    </View>
  </ScrollView>
    <Modal visible={gearMenuOpen} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent
      onRequestClose={() => invalidateMenus()} onDismiss={() => {
        if (Platform.OS === 'ios') { gearClosingRef.current = false; finishGearAction(); }
        else if (!gearVisibleRef.current && !pendingGearAction.current) gearClosingRef.current = false;
      }}>
      <View style={styles.viewMenuBackdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close calendar actions"
          onPress={() => invalidateMenus()} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.viewMenu, { top: gearMenuTop, left: gearMenuLeft,
          maxHeight: Math.max(44, height - gearMenuTop - 8) }]}>
          <ScrollView keyboardShouldPersistTaps="always" keyboardDismissMode="none">
            <Pressable accessibilityRole="button" accessibilityLabel="Open Dashboard"
              onPress={() => chooseGearAction('reports')} style={styles.viewOption}>
              <CalendarHeaderIcon name="reports" />
              <Text maxFontSizeMultiplier={1.5} style={styles.viewOptionText}>Dashboard</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Print displayed dates"
              onPress={() => chooseGearAction('print')} style={styles.viewOption}>
              <CalendarHeaderIcon name="print" />
              <Text maxFontSizeMultiplier={1.5} style={styles.viewOptionText}>Print</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Open Search"
              onPress={() => chooseGearAction('search')} style={styles.viewOption}>
              <CalendarHeaderIcon name="search" />
              <Text maxFontSizeMultiplier={1.5} style={styles.viewOptionText}>Search</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Open Settings"
              onPress={() => chooseGearAction('settings')} style={styles.viewOption}>
              <CalendarHeaderIcon name="settings" />
              <Text maxFontSizeMultiplier={1.5} style={styles.viewOptionText}>Settings</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
    <Modal visible={viewMenuOpen} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent
      onRequestClose={() => invalidateMenus()} onDismiss={() => { viewClosingRef.current = false; if (Platform.OS === 'ios') finishGearAction(); }}>
      <View style={styles.viewMenuBackdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close calendar views"
          onPress={() => invalidateMenus()} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.viewMenu, { top: viewMenuTop, right: viewMenuRight,
          maxHeight: Math.max(44, height - viewMenuTop - 8) }]}>
          <ScrollView keyboardShouldPersistTaps="always" keyboardDismissMode="none">
            {CALENDAR_VIEW_OPTIONS.map((option) => {
              const selected = viewMode === option.mode || (viewMode === 'three-days' && option.mode === 'day');
              return <Pressable key={option.mode} accessibilityRole="button" accessibilityLabel={`${option.label} view`}
                accessibilityState={{ selected }} onPress={() => {
                  if (!headerMayNavigate()) return;
                  invalidateMenus();
                  void onViewModeChange(option.mode);
                }} style={[styles.viewOption, selected && styles.viewOptionSelected]}>
                <CalendarViewIcon mode={option.mode} currentDate={option.mode === 'day' ? current : undefined} />
                <Text maxFontSizeMultiplier={1.5} style={[styles.viewOptionText, selected && styles.viewOptionTextSelected]}>
                  {option.label}
                </Text>
              </Pressable>;
            })}
            <Pressable accessibilityRole="button" accessibilityLabel="Pick or range dates" onPress={chooseDateSelection} style={styles.viewOption}>
              <CalendarViewIcon mode="month" />
              <Text maxFontSizeMultiplier={1.5} style={styles.viewOptionText}>Pick / Range</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const SCREEN_TITLES: Record<Tab, string> = {
  today: 'Day', reports: 'Dashboard', search: 'Search', settings: 'Settings',
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
              <Pressable accessibilityRole="button" accessibilityLabel="Back to calendar"
                onPress={onReturnToCalendar} style={styles.menuButton}>
                <CalendarHeaderIcon name="back" />
              </Pressable>
              <Text accessibilityRole="header" style={styles.screenTitle}>{SCREEN_TITLES[tab]}</Text>
            </View>
          ) : null}
          {children}
        </View>
      </SafeAreaView>

    </>
  );
}

function PrintPreparationNotice({ action, onCancel }: { action: PrintAction; onCancel: () => void }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.printPreparation}>
    <ActivityIndicator size="small" color={colors.muted} />
    <Text accessibilityLiveRegion="polite" style={styles.printPreparationText}>{action === 'save' ? 'Preparing PDF' : 'Preparing print'}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={action === 'save' ? 'Cancel PDF preparation' : 'Cancel print preparation'}
      onPress={onCancel} style={styles.backButton}>
      <Text style={styles.backText}>Cancel</Text>
    </Pressable>
  </View>;
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
  printPreparation: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline, backgroundColor: colors.paper },
  printPreparationText: { flex: 1, color: colors.graphite, fontSize: 13 },
  calendarHeaderScroll: { height: 44, flexGrow: 0, flexShrink: 0, backgroundColor: colors.paper },
  calendarHeaderContent: { flexGrow: 1 },
  calendarHeader: { minHeight: 44, flexGrow: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', backgroundColor: colors.paper },
  calendarNavigationArrow: { color: colors.graphite, fontSize: 29, lineHeight: 34 },
  historyArrow: { color: colors.graphite, fontSize: 27, lineHeight: 34 },
  syncIconWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  syncAttention: { position: 'absolute', top: -4, right: -5, minWidth: 11, height: 15, borderRadius: 4,
    backgroundColor: colors.paper, color: colors.graphite, fontSize: 13, lineHeight: 15, fontWeight: '800', textAlign: 'center' },
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
