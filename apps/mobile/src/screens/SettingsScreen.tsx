import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors, AppearanceMode } from '../theme';
import type { CalendarPreferences, DeviceCalendar } from '../types';
import { ReleaseUpdateSettings, type ReleaseUpdatesState } from '../components/ReleaseUpdates';
import { checkCalendarConnection, getCalendarReadDiagnostics, type CalendarReadDiagnostics } from '../services/calendar';
import { dateKey, formatDayHeading } from '../utils/time';
import { WatchSettings } from '../wear/WatchSettings';
import { InfoButton } from '../components/InfoButton';
import type { ChecklistListSummary } from '../utils/checklist-flow';

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
  priorityLists?: ChecklistListSummary[];
  priorityRevision?: string | null;
  priorityHideCompleted?: boolean;
  onPriorityHideCompletedChange?: (value: boolean) => Promise<void>;
  onCreatePriorityList?: (name: string, expectedRevision: string | null) => Promise<void>;
  onRenamePriorityList?: (id: string, name: string, expectedRevision: string | null) => Promise<void>;
  priorityError?: string | null;
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
  priorityLists = [], priorityRevision, priorityHideCompleted = false, onPriorityHideCompletedChange,
  onCreatePriorityList, onRenamePriorityList, priorityError,
}: Props) {
  const { colors, mode, setMode, persistenceError } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const hasAccess = permissionStatus === 'granted';
  const [checking, setChecking] = useState(false);
  const [calendarCheck, setCalendarCheck] = useState<CalendarReadDiagnostics | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [showOtherCalendars, setShowOtherCalendars] = useState(false);
  const [priorityDraft, setPriorityDraft] = useState<{ id: string | null; name: string; revision: string | null } | null>(null);
  const [priorityBusy, setPriorityBusy] = useState(false);
  const priorityBusyRef = useRef(false);
  const [prioritySaveError, setPrioritySaveError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function priorityAction(action: () => Promise<void>, closeEditor = false) {
    if (priorityBusyRef.current) return;
    priorityBusyRef.current = true; setPriorityBusy(true); setPrioritySaveError(null);
    try { await action(); if (mounted.current && closeEditor) setPriorityDraft(null); }
    catch (failure) { if (mounted.current) setPrioritySaveError(failure instanceof Error ? failure.message : 'The Priority setting could not be saved.'); }
    finally { priorityBusyRef.current = false; if (mounted.current) setPriorityBusy(false); }
  }
  const selectedCalendars = calendars.filter((calendar) => preferences.selectedCalendarIds.includes(calendar.id));
  const otherCalendars = calendars.filter((calendar) => !preferences.selectedCalendarIds.includes(calendar.id));
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

  function renderCalendar(calendar: DeviceCalendar, index: number, count: number) {
    const selected = preferences.selectedCalendarIds.includes(calendar.id);
    const writesHere = preferences.writeCalendarId === calendar.id;
    return <View key={calendar.id} style={[styles.calendarRow, index === count - 1 && styles.lastRow]}>
      <Pressable accessibilityRole="checkbox" accessibilityLabel={calendar.title}
        accessibilityState={{ checked: selected }} onPress={() => toggleImported(calendar.id)} style={styles.calendarSelect}>
        <View style={[styles.checkbox, selected && { borderColor: calendar.color, backgroundColor: calendar.color }]}>
          {selected ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
        <View style={styles.calendarText}>
          <Text style={styles.calendarTitle}>{calendar.title}</Text>
          <Text style={styles.calendarSource}>{calendar.sourceName}{calendar.allowsModifications ? '' : ' · read only'}</Text>
          {calendar.isVisible === false ? <Text style={styles.appearanceError}>Hidden in the phone calendar</Text> : null}
          {calendar.isSynced === false ? <Text style={styles.appearanceError}>Phone calendar synchronization is off</Text> : null}
        </View>
      </Pressable>
      {calendar.allowsModifications ? <Pressable accessibilityRole="button"
        accessibilityLabel={writesHere ? `Stop using ${calendar.title} for actuals` : `Use ${calendar.title} for actuals`}
        accessibilityState={{ selected: writesHere }}
        onPress={() => onChange({ ...preferences, writeCalendarId: writesHere ? null : calendar.id })}
        style={[styles.writeChoice, writesHere && styles.writeChoiceSelected]}>
        <Text style={[styles.writeChoiceText, writesHere && styles.writeChoiceTextSelected]}>{writesHere ? 'Actuals' : 'Use'}</Text>
      </Pressable> : null}
    </View>;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.title}>Appearance</Text>
        <InfoButton title="Appearance" message="Match your phone’s appearance with System, or choose a light or dark screen." />
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={styles.appearanceOptions}>
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
        <Text accessibilityRole="header" style={styles.sectionTitle}>Time format</Text>
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
        <Text accessibilityRole="header" style={styles.sectionTitle}>Priority</Text>
        <InfoButton title="Checklist task flow" message="Create or rename checklists here. In Priority, use the arrows to switch lists and + to add a task. Drag a task to change its priority; nested subtasks move with it. Checked tasks fade and can be hidden. Reset removes all checks in the current list." />
      </View>
      <View style={styles.priorityToggle}>
        <Text style={styles.priorityLabel}>Hide completed tasks</Text>
        <Switch accessibilityLabel="Hide completed Priority tasks" value={priorityHideCompleted}
          disabled={priorityBusy || !onPriorityHideCompletedChange}
          onValueChange={(value) => { if (onPriorityHideCompletedChange) void priorityAction(() => onPriorityHideCompletedChange(value)); }}
          trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }} thumbColor={colors.switchThumb} />
      </View>
      <View style={styles.priorityLists}>
        {priorityLists.map((list) => <Pressable key={list.id} accessibilityRole="button" accessibilityLabel={`Rename checklist ${list.name}`}
          disabled={priorityBusy || Boolean(priorityDraft) || priorityRevision === undefined} onPress={() => {
            if (priorityBusyRef.current || priorityRevision === undefined) return;
            setPrioritySaveError(null); setPriorityDraft({ id: list.id, name: list.name, revision: priorityRevision }); }}
          style={styles.priorityListRow}>
          <Text style={styles.priorityLabel}>{list.name}</Text><Text accessible={false} style={styles.priorityEdit}>✎</Text>
        </Pressable>)}
        {!priorityDraft ? <Pressable accessibilityRole="button" accessibilityLabel="Create checklist" disabled={priorityBusy || !onCreatePriorityList || priorityRevision === undefined}
          onPress={() => { if (priorityBusyRef.current || priorityRevision === undefined) return;
            setPrioritySaveError(null); setPriorityDraft({ id: null, name: '', revision: priorityRevision }); }} style={styles.priorityListRow}>
          <Text style={styles.priorityLabel}>New checklist</Text><Text accessible={false} style={styles.priorityPlus}>+</Text>
        </Pressable> : <View style={styles.priorityEditor}>
          <TextInput accessibilityLabel="Checklist name" value={priorityDraft.name} editable={!priorityBusy} maxLength={80}
            autoFocus placeholder="Checklist name" placeholderTextColor={colors.muted}
            onChangeText={(name) => { if (!priorityBusyRef.current) setPriorityDraft((value) => value ? { ...value, name } : value); }}
            style={styles.priorityNameInput} />
          <View style={styles.priorityEditorActions}>
            <Pressable accessibilityRole="button" disabled={priorityBusy} onPress={() => { if (!priorityBusyRef.current) { setPriorityDraft(null); setPrioritySaveError(null); } }} style={styles.smallButton}>
              <Text style={styles.smallButtonText}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={priorityBusy || !priorityDraft.name.trim()}
              onPress={() => { const { id, name, revision } = priorityDraft;
                const action = id === null ? onCreatePriorityList && (() => onCreatePriorityList(name.trim(), revision)) :
                  onRenamePriorityList && (() => onRenamePriorityList(id, name.trim(), revision));
                if (action) void priorityAction(action, true); }} style={styles.smallButton}>
              <Text style={styles.smallButtonText}>{priorityBusy ? 'Saving…' : 'Save'}</Text></Pressable>
          </View>
        </View>}
      </View>
      {prioritySaveError || priorityError ? <Text accessibilityRole="alert" style={styles.appearanceError}>{prioritySaveError ?? priorityError}</Text> : null}

      <View style={styles.sectionHeadingRow}>
        <Text accessibilityRole="header" style={styles.calendarHeading}>Phone calendars</Text>
        <InfoButton title="Phone calendars" message={"Show plans from calendars connected to this phone. Add or enable Google, iCloud, Outlook or Exchange in your phone’s Calendar settings first. Teams and Zoom meetings normally appear through their Google or Outlook event.\n\nThe phone-calendar connection publishes separate Context activity events. An account connection can also replace a selected original occurrence and import edits when allowed. A configured account Actuals destination takes over new activity publishing; enabling account write permission alone does not. Existing linked activities keep their approved connection."} />
      </View>

      <View style={styles.accountButton}>
        <Pressable accessibilityRole="button" onPress={onOpenAccounts} style={styles.navigationAction}>
          <Text style={styles.accountTitle}>Accounts & synchronization</Text>
        </Pressable>
        <InfoButton title="Accounts & synchronization" message={"Connect the same storage account and ledger passphrase on both phones to synchronize your encrypted private ledger. Calendar descriptions remain readable in that calendar and follow its sharing settings.\n\nAccount calendar connections can import event edits and replace selected original plans when allowed. Choose an Actuals destination to publish new activities through that account; write permission alone does not replace the phone-calendar connection."} />
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
        <InfoButton title="Calendar access" message="Calendar access lets Context read your selected plans and write the confirmed activity blocks you choose to synchronize. Your phone requests permission only when you tap Allow. Refresh reloads the calendars available on this phone." />
        <Pressable accessibilityRole="button" onPress={hasAccess ? onRefreshCalendars : onRequestAccess} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>{hasAccess ? 'Refresh' : 'Allow'}</Text>
        </Pressable>
      </View>

      {hasAccess ? (
        <>
          <View style={styles.sectionHeadingRow}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>Calendars used for plans</Text>
            <InfoButton title="Calendars used for plans" message={"Check the calendars you want to appear in Day. When creating an event in Google Calendar, save it in one of these checked calendars. Events refresh when you return to Context.\n\nTap Use to choose the calendar for actual activity blocks. The selected calendar is marked Actuals. A read-only calendar can supply plans but cannot receive activity blocks."} />
          </View>
          <View style={styles.calendarCard}>
            {selectedCalendars.map((calendar, index) => renderCalendar(calendar, index, selectedCalendars.length))}
            {otherCalendars.length ? <>
              <Pressable accessibilityRole="button" accessibilityLabel={`Other calendars (${otherCalendars.length})`}
                accessibilityHint="Shows or hides unchecked calendars"
                accessibilityState={{ expanded: showOtherCalendars }}
                onPress={() => setShowOtherCalendars((value) => !value)} style={styles.calendarDropdown}>
                <Text style={styles.calendarDropdownText}>Other calendars ({otherCalendars.length})</Text>
                <Text accessible={false} style={styles.calendarDropdownArrow}>{showOtherCalendars ? '⌃' : '⌄'}</Text>
              </Pressable>
              {showOtherCalendars ? otherCalendars.map((calendar, index) => renderCalendar(calendar, index, otherCalendars.length)) : null}
            </> : null}
            {calendars.length === 0 ? (
              <View style={styles.headingRow}>
                <Text style={styles.noCalendars}>No calendars found</Text>
                <InfoButton title="No calendars found" message="Add or enable a calendar account in your phone’s Calendar settings, then return to Context and tap Refresh." />
              </View>
            ) : null}
          </View>

          <View style={styles.notice}>
            <View style={styles.headingRow}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>Check calendar connection</Text>
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

      <WatchSettings />
      <ReleaseUpdateSettings updates={updates} />
    </ScrollView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, paddingBottom: 40 },
  title: { flex: 1, color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: '600' },
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
  calendarHeading: { flex: 1, color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  accountButton: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingRight: 4,
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  accountTitle: { color: colors.graphite, fontSize: 14, fontWeight: '600' },
  categoriesButton: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingRight: 4,
    backgroundColor: colors.surface, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  categoriesTitle: { color: colors.graphite, fontSize: 14, fontWeight: '600' },
  permissionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    padding: 15,
    borderRadius: 15,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  statusDot: { width: 10, height: 10, marginRight: 12, borderRadius: 5, backgroundColor: '#9A7653' },
  statusDotGranted: { backgroundColor: colors.muted },
  permissionCopy: { flex: 1 },
  permissionTitle: { color: colors.graphite, fontSize: 14, fontWeight: '500' },
  smallButton: { marginLeft: 4, minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 9 },
  smallButtonText: { color: colors.graphite, fontSize: 13, fontWeight: '600' },
  sectionTitle: { flex: 1, color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  priorityToggle: { flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: 8 },
  priorityLabel: { flex: 1, color: colors.graphite, fontSize: 14, lineHeight: 21 },
  priorityLists: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 12, paddingHorizontal: 14, backgroundColor: colors.surface },
  priorityListRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  priorityEdit: { fontSize: 22, color: colors.muted, width: 26, textAlign: 'center' },
  priorityPlus: { fontSize: 26, color: colors.muted, width: 26, textAlign: 'center' },
  priorityEditor: { paddingVertical: 12 },
  priorityNameInput: { minHeight: 44, color: colors.ink, fontSize: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline, paddingHorizontal: 4 },
  priorityEditorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  checkConnectionButton: { minHeight: 44, marginTop: 12, paddingHorizontal: 14, alignSelf: 'flex-start',
    paddingVertical: 11, justifyContent: 'center', borderRadius: 8, backgroundColor: colors.accent },
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
  calendarDropdown: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  calendarDropdownText: { flex: 1, color: colors.graphite, fontSize: 14, fontWeight: '500' },
  calendarDropdownArrow: { color: colors.muted, fontSize: 20, width: 24, textAlign: 'center' },
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
});
