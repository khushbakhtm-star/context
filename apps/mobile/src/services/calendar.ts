import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar/legacy';
import * as CalendarRead from 'expo-calendar';
import { getEventColorsAsync } from '../../modules/context-calendar-colors';

import {
  deleteSyncBinding,
  getDaySegments,
  getEntriesForBlock,
  getPendingSyncDates,
  getPendingSyncDatesFor,
  getSyncBindings,
  getSyncBindingsForBlock,
  getSetting,
  getHasSharedLedgerPeer,
  remapActivitySyncBindings,
  markSyncDateComplete,
  markSyncDateFailed,
  saveSyncBinding,
  recolorExpectedMinuteEntries,
  setSetting,
} from '../data/database';
import { categoryById } from '../theme';
import type { ActivitySegment, CalendarPreferences, DeviceCalendar, PlannedEvent, SyncBinding } from '../types';
import { addDays, dateKey, localDateAtMinute, minuteLabel, parseDateKey } from '../utils/time';
import { isActivityGroupId } from '../utils/cell-format';
import { bindingInterval, matchActivityTranslation } from '../utils/activity-translation';
import { calendarColor, nativeEventColor } from '../utils/calendar-cell-color';
import { formatCalendarMinuteLog } from '../utils/calendar-minute-log';
import { getAccounts } from '../sync/accounts';
import { hasConfiguredAccountCalendarWriter } from './calendar-write-routing';
import { ensureSourceColorCategory, listCategories } from './categories';
import { hashValue } from '../sync/codec';
import { listProjections, localActivityColorHash, notifyCalendarColorImported, reconcileLinkedAccountColors,
  requireCalendarColorImportCurrent } from '../sync/engine';

function isWeb() {
  return Platform.OS === 'web';
}

let projectionTargetCalendarId: string | null = null;
let projectionGeneration = 0;

export function configureCalendarProjection(calendarId: string | null) {
  if (projectionTargetCalendarId === calendarId) return;
  projectionTargetCalendarId = calendarId;
  projectionGeneration += 1;
}

class ProjectionCancelledError extends Error {}

async function accountOwnedCalendarBlocks() {
  // A paused/revoked source link still owns its activity until explicitly
  // removed. Falling back to the phone provider must not bypass that review.
  return new Set((await listProjections()).filter((projection) => projection.state !== 'deleted')
    .map((projection) => projection.blockId));
}

async function requireNativeWriteAuthority(blockId: string, canContinue: () => boolean) {
  if (!canContinue() || await hasConfiguredAccountCalendarWriter() ||
      (await accountOwnedCalendarBlocks()).has(blockId) || !canContinue()) throw new ProjectionCancelledError();
}

export async function getCalendarPermissionStatus() {
  if (isWeb()) return 'unavailable';
  const response = await Calendar.getCalendarPermissionsAsync();
  return response.status;
}

export async function requestCalendarAccess() {
  if (isWeb()) return false;
  const response = await Calendar.requestCalendarPermissionsAsync();
  return response.status === 'granted';
}

export async function listDeviceCalendars(): Promise<DeviceCalendar[]> {
  if (isWeb()) return [];
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return calendars
    .map((calendar) => ({
      id: calendar.id,
      title: calendar.title,
      color: calendar.color || '#8E8C86',
      allowsModifications: calendar.allowsModifications,
      sourceName: calendar.source?.name || calendar.ownerAccount || 'On this device',
      isPrimary: calendar.isPrimary ?? false,
      isVisible: calendar.isVisible,
      isSynced: calendar.isSynced,
    }))
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
      return `${left.sourceName}${left.title}`.localeCompare(`${right.sourceName}${right.title}`);
    });
}

export type CalendarReadFailure = { calendarId: string; code: string };
export type CalendarReadSource = 'readmodern' | 'legacy';
export type CalendarReadStatus = {
  calendarId: string;
  source: CalendarReadSource;
  status: 'ok' | 'failed' | 'invalid-events';
  queriedEvents: number;
  acceptedEvents: number;
  timedEvents: number;
  allDayEvents: number;
  discardedInvalidTimes: number;
  discardedInvalidIdentities: number;
  outsideDayEvents: number;
  isVisible?: boolean;
  isSynced?: boolean;
  errorCode?: string;
};
export type CalendarReadDiagnostics = {
  dateKey: string;
  checkedAt: string;
  selectedCalendarIds: string[];
  calendars: CalendarReadStatus[];
  totalPlans: number;
  failedCalendarCount: number;
};
export type PlannedEventsResult = { plans: PlannedEvent[]; failures: CalendarReadFailure[] };

export class CalendarReadError extends Error {
  constructor(readonly partialPlans: PlannedEvent[], readonly failures: CalendarReadFailure[]) {
    super('Some selected calendar plans could not be read. Check the calendar connection details.');
    this.name = 'CalendarReadError';
  }
}

let calendarReadChain: Promise<void> = Promise.resolve();
let calendarReadDiagnostics: CalendarReadDiagnostics | null = null;
const verifiedNativeEventColors = new WeakMap<PlannedEvent, boolean>();

/** Metadata only: no event titles, descriptions, attendees, or account labels are retained. */
export function getCalendarReadDiagnostics(): CalendarReadDiagnostics | null {
  return calendarReadDiagnostics ? { ...calendarReadDiagnostics,
    selectedCalendarIds: [...calendarReadDiagnostics.selectedCalendarIds],
    calendars: calendarReadDiagnostics.calendars.map((calendar) => ({ ...calendar })) } : null;
}

function calendarReadErrorCode(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(code)
    ? code : 'ERR_CALENDAR_READ_FAILED';
}

function modernReadUnavailable(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error) || !('message' in error)) return false;
  // Only Expo's method-unavailability error permits fallback. A permission or
  // provider error must remain visible rather than becoming a second, empty read.
  return error.code === 'ERR_UNAVAILABLE' && typeof error.message === 'string' &&
    error.message.startsWith('The method or property Calendar.listEvents is not available on ');
}

type ReadEvent = {
  readonly id?: unknown;
  readonly calendarId?: unknown;
  readonly title?: unknown;
  readonly notes?: unknown;
  readonly startDate?: unknown;
  readonly endDate?: unknown;
  readonly allDay?: unknown;
  readonly displayColor?: unknown;
  readonly eventColor?: unknown;
  readonly color?: unknown;
};

function readEventDate(value: unknown) {
  if (value instanceof Date) return new Date(value.getTime());
  return typeof value === 'string' || typeof value === 'number' ? new Date(value) : new Date(NaN);
}

/**
 * Read each selected calendar independently. The modern Android mapper ignores
 * empty RRULE strings and lets the provider return overlapping instances, unlike
 * the legacy mapper/query. Serialize native reads and property extraction because
 * both installed Android APIs use a shared, non-thread-safe date formatter.
 */
export function loadPlannedEventsResult(
  calendarIds: string[],
  value: string,
  calendars: DeviceCalendar[],
): Promise<PlannedEventsResult> {
  const selectedIds = [...new Set(calendarIds)];
  const work = async (): Promise<PlannedEventsResult> => {
    const dayStart = parseDateKey(value);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = addDays(dayStart, 1);
    dayEnd.setHours(0, 0, 0, 0);
    const legacyStart = addDays(dayStart, -1);
    const legacyEnd = addDays(dayEnd, 1);
    const byCalendar = new Map(calendars.map((calendar) => [calendar.id, calendar]));
    const uniqueEvents = new Map<string, PlannedEvent>();
    const statuses: CalendarReadStatus[] = [];
    const failures: CalendarReadFailure[] = [];

    for (const calendarId of selectedIds) {
      const calendar = byCalendar.get(calendarId);
      const flags = calendar as (DeviceCalendar & { isVisible?: boolean; isSynced?: boolean }) | undefined;
      const status: CalendarReadStatus = { calendarId,
        source: Platform.OS === 'android' && typeof CalendarRead.listEvents === 'function' ? 'readmodern' : 'legacy',
        status: 'ok', queriedEvents: 0, acceptedEvents: 0, timedEvents: 0, allDayEvents: 0,
        discardedInvalidTimes: 0, discardedInvalidIdentities: 0, outsideDayEvents: 0,
        ...(typeof flags?.isVisible === 'boolean' ? { isVisible: flags.isVisible } : {}),
        ...(typeof flags?.isSynced === 'boolean' ? { isSynced: flags.isSynced } : {}) };
      statuses.push(status);
      try {
        if (isWeb()) throw { code: 'ERR_CALENDAR_UNAVAILABLE' };
        if (typeof calendarId !== 'string' || !calendarId.trim()) throw { code: 'ERR_INVALID_CALENDAR_ID' };
        let events: ReadEvent[];
        if (status.source === 'readmodern') {
          try {
            events = await CalendarRead.listEvents([calendarId], dayStart, dayEnd);
          } catch (error) {
            if (!modernReadUnavailable(error)) throw error;
            status.source = 'legacy';
            events = await Calendar.getEventsAsync([calendarId], legacyStart, legacyEnd);
          }
        } else {
          events = await Calendar.getEventsAsync([calendarId], legacyStart, legacyEnd);
        }
        if (!Array.isArray(events)) throw { code: 'ERR_INVALID_CALENDAR_RESPONSE' };
        const eventColors = await getEventColorsAsync([calendarId], dayStart.getTime(), dayEnd.getTime());
        status.queriedEvents = events.length;
        for (const event of events) {
          if (!event || typeof event.id !== 'string' || !event.id || event.calendarId !== calendarId) {
            status.discardedInvalidIdentities += 1;
            continue;
          }
          const startDate = readEventDate(event.startDate);
          const endDate = readEventDate(event.endDate);
          if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || endDate <= startDate) {
            status.discardedInvalidTimes += 1;
            continue;
          }
          if (startDate >= dayEnd || endDate <= dayStart) {
            status.outsideDayEvents += 1;
            continue;
          }
          const plannedEvent: PlannedEvent = { id: event.id, calendarId,
            title: typeof event.title === 'string' && event.title ? event.title : 'Untitled event',
            notes: typeof event.notes === 'string' && event.notes ? event.notes : undefined,
            color: nativeEventColor(event, startDate, eventColors, calendar?.color), sourceProvider: 'device',
            startDate, endDate, allDay: event.allDay === true };
          verifiedNativeEventColors.set(plannedEvent, Boolean(
            calendarColor(eventColors[`${event.id}@${startDate.getTime()}`]) ?? calendarColor(eventColors[event.id]) ??
            calendarColor(event.displayColor) ?? calendarColor(event.eventColor) ?? calendarColor(event.color)));
          const occurrenceKey = [calendarId, event.id, startDate.getTime(), endDate.getTime()].join(':');
          if (uniqueEvents.has(occurrenceKey)) continue;
          uniqueEvents.set(occurrenceKey, plannedEvent);
          status.acceptedEvents += 1;
          if (plannedEvent.allDay) status.allDayEvents += 1;
          else status.timedEvents += 1;
        }
        if (status.discardedInvalidTimes || status.discardedInvalidIdentities) {
          status.status = 'invalid-events';
          status.errorCode = status.discardedInvalidTimes ? 'ERR_INVALID_EVENT_TIMES' : 'ERR_INVALID_EVENT_IDENTITIES';
          failures.push({ calendarId, code: status.errorCode });
        }
      } catch (error) {
        status.status = 'failed';
        status.errorCode = calendarReadErrorCode(error);
        failures.push({ calendarId, code: status.errorCode });
      }
    }
    const plans = [...uniqueEvents.values()].sort((left, right) => left.startDate.getTime() - right.startDate.getTime());
    calendarReadDiagnostics = { dateKey: value, checkedAt: new Date().toISOString(),
      selectedCalendarIds: selectedIds, calendars: statuses, totalPlans: plans.length,
      failedCalendarCount: failures.length };
    return { plans, failures };
  };
  const job = calendarReadChain.then(work, work);
  calendarReadChain = job.then(() => undefined, () => undefined);
  return job;
}

export async function loadPlannedEvents(calendarIds: string[], value: string, calendars: DeviceCalendar[]): Promise<PlannedEvent[]> {
  const result = await loadPlannedEventsResult(calendarIds, value, calendars);
  if (result.failures.length) throw new CalendarReadError(result.plans, result.failures);
  return result.plans;
}

export const checkCalendarConnection = loadPlannedEventsResult;

type NativeColorReceipt = { version: 1; calendarId: string; eventId: string; remoteColor: string; localColorHash: string };
const nativeColorReceiptKey = (calendarId: string, eventId: string) =>
  `calendar.color-receipt.device.${encodeURIComponent(calendarId)}.${encodeURIComponent(eventId)}`;
let nativeColorChain: Promise<void> = Promise.resolve();

/** The caller explicitly reconciles known private bindings after a successful source
 * read. Listing calendar plans, including Print's reads, remains strictly read-only. */
export function reconcileLinkedNativeColors(value: string, plans: readonly PlannedEvent[], calendars: readonly DeviceCalendar[]): Promise<string[]> {
  const work = async () => {
    const changed = new Set<string>();
    const owned = await accountOwnedCalendarBlocks();
    await listCategories();
    for (const binding of await getSyncBindings(value)) {
      if (owned.has(binding.blockId)) continue;
      const plan = plans.find((item) => item.id === binding.eventId && item.calendarId === binding.calendarId && !item.allDay);
      const calendar = calendars.find((item) => item.id === binding.calendarId);
      if (!plan || !calendar || !verifiedNativeEventColors.get(plan)) continue;
      const color = calendarColor(plan.color)?.toUpperCase();
      if (!color) continue;
      const interval = bindingInterval(binding.segmentKey, binding.blockId);
      if (!interval) throw new Error('A linked activity needs review before importing its calendar color.');
      await requireUnchangedNativeEvent(binding);
      const entries = (await getEntriesForBlock(binding.blockId)).filter((entry) => entry.dateKey === interval.dateKey &&
        entry.minuteIndex >= interval.startMinute && entry.minuteIndex <= interval.endMinute);
      if (!entries.length) continue;
      const key = nativeColorReceiptKey(binding.calendarId, binding.eventId);
      const receipt = await getSetting<NativeColorReceipt | null>(key, null);
      if (receipt && (receipt.version !== 1 || receipt.calendarId !== binding.calendarId || receipt.eventId !== binding.eventId ||
          !calendarColor(receipt.remoteColor) || !/^[a-f0-9]{64}$/.test(receipt.localColorHash))) {
        throw new Error('A linked calendar color receipt needs review before synchronization.');
      }
      const localColorHash = localActivityColorHash(entries);
      const sameColor = entries.every((entry) => categoryById(entry.categoryId).color.toUpperCase() === color);
      const bootstrapExplicitColor = !receipt && entries.every((entry) => entry.categoryId === 'unaccounted') &&
        calendarColor(calendar.color)?.toUpperCase() !== color;
      if ((!receipt && !bootstrapExplicitColor) || receipt?.remoteColor.toUpperCase() === color) {
        if (!receipt) await setSetting(key, { version: 1, calendarId: binding.calendarId, eventId: binding.eventId,
          remoteColor: color, localColorHash } satisfies NativeColorReceipt);
        continue;
      }
      if (receipt && receipt.localColorHash !== localColorHash && !sameColor) {
        throw new Error('The activity color changed in Context and the calendar. Review both colors before synchronizing.');
      }
      const category = await ensureSourceColorCategory({ color, name: plan.title, provider: 'device', calendarId: binding.calendarId,
        preferredCategoryId: sameColor ? entries[0]!.categoryId : undefined });
      const next = entries.map((entry) => ({ ...entry, categoryId: category.id }));
      const guard = () => requireCalendarColorImportCurrent(entries);
      guard();
      if (await getCalendarPermissionStatus() !== 'granted') throw new Error('Calendar access changed. Retry after allowing calendar reading.');
      // Recheck exact ownership after the source/category awaits, before SQLite commit.
      const current = (await getSyncBindings(value)).find((item) => item.segmentKey === binding.segmentKey);
      if (!current || hashValue(current) !== hashValue(binding)) throw new Error('The calendar link changed. Refresh before importing its color.');
      if ((await accountOwnedCalendarBlocks()).has(binding.blockId)) continue;
      const affected = await recolorExpectedMinuteEntries(entries, category.id, { key, value: {
        version: 1, calendarId: binding.calendarId, eventId: binding.eventId, remoteColor: color,
        localColorHash: localActivityColorHash(next) } satisfies NativeColorReceipt }, guard);
      for (const day of affected) changed.add(day);
      notifyCalendarColorImported(next);
    }
    return [...changed];
  };
  const job = nativeColorChain.then(work, work);
  nativeColorChain = job.then(() => undefined, () => undefined);
  return job;
}

/** Explicit foreground import; no source event is created, changed or deleted. */
export async function reconcileLinkedCalendarColors(dates: readonly string[], calendars: readonly DeviceCalendar[],
  preferences: CalendarPreferences): Promise<string[]> {
  const changed = new Set<string>();
  if (dates.length > 366) throw new Error('Choose at most one year when refreshing linked calendar colors.');
  for (const value of [...new Set(dates)]) {
    if (!preferences.selectedCalendarIds.length) break;
    const result = await loadPlannedEventsResult(preferences.selectedCalendarIds, value, [...calendars]);
    if (result.failures.length) throw new CalendarReadError(result.plans, result.failures);
    for (const day of await reconcileLinkedNativeColors(value, result.plans, calendars)) changed.add(day);
  }
  for (const day of await reconcileLinkedAccountColors(dates)) changed.add(day);
  return [...changed];
}

export class CalendarPlanConnectionError extends Error {
  constructor(readonly reason: 'permission' | 'selection' | 'unavailable') {
    const messages = {
      permission: 'Allow calendar access before creating a connected plan.',
      selection: 'Select the phone calendar whose plans should appear in Context.',
      unavailable: 'No readable phone calendar is available.',
    };
    super(messages[reason]);
    this.name = 'CalendarPlanConnectionError';
  }
}

export async function createPlanInSystemCalendar(
  value: string,
  minuteIndex: number,
  selectedCalendarIds: readonly string[],
) {
  if (isWeb()) throw new CalendarPlanConnectionError('unavailable');
  if (await getCalendarPermissionStatus() !== 'granted') {
    throw new CalendarPlanConnectionError('permission');
  }
  const calendars = (await listDeviceCalendars())
    .filter((calendar) => calendar.isVisible !== false && calendar.isSynced !== false);
  if (calendars.length === 0) throw new CalendarPlanConnectionError('unavailable');
  const selectedIds = new Set(selectedCalendarIds);
  if (!calendars.some((calendar) => selectedIds.has(calendar.id))) {
    throw new CalendarPlanConnectionError('selection');
  }
  const safeMinute = Math.max(0, Math.min(1439, Math.trunc(minuteIndex)));
  const startDate = localDateAtMinute(value, safeMinute);
  const endDate = new Date(startDate);
  endDate.setMinutes(endDate.getMinutes() + 30);

  return await Calendar.createEventInCalendarAsync({
    title: 'New plan',
    startDate,
    endDate,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }, { startNewActivityTask: Platform.OS === 'android' });
}

export async function openPlannedEvent(event: PlannedEvent) {
  if (isWeb()) return null;
  return Calendar.openEventInCalendarAsync(
    { id: event.id, instanceStartDate: event.startDate },
    { allowsEditing: true, startNewActivityTask: Platform.OS === 'android' },
  );
}

function segmentTitle(segment: ActivitySegment) {
  if (segment.activityTitle) return segment.activityTitle;
  const first = segment.entries[0]?.text.trim();
  if (!first) return categoryById(segment.categoryId).name;
  if (first.length <= 64) return first;
  return `${first.slice(0, 61).trimEnd()}...`;
}

function eventDetails(segment: ActivitySegment) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    title: segmentTitle(segment),
    startDate: localDateAtMinute(segment.dateKey, segment.startMinute),
    endDate: localDateAtMinute(segment.dateKey, segment.endMinute + 1),
    timeZone,
    notes: formatCalendarMinuteLog(segment.entries),
  };
}

type NativeWriteReceipt = { version: 1; calendarId: string; eventId: string; contentHash: string };
const nativeWriteReceiptKey = (calendarId: string, eventId: string) =>
  `calendar.native-write.v1.${encodeURIComponent(calendarId)}.${encodeURIComponent(eventId)}`;
function nativeEventContentHash(event: { title?: unknown; notes?: unknown; startDate?: unknown; endDate?: unknown;
  allDay?: unknown; recurrenceRule?: unknown }) {
  const start = readEventDate(event.startDate).getTime(); const end = readEventDate(event.endDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('A linked calendar event has invalid times. Review it before synchronizing.');
  const rule = event.recurrenceRule;
  const recurring = typeof rule === 'string' ? rule.trim().length > 0 : rule && typeof rule === 'object'
    ? Object.values(rule).some((value) => value !== null && value !== undefined && value !== '') : Boolean(rule);
  return hashValue({ title: typeof event.title === 'string' ? event.title : '',
    notes: typeof event.notes === 'string' ? event.notes.replace(/\r\n/g, '\n') : '', start, end,
    allDay: event.allDay === true, recurring });
}
async function recordNativeWrite(calendarId: string, eventId: string, segment: ActivitySegment) {
  await setSetting(nativeWriteReceiptKey(calendarId, eventId), { version: 1, calendarId, eventId,
    contentHash: nativeEventContentHash(eventDetails(segment)) } satisfies NativeWriteReceipt);
}
async function requireUnchangedNativeEvent(binding: SyncBinding) {
  let event: { calendarId: string; title?: unknown; notes?: unknown; startDate?: unknown; endDate?: unknown;
    allDay?: unknown; recurrenceRule?: unknown };
  try {
    if (Platform.OS === 'android' && typeof CalendarRead.ExpoCalendarEvent?.get === 'function') {
      const read = calendarReadChain.then(async () => {
        const current = await CalendarRead.ExpoCalendarEvent.get(binding.eventId);
        // Extract shared native getters while holding the same mapper lease as
        // listEvents, bypassing the legacy Android empty-RRULE conversion.
        return { calendarId: current.calendarId, title: current.title, notes: current.notes,
          startDate: current.startDate, endDate: current.endDate, allDay: current.allDay, recurrenceRule: current.recurrenceRule };
      });
      calendarReadChain = read.then(() => undefined, () => undefined);
      event = await read;
    } else event = await Calendar.getEventAsync(binding.eventId);
  }
  catch (error) { if (isEventNotFoundError(error)) return; throw error; }
  if (event.calendarId !== binding.calendarId) throw new Error('A linked calendar event changed calendars. Review it before synchronizing.');
  const key = nativeWriteReceiptKey(binding.calendarId, binding.eventId);
  const receipt = await getSetting<NativeWriteReceipt | null>(key, null);
  const contentHash = nativeEventContentHash(event);
  if (receipt) {
    if (receipt.version !== 1 || receipt.calendarId !== binding.calendarId || receipt.eventId !== binding.eventId ||
        !/^[a-f0-9]{64}$/.test(receipt.contentHash) || receipt.contentHash !== contentHash) {
      throw new Error('This linked event was edited in your calendar. Its title, times and notes were kept. Review and link those changes before synchronizing this activity.');
    }
  } else {
    // Older native copies have only an exact private event ID and their bound
    // interval. A moved/resized event is not the old slot's disposable copy.
    const interval = bindingInterval(binding.segmentKey, binding.blockId);
    if (!interval || event.allDay || readEventDate(event.startDate).getTime() !== localDateAtMinute(interval.dateKey, interval.startMinute).getTime() ||
        readEventDate(event.endDate).getTime() !== localDateAtMinute(interval.dateKey, interval.endMinute + 1).getTime()) {
      throw new Error('This linked event moved or changed duration in your calendar. It was kept. Review and link its new time before synchronizing or resetting the old cells.');
    }
    await setSetting(key, { version: 1, calendarId: binding.calendarId, eventId: binding.eventId, contentHash } satisfies NativeWriteReceipt);
  }
}

type NativeCreateIntent = { version: 1; calendarId: string; blockId: string; segmentKey: string; eventId: string | null };
const nativeIntentKey = (calendarId: string, blockId: string) =>
  `calendar.create-intent:${encodeURIComponent(calendarId)}:${encodeURIComponent(blockId)}`;

async function readNativeCreateIntent(calendarId: string, segment: ActivitySegment) {
  const value = await getSetting<NativeCreateIntent | null>(nativeIntentKey(calendarId, segment.blockId), null);
  if (value == null) return null;
  if (value.version !== 1 || value.calendarId !== calendarId || value.blockId !== segment.blockId ||
      typeof value.segmentKey !== 'string' || !value.segmentKey ||
      !(value.eventId === null || typeof value.eventId === 'string' && value.eventId.length > 0)) {
    throw new Error('An unfinished calendar update needs review before synchronization can continue.');
  }
  return value;
}

async function clearNativeCreateIntent(calendarId: string, segment: ActivitySegment, eventId: string) {
  const intent = await readNativeCreateIntent(calendarId, segment);
  if (intent?.eventId === eventId) await setSetting(nativeIntentKey(calendarId, segment.blockId), null);
}

async function createSegmentEvent(
  calendarId: string,
  segment: ActivitySegment,
  claimedEventIds: Set<string>,
  canContinue: () => boolean,
) {
  if (!canContinue()) throw new ProjectionCancelledError();
  const marker = `Context projection: ${segment.segmentKey}`;
  const blockMarker = `Context block: ${segment.blockId}`;
  const dayStart = parseDateKey(segment.dateKey);
  dayStart.setHours(0, 0, 0, 0);
  const queryStart = addDays(dayStart, -1);
  const queryEnd = addDays(dayStart, 2);
  const candidates = await Calendar.getEventsAsync([calendarId], queryStart, queryEnd);
  if (!canContinue()) throw new ProjectionCancelledError();
  const availableCandidates = candidates.filter(
    (event) =>
      !claimedEventIds.has(event.id) &&
      dateKey(new Date(event.startDate)) === segment.dateKey,
  );
  const existing =
    availableCandidates.find((event) =>
      event.notes?.split(/\r?\n/).includes(marker),
    ) ??
    availableCandidates.find((event) =>
      event.notes?.split(/\r?\n/).includes(blockMarker),
    );
  if (existing) {
    await requireUnchangedNativeEvent({ calendarId, eventId: existing.id, blockId: segment.blockId,
      segmentKey: segment.segmentKey, dateKey: segment.dateKey, updatedAt: '' });
    await requireNativeWriteAuthority(segment.blockId, canContinue);
    const updatedId = await Calendar.updateEventAsync(existing.id, eventDetails(segment));
    const eventId = updatedId || existing.id;
    await recordNativeWrite(calendarId, eventId, segment);
    claimedEventIds.add(eventId);
    return eventId;
  }
  const intentKey = nativeIntentKey(calendarId, segment.blockId);
  let intent = await readNativeCreateIntent(calendarId, segment);
  if (intent?.eventId && (await getSyncBindingsForBlock(segment.blockId)).some((binding) =>
    binding.calendarId === calendarId && binding.eventId === intent!.eventId)) {
    await setSetting(intentKey, null);
    intent = null;
  }
  if (intent) {
    if (!intent.eventId || intent.segmentKey !== segment.segmentKey || claimedEventIds.has(intent.eventId)) {
      throw new Error('A previous device-calendar creation has an uncertain result, so this link is paused to prevent duplicates. Review and link any existing calendar event before using account calendar editing. Enabling editing alone does not reuse an existing device-calendar event.');
    }
    if (!await boundEventIsDefinitelyMissing(intent.eventId)) {
      const recorded = await Calendar.getEventAsync(intent.eventId);
      if (recorded.calendarId !== calendarId) throw new Error('The unfinished calendar update belongs to a different calendar.');
      await requireUnchangedNativeEvent({ calendarId, eventId: intent.eventId, blockId: segment.blockId,
        segmentKey: segment.segmentKey, dateKey: segment.dateKey, updatedAt: '' });
      await requireNativeWriteAuthority(segment.blockId, canContinue);
      const updatedId = await Calendar.updateEventAsync(intent.eventId, eventDetails(segment));
      const recoveredId = updatedId || intent.eventId;
      await recordNativeWrite(calendarId, recoveredId, segment);
      if (recoveredId !== intent.eventId) await setSetting(intentKey, { ...intent, eventId: recoveredId });
      claimedEventIds.add(recoveredId);
      return recoveredId;
    }
    // This exact returned event ID is confirmed gone; creating a replacement cannot duplicate it.
    await setSetting(intentKey, null);
  }
  if (!canContinue()) throw new ProjectionCancelledError();
  if ((await getAccounts()).some((account) => account.consent.ledgerStorage) && await getHasSharedLedgerPeer()) {
    throw new Error('This shared ledger pauses new device-calendar activities to prevent duplicates. Review and link any existing calendar event before using account calendar editing. Enabling editing alone does not reuse an existing device-calendar event.');
  }
  const pending: NativeCreateIntent = { version: 1, calendarId, blockId: segment.blockId, segmentKey: segment.segmentKey, eventId: null };
  await setSetting(intentKey, pending);
  if (!canContinue()) { await setSetting(intentKey, null); throw new ProjectionCancelledError(); }
  try { await requireNativeWriteAuthority(segment.blockId, canContinue); }
  catch (error) { await setSetting(intentKey, null); throw error; }
  const eventId = await Calendar.createEventAsync(calendarId, eventDetails(segment));
  if (!eventId) throw new Error('The calendar did not return its event identifier, so this device-calendar link is paused. Review and link any existing calendar event before using account calendar editing; enabling editing alone does not reuse it.');
  await setSetting(intentKey, { ...pending, eventId });
  await recordNativeWrite(calendarId, eventId, segment);
  claimedEventIds.add(eventId);
  return eventId;
}

function isEventNotFoundError(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  // Android and iOS Expo modules currently use these respective coded-error forms.
  return code === 'E_EVENT_NOT_FOUND' || code === 'ERR_EVENT_NOT_FOUND';
}

async function boundEventIsDefinitelyMissing(eventId: string) {
  try {
    await Calendar.getEventAsync(eventId);
    return false;
  } catch (error) {
    if (isEventNotFoundError(error)) return true;
    // Permission, provider, and transient errors are not evidence that the event vanished.
    throw error;
  }
}

type ReconciliationResult = {
  eventId: string;
  action: 'created' | 'updated';
};

async function updateOrReplaceEvent(
  targetCalendarId: string,
  segment: ActivitySegment,
  binding: SyncBinding,
  claimedEventIds: Set<string>,
  canContinue: () => boolean,
): Promise<ReconciliationResult> {
  await requireUnchangedNativeEvent(binding);
  if (binding.calendarId !== targetCalendarId) {
    // Create first so changing the destination can never erase the only remote copy.
    const replacementId = await createSegmentEvent(
      targetCalendarId,
      segment,
      claimedEventIds,
      canContinue,
    );
    try { await requireNativeWriteAuthority(segment.blockId, canContinue); await requireUnchangedNativeEvent(binding); }
    catch (error) {
      // The in-flight create finished after opt-out. Roll it back so the old binding remains true.
      await Calendar.deleteEventAsync(replacementId).catch(() => undefined);
      throw error;
    }
    try {
      await Calendar.deleteEventAsync(binding.eventId);
    } catch (deleteError) {
      if (!canContinue()) {
        await Calendar.deleteEventAsync(replacementId).catch(() => undefined);
        throw new ProjectionCancelledError();
      }
      let oldEventIsGone = false;
      try {
        oldEventIsGone = await boundEventIsDefinitelyMissing(binding.eventId);
      } catch {
        oldEventIsGone = false;
      }
      if (!canContinue()) {
        await Calendar.deleteEventAsync(replacementId).catch(() => undefined);
        throw new ProjectionCancelledError();
      }
      if (!oldEventIsGone) {
        // Keep the old binding intact. Best-effort rollback prevents an untracked duplicate.
        await Calendar.deleteEventAsync(replacementId).catch(() => undefined);
        throw deleteError;
      }
    }
    return { eventId: replacementId, action: 'created' };
  }

  await requireNativeWriteAuthority(segment.blockId, canContinue);
  try {
    const updatedId = await Calendar.updateEventAsync(binding.eventId, eventDetails(segment));
    await recordNativeWrite(targetCalendarId, updatedId || binding.eventId, segment);
    return { eventId: updatedId || binding.eventId, action: 'updated' };
  } catch (updateError) {
    if (!canContinue()) throw new ProjectionCancelledError();
    let eventIsMissing = false;
    try {
      eventIsMissing = await boundEventIsDefinitelyMissing(binding.eventId);
    } catch {
      // A failed lookup is not a safe reason to create a second copy.
      throw updateError;
    }
    if (!canContinue()) throw new ProjectionCancelledError();
    if (!eventIsMissing) throw updateError;

    const replacementId = await createSegmentEvent(
      targetCalendarId,
      segment,
      claimedEventIds,
      canContinue,
    );
    return { eventId: replacementId, action: 'created' };
  }
}

export type CalendarSyncResult = {
  created: number;
  updated: number;
  removed: number;
  deferred?: true;
};

export async function syncActualDay(
  value: string,
  calendarId: string,
  canContinue: () => boolean = () => true,
): Promise<CalendarSyncResult> {
  if (isWeb()) return { created: 0, updated: 0, removed: 0 };
  if (await hasConfiguredAccountCalendarWriter()) return { created: 0, updated: 0, removed: 0, deferred: true };
  const owned = await accountOwnedCalendarBlocks();
  const allSegments = await getDaySegments(value);
  const segments = allSegments.filter((segment) => !owned.has(segment.blockId));
  for (const blockId of new Set(segments.filter((segment) => isActivityGroupId(segment.blockId)).map((segment) => segment.blockId))) {
    const members = await getEntriesForBlock(blockId);
    if (!members.every((entry) => entry.dateKey === value)) continue;
    const existing = await getSyncBindingsForBlock(blockId);
    if (!existing.length) continue;
    const previous = existing.map((binding) => bindingInterval(binding.segmentKey, blockId));
    const current = segments.filter((segment) => segment.blockId === blockId).map((segment) => ({ key: segment.segmentKey,
      dateKey: segment.dateKey, startMinute: segment.startMinute, endMinute: segment.endMinute }));
    const mapping = previous.every((interval) => interval != null)
      ? matchActivityTranslation(previous, current) : null;
    if (mapping && mapping.shiftMinutes !== 0) {
      if (!canContinue()) throw new ProjectionCancelledError();
      await requireNativeWriteAuthority(blockId, canContinue);
      for (const binding of existing) await requireUnchangedNativeEvent(binding);
      await remapActivitySyncBindings(blockId, mapping.matches.map(({ previous: old, current: next }) => {
        const before = existing.find((binding) => binding.segmentKey === old.key)!;
        return { before, after: { ...before, segmentKey: next.key, dateKey: next.dateKey } };
      }), members);
    } else if (!mapping && existing.some((binding) => binding.dateKey !== value) &&
        previous.every((interval) => interval != null) &&
        previous.reduce((total, interval) => total + interval.endMinute - interval.startMinute + 1, 0) === members.length) {
      throw new Error('This activity moved with an ambiguous calendar shape. Review its linked events before synchronizing.');
    }
  }
  const allBindings = await getSyncBindings(value);
  const bindings = allBindings.filter((binding) => !owned.has(binding.blockId));
  const deferred = allSegments.length !== segments.length || allBindings.length !== bindings.length;
  const unused = new Map(bindings.map((binding) => [binding.segmentKey, binding]));
  const claimedEventIds = new Set(
    bindings
      .filter((binding) => binding.calendarId === calendarId)
      .map((binding) => binding.eventId),
  );
  const byBlock = new Map<string, SyncBinding[]>();
  for (const binding of bindings) {
    const list = byBlock.get(binding.blockId) ?? [];
    list.push(binding);
    byBlock.set(binding.blockId, list);
  }

  let created = 0;
  let updated = 0;

  for (const segment of segments) {
    if (!canContinue()) throw new ProjectionCancelledError();
    let binding = unused.get(segment.segmentKey);
    if (!binding) {
      binding = (byBlock.get(segment.blockId) ?? []).find((candidate) =>
        unused.has(candidate.segmentKey),
      );
    }

    if (binding) {
      unused.delete(binding.segmentKey);
      const reconciliation = await updateOrReplaceEvent(
        calendarId,
        segment,
        binding,
        claimedEventIds,
        canContinue,
      );
      claimedEventIds.add(reconciliation.eventId);
      await saveSyncBinding(
        {
          segmentKey: segment.segmentKey,
          blockId: segment.blockId,
          dateKey: segment.dateKey,
          calendarId,
          eventId: reconciliation.eventId,
        },
        binding.segmentKey,
      );
      await clearNativeCreateIntent(calendarId, segment, reconciliation.eventId);
      if (!canContinue()) throw new ProjectionCancelledError();
      if (reconciliation.action === 'created') created += 1;
      else updated += 1;
    } else {
      const eventId = await createSegmentEvent(
        calendarId,
        segment,
        claimedEventIds,
        canContinue,
      );
      await saveSyncBinding({
        segmentKey: segment.segmentKey,
        blockId: segment.blockId,
        dateKey: segment.dateKey,
        calendarId,
        eventId,
      });
      await clearNativeCreateIntent(calendarId, segment, eventId);
      if (!canContinue()) throw new ProjectionCancelledError();
      created += 1;
    }
  }

  let removed = 0;
  let cleanupError: unknown;
  for (const binding of unused.values()) {
    if (!canContinue()) throw new ProjectionCancelledError();
    if (isActivityGroupId(binding.blockId) && !segments.some((segment) => segment.blockId === binding.blockId) &&
        (await getEntriesForBlock(binding.blockId)).some((entry) => entry.dateKey !== value)) {
      const members = await getEntriesForBlock(binding.blockId);
      const existing = await getSyncBindingsForBlock(binding.blockId);
      const previous = existing.map((item) => bindingInterval(item.segmentKey, binding.blockId));
      const current = (await Promise.all([...new Set(members.map((member) => member.dateKey))].map(getDaySegments)))
        .flat().filter((segment) => segment.blockId === binding.blockId).map((segment) => ({ key: segment.segmentKey,
          dateKey: segment.dateKey, startMinute: segment.startMinute, endMinute: segment.endMinute }));
      const mapping = previous.every((interval) => interval != null) ? matchActivityTranslation(previous, current) : null;
      if (mapping && mapping.shiftMinutes !== 0) {
        // The target date's durable outbox updates these same events. Empty-source
        // cleanup must not delete them before that date has been processed.
        continue;
      }
      if (!mapping && previous.every((interval) => interval != null) &&
          previous.reduce((total, interval) => total + interval.endMinute - interval.startMinute + 1, 0) === members.length) {
        throw new Error('This activity moved with an ambiguous calendar shape. Review its linked events before synchronizing.');
      }
    }
    let remoteEventIsGone = false;
    await requireNativeWriteAuthority(binding.blockId, canContinue);
    await requireUnchangedNativeEvent(binding);
    try {
      await Calendar.deleteEventAsync(binding.eventId);
      remoteEventIsGone = true;
    } catch (deleteError) {
      if (!canContinue()) throw new ProjectionCancelledError();
      try {
        remoteEventIsGone = await boundEventIsDefinitelyMissing(binding.eventId);
      } catch {
        remoteEventIsGone = false;
      }
      if (!canContinue()) throw new ProjectionCancelledError();
      if (!remoteEventIsGone) {
        cleanupError ??= deleteError;
        continue;
      }
    }

    // A binding is removed only after deletion succeeds or absence is confirmed.
    try {
      await deleteSyncBinding(binding.segmentKey);
      removed += 1;
      if (!canContinue()) throw new ProjectionCancelledError();
    } catch (error) {
      cleanupError ??= error;
    }
  }

  if (cleanupError) throw cleanupError;
  return { created, updated, removed, ...(deferred ? { deferred: true as const } : {}) };
}

export type CalendarOutboxResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  remaining: number;
  deferred?: true;
};

async function flushPendingActualsOnce(
  calendarId: string,
  limit: number,
  priorityDates: string[],
  expectedGeneration: number,
): Promise<CalendarOutboxResult> {
  if (await hasConfiguredAccountCalendarWriter()) {
    const remaining = (await getPendingSyncDates(1)).length;
    return { attempted: 0, succeeded: 0, failed: 0, remaining, ...(remaining ? { deferred: true as const } : {}) };
  }
  const [priority, ordinary] = await Promise.all([
    getPendingSyncDatesFor(priorityDates),
    getPendingSyncDates(limit),
  ]);
  const pendingByDate = new Map(priority.map((item) => [item.dateKey, item]));
  for (const item of ordinary) {
    if (!pendingByDate.has(item.dateKey)) pendingByDate.set(item.dateKey, item);
  }
  const pending = [...pendingByDate.values()];
  let succeeded = 0;
  let failed = 0;
  let deferred = false;
  const canContinue = () =>
    projectionGeneration === expectedGeneration &&
    projectionTargetCalendarId === calendarId;

  for (const item of pending) {
    if (!canContinue()) break;
    try {
      const owned = await accountOwnedCalendarBlocks();
      if ((await getSyncBindings(item.dateKey)).some((binding) => binding.calendarId === calendarId && !owned.has(binding.blockId))) {
        const calendars = await listDeviceCalendars();
        const read = await loadPlannedEventsResult([calendarId], item.dateKey, calendars);
        if (read.failures.length) throw new CalendarReadError(read.plans, read.failures);
        await reconcileLinkedNativeColors(item.dateKey, read.plans, calendars);
      }
      if (!canContinue()) throw new ProjectionCancelledError();
      const result = await syncActualDay(item.dateKey, calendarId, canContinue);
      if (!canContinue()) throw new ProjectionCancelledError();
      if (result.deferred) { deferred = true; continue; }
      await markSyncDateComplete(item.dateKey, item.updatedAt);
      succeeded += 1;
    } catch (error) {
      if (error instanceof ProjectionCancelledError) break;
      await markSyncDateFailed(item.dateKey, item.updatedAt, error).catch(() => undefined);
      failed += 1;
    }
  }

  const remaining = (await getPendingSyncDates(1)).length;
  return { attempted: pending.length, succeeded, failed, remaining, ...(deferred ? { deferred: true as const } : {}) };
}

let outboxChain: Promise<void> = Promise.resolve();

/**
 * Serializes calendar projection work and consumes durable SQLite outbox rows. Every call queues a
 * fresh pass, so an edit that arrives during an earlier pass is not stranded when that pass ends.
 */
export function flushPendingActuals(
  calendarId: string,
  priorityDates: string[] = [],
  limit = 90,
): Promise<CalendarOutboxResult> {
  const expectedGeneration = projectionGeneration;
  const job = outboxChain.then(() =>
    flushPendingActualsOnce(calendarId, limit, priorityDates, expectedGeneration),
  );
  outboxChain = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}
