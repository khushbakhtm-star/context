import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors, AppearanceMode } from '../theme';
import type { CalendarPreferences, DeviceCalendar } from '../types';
import { ReleaseUpdateSettings, type ReleaseUpdatesState } from '../components/ReleaseUpdates';

type Props = {
  permissionStatus: string;
  calendars: DeviceCalendar[];
  preferences: CalendarPreferences;
  onRequestAccess: () => Promise<void>;
  onRefreshCalendars: () => Promise<void>;
  onChange: (next: CalendarPreferences) => void;
  onOpenAccounts: () => void;
  onOpenCategories: () => void;
  updates: ReleaseUpdatesState;
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
  updates,
}: Props) {
  const { colors, mode, setMode, persistenceError } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const hasAccess = permissionStatus === 'granted';

  function toggleImported(id: string) {
    const selected = new Set(preferences.selectedCalendarIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    onChange({ ...preferences, selectedCalendarIds: [...selected] });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>SETTINGS</Text>
      <Text style={styles.title}>Appearance</Text>
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
      <Text style={styles.appearanceHelp}>Match your phone or choose a light or dark screen.</Text>
      {persistenceError ? <Text style={styles.appearanceError}>{persistenceError}</Text> : null}

      <Text style={styles.calendarHeading}>Calendar connection</Text>
      <Text style={styles.intro}>
        Context reads plans from calendars already connected to this phone. Your complete minute
        ledger stays in Context.
      </Text>

      <Pressable onPress={onOpenAccounts} style={styles.accountButton}>
        <Text style={styles.accountTitle}>Accounts & phone synchronization</Text>
        <Text style={styles.accountBody}>Google and Microsoft · encrypted ledger · calendar edit import</Text>
      </Pressable>

      <Pressable onPress={onOpenCategories} style={styles.categoriesButton}>
        <Text style={styles.categoriesTitle}>Activity categories & calendar colors</Text>
        <Text style={styles.categoriesBody}>Create categories or import labels and colors from your calendars.</Text>
      </Pressable>

      <View style={styles.permissionCard}>
        <View style={[styles.statusDot, hasAccess && styles.statusDotGranted]} />
        <View style={styles.permissionCopy}>
          <Text style={styles.permissionTitle}>
            {hasAccess ? 'Full calendar access granted' : 'Calendar access required'}
          </Text>
          <Text style={styles.permissionBody}>
            {hasAccess
              ? 'Context can read selected plans and write your confirmed activity blocks.'
              : 'Permission is requested only when you choose to connect calendars.'}
          </Text>
        </View>
        <Pressable onPress={hasAccess ? onRefreshCalendars : onRequestAccess} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>{hasAccess ? 'Refresh' : 'Allow'}</Text>
        </Pressable>
      </View>

      {hasAccess ? (
        <>
          <Text style={styles.sectionTitle}>Calendars used for plans</Text>
          <Text style={styles.sectionHelp}>
            Check the calendars you want to appear in Today. When creating an event in Google Calendar,
            save it in one of these checked calendars. Events refresh when you return to Context.
          </Text>
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
              <Text style={styles.noCalendars}>No synced calendars are currently visible to the phone.</Text>
            ) : null}
          </View>

          <View style={styles.syncRow}>
            <View style={styles.syncCopy}>
              <Text style={styles.syncTitle}>Write actual activity blocks</Text>
              <Text style={styles.syncBody}>
                Creates or updates only Context-owned events in the calendar marked “Actuals.”
              </Text>
            </View>
            <Switch
              value={preferences.syncActuals}
              disabled={!preferences.writeCalendarId}
              onValueChange={(value) => onChange({ ...preferences, syncActuals: value })}
              trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
              thumbColor={colors.switchThumb}
            />
          </View>
        </>
      ) : null}

      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Google, iCloud, Outlook, Exchange</Text>
        <Text style={styles.noticeBody}>
          Add or enable the account in your phone’s Calendar settings first. Context can then use
          the calendars the operating system exposes. Teams and Zoom meetings normally arrive
          through their Google or Outlook event.
        </Text>
      </View>

      <View style={styles.privacyCard}>
        <Text style={styles.privacyTitle}>Local-first privacy</Text>
        <Text style={styles.privacyBody}>
          Account synchronization encrypts your private ledger before storing it in your selected
          app folder. Calendar descriptions are readable in your calendar and follow its sharing
          settings. Connect the same storage account and passphrase on both phones.
        </Text>
      </View>

      <View style={styles.releaseCard}>
        <Text style={styles.releaseTitle}>Choose how calendars connect</Text>
        <Text style={styles.releaseBody}>
          Device-calendar access copies actuals into separate events. Account connections can also
          replace a selected original occurrence and import edits when you allow those permissions.
          Account calendar writes take over from device writeback to avoid duplicate events.
        </Text>
      </View>
      <ReleaseUpdateSettings updates={updates} />
    </ScrollView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, paddingBottom: 40 },
  eyebrow: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.1 },
  title: { marginTop: 5, color: colors.ink, fontSize: 28, fontWeight: '700' },
  appearanceOptions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  appearanceOption: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, backgroundColor: colors.surface },
  appearanceOptionSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  appearanceText: { color: colors.graphite, fontSize: 14, fontWeight: '600' },
  appearanceTextSelected: { color: colors.onAccent },
  appearanceHelp: { marginTop: 9, color: colors.muted, fontSize: 12, lineHeight: 18 },
  appearanceError: { marginTop: 8, color: colors.danger, fontSize: 12, lineHeight: 18 },
  calendarHeading: { marginTop: 30, color: colors.ink, fontSize: 21, fontWeight: '600' },
  intro: { marginTop: 8, color: colors.muted, fontSize: 14, lineHeight: 21 },
  accountButton: { marginTop: 18, padding: 16, backgroundColor: colors.accent, borderRadius: 14 },
  accountTitle: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
  accountBody: { marginTop: 5, color: colors.onAccentMuted, fontSize: 12, lineHeight: 18 },
  categoriesButton: { marginTop: 10, padding: 16, backgroundColor: colors.panel, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  categoriesTitle: { color: colors.graphite, fontSize: 14, fontWeight: '700' },
  categoriesBody: { marginTop: 5, color: colors.muted, fontSize: 12, lineHeight: 18 },
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
  permissionBody: { marginTop: 3, color: colors.onAccentMuted, fontSize: 11, lineHeight: 16 },
  smallButton: { marginLeft: 12, minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.onAccentMuted, borderRadius: 9 },
  smallButtonText: { color: colors.onAccent, fontSize: 12, fontWeight: '700' },
  sectionTitle: { marginTop: 26, color: colors.ink, fontSize: 16, fontWeight: '700' },
  sectionHelp: { marginTop: 4, marginBottom: 10, color: colors.muted, fontSize: 12 },
  calendarCard: {
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
  noCalendars: { paddingVertical: 18, color: colors.muted, fontSize: 13, lineHeight: 19 },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    padding: 15,
    borderRadius: 14,
    backgroundColor: colors.panel,
  },
  syncCopy: { flex: 1, paddingRight: 14 },
  syncTitle: { color: colors.graphite, fontSize: 14, fontWeight: '700' },
  syncBody: { marginTop: 3, color: colors.muted, fontSize: 11, lineHeight: 16 },
  notice: { marginTop: 24, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 14 },
  noticeTitle: { color: colors.graphite, fontSize: 13, fontWeight: '700' },
  noticeBody: { marginTop: 6, color: colors.muted, fontSize: 12, lineHeight: 18 },
  privacyCard: { marginTop: 12, padding: 16, borderRadius: 14, backgroundColor: colors.panel },
  privacyTitle: { color: colors.graphite, fontSize: 13, fontWeight: '700' },
  privacyBody: { marginTop: 6, color: colors.muted, fontSize: 12, lineHeight: 18 },
  releaseCard: {
    marginTop: 12,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  releaseTitle: { color: colors.graphite, fontSize: 13, fontWeight: '700' },
  releaseBody: { marginTop: 6, color: colors.muted, fontSize: 12, lineHeight: 18 },
});
