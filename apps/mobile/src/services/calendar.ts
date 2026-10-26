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
  setSetting,
} from '../data/database';
import { categoryById } from '../theme';
import type { ActivitySegment, DeviceCalendar, PlannedEvent, SyncBinding } from '../types';
import { addDays, dateKey, localDateAtMinute, minuteLabel, parseDateKey } from '../utils/time';
import { isActivityGroupId } from '../utils/cell-format';
import { bindingInterval, matchActivityTranslation } from '../utils/activity-translation';
import { nativeEventColor } from '../utils/calendar-cell-color';
import { getAccounts } from '../sync/accounts';

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
  const lines = segment.entries.map(
    (entry) => `${minuteLabel(entry.minuteIndex, true)}  ${entry.text}`,
  );
  return {
    title: segmentTitle(segment),
    startDate: localDateAtMinute(segment.dateKey, segment.startMinute),
    endDate: localDateAtMinute(segment.dateKey, segment.endMinute + 1),
    timeZone,
    notes: lines.join('\n'),
  };
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
    const updatedId = await Calendar.updateEventAsync(existing.id, eventDetails(segment));
    const eventId = updatedId || existing.id;
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
      if (!canContinue()) throw new ProjectionCancelledError();
      const updatedId = await Calendar.updateEventAsync(intent.eventId, eventDetails(segment));
      const recoveredId = updatedId || intent.eventId;
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
  const eventId = await Calendar.createEventAsync(calendarId, eventDetails(segment));
  if (!eventId) throw new Error('The calendar did not return its event identifier, so this device-calendar link is paused. Review and link any existing calendar event before using account calendar editing; enabling editing alone does not reuse it.');
  await setSetting(intentKey, { ...pending, eventId });
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
  if (binding.calendarId !== targetCalendarId) {
    // Create first so changing the destination can never erase the only remote copy.
    const replacementId = await createSegmentEvent(
      targetCalendarId,
      segment,
      claimedEventIds,
      canContinue,
    );
    if (!canContinue()) {
      // The in-flight create finished after opt-out. Roll it back so the old binding remains true.
      await Calendar.deleteEventAsync(replacementId).catch(() => undefined);
      throw new ProjectionCancelledError();
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

  try {
    const updatedId = await Calendar.updateEventAsync(binding.eventId, eventDetails(segment));
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
};

export async function syncActualDay(
  value: string,
  calendarId: string,
  canContinue: () => boolean = () => true,
): Promise<CalendarSyncResult> {
  if (isWeb()) return { created: 0, updated: 0, removed: 0 };

  const segments = await getDaySegments(value);
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
  const bindings = await getSyncBindings(value);
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
  return { created, updated, removed };
}

export type CalendarOutboxResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  remaining: number;
};

async function flushPendingActualsOnce(
  calendarId: string,
  limit: number,
  priorityDates: string[],
  expectedGeneration: number,
): Promise<CalendarOutboxResult> {
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
  const canContinue = () =>
    projectionGeneration === expectedGeneration &&
    projectionTargetCalendarId === calendarId;

  for (const item of pending) {
    if (!canContinue()) break;
    try {
      await syncActualDay(item.dateKey, calendarId, canContinue);
      if (!canContinue()) throw new ProjectionCancelledError();
      await markSyncDateComplete(item.dateKey, item.updatedAt);
      succeeded += 1;
    } catch (error) {
      if (error instanceof ProjectionCancelledError) break;
      await markSyncDateFailed(item.dateKey, item.updatedAt, error).catch(() => undefined);
      failed += 1;
    }
  }

  const remaining = (await getPendingSyncDates(1)).length;
  return { attempted: pending.length, succeeded, failed, remaining };
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
