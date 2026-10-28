import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar/legacy';
import * as CalendarRead from 'expo-calendar';
import { getEventColorsAsync } from '../../modules/context-calendar-colors';

import {
  deleteSyncBinding,
  getDayCalendarSegments,
  getEntriesForBlock,
  getActivityTitleForEntries,
  getSpreadsheetCells,
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
  replaceProjectedMinutes,
  setSetting,
} from '../data/database';
import { categoryById } from '../theme';
import type { ActivitySegment, CalendarPreferences, DeviceCalendar, MinuteEntry, PlannedEvent, SyncBinding } from '../types';
import { addDays, dateKey, localDateAtMinute, minuteIndexForDate, minuteLabel, parseDateKey } from '../utils/time';
import { isActivityGroupId } from '../utils/cell-format';
import { bindingInterval, matchActivityTranslation } from '../utils/activity-translation';
import { calendarColor, nativeEventColor } from '../utils/calendar-cell-color';
import { formatCalendarMinuteLog, parseCalendarMinuteLog, parseCompactCalendarMinuteLog } from '../utils/calendar-minute-log';
import { makeCompactCalendarDescription, isDescriptionLog, type DescriptionLog } from '../utils/calendar-description';
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

async function requireNativeWriteAuthority(blockId: string, canContinue: () => boolean, binding?: SyncBinding) {
  if (!canContinue() || (await accountOwnedCalendarBlocks()).has(blockId)) throw new ProjectionCancelledError();
  if (binding) {
    const current = (await getSyncBindingsForBlock(blockId)).find((item) => item.segmentKey === binding.segmentKey);
    if (projectionTargetCalendarId !== binding.calendarId || !current || hashValue(current) !== hashValue(binding)) {
      throw new ProjectionCancelledError();
    }
  } else if (await hasConfiguredAccountCalendarWriter()) throw new ProjectionCancelledError();
  if (!canContinue() || (await accountOwnedCalendarBlocks()).has(blockId) || !canContinue()) throw new ProjectionCancelledError();
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
const verifiedNativeSelections = new WeakMap<readonly PlannedEvent[], { dateKey: string; calendarIds: readonly string[] }>();

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
    if (!failures.length) verifiedNativeSelections.set(plans, { dateKey: value, calendarIds: selectedIds });
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
    const read = verifiedNativeSelections.get(plans);
    const selectedCalendars = read?.dateKey === value ? calendars.filter((calendar) => read.calendarIds.includes(calendar.id)) : [];
    const changed = new Set(await importLinkedNativeEdits(value, selectedCalendars));
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
      const writeKey = nativeWriteReceiptKey(binding.calendarId, binding.eventId);
      const writeReceipt = await getSetting<NativeWriteReceipt | null>(writeKey, null);
      if (writeReceipt?.version === 2) {
        const title = await getActivityTitleForEntries(next);
        const segment: ActivitySegment = { ...interval, segmentKey: binding.segmentKey, blockId: binding.blockId,
          categoryId: category.id, entries: next, ...(title ? { activityTitle: title } : {}) };
        // Color-only imports are acknowledged local state, not a pending edit.
        await setSetting(writeKey, { ...writeReceipt, localHash: nativeLocalHash(segment) });
      }
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

function eventDetails(segment: ActivitySegment, sourceTitle?: string) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const sourceLabel = sourceTitle === undefined ? undefined : sourceTitle.trim().slice(0, 200) || 'Untitled event';
  return {
    title: segment.activityTitle && segment.activityTitle !== sourceLabel
      ? segment.activityTitle : sourceTitle !== undefined ? sourceTitle : segmentTitle(segment),
    startDate: localDateAtMinute(segment.dateKey, segment.startMinute),
    endDate: localDateAtMinute(segment.dateKey, segment.endMinute + 1),
    timeZone,
    notes: makeCompactCalendarDescription('', segment.entries).description,
  };
}

type NativeWriteReceipt = { version: 1 | 2; calendarId: string; eventId: string; contentHash: string;
  localHash?: string; sourceTitle?: string; descriptionLog?: DescriptionLog };
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
function nativeLocalHash(segment: ActivitySegment) {
  return hashValue({ blockId: segment.blockId, activityTitle: segment.activityTitle ?? null,
    entries: segment.entries.map(({ dateKey, minuteIndex, text, categoryId }) => ({ dateKey, minuteIndex, text, categoryId })) });
}
async function recordNativeWrite(calendarId: string, eventId: string, segment: ActivitySegment,
  details = eventDetails(segment)) {
  await setSetting(nativeWriteReceiptKey(calendarId, eventId), { version: 2, calendarId, eventId,
    contentHash: nativeEventContentHash(details), localHash: nativeLocalHash(segment), sourceTitle: details.title.slice(0, 200),
    descriptionLog: makeCompactCalendarDescription('', segment.entries).descriptionLog } satisfies NativeWriteReceipt);
}
type NativeBoundEvent = { calendarId: string; title?: unknown; notes?: unknown; startDate?: unknown; endDate?: unknown;
  allDay?: unknown; recurrenceRule?: unknown; displayColor?: unknown; eventColor?: unknown; color?: unknown };
async function readNativeBoundEvent(binding: SyncBinding): Promise<NativeBoundEvent | null> {
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
      return await read;
    } else return await Calendar.getEventAsync(binding.eventId);
  }
  catch (error) { if (isEventNotFoundError(error)) return null; throw error; }
}
async function requireUnchangedNativeEvent(binding: SyncBinding) {
  const event = await readNativeBoundEvent(binding);
  if (!event) return null;
  if (event.calendarId !== binding.calendarId) throw new Error('A linked calendar event changed calendars. Review it before synchronizing.');
  const key = nativeWriteReceiptKey(binding.calendarId, binding.eventId);
  const receipt = await getSetting<NativeWriteReceipt | null>(key, null);
  const contentHash = nativeEventContentHash(event);
  if (receipt) {
    if (![1, 2].includes(receipt.version) || receipt.calendarId !== binding.calendarId || receipt.eventId !== binding.eventId ||
        !/^[a-f0-9]{64}$/.test(receipt.contentHash) || receipt.contentHash !== contentHash) {
      throw new Error('This linked event was edited in your calendar. Its title, times and notes were kept. Review and link those changes before synchronizing this activity.');
    }
  } else {
    // An exact ID and unchanged interval alone cannot prove that remote words
    // are still our previous write. Never manufacture a baseline from them.
    const interval = bindingInterval(binding.segmentKey, binding.blockId);
    if (!interval || event.allDay || readEventDate(event.startDate).getTime() !== localDateAtMinute(interval.dateKey, interval.startMinute).getTime() ||
        readEventDate(event.endDate).getTime() !== localDateAtMinute(interval.dateKey, interval.endMinute + 1).getTime()) {
      throw new Error('This linked event moved or changed duration in your calendar. It was kept. Review and link its new time before synchronizing or resetting the old cells.');
    }
    const entries = (await getEntriesForBlock(binding.blockId)).filter((entry) => entry.dateKey === interval.dateKey &&
      entry.minuteIndex >= interval.startMinute && entry.minuteIndex <= interval.endMinute);
    const activityTitle = await getActivityTitleForEntries(entries);
    const segment: ActivitySegment = { segmentKey: binding.segmentKey, blockId: binding.blockId, dateKey: interval.dateKey,
      startMinute: interval.startMinute, endMinute: interval.endMinute, entries, categoryId: entries[0]?.categoryId ?? 'unaccounted',
      ...(activityTitle ? { activityTitle } : {}) };
    const current = eventDetails(segment);
    const compactMatches = entries.length > 0 && nativeEventContentHash(current) === contentHash;
    const legacyMatches = entries.length > 0 && nativeEventContentHash({ ...current,
      notes: formatCalendarMinuteLog(entries) }) === contentHash;
    if (!compactMatches && !legacyMatches) {
      throw new Error('This linked event has no verified write baseline and may have been edited in your calendar. Review it before synchronizing.');
    }
    await setSetting(key, { version: 2, calendarId: binding.calendarId, eventId: binding.eventId, contentHash,
      localHash: nativeLocalHash(segment), sourceTitle: current.title.slice(0, 200),
      ...(compactMatches ? { descriptionLog: makeCompactCalendarDescription('', entries).descriptionLog } : {}) } satisfies NativeWriteReceipt);
  }
  return event;
}

/** Only a private exact event binding can import edits. Reading/listing plans
 * never adopts events by their title, time, color, or description. */
async function importLinkedNativeEdits(value: string, calendars: readonly DeviceCalendar[]) {
  const changed = new Set<string>();
  const owned = await accountOwnedCalendarBlocks();
  for (const binding of await getSyncBindings(value)) {
    if (owned.has(binding.blockId) || !calendars.some((calendar) => calendar.id === binding.calendarId)) continue;
    const receiptKey = nativeWriteReceiptKey(binding.calendarId, binding.eventId);
    const receipt = await getSetting<NativeWriteReceipt | null>(receiptKey, null);
    if (!receipt) continue; // Legacy unproven copies remain protected by the write guard.
    if (![1, 2].includes(receipt.version) || receipt.calendarId !== binding.calendarId || receipt.eventId !== binding.eventId ||
        !/^[a-f0-9]{64}$/.test(receipt.contentHash) ||
        (receipt.version === 2 && (!receipt.localHash || !/^[a-f0-9]{64}$/.test(receipt.localHash))) ||
        (receipt.descriptionLog !== undefined && !isDescriptionLog(receipt.descriptionLog))) {
      throw new Error('This linked calendar receipt needs review before importing edits.');
    }
    const remote = await readNativeBoundEvent(binding);
    if (!remote || nativeEventContentHash(remote) === receipt.contentHash) continue;
    if (remote.calendarId !== binding.calendarId) throw new Error('A linked calendar event changed calendars. Review its new calendar.');
    const interval = bindingInterval(binding.segmentKey, binding.blockId);
    if (!interval) throw new Error('This linked activity has an invalid time. Review its calendar link.');
    const entries = (await getEntriesForBlock(binding.blockId)).filter((entry) => entry.dateKey === interval.dateKey &&
      entry.minuteIndex >= interval.startMinute && entry.minuteIndex <= interval.endMinute);
    const activityTitle = await getActivityTitleForEntries(entries);
    const current: ActivitySegment = { segmentKey: binding.segmentKey, blockId: binding.blockId, dateKey: interval.dateKey,
      startMinute: interval.startMinute, endMinute: interval.endMinute, categoryId: entries[0]?.categoryId ?? 'unaccounted', entries,
      ...(activityTitle ? { activityTitle } : {}) };
    // V1 recorded only the exact provider write hash. Reconstruct that original
    // format from CURRENT local rows; equality proves no local note/time/title edit.
    const unchanged = receipt.version === 2 ? nativeLocalHash(current) === receipt.localHash :
      entries.length > 0 && nativeEventContentHash({ ...eventDetails(current), notes: formatCalendarMinuteLog(current.entries) }) === receipt.contentHash;
    if (!unchanged) throw new Error('This linked event was edited in your calendar and in Context. Review both versions before synchronizing.');
    const start = readEventDate(remote.startDate); const end = readEventDate(remote.endDate);
    const endInclusive = new Date(end.getTime() - 1);
    const rule = remote.recurrenceRule;
    const recurring = typeof rule === 'string' ? Boolean(rule.trim()) : rule && typeof rule === 'object'
      ? Object.values(rule).some((item) => item !== null && item !== undefined && item !== '') : Boolean(rule);
    if (remote.allDay || recurring || dateKey(start) !== dateKey(endInclusive) ||
        start.getSeconds() || start.getMilliseconds() || end.getSeconds() || end.getMilliseconds() || end <= start) {
      throw new Error('This linked calendar edit needs review: use one timed, non-recurring activity within a day.');
    }
    const nextDay = dateKey(start); const nextStart = minuteIndexForDate(start); const nextEnd = minuteIndexForDate(endInclusive);
    const otherBindings = await getSyncBindingsForBlock(binding.blockId);
    if (otherBindings.some((other) => other.segmentKey !== binding.segmentKey && (() => {
      const part = bindingInterval(other.segmentKey, other.blockId);
      return !part || part.dateKey === nextDay && part.startMinute <= nextEnd && part.endMinute >= nextStart;
    })())) throw new Error('This calendar edit overlaps another linked part of the activity. Review both event times.');
    if ((await getEntriesForBlock(binding.blockId)).some((entry) => entry.dateKey === nextDay &&
      entry.minuteIndex >= nextStart && entry.minuteIndex <= nextEnd && !(entry.dateKey === interval.dateKey &&
        entry.minuteIndex >= interval.startMinute && entry.minuteIndex <= interval.endMinute))) {
      throw new Error('This calendar edit overlaps another recorded part of the activity. Review the minute cells.');
    }
    const notes = typeof remote.notes === 'string' ? remote.notes.replace(/\r\n/g, '\n') : '';
    let parsed: { minuteIndex: number; text: string }[] = [];
    if (notes.trim()) {
      // New ordinary prose is one minute's note, never a replacement event title.
      if (receipt.descriptionLog?.version === 3) parsed = parseCompactCalendarMinuteLog(notes, receipt.descriptionLog);
      else if (/^\d{1,2}:[0-5]\d(?:[ \t]*(?:AM|PM))?(?:[ \t]|$)/i.test(notes)) parsed = parseCalendarMinuteLog(notes);
      else parsed = [{ minuteIndex: nextStart, text: notes }];
    }
    const noteMap = new Map<number, string>();
    const stillOldCoordinates = nextDay !== interval.dateKey || nextStart !== interval.startMinute;
    const oldCoordinates = stillOldCoordinates && parsed.every((item) => item.minuteIndex >= interval.startMinute && item.minuteIndex <= interval.endMinute);
    for (const item of parsed) {
      const index = oldCoordinates ? nextStart + item.minuteIndex - interval.startMinute : item.minuteIndex;
      if (index < nextStart || index > nextEnd) throw new Error('The edited calendar notes are outside this activity. Review the minute timestamps.');
      noteMap.set(index, item.text);
    }
    const title = typeof remote.title === 'string' && remote.title.trim() ? remote.title : 'Untitled event';
    const labelTitle = title.trim().slice(0, 200);
    const colorValues = await getEventColorsAsync([binding.calendarId], start.getTime(), end.getTime());
    const exactColor = calendarColor(colorValues[`${binding.eventId}@${start.getTime()}`]) ?? calendarColor(colorValues[binding.eventId]) ??
      calendarColor(remote.displayColor) ?? calendarColor(remote.eventColor) ?? calendarColor(remote.color);
    const categoryId = exactColor ? (await ensureSourceColorCategory({ color: exactColor, name: title,
      provider: 'device', calendarId: binding.calendarId })).id : current.categoryId;
    const imported = Array.from({ length: nextEnd - nextStart + 1 }, (_, offset) => ({ dateKey: nextDay,
      minuteIndex: nextStart + offset, text: noteMap.get(nextStart + offset) ?? '', categoryId }));
    const snapshotRanges = [{ dateKey: interval.dateKey, startMinute: interval.startMinute, endMinute: interval.endMinute },
      { dateKey: nextDay, startMinute: nextStart, endMinute: nextEnd }];
    const snapshots = [...new Map((await Promise.all(snapshotRanges.map(async (range) =>
      (await getSpreadsheetCells(range)).map((cell) => ({ dateKey: range.dateKey, cell }))))).flat()
      .map((snapshot) => [`${snapshot.dateKey}:${snapshot.cell.minuteIndex}`, snapshot] as const)).values()];
    const expectedFormats = snapshots.map(({ dateKey, cell }) => ({ dateKey, minuteIndex: cell.minuteIndex,
      format: cell.format, version: cell.version }));
    const guardEntries: MinuteEntry[] = snapshots.map(({ dateKey, cell }) => ({ id: '', dateKey, minuteIndex: cell.minuteIndex,
      text: '', categoryId: 'unaccounted', blockId: '', source: 'manual', createdAt: '', updatedAt: '', ...cell.entry }));
    const nextBinding = { ...binding, dateKey: nextDay,
      segmentKey: `${nextDay}:${binding.blockId}:${nextStart}-${nextEnd}` };
    const nextSegment: ActivitySegment = { ...current, segmentKey: nextBinding.segmentKey, dateKey: nextDay,
      startMinute: nextStart, endMinute: nextEnd, categoryId, activityTitle: labelTitle,
      entries: imported.map((entry, index) => ({ ...entries[Math.min(index, entries.length - 1)]!, ...entry,
        blockId: binding.blockId })) };
    const beforeCommitGuard = () => requireCalendarColorImportCurrent(guardEntries);
    beforeCommitGuard();
    if (await getCalendarPermissionStatus() !== 'granted') throw new Error('Calendar access changed. Retry after allowing calendar reading.');
    if ((await accountOwnedCalendarBlocks()).has(binding.blockId)) continue;
    const latestRemote = await readNativeBoundEvent(binding);
    if (!latestRemote || latestRemote.calendarId !== binding.calendarId ||
        nativeEventContentHash(latestRemote) !== nativeEventContentHash(remote)) {
      throw new Error('This calendar event changed again while importing it. Refresh before retrying.');
    }
    await replaceProjectedMinutes({ blockId: binding.blockId, previousDate: interval.dateKey, previousStart: interval.startMinute,
      previousEnd: interval.endMinute, expectedEntries: entries, expectedActivityTitle: activityTitle, activityTitle: labelTitle,
      entries: imported, expectedFormats, beforeCommitGuard, expectedBinding: binding, nextBinding, clearPreviousFormats: true,
      localReceipt: { key: receiptKey, value: { version: 2, calendarId: binding.calendarId, eventId: binding.eventId,
        contentHash: nativeEventContentHash(remote), localHash: nativeLocalHash(nextSegment), sourceTitle: labelTitle,
        ...(receipt.descriptionLog?.version === 3 && notes.trim() ? { descriptionLog: receipt.descriptionLog } :
          !notes.trim() ? { descriptionLog: makeCompactCalendarDescription('', imported).descriptionLog } : {}) } } });
    changed.add(interval.dateKey); changed.add(nextDay);
    const importedRows = (await getEntriesForBlock(binding.blockId)).filter((entry) => entry.dateKey === nextDay &&
      entry.minuteIndex >= nextStart && entry.minuteIndex <= nextEnd);
    const nextCoordinates = new Set(importedRows.map((entry) => `${entry.dateKey}:${entry.minuteIndex}`));
    const removedRows = entries.filter((entry) => !nextCoordinates.has(`${entry.dateKey}:${entry.minuteIndex}`))
      .map((entry) => ({ ...entry, text: '', categoryId: 'unaccounted', blockId: '' }));
    notifyCalendarColorImported([...removedRows, ...importedRows], true);
  }
  return [...changed];
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
    const source = await requireUnchangedNativeEvent({ calendarId, eventId: existing.id, blockId: segment.blockId,
      segmentKey: segment.segmentKey, dateKey: segment.dateKey, updatedAt: '' });
    await requireNativeWriteAuthority(segment.blockId, canContinue);
    const details = eventDetails(segment, typeof source?.title === 'string' ? source.title : undefined);
    const updatedId = await Calendar.updateEventAsync(existing.id, details);
    const eventId = updatedId || existing.id;
    await recordNativeWrite(calendarId, eventId, segment, details);
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
      const source = await requireUnchangedNativeEvent({ calendarId, eventId: intent.eventId, blockId: segment.blockId,
        segmentKey: segment.segmentKey, dateKey: segment.dateKey, updatedAt: '' });
      await requireNativeWriteAuthority(segment.blockId, canContinue);
      const details = eventDetails(segment, typeof source?.title === 'string' ? source.title : undefined);
      const updatedId = await Calendar.updateEventAsync(intent.eventId, details);
      const recoveredId = updatedId || intent.eventId;
      await recordNativeWrite(calendarId, recoveredId, segment, details);
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
  const source = await requireUnchangedNativeEvent(binding);
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
    const details = eventDetails(segment, typeof source?.title === 'string' ? source.title : undefined);
    const updatedId = await Calendar.updateEventAsync(binding.eventId, details);
    await recordNativeWrite(targetCalendarId, updatedId || binding.eventId, segment, details);
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

export type CalendarProjectionOptions = { existingBindingsOnly?: boolean };

/** Coexistence with an account writer authorizes only the selected calendar's
 * exact private bindings. It never adopts, remaps, creates or replaces events. */
async function syncExistingBoundActualDay(value: string, calendarId: string, canContinue: () => boolean): Promise<CalendarSyncResult> {
  if (projectionTargetCalendarId !== calendarId) return { created: 0, updated: 0, removed: 0, deferred: true };
  const generation = projectionGeneration;
  const currentPass = () => canContinue() && projectionGeneration === generation && projectionTargetCalendarId === calendarId;
  const owned = await accountOwnedCalendarBlocks();
  const segments = await getDayCalendarSegments(value);
  const bindings = await getSyncBindings(value);
  const selectedBindings = bindings.filter((binding) => binding.calendarId === calendarId && !owned.has(binding.blockId));
  let deferred = bindings.length !== selectedBindings.length || segments.some((segment) =>
    (segment.activityTitle || bindings.some((binding) => binding.blockId === segment.blockId)) &&
    !selectedBindings.some((binding) => binding.segmentKey === segment.segmentKey && binding.blockId === segment.blockId));
  let updated = 0; let removed = 0;
  for (const binding of selectedBindings) {
    if (!currentPass()) throw new ProjectionCancelledError();
    const interval = bindingInterval(binding.segmentKey, binding.blockId);
    if (!interval || interval.dateKey !== value || binding.dateKey !== value) { deferred = true; continue; }
    const segment = segments.find((item) => item.segmentKey === binding.segmentKey && item.blockId === binding.blockId && item.dateKey === value);
    if (!segment && (await getEntriesForBlock(binding.blockId)).length) {
      // A changed shape or a move needs the ordinary identity-preserving path;
      // this restricted pass must never delete its original event first.
      deferred = true; continue;
    }
    const source = await requireUnchangedNativeEvent(binding);
    if (!source) { deferred = true; continue; }
    await requireNativeWriteAuthority(binding.blockId, currentPass, binding);
    if (segment) {
      const receipt = await getSetting<NativeWriteReceipt | null>(nativeWriteReceiptKey(calendarId, binding.eventId), null);
      if (receipt?.version === 2 && receipt.localHash === nativeLocalHash(segment)) continue;
      const latest = await requireUnchangedNativeEvent(binding);
      if (!latest) { deferred = true; continue; }
      await requireNativeWriteAuthority(binding.blockId, currentPass, binding);
      const details = eventDetails(segment, typeof latest.title === 'string' ? latest.title : undefined);
      const returnedId = await Calendar.updateEventAsync(binding.eventId, details);
      if (returnedId && returnedId !== binding.eventId) {
        throw new Error('The calendar changed this linked event identifier. Review its original link before synchronizing again.');
      }
      if (!currentPass()) throw new ProjectionCancelledError();
      await recordNativeWrite(calendarId, binding.eventId, segment, details);
      updated++;
    } else {
      const latest = await requireUnchangedNativeEvent(binding);
      if (!latest) { deferred = true; continue; }
      await requireNativeWriteAuthority(binding.blockId, currentPass, binding);
      await Calendar.deleteEventAsync(binding.eventId);
      await requireNativeWriteAuthority(binding.blockId, currentPass, binding);
      await deleteSyncBinding(binding.segmentKey);
      removed++;
    }
  }
  return { created: 0, updated, removed, ...(deferred ? { deferred: true as const } : {}) };
}

export async function syncActualDay(
  value: string,
  calendarId: string,
  canContinue: () => boolean = () => true,
  options: CalendarProjectionOptions = {},
): Promise<CalendarSyncResult> {
  if (isWeb()) return { created: 0, updated: 0, removed: 0 };
  if (options.existingBindingsOnly) return syncExistingBoundActualDay(value, calendarId, canContinue);
  if (await hasConfiguredAccountCalendarWriter()) return { created: 0, updated: 0, removed: 0, deferred: true };
  const owned = await accountOwnedCalendarBlocks();
  const allSegments = await getDayCalendarSegments(value);
  const initialBindings = await getSyncBindings(value);
  const legacyBoundBlocks = new Set(initialBindings.map((binding) => binding.blockId));
  // Ordinary minute notes belong only to the private ledger. A deliberate
  // bordered activity or an existing exact legacy binding is a calendar event.
  const segments = allSegments.filter((segment) => !owned.has(segment.blockId) &&
    (Boolean(segment.activityTitle) || legacyBoundBlocks.has(segment.blockId)));
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
  const deferred = allSegments.some((segment) => owned.has(segment.blockId)) || allBindings.length !== bindings.length;
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
      const current = (await Promise.all([...new Set(members.map((member) => member.dateKey))].map(getDayCalendarSegments)))
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
  options: CalendarProjectionOptions,
): Promise<CalendarOutboxResult> {
  if (!options.existingBindingsOnly && await hasConfiguredAccountCalendarWriter()) {
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
      const result = await syncActualDay(item.dateKey, calendarId, canContinue, options);
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
  options: CalendarProjectionOptions = {},
): Promise<CalendarOutboxResult> {
  const expectedGeneration = projectionGeneration;
  const selectedOptions = { existingBindingsOnly: options.existingBindingsOnly === true };
  const job = outboxChain.then(() =>
    flushPendingActualsOnce(calendarId, limit, priorityDates, expectedGeneration, selectedOptions),
  );
  outboxChain = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}
