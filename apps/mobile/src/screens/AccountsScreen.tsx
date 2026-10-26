import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { InfoButton } from '../components/InfoButton';
import { dismissLedgerConflict, getLedgerConflicts, restoreLedgerConflict } from '../data/database';
import {
  connectAccount, connectWebDavAccount, disconnectAccount, getAccounts, updateAccountConsent,
} from '../sync/accounts';
import {
  clearSavedPassphrase, getAccountPreferences, getAccountSyncStatus, hasLedgerPassphrase, listProjections,
  resolveProjectionConflict, setAccountPreferences, setLedgerPassphrase, subscribeAccountSync, synchronizeAccounts,
} from '../sync/engine';
import { createCalendarAdapter } from '../sync/providers';
import type {
  AccountCalendar, AccountConsent, AccountProvider, AccountSyncStatus, ConnectedAccount,
  Projection, SyncDocument,
} from '../sync/types';
import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';

type Props = { onDataChanged: () => void };
type CalendarSelection = { selectedCalendarIds: string[]; writeCalendarId: string | null };
type AccountView = {
  account: ConnectedAccount;
  calendars: AccountCalendar[];
  preferences: CalendarSelection;
  calendarError: string | null;
};

const INITIAL_CONSENT: AccountConsent = {
  ledgerStorage: true, calendarRead: true, calendarWrite: false,
  replaceOccurrences: false, importCalendarEdits: true,
  editInvitations: false, editSeries: false, categoryRead: false,
};

const PERMISSIONS: { id: keyof AccountConsent; title: string; detail: string }[] = [
  { id: 'ledgerStorage', title: 'Sync private ledger', detail: 'Store encrypted ledger updates in this account’s app folder for your other phone.' },
  { id: 'calendarRead', title: 'Read plans', detail: 'Show plans from the calendars you select below.' },
  { id: 'calendarWrite', title: 'Write actuals', detail: 'Publish activity blocks and timestamped notes to a selected calendar.' },
  { id: 'replaceOccurrences', title: 'Replace plan occurrences', detail: 'A confirmed linked activity can reschedule that occurrence. Other days in the series keep their plan.' },
  { id: 'importCalendarEdits', title: 'Import calendar edits', detail: 'Bring changes made to linked calendar activities back into the minute ledger.' },
  { id: 'editInvitations', title: 'Edit meetings & invitations', detail: 'Allow explicitly approved source meetings to change. The provider may notify attendees; organizer restrictions still apply.' },
  { id: 'editSeries', title: 'Edit recurring series', detail: 'Allow a separate, explicit whole-series choice. Confirming actual minutes still changes only one occurrence by default.' },
  { id: 'categoryRead', title: 'Read category labels', detail: 'Import the names and colors of category labels from this account.' },
];

function changedConsent(consent: AccountConsent, key: keyof AccountConsent, value: boolean): AccountConsent {
  const next = { ...consent, [key]: value };
  if (key === 'calendarRead' && !value) {
    next.calendarWrite = false;
    next.replaceOccurrences = false;
    next.importCalendarEdits = false;
    next.editInvitations = false;
    next.editSeries = false;
    next.categoryRead = false;
  }
  if (key === 'calendarWrite' && !value) {
    next.replaceOccurrences = false;
    next.editInvitations = false;
    next.editSeries = false;
  }
  if (key === 'calendarWrite' && value) next.calendarRead = true;
  return next;
}

function permissionDisabled(consent: AccountConsent, key: keyof AccountConsent) {
  return (key === 'replaceOccurrences' && !consent.calendarWrite) ||
    ((key === 'editInvitations' || key === 'editSeries') && !consent.calendarWrite) ||
    ((key === 'importCalendarEdits' || key === 'categoryRead') && !consent.calendarRead);
}

function PermissionRows({ value, disabled, onChange, storageOnly = false }: {
  value: AccountConsent;
  disabled: boolean;
  onChange: (consent: AccountConsent) => void;
  storageOnly?: boolean;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View>
      {PERMISSIONS.filter((permission) => !storageOnly || permission.id === 'ledgerStorage').map((permission) => (
        <View key={permission.id} style={styles.permissionRow}>
          <View style={styles.permissionCopy}>
            <Text style={styles.permissionTitle}>{permission.title}</Text>
          </View>
          <InfoButton title={permission.title} message={permission.detail} />
          <Switch
            accessibilityLabel={permission.title}
            value={value[permission.id]}
            disabled={disabled || permissionDisabled(value, permission.id)}
            onValueChange={(enabled) => onChange(changedConsent(value, permission.id, enabled))}
            trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
            thumbColor={colors.switchThumb}
          />
        </View>
      ))}
    </View>
  );
}

export function AccountsScreen({ onDataChanged }: Props) {
  const { colors, resolvedMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [views, setViews] = useState<AccountView[]>([]);
  const [newConsent, setNewConsent] = useState(INITIAL_CONSENT);
  const [hasKey, setHasKey] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirmation, setPassphraseConfirmation] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AccountSyncStatus>(() => getAccountSyncStatus());
  const [projections, setProjections] = useState<Projection[]>([]);
  const [ledgerConflicts, setLedgerConflicts] = useState<SyncDocument[]>([]);
  const [webDavUrl, setWebDavUrl] = useState('');
  const [webDavUser, setWebDavUser] = useState('');
  const [webDavPassword, setWebDavPassword] = useState('');

  const refresh = useCallback(async () => {
    const accounts = await getAccounts();
    const nextViews = await Promise.all(accounts.map(async (account) => {
      const preferences = await getAccountPreferences(account.id);
      let calendars: AccountCalendar[] = [];
      let calendarError: string | null = null;
      if (account.consent.calendarRead) {
        try {
          calendars = await createCalendarAdapter(account).listCalendars();
        } catch (failure) {
          calendarError = failure instanceof Error ? failure.message : 'Calendar list is unavailable. Reconnect to retry.';
        }
      }
      return { account, preferences, calendars, calendarError };
    }));
    const [keySaved, linked, alternatives] = await Promise.all([
      hasLedgerPassphrase(), listProjections(), getLedgerConflicts(),
    ]);
    setViews(nextViews);
    setHasKey(keySaved);
    setProjections(linked.filter((projection: Projection) => projection.state === 'conflict'));
    setLedgerConflicts(alternatives);
    setStatus(getAccountSyncStatus());
  }, []);

  useEffect(() => {
    void refresh().catch((failure) => setError(failure instanceof Error ? failure.message : 'Could not open account settings.'));
  }, [refresh]);

  useEffect(() => subscribeAccountSync(setStatus), []);

  async function perform(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError(null);
    try {
      await action();
      onDataChanged();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The account action could not be completed.');
      setStatus(getAccountSyncStatus());
    } finally {
      setBusy(null);
    }
  }

  function connect(provider: AccountProvider) {
    void perform('Connecting account…', async () => {
      await connectAccount(provider, newConsent);
    });
  }

  function disconnect(account: ConnectedAccount) {
    Alert.alert('Disconnect this account?', 'New requests will stop. Existing ledger files and calendar events will remain in your account.', [
      { text: 'Keep connected', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => void perform('Disconnecting…', async () => {
        await disconnectAccount(account.id);
      }) },
    ]);
  }

  function forgetPassphrase() {
    Alert.alert(
      'Forget the saved passphrase?',
      'This removes the key from this phone. Your local entries and encrypted cloud files stay in place. You will need the original passphrase to unlock existing cloud history again.',
      [
        { text: 'Keep key', style: 'cancel' },
        { text: 'Forget key', style: 'destructive', onPress: () => void perform('Forgetting saved key…', async () => {
          await clearSavedPassphrase();
        }) },
      ],
    );
  }

  async function saveKey() {
    if (passphrase.length < 12) {
      setError('Use a passphrase of at least 12 characters. Enter the same passphrase on your other phone.');
      return;
    }
    if (passphrase !== passphraseConfirmation) {
      setError('The passphrase confirmation does not match.');
      return;
    }
    await perform('Saving ledger key…', async () => {
      await setLedgerPassphrase(passphrase);
      setPassphrase('');
      setPassphraseConfirmation('');
    });
  }

  function changeSelection(view: AccountView, next: CalendarSelection) {
    void perform('Saving calendar selection…', async () => {
      await setAccountPreferences(view.account.id, next);
    });
  }

  async function sync() {
    await perform('Synchronizing accounts…', async () => {
      const next = await synchronizeAccounts();
      setStatus(next);
      onDataChanged();
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.titleRow}>
        <Text style={styles.title}>Accounts & sync</Text>
        <InfoButton
          title="Accounts & sync"
          message="Connect the same account on Android and iPhone and use the same ledger passphrase. Choose storage access and calendar permissions separately for each account. Original-plan replacement is limited to the occurrence linked to your entry. Calendar notes follow that calendar’s sharing settings. Other calendars can still be shown through your phone’s calendar connection in Settings."
        />
      </View>

      <View style={styles.syncCard}>
        <Text style={styles.cardTitle}>{busy || status.message || 'Ready'}</Text>
        {status.lastSyncedAt ? (
          <Text style={styles.help}>Last synchronized {new Date(status.lastSyncedAt).toLocaleString()}</Text>
        ) : null}
        <View style={styles.actionRow}>
          <Pressable disabled={Boolean(busy)} onPress={() => void sync()} style={[styles.primaryButton, busy && styles.disabled]}>
            <Text style={styles.primaryButtonText}>{busy ? 'Working…' : 'Sync now'}</Text>
          </Pressable>
          <InfoButton
            title="Synchronization"
            message="Updates synchronize while Context is open and when it returns to the foreground. Use Sync now to request an update."
          />
        </View>
      </View>

      {error ? <Text selectable style={styles.error}>{error}</Text> : null}

      <View style={styles.card}>
        <View style={styles.labelRow}>
          <Text style={styles.cardTitle}>Ledger passphrase</Text>
          <InfoButton
            title="Private ledger encryption"
            message={hasKey
              ? 'Your ledger key is saved securely on this phone. Use the same passphrase on your other phone. Keep a copy somewhere safe; it is needed to recover your encrypted history.'
              : 'Create a passphrase of at least 12 characters for your first phone, or enter the existing passphrase to unlock your ledger on another phone. Use the same passphrase on both phones. Your provider stores encrypted ledger updates. Calendar event notes remain readable in that calendar.'}
          />
        </View>
        {hasKey ? (
          <>
            <Text style={styles.help}>Saved on this phone</Text>
            <View style={styles.actionRow}>
              <Pressable disabled={Boolean(busy)} onPress={forgetPassphrase} style={[styles.secondaryButton, styles.pairedButton]}>
                <Text style={styles.secondaryButtonText}>Forget passphrase</Text>
              </Pressable>
              <InfoButton
                title="Forget saved passphrase"
                message="This removes the key from this phone. Your local entries and encrypted cloud files stay in place. You will need the original passphrase to unlock existing cloud history again."
              />
            </View>
          </>
        ) : (
          <>
            <TextInput keyboardAppearance={resolvedMode}
              secureTextEntry autoCapitalize="none" autoCorrect={false}
              accessibilityLabel="Ledger passphrase" placeholder="Ledger passphrase"
              placeholderTextColor={colors.muted} value={passphrase} onChangeText={setPassphrase}
              editable={!busy} style={styles.input}
            />
            <TextInput keyboardAppearance={resolvedMode}
              secureTextEntry autoCapitalize="none" autoCorrect={false}
              accessibilityLabel="Confirm ledger passphrase" placeholder="Confirm passphrase"
              placeholderTextColor={colors.muted} value={passphraseConfirmation} onChangeText={setPassphraseConfirmation}
              editable={!busy} style={styles.input}
            />
            <Pressable disabled={Boolean(busy)} onPress={() => void saveKey()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Save passphrase</Text>
            </Pressable>
          </>
        )}
      </View>

      {views.map((view) => (
        <View key={view.account.id} style={styles.card}>
          <View style={styles.cardHeading}>
            <View style={styles.flex}>
              <Text style={styles.provider}>{view.account.provider.toUpperCase()}</Text>
              <Text style={styles.accountLabel}>{view.account.label}</Text>
            </View>
            <Pressable disabled={Boolean(busy)} onPress={() => disconnect(view.account)} hitSlop={8}>
              <Text style={styles.disconnect}>Disconnect</Text>
            </Pressable>
            <InfoButton
              title="Disconnect account"
              message="New requests will stop. Existing ledger files and calendar events will remain in your account."
            />
          </View>
          <PermissionRows
            value={view.account.consent} disabled={Boolean(busy)}
            storageOnly={view.account.provider === 'webdav'}
            onChange={(consent) => void perform('Updating account permissions…', async () => {
              await updateAccountConsent(view.account.id, consent);
            })}
          />
          {view.calendarError ? <Text style={styles.error}>{view.calendarError}</Text> : null}
          {view.account.consent.calendarRead ? (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionLabel}>Calendars</Text>
                <InfoButton
                  title="Calendar selection"
                  message="Select calendars for plans. Mark one writable calendar for new actual activities. Use selects that calendar for actuals; Actuals shows the current selection."
                />
              </View>
              {view.calendars.map((calendar) => {
                const selected = view.preferences.selectedCalendarIds.includes(calendar.id);
                const destination = view.preferences.writeCalendarId === calendar.id;
                return (
                  <View key={calendar.id} style={styles.calendarRow}>
                    <Pressable
                      disabled={Boolean(busy)} accessibilityRole="checkbox" accessibilityState={{ checked: selected }}
                      onPress={() => changeSelection(view, {
                        ...view.preferences,
                        selectedCalendarIds: selected
                          ? view.preferences.selectedCalendarIds.filter((id) => id !== calendar.id)
                          : [...view.preferences.selectedCalendarIds, calendar.id],
                      })}
                      style={styles.calendarChoice}
                    >
                      <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                        {selected ? <Text style={styles.checkmark}>✓</Text> : null}
                      </View>
                      <View style={[styles.calendarDot, { backgroundColor: calendar.color }]} />
                      <Text style={styles.calendarName}>{calendar.title}{calendar.writable ? '' : ' · read only'}</Text>
                    </Pressable>
                    {calendar.writable && view.account.consent.calendarWrite ? (
                      <Pressable
                        disabled={Boolean(busy)}
                        onPress={() => changeSelection(view, {
                          selectedCalendarIds: [...new Set([...view.preferences.selectedCalendarIds, calendar.id])],
                          writeCalendarId: destination ? null : calendar.id,
                        })}
                        style={[styles.destination, destination && styles.destinationSelected]}
                      >
                        <Text style={[styles.destinationText, destination && styles.destinationTextSelected]}>
                          {destination ? 'Actuals' : 'Use'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
              {!view.calendarError && view.calendars.length === 0 ? <Text style={styles.help}>No calendars available</Text> : null}
            </>
          ) : null}
          {view.account.provider === 'webdav' ? (
            <View style={styles.storageRow}>
              <Text selectable style={[styles.help, styles.flex]}>{view.account.storageUrl}</Text>
              <InfoButton title="WebDAV app password" message="Reconnect this same folder below to update its app password." />
            </View>
          ) : <Pressable
            disabled={Boolean(busy)} style={styles.secondaryButton}
            onPress={() => void perform('Reconnecting account…', async () => {
              await connectAccount(view.account.provider, view.account.consent);
            })}
          >
            <Text style={styles.secondaryButtonText}>Reconnect account</Text>
          </Pressable>}
        </View>
      ))}

      <View style={styles.card}>
        <View style={styles.labelRow}>
          <Text style={styles.cardTitle}>Connect an account</Text>
          <InfoButton
            title="Connect an account"
            message="Choose what Context may do using the permissions below. The provider will ask you to grant the required account access."
          />
        </View>
        <PermissionRows value={newConsent} disabled={Boolean(busy)} onChange={setNewConsent} />
        <View style={styles.connectButtons}>
          <Pressable disabled={Boolean(busy)} onPress={() => connect('google')} style={[styles.connectButton, busy && styles.disabled]}>
            <Text style={styles.connectText}>Connect Google</Text>
          </Pressable>
          <Pressable disabled={Boolean(busy)} onPress={() => connect('microsoft')} style={[styles.connectButton, busy && styles.disabled]}>
            <Text style={styles.connectText}>Connect Microsoft</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.labelRow}>
          <Text style={styles.cardTitle}>WebDAV storage</Text>
          <InfoButton
            title="WebDAV storage"
            message="Use an existing dedicated Context folder on a WebDAV provider such as Nextcloud. Enter the exact HTTPS folder URL, your username, and a provider app password. For example: https://cloud.example.com/remote.php/dav/files/USERNAME/Context/. This connection stores your encrypted ledger and does not access calendars."
          />
        </View>
        <TextInput keyboardAppearance={resolvedMode}
          autoCapitalize="none" autoCorrect={false} keyboardType="url"
          accessibilityLabel="WebDAV Context folder URL" placeholder="Folder URL"
          placeholderTextColor={colors.muted} value={webDavUrl} onChangeText={setWebDavUrl}
          editable={!busy} style={styles.input}
        />
        <TextInput keyboardAppearance={resolvedMode}
          autoCapitalize="none" autoCorrect={false}
          accessibilityLabel="WebDAV username" placeholder="Username"
          placeholderTextColor={colors.muted} value={webDavUser} onChangeText={setWebDavUser}
          editable={!busy} style={styles.input}
        />
        <TextInput keyboardAppearance={resolvedMode}
          secureTextEntry autoCapitalize="none" autoCorrect={false}
          accessibilityLabel="WebDAV app password" placeholder="App password"
          placeholderTextColor={colors.muted} value={webDavPassword} onChangeText={setWebDavPassword}
          editable={!busy} style={styles.input}
        />
        <Pressable
          disabled={Boolean(busy) || !webDavUrl.trim() || !webDavUser.trim() || !webDavPassword}
          onPress={() => void perform('Connecting WebDAV folder…', async () => {
            await connectWebDavAccount({ url: webDavUrl, username: webDavUser, password: webDavPassword });
            setWebDavPassword('');
          })}
          style={[styles.secondaryButton, (busy || !webDavUrl.trim() || !webDavUser.trim() || !webDavPassword) && styles.disabled]}
        >
          <Text style={styles.secondaryButtonText}>Connect WebDAV</Text>
        </Pressable>
      </View>

      {projections.length > 0 || ledgerConflicts.length > 0 ? (
        <View style={styles.card}>
          <View style={styles.labelRow}>
            <Text style={styles.cardTitle}>Changes to review</Text>
            <InfoButton
              title="Calendar conflicts & saved alternatives"
              message="Both versions are kept when edits overlap. Choose the version that reflects what happened."
            />
          </View>
          {projections.map((projection) => (
            <View key={projection.id} style={styles.conflict}>
              <Text style={styles.conflictTitle}>{projection.baseEvent?.title || 'Linked activity'} · {projection.dateKey}</Text>
              <Text style={styles.help}>{projection.conflict || 'Context and the calendar both changed this activity.'}</Text>
              <View style={styles.conflictActions}>
                {(['context', 'calendar'] as const).map((choice) => (
                  <Pressable
                    key={choice} disabled={Boolean(busy)} style={styles.conflictButton}
                    onPress={() => void perform('Resolving calendar change…', async () => {
                      await resolveProjectionConflict(projection.id, choice);
                      onDataChanged();
                    })}
                  >
                    <Text style={styles.secondaryButtonText}>{choice === 'context' ? 'Use Context' : 'Use calendar'}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          {ledgerConflicts.map((document) => (
            <View key={`${document.key}:${document.revision}`} style={styles.conflict}>
              <Text style={styles.conflictTitle}>{document.key}</Text>
              <Text selectable style={styles.alternativeText}>
                {document.value === null ? 'Alternative: this minute was deleted.' : String(document.value.text || JSON.stringify(document.value))}
              </Text>
              <View style={styles.conflictActions}>
                <Pressable
                  disabled={Boolean(busy)} style={styles.conflictButton}
                  onPress={() => void perform('Restoring ledger alternative…', async () => {
                    await restoreLedgerConflict(document);
                    onDataChanged();
                  })}
                >
                  <Text style={styles.secondaryButtonText}>Restore alternative</Text>
                </Pressable>
                <Pressable
                  disabled={Boolean(busy)} style={styles.conflictButton}
                  onPress={() => void perform('Keeping current entry…', async () => {
                    await dismissLedgerConflict(document.key, document.revision);
                  })}
                >
                  <Text style={styles.secondaryButtonText}>Keep current</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}

    </ScrollView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, paddingBottom: 44 },
  titleRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, color: colors.ink, fontSize: 27, lineHeight: 33, fontWeight: '700' },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  sectionRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  storageRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  syncCard: { marginTop: 21, padding: 17, borderRadius: 15, backgroundColor: colors.panel },
  card: { marginTop: 17, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 15, backgroundColor: colors.surface },
  cardTitle: { color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: '700', flexShrink: 1 },
  help: { marginTop: 6, color: colors.muted, fontSize: 12, lineHeight: 18 },
  primaryButton: { alignSelf: 'flex-start', paddingHorizontal: 19, paddingVertical: 12, borderRadius: 11, backgroundColor: colors.accent },
  primaryButtonText: { color: colors.onAccent, fontSize: 13, fontWeight: '700' },
  secondaryButton: { alignSelf: 'flex-start', marginTop: 14, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.hairline, borderRadius: 10, backgroundColor: colors.panel },
  pairedButton: { marginTop: 0, flexShrink: 1 },
  secondaryButtonText: { color: colors.graphite, fontSize: 12, fontWeight: '700' },
  error: { marginTop: 14, color: colors.danger, fontSize: 12, lineHeight: 18 },
  input: { minHeight: 46, marginTop: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.silver, borderRadius: 10, backgroundColor: colors.paper, color: colors.ink, fontSize: 13 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  provider: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  accountLabel: { marginTop: 3, color: colors.ink, fontSize: 15, fontWeight: '600' },
  disconnect: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  permissionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  permissionCopy: { flex: 1, paddingRight: 13 },
  permissionTitle: { color: colors.graphite, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  sectionLabel: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: '700' },
  calendarRow: { minHeight: 53, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  calendarChoice: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  checkbox: { width: 19, height: 19, borderWidth: 1.5, borderColor: colors.silver, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { borderColor: colors.graphite, backgroundColor: colors.accent },
  checkmark: { color: colors.onAccent, fontSize: 12, fontWeight: '800' },
  calendarDot: { width: 7, height: 7, marginLeft: 9, marginRight: 7, borderRadius: 4 },
  calendarName: { flex: 1, color: colors.graphite, fontSize: 12, lineHeight: 17 },
  destination: { marginLeft: 9, paddingVertical: 7, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.hairline, borderRadius: 11 },
  destinationSelected: { backgroundColor: colors.accent, borderColor: colors.graphite },
  destinationText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  destinationTextSelected: { color: colors.onAccent },
  connectButtons: { marginTop: 15, gap: 10 },
  connectButton: { paddingHorizontal: 15, paddingVertical: 13, borderWidth: 1, borderColor: colors.silver, borderRadius: 11, alignItems: 'center', backgroundColor: colors.paper },
  connectText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  conflict: { marginTop: 15, paddingTop: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  conflictTitle: { color: colors.graphite, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  conflictActions: { marginTop: 9, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  conflictButton: { paddingHorizontal: 11, paddingVertical: 10, borderWidth: 1, borderColor: colors.hairline, borderRadius: 9, backgroundColor: colors.panel },
  alternativeText: { marginTop: 7, color: colors.muted, fontSize: 12, lineHeight: 18 },
});
