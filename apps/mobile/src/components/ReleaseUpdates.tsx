import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';

import { getSetting, setSetting } from '../data/database';
import { colors } from '../theme';
import { installedReleaseFromEmbeddedConfig } from '../services/installed-release';
import {
  fetchReleaseManifest, httpsReleaseUrl, releaseNoticeKey, selectAvailableRelease, shouldCheckForUpdate,
  type ReleaseChannel, type ReleasedUpdate,
} from '../services/updates';

const SETTINGS_KEY = 'release-updates.enabled';
const DISMISSED_KEY = 'release-updates.dismissed';
const CHECKED_KEY = 'release-updates.last-check';
const manifestUrl = process.env.EXPO_PUBLIC_CONTEXT_RELEASE_MANIFEST_URL ??
  'https://raw.githubusercontent.com/khushbakhtm-star/context/main/releases/latest.json';
const channelSetting = process.env.EXPO_PUBLIC_CONTEXT_RELEASE_CHANNEL;
const channel: ReleaseChannel = channelSetting === 'google-play' || channelSetting === 'apple-app-store' ||
  channelSetting === 'fdroid' || channelSetting === 'standalone' ? channelSetting :
  process.env.EXPO_PUBLIC_CONTEXT_DISTRIBUTION === 'fdroid' ? 'fdroid' : 'standalone';
const trust = {
  appleAppStoreId: process.env.EXPO_PUBLIC_CONTEXT_APP_STORE_ID,
  standaloneReleaseUrl: process.env.EXPO_PUBLIC_CONTEXT_STANDALONE_RELEASE_URL ??
    'https://github.com/khushbakhtm-star/context/releases',
};
const installed = installedReleaseFromEmbeddedConfig({
  platform: Platform.OS,
  channel,
  config: Constants.expoConfig,
  executionEnvironment: Constants.executionEnvironment,
  development: __DEV__,
  iosNativeBuildNumber: Constants.platform?.ios?.buildNumber,
});
const configured = Boolean(installed && httpsReleaseUrl(manifestUrl) &&
  (channel !== 'standalone' || httpsReleaseUrl(trust.standaloneReleaseUrl)) &&
  (channel !== 'apple-app-store' || /^\d+$/.test(trust.appleAppStoreId ?? '')));

export type ReleaseUpdatesState = {
  configured: boolean;
  enabled: boolean;
  loading: boolean;
  checking: boolean;
  status: string;
  available: ReleasedUpdate | null;
  notice: ReleasedUpdate | null;
  setEnabled: (value: boolean) => Promise<void>;
  checkNow: () => Promise<void>;
  dismiss: () => void;
  openRelease: () => void;
};

export function useReleaseUpdates(ready: boolean): ReleaseUpdatesState {
  const [enabled, setEnabledState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('');
  const [available, setAvailable] = useState<ReleasedUpdate | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const active = useRef(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const lastCheck = useRef(0);

  useEffect(() => {
    if (!ready) return;
    let mounted = true;
    void Promise.all([
      getSetting<unknown>(SETTINGS_KEY, false), getSetting<unknown>(DISMISSED_KEY, []),
      getSetting<unknown>(CHECKED_KEY, 0),
    ]).then(([savedEnabled, savedDismissed, savedCheck]) => {
      if (!mounted) return;
      setEnabledState(savedEnabled === true);
      setDismissed(Array.isArray(savedDismissed) ? savedDismissed.filter((key): key is string => typeof key === 'string').slice(-32) : []);
      lastCheck.current = typeof savedCheck === 'number' ? savedCheck : 0;
    }).catch(() => { /* Checking stays off if local preferences cannot be read. */ })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; active.current = false; generation.current += 1; };
  }, [ready]);

  const check = useCallback(async (manual = false) => {
    if (!ready || loading || !active.current || !configured || !installed || inFlight.current ||
        AppState.currentState !== 'active' || (!manual && !shouldCheckForUpdate(lastCheck.current))) return;
    inFlight.current = true;
    const requestGeneration = generation.current;
    setChecking(true);
    if (manual) setStatus('Checking for a released update…');
    lastCheck.current = Date.now();
    void setSetting(CHECKED_KEY, lastCheck.current).catch(() => {});
    try {
      const manifest = await fetchReleaseManifest(manifestUrl);
      if (!active.current || generation.current !== requestGeneration) return;
      if (!manifest) {
        if (manual) setStatus('The update check is unavailable. Try again later.');
        return;
      }
      const next = selectAvailableRelease(manifest, installed, trust);
      setAvailable(next);
      if (manual) setStatus(next ? `Context ${next.version} is available.` : 'No newer release is available for this edition.');
    } finally {
      inFlight.current = false;
      if (generation.current === requestGeneration) setChecking(false);
    }
  }, [loading, ready]);

  useEffect(() => {
    active.current = ready && !loading && enabled;
    generation.current += 1;
    setChecking(false);
    if (!active.current) {
      setAvailable(null);
      setStatus('');
      return;
    }
    void check();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void check(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') void check(); }, 60 * 60 * 1000);
    return () => { subscription.remove(); clearInterval(timer); active.current = false; generation.current += 1; };
  }, [check, enabled, loading, ready]);

  async function changeEnabled(value: boolean) {
    if (!configured || loading) return;
    setLoading(true);
    try {
      await setSetting(SETTINGS_KEY, value);
      setEnabledState(value);
    } catch { setStatus('This preference could not be saved. Try again.'); }
    finally { setLoading(false); }
  }

  function dismiss() {
    if (!available) return;
    const next = [...dismissed.filter((key) => key !== releaseNoticeKey(available)), releaseNoticeKey(available)].slice(-32);
    setDismissed(next);
    void setSetting(DISMISSED_KEY, next).catch(() => {});
  }

  function openRelease() {
    if (!available) return;
    void Linking.openURL(available.url).catch(() => { setStatus('The release page could not be opened.'); });
  }

  return { configured, enabled, loading, checking, status, available,
    notice: available && !dismissed.includes(releaseNoticeKey(available)) ? available : null,
    setEnabled: changeEnabled, checkNow: () => check(true), dismiss, openRelease };
}

function releaseButton(channel: ReleaseChannel) {
  return channel === 'google-play' ? 'Open Google Play' : channel === 'apple-app-store' ? 'Open App Store' :
    channel === 'fdroid' ? 'Open F-Droid' : 'View release';
}

export function ReleaseUpdateNotice({ updates }: { updates: ReleaseUpdatesState }) {
  if (!updates.notice) return null;
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <View style={styles.copy}>
        <Text style={styles.title}>Context {updates.notice.version} is available</Text>
        <Text style={styles.body}>A new release is ready for this edition.</Text>
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={updates.openRelease} style={styles.button}>
          <Text style={styles.buttonText}>{releaseButton(updates.notice.channel)}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss this version’s update notice" onPress={updates.dismiss} style={styles.dismiss}>
          <Text style={styles.dismissText}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ReleaseUpdateSettings({ updates }: { updates: ReleaseUpdatesState }) {
  return (
    <View style={styles.settings}>
      <View style={styles.settingRow}>
        <View style={styles.copy}>
          <Text style={styles.title}>Check for released updates</Text>
          <Text style={styles.body}>
            {updates.configured ? 'While Context is open, check this edition’s release feed. No ledger or account details are sent.' :
              'Update checks become available when this edition has a configured public release feed.'}
          </Text>
        </View>
        <Switch accessibilityLabel="Check for released Context updates" value={updates.enabled}
          disabled={!updates.configured || updates.loading} onValueChange={(value) => { void updates.setEnabled(value); }}
          trackColor={{ false: '#D5D2CB', true: '#7A8079' }} thumbColor={colors.white} />
      </View>
      {updates.configured && updates.enabled ? (
        <View style={styles.settingsActions}>
          <Pressable accessibilityRole="button" disabled={updates.checking || updates.loading}
            onPress={() => { void updates.checkNow(); }} style={styles.button}>
            <Text style={styles.buttonText}>{updates.checking ? 'Checking…' : 'Check now'}</Text>
          </Pressable>
          {updates.available ? (
            <Pressable accessibilityRole="button" onPress={updates.openRelease} style={styles.button}>
              <Text style={styles.buttonText}>{releaseButton(updates.available.channel)}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {updates.status ? <Text style={styles.status} accessibilityLiveRegion="polite">{updates.status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.panel,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  copy: { flex: 1, paddingRight: 12 },
  title: { color: colors.graphite, fontSize: 13, fontWeight: '700' },
  body: { marginTop: 4, color: colors.muted, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  button: { minHeight: 42, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 9, backgroundColor: colors.graphite },
  buttonText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  dismiss: { minHeight: 42, paddingHorizontal: 14, justifyContent: 'center' },
  dismissText: { color: colors.muted, fontSize: 12 },
  settings: { marginTop: 12, padding: 16, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline, borderRadius: 14, backgroundColor: colors.white },
  settingRow: { flexDirection: 'row', alignItems: 'center' },
  settingsActions: { marginTop: 12, flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  status: { marginTop: 10, color: colors.muted, fontSize: 12, lineHeight: 18 },
});
