import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import {
  acknowledgeUploaded, getDayEntries, getDaySegments, getDocumentsForUpload, getEntriesBetween,
  getSetting, getSyncDocuments, hasSeenSyncFile,
  markSyncFileSeen, mergeSyncDocuments, putSyncDocument, replaceProjectedMinutes, setSetting,
} from '../data/database';
import { categoryById } from '../theme';
import { CATEGORIES } from '../theme';
import { categoryProviderColor, listCategories } from '../services/categories';
import type { ActivitySegment, PlannedEvent } from '../types';
import { addDays, dateKey, localDateAtMinute, minuteIndexForDate, minuteLabel, parseDateKey } from '../utils/time';
import { getAccounts } from './accounts';
import { clearLedgerKeyCache, decryptBatch, encryptBatch, hashValue, parseProjectedMinutes } from './codec';
import { createCalendarAdapter } from './providers';
import { createLedgerStorage } from './storage';
import { zonedMinuteToInstant } from './time';
import type {
  AccountSyncStatus, CalendarEventWrite, ConnectedAccount, Projection,
  RemoteCalendarEvent, SyncBatch,
} from './types';

const PASSPHRASE_KEY = 'context.ledger.passphrase.v1';
const BEGIN_LOG = '--- Context minutes ---';
const END_LOG = '--- End Context minutes ---';
export type AccountPreferences = { selectedCalendarIds: string[]; writeCalendarId: string | null };
let status: AccountSyncStatus = { running: false, lastSyncedAt: null, message: 'Ready to connect', conflicts: 0 };
const listeners = new Set<(next: AccountSyncStatus) => void>();
let activeJob: Promise<AccountSyncStatus> | null = null;
let rerunRequested = false;

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

async function storageSync(account: ConnectedAccount, passphrase: string) {
  const storage = createLedgerStorage(account);
  const storageKey = account.id;
  // Download first: a wrong passphrase must fail before any new encrypted files are uploaded.
  const files = await storage.listFiles();
  let verifiedPassphrase = false;
  for (const file of files) {
    const seen = await hasSeenSyncFile(storageKey, file.id);
    if (seen && verifiedPassphrase) continue;
    let batch: SyncBatch;
    try { batch = await decryptBatch(await storage.readFile(file), passphrase); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('Cannot unlock')) {
        await clearSavedPassphrase();
      }
      throw error;
    }
    verifiedPassphrase = true;
    if (seen) continue;
    await mergeSyncDocuments(batch.documents);
    await markSyncFileSeen(storageKey, file.id);
  }

  type Pending = { name: string; ciphertext: string; batch: SyncBatch };
  const pendingKey = `account.pendingBatch.${account.id}`;
  // Bound work per foreground pass; later passes continue without dropping unacknowledged rows.
  for (let chunk = 0; chunk < 100; chunk += 1) {
    let pending = await getSetting<Pending | null>(pendingKey, null);
    if (!pending) {
      const documents = await getDocumentsForUpload(storageKey, 100);
      if (!documents.length) break;
      // Drive multipart uploads have a small-file limit; ciphertext uses hexadecimal encoding.
      // Keep plaintext below 2 MiB and let larger journals continue in subsequent immutable files.
      while (documents.length > 1 && new TextEncoder().encode(JSON.stringify(documents)).byteLength > 2 * 1024 * 1024) {
        documents.pop();
      }
      const batch: SyncBatch = { version: 1, id: Crypto.randomUUID(), documents };
      pending = { name: `context-${batch.id}.json`, batch,
        ciphertext: await encryptBatch(batch, passphrase) };
      await setSetting(pendingKey, pending);
    }
    await decryptBatch(pending.ciphertext, passphrase);
    await storage.writeFile(pending.name, pending.ciphertext);
    await acknowledgeUploaded(storageKey, pending.batch.documents);
    await setSetting(pendingKey, null);
  }
}

export async function loadAccountPlans(value: string): Promise<PlannedEvent[]> {
  const plans: PlannedEvent[] = [];
  const start = localDateAtMinute(value, 0).toISOString();
  const end = localDateAtMinute(dateKey(addDays(value, 1)), 0).toISOString();
  for (const account of await getAccounts()) {
    if (!account.consent.calendarRead) continue;
    const adapter = createCalendarAdapter(account);
    const preferences = await getAccountPreferences(account.id);
    const calendars = await adapter.listCalendars();
    for (const calendarId of preferences.selectedCalendarIds) {
      const calendar = calendars.find((item) => item.id === calendarId);
      if (!calendar) continue;
      for (const event of await adapter.listEvents(calendarId, start, end)) {
        if (event.deleted) continue;
        const category = categoryForEvent(account.id, event);
        plans.push({ id: `${account.id}:${event.id}`, calendarId, title: event.title,
          notes: event.description, color: category?.color ?? calendar.color,
          categoryId: category?.id ?? event.categoryId, startDate: new Date(event.start),
          endDate: new Date(event.end), allDay: event.allDay,
          accountEvent: { accountId: account.id, event } });
      }
    }
  }
  return plans;
}

function categoryForEvent(accountId: string, event: RemoteCalendarEvent) {
  return CATEGORIES.find((category) => category.accountId === accountId &&
    ((event.googleEventLabelId && category.providerLabelId === event.googleEventLabelId && category.calendarId === event.calendarId) ||
      (event.googleColorId && category.providerColorId === event.googleColorId) ||
      (category.providerCategoryName && event.microsoftCategories?.includes(category.providerCategoryName))));
}

/** Called after a local range save. Provider IDs come directly from the selected occurrence. */
export async function linkActualsToAccounts(
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
  for (const value of dates) {
    for (const segment of await getDaySegments(value)) {
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
}

function descriptionOutsideLog(description: string) {
  const start = description.indexOf(BEGIN_LOG);
  const end = description.indexOf(END_LOG, start);
  if (start < 0 || end < 0) return description.trim();
  return `${description.slice(0, start)}${description.slice(end + END_LOG.length)}`.trim();
}
function buildWrite(projection: Projection, segment: ActivitySegment): CalendarEventWrite {
  const preserved = projection.sourceEventId || projection.baseEvent
    ? descriptionOutsideLog(projection.baseEvent?.description ?? '') : '';
  const lines = segment.entries.map((entry) => `${minuteLabel(entry.minuteIndex, true)}  ${entry.text}`);
  const log = [BEGIN_LOG, `Context category: ${segment.categoryId}`, ...lines,
    `Context projection: ${projection.id}`, END_LOG].join('\n');
  const zone = projection.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const mapping = categoryProviderColor(segment.categoryId,
    projection.accountId.startsWith('google:') ? 'google' : 'microsoft',
    projection.accountId, projection.calendarId);
  return { title: projection.title ?? (segment.entries[0]?.text.slice(0, 100) || categoryById(segment.categoryId).name),
    description: [preserved, log].filter(Boolean).join('\n\n'),
    start: zonedMinuteToInstant(segment.dateKey, segment.startMinute, zone),
    end: zonedMinuteToInstant(segment.entries.at(-1)!.dateKey,
      segment.entries.at(-1)!.minuteIndex + 1, zone),
    timeZone: zone,
    projectionId: projection.id, categoryId: segment.categoryId,
    googleColorId: mapping.colorId, googleEventLabelId: mapping.eventLabelId,
    microsoftCategories: mapping.categoryName ? [mapping.categoryName] : undefined,
    sourceOperationId: projection.pendingSourceOperationId };
}
function eventHash(event: RemoteCalendarEvent) {
  return hashValue({ title: event.title, description: event.description, start: event.start,
    end: event.end, categoryId: event.categoryId ?? null, deleted: event.deleted,
    googleColorId: event.googleColorId, googleEventLabelId: event.googleEventLabelId,
    microsoftCategories: event.microsoftCategories });
}
function localWriteHash(write: CalendarEventWrite) {
  const { sourceOperationId: _operation, ...content } = write;
  return hashValue(content);
}
async function getProjectionSegment(projection: Projection) {
  const entries = (await getEntriesBetween(dateKey(addDays(projection.dateKey, -1)),
    dateKey(addDays(projection.endDateKey ?? projection.dateKey, 1))))
    .filter((entry) => entry.blockId === projection.blockId);
  const civil = (day: string, minute: number) => Date.parse(`${day}T00:00:00Z`) + minute * 60000;
  const groups: typeof entries[] = [];
  for (const entry of entries) {
    const previousGroup = groups.at(-1);
    const previous = previousGroup?.at(-1);
    if (previous && civil(entry.dateKey, entry.minuteIndex) - civil(previous.dateKey, previous.minuteIndex) === 60000) {
      previousGroup!.push(entry);
    } else groups.push([entry]);
  }
  const start = civil(projection.dateKey, projection.startMinute);
  const end = civil(projection.endDateKey ?? projection.dateKey, projection.endMinute);
  const selected = groups.find((group) => civil(group[0]!.dateKey, group[0]!.minuteIndex) <= end &&
    civil(group.at(-1)!.dateKey, group.at(-1)!.minuteIndex) >= start);
  if (!selected) return null;
  if (selected.length > 1440) throw new Error('Split activities longer than 24 hours before calendar synchronization.');
  return { segmentKey: projection.id, blockId: projection.blockId, dateKey: selected[0]!.dateKey,
    startMinute: selected[0]!.minuteIndex, endMinute: selected.at(-1)!.minuteIndex,
    categoryId: selected[0]!.categoryId, entries: selected } satisfies ActivitySegment;
}

async function importCalendarEvent(projection: Projection, event: RemoteCalendarEvent | null) {
  const expectedSegment = await getProjectionSegment(projection);
  const entries: { dateKey: string; minuteIndex: number; text: string; categoryId: string }[] = [];
  if (event && !event.deleted) {
    if (event.allDay) throw new Error('Choose a timed event before importing it into minute rows.');
    const start = new Date(event.start);
    const end = new Date(event.end);
    const count = (end.getTime() - start.getTime()) / 60000;
    if (!Number.isInteger(count) || count < 1 || count > 1440 || start.getSeconds() || start.getMilliseconds()) {
      throw new Error('Calendar actuals must use minute boundaries and last at most 24 hours.');
    }
    const importedCategory = categoryForEvent(projection.accountId, event);
    const category = importedCategory?.id ?? event.categoryId ?? projection.baseEvent?.categoryId ?? 'unaccounted';
    const logStart = event.description.indexOf(BEGIN_LOG);
    const logEnd = event.description.indexOf(END_LOG, logStart);
    const body = logStart >= 0 && logEnd >= 0
      ? event.description.slice(logStart + BEGIN_LOG.length, logEnd) : event.description;
    const lines = parseProjectedMinutes(body);
    const oldStart = projection.baseEvent ? new Date(projection.baseEvent.start) : start;
    const shift = Math.round((start.getTime() - oldStart.getTime()) / 60000);
    const lineByMinute = new Map(lines.map((line) => [line.minuteIndex, line.text]));
    const unchangedLog = projection.baseEvent && body === projection.baseEvent.description
      .slice(projection.baseEvent.description.indexOf(BEGIN_LOG) + BEGIN_LOG.length,
        projection.baseEvent.description.indexOf(END_LOG));
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
      const text = lineByMinute.get(lookup) ??
        (lines.length ? event.title : [event.title, offset === 0 ? body.trim() : ''].filter(Boolean).join('\n'));
      entries.push({ dateKey: day, minuteIndex: minute, text, categoryId: category });
    }
  }
  await replaceProjectedMinutes({ blockId: projection.blockId, previousDate: projection.dateKey,
    previousEndDate: projection.endDateKey,
    previousStart: projection.startMinute, previousEnd: projection.endMinute,
    expectedEntries: expectedSegment?.entries ?? [], entries });
  if (!event || event.deleted) {
    await saveProjection({ ...projection, state: 'deleted', baseEvent: event, baseLocalHash: null });
    return;
  }
  const first = entries[0]!;
  const last = entries.at(-1)!;
  const next = { ...projection, dateKey: first.dateKey, startMinute: first.minuteIndex,
    endDateKey: last.dateKey, endMinute: last.minuteIndex, title: event.title, baseEvent: event, state: 'synced' as const,
    conflict: undefined, anchorStart: event.start, anchorDate: first.dateKey,
    anchorMinute: first.minuteIndex };
  const segment = await getProjectionSegment(next);
  next.baseLocalHash = segment ? localWriteHash(buildWrite(next, segment)) : null;
  await saveProjection(next);
}

async function reconcileProjection(account: ConnectedAccount, projection: Projection) {
  if (projection.state === 'deleted' || projection.state === 'conflict') return;
  const adapter = createCalendarAdapter(account);
  let segment = await getProjectionSegment(projection);
  let write = segment ? buildWrite(projection, segment) : null;
  let localHash = write ? localWriteHash(write) : null;
  const remote = projection.eventId ? await adapter.getEvent(projection.calendarId, projection.eventId) : null;
  segment = await getProjectionSegment(projection);
  write = segment ? buildWrite(projection, segment) : null;
  localHash = write ? localWriteHash(write) : null;
  const localChanged = localHash !== projection.baseLocalHash;
  const currentAccount = (await getAccounts()).find((item) => item.id === account.id);
  if (!currentAccount?.consent.calendarRead) return;
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
  if (!localChanged && projection.state === 'synced') return;
  if (!currentAccount.consent.calendarWrite) return;
  if (projection.sourceEventId && !currentAccount.consent.replaceOccurrences) return;
  if (projection.pendingSourceScope === 'series' && !currentAccount.consent.editSeries) {
    throw new Error('Allow recurring-series changes for this account before applying this edit.');
  }
  const writableAdapter = createCalendarAdapter(currentAccount);
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
      baseLocalHash: localHash, startMinute: segment!.startMinute, endMinute: segment!.endMinute,
      dateKey: segment!.entries[0]!.dateKey, endDateKey: segment!.entries.at(-1)!.dateKey,
      state: 'synced', conflict: undefined, pendingSourceScope: undefined,
      pendingSourceOperationId: undefined });
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

async function runSync(): Promise<AccountSyncStatus> {
  publish({ running: true, message: 'Synchronizing accounts…' });
  const errors: string[] = [];
  const blockedAccounts = new Set<string>();
  try {
    const accounts = await getAccounts();
    const passphrase = await SecureStore.getItemAsync(PASSPHRASE_KEY);
    for (const account of accounts) {
      try {
        if (account.consent.ledgerStorage) {
          if (!passphrase) throw new Error('Unlock the private ledger with the same passphrase on both phones.');
          await storageSync(account, passphrase);
        }
      } catch (error) {
        blockedAccounts.add(account.id);
        errors.push(`${account.label}: ${error instanceof Error ? error.message : 'Storage sync failed.'}`);
      }
    }
    const projections = await listProjections();
    await listCategories();
    const linkedDates = [...new Set(projections.filter((p) => p.state !== 'deleted')
      .flatMap((p) => [p.dateKey, p.endDateKey ?? p.dateKey]))];
    if (linkedDates.length) await linkActualsToAccounts(linkedDates);
    for (const projection of await listProjections()) {
      const account = accounts.find((item) => item.id === projection.accountId);
      if (!account?.consent.calendarRead || blockedAccounts.has(account.id)) continue;
      try { await reconcileProjection(account, projection); }
      catch (error) { errors.push(`${account.label}: ${error instanceof Error ? error.message : 'Calendar sync failed.'}`); }
    }
    // Calendar imports are ledger mutations too, so send them to the other phone in this pass.
    for (const account of accounts) {
      if (!account.consent.ledgerStorage || !passphrase || blockedAccounts.has(account.id)) continue;
      try { await storageSync(account, passphrase); }
      catch (error) { errors.push(`${account.label}: ${error instanceof Error ? error.message : 'Upload failed.'}`); }
    }
    const conflicts = (await listProjections()).filter((p) => p.state === 'conflict').length;
    publish({ running: false, conflicts, lastSyncedAt: errors.length ? status.lastSyncedAt : new Date().toISOString(),
      message: errors.length ? [...new Set(errors)].join('\n') : accounts.length ? 'Accounts synchronized' : 'Connect an account to sync your phones' });
  } catch (error) {
    publish({ running: false, message: error instanceof Error ? error.message : 'Synchronization will retry.' });
  }
  return status;
}

export function synchronizeAccounts(): Promise<AccountSyncStatus> {
  if (activeJob) { rerunRequested = true; return activeJob; }
  activeJob = (async () => {
    do {
      rerunRequested = false;
      await runSync();
    } while (rerunRequested);
    return status;
  })().finally(() => { activeJob = null; });
  return activeJob;
}
