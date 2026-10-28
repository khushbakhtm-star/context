import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { getSetting, setSetting } from '../data/database';
import {
  accountConfig,
  assertGoogleConfiguration,
  assertMicrosoftConfiguration,
} from './config';
import type { AccountConsent, AccountProvider, ConnectedAccount } from './types';
import { normalizeWebDavFolder, probeWebDavFolder } from './webdav';
import type { WebDavCredentials } from './webdav';
import { accountFetchWithDeadline, accountRequestDeadline } from '../utils/account-request-deadline';

WebBrowser.maybeCompleteAuthSession();

const ACCOUNTS_KEY = 'connected.accounts.v1';
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

type StoredCredential = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

let googleConfigured = false;
const credentialRefreshes = new Map<string, Promise<string>>();

type GoogleUser = { user: { id: string; email: string }; scopes: string[] };
type GoogleResponse = { type: 'success'; data: GoogleUser } | { type: 'cancelled' | 'noSavedCredentialFound'; data: null };
type GoogleNativeSdk = {
  GoogleSignin: {
    configure(config: { webClientId: string; iosClientId?: string; scopes?: string[]; offlineAccess: boolean }): void;
    hasPlayServices(config: { showPlayServicesUpdateDialog: boolean }): Promise<boolean>;
    signIn(): Promise<GoogleResponse>;
    signInSilently(): Promise<GoogleResponse>;
    addScopes(config: { scopes: string[] }): Promise<GoogleResponse | null>;
    getCurrentUser(): GoogleUser | null;
    getTokens(): Promise<{ accessToken: string; idToken: string }>;
    clearCachedAccessToken(token: string): Promise<unknown>;
    signOut(): Promise<unknown>;
  };
};

let googleNativeSdk: GoogleNativeSdk | null = null;

function googleSdk() {
  assertGoogleConfiguration();
  // Metro maps this cold import to a local stub in the F-Droid flavor. The native module is neither
  // linked nor evaluated there; other editions retain the provider's native authentication SDK.
  googleNativeSdk ??= require('@react-native-google-signin/google-signin') as GoogleNativeSdk;
  return googleNativeSdk.GoogleSignin;
}

export function normalizedConsent(consent: AccountConsent): AccountConsent {
  const calendarWrite = Boolean(consent.calendarWrite);
  const calendarRead = Boolean(consent.calendarRead || calendarWrite || consent.importCalendarEdits);
  return {
    ledgerStorage: Boolean(consent.ledgerStorage),
    calendarRead,
    calendarWrite,
    replaceOccurrences: calendarWrite && Boolean(consent.replaceOccurrences),
    importCalendarEdits: calendarRead && Boolean(consent.importCalendarEdits),
    editInvitations: calendarWrite && Boolean(consent.editInvitations),
    editSeries: calendarWrite && Boolean(consent.editSeries),
    categoryRead: calendarRead && Boolean(consent.categoryRead),
  };
}

export async function getAccounts(): Promise<ConnectedAccount[]> {
  const accounts = await getSetting<ConnectedAccount[]>(ACCOUNTS_KEY, []);
  return accounts.map((account) => ({ ...account, consent: normalizedConsent(account.consent) }));
}

async function credentialKey(id: string) {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, id);
  return `context.oauth.${digest}`;
}

async function readCredential(id: string): Promise<StoredCredential | null> {
  const value = await SecureStore.getItemAsync(await credentialKey(id), secureOptions);
  if (!value) return null;
  return JSON.parse(value) as StoredCredential;
}

async function writeCredential(id: string, credential: StoredCredential) {
  await SecureStore.setItemAsync(await credentialKey(id), JSON.stringify(credential), secureOptions);
}

async function saveAccount(account: ConnectedAccount) {
  const accounts = await getAccounts();
  const otherAccounts = accounts.filter((candidate) => candidate.id !== account.id);
  // The native Google SDK has one active user. Keep exactly one Google identity per installation;
  // this avoids ever using a different user's native token for an old saved account.
  const keep =
    account.provider === 'google'
      ? otherAccounts.filter((candidate) => candidate.provider !== 'google')
      : otherAccounts;
  await setSetting(ACCOUNTS_KEY, [...keep, account]);
}

function googleScopes(consent: AccountConsent) {
  const scopes = ['openid', 'email', 'profile'];
  if (consent.ledgerStorage) scopes.push('https://www.googleapis.com/auth/drive.appdata');
  if (consent.calendarWrite) scopes.push('https://www.googleapis.com/auth/calendar.events');
  else if (consent.calendarRead) scopes.push('https://www.googleapis.com/auth/calendar.events.readonly');
  if (consent.calendarRead) scopes.push('https://www.googleapis.com/auth/calendar.calendarlist.readonly');
  if (consent.categoryRead) scopes.push('https://www.googleapis.com/auth/calendar.calendars.readonly');
  return scopes;
}

function configureGoogle(scopes?: string[]) {
  const GoogleSignin = googleSdk();
  if (googleConfigured && !scopes) return GoogleSignin;
  GoogleSignin.configure({
    webClientId: accountConfig.googleWebClientId,
    iosClientId: accountConfig.googleIosClientId || undefined,
    scopes,
    offlineAccess: false,
  });
  googleConfigured = true;
  return GoogleSignin;
}

function microsoftDiscovery() {
  assertMicrosoftConfiguration();
  const base = `https://login.microsoftonline.com/${accountConfig.microsoftTenant}/oauth2/v2.0`;
  return { authorizationEndpoint: `${base}/authorize`, tokenEndpoint: `${base}/token` };
}

function microsoftScopes(consent: AccountConsent) {
  const scopes = ['openid', 'profile', 'email', 'offline_access', 'User.Read'];
  if (consent.ledgerStorage) scopes.push('Files.ReadWrite.AppFolder');
  if (consent.calendarWrite) scopes.push('Calendars.ReadWrite');
  else if (consent.calendarRead) scopes.push('Calendars.Read');
  if (consent.categoryRead) scopes.push('MailboxSettings.Read');
  return scopes;
}

async function connectGoogle(consent: AccountConsent): Promise<ConnectedAccount> {
  const GoogleSignin = configureGoogle(googleScopes(consent));
  if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (response.type !== 'success') throw new Error('Google connection was canceled.');
  const data = response.data;
  const current = GoogleSignin.getCurrentUser();
  if (!current || current.user.id !== data.user.id) {
    throw new Error('The selected Google account changed. Please reconnect.');
  }
  const requested = googleScopes(consent).filter((scope) => scope.startsWith('https://'));
  if (!requested.every((scope) => data.scopes.includes(scope))) {
    const additional = await GoogleSignin.addScopes({ scopes: requested });
    if (!additional || additional.type !== 'success') {
      throw new Error('The requested Google permissions were not granted.');
    }
    if (additional.data.user.id !== data.user.id) {
      throw new Error('The Google account changed while granting access. Reconnect the selected account.');
    }
    if (!requested.every((scope) => additional.data.scopes.includes(scope))) {
      throw new Error('Grant the selected Google permissions to enable this connection.');
    }
  }
  return {
    id: `google:${data.user.id}`,
    subject: data.user.id,
    provider: 'google',
    label: data.user.email,
    consent,
  };
}

async function connectMicrosoft(consent: AccountConsent): Promise<ConnectedAccount> {
  const discovery = microsoftDiscovery();
  const request = new AuthSession.AuthRequest({
    clientId: accountConfig.microsoftClientId,
    redirectUri: accountConfig.microsoftRedirectUri,
    scopes: microsoftScopes(consent),
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: { prompt: 'select_account' },
  });
  await request.makeAuthUrlAsync(discovery);
  const response = await request.promptAsync(discovery);
  if (response.type !== 'success' || !response.params.code || !request.codeVerifier) {
    throw new Error('Microsoft connection was canceled or could not be completed.');
  }
  const tokens = await AuthSession.exchangeCodeAsync(
    {
      clientId: accountConfig.microsoftClientId,
      redirectUri: accountConfig.microsoftRedirectUri,
      code: response.params.code,
      extraParams: { code_verifier: request.codeVerifier },
    },
    discovery,
  );
  const profileResponse = await accountFetchWithDeadline('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (!profileResponse.ok) throw new Error('Microsoft could not verify the connected account.');
  const profile = (await profileResponse.json()) as {
    id: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  };
  if (!profile.id) throw new Error('Microsoft returned an incomplete account identity.');
  const account: ConnectedAccount = {
    id: `microsoft:${profile.id}`,
    subject: profile.id,
    provider: 'microsoft',
    label: profile.mail || profile.userPrincipalName || profile.displayName || 'Microsoft account',
    consent,
  };
  await writeCredential(account.id, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: (tokens.issuedAt + (tokens.expiresIn ?? 3600)) * 1000,
  });
  return account;
}

export async function connectAccount(
  provider: AccountProvider,
  requestedConsent: AccountConsent,
): Promise<ConnectedAccount> {
  if (Platform.OS === 'web') throw new Error('Connect accounts from the Android or iPhone app.');
  if (provider === 'webdav') throw new Error('Use the WebDAV folder form to connect this storage account.');
  const consent = normalizedConsent(requestedConsent);
  const account =
    provider === 'google' ? await connectGoogle(consent) : await connectMicrosoft(consent);
  await saveAccount(account);
  return account;
}

export async function updateAccountConsent(id: string, requestedConsent: AccountConsent) {
  const account = (await getAccounts()).find((candidate) => candidate.id === id);
  if (!account) throw new Error('The account is no longer connected.');
  const consent = account.provider === 'webdav'
    ? { ledgerStorage: Boolean(requestedConsent.ledgerStorage), calendarRead: false,
        calendarWrite: false, replaceOccurrences: false, importCalendarEdits: false,
        editInvitations: false, editSeries: false, categoryRead: false }
    : normalizedConsent(requestedConsent);
  const needsAdditionalAccess =
    (consent.ledgerStorage && !account.consent.ledgerStorage) ||
    (consent.calendarRead && !account.consent.calendarRead) ||
    (consent.calendarWrite && !account.consent.calendarWrite) ||
    (consent.categoryRead && !account.consent.categoryRead);
  if (needsAdditionalAccess && account.provider !== 'webdav') {
    const reconnected =
      account.provider === 'google'
        ? await connectGoogle(consent)
        : await connectMicrosoft(consent);
    if (reconnected.id !== account.id) {
      throw new Error('Select the same account when changing its permissions.');
    }
  }
  const accounts = await getAccounts();
  await setSetting(
    ACCOUNTS_KEY,
    accounts.map((candidate) => (candidate.id === id ? { ...candidate, consent } : candidate)),
  );
}

export async function disconnectAccount(id: string) {
  const accounts = await getAccounts();
  const account = accounts.find((candidate) => candidate.id === id);
  // Revoke this app's local request authority before waiting for native sign-out or keychain work.
  await setSetting(ACCOUNTS_KEY, accounts.filter((candidate) => candidate.id !== id));
  await SecureStore.deleteItemAsync(await credentialKey(id), secureOptions);
  if (account?.provider === 'google' && accountConfig.distribution !== 'fdroid') {
    try {
      const GoogleSignin = configureGoogle();
      if (GoogleSignin.getCurrentUser()?.user.id === account.subject) await GoogleSignin.signOut();
    } catch {
      // The connection is already removed. A missing native SDK/client configuration must not
      // prevent disconnecting an account after changing distribution builds.
    }
  }
}

async function ensureCurrentAccount(account: ConnectedAccount) {
  const saved = (await getAccounts()).find((candidate) => candidate.id === account.id);
  if (!saved) throw new Error('This account was disconnected.');
  return saved;
}

async function acquireToken(account: ConnectedAccount, forceRefresh: boolean, isCurrent: () => boolean): Promise<string> {
  const requireCurrent = () => { if (!isCurrent()) throw new Error('This account connection request expired. Tap Sync to retry.'); };
  await ensureCurrentAccount(account);
  requireCurrent();
  if (account.provider === 'webdav') throw new Error('WebDAV uses a stored app password, not an OAuth token.');
  if (account.provider === 'google') {
    const GoogleSignin = configureGoogle();
    if (!GoogleSignin.getCurrentUser()) {
      const restored = await GoogleSignin.signInSilently();
      requireCurrent();
      if (restored.type !== 'success') throw new Error('Reconnect your Google account to continue syncing.');
    }
    if (GoogleSignin.getCurrentUser()?.user.id !== account.subject) {
      throw new Error('Reconnect this Google account before syncing. A different Google account is active.');
    }
    if (forceRefresh) {
      const oldTokens = await GoogleSignin.getTokens();
      requireCurrent();
      await GoogleSignin.clearCachedAccessToken(oldTokens.accessToken);
      requireCurrent();
    }
    const tokens = await GoogleSignin.getTokens();
    requireCurrent();
    // Native account selection could have changed while the token promise was resolving.
    if (GoogleSignin.getCurrentUser()?.user.id !== account.subject) {
      throw new Error('The active Google account changed during synchronization.');
    }
    return tokens.accessToken;
  }
  const credential = await readCredential(account.id);
  requireCurrent();
  if (!credential) throw new Error('Reconnect your Microsoft account to continue syncing.');
  if (!forceRefresh && credential.expiresAt > Date.now() + 60_000) return credential.accessToken;
  if (!credential.refreshToken) throw new Error('Reconnect Microsoft to renew access.');
  const tokens = await AuthSession.refreshAsync(
    { clientId: accountConfig.microsoftClientId, refreshToken: credential.refreshToken },
    microsoftDiscovery(),
  );
  requireCurrent();
  await writeCredential(account.id, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? credential.refreshToken,
    expiresAt: (tokens.issuedAt + (tokens.expiresIn ?? 3600)) * 1000,
  });
  await ensureCurrentAccount(account);
  requireCurrent();
  return tokens.accessToken;
}

function tokenFor(account: ConnectedAccount, forceRefresh = false) {
  const running = credentialRefreshes.get(account.id);
  if (running) return running;
  let job: Promise<string>;
  job = accountRequestDeadline((signal) => acquireToken(account, forceRefresh,
    () => !signal.aborted && credentialRefreshes.get(account.id) === job)).finally(() => {
    if (credentialRefreshes.get(account.id) === job) credentialRefreshes.delete(account.id);
  });
  credentialRefreshes.set(account.id, job);
  return job;
}

export function accessToken(account: ConnectedAccount): Promise<string> {
  return tokenFor(account);
}

export async function accountFetch(
  account: ConnectedAccount,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  if (account.provider === 'webdav') throw new Error('Use the folder-scoped WebDAV storage connection.');
  const parsed = new URL(url);
  const allowedHosts =
    account.provider === 'google'
      ? ['www.googleapis.com', 'openidconnect.googleapis.com']
      : ['graph.microsoft.com'];
  if (parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.hostname)) {
    throw new Error('Refused to send account credentials to an unrecognized service.');
  }
  const perform = async (token: string) => {
    const current = await ensureCurrentAccount(account);
    const path = parsed.pathname;
    const isStorageRequest =
      account.provider === 'google'
        ? path.startsWith('/drive/') || path.startsWith('/upload/drive/')
        : /^\/v1\.0\/me\/drive(?:\/|$)/.test(path);
    const isCalendarRequest =
      account.provider === 'google'
        ? path.startsWith('/calendar/')
        : /^\/v1\.0\/me\/(?:calendars?|calendarView|events)(?:\/|$)/.test(path);
    if (isStorageRequest && !current.consent.ledgerStorage) {
      throw new Error('Ledger storage permission is disabled for this account.');
    }
    if (isCalendarRequest) {
      const method = (init.method ?? 'GET').toUpperCase();
      const writes = method !== 'GET' && method !== 'HEAD';
      if (writes ? !current.consent.calendarWrite : !current.consent.calendarRead) {
        throw new Error('Calendar permission is disabled for this account.');
      }
    }
    const categoryMetadataRequest = account.provider === 'microsoft'
      ? /^\/v1\.0\/me\/outlook\/masterCategories(?:\/|$)/.test(path)
      : /^\/calendar\/v3\/calendars\/[^/]+$/.test(path) &&
        parsed.searchParams.get('eventLabelVersion') === '1';
    if (categoryMetadataRequest && !current.consent.categoryRead) {
      throw new Error('Calendar category access is disabled for this account.');
    }
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return accountFetchWithDeadline(url, { ...init, headers });
  };
  const response = await perform(await tokenFor(account));
  if (response.status !== 401) return response;
  return perform(await tokenFor(account, true));
}

export async function connectWebDavAccount(input: {
  url: string;
  username: string;
  password: string;
  label?: string;
}): Promise<ConnectedAccount> {
  if (Platform.OS === 'web') throw new Error('Connect WebDAV from the Android or iPhone app.');
  const folder = normalizeWebDavFolder(input.url);
  const credentials = { username: input.username.trim(), password: input.password };
  await probeWebDavFolder(folder, credentials);
  const subject = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256, `${folder}\n${credentials.username}`,
  );
  const account: ConnectedAccount = {
    id: `webdav:${subject}`,
    provider: 'webdav',
    subject,
    label: input.label?.trim() || `${credentials.username} · ${new URL(folder).hostname}`,
    storageUrl: folder,
    storageUser: credentials.username,
    consent: { ledgerStorage: true, calendarRead: false, calendarWrite: false,
      replaceOccurrences: false, importCalendarEdits: false,
      editInvitations: false, editSeries: false, categoryRead: false },
  };
  await SecureStore.setItemAsync(await credentialKey(account.id), JSON.stringify(credentials), secureOptions);
  await saveAccount(account);
  return account;
}

export async function getWebDavCredentials(account: ConnectedAccount): Promise<WebDavCredentials> {
  const current = await ensureCurrentAccount(account);
  if (current.provider !== 'webdav' || !current.consent.ledgerStorage) {
    throw new Error('WebDAV ledger storage permission is disabled.');
  }
  const saved = await SecureStore.getItemAsync(await credentialKey(account.id), secureOptions);
  if (!saved) throw new Error('Reconnect WebDAV to save its app password on this phone.');
  const credentials = JSON.parse(saved) as WebDavCredentials;
  if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string') {
    throw new Error('The WebDAV credential is incomplete. Reconnect this account.');
  }
  return credentials;
}
