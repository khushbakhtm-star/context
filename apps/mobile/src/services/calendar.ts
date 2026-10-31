import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar/legacy';
import * as CalendarRead from 'expo-calendar';
import { getEventColorsAsync, setEventColorAsync } from '../../modules/context-calendar-colors';

import {
  getDayCalendarSegments,
  getEntriesForBlock,
  getActivityEditIntent,
  getActivityLocalUpdatedAt,
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
import { activityIntervalAbsoluteEnd, activityIntervalContains, activityIntervalRanges, bindingInterval,
  coalesceNativeActivitySpan, matchActivityTranslation } from '../utils/activity-translation';
import { planNativeBoundRetime, type NativeBoundRetimePlan } from '../utils/native-bound-retime';
import { calendarColor, nativeEventColor } from '../utils/calendar-cell-color';
import { formatCalendarMinuteLog, parseCalendarMinuteLog, parseCompactCalendarMinuteLog } from '../utils/calendar-minute-log';
import { makeCompactCalendarDescription, isDescriptionLog, type DescriptionLog } from '../utils/calendar-description';
import { getAccounts } from '../sync/accounts';
import { hasConfiguredAccountCalendarWriter } from './calendar-write-routing';
import { ensureSourceColorCategory, listCategories } from './categories';
import { hashValue } from '../sync/codec';
import { listProjections, localActivityColorHash, notifyCalendarColorImported, reconcileLinkedAccountColors,
  requireCalendarColorImportCurrent } from '../sync/engine';
import { createNativeSyncDiagnostics } from '../utils/native-sync-diagnostics';
import { calendarMutationTime, latestCalendarChange } from '../utils/calendar-change-authority';

const nativeSyncDiagnostics = createNativeSyncDiagnostics();
export const getNativeCalendarSyncDiagnostics = () => nativeSyncDiagnostics.snapshot();
const nativeCalendarMutations = {
  createEventAsync: (...args: Parameters<typeof Calendar.createEventAsync>) =>
    nativeSyncDiagnostics.observe('content', () => Calendar.createEventAsync(...args)),
  updateEventAsync: (...args: Parameters<typeof Calendar.updateEventAsync>) =>
    nativeSyncDiagnostics.observe('content', () => Calendar.updateEventAsync(...args)),
  deleteEventAsync: (...args: Parameters<typeof Calendar.deleteEventAsync>) =>
    nativeSyncDiagnostics.observe('content', () => Calendar.deleteEventAsync(...args)),
};

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

type NativeActivitySegment = ActivitySegment & { nativeSpanReview?: true };

async function getNativeCalendarSegments(value: string): Promise<NativeActivitySegment[]> {
  const daily = await getDayCalendarSegments(value);
  const dayReads = new Map<string, Promise<ActivitySegment[]>>([[value, Promise.resolve(daily)]]);
  const readDay = (day: string) => {
    if (!dayReads.has(day)) dayReads.set(day, getDayCalendarSegments(day));
    return dayReads.get(day)!;
  };
  const resolved = new Map<string, NativeActivitySegment>();
  const named = new Set(daily.filter((segment) => segment.activityTitle).map((segment) => segment.blockId));
  for (const segment of daily) {
    if (!segment.activityTitle) { if (!named.has(segment.blockId)) resolved.set(segment.segmentKey, segment); continue; }
    if ([...resolved.values()].some((item) => item.blockId === segment.blockId)) continue;
    const members = await getEntriesForBlock(segment.blockId);
    const days = [...new Set(members.map((entry) => entry.dateKey))];
    const parts = days.length <= 2 ? (await Promise.all(days.map(readDay))).flat()
      .filter((item) => item.blockId === segment.blockId) : [];
    const complete = coalesceNativeActivitySpan(parts, members);
    resolved.set(complete?.segmentKey ?? segment.segmentKey, complete ?? { ...segment, nativeSpanReview: true });
  }
  return [...resolved.values()];
}

function requireNativeSegmentShape(segment: NativeActivitySegment) {
  if (segment.nativeSpanReview) throw new Error('This bordered activity has ambiguous or incomplete minute cells. Review its complete range before synchronizing.');
}

async function nativeBindingsForSegments(value: string, segments: readonly ActivitySegment[]) {
  const bindings = new Map((await getSyncBindings(value)).map((binding) => [binding.segmentKey, binding]));
  // A reset can remove every current cell on the end day. The exact canonical
  // key on the previous day still proves which original event needs shrinking.
  const previousDay = dateKey(addDays(value, -1));
  for (const binding of await getSyncBindings(previousDay)) {
    if (bindingInterval(binding.segmentKey, binding.blockId)?.endDateKey === value) bindings.set(binding.segmentKey, binding);
  }
  for (const segment of segments) if (segment.activityTitle) {
    for (const binding of await getSyncBindingsForBlock(segment.blockId)) bindings.set(binding.segmentKey, binding);
  }
  return [...bindings.values()];
}

async function accountOwnedCalendarBlocks() {
  // A paused/revoked source link still owns its activity until explicitly
  // removed. Falling back to the phone provider must not bypass that review.
  return new Set((await listProjections()).filter((projection) => projection.state !== 'deleted')
    .map((projection) => projection.blockId));
}

async function requireNativeWriteAuthority(blockId: string, canContinue: () => boolean, binding?: SyncBinding) {
  if (!canContinue() || (await accountOwnedCalendarBlocks()).has(blockId)) throw new ProjectionCancelledError();
  if (binding) {
    const bindings = await getSyncBindingsForBlock(blockId);
    if (bindingInterval(binding.segmentKey, blockId)?.endDateKey && bindings.length !== 1) {
      throw new Error('This overnight activity has multiple calendar links. Review those exact events before synchronizing.');
    }
    const current = bindings.find((item) => item.segmentKey === binding.segmentKey);
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
export type NativeCalendarBindingFailure = Pick<SyncBinding, 'blockId' | 'segmentKey' | 'calendarId' | 'eventId'> & { message: string };
export type NativeCalendarReconciliationResult = { changedDates: string[]; failures: NativeCalendarBindingFailure[] };
export class NativeCalendarReconciliationError extends Error {
  constructor(readonly failures: readonly NativeCalendarBindingFailure[], readonly changedDates: readonly string[] = []) {
    super([...new Set(failures.map((failure) => failure.message))].join('\n') || 'A linked phone-calendar activity needs review.');
    this.name = 'NativeCalendarReconciliationError';
  }
}
async function bindingReviewFailure(binding: SyncBinding, error: unknown): Promise<NativeCalendarBindingFailure> {
  // Loss of calendar access is a whole-source failure, never permission to
  // continue writing another event from an incomplete preflight.
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (error instanceof ProjectionCancelledError || typeof code === 'string' && /PERMISSION|SECURITY|ACCESS_DENIED/i.test(code) ||
      await getCalendarPermissionStatus() !== 'granted') throw error;
  return { blockId: binding.blockId, segmentKey: binding.segmentKey, calendarId: binding.calendarId,
    eventId: binding.eventId, message: error instanceof Error && error.message
      ? error.message.slice(0, 1000) : 'A linked phone-calendar activity could not be checked. Review its connection.' };
}
const nativeColorReceiptKey = (calendarId: string, eventId: string) =>
  `calendar.color-receipt.device.${encodeURIComponent(calendarId)}.${encodeURIComponent(eventId)}`;
type NativeColorIntent = { version: 1; calendarId: string; eventId: string; color: string; expectedColor: string; localColorHash: string };
const nativeColorIntentKey = (calendarId: string, eventId: string) =>
  `calendar.color-intent.device.${encodeURIComponent(calendarId)}.${encodeURIComponent(eventId)}`;

async function applyDesiredNativeColor(calendarId: string, eventId: string, segment: ActivitySegment,
  canContinue: () => boolean, created = false) {
  requireNativeSegmentShape(segment);
  // Reset/no-fill and unclassified notes do not request a source event color.
  if (segment.categoryId === 'unaccounted') return;
  const color = calendarColor(categoryById(segment.categoryId).color)?.toUpperCase();
  if (!color) throw new Error('The selected activity color is unavailable. Choose a calendar event color.');
  const key = nativeColorReceiptKey(calendarId, eventId);
  const receipt = await getSetting<NativeColorReceipt | null>(key, null);
  if (receipt && (receipt.version !== 1 || receipt.calendarId !== calendarId || receipt.eventId !== eventId ||
      !calendarColor(receipt.remoteColor) || !/^[a-f0-9]{64}$/.test(receipt.localColorHash))) {
    throw new Error('The linked event color receipt needs review before color writeback.');
  }
  const localHash = localActivityColorHash(segment.entries);
  if (receipt?.localColorHash === localHash) return; // Note edits must not reset a provider's color.
  const intentKey = nativeColorIntentKey(calendarId, eventId);
  const intent = await getSetting<NativeColorIntent | null>(intentKey, null);
  if (intent && (intent.version !== 1 || intent.calendarId !== calendarId || intent.eventId !== eventId ||
      !calendarColor(intent.color) || !calendarColor(intent.expectedColor) || !/^[a-f0-9]{64}$/.test(intent.localColorHash))) {
    throw new Error('The pending calendar color intent needs review before retrying.');
  }
  const requireCurrent = async () => {
    if (!canContinue()) throw new ProjectionCancelledError();
    requireCalendarColorImportCurrent(segment.entries);
    const binding = (await getSyncBindingsForBlock(segment.blockId)).find((item) =>
      item.segmentKey === segment.segmentKey && item.eventId === eventId && item.calendarId === calendarId);
    if (!binding) throw new Error('The activity calendar link changed before its color could be updated.');
    const current = (await getNativeCalendarSegments(segment.dateKey)).find((item) => item.segmentKey === segment.segmentKey);
    if (!current || nativeLocalHash(current) !== nativeLocalHash(segment)) {
      throw new Error('The activity changed before its calendar color could be updated. Retry synchronization.');
    }
    await requireNativeWriteAuthority(segment.blockId, canContinue, binding);
    return binding;
  };
  await requireCurrent();
  const startMs = localDateAtMinute(segment.dateKey, segment.startMinute).getTime();
  const endMs = localDateAtMinute(segment.dateKey, segment.endMinute + 1).getTime();
  const colors = await getEventColorsAsync([calendarId], startMs, endMs);
  const expectedColor = (calendarColor(colors[`${eventId}@${startMs}`]) ?? calendarColor(colors[eventId]))?.toUpperCase();
  if (!expectedColor) throw new Error('The original event color could not be checked. Its color update remains pending.');
  const provenIntent = intent && intent.color === color && intent.localColorHash === localHash &&
    (intent.expectedColor === expectedColor || intent.color === expectedColor);
  if (!receipt && !created && !provenIntent && expectedColor !== color) {
    throw new Error('This linked color has no verified baseline. Review its original calendar color before changing it.');
  }
  const binding = await requireCurrent();
  const source = await requireUnchangedNativeEvent(binding);
  if (!source) throw new Error('The original event is unavailable. Its color update remains pending.');
  if (receipt && receipt.remoteColor.toUpperCase() !== expectedColor && color !== expectedColor &&
      await nativeChangedStateAuthority(binding, source) !== 'context') {
    throw new Error('The activity color changed in Context and the calendar. Review both colors before synchronizing.');
  }
  await requireCurrent();
  if (!receipt && created && !intent) await setSetting(intentKey, { version: 1, calendarId, eventId, color,
    expectedColor, localColorHash: localHash } satisfies NativeColorIntent);
  const result = await nativeSyncDiagnostics.observe('color', () => setEventColorAsync({ calendarId, eventId, color, expectedColor,
    startMs, endMs, title: typeof source.title === 'string' ? source.title : '',
    notes: typeof source.notes === 'string' ? source.notes : '' }));
  if (!canContinue()) throw new ProjectionCancelledError();
  // Only the exact native CAS acknowledgement advances the source-color receipt.
  await setSetting(key, { version: 1, calendarId, eventId, remoteColor: result.color,
    localColorHash: localHash } satisfies NativeColorReceipt);
  if (intent || !receipt && created) await setSetting(intentKey, null);
}
let nativeColorChain: Promise<void> = Promise.resolve();

/** The caller explicitly reconciles known private bindings after a successful source
 * read. Listing calendar plans, including Print's reads, remains strictly read-only. */
export function reconcileLinkedNativeColorsResult(value: string, plans: readonly PlannedEvent[], calendars: readonly DeviceCalendar[]): Promise<NativeCalendarReconciliationResult> {
  const work = async () => {
    const read = verifiedNativeSelections.get(plans);
    const selectedCalendars = read?.dateKey === value ? calendars.filter((calendar) => read.calendarIds.includes(calendar.id)) : [];
    const imported = await importLinkedNativeEdits(value, selectedCalendars);
    const changed = new Set(imported.changedDates);
    const failures = [...imported.failures];
    const blocked = new Set([...failures.map((failure) => failure.blockId), ...imported.locallyNewerBlocks]);
    const owned = await accountOwnedCalendarBlocks();
    await listCategories();
    for (const binding of await nativeBindingsForSegments(value, await getNativeCalendarSegments(value))) {
      if (owned.has(binding.blockId) || blocked.has(binding.blockId)) continue;
      try {
        const plan = plans.find((item) => item.id === binding.eventId && item.calendarId === binding.calendarId && !item.allDay);
        const calendar = calendars.find((item) => item.id === binding.calendarId);
        if (!plan || !calendar || !verifiedNativeEventColors.get(plan)) continue;
        const color = calendarColor(plan.color)?.toUpperCase();
        if (!color) continue;
        const interval = bindingInterval(binding.segmentKey, binding.blockId);
        if (!interval) throw new Error('A linked activity needs review before importing its calendar color.');
        const sourceEvent = await requireUnchangedNativeEvent(binding);
        const entries = (await getEntriesForBlock(binding.blockId)).filter((entry) => activityIntervalContains(interval, entry));
        if (!entries.length) continue;
        const key = nativeColorReceiptKey(binding.calendarId, binding.eventId);
        const receipt = await getSetting<NativeColorReceipt | null>(key, null);
        // A new event's failed color request retains its original source-color
        // proof separately; a display read must not falsely acknowledge it.
        if (!receipt && await getSetting<NativeColorIntent | null>(nativeColorIntentKey(binding.calendarId, binding.eventId), null)) continue;
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
          const authority = sourceEvent ? await nativeChangedStateAuthority(binding, sourceEvent) : 'unknown';
          if (authority === 'context') continue;
          if (authority !== 'calendar') throw new Error('The activity color changed in Context and the calendar. Review both colors before synchronizing.');
        }
        const category = await ensureSourceColorCategory({ color, name: plan.title, provider: 'device', calendarId: binding.calendarId,
          preferredCategoryId: sameColor ? entries[0]!.categoryId : undefined });
        const next = entries.map((entry) => ({ ...entry, categoryId: category.id }));
        const guard = () => requireCalendarColorImportCurrent(entries);
        guard();
        if (await getCalendarPermissionStatus() !== 'granted') throw new Error('Calendar access changed. Retry after allowing calendar reading.');
        // Recheck exact ownership after the source/category awaits, before SQLite commit.
        const current = (await getSyncBindingsForBlock(binding.blockId)).find((item) => item.segmentKey === binding.segmentKey);
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
            endMinute: activityIntervalAbsoluteEnd(interval), categoryId: category.id, entries: next, ...(title ? { activityTitle: title } : {}) };
          // Color-only imports are acknowledged local state, not a pending edit.
          await setSetting(writeKey, { ...writeReceipt, localHash: nativeLocalHash(segment) });
        }
        for (const day of affected) changed.add(day);
        notifyCalendarColorImported(next);
      } catch (error) {
        failures.push(await bindingReviewFailure(binding, error));
        blocked.add(binding.blockId);
      }
    }
    return { changedDates: [...changed], failures };
  };
  const job = nativeColorChain.then(work, work);
  nativeColorChain = job.then(() => undefined, () => undefined);
  return job;
}

/** Compatible UI entry point: valid imports finish before review is reported. */
export async function reconcileLinkedNativeColors(value: string, plans: readonly PlannedEvent[], calendars: readonly DeviceCalendar[]): Promise<string[]> {
  const result = await reconcileLinkedNativeColorsResult(value, plans, calendars);
  if (result.failures.length) throw new NativeCalendarReconciliationError(result.failures, result.changedDates);
  return result.changedDates;
}

/** Explicit foreground import; no source event is created, changed or deleted. */
export async function reconcileLinkedCalendarColors(dates: readonly string[], calendars: readonly DeviceCalendar[],
  preferences: CalendarPreferences, options: { nativeOnly?: boolean } = {}): Promise<string[]> {
  const changed = new Set<string>();
  const failures: NativeCalendarBindingFailure[] = [];
  if (dates.length > 366) throw new Error('Choose at most one year when refreshing linked calendar colors.');
  for (const value of [...new Set(dates)]) {
    if (!preferences.selectedCalendarIds.length) break;
    const result = await loadPlannedEventsResult(preferences.selectedCalendarIds, value, [...calendars]);
    if (result.failures.length) throw new CalendarReadError(result.plans, result.failures);
    const reconciled = await reconcileLinkedNativeColorsResult(value, result.plans, calendars);
    for (const day of reconciled.changedDates) changed.add(day);
    failures.push(...reconciled.failures);
  }
  if (!options.nativeOnly) for (const day of await reconcileLinkedAccountColors(dates)) changed.add(day);
  if (failures.length) throw new NativeCalendarReconciliationError(failures, [...changed]);
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
  requireNativeSegmentShape(segment);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const sourceLabel = sourceTitle === undefined ? undefined : sourceTitle.trim().slice(0, 200) || 'Untitled event';
  const startDate = localDateAtMinute(segment.dateKey, segment.startMinute);
  const endDate = localDateAtMinute(segment.dateKey, segment.endMinute + 1);
  if (segment.endMinute >= 1440 && (endDate.getTime() - startDate.getTime()) / 60_000 !== segment.entries.length) {
    throw new Error('This overnight activity crosses a changed clock offset. Review its calendar endpoints before synchronizing.');
  }
  return {
    title: segment.activityTitle && segment.activityTitle !== sourceLabel
      ? segment.activityTitle : sourceTitle !== undefined ? sourceTitle : segmentTitle(segment),
    startDate,
    endDate,
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
  allDay?: unknown; recurrenceRule?: unknown; displayColor?: unknown; eventColor?: unknown; color?: unknown; lastModifiedDate?: unknown };
function nativeModificationTimestamp(event: NativeBoundEvent): string | undefined {
  const raw = event.lastModifiedDate;
  const value = raw instanceof Date && Number.isFinite(raw.getTime()) ? raw.toISOString() : raw;
  return calendarMutationTime(value) !== null ? value as string : undefined;
}
async function nativeChangedStateAuthority(binding: SyncBinding, event: NativeBoundEvent) {
  const interval = bindingInterval(binding.segmentKey, binding.blockId);
  const coordinates = interval ? activityIntervalRanges(interval).flatMap((range) =>
    Array.from({ length: range.endMinute - range.startMinute + 1 }, (_, offset) => ({ dateKey: range.dateKey, minuteIndex: range.startMinute + offset }))) : undefined;
  return latestCalendarChange({ localUpdatedAt: await getActivityLocalUpdatedAt(binding.blockId, coordinates),
    remoteUpdatedAt: nativeModificationTimestamp(event) });
}
async function readNativeBoundEvent(binding: SyncBinding): Promise<NativeBoundEvent | null> {
  try {
    if (Platform.OS === 'android' && typeof CalendarRead.ExpoCalendarEvent?.get === 'function') {
      const read = calendarReadChain.then(async () => {
        const current = await CalendarRead.ExpoCalendarEvent.get(binding.eventId);
        // Extract shared native getters while holding the same mapper lease as
        // listEvents, bypassing the legacy Android empty-RRULE conversion.
        return { calendarId: current.calendarId, title: current.title, notes: current.notes,
          startDate: current.startDate, endDate: current.endDate, allDay: current.allDay, recurrenceRule: current.recurrenceRule,
          // Read a genuine native mutation time only if this provider exposes it.
          // Android commonly does not; the time of this read is never an edit time.
          lastModifiedDate: (current as unknown as { lastModifiedDate?: unknown }).lastModifiedDate };
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
        !/^[a-f0-9]{64}$/.test(receipt.contentHash)) {
      throw new Error('This linked calendar receipt needs review before synchronizing.');
    }
    if (receipt.contentHash !== contentHash && await nativeChangedStateAuthority(binding, event) !== 'context') {
      throw new Error('This linked event was edited in your calendar. Its title, times and notes were kept. Review and link those changes before synchronizing this activity.');
    }
  } else {
    // An exact ID and unchanged interval alone cannot prove that remote words
    // are still our previous write. Never manufacture a baseline from them.
    const interval = bindingInterval(binding.segmentKey, binding.blockId);
    if (!interval || event.allDay || readEventDate(event.startDate).getTime() !== localDateAtMinute(interval.dateKey, interval.startMinute).getTime() ||
        readEventDate(event.endDate).getTime() !== localDateAtMinute(interval.dateKey, activityIntervalAbsoluteEnd(interval) + 1).getTime()) {
      throw new Error('This linked event moved or changed duration in your calendar. It was kept. Review and link its new time before synchronizing or resetting the old cells.');
    }
    const entries = (await getEntriesForBlock(binding.blockId)).filter((entry) => activityIntervalContains(interval, entry));
    const activityTitle = await getActivityTitleForEntries(entries);
    const segment: ActivitySegment = { segmentKey: binding.segmentKey, blockId: binding.blockId, dateKey: interval.dateKey,
      startMinute: interval.startMinute, endMinute: activityIntervalAbsoluteEnd(interval), entries, categoryId: entries[0]?.categoryId ?? 'unaccounted',
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

/** An exact coded not-found is deletion intent, unlike an empty day query or a
 * failed permission/provider request. Clear only rows still owned by this link;
 * snapshots and the user-edit intent are checked again in the same transaction. */
async function importNativeBoundDeletion(binding: SyncBinding): Promise<string[]> {
  const interval = bindingInterval(binding.segmentKey, binding.blockId);
  if (!interval) throw new Error('This linked activity has an invalid time. Review its calendar link.');
  const expectedActivityEditIntent = await getActivityEditIntent(binding.blockId);
  const entries = (await getEntriesForBlock(binding.blockId)).filter((entry) => activityIntervalContains(interval, entry));
  const activityTitle = await getActivityTitleForEntries(entries);
  const coordinates = new Set(entries.map((entry) => `${entry.dateKey}:${entry.minuteIndex}`));
  const ranges = activityIntervalRanges(interval);
  const snapshots: NonNullable<Parameters<typeof replaceProjectedMinutes>[0]['expectedFormats']> = [];
  for (const range of ranges) snapshots.push(...(await getSpreadsheetCells(range))
    .filter((cell) => coordinates.has(`${range.dateKey}:${cell.minuteIndex}`))
    .map((cell) => ({ dateKey: range.dateKey, minuteIndex: cell.minuteIndex, format: cell.format, version: cell.version })));
  const beforeCommitGuard = () => requireCalendarColorImportCurrent(entries);
  beforeCommitGuard();
  if (await getCalendarPermissionStatus() !== 'granted') throw new Error('Calendar access changed. Retry after allowing calendar reading.');
  if ((await accountOwnedCalendarBlocks()).has(binding.blockId)) return [];
  if (await readNativeBoundEvent(binding) !== null) throw new Error('This calendar event reappeared while importing its deletion. Refresh before retrying.');
  await replaceProjectedMinutes({ blockId: binding.blockId, previousDate: interval.dateKey, previousStart: interval.startMinute,
    previousEndDate: interval.endDateKey, previousEnd: interval.endMinute, expectedEntries: entries, expectedActivityTitle: activityTitle,
    expectedFormats: snapshots, expectedBinding: binding, expectedActivityEditIntent, clearPreviousFormats: true, retireBinding: true, rejectAccountOwned: true,
    beforeCommitGuard, entries: [], localReceipt: { key: nativeWriteReceiptKey(binding.calendarId, binding.eventId), value: null } });
  notifyCalendarColorImported(entries.map((entry) => ({ ...entry, text: '', categoryId: 'unaccounted', blockId: '' })), true);
  return ranges.map((range) => range.dateKey);
}

/** Only a private exact event binding can import edits. Reading/listing plans
 * never adopts events by their title, time, color, or description. */
async function importLinkedNativeEdits(value: string, calendars: readonly DeviceCalendar[]) {
  const changed = new Set<string>();
  const locallyNewer = new Set<string>();
  const failures: NativeCalendarBindingFailure[] = [];
  const blocked = new Set<string>();
  const owned = await accountOwnedCalendarBlocks();
  for (const binding of await nativeBindingsForSegments(value, await getNativeCalendarSegments(value))) {
    if (owned.has(binding.blockId) || blocked.has(binding.blockId) || !calendars.some((calendar) => calendar.id === binding.calendarId)) continue;
    try {
      const remote = await readNativeBoundEvent(binding);
      if (!remote) { for (const day of await importNativeBoundDeletion(binding)) changed.add(day); continue; }
      const receiptKey = nativeWriteReceiptKey(binding.calendarId, binding.eventId);
      const receipt = await getSetting<NativeWriteReceipt | null>(receiptKey, null);
      if (!receipt) {
        // Inspect every exact legacy binding before dispatch, even if its source
        // has no explicit color. Only exact current-content proof may bootstrap it.
        await requireUnchangedNativeEvent(binding);
        continue;
      }
      if (![1, 2].includes(receipt.version) || receipt.calendarId !== binding.calendarId || receipt.eventId !== binding.eventId ||
          !/^[a-f0-9]{64}$/.test(receipt.contentHash) ||
          (receipt.version === 2 && (!receipt.localHash || !/^[a-f0-9]{64}$/.test(receipt.localHash))) ||
          (receipt.descriptionLog !== undefined && !isDescriptionLog(receipt.descriptionLog))) {
        throw new Error('This linked calendar receipt needs review before importing edits.');
      }
      if (nativeEventContentHash(remote) === receipt.contentHash) continue;
      if (remote.calendarId !== binding.calendarId) throw new Error('A linked calendar event changed calendars. Review its new calendar.');
      const interval = bindingInterval(binding.segmentKey, binding.blockId);
      if (!interval) throw new Error('This linked activity has an invalid time. Review its calendar link.');
      const entries = (await getEntriesForBlock(binding.blockId)).filter((entry) => activityIntervalContains(interval, entry));
      const expectedActivityEditIntent = await getActivityEditIntent(binding.blockId);
      const activityTitle = await getActivityTitleForEntries(entries);
      const current: ActivitySegment = { segmentKey: binding.segmentKey, blockId: binding.blockId, dateKey: interval.dateKey,
        startMinute: interval.startMinute, endMinute: activityIntervalAbsoluteEnd(interval), categoryId: entries[0]?.categoryId ?? 'unaccounted', entries,
        ...(activityTitle ? { activityTitle } : {}) };
      // V1 recorded only the exact provider write hash. Reconstruct that original
      // format from CURRENT local rows; equality proves no local note/time/title edit.
      const unchanged = receipt.version === 2 ? nativeLocalHash(current) === receipt.localHash :
        entries.length > 0 && nativeEventContentHash({ ...eventDetails(current), notes: formatCalendarMinuteLog(current.entries) }) === receipt.contentHash;
      if (!unchanged) {
        const authority = await nativeChangedStateAuthority(binding, remote);
        if (authority === 'context') { locallyNewer.add(binding.blockId); continue; }
        if (authority !== 'calendar') throw new Error('This linked event was edited in your calendar and in Context. Review both versions before synchronizing.');
      }
      const start = readEventDate(remote.startDate); const end = readEventDate(remote.endDate);
      const rule = remote.recurrenceRule;
      const recurring = typeof rule === 'string' ? Boolean(rule.trim()) : rule && typeof rule === 'object'
        ? Object.values(rule).some((item) => item !== null && item !== undefined && item !== '') : Boolean(rule);
      const nextDay = dateKey(start); const nextStart = minuteIndexForDate(start);
      const count = (Date.parse(`${dateKey(end)}T00:00:00Z`) - Date.parse(`${nextDay}T00:00:00Z`)) / 60_000 + minuteIndexForDate(end) - nextStart;
      if (remote.allDay || recurring || !Number.isInteger(count) || count < 1 || count > 1440 ||
          (end.getTime() - start.getTime()) / 60_000 !== count ||
          start.getSeconds() || start.getMilliseconds() || end.getSeconds() || end.getMilliseconds() || end <= start) {
        throw new Error('This linked calendar edit needs review: use one timed, non-recurring activity of at most 24 hours without an ambiguous clock change.');
      }
      const nextEnd = nextStart + count - 1;
      const nextInterval = bindingInterval(`${nextDay}:${binding.blockId}:${nextStart}-${nextEnd}`, binding.blockId);
      if (!nextInterval) throw new Error('The edited calendar endpoints need review.');
      const otherBindings = await getSyncBindingsForBlock(binding.blockId);
      if (otherBindings.some((other) => other.segmentKey !== binding.segmentKey && (() => {
        const part = bindingInterval(other.segmentKey, other.blockId);
        return !part || activityIntervalRanges(nextInterval).some((range) =>
          activityIntervalContains(part, { dateKey: range.dateKey, minuteIndex: range.startMinute }) ||
          activityIntervalContains(part, { dateKey: range.dateKey, minuteIndex: range.endMinute })) ||
          activityIntervalContains(nextInterval, { dateKey: part.dateKey, minuteIndex: part.startMinute });
      })())) throw new Error('This calendar edit overlaps another linked part of the activity. Review both event times.');
      if ((await getEntriesForBlock(binding.blockId)).some((entry) => activityIntervalContains(nextInterval, entry) && !activityIntervalContains(interval, entry))) {
        throw new Error('This calendar edit overlaps another recorded part of the activity. Review the minute cells.');
      }
      const notes = typeof remote.notes === 'string' ? remote.notes.replace(/\r\n/g, '\n') : '';
      let parsed: { minuteIndex: number; text: string }[] = [];
      if (notes.trim()) {
        // New ordinary prose is one minute's note, never a replacement event title.
        if (/^\d{1,2}:[0-5]\d(?:[ \t]*(?:AM|PM))?(?:[ \t]|$)/i.test(notes)) parsed = receipt.descriptionLog?.version === 3
          ? parseCompactCalendarMinuteLog(notes, receipt.descriptionLog) : parseCalendarMinuteLog(notes);
        else parsed = [{ minuteIndex: nextStart, text: notes }];
      }
      const noteMap = new Map<number, string>();
      const stillOldCoordinates = nextDay !== interval.dateKey || nextStart !== interval.startMinute;
      const oldCount = activityIntervalAbsoluteEnd(interval) - interval.startMinute + 1;
      const offsetFrom = (minute: number, start: number) => (minute - start + 1440) % 1440;
      const oldCoordinates = stillOldCoordinates && parsed.every((item) => offsetFrom(item.minuteIndex, interval.startMinute) < oldCount);
      for (const item of parsed) {
        const index = nextStart + offsetFrom(item.minuteIndex, oldCoordinates ? interval.startMinute : nextStart);
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
      const imported = activityIntervalRanges(nextInterval).flatMap((range) => Array.from({ length: range.endMinute - range.startMinute + 1 }, (_, offset) => ({
        dateKey: range.dateKey, minuteIndex: range.startMinute + offset,
        text: noteMap.get((Date.parse(`${range.dateKey}T00:00:00Z`) - Date.parse(`${nextDay}T00:00:00Z`)) / 60_000 + range.startMinute + offset) ?? '', categoryId })));
      const snapshotRanges = [...activityIntervalRanges(interval), ...activityIntervalRanges(nextInterval)];
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
        previousEndDate: interval.endDateKey, previousEnd: interval.endMinute, expectedEntries: entries, expectedActivityTitle: activityTitle, activityTitle: labelTitle,
        entries: imported, expectedFormats, beforeCommitGuard, expectedBinding: binding, expectedActivityEditIntent, nextBinding, clearPreviousFormats: true, rejectAccountOwned: true,
        authoritativeRemoteUpdatedAt: calendarMutationTime(nativeModificationTimestamp(remote)) ?? undefined,
        localReceipt: { key: receiptKey, value: { version: 2, calendarId: binding.calendarId, eventId: binding.eventId,
          contentHash: nativeEventContentHash(remote), localHash: nativeLocalHash(nextSegment), sourceTitle: labelTitle,
          ...(receipt.descriptionLog?.version === 3 && notes.trim() ? { descriptionLog: receipt.descriptionLog } :
            !notes.trim() ? { descriptionLog: makeCompactCalendarDescription('', imported).descriptionLog } : {}) } } });
      for (const range of snapshotRanges) changed.add(range.dateKey);
      const importedRows = (await getEntriesForBlock(binding.blockId)).filter((entry) => activityIntervalContains(nextInterval, entry));
      const nextCoordinates = new Set(importedRows.map((entry) => `${entry.dateKey}:${entry.minuteIndex}`));
      const removedRows = entries.filter((entry) => !nextCoordinates.has(`${entry.dateKey}:${entry.minuteIndex}`))
        .map((entry) => ({ ...entry, text: '', categoryId: 'unaccounted', blockId: '' }));
      notifyCalendarColorImported([...removedRows, ...importedRows], true);
    } catch (error) {
      failures.push(await bindingReviewFailure(binding, error));
      blocked.add(binding.blockId);
    }
  }
  return { changedDates: [...changed], failures, locallyNewerBlocks: [...locallyNewer] };
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
    const updatedId = await nativeCalendarMutations.updateEventAsync(existing.id, details);
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
    const pendingBinding = { calendarId, eventId: intent.eventId, blockId: segment.blockId,
      segmentKey: segment.segmentKey, dateKey: segment.dateKey, updatedAt: '' };
    const recorded = await readNativeBoundEvent(pendingBinding);
    if (recorded) {
      if (recorded.calendarId !== calendarId) throw new Error('The unfinished calendar update belongs to a different calendar.');
      const source = await requireUnchangedNativeEvent({ calendarId, eventId: intent.eventId, blockId: segment.blockId,
        segmentKey: segment.segmentKey, dateKey: segment.dateKey, updatedAt: '' });
      await requireNativeWriteAuthority(segment.blockId, canContinue);
      const details = eventDetails(segment, typeof source?.title === 'string' ? source.title : undefined);
      const updatedId = await nativeCalendarMutations.updateEventAsync(intent.eventId, details);
      const recoveredId = updatedId || intent.eventId;
      await recordNativeWrite(calendarId, recoveredId, segment, details);
      if (recoveredId !== intent.eventId) await setSetting(intentKey, { ...intent, eventId: recoveredId });
      claimedEventIds.add(recoveredId);
      return recoveredId;
    }
    throw new Error('The unfinished linked calendar event was deleted. Review its old border before creating a new activity; Context will not recreate the deleted event.');
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
  const eventId = await nativeCalendarMutations.createEventAsync(calendarId, eventDetails(segment));
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

async function boundEventIsDefinitelyMissing(binding: SyncBinding) {
  // The same exact-ID reader and coded not-found boundary is used for every
  // deletion confirmation; an Android legacy mapper error is never absence.
  return await readNativeBoundEvent(binding) === null;
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
  if (!source) throw new Error('This linked calendar event was deleted. Refresh to import its deletion; Context will not recreate it.');
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
      await nativeCalendarMutations.deleteEventAsync(replacementId).catch(() => undefined);
      throw error;
    }
    try {
      await nativeCalendarMutations.deleteEventAsync(binding.eventId);
    } catch (deleteError) {
      if (!canContinue()) {
        await nativeCalendarMutations.deleteEventAsync(replacementId).catch(() => undefined);
        throw new ProjectionCancelledError();
      }
      let oldEventIsGone = false;
      try {
        oldEventIsGone = await boundEventIsDefinitelyMissing(binding);
      } catch {
        oldEventIsGone = false;
      }
      if (!canContinue()) {
        await nativeCalendarMutations.deleteEventAsync(replacementId).catch(() => undefined);
        throw new ProjectionCancelledError();
      }
      if (!oldEventIsGone) {
        // Keep the old binding intact. Best-effort rollback prevents an untracked duplicate.
        await nativeCalendarMutations.deleteEventAsync(replacementId).catch(() => undefined);
        throw deleteError;
      }
    }
    return { eventId: replacementId, action: 'created' };
  }

  await requireNativeWriteAuthority(segment.blockId, canContinue);
  try {
    const details = eventDetails(segment, typeof source?.title === 'string' ? source.title : undefined);
    const updatedId = await nativeCalendarMutations.updateEventAsync(binding.eventId, details);
    await recordNativeWrite(targetCalendarId, updatedId || binding.eventId, segment, details);
    return { eventId: updatedId || binding.eventId, action: 'updated' };
  } catch (updateError) {
    if (!canContinue()) throw new ProjectionCancelledError();
    let eventIsMissing = false;
    try {
      eventIsMissing = await boundEventIsDefinitelyMissing(binding);
    } catch {
      // A failed lookup is not a safe reason to create a second copy.
      throw updateError;
    }
    if (!canContinue()) throw new ProjectionCancelledError();
    if (!eventIsMissing) throw updateError;

    throw new Error('This linked calendar event was deleted while synchronizing. Refresh to import its deletion; Context will not recreate it.');
  }
}

export type CalendarSyncResult = {
  created: number;
  updated: number;
  removed: number;
  deferred?: true;
};

export type CalendarProjectionOptions = { existingBindingsOnly?: boolean };

async function retimeExactNativeBinding(plan: Exclude<NativeBoundRetimePlan, { kind: 'deferred' }>,
  members: readonly MinuteEntry[], canContinue: () => boolean): Promise<boolean | null> {
  const { binding, segment, afterBinding } = plan;
  requireNativeSegmentShape(segment);
  const requireLocalCurrent = async () => {
    if (!canContinue()) throw new ProjectionCancelledError();
    requireCalendarColorImportCurrent(members);
    const [currentMembers, currentBindings, currentSegments] = await Promise.all([
      getEntriesForBlock(binding.blockId), getSyncBindingsForBlock(binding.blockId), getNativeCalendarSegments(segment.dateKey),
    ]);
    const current = currentSegments.filter((item) => item.blockId === binding.blockId);
    if (hashValue(currentMembers) !== hashValue(members) || currentBindings.length !== 1 ||
        hashValue(currentBindings[0]) !== hashValue(binding) || current.length !== 1 || hashValue(current[0]) !== hashValue(segment)) {
      throw new Error('This activity changed while its calendar time was being checked. Retry synchronization.');
    }
    requireCalendarColorImportCurrent(members);
    await requireNativeWriteAuthority(binding.blockId, canContinue, binding);
  };
  await requireLocalCurrent();
  const source = await requireUnchangedNativeEvent(binding);
  if (!source) return null; // Never replace an original that disappeared.
  const details = eventDetails(segment, typeof source.title === 'string' ? source.title : undefined);
  const receipt = await getSetting<NativeWriteReceipt | null>(nativeWriteReceiptKey(binding.calendarId, binding.eventId), null);
  await requireLocalCurrent();
  if (await getCalendarPermissionStatus() !== 'granted') throw new Error('Calendar access changed. Retry after allowing calendar reading.');
  const latest = await requireUnchangedNativeEvent(binding);
  if (!latest) return null;
  await requireLocalCurrent();
  let updated = false;
  // A committed target receipt with the old key is a recoverable interrupted
  // rekey, not permission to create another event or skip the binding move.
  if (receipt?.version !== 2 || receipt.localHash !== nativeLocalHash(segment) ||
      nativeEventContentHash(latest) !== nativeEventContentHash(details)) {
    const returnedId = await nativeCalendarMutations.updateEventAsync(binding.eventId, details);
    if (returnedId && returnedId !== binding.eventId) {
      throw new Error('The calendar changed this linked event identifier. Review its original link before synchronizing again.');
    }
    if (!canContinue()) throw new ProjectionCancelledError();
    await recordNativeWrite(binding.calendarId, binding.eventId, segment, details);
    updated = true;
  }
  await requireLocalCurrent();
  await remapActivitySyncBindings(binding.blockId, [{ before: binding, after: afterBinding }], members);
  await applyDesiredNativeColor(binding.calendarId, binding.eventId, segment, canContinue);
  return updated;
}

/** Coexistence with an account writer authorizes only the selected calendar's
 * exact private bindings. One globally unambiguous border may rekey its same
 * original event; it never adopts, creates or replaces events. */
async function syncExistingBoundActualDay(value: string, calendarId: string, canContinue: () => boolean,
  excludedBlocks: ReadonlySet<string>, failures?: NativeCalendarBindingFailure[]): Promise<CalendarSyncResult> {
  if (projectionTargetCalendarId !== calendarId) return { created: 0, updated: 0, removed: 0, deferred: true };
  const generation = projectionGeneration;
  const blocked = new Set(excludedBlocks);
  const currentPass = () => canContinue() && projectionGeneration === generation && projectionTargetCalendarId === calendarId;
  const owned = await accountOwnedCalendarBlocks();
  const segments = await getNativeCalendarSegments(value);
  const bindings = await nativeBindingsForSegments(value, segments);
  const candidates = new Map(bindings.map((binding) => [binding.segmentKey, binding]));
  for (const segment of segments) {
    if (!segment.activityTitle || owned.has(segment.blockId) || excludedBlocks.has(segment.blockId)) continue;
    const global = await getSyncBindingsForBlock(segment.blockId);
    if (global.length === 1) candidates.set(global[0]!.segmentKey, global[0]!);
  }
  const selectedBindings = [...candidates.values()].filter((binding) => binding.calendarId === calendarId && !owned.has(binding.blockId) && !excludedBlocks.has(binding.blockId));
  let deferred = bindings.some((binding) => !selectedBindings.some((selected) => selected.segmentKey === binding.segmentKey)) || segments.some((segment) =>
    (segment.activityTitle || bindings.some((binding) => binding.blockId === segment.blockId)) &&
    !selectedBindings.some((binding) => binding.blockId === segment.blockId));
  let updated = 0; let removed = 0;
  for (const binding of selectedBindings) {
    if (blocked.has(binding.blockId)) continue;
    try {
      if (!currentPass()) throw new ProjectionCancelledError();
      const segment = segments.find((item) => item.segmentKey === binding.segmentKey && item.blockId === binding.blockId);
      if (segment?.activityTitle && (await getSyncBindingsForBlock(binding.blockId)).length !== 1) {
        throw new Error('This bordered activity has multiple calendar links. Review those exact events before synchronizing.');
      }
      if (!segment) {
        const members = await getEntriesForBlock(binding.blockId);
        if (members.length) {
          const memberDates = [...new Set(members.map((member) => member.dateKey))];
          const globalSegments = memberDates.length <= 2
            ? (await getNativeCalendarSegments(memberDates[0]!)).filter((item) => item.blockId === binding.blockId) : [];
          const plan = planNativeBoundRetime({ blockId: binding.blockId, selectedCalendarId: calendarId,
            hasAccountOwner: (await accountOwnedCalendarBlocks()).has(binding.blockId),
            bindings: await getSyncBindingsForBlock(binding.blockId), segments: globalSegments, processingDate: value });
          const tailShrink = plan.kind === 'defer-source-cleanup' &&
            bindingInterval(binding.segmentKey, binding.blockId)?.endDateKey === value && plan.segment.dateKey === binding.dateKey;
          if (plan.kind === 'retime' || tailShrink) {
            const result = await retimeExactNativeBinding(plan, members, currentPass);
            if (result === null) deferred = true;
            else if (result) updated++;
            continue;
          }
          deferred = true; continue;
        }
      }
      const interval = bindingInterval(binding.segmentKey, binding.blockId);
      if (!interval || interval.dateKey !== binding.dateKey) { deferred = true; continue; }
      const source = await requireUnchangedNativeEvent(binding);
      if (!source) {
        if (!(await importNativeBoundDeletion(binding)).length) { deferred = true; continue; }
        removed++; continue;
      }
      await requireNativeWriteAuthority(binding.blockId, currentPass, binding);
      if (segment) {
        const receipt = await getSetting<NativeWriteReceipt | null>(nativeWriteReceiptKey(calendarId, binding.eventId), null);
        if (receipt?.version === 2 && receipt.localHash === nativeLocalHash(segment)) {
          await applyDesiredNativeColor(calendarId, binding.eventId, segment, currentPass);
          continue;
        }
        const latest = await requireUnchangedNativeEvent(binding);
        if (!latest) { deferred = true; continue; }
        await requireNativeWriteAuthority(binding.blockId, currentPass, binding);
        const details = eventDetails(segment, typeof latest.title === 'string' ? latest.title : undefined);
        const returnedId = await nativeCalendarMutations.updateEventAsync(binding.eventId, details);
        if (returnedId && returnedId !== binding.eventId) {
          throw new Error('The calendar changed this linked event identifier. Review its original link before synchronizing again.');
        }
        if (!currentPass()) throw new ProjectionCancelledError();
        await recordNativeWrite(calendarId, binding.eventId, segment, details);
        await applyDesiredNativeColor(calendarId, binding.eventId, segment, currentPass);
        updated++;
      } else {
        const latest = await requireUnchangedNativeEvent(binding);
        if (!latest) { deferred = true; continue; }
        await requireNativeWriteAuthority(binding.blockId, currentPass, binding);
        await nativeCalendarMutations.deleteEventAsync(binding.eventId);
        await requireNativeWriteAuthority(binding.blockId, currentPass, binding);
        if (!(await importNativeBoundDeletion(binding)).length) throw new ProjectionCancelledError();
        removed++;
      }
    } catch (error) {
      if (!failures) throw error;
      failures.push(await bindingReviewFailure(binding, error));
      blocked.add(binding.blockId); deferred = true;
    }
  }
  return { created: 0, updated, removed, ...(deferred ? { deferred: true as const } : {}) };
}

export async function syncActualDay(
  value: string,
  calendarId: string,
  canContinue: () => boolean = () => true,
  options: CalendarProjectionOptions = {},
  excludedBlocks: ReadonlySet<string> = new Set(),
  failures?: NativeCalendarBindingFailure[],
): Promise<CalendarSyncResult> {
  if (isWeb()) return { created: 0, updated: 0, removed: 0 };
  if (options.existingBindingsOnly) return syncExistingBoundActualDay(value, calendarId, canContinue, excludedBlocks, failures);
  const blocked = new Set(excludedBlocks);
  if (await hasConfiguredAccountCalendarWriter()) return { created: 0, updated: 0, removed: 0, deferred: true };
  const owned = await accountOwnedCalendarBlocks();
  const allSegments = await getNativeCalendarSegments(value);
  const initialBindings = await nativeBindingsForSegments(value, allSegments);
  const legacyBoundBlocks = new Set(initialBindings.map((binding) => binding.blockId));
  // Ordinary minute notes belong only to the private ledger. A deliberate
  // bordered activity or an existing exact legacy binding is a calendar event.
  const segments = allSegments.filter((segment) => !owned.has(segment.blockId) && !blocked.has(segment.blockId) &&
    (Boolean(segment.activityTitle) || legacyBoundBlocks.has(segment.blockId)));
  for (const blockId of new Set(segments.filter((segment) => isActivityGroupId(segment.blockId)).map((segment) => segment.blockId))) {
    try {
      for (const segment of segments.filter((item) => item.blockId === blockId)) requireNativeSegmentShape(segment);
      const members = await getEntriesForBlock(blockId);
      if (members.length > 1440) continue;
      const existing = await getSyncBindingsForBlock(blockId);
      if (!existing.length) continue;
      if (existing.length === 1 && existing[0]!.calendarId === calendarId &&
          (members.some((entry) => entry.dateKey !== members[0]!.dateKey) ||
            Boolean(bindingInterval(existing[0]!.segmentKey, blockId)?.endDateKey))) continue;
      if (members.some((entry) => entry.dateKey !== members[0]!.dateKey)) {
        throw new Error('This overnight activity has multiple calendar links. Review those exact events before synchronizing.');
      }
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
    } catch (error) {
      const binding = (await getSyncBindingsForBlock(blockId))[0];
      if (!failures || !binding) throw error;
      failures.push(await bindingReviewFailure(binding, error)); blocked.add(blockId);
    }
  }
  const allBindings = await nativeBindingsForSegments(value, segments);
  const bindings = allBindings.filter((binding) => !owned.has(binding.blockId) && !blocked.has(binding.blockId));
  const deferred = allSegments.some((segment) => owned.has(segment.blockId) || blocked.has(segment.blockId)) || allBindings.length !== bindings.length;
  const unused = new Map(bindings.map((binding) => [binding.segmentKey, binding]));
  const claimedEventIds = new Set(
    allBindings
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
    if (blocked.has(segment.blockId)) continue;
    try {
      if (!canContinue()) throw new ProjectionCancelledError();
      let binding = unused.get(segment.segmentKey);
      if (!binding) {
        binding = (byBlock.get(segment.blockId) ?? []).find((candidate) =>
          unused.has(candidate.segmentKey),
        );
      }

      if (binding) {
        unused.delete(binding.segmentKey);
        if (binding.calendarId === calendarId && binding.segmentKey !== segment.segmentKey && segment.activityTitle) {
          const members = await getEntriesForBlock(segment.blockId);
          const plan = planNativeBoundRetime({ blockId: segment.blockId, selectedCalendarId: calendarId,
            hasAccountOwner: (await accountOwnedCalendarBlocks()).has(segment.blockId),
            bindings: await getSyncBindingsForBlock(segment.blockId), segments: [segment], processingDate: value });
          if (plan.kind !== 'retime') throw new Error('This activity changed with an ambiguous calendar shape. Review its original event before synchronizing.');
          const changed = await retimeExactNativeBinding(plan, members, canContinue);
          if (changed === null) throw new Error('The original calendar event is unavailable. Its linked activity remains pending.');
          if (changed) updated++;
          continue;
        }
        if (segment.endMinute >= 1440 && binding.calendarId === calendarId) {
          await requireUnchangedNativeEvent(binding);
          const receipt = await getSetting<NativeWriteReceipt | null>(nativeWriteReceiptKey(calendarId, binding.eventId), null);
          if (receipt?.version === 2 && receipt.localHash === nativeLocalHash(segment)) {
            await applyDesiredNativeColor(calendarId, binding.eventId, segment, canContinue);
            continue;
          }
        }
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
        await applyDesiredNativeColor(calendarId, reconciliation.eventId, segment, canContinue, reconciliation.action === 'created');
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
        await applyDesiredNativeColor(calendarId, eventId, segment, canContinue, true);
        if (!canContinue()) throw new ProjectionCancelledError();
        created += 1;
      }
    } catch (error) {
      const binding = (await getSyncBindingsForBlock(segment.blockId))[0];
      if (!failures || !binding) throw error;
      failures.push(await bindingReviewFailure(binding, error)); blocked.add(segment.blockId);
    }
  }

  let removed = 0;
  let cleanupError: unknown;
  for (const binding of unused.values()) {
    if (blocked.has(binding.blockId)) continue;
    try {
      if (!canContinue()) throw new ProjectionCancelledError();
      if (!segments.some((segment) => segment.blockId === binding.blockId) &&
          (await getEntriesForBlock(binding.blockId)).some((entry) => entry.dateKey !== value)) {
        const members = await getEntriesForBlock(binding.blockId);
        const existing = await getSyncBindingsForBlock(binding.blockId);
        if (existing.length === 1 && members.length) {
          const target = (await getNativeCalendarSegments(members[0]!.dateKey)).filter((segment) => segment.blockId === binding.blockId);
          const plan = planNativeBoundRetime({ blockId: binding.blockId, selectedCalendarId: calendarId,
            hasAccountOwner: (await accountOwnedCalendarBlocks()).has(binding.blockId), bindings: existing,
            segments: target, processingDate: value });
          if (plan.kind === 'defer-source-cleanup') {
            if (bindingInterval(binding.segmentKey, binding.blockId)?.endDateKey === value && plan.segment.dateKey === binding.dateKey) {
              const changed = await retimeExactNativeBinding(plan, members, canContinue);
              if (changed === null) throw new Error('The original calendar event is unavailable. Its linked activity remains pending.');
              if (changed) updated++;
            }
            continue;
          }
          if (plan.kind === 'deferred') throw new Error('This moved activity has an ambiguous source border. Review its complete calendar range.');
        }
        const previous = existing.map((item) => bindingInterval(item.segmentKey, binding.blockId));
        const current = (await Promise.all([...new Set(members.map((member) => member.dateKey))].map(getNativeCalendarSegments)))
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
        await nativeCalendarMutations.deleteEventAsync(binding.eventId);
        remoteEventIsGone = true;
      } catch (deleteError) {
        if (!canContinue()) throw new ProjectionCancelledError();
        try {
          remoteEventIsGone = await boundEventIsDefinitelyMissing(binding);
        } catch {
          remoteEventIsGone = false;
        }
        if (!canContinue()) throw new ProjectionCancelledError();
        if (!remoteEventIsGone) {
          if (failures) { failures.push(await bindingReviewFailure(binding, deleteError)); blocked.add(binding.blockId); continue; }
          cleanupError ??= deleteError;
          continue;
        }
      }

      // A binding is removed only after deletion succeeds or absence is confirmed.
      try {
        if (!(await importNativeBoundDeletion(binding)).length) throw new ProjectionCancelledError();
        removed += 1;
        if (!canContinue()) throw new ProjectionCancelledError();
      } catch (error) {
        if (failures) { failures.push(await bindingReviewFailure(binding, error)); blocked.add(binding.blockId); continue; }
        cleanupError ??= error;
      }
    } catch (error) {
      if (!failures) throw error;
      failures.push(await bindingReviewFailure(binding, error)); blocked.add(binding.blockId);
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
  reviewMessages?: string[];
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
  const reviewMessages = new Set<string>();
  const canContinue = () =>
    projectionGeneration === expectedGeneration &&
    projectionTargetCalendarId === calendarId;

  for (const item of pending) {
    if (!canContinue()) break;
    try {
      let bindingFailures: NativeCalendarBindingFailure[] = [];
      const owned = await accountOwnedCalendarBlocks();
      const sourceDates = new Set<string>();
      const relevantBlocks = new Set<string>();
      const pendingSegments = await getNativeCalendarSegments(item.dateKey);
      for (const binding of await nativeBindingsForSegments(item.dateKey, pendingSegments)) {
        if (binding.calendarId !== calendarId || owned.has(binding.blockId)) continue;
        sourceDates.add(binding.dateKey); relevantBlocks.add(binding.blockId);
      }
      // A target-day resize/move may still own its single exact source-day key.
      // Preflight that old source too, so its conflict cannot block unrelated
      // target-day events or slip past the excluded-block set.
      for (const segment of pendingSegments) {
        if (!segment.activityTitle || owned.has(segment.blockId)) continue;
        const global = await getSyncBindingsForBlock(segment.blockId);
        if (global.length !== 1 || global[0]!.calendarId !== calendarId) continue;
        sourceDates.add(global[0]!.dateKey); relevantBlocks.add(segment.blockId);
      }
      if (sourceDates.size) {
        const calendars = await listDeviceCalendars();
        for (const sourceDate of sourceDates) {
          const read = await loadPlannedEventsResult([calendarId], sourceDate, calendars);
          if (read.failures.length) throw new CalendarReadError(read.plans, read.failures);
          bindingFailures.push(...(await reconcileLinkedNativeColorsResult(sourceDate, read.plans, calendars)).failures
            .filter((failure) => relevantBlocks.has(failure.blockId)));
        }
      }
      if (!canContinue()) throw new ProjectionCancelledError();
      const result = await syncActualDay(item.dateKey, calendarId, canContinue, options,
        new Set(bindingFailures.map((failure) => failure.blockId)), bindingFailures);
      if (!canContinue()) throw new ProjectionCancelledError();
      if (bindingFailures.length) {
        for (const failure of bindingFailures) reviewMessages.add(failure.message);
        await markSyncDateFailed(item.dateKey, item.updatedAt, new NativeCalendarReconciliationError(bindingFailures));
        failed += 1;
        continue;
      }
      if (result.deferred) { deferred = true; continue; }
      await markSyncDateComplete(item.dateKey, item.updatedAt);
      succeeded += 1;
    } catch (error) {
      if (error instanceof ProjectionCancelledError) break;
      if (error instanceof Error && error.message) reviewMessages.add(error.message.slice(0, 1000));
      await markSyncDateFailed(item.dateKey, item.updatedAt, error).catch(() => undefined);
      failed += 1;
    }
  }

  const remaining = (await getPendingSyncDates(1)).length;
  return { attempted: pending.length, succeeded, failed, remaining, ...(deferred ? { deferred: true as const } : {}),
    ...(reviewMessages.size ? { reviewMessages: [...reviewMessages] } : {}) };
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
