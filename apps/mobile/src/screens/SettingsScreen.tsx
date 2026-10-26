import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors, AppearanceMode } from '../theme';
import type { CalendarPreferences, DeviceCalendar } from '../types';
import { ReleaseUpdateSettings, type ReleaseUpdatesState } from '../components/ReleaseUpdates';
import { checkCalendarConnection, getCalendarReadDiagnostics, type CalendarReadDiagnostics } from '../services/calendar';
import { dateKey, formatDayHeading } from '../utils/time';
import { WatchSettings } from '../wear/WatchSettings';
import { InfoButton } from '../components/InfoButton';

type Props = {
  permissionStatus: string;
  calendars: DeviceCalendar[];
  preferences: CalendarPreferences;
  onRequestAccess: () => Promise<void>;
  onRefreshCalendars: () => Promise<void>;
  onChange: (next: CalendarPreferences) => void;
  onOpenAccounts: () => void;
  onOpenCategories: () => void;
  clockFormat: '12h' | '24h';
  onClockFormatChange: (value: '12h' | '24h') => void;
  updates: ReleaseUpdatesState;
  activeDate?: string;
};

export function SettingsScreen({
  permissionStatus,
  calendars,
  preferences,
  onRequestAccess,
  onRefreshCalendars,
  onChange,
  onOpenAccounts,
  onOpenCategories,
  clockFormat,
  onClockFormatChange,
  updates,
  activeDate = dateKey(new Date()),
}: Props) {
  const { colors, mode, setMode, persistenceError } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const hasAccess = permissionStatus === 'granted';
  const [checking, setChecking] = useState(false);
  const [calendarCheck, setCalendarCheck] = useState<CalendarReadDiagnostics | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const checkToken = useRef(0);
  const selectedCalendarKey = preferences.selectedCalendarIds.join('|');
  useEffect(() => {
    checkToken.current += 1; setCalendarCheck(null); setCheckError(null); setChecking(false);
    return () => { checkToken.current += 1; };
  }, [selectedCalendarKey, activeDate]);

  async function checkConnection() {
    const token = ++checkToken.current;
    setChecking(true); setCheckError(null);
    try {
      await checkCalendarConnection(preferences.selectedCalendarIds, activeDate, calendars);
      if (token !== checkToken.current) return;
      const result = getCalendarReadDiagnostics();
      if (!result || result.dateKey !== activeDate) throw new Error('The phone calendar check could not finish.');
      setCalendarCheck(result);
    } catch (error) {
      if (token === checkToken.current) setCheckError(error instanceof Error ? error.message : 'The phone calendar check could not finish.');
    } finally { if (token === checkToken.current) setChecking(false); }
  }

  function toggleImported(id: string) {
    const selected = new Set(preferences.selectedCalendarIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    onChange({ ...preferences, selectedCalendarIds: [...selected] });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headingRow}>
        <Text style={styles.title}>Appearance</Text>
        <InfoButton title="Appearance" message="Match your phone’s appearance with System, or choose a light or dark screen." />
      </View>
      <View accessibilityRole="radiogroup" style={styles.appearanceOptions}>
        {(['system', 'light', 'dark'] as AppearanceMode[]).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ checked: mode === option }}
            onPress={() => setMode(option)}
            style={[styles.appearanceOption, mode === option && styles.appearanceOptionSelected]}
          >
            <Text style={[styles.appearanceText, mode === option && styles.appearanceTextSelected]}>
              {option === 'system' ? 'System' : option === 'light' ? 'Light' : 'Dark'}
            </Text>
          </Pressable>
        ))}
      </View>
      {persistenceError ? <Text style={styles.appearanceError}>{persistenceError}</Text> : null}

      <View style={styles.sectionHeadingRow}>
        <Text style={styles.sectionTitle}>Time format</Text>
        <InfoButton title="Time format" message="Choose 12-hour time with AM/PM, such as 1:11 PM, or 24-hour time, such as 13:11. Your choice is saved for the minute grid and minute details." />
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel="Time format" style={styles.appearanceOptions}>
        {(['12h', '24h'] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ checked: clockFormat === option }}
            onPress={() => onClockFormatChange(option)}
            style={[styles.appearanceOption, clockFormat === option && styles.appearanceOptionSelected]}
          >
            <Text style={[styles.appearanceText, clockFormat === option && styles.appearanceTextSelected]}>
              {option === '12h' ? '12-hour (AM/PM)' : '24-hour'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.sectionHeadingRow}>
        <Text style={styles.calendarHeading}>Calendar connection</Text>
        <InfoButton title="Calendar connection" message={"Context reads plans from calendars connected to this phone. Add or enable Google, iCloud, Outlook or Exchange in your phone’s Calendar settings first. Teams and Zoom meetings normally appear through their Google or Outlook event. Your complete minute ledger stays in Context.\n\nDevice-calendar access copies actuals into separate events. Account connections can also replace a selected original occurrence and import edits when you allow those permissions. Account calendar writes take over from device writeback to avoid duplicate events."} />
      </View>

      <View style={styles.accountButton}>
        <Pressable accessibilityRole="button" onPress={onOpenAccounts} style={styles.navigationAction}>
          <Text style={styles.accountTitle}>Accounts & synchronization</Text>
        </Pressable>
        <InfoButton onDark title="Accounts & synchronization" message="Connect Google, Microsoft or other storage to synchronize your encrypted ledger between phones. Account calendar connections also support importing event edits and replacing original plans with your permission." />
      </View>

      <View style={styles.categoriesButton}>
        <Pressable accessibilityRole="button" onPress={onOpenCategories} style={styles.navigationAction}>
          <Text style={styles.categoriesTitle}>Activity colors</Text>
        </Pressable>
        <InfoButton title="Activity colors" message="Create activity categories or import labels and colors from your calendars." />
      </View>

      <View style={styles.permissionCard}>
        <View style={[styles.statusDot, hasAccess && styles.statusDotGranted]} />
        <View style={styles.permissionCopy}>
          <Text style={styles.permissionTitle}>
            {hasAccess ? 'Calendar access allowed' : 'Calendar access'}
          </Text>
        </View>
        <InfoButton onDark title="Calendar access" message="Calendar access lets Context read your selected plans and write the confirmed activity blocks you choose to synchronize. Your phone requests permission only when you tap Allow. Refresh reloads the calendars available on this phone." />
        <Pressable onPress={hasAccess ? onRefreshCalendars : onRequestAccess} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>{hasAccess ? 'Refresh' : 'Allow'}</Text>
        </Pressable>
      </View>

      {hasAccess ? (
        <>
          <View style={styles.sectionHeadingRow}>
            <Text style={styles.sectionTitle}>Calendars used for plans</Text>
            <InfoButton title="Calendars used for plans" message={"Check the calendars you want to appear in Today. When creating an event in Google Calendar, save it in one of these checked calendars. Events refresh when you return to Context.\n\nTap Use to choose the calendar for actual activity blocks. The selected calendar is marked Actuals. A read-only calendar can supply plans but cannot receive activity blocks."} />
          </View>
          <View style={styles.calendarCard}>
            {calendars.map((calendar, index) => {
              const selected = preferences.selectedCalendarIds.includes(calendar.id);
              const writesHere = preferences.writeCalendarId === calendar.id;
              return (
                <View
                  key={calendar.id}
                  style={[styles.calendarRow, index === calendars.length - 1 && styles.lastRow]}
                >
                  <Pressable onPress={() => toggleImported(calendar.id)} style={styles.calendarSelect}>
                    <View
                      style={[
                        styles.checkbox,
                        selected && { borderColor: calendar.color, backgroundColor: calendar.color },
                      ]}
                    >
                      {selected ? <Text style={styles.checkmark}>✓</Text> : null}
                    </View>
                    <View style={styles.calendarText}>
                      <Text style={styles.calendarTitle}>{calendar.title}</Text>
                      <Text style={styles.calendarSource}>
                        {calendar.sourceName}{calendar.allowsModifications ? '' : ' · read only'}
                      </Text>
                      {calendar.isVisible === false ? <Text style={styles.appearanceError}>Hidden in the phone calendar</Text> : null}
                      {calendar.isSynced === false ? <Text style={styles.appearanceError}>Phone calendar synchronization is off</Text> : null}
                    </View>
                  </Pressable>
                  {calendar.allowsModifications ? (
                    <Pressable
                      onPress={() =>
                        onChange({ ...preferences, writeCalendarId: writesHere ? null : calendar.id })
                      }
                      style={[styles.writeChoice, writesHere && styles.writeChoiceSelected]}
                    >
                      <Text style={[styles.writeChoiceText, writesHere && styles.writeChoiceTextSelected]}>
                        {writesHere ? 'Actuals' : 'Use'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
            {calendars.length === 0 ? (
              <View style={styles.headingRow}>
                <Text style={styles.noCalendars}>No calendars found</Text>
                <InfoButton title="No calendars found" message="Add or enable a calendar account in your phone’s Calendar settings, then return to Context and tap Refresh." />
              </View>
            ) : null}
          </View>

          <View style={styles.notice}>
            <View style={styles.headingRow}>
              <Text style={styles.noticeTitle}>Check calendar connection</Text>
              <InfoButton title="Check calendar connection" message="Check which events your selected phone calendars provide for the displayed date. Results show event counts and reading errors without displaying event titles or descriptions. If an event is missing, check its calendar’s visibility and synchronization in your calendar app, then refresh Context’s calendar list." />
            </View>
            <Text style={styles.noticeBody}>{formatDayHeading(activeDate)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Check selected phone calendars"
              disabled={checking || preferences.selectedCalendarIds.length === 0}
              onPress={() => void checkConnection()} style={styles.checkConnectionButton}>
              <Text style={styles.checkConnectionButtonText}>{checking ? 'Checking…' : 'Check connection'}</Text>
            </Pressable>
            {calendarCheck?.calendars.map((status) => <View key={status.calendarId} style={styles.calendarCheckRow}>
              <Text style={styles.noticeTitle}>{calendars.find((calendar) => calendar.id === status.calendarId)?.title ?? 'Selected calendar'}</Text>
              <Text style={styles.noticeBody}>{status.status === 'failed'
                ? 'Could not read this calendar · ' + status.errorCode
                : `${status.acceptedEvents} events for this date · ${status.timedEvents} timed · ${status.allDayEvents} all-day`}</Text>
              {status.status === 'invalid-events' ? <Text style={styles.appearanceError}>Some returned events could not be displayed · {status.errorCode}</Text> : null}
              {status.queriedEvents > 0 && status.acceptedEvents === 0 && status.status === 'ok'
              ? <View style={styles.headingRow}>
                  <Text style={styles.noticeTitle}>No events on this date</Text>
                  <InfoButton title="No events on this date" message="The phone returned events that fall outside the selected date." />
                </View> : null}
            </View>)}
            {checkError ? <Text accessibilityRole="alert" style={styles.appearanceError}>{checkError}</Text> : null}
          </View>

          <View style={styles.syncRow}>
            <View style={styles.syncCopy}>
              <Text style={styles.syncTitle}>Write actual activity blocks</Text>
            </View>
            <InfoButton title="Write actual activity blocks" message="Creates or updates only Context-owned events in the calendar marked Actuals. Choose that calendar with Use before turning this on. Original plans are edited only through an account connection with the corresponding permission." />
            <Switch
              accessibilityLabel="Write actual activity blocks"
              value={preferences.syncActuals}
              disabled={!preferences.writeCalendarId}
              onValueChange={(value) => onChange({ ...preferences, syncActuals: value })}
              trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
              thumbColor={colors.switchThumb}
            />
          </View>
        </>
      ) : null}

      <View style={styles.privacyCard}>
        <Text style={styles.privacyTitle}>Privacy</Text>
        <InfoButton title="Privacy" message="Account synchronization encrypts your private ledger before storing it in your selected app folder. Calendar descriptions are readable in your calendar and follow its sharing settings. Connect the same storage account and passphrase on both phones." />
      </View>
      <WatchSettings />
      <ReleaseUpdateSettings updates={updates} />
    </ScrollView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, paddingBottom: 40 },
  title: { flex: 1, marginTop: 5, color: colors.ink, fontSize: 28, fontWeight: '700' },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 24, gap: 4 },
  navigationAction: { flex: 1, minHeight: 56, padding: 16, justifyContent: 'center' },
  appearanceOptions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  appearanceOption: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, backgroundColor: colors.surface },
  appearanceOptionSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  appearanceText: { color: colors.graphite, fontSize: 14, fontWeight: '600' },
  appearanceTextSelected: { color: colors.onAccent },
  appearanceError: { marginTop: 8, color: colors.danger, fontSize: 12, lineHeight: 18 },
  calendarHeading: { flex: 1, color: colors.ink, fontSize: 21, fontWeight: '600' },
  accountButton: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingRight: 4,
    backgroundColor: colors.accent, borderRadius: 14 },
  accountTitle: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
  categoriesButton: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingRight: 4,
    backgroundColor: colors.panel, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  categoriesTitle: { color: colors.graphite, fontSize: 14, fontWeight: '700' },
  permissionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    padding: 15,
    borderRadius: 15,
    backgroundColor: colors.accent,
  },
  statusDot: { width: 10, height: 10, marginRight: 12, borderRadius: 5, backgroundColor: '#9A7653' },
  statusDotGranted: { backgroundColor: '#92A697' },
  permissionCopy: { flex: 1 },
  permissionTitle: { color: colors.onAccent, fontSize: 14, fontWeight: '700' },
  smallButton: { marginLeft: 4, minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.onAccentMuted, borderRadius: 9 },
  smallButtonText: { color: colors.onAccent, fontSize: 12, fontWeight: '700' },
  sectionTitle: { flex: 1, color: colors.ink, fontSize: 16, fontWeight: '700' },
  checkConnectionButton: { minHeight: 44, marginTop: 12, paddingHorizontal: 14, alignSelf: 'flex-start',
    justifyContent: 'center', borderRadius: 8, backgroundColor: colors.accent },
  checkConnectionButtonText: { color: colors.onAccent, fontSize: 13, fontWeight: '600' },
  calendarCheckRow: { marginTop: 14 },
  calendarCard: {
    marginTop: 6,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: 15,
    backgroundColor: colors.surface,
  },
  calendarRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  lastRow: { borderBottomWidth: 0 },
  calendarSelect: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  checkbox: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.silver, borderRadius: 6 },
  checkmark: { color: colors.white, fontSize: 13, fontWeight: '800' },
  calendarText: { flex: 1, marginLeft: 11 },
  calendarTitle: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  calendarSource: { marginTop: 2, color: colors.muted, fontSize: 11 },
  writeChoice: { marginLeft: 8, paddingHorizontal: 11, paddingVertical: 7, borderWidth: 1, borderColor: colors.hairline, borderRadius: 12 },
  writeChoiceSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  writeChoiceText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  writeChoiceTextSelected: { color: colors.onAccent },
  noCalendars: { flex: 1, paddingVertical: 18, color: colors.muted, fontSize: 13, lineHeight: 19 },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    padding: 15,
    borderRadius: 14,
    backgroundColor: colors.panel,
  },
  syncCopy: { flex: 1 },
  syncTitle: { color: colors.graphite, fontSize: 14, fontWeight: '700' },
  notice: { marginTop: 24, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 14 },
  noticeTitle: { color: colors.graphite, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  noticeBody: { marginTop: 6, color: colors.muted, fontSize: 12, lineHeight: 18 },
  privacyCard: { flexDirection: 'row', alignItems: 'center', marginTop: 12,
    paddingHorizontal: 16, paddingVertical: 4, borderRadius: 14, backgroundColor: colors.panel },
  privacyTitle: { flex: 1, color: colors.graphite, fontSize: 13, fontWeight: '700' },
});
