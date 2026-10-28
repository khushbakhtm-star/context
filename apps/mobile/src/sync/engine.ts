import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import {
  acknowledgeInlineMinuteLink, acknowledgeUploaded, deferInlineMinuteLink, getActivityTitleForEntries, getDayEntries, getDaySegments, getDocumentsForUpload, getEntriesBetween,
  getEntriesForBlock, getPendingInlineMinuteLinks, getSetting, getSpreadsheetCells, getSyncBindingsForBlock, getSyncDocuments, hasSeenSyncFile,
  markSyncFileSeen, mergeSyncDocuments, promoteInlineMinuteLinkForAccountReview, putSyncDocument, remapActivityProjections, replaceProjectedMinutes, recolorExpectedMinuteEntries, setSetting,
  type PendingInlineMinuteLink,
} from '../data/database';
import { categoryById } from '../theme';
import { CATEGORIES } from '../theme';
import { categoryProviderColor, ensureSourceColorCategory, listCategories } from '../services/categories';
import type { ActivitySegment, MinuteEntry, PlannedEvent } from '../types';
import { addDays, dateKey, localDateAtMinute, minuteIndexForDate, minuteLabel, parseDateKey } from '../utils/time';
import { getAccounts } from './accounts';
import { CELL_FORMAT_PREFIX, cellEventLabel, formatFromDocument, isActivityGroupId } from '../utils/cell-format';
import { matchActivityTranslation } from '../utils/activity-translation';
import { calendarColor, sourceEventColor } from '../utils/calendar-cell-color';
import { formatCalendarMinuteLog, parseCompactCalendarMinuteLog } from '../utils/calendar-minute-log';
import { makeCalendarDescription, makeCompactCalendarDescription, readCalendarDescription } from '../utils/calendar-description';
import { ACCOUNT_PLAN_READ_LEASE_MS, accountPlanReadDeadline, accountPlanScope, accountPlanScopeIdentity,
  decodeAccountPlanCache, encodeAccountPlanCache, type AccountPlanScope } from '../utils/account-plan-cache';
import { clearLedgerKeyCache, decryptBatch, encryptBatch, hashValue, parseProjectedMinutes } from './codec';
import { createCalendarAdapter, createCalendarMetadataReadCache, type CalendarMetadataReadCache } from './providers';
import { createLedgerStorage } from './storage';
import { zonedMinuteToInstant } from './time';
import { canCreateAccountProjection } from '../utils/calendar-projection-authority';
import type {
  AccountSyncStatus, CalendarEventWrite, ConnectedAccount, Projection,
  RemoteCalendarEvent, SyncBatch,
} from './types';

const PASSPHRASE_KEY = 'context.ledger.passphrase.v1';
export type AccountPreferences = { selectedCalendarIds: string[]; writeCalendarId: string | null };
let status: AccountSyncStatus = { running: false, lastSyncedAt: null, message: 'Ready to connect', conflicts: 0,
  outcome: 'idle', phase: 'idle', cycleId: 0, cycleComplete: true, nativeWriteReady: false, nativePendingCount: 0 };
let syncCycleId = 0;
const listeners = new Set<(next: AccountSyncStatus) => void>();
let activeJob: Promise<AccountSyncStatus> | null = null;
let rerunRequested = false;
let requestedSyncTimer: ReturnType<typeof setTimeout> | null = null;
let projectionLinkChain: Promise<void> = Promise.resolve();
let colorImportObserver: { canImport: (entries: readonly MinuteEntry[]) => boolean;
  onImported?: (entries: readonly MinuteEntry[], replaceText?: boolean) => void } | null = null;
let colorReconciliationChain: Promise<void> = Promise.resolve();
const accountColorReads = new Map<string, Promise<string[]>>();
const coreProjectionEpochs = new Map<string, number>();
const activeCoreProjections = new Set<string>();

/** The app installs a raw-draft guard; source readers themselves never mutate the ledger. */
export function configureCalendarColorImports(observer: typeof colorImportObserver) { colorImportObserver = observer; }
export function requireCalendarColorImportCurrent(entries: readonly MinuteEntry[]) {
  if (colorImportObserver && !colorImportObserver.canImport(entries)) {
    throw new Error('A linked minute is being edited. Finish that edit before importing its calendar color.');
  }
}
export function notifyCalendarColorImported(entries: readonly MinuteEntry[], replaceText = false) {
  colorImportObserver?.onImported?.(entries, replaceText);
}
export function localActivityColorHash(entries: readonly MinuteEntry[]) {
  return hashValue([...new Set(entries.map((entry) => `${entry.categoryId}:${categoryById(entry.categoryId).color.toUpperCase()}`))].sort());
}
function serializeColorReconciliation<T>(work: () => Promise<T>) {
  const job = colorReconciliationChain.then(work, work);
  colorReconciliationChain = job.then(() => undefined, () => undefined);
  return job;
}

export function getAccountSyncStatus() { return status; }
export function subscribeAccountSync(listener: (next: AccountSyncStatus) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(next: Partial<AccountSyncStatus>) {
  status = { ...status, ...next };
  for (const listener of listeners) listener(status);
}
export async function hasLedgerPassphrase() {
  return Boolean(await SecureStore.getItemAsync(PASSPHRASE_KEY));
}
export async function setLedgerPassphrase(passphrase: string) {
  if (passphrase.length < 12 || passphrase.length > 1024) {
    throw new Error('Use the same passphrase of at least 12 characters on both phones.');
  }
  await SecureStore.setItemAsync(PASSPHRASE_KEY, passphrase, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
export async function clearSavedPassphrase() {
  clearLedgerKeyCache();
  await SecureStore.deleteItemAsync(PASSPHRASE_KEY);
}
export function getAccountPreferences(accountId: string) {
  return getSetting<AccountPreferences>(`account.calendars.${accountId}`,
    { selectedCalendarIds: [], writeCalendarId: null });
}
export function setAccountPreferences(accountId: string, preferences: AccountPreferences) {
  return setSetting(`account.calendars.${accountId}`, preferences);
}

function sanitized<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
function projectionIsValid(value: Record<string, unknown>): boolean {
  return typeof value.id === 'string' && typeof value.accountId === 'string' &&
    typeof value.calendarId === 'string' && typeof value.blockId === 'string' &&
    typeof value.dateKey === 'string' && typeof value.startMinute === 'number' &&
    typeof value.endMinute === 'number' && value.startMinute >= 0 && value.endMinute < 1440 &&
    (value.endMinute >= value.startMinute || (typeof value.endDateKey === 'string' && value.endDateKey > String(value.dateKey))) &&
    ['pending', 'synced', 'conflict', 'deleted'].includes(String(value.state));
}
export async function listProjections(): Promise<Projection[]> {
  const documents = await getSyncDocuments('projection:');
  return documents.flatMap((document) => {
    if (!document.value) return [];
    if (!projectionIsValid(document.value)) throw new Error('A synchronized calendar link is invalid.');
    return [document.value as unknown as Projection];
  });
}
async function saveProjection(projection: Projection) {
  await putSyncDocument(`projection:${projection.id}`, sanitized(projection));
}

type StoragePassBudget = { downloads: number; uploads: number; verifiedPassphrase: boolean };
const STORAGE_DOWNLOADS_PER_PASS = 8;
const STORAGE_UPLOADS_PER_PASS = 4;
class StorageDownloadPending extends Error {
  constructor() { super('Private ledger download is continuing. Calendar changes will resume after its remaining updates are checked.'); }
}

async function storageSync(account: ConnectedAccount, passphrase: string, budget: StoragePassBudget) {
  const storage = createLedgerStorage(account);
  const storageKey = account.id;
  // Download first: a wrong passphrase must fail before any new encrypted files are uploaded.
  publish({ phase: 'checking-storage', progress: undefined, message: 'Checking encrypted ledger storage…', cycleComplete: false });
  const files = await storage.listFiles();
  let checkedFiles = 0;
  for (const file of files) {
    const seen = await hasSeenSyncFile(storageKey, file.id);
    if (seen && budget.verifiedPassphrase) { checkedFiles++; continue; }
    if (budget.downloads >= STORAGE_DOWNLOADS_PER_PASS) throw new StorageDownloadPending();
    budget.downloads++;
    publish({ phase: 'downloading', progress: { completed: checkedFiles, total: files.length },
      message: 'Checking downloaded ledger updates…', cycleComplete: false });
    let batch: SyncBatch;
    try { batch = await decryptBatch(await storage.readFile(file), passphrase); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('Cannot unlock')) {
        await clearSavedPassphrase();
      }
      throw error;
    }
    budget.verifiedPassphrase = true;
    checkedFiles++;
    if (seen) continue;
    await mergeSyncDocuments(batch.documents);
    await markSyncFileSeen(storageKey, file.id);
  }

  type Pending = { name: string; ciphertext: string; batch: SyncBatch };
  const pendingKey = `account.pendingBatch.${account.id}`;
  // Bound work per foreground pass; later passes continue without dropping unacknowledged rows.
  while (budget.uploads < STORAGE_UPLOADS_PER_PASS) {
    let pending = await getSetting<Pending | null>(pendingKey, null);
    if (!pending) {
      const documents = await getDocumentsForUpload(storageKey, 500);
      if (!documents.length) break;
      // Drive multipart uploads have a small-file limit; ciphertext uses hexadecimal encoding.
      // Keep plaintext below 2 MiB and let larger journals continue in subsequent immutable files.
      while (documents.length > 1 && new TextEncoder().encode(JSON.stringify(documents)).byteLength > 2 * 1024 * 1024) {
        documents.pop();
      }
      const batch: SyncBatch = { version: 1, id: Crypto.randomUUID(), documents };
      publish({ phase: 'uploading', progress: { completed: budget.uploads },
        message: 'Preparing encrypted ledger updates…', cycleComplete: false });
      pending = { name: `context-${batch.id}.json`, batch,
        ciphertext: await encryptBatch(batch, passphrase) };
      await setSetting(pendingKey, pending);
    }
    publish({ phase: 'uploading', progress: { completed: budget.uploads },
      message: 'Uploading encrypted ledger updates…', cycleComplete: false });
    await decryptBatch(pending.ciphertext, passphrase);
    const uploaded = await storage.writeFile(pending.name, pending.ciphertext);
    if (uploaded !== undefined && (!uploaded || typeof uploaded.id !== 'string' || !uploaded.id.length ||
        uploaded.id.length > 2_048 || /[\u0000-\u001F\u007F]/.test(uploaded.id) || uploaded.name !== pending.name)) {
      throw new Error('The storage service returned an unexpected uploaded file identity.');
    }
    await acknowledgeUploaded(storageKey, pending.batch.documents);
    // Only an exact transport receipt plus the durable local revision
    // acknowledgement makes this an already-checked immutable file. Peers'
    // files and transports without receipts still follow normal download.
    if (uploaded) await markSyncFileSeen(storageKey, uploaded.id);
    await setSetting(pendingKey, null);
    budget.uploads++;
  }
  return !(await getSetting<Pending | null>(pendingKey, null)) && !(await getDocumentsForUpload(storageKey, 1)).length;
}

export type AccountPlansResult = { plans: PlannedEvent[];
  failures: { accountId: string; code: 'unavailable' | 'timeout' }[]; fromCache: boolean };
type AccountPlanRead = { startedAt: number; job: Promise<PlannedEvent[] | null> };
const accountPlanReads = new Map<string, AccountPlanRead>();
const accountPlanCacheKey = (scope: AccountPlanScope) => `calendar.plan-cache.v1.${hashValue(accountPlanScopeIdentity(scope))}`;

async function currentAccountPlanScopes(value: string): Promise<{ account: ConnectedAccount; scope: AccountPlanScope }[]> {
  const scopes: { account: ConnectedAccount; scope: AccountPlanScope }[] = [];
  for (const account of await getAccounts()) {
    if (!account.consent.calendarRead || (account.provider !== 'google' && account.provider !== 'microsoft')) continue;
    const preferences = await getAccountPreferences(account.id);
    const scope = accountPlanScope(account, value, preferences.selectedCalendarIds);
    if (scope) scopes.push({ account, scope });
  }
  return scopes;
}

async function accountPlanScopeIsCurrent(scope: AccountPlanScope): Promise<boolean> {
  return (await currentAccountPlanScopes(scope.dateKey)).some((item) =>
    accountPlanScopeIdentity(item.scope) === accountPlanScopeIdentity(scope));
}

async function readCachedAccountScope(scope: AccountPlanScope): Promise<PlannedEvent[] | null> {
  const saved = await getSetting<unknown>(accountPlanCacheKey(scope), null);
  if (!await accountPlanScopeIsCurrent(scope)) return null;
  return decodeAccountPlanCache(saved, scope);
}

/** Strictly local, permission-scoped display cache; no adapter/token/provider calls. */
export async function loadCachedAccountPlans(value: string): Promise<PlannedEvent[]> {
  const cached = await Promise.all((await currentAccountPlanScopes(value)).map(async ({ scope }) =>
    ({ scope, plans: await readCachedAccountScope(scope) })));
  const current = new Set((await currentAccountPlanScopes(value)).map(({ scope }) => accountPlanScopeIdentity(scope)));
  return cached.flatMap(({ scope, plans }) => current.has(accountPlanScopeIdentity(scope)) ? plans ?? [] : []);
}

function loadRemoteAccountScope(account: ConnectedAccount, scope: AccountPlanScope): Promise<PlannedEvent[] | null> {
  const key = accountPlanScopeIdentity(scope);
  const existing = accountPlanReads.get(key);
  const age = existing ? Date.now() - existing.startedAt : 0;
  if (existing && age >= 0 && age < ACCOUNT_PLAN_READ_LEASE_MS) return existing.job;
  const record: AccountPlanRead = { startedAt: Date.now(), job: Promise.resolve(null) };
  accountPlanReads.set(key, record);
  const requireCurrentRead = () => {
    if (accountPlanReads.get(key) !== record) throw new Error('ACCOUNT_PLAN_READ_SUPERSEDED');
  };
  const job = (async () => {
    if (!await accountPlanScopeIsCurrent(scope)) return null;
    requireCurrentRead();
    const adapter = createCalendarAdapter(account);
    const calendars = await adapter.listCalendars();
    requireCurrentRead();
    const plans: PlannedEvent[] = [];
    for (const calendarId of scope.calendarIds) {
      if (!await accountPlanScopeIsCurrent(scope)) return null;
      requireCurrentRead();
      const calendar = calendars.find((item) => item.id === calendarId);
      if (!calendar) continue;
      const events = await adapter.listEvents(calendarId, scope.start, scope.end);
      requireCurrentRead();
      for (const event of events) {
        if (event.deleted || event.calendarId !== calendarId) continue;
        const category = categoryForEvent(account.id, event);
        plans.push({ id: `${account.id}:${event.id}`, calendarId, title: event.title,
          notes: event.description, color: sourceEventColor(calendarColor(event.displayColor) ??
            calendarColor(category?.providerOriginalColor) ?? calendarColor(category?.color), calendar.color),
          sourceProvider: scope.provider, categoryId: category?.id ?? event.categoryId,
          startDate: new Date(event.start), endDate: new Date(event.end), allDay: event.allDay,
          accountEvent: { accountId: account.id, event } });
      }
    }
    if (!await accountPlanScopeIsCurrent(scope)) return null;
    requireCurrentRead();
    // Cache only a complete successful selected-calendar scope. A failed refresh
    // never overwrites its last good snapshot or creates ledger/outbox documents.
    const snapshot = encodeAccountPlanCache(scope, plans);
    if (snapshot) await setSetting(accountPlanCacheKey(scope), snapshot);
    if (!await accountPlanScopeIsCurrent(scope)) return null;
    requireCurrentRead();
    return plans;
  })();
  record.job = job;
  const finish = () => { if (accountPlanReads.get(key) === record) accountPlanReads.delete(key); };
  void job.then(finish, finish);
  return job;
}

/** Remote refresh has a caller deadline and reuses in-flight account/day/scope
 * work even after a timeout. Failures return only that scope's last good cache. */
export async function loadAccountPlansResult(value: string): Promise<AccountPlansResult> {
  const results = await Promise.all((await currentAccountPlanScopes(value)).map(async ({ account, scope }) => {
    try { return { scope, plans: await accountPlanReadDeadline(loadRemoteAccountScope(account, scope)),
      failure: null, fromCache: false }; }
    catch (error) {
      return { scope, plans: await readCachedAccountScope(scope), fromCache: true,
        failure: { accountId: account.id, code: error instanceof Error && error.message === 'ACCOUNT_PLAN_READ_TIMEOUT'
          ? 'timeout' as const : 'unavailable' as const } };
    }
  }));
  const current = new Set((await currentAccountPlanScopes(value)).map(({ scope }) => accountPlanScopeIdentity(scope)));
  const active = results.filter(({ scope }) => current.has(accountPlanScopeIdentity(scope)));
  return { plans: active.flatMap(({ plans }) => plans ?? []),
    failures: active.flatMap(({ failure }) => failure ? [failure] : []),
    fromCache: active.some((result) => result.fromCache && result.plans !== null) };
}

/** Compatibility for existing callers; source reads remain read-only. */
export async function loadAccountPlans(value: string): Promise<PlannedEvent[]> {
  const result = await loadAccountPlansResult(value);
  // Strict callers such as Print must not silently treat an offline cache as a
  // complete current source read. Screens explicitly consume the result API.
  if (result.failures.length) throw new Error('Some account calendar plans could not load. Retry before continuing.');
  return result.plans;
}

function categoryForEvent(accountId: string, event: RemoteCalendarEvent) {
  return CATEGORIES.find((category) => category.accountId === accountId &&
    ((event.googleEventLabelId && category.providerLabelId === event.googleEventLabelId && category.calendarId === event.calendarId) ||
      (event.googleColorId && category.providerColorId === event.googleColorId) ||
      (category.providerCategoryName && event.microsoftCategories?.includes(category.providerCategoryName))));
}

type CalendarSyncReads = {
  metadata: CalendarMetadataReadCache;
  defaultColors: Map<string, Promise<Map<string, string>>>;
};

async function remoteActivityColor(account: ConnectedAccount, event: RemoteCalendarEvent, reads?: CalendarSyncReads) {
  const direct = calendarColor(event.displayColor) ?? calendarColor(categoryForEvent(account.id, event)?.providerOriginalColor);
  if (direct) return direct.toUpperCase();
  // An unresolved explicit label must never be mistaken for the calendar default.
  if (event.googleColorId || event.googleEventLabelId || event.microsoftCategories?.length) return undefined;
  if (!reads) {
    const calendar = (await createCalendarAdapter(account).listCalendars()).find((item) => item.id === event.calendarId);
    return calendarColor(calendar?.providedColor)?.toUpperCase();
  }
  // A pass may inspect many events inheriting the same calendar color. Share
  // only display metadata; this snapshot never supplies write authority or an
  // event version. Fresh account checks around each event remain below.
  const scope = hashValue({ id: account.id, provider: account.provider, subject: account.subject,
    calendarRead: account.consent.calendarRead, categoryRead: account.consent.categoryRead });
  let pending = reads.defaultColors.get(scope);
  if (!pending) {
    pending = createCalendarAdapter(account, reads.metadata).listCalendars().then((calendars) => {
      const colors = new Map<string, string>();
      for (const calendar of calendars) {
        const color = calendarColor(calendar.providedColor)?.toUpperCase();
        if (color) colors.set(calendar.id, color);
      }
      return colors;
    });
    if (reads.defaultColors.size >= 128) reads.defaultColors.delete(reads.defaultColors.keys().next().value!);
    reads.defaultColors.set(scope, pending);
    const started = pending;
    void pending.catch(() => { if (reads.defaultColors.get(scope) === started) reads.defaultColors.delete(scope); });
  }
  return (await pending).get(event.calendarId);
}

function eventContentHash(event: RemoteCalendarEvent) {
  const { googleColorId: _color, googleEventLabelId: _label, microsoftCategories: _categories,
    displayColor: _display, ...content } = event;
  // Provider version/HTML and read-only display fields are not local minute content.
  const { version: _version, bodyHtml: _html, ...meaningful } = content;
  return hashValue(meaningful);
}
const accountColorReceiptKey = (projection: Projection) => `calendar.color-receipt.account.${encodeURIComponent(projection.id)}`;
type ColorReceipt = { version: 1; calendarId: string; eventId: string; remoteColor: string; localColorHash: string };

async function importAccountColorOnly(account: ConnectedAccount, projection: Projection, event: RemoteCalendarEvent,
  segment: ActivitySegment, resolved?: { color: string | undefined; skipDisplayBootstrap?: boolean }): Promise<boolean> {
  if (!projection.baseEvent || !projection.eventId || event.id !== projection.eventId || event.calendarId !== projection.calendarId ||
      event.deleted || event.allDay || eventContentHash(event) !== eventContentHash(projection.baseEvent)) return false;
  const color = resolved ? calendarColor(resolved.color)?.toUpperCase() : await remoteActivityColor(account, event);
  if (!color) return false;
  const receiptKey = accountColorReceiptKey(projection);
  const receipt = await getSetting<ColorReceipt | null>(receiptKey, null);
  if (receipt && (receipt.version !== 1 || receipt.calendarId !== event.calendarId || receipt.eventId !== event.id ||
      !calendarColor(receipt.remoteColor) || !/^[a-f0-9]{64}$/.test(receipt.localColorHash))) {
    throw new Error('A linked calendar color receipt needs review before synchronization.');
  }
  const baseColor = receipt?.remoteColor ?? calendarColor(projection.baseEvent.displayColor)?.toUpperCase();
  const identitiesChanged = hashValue([event.googleColorId ?? null, event.googleEventLabelId ?? null, event.microsoftCategories ?? []]) !==
    hashValue([projection.baseEvent.googleColorId ?? null, projection.baseEvent.googleEventLabelId ?? null, projection.baseEvent.microsoftCategories ?? []]);
  const changed = identitiesChanged || Boolean(baseColor && color !== baseColor);
  if (!changed) {
    if (!receipt && localProjectionUnchanged(projection, segment)) {
      await setSetting(receiptKey, { version: 1, calendarId: event.calendarId, eventId: event.id,
        remoteColor: color, localColorHash: localActivityColorHash(segment.entries) } satisfies ColorReceipt);
      if (!projection.baseEvent.displayColor && !resolved?.skipDisplayBootstrap) {
        await saveProjection({ ...projection, baseEvent: { ...projection.baseEvent, displayColor: color } });
      }
    }
    return false;
  }
  if (!account.consent.importCalendarEdits) throw new Error('Allow calendar edit import before importing a calendar color.');
  const localHash = localActivityColorHash(segment.entries);
  const localChanged = receipt ? receipt.localColorHash !== localHash :
    !localProjectionUnchanged(projection, segment) &&
    segment.entries.some((entry) => entry.categoryId !== projection.baseEvent!.categoryId) &&
    !(baseColor && segment.entries.every((entry) => categoryById(entry.categoryId).color.toUpperCase() === baseColor));
  const sameColor = segment.entries.every((entry) => categoryById(entry.categoryId).color.toUpperCase() === color);
  if (localChanged && !sameColor) {
    await saveProjection({ ...projection, state: 'conflict', conflict: 'The activity color changed in Context and the calendar. Choose the version to keep.' });
    throw new Error('The activity color changed in Context and the calendar. Review both colors before synchronizing.');
  }
  const category = await ensureSourceColorCategory({ color, name: event.title, provider: account.provider === 'google' ? 'google' : 'microsoft',
    accountId: account.id, calendarId: event.calendarId, preferredCategoryId: categoryForEvent(account.id, event)?.id });
  const nextEntries = segment.entries.map((entry) => ({ ...entry, categoryId: category.id }));
  const latestAccount = (await getAccounts()).find((item) => item.id === account.id && item.subject === account.subject);
  if (!latestAccount?.consent.calendarRead || !latestAccount.consent.importCalendarEdits) {
    throw new Error('Calendar color import permission changed. Refresh the account connection.');
  }
  const guard = () => requireCalendarColorImportCurrent(segment.entries);
  guard();
  await recolorExpectedMinuteEntries(segment.entries, category.id, { key: receiptKey, value: {
    version: 1, calendarId: event.calendarId, eventId: event.id, remoteColor: color,
    localColorHash: localActivityColorHash(nextEntries) } satisfies ColorReceipt }, guard);
  const localContentPending = !localProjectionUnchanged(projection, segment);
  const next = { ...projection, baseEvent: { ...event, displayColor: color },
    state: localContentPending ? 'pending' as const : 'synced' as const, conflict: undefined,
    baseColorSelection: { categoryId: category.id, color: category.color.toUpperCase() } };
  next.baseLocalHash = localContentPending ? null : localWriteHash(buildWrite(next, { ...segment, categoryId: category.id, entries: nextEntries }));
  await saveProjection(next);
  notifyCalendarColorImported(nextEntries);
  return true;
}

type AccountColorScope = { account: ConnectedAccount; identity: string; selectedCalendarIds: string[] };
async function accountColorScopes(): Promise<AccountColorScope[]> {
  const scopes: AccountColorScope[] = [];
  for (const account of await getAccounts()) {
    if (!account.consent.calendarRead || !account.consent.importCalendarEdits ||
        (account.provider !== 'google' && account.provider !== 'microsoft')) continue;
    const selectedCalendarIds = [...new Set((await getAccountPreferences(account.id)).selectedCalendarIds)].sort();
    if (!selectedCalendarIds.length) continue;
    scopes.push({ account, selectedCalendarIds, identity: hashValue({ id: account.id, subject: account.subject,
      provider: account.provider, calendarRead: account.consent.calendarRead,
      importCalendarEdits: account.consent.importCalendarEdits, selectedCalendarIds }) });
  }
  return scopes.sort((left, right) => left.account.id.localeCompare(right.account.id));
}

/** Explicit foreground reconciliation only: network reads never hold the commit
 * queue, and identical foreground bursts share only their in-flight result. */
export async function reconcileLinkedAccountColors(dates: readonly string[]): Promise<string[]> {
  const normalized = [...new Set(dates)].sort();
  if (normalized.length > 366 || normalized.some((day) => dateKey(parseDateKey(day)) !== day)) {
    throw new Error('Choose at most one year of valid dates when refreshing linked colors.');
  }
  const scopes = await accountColorScopes();
  const key = hashValue({ dates: normalized, scopes: scopes.map((scope) => scope.identity) });
  const pending = accountColorReads.get(key);
  if (pending) return pending;
  const job = (async () => {
    const affected = new Set<string>();
    await listCategories();
    for (const projection of await listProjections()) {
      if (!projection.eventId || projection.state === 'deleted' || projection.state === 'conflict' ||
          !normalized.some((day) => day >= projection.dateKey && day <= (projection.endDateKey ?? projection.dateKey))) continue;
      const scope = scopes.find((item) => item.account.id === projection.accountId && item.selectedCalendarIds.includes(projection.calendarId));
      if (!scope) continue;
      const segment = await getProjectionSegment(projection);
      if (!segment) continue;
      const projectionHash = hashValue(projection); const entriesHash = hashValue(segment.entries);
      const epoch = coreProjectionEpochs.get(projection.id) ?? 0;
      const event = await createCalendarAdapter(scope.account).getEvent(projection.calendarId, projection.eventId);
      const color = event ? await remoteActivityColor(scope.account, event) : undefined;
      if (!event) continue;
      await serializeColorReconciliation(async () => {
        if (activeCoreProjections.has(projection.id) || (coreProjectionEpochs.get(projection.id) ?? 0) !== epoch) return;
        const currentScope = (await accountColorScopes()).find((item) => item.account.id === projection.accountId);
        if (!currentScope || currentScope.identity !== scope.identity) return;
        const current = (await listProjections()).find((item) => item.id === projection.id);
        if (!current || hashValue(current) !== projectionHash) return;
        const local = await getProjectionSegment(current);
        if (!local || hashValue(local.entries) !== entriesHash) return;
        if (await importAccountColorOnly(currentScope.account, current, event, local, { color })) {
          for (const entry of local.entries) affected.add(entry.dateKey);
        }
      });
    }
    return [...affected];
  })();
  accountColorReads.set(key, job);
  try { return await job; }
  finally { if (accountColorReads.get(key) === job) accountColorReads.delete(key); }
}

/** Called after a local range save. Provider IDs come directly from the selected occurrence. */
export class NativeAccountLinkReviewError extends Error {
  readonly blockIds: string[];
  constructor(blockIds: readonly string[] = []) {
    super('A phone-calendar activity needs review before account writeback. Open its Event details to approve the account event, or clear the account Actuals destination to keep its phone-calendar link.');
    this.name = 'NativeAccountLinkReviewError';
    this.blockIds = [...new Set(blockIds)];
  }
}

export function linkActualsToAccounts(
  dates: string[], sourcePlan?: PlannedEvent | null,
  edited?: { dateKey: string; minuteIndex: number },
  sourceScope: 'occurrence' | 'series' = 'occurrence',
) {
  // Projection identity is local durable state. Concurrent commit/foreground
  // link passes must not create competing owners from the same stale snapshot.
  const job = projectionLinkChain.then(() => linkActuals(dates, sourcePlan, edited, sourceScope));
  projectionLinkChain = job.then(() => undefined, () => undefined);
  return job;
}

async function linkActuals(
  dates: string[], sourcePlan?: PlannedEvent | null,
  edited?: { dateKey: string; minuteIndex: number },
  sourceScope: 'occurrence' | 'series' = 'occurrence',
) {
  const accounts = await getAccounts();
  const projections = await listProjections();
  const editedBlock = edited
    ? (await getDayEntries(edited.dateKey)).find((entry) => entry.minuteIndex === edited.minuteIndex)?.blockId
    : undefined;
  const linkedBlocks = new Set(projections.filter((p) => dates.some((day) =>
    p.dateKey <= day && (p.endDateKey ?? p.dateKey) >= day)).map((p) => p.blockId));
  if (editedBlock) linkedBlocks.add(editedBlock);
  await reanchorMovedActivities(projections, linkedBlocks);
  const claimedGroups = new Set<string>();
  // A minute interruption can split an old block, while filling a gap can merge its children.
  // Keep the original occurrence on the first surviving group and retire duplicate child events.
  for (const projection of [...projections].sort((a, b) => Number(Boolean(b.sourceEventId)) - Number(Boolean(a.sourceEventId)))) {
    if (projection.state === 'deleted' || projection.state === 'conflict' || !linkedBlocks.has(projection.blockId)) continue;
    const group = await getProjectionSegment(projection);
    if (!group) continue;
    const first = group.entries[0]!;
    const last = group.entries.at(-1)!;
    const groupKey = `${projection.blockId}:${first.dateKey}:${first.minuteIndex}`;
    if (claimedGroups.has(groupKey)) {
      projection.blockId = `retired:${projection.id}`;
      projection.state = 'pending';
      await saveProjection(projection);
      continue;
    }
    claimedGroups.add(groupKey);
    if (projection.dateKey !== first.dateKey || projection.startMinute !== first.minuteIndex ||
      (projection.endDateKey ?? projection.dateKey) !== last.dateKey || projection.endMinute !== last.minuteIndex) {
      Object.assign(projection, { dateKey: first.dateKey, startMinute: first.minuteIndex,
        endDateKey: last.dateKey, endMinute: last.minuteIndex, state: 'pending' });
      await saveProjection(projection);
    }
  }
  let sourceUsed = false;
  const nativeLinksNeedingReview = new Set<string>();
  for (const value of dates) {
    for (const segment of await getDaySegments(value)) {
      if (!segment.activityTitle && !projections.some((item) => item.state !== 'deleted' && item.blockId === segment.blockId)) continue;
      if (edited && !linkedBlocks.has(segment.blockId)) continue;
      if (projections.some((p) => p.state === 'conflict' && p.blockId === segment.blockId)) continue;
      const intersectsSource = sourcePlan &&
        localDateAtMinute(value, segment.startMinute) < sourcePlan.endDate &&
        localDateAtMinute(value, segment.endMinute + 1) > sourcePlan.startDate &&
        (!edited || (edited.dateKey === value && segment.startMinute <= edited.minuteIndex &&
          segment.endMinute >= edited.minuteIndex));
      const reference = !sourceUsed && intersectsSource && (!editedBlock || segment.blockId === editedBlock)
        ? sourcePlan?.accountEvent : undefined;
      let sourceAccount = reference && accounts.find((a) => a.id === reference.accountId &&
        a.consent.calendarWrite && a.consent.replaceOccurrences);
      if (sourceAccount && reference) {
        const owner = projections.find((p) => p.state !== 'deleted' &&
          p.accountId === sourceAccount!.id && p.calendarId === reference.event.calendarId &&
          p.sourceEventId === reference.event.id);
        if (owner && owner.blockId !== segment.blockId && await getProjectionSegment(owner)) {
          sourceAccount = undefined;
        }
      }
      const existing = projections.filter((p) => p.state !== 'deleted' && p.blockId === segment.blockId &&
        p.dateKey <= value && (p.endDateKey ?? p.dateKey) >= value &&
        (p.dateKey !== value || p.startMinute <= segment.endMinute) &&
        ((p.endDateKey ?? p.dateKey) !== value || p.endMinute >= segment.startMinute));
      const copiesToRetire: Projection[] = [];
      if (existing.length) {
        // Inline autosave may already have created a separate actual. A later explicit
        // replacement must attach this block to the chosen original instead of silently
        // ignoring that choice. Retire only our unbound copies in the same authorized
        // account; normal reconciliation preserves changed copies as conflicts.
        const canReplaceCopy = sourceAccount && reference && !reference.event.allDay &&
          !reference.event.isSeriesMaster && !reference.event.projectionId && reference.event.canEdit !== false &&
          (!reference.event.isInvitation || sourceAccount.consent.editInvitations) &&
          (sourceScope !== 'series' || sourceAccount.consent.editSeries) &&
          existing.every((p) => !p.sourceEventId && p.state !== 'conflict' &&
            p.accountId === sourceAccount.id && p.eventId !== reference.event.id);
        if (!canReplaceCopy) continue;
        for (const copy of existing) {
          copy.blockId = `retired:${copy.id}`;
          copy.state = 'pending';
          copiesToRetire.push(copy);
        }
      }
      let owner = sourceAccount;
      let calendarId = sourceAccount ? reference!.event.calendarId : null;
      if (!owner) {
        const parent = projections.find((p) => p.state !== 'deleted' &&
          (p.blockId === segment.blockId || (p.baseEvent &&
            new Date(p.baseEvent.start) < localDateAtMinute(value, segment.endMinute + 1) &&
            new Date(p.baseEvent.end) > localDateAtMinute(value, segment.startMinute))) &&
          accounts.some((a) => a.id === p.accountId && a.consent.calendarWrite));
        if (parent) {
          owner = accounts.find((a) => a.id === parent.accountId);
          calendarId = parent.calendarId;
        }
      }
      if (!owner) {
        for (const account of accounts) {
          if (!account.consent.calendarWrite) continue;
          const preferences = await getAccountPreferences(account.id);
          if (preferences.writeCalendarId) { owner = account; calendarId = preferences.writeCalendarId; break; }
        }
      }
      if (!owner || !calendarId) continue;
      const event = sourceAccount ? reference!.event : null;
      if (event?.allDay || event?.isSeriesMaster) continue;
      const hasAccountProjection = projections.some((item) => item.state !== 'deleted' && item.blockId === segment.blockId);
      const hasNativeBinding = !hasAccountProjection && (await getSyncBindingsForBlock(segment.blockId)).length > 0;
      if (!canCreateAccountProjection({ hasNativeBinding, hasAccountProjection,
        sourceAccountId: reference?.accountId, sourceAccount, sourceEvent: event, sourceScope })) {
        nativeLinksNeedingReview.add(segment.blockId);
        continue;
      }
      const projection: Projection = { id: hashValue(event
        ? { account: owner.id, calendarId, sourceEventId: event.id }
        : { account: owner.id, calendarId, blockId: segment.blockId, date: value, start: segment.startMinute }).slice(0, 40), accountId: owner.id, calendarId,
        eventId: event?.id ?? null, sourceEventId: event?.id ?? null,
        sourceSeriesId: event?.seriesId, originalStart: event?.originalStart,
        blockId: segment.blockId, dateKey: value, startMinute: segment.startMinute,
        endMinute: segment.endMinute, baseEvent: event, baseLocalHash: null, state: 'pending',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        anchorStart: localDateAtMinute(value, segment.startMinute).toISOString(),
        anchorDate: value, anchorMinute: segment.startMinute,
        pendingSourceScope: event ? sourceScope : undefined,
        pendingSourceOperationId: event && sourceScope === 'series' ? Crypto.randomUUID() : undefined };
      const contiguous = await getProjectionSegment(projection);
      if (contiguous) {
        projection.dateKey = contiguous.entries[0]!.dateKey;
        projection.startMinute = contiguous.entries[0]!.minuteIndex;
        projection.endDateKey = contiguous.entries.at(-1)!.dateKey;
        projection.endMinute = contiguous.entries.at(-1)!.minuteIndex;
      }
      await saveProjection(projection);
      // Establish the replacement owner durably before permitting deletion of its copies.
      // If a later retirement write fails, the normal duplicate-group pass can retry it.
      for (const copy of copiesToRetire) await saveProjection(copy);
      projections.push(projection);
      if (sourceAccount) sourceUsed = true;
    }
  }
  if (nativeLinksNeedingReview.size) throw new NativeAccountLinkReviewError([...nativeLinksNeedingReview]);
}

function providerWriteColors(projection: Projection, categoryId: string) {
  const provider = projection.accountId.startsWith('google:') ? 'google' : 'microsoft';
  const mapping = categoryProviderColor(categoryId, provider, projection.accountId, projection.calendarId);
  if (mapping.colorId || mapping.eventLabelId || mapping.categoryName) return {
    googleColorId: mapping.colorId, googleEventLabelId: mapping.eventLabelId,
    microsoftCategories: mapping.categoryName ? [mapping.categoryName] : undefined,
  };
  const category = CATEGORIES.find((item) => item.id === categoryId);
  const selectedColor = calendarColor(category?.color)?.toUpperCase();
  const acknowledged = projection.baseColorSelection;
  const legacySourceColor = !acknowledged && category?.provider === 'google' && category.accountId === projection.accountId &&
    category.calendarId === projection.calendarId && category.providerOriginalColor?.toUpperCase() === selectedColor &&
    (!projection.baseEvent?.displayColor || projection.baseEvent.displayColor.toUpperCase() === selectedColor);
  const explicitChange = acknowledged ? acknowledged.categoryId !== categoryId || acknowledged.color.toUpperCase() !== selectedColor :
    Boolean(projection.baseEvent?.categoryId && projection.baseEvent.categoryId !== categoryId && !legacySourceColor);
  const explicitNewChoice = !projection.baseEvent && Boolean(category && (category.id.startsWith('google_palette_') ||
    category.id.startsWith('custom_') || category.provider));
  if (provider === 'google' && (explicitChange || explicitNewChoice)) {
    throw new Error('This selected color has no verified Google event or label mapping. Choose a writable Google event color before synchronizing.');
  }
  // Recording a note does not choose a new provider color. Keep the exact known
  // event IDs/categories, including an inherited calendar default, on updates.
  if (projection.baseEvent) return {
    googleColorId: projection.baseEvent.googleColorId,
    googleEventLabelId: projection.baseEvent.googleEventLabelId,
    microsoftCategories: projection.baseEvent.microsoftCategories,
  };
  // Native-calendar source colors have no account palette identity. For a new
  // actual, translate only an exact Google palette value; never guess an alias
  // between Google's native display colors and its legacy API color values.
  const exact = provider === 'google' && category ? CATEGORIES.find((item) =>
    item.provider === 'google' && item.accountId === projection.accountId && item.providerColorId &&
    calendarColor(item.providerOriginalColor ?? item.color)?.toUpperCase() === category.color.toUpperCase()) : undefined;
  return { googleColorId: exact?.providerColorId, googleEventLabelId: undefined, microsoftCategories: undefined };
}

function buildWrite(projection: Projection, segment: ActivitySegment): CalendarEventWrite {
  const preserved = projection.baseEvent ? readCalendarDescription(projection.baseEvent, projection.id).preserved : '';
  const description = makeCompactCalendarDescription(preserved, segment.entries);
  const zone = projection.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { title: segment.activityTitle ?? projection.title ??
      projection.baseEvent?.title ??
      (segment.entries[0]?.text.slice(0, 100) || categoryById(segment.categoryId).name),
    ...description,
    start: zonedMinuteToInstant(segment.dateKey, segment.startMinute, zone),
    end: zonedMinuteToInstant(segment.entries.at(-1)!.dateKey,
      segment.entries.at(-1)!.minuteIndex + 1, zone),
    timeZone: zone,
    projectionId: projection.id, categoryId: segment.categoryId,
    ...providerWriteColors(projection, segment.categoryId),
    sourceOperationId: projection.pendingSourceOperationId };
}
function eventHash(event: RemoteCalendarEvent) {
  return hashValue({ title: event.title, description: event.description, start: event.start,
    descriptionLog: event.descriptionLog ?? null,
    end: event.end, categoryId: event.categoryId ?? null, deleted: event.deleted,
    googleColorId: event.googleColorId, googleEventLabelId: event.googleEventLabelId,
    microsoftCategories: event.microsoftCategories });
}
function localWriteHash(write: CalendarEventWrite) {
  const { sourceOperationId: _operation, ...content } = write;
  return hashValue(content);
}
/** Writer normalization is not a local edit. Compare the acknowledged prior
 * title/color shape, and the version-one formatter where applicable. Real local
 * text/category/title/time changes still retain the normal conflict checks. */
function localProjectionUnchanged(projection: Projection, segment: ActivitySegment, write = buildWrite(projection, segment)) {
  const mapping = categoryProviderColor(segment.categoryId,
    projection.accountId.startsWith('google:') ? 'google' : 'microsoft', projection.accountId, projection.calendarId);
  const previousWrite = { ...write,
    title: segment.activityTitle ?? projection.title ??
      (segment.entries[0]?.text.slice(0, 100) || categoryById(segment.categoryId).name),
    googleColorId: mapping.colorId, googleEventLabelId: mapping.eventLabelId,
    microsoftCategories: mapping.categoryName ? [mapping.categoryName] : undefined };
  const preserved = projection.baseEvent ? readCalendarDescription(projection.baseEvent, projection.id).preserved : '';
  // Older writers included blank minute timestamps. Their removal is a
  // formatting upgrade, not a concurrent local edit of the activity.
  const oldEmptyLines = makeCalendarDescription(preserved, formatCalendarMinuteLog(segment.entries), 2);
  const candidates = [write, previousWrite, { ...write, ...oldEmptyLines }, { ...previousWrite, ...oldEmptyLines }];
  if (candidates.some((candidate) => localWriteHash(candidate) === projection.baseLocalHash)) return true;
  if (projection.baseEvent?.descriptionLog?.version !== 1) return false;
  const oldLog = segment.entries.map((entry) => `${minuteLabel(entry.minuteIndex, true)}  ${entry.text}`).join('\n');
  return candidates.some((candidate) =>
    localWriteHash({ ...candidate, ...makeCalendarDescription(preserved, oldLog, 1) }) === projection.baseLocalHash);
}
async function partitionActivity(entries: MinuteEntry[]) {
  const civil = (day: string, minute: number) => Date.parse(`${day}T00:00:00Z`) + minute * 60000;
  const labels = new Map<string, ReturnType<typeof cellEventLabel>>();
  for (const day of new Set(entries.map((entry) => entry.dateKey))) {
    const formats = new Map((await getSyncDocuments(`${CELL_FORMAT_PREFIX}${day}:`)).map((document) =>
      [Number(document.key.slice(`${CELL_FORMAT_PREFIX}${day}:`.length)), formatFromDocument(document.value)]));
    for (const entry of entries.filter((item) => item.dateKey === day)) {
      labels.set(`${entry.dateKey}:${entry.minuteIndex}`, cellEventLabel(formats.get(entry.minuteIndex) ?? {}, entry.blockId));
    }
  }
  const groups: MinuteEntry[][] = [];
  for (const entry of entries) {
    const previousGroup = groups.at(-1);
    const previous = previousGroup?.at(-1);
    const label = labels.get(`${entry.dateKey}:${entry.minuteIndex}`);
    const previousLabel = previous && labels.get(`${previous.dateKey}:${previous.minuteIndex}`);
    const sameBorder = label && previousLabel && label.id === previousLabel.id && label.title === previousLabel.title;
    const sameUnbordered = !label && !previousLabel && previous?.categoryId === entry.categoryId;
    if (previous && (sameBorder || sameUnbordered) &&
        civil(entry.dateKey, entry.minuteIndex) - civil(previous.dateKey, previous.minuteIndex) === 60000) previousGroup!.push(entry);
    else groups.push([entry]);
  }
  return groups;
}

/** Resolve the whole translated shape before any individual anchor can claim an
 * overlapping sibling. All projection coordinates commit together; provider IDs,
 * remote versions and the existing permission checks remain intact. */
async function reanchorMovedActivities(projections: Projection[], linkedBlocks: Set<string>) {
  for (const blockId of linkedBlocks) {
    if (!isActivityGroupId(blockId)) continue;
    const members = await getEntriesForBlock(blockId);
    const groups = await partitionActivity(members);
    if (!groups.length) continue;
    const current = groups.map((group) => ({ key: `${group[0]!.dateKey}:${group[0]!.minuteIndex}`,
      dateKey: group[0]!.dateKey, startMinute: group[0]!.minuteIndex,
      endDateKey: group.at(-1)!.dateKey, endMinute: group.at(-1)!.minuteIndex }));
    const owners = new Map<string, Projection[]>();
    for (const projection of projections.filter((item) => item.blockId === blockId && item.state !== 'deleted')) {
      const owner = `${projection.accountId}\0${projection.calendarId}`;
      const rows = owners.get(owner) ?? []; rows.push(projection); owners.set(owner, rows);
    }
    for (const rows of owners.values()) {
      if (rows.some((projection) => projection.state === 'conflict')) continue;
      const mapping = matchActivityTranslation(rows.map((projection) => ({ key: projection.id,
        dateKey: projection.dateKey, startMinute: projection.startMinute,
        endDateKey: projection.endDateKey, endMinute: projection.endMinute })), current);
      if (!mapping || mapping.shiftMinutes === 0) continue;
      const changes = mapping.matches.map(({ previous, current: target }) => {
        const projection = rows.find((item) => item.id === previous.key)!;
        return { key: `projection:${projection.id}`, before: sanitized(projection),
          after: sanitized({ ...projection, dateKey: target.dateKey, startMinute: target.startMinute,
            endDateKey: target.endDateKey ?? target.dateKey, endMinute: target.endMinute, state: 'pending' }) };
      });
      await remapActivityProjections(blockId, changes, members);
      for (const change of changes) Object.assign(rows.find((item) => `projection:${item.id}` === change.key)!, change.after);
    }
  }
}

async function getProjectionSegment(projection: Projection) {
  const namedActivity = isActivityGroupId(projection.blockId);
  const entries = namedActivity ? await getEntriesForBlock(projection.blockId) :
    (await getEntriesBetween(dateKey(addDays(projection.dateKey, -1)),
      dateKey(addDays(projection.endDateKey ?? projection.dateKey, 1))))
      .filter((entry) => entry.blockId === projection.blockId);
  const civil = (day: string, minute: number) => Date.parse(`${day}T00:00:00Z`) + minute * 60000;
  const groups = await partitionActivity(entries);
  const start = civil(projection.dateKey, projection.startMinute);
  const end = civil(projection.endDateKey ?? projection.dateKey, projection.endMinute);
  const selected = groups.find((group) => civil(group[0]!.dateKey, group[0]!.minuteIndex) <= end &&
    civil(group.at(-1)!.dateKey, group.at(-1)!.minuteIndex) >= start) ??
    // A whole named activity keeps its identity when moved beyond its old date/time.
    // Ambiguous split groups still require the anchored match above.
    (namedActivity && groups.length === 1 ? groups[0] : undefined);
  if (!selected && namedActivity && groups.length) {
    throw new Error('This activity moved with an ambiguous calendar shape. Review its linked events before synchronizing.');
  }
  if (!selected) return null;
  if (selected.length > 1440) throw new Error('Split activities longer than 24 hours before calendar synchronization.');
  return { segmentKey: projection.id, blockId: projection.blockId, dateKey: selected[0]!.dateKey,
    startMinute: selected[0]!.minuteIndex, endMinute: selected.at(-1)!.minuteIndex,
    categoryId: selected[0]!.categoryId, entries: selected,
    activityTitle: await getActivityTitleForEntries(selected) } satisfies ActivitySegment;
}

async function importCalendarEvent(projection: Projection, event: RemoteCalendarEvent | null) {
  const importAccount = (await getAccounts()).find((item) => item.id === projection.accountId);
  const expectedSegment = await getProjectionSegment(projection);
  const entries: { dateKey: string; minuteIndex: number; text: string; categoryId: string }[] = [];
  if (event && !event.deleted) {
    if (event.id !== projection.eventId || event.calendarId !== projection.calendarId) {
      throw new Error('The linked calendar event identity changed. Review it before importing.');
    }
    if (event.allDay) throw new Error('Choose a timed event before importing it into minute rows.');
    const start = new Date(event.start);
    const end = new Date(event.end);
    const count = (end.getTime() - start.getTime()) / 60000;
    if (!Number.isInteger(count) || count < 1 || count > 1440 || start.getSeconds() || start.getMilliseconds()) {
      throw new Error('Calendar actuals must use minute boundaries and last at most 24 hours.');
    }
    const importedCategory = categoryForEvent(projection.accountId, event);
    const account = importAccount;
    const color = account ? await remoteActivityColor(account, event) : calendarColor(event.displayColor);
    const sourceCategory = color ? await ensureSourceColorCategory({ color, name: event.title,
      provider: account?.provider === 'google' ? 'google' : 'microsoft', accountId: projection.accountId,
      calendarId: event.calendarId, preferredCategoryId: importedCategory?.id }) : null;
    const category = sourceCategory?.id ?? importedCategory?.id ?? event.categoryId ?? projection.baseEvent?.categoryId ?? 'unaccounted';
    const parts = readCalendarDescription(event, projection.id);
    const baseParts = projection.baseEvent ? readCalendarDescription(projection.baseEvent, projection.id) : null;
    if (baseParts?.format === 'clean' && parts.format === 'original') {
      throw new Error('The calendar minute-log metadata changed. Review the description before importing it.');
    }
    const body = parts.log ?? event.description;
    // Timestamp prose in an original event is preserved as notes, never inferred to be our generated log.
    const lines = parts.log == null || !body ? [] : event.descriptionLog?.version === 3 ?
      parseCompactCalendarMinuteLog(body, event.descriptionLog) : parseProjectedMinutes(body, {
        legacyMetadata: false, ranges: event.descriptionLog?.version === 2,
      });
    if (parts.format === 'clean' && body.trim() && !/^\d{1,2}:[0-5]\d(?:\s*(?:AM|PM))?[ \t]+/i.test(body)) {
      throw new Error('This calendar description contains notes before its minute log. Review it before importing.');
    }
    const oldStart = projection.baseEvent ? new Date(projection.baseEvent.start) : start;
    const shift = Math.round((start.getTime() - oldStart.getTime()) / 60000);
    const lineByMinute = new Map(lines.map((line) => [line.minuteIndex, line.text]));
    const unchangedLog = baseParts?.log != null && parts.log != null && body === baseParts.log;
    const seenSlots = new Set<string>();
    for (let offset = 0; offset < count; offset += 1) {
      const instant = new Date(start.getTime() + offset * 60000);
      const civil = new Intl.DateTimeFormat('en-CA', {
        timeZone: projection.timeZone ?? event.timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(instant);
      const part = (name: string) => civil.find((item) => item.type === name)!.value;
      const day = `${part('year')}-${part('month')}-${part('day')}`;
      const minute = Number(part('hour')) * 60 + Number(part('minute'));
      const key = `${day}:${minute}`;
      if (seenSlots.has(key)) throw new Error('The repeated daylight-saving hour needs distinct minute identities before import.');
      seenSlots.add(key);
      const lookup = unchangedLog ? ((minute - shift) % 1440 + 1440) % 1440 : minute;
      // Event titles belong to the activity label, never to every minute's
      // independent note. Missing or cleared notes remain genuinely blank.
      const text = lineByMinute.get(lookup) ?? (lines.length || offset !== 0 ? '' : body);
      entries.push({ dateKey: day, minuteIndex: minute, text, categoryId: category });
    }
  }
  const coordinates = new Map<string, Set<number>>();
  for (const entry of [...(expectedSegment?.entries ?? []), ...entries]) {
    const minutes = coordinates.get(entry.dateKey) ?? new Set<number>();
    minutes.add(entry.minuteIndex); coordinates.set(entry.dateKey, minutes);
  }
  const expectedFormats = [];
  const guardedEntries: MinuteEntry[] = [];
  for (const [day, minutes] of coordinates) {
    for (const cell of await getSpreadsheetCells({ dateKey: day,
      startMinute: Math.min(...minutes), endMinute: Math.max(...minutes) })) {
      if (!minutes.has(cell.minuteIndex)) continue;
      expectedFormats.push({ dateKey: day, minuteIndex: cell.minuteIndex, format: cell.format, version: cell.version });
      guardedEntries.push({ id: cell.entry?.id ?? '', dateKey: day, minuteIndex: cell.minuteIndex,
        text: cell.entry?.text ?? '', categoryId: cell.entry?.categoryId ?? 'unaccounted',
        blockId: cell.entry?.blockId ?? projection.blockId, source: cell.entry?.source ?? 'imported',
        createdAt: cell.entry?.createdAt ?? '', updatedAt: cell.entry?.updatedAt ?? '' });
    }
  }
  const latestAccount = (await getAccounts()).find((item) => item.id === projection.accountId &&
    item.subject === importAccount?.subject && item.provider === importAccount?.provider);
  if (!latestAccount?.consent.calendarRead || !latestAccount.consent.importCalendarEdits) {
    throw new Error('Calendar edit import permission changed. Refresh the account connection.');
  }
  const guard = () => requireCalendarColorImportCurrent(guardedEntries);
  guard();
  await replaceProjectedMinutes({ blockId: projection.blockId, previousDate: projection.dateKey,
    previousEndDate: projection.endDateKey,
    previousStart: projection.startMinute, previousEnd: projection.endMinute,
    expectedEntries: expectedSegment?.entries ?? [], expectedActivityTitle: expectedSegment?.activityTitle,
    expectedFormats, beforeCommitGuard: guard, clearPreviousFormats: true,
    activityTitle: event?.title, entries });
  const importedEntries: MinuteEntry[] = [];
  for (const [day, minutes] of coordinates) {
    const current = new Map((await getDayEntries(day)).map((entry) => [entry.minuteIndex, entry]));
    for (const minute of minutes) {
      importedEntries.push(current.get(minute) ?? { id: '', dateKey: day, minuteIndex: minute,
        text: '', categoryId: 'unaccounted', blockId: '', source: 'imported', createdAt: '', updatedAt: '' });
    }
  }
  notifyCalendarColorImported(importedEntries, true);
  if (!event || event.deleted) {
    await saveProjection({ ...projection, state: 'deleted', baseEvent: event, baseLocalHash: null });
    return;
  }
  const first = entries[0]!;
  const last = entries.at(-1)!;
  const next = { ...projection, dateKey: first.dateKey, startMinute: first.minuteIndex,
    endDateKey: last.dateKey, endMinute: last.minuteIndex, title: event.title, baseEvent: event, state: 'synced' as const,
    conflict: undefined, anchorStart: event.start, anchorDate: first.dateKey,
    anchorMinute: first.minuteIndex, baseColorSelection: { categoryId: entries[0]!.categoryId,
      color: categoryById(entries[0]!.categoryId).color.toUpperCase() } };
  const segment = await getProjectionSegment(next);
  next.baseLocalHash = segment ? localWriteHash(buildWrite(next, segment)) : null;
  await saveProjection(next);
}

async function reconcileProjection(account: ConnectedAccount, projection: Projection, reads: CalendarSyncReads) {
  if (projection.state === 'deleted' || projection.state === 'conflict') return;
  await serializeColorReconciliation(async () => {
    coreProjectionEpochs.set(projection.id, (coreProjectionEpochs.get(projection.id) ?? 0) + 1);
    activeCoreProjections.add(projection.id);
  });
  try { await reconcileCurrentProjection(account, projection, reads); }
  finally {
    await serializeColorReconciliation(async () => {
      activeCoreProjections.delete(projection.id);
      coreProjectionEpochs.set(projection.id, (coreProjectionEpochs.get(projection.id) ?? 0) + 1);
    });
  }
}

async function reconcileCurrentProjection(account: ConnectedAccount, projection: Projection, reads: CalendarSyncReads) {
  const adapter = createCalendarAdapter(account, reads.metadata);
  let segment = await getProjectionSegment(projection);
  let write = segment ? buildWrite(projection, segment) : null;
  let localHash = write ? localWriteHash(write) : null;
  const remote = projection.eventId ? await adapter.getEvent(projection.calendarId, projection.eventId) : null;
  let currentAccount = (await getAccounts()).find((item) => item.id === account.id && item.subject === account.subject && item.provider === account.provider);
  if (!currentAccount?.consent.calendarRead) return;
  const resolvedColor = remote ? await remoteActivityColor(currentAccount, remote, reads) : undefined;
  currentAccount = (await getAccounts()).find((item) => item.id === account.id && item.subject === account.subject && item.provider === account.provider);
  if (!currentAccount?.consent.calendarRead) return;
  segment = await getProjectionSegment(projection);
  write = segment ? buildWrite(projection, segment) : null;
  localHash = write ? localWriteHash(write) : null;
  if (remote && segment) {
    const expected = hashValue(projection); const expectedEntries = hashValue(segment.entries);
    const imported = await serializeColorReconciliation(async () => {
      const current = (await listProjections()).find((item) => item.id === projection.id);
      const authorized = (await getAccounts()).find((item) => item.id === account.id && item.subject === account.subject && item.consent.calendarRead);
      if (!current || hashValue(current) !== expected || !authorized) return false;
      const local = await getProjectionSegment(current);
      if (!local || hashValue(local.entries) !== expectedEntries) return false;
      return importAccountColorOnly(authorized, current, remote, local, { color: resolvedColor, skipDisplayBootstrap: true });
    });
    if (imported) return;
  }
  const currentProjection = (await listProjections()).find((item) => item.id === projection.id);
  if (!currentProjection || hashValue(currentProjection) !== hashValue(projection)) return;
  segment = await getProjectionSegment(projection);
  write = segment ? buildWrite(projection, segment) : null;
  localHash = write ? localWriteHash(write) : null;
  const localChanged = segment && write ? !localProjectionUnchanged(projection, segment, write) : localHash !== projection.baseLocalHash;
  const remoteChanged = projection.baseEvent
    ? !remote || eventHash(remote) !== eventHash(projection.baseEvent)
    : Boolean(remote);
  if (remoteChanged && projection.baseEvent) {
    if (!currentAccount.consent.importCalendarEdits) {
      throw new Error('Calendar activity changed. Allow calendar edit import to reconcile it.');
    }
    if (localChanged) {
      await saveProjection({ ...projection, state: 'conflict',
        conflict: 'This activity changed in Context and the calendar. Choose the version to keep.' });
    } else {
      try { await importCalendarEvent(projection, remote); }
      catch (error) { await saveProjection({ ...projection, state: 'conflict',
        conflict: error instanceof Error ? error.message : 'This calendar edit needs review.' }); }
    }
    return;
  }
  if (!localChanged && projection.state === 'synced') {
    if (!projection.baseColorSelection && segment) await saveProjection({ ...projection,
      baseColorSelection: { categoryId: segment.categoryId, color: categoryById(segment.categoryId).color.toUpperCase() } });
    return;
  }
  if (!currentAccount.consent.calendarWrite) return;
  if (projection.sourceEventId && !currentAccount.consent.replaceOccurrences) return;
  if (projection.pendingSourceScope === 'series' && !currentAccount.consent.editSeries) {
    throw new Error('Allow recurring-series changes for this account before applying this edit.');
  }
  const writableAdapter = createCalendarAdapter(currentAccount, reads.metadata);
  if (!write) {
    if (remote) await writableAdapter.deleteEvent(remote);
    await saveProjection({ ...projection, state: 'deleted', baseLocalHash: null });
    return;
  }
  try {
    let saved: RemoteCalendarEvent;
    if (remote && projection.pendingSourceScope === 'series') {
      await writableAdapter.updateSeries(remote, write);
      saved = await writableAdapter.getEvent(projection.calendarId, remote.id) ?? remote;
      saved = await writableAdapter.updateEvent(saved, write);
    } else if (remote) saved = await writableAdapter.updateEvent(remote, write);
    else {
      saved = await writableAdapter.createEvent(projection.calendarId, write);
      // A retry can recover an earlier provider create. Reconcile that content on the next pass.
      if (saved.description !== write.description || saved.start !== write.start || saved.end !== write.end) {
        saved = await writableAdapter.updateEvent(saved, write);
      }
    }
    await saveProjection({ ...projection, eventId: saved.id, baseEvent: saved,
      baseColorSelection: { categoryId: segment!.categoryId, color: categoryById(segment!.categoryId).color.toUpperCase() },
      baseLocalHash: localHash, startMinute: segment!.startMinute, endMinute: segment!.endMinute,
      dateKey: segment!.entries[0]!.dateKey, endDateKey: segment!.entries.at(-1)!.dateKey,
      state: 'synced', conflict: undefined, pendingSourceScope: undefined,
      pendingSourceOperationId: undefined });
    const savedColor = await remoteActivityColor(currentAccount, saved, reads);
    if (savedColor && segment) await setSetting(accountColorReceiptKey(projection), { version: 1,
      calendarId: saved.calendarId, eventId: saved.id, remoteColor: savedColor,
      localColorHash: localActivityColorHash(segment.entries) } satisfies ColorReceipt);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'status' in error && error.status === 412) {
      await saveProjection({ ...projection, state: 'conflict',
        conflict: 'The calendar changed during synchronization. Choose which version to keep.' });
      return;
    }
    throw error;
  }
}

export async function resolveProjectionConflict(id: string, choice: 'context' | 'calendar') {
  const projection = (await listProjections()).find((item) => item.id === id);
  if (!projection) throw new Error('This calendar activity is no longer linked.');
  const account = (await getAccounts()).find((item) => item.id === projection.accountId);
  if (!account) throw new Error('Reconnect the account before resolving this activity.');
  const event = projection.eventId
    ? await createCalendarAdapter(account).getEvent(projection.calendarId, projection.eventId) : null;
  if (choice === 'calendar') {
    if (!account.consent.importCalendarEdits) throw new Error('Allow calendar edit import first.');
    await importCalendarEvent(projection, event);
  } else {
    if (!account.consent.calendarWrite) throw new Error('Allow calendar updates first.');
    await saveProjection({ ...projection, baseEvent: event, state: 'pending', conflict: undefined });
  }
}

/** Imported minutes keep their durable retry until an authorized account owns
 * the exact block. Ordinary local-save tickets retain their existing behavior. */
export async function canAcknowledgeInlineMinuteLink(ticket: PendingInlineMinuteLink): Promise<boolean> {
  if (!ticket.requiresAccountWriter) return true;
  const entry = (await getDayEntries(ticket.dateKey)).find((item) => item.minuteIndex === ticket.minuteIndex);
  if (!entry) return true;
  const projections = (await listProjections()).filter((projection) => projection.state !== 'deleted' && projection.blockId === entry.blockId);
  if (!projections.length && !await getActivityTitleForEntries([entry])) return true;
  const accounts = await getAccounts();
  return projections.some((projection) =>
    accounts.some((account) => account.id === projection.accountId && account.consent.calendarWrite));
}

async function runSync(cycleId?: number): Promise<AccountSyncStatus> {
  const managedCycle = cycleId !== undefined;
  const reads: CalendarSyncReads = { metadata: createCalendarMetadataReadCache(), defaultColors: new Map() };
  publish({ running: true, outcome: 'running', phase: 'checking-storage', progress: undefined,
    cycleId: cycleId ?? status.cycleId ?? 0, cycleComplete: false, nativeWriteReady: false, nativePendingCount: 0,
    message: 'Checking account synchronization…' });
  const errors: string[] = [];
  const blockedAccounts = new Set<string>();
  const nativePendingBlocks = new Set<string>();
  const storageBudgets = new Map<string, StoragePassBudget>();
  let storagePending = false;
  let continuationMessage = 'Private ledger synchronization is continuing.';
  try {
    const accounts = await getAccounts();
    const passphrase = await SecureStore.getItemAsync(PASSPHRASE_KEY);
    for (const account of accounts) {
      try {
        if (account.consent.ledgerStorage) {
          if (!passphrase) throw new Error('Unlock the private ledger with the same passphrase on both phones.');
          const budget = { downloads: 0, uploads: 0, verifiedPassphrase: false };
          storageBudgets.set(account.id, budget);
          if (!await storageSync(account, passphrase, budget)) storagePending = true;
        }
      } catch (error) {
        blockedAccounts.add(account.id);
        if (error instanceof StorageDownloadPending) { storagePending = true; continuationMessage = error.message; }
        else errors.push(`${account.label}: ${error instanceof Error ? error.message : 'Storage sync failed.'}`);
      }
    }
    publish({ phase: 'calendar', progress: undefined, message: 'Preparing calendar updates…', cycleComplete: false });
    // Winning peer/browser minutes have durable exact-coordinate link tickets.
    // Drain a bounded pass only after storage succeeds; never infer a source
    // occurrence or create a native-calendar write from imported ledger data.
    if (!blockedAccounts.size) {
      for (const ticket of await getPendingInlineMinuteLinks(100)) {
        try {
          const permitted = (await getAccounts()).some((item) => item.consent.calendarWrite &&
            (item.provider === 'google' || item.provider === 'microsoft'));
          if (ticket.requiresAccountWriter && !permitted) {
            if (await canAcknowledgeInlineMinuteLink(ticket)) await acknowledgeInlineMinuteLink(ticket);
            else await deferInlineMinuteLink(ticket);
            continue;
          }
          await linkActualsToAccounts(ticket.affectedDates, null,
            { dateKey: ticket.dateKey, minuteIndex: ticket.minuteIndex });
          if (await canAcknowledgeInlineMinuteLink(ticket)) await acknowledgeInlineMinuteLink(ticket);
          else await deferInlineMinuteLink(ticket);
        } catch (error) {
          if (error instanceof NativeAccountLinkReviewError) {
            await promoteInlineMinuteLinkForAccountReview(ticket).catch(() => undefined);
            for (const blockId of error.blockIds) nativePendingBlocks.add(blockId);
          } else {
            if (ticket.requiresAccountWriter) await deferInlineMinuteLink(ticket).catch(() => undefined);
            errors.push('Some imported minute changes could not be linked to an authorized calendar. They remain queued for retry.');
          }
        }
      }
    }
    const projections = await listProjections();
    await listCategories();
    const linkedDates = [...new Set(projections.filter((p) => p.state !== 'deleted')
      .flatMap((p) => [p.dateKey, p.endDateKey ?? p.dateKey]))];
    if (linkedDates.length) {
      try { await linkActualsToAccounts(linkedDates); }
      catch (error) {
        if (error instanceof NativeAccountLinkReviewError) for (const blockId of error.blockIds) nativePendingBlocks.add(blockId);
        else throw error;
      }
    }
    const eligibleProjections = (await listProjections()).filter((projection) => {
      const account = accounts.find((item) => item.id === projection.accountId);
      return account?.consent.calendarRead && !blockedAccounts.has(account.id);
    });
    const ranked = await Promise.all(eligibleProjections.map(async (projection) => {
      if (projection.state === 'pending') return { projection, priority: 0 };
      try {
        const segment = await getProjectionSegment(projection);
        return { projection, priority: segment ? Number(localProjectionUnchanged(projection, segment)) : Number(projection.baseLocalHash === null) };
      } catch { return { projection, priority: 0 }; }
    }));
    const calendarProjections = ranked.sort((left, right) => left.priority - right.priority ||
      left.projection.id.localeCompare(right.projection.id)).map((item) => item.projection);
    let completedCalendars = 0;
    for (const projection of calendarProjections) {
      const account = accounts.find((item) => item.id === projection.accountId);
      if (!account?.consent.calendarRead || blockedAccounts.has(account.id)) continue;
      publish({ phase: 'calendar', progress: { completed: completedCalendars, total: calendarProjections.length },
        message: 'Synchronizing calendar activities…', cycleComplete: false });
      try {
        const current = (await listProjections()).find((item) => item.id === projection.id);
        if (current) await reconcileProjection(account, current, reads);
      }
      catch (error) { errors.push(`${account.label}: ${error instanceof Error ? error.message : 'Calendar sync failed.'}`); }
      completedCalendars++;
    }
    // Calendar imports are ledger mutations too, so send them to the other phone in this pass.
    for (const account of accounts) {
      if (!account.consent.ledgerStorage || !passphrase || blockedAccounts.has(account.id)) continue;
      try {
        const budget = storageBudgets.get(account.id) ?? { downloads: 0, uploads: 0, verifiedPassphrase: false };
        if (!await storageSync(account, passphrase, budget)) storagePending = true;
      }
      catch (error) {
        if (error instanceof StorageDownloadPending) { storagePending = true; continuationMessage = error.message; }
        else errors.push(`${account.label}: ${error instanceof Error ? error.message : 'Upload failed.'}`);
      }
    }
    const conflicts = (await listProjections()).filter((p) => p.state === 'conflict').length;
    if (storagePending) requestAccountSynchronization();
    const nativeWriteReady = !errors.length && !conflicts && blockedAccounts.size === 0;
    const outcome = errors.length || conflicts ? 'error' : storagePending || nativePendingBlocks.size ? 'continuing' : accounts.length ? 'success' : 'idle';
    publish({ running: managedCycle, outcome, conflicts, cycleComplete: !managedCycle, phase: 'idle', progress: undefined,
      nativeWriteReady: !managedCycle && nativeWriteReady, nativePendingCount: nativePendingBlocks.size,
      lastSyncedAt: !managedCycle && outcome === 'success' ? new Date().toISOString() : status.lastSyncedAt,
      message: errors.length ? [...new Set(errors)].join('\n') : conflicts ? 'Review calendar conflicts in Settings → Calendar accounts.' :
        storagePending ? continuationMessage : nativePendingBlocks.size ? 'Phone-linked activities are waiting for their original calendar connection.' :
          accounts.length ? 'Accounts synchronized' : 'Connect an account to sync your phones' });
    return managedCycle ? { ...status, nativeWriteReady } : status;
  } catch (error) {
    publish({ running: managedCycle, outcome: 'error', cycleComplete: !managedCycle, progress: undefined, nativeWriteReady: false,
      message: error instanceof Error ? error.message : 'Synchronization will retry.' });
  }
  return status;
}

/** Saved local edits start one foreground sync after a short burst settles. */
export function requestAccountSynchronization() {
  if (activeJob) { rerunRequested = true; return; }
  if (requestedSyncTimer) return;
  requestedSyncTimer = setTimeout(() => {
    requestedSyncTimer = null;
    void synchronizeAccounts();
  }, 500);
}

export function synchronizeAccounts(): Promise<AccountSyncStatus> {
  if (requestedSyncTimer) { clearTimeout(requestedSyncTimer); requestedSyncTimer = null; }
  // Polling, manual Sync and the native outbox can all await the same cycle.
  // Joining does not imply another edit; durable work explicitly requests it.
  if (activeJob) return activeJob;
  const cycleId = ++syncCycleId;
  const previousLastSyncedAt = status.lastSyncedAt;
  activeJob = (async () => {
    // Fold edits arriving during a pass into one follow-up. A steady stream of
    // typing must not keep every waiting caller inside an unbounded drain loop.
    let nativeWriteReady = false;
    for (let pass = 0; pass < 2; pass++) {
      rerunRequested = false;
      const result = await runSync(cycleId);
      nativeWriteReady = result.nativeWriteReady === true;
      if (!rerunRequested) break;
    }
    publish({ running: false, cycleId, cycleComplete: true, nativeWriteReady,
      lastSyncedAt: status.outcome === 'success' ? new Date().toISOString() : previousLastSyncedAt });
    return status;
  })().finally(() => {
    activeJob = null;
    // Keep later edits moving without extending the original caller's promise.
    if (rerunRequested) requestAccountSynchronization();
  });
  return activeJob;
}
