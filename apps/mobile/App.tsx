import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import {
  enqueueBoundDatesForSync,
  getSetting,
  initializeDatabase,
  setSetting,
} from './src/data/database';
import {
  configureCalendarProjection,
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
import { WeekScreen } from './src/screens/WeekScreen';
import { colors } from './src/theme';
import type { CalendarPreferences, DeviceCalendar, SearchResult } from './src/types';
import { dateKey } from './src/utils/time';
import { getAccounts } from './src/sync/accounts';
import { subscribeAccountSync, synchronizeAccounts } from './src/sync/engine';
import { listCategories } from './src/services/categories';
import { ReleaseUpdateNotice, useReleaseUpdates } from './src/components/ReleaseUpdates';

type Tab = 'today' | 'week' | 'reports' | 'search' | 'settings' | 'accounts' | 'categories';

const DEFAULT_PREFERENCES: CalendarPreferences = {
  selectedCalendarIds: [],
  writeCalendarId: null,
  syncActuals: false,
};

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'reports', label: 'Reports' },
  { id: 'search', label: 'Search' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const releaseUpdates = useReleaseUpdates(ready);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('today');
  const [activeDate, setActiveDate] = useState(dateKey(new Date()));
  const [dataVersion, setDataVersion] = useState(0);
  const [permissionStatus, setPermissionStatus] = useState('undetermined');
  const [calendars, setCalendars] = useState<DeviceCalendar[]>([]);
  const [preferences, setPreferences] = useState<CalendarPreferences>(DEFAULT_PREFERENCES);
  const [accountCalendarWrites, setAccountCalendarWrites] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{
    dateKey: string;
    minuteIndex: number;
    token: number;
  } | null>(null);

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

  useEffect(() => {
    let mounted = true;
    async function prepare() {
      setReady(false);
      setInitializationError(null);
      try {
        await initializeDatabase();
        await listCategories();
        const savedPreferences = await getSetting<CalendarPreferences>(
          'calendar.preferences',
          DEFAULT_PREFERENCES,
        );
        const directWrites = (await getAccounts()).some((account) => account.consent.calendarWrite);
        setAccountCalendarWrites(directWrites);
        if (!mounted) return;
        configureCalendarProjection(
          savedPreferences.syncActuals && !directWrites ? savedPreferences.writeCalendarId : null,
        );
        setPreferences(savedPreferences);
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
      if (state !== 'active') return;
      void refreshCalendars();
      void synchronizeAccounts();
      if (preferences.syncActuals && preferences.writeCalendarId && !accountCalendarWrites) {
        void flushPendingActuals(preferences.writeCalendarId);
      }
      setDataVersion((version) => version + 1);
    });
    return () => subscription.remove();
  }, [accountCalendarWrites, preferences.syncActuals, preferences.writeCalendarId, refreshCalendars]);

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

  const dataChanged = useCallback(() => {
    setDataVersion((version) => version + 1);
    void getAccounts().then((accounts) => {
      const directWrites = accounts.some((account) => account.consent.calendarWrite);
      setAccountCalendarWrites(directWrites);
      configureCalendarProjection(
        preferences.syncActuals && !directWrites ? preferences.writeCalendarId : null,
      );
    });
    void synchronizeAccounts();
  }, [preferences.syncActuals, preferences.writeCalendarId]);

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
    setActiveDate(result.dateKey);
    setFocusRequest({
      dateKey: result.dateKey,
      minuteIndex: result.minuteIndex,
      token: Date.now(),
    });
    setTab('today');
  }

  if (!ready) {
    return (
      <SafeAreaView style={styles.loading}>
        <StatusBar style="light" />
        <Image source={require('./assets/context-app-logo.png')} style={styles.loadingLogo} />
        {initializationError ? (
          <View style={styles.errorPanel}>
            <Text style={styles.errorTitle}>Context couldn’t open your ledger</Text>
            <Text style={styles.errorText}>
              Your data was not changed. Try opening the local ledger again.
            </Text>
            <Text numberOfLines={2} style={styles.errorDetail}>
              {initializationError}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setInitializationAttempt((attempt) => attempt + 1)}
              style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <ActivityIndicator color="#E8E4DA" />
            <Text style={styles.loadingText}>Preparing your private minute ledger…</Text>
          </>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.brandBar}>
        <Image source={require('./assets/context-app-logo.png')} style={styles.logo} />
        <View>
          <Text style={styles.brand}>Context</Text>
          <Text style={styles.brandLine}>Capture first. Organize second.</Text>
        </View>
      </View>

      <ReleaseUpdateNotice updates={releaseUpdates} />

      <View style={styles.screen}>
        {tab === 'today' ? (
          <TodayScreen
            activeDate={activeDate}
            onDateChange={setActiveDate}
            calendars={calendars}
            preferences={accountCalendarWrites ? { ...preferences, syncActuals: false } : preferences}
            dataVersion={dataVersion}
            focusRequest={focusRequest}
            onFocusConsumed={() => setFocusRequest(null)}
            onDataChanged={dataChanged}
            onOpenSettings={() => setTab('settings')}
          />
        ) : null}
        {tab === 'week' ? <WeekScreen dataVersion={dataVersion} /> : null}
        {tab === 'reports' ? <ReportsScreen dataVersion={dataVersion} initialDate={activeDate} /> : null}
        {tab === 'search' ? (
          <SearchScreen dataVersion={dataVersion} onOpenResult={openSearchResult} />
        ) : null}
        {tab === 'settings' ? (
          <SettingsScreen
            permissionStatus={permissionStatus}
            calendars={calendars}
            preferences={preferences}
            onRequestAccess={askForCalendarAccess}
            onRefreshCalendars={refreshCalendars}
            onChange={changePreferences}
            onOpenAccounts={() => setTab('accounts')}
            onOpenCategories={() => setTab('categories')}
            updates={releaseUpdates}
          />
        ) : null}
        {tab === 'accounts' ? <AccountsScreen onDataChanged={dataChanged} /> : null}
        {tab === 'categories' ? <CategoriesScreen onDataChanged={dataChanged} calendars={calendars} /> : null}
      </View>

      <View style={styles.tabBar}>
        {TABS.map((item) => {
          const selected = item.id === tab || (item.id === 'settings' && (tab === 'accounts' || tab === 'categories'));
          return (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setTab(item.id)}
              style={styles.tab}
            >
              <View style={[styles.tabIndicator, selected && styles.tabIndicatorSelected]} />
              <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111315',
  },
  loadingLogo: { width: 112, height: 112, marginBottom: 22, borderRadius: 24 },
  loadingText: { marginTop: 14, color: '#C9C5BC', fontSize: 13 },
  errorPanel: { width: '82%', maxWidth: 360, alignItems: 'center' },
  errorTitle: { color: '#F3F0E8', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  errorText: {
    marginTop: 8,
    color: '#C9C5BC',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  errorDetail: {
    marginTop: 10,
    color: '#8F8C85',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  retryButton: {
    minWidth: 132,
    minHeight: 44,
    marginTop: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#E8E4DA',
  },
  retryButtonPressed: { opacity: 0.78 },
  retryButtonText: { color: '#171817', fontSize: 14, fontWeight: '700' },
  brandBar: {
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.paper,
  },
  logo: { width: 36, height: 36, marginRight: 10, borderRadius: 10 },
  brand: { color: colors.ink, fontSize: 18, fontWeight: '800', letterSpacing: 0.1 },
  brandLine: { marginTop: 1, color: colors.muted, fontSize: 10.5 },
  screen: { flex: 1 },
  tabBar: {
    height: 62,
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.paper,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabIndicator: { width: 18, height: 2, marginBottom: 7, borderRadius: 1, backgroundColor: 'transparent' },
  tabIndicatorSelected: { backgroundColor: colors.ink },
  tabLabel: { color: colors.muted, fontSize: 11.5, fontWeight: '600' },
  tabLabelSelected: { color: colors.ink },
});
