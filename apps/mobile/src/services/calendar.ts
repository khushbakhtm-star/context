import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar/legacy';

import {
  deleteSyncBinding,
  getDaySegments,
  getPendingSyncDates,
  getPendingSyncDatesFor,
  getSyncBindings,
  markSyncDateComplete,
  markSyncDateFailed,
  saveSyncBinding,
} from '../data/database';
import { categoryById } from '../theme';
import type { ActivitySegment, DeviceCalendar, PlannedEvent, SyncBinding } from '../types';
import { addDays, dateKey, localDateAtMinute, minuteLabel, parseDateKey } from '../utils/time';

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
    .filter((calendar) => calendar.isVisible !== false && calendar.isSynced !== false)
    .map((calendar) => ({
      id: calendar.id,
      title: calendar.title,
      color: calendar.color || '#8E8C86',
      allowsModifications: calendar.allowsModifications,
      sourceName: calendar.source?.name || calendar.ownerAccount || 'On this device',
      isPrimary: calendar.isPrimary ?? false,
    }))
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
      return `${left.sourceName}${left.title}`.localeCompare(`${right.sourceName}${right.title}`);
    });
}

export async function loadPlannedEvents(
  calendarIds: string[],
  value: string,
  calendars: DeviceCalendar[],
): Promise<PlannedEvent[]> {
  if (isWeb() || calendarIds.length === 0) return [];
  const dayStart = parseDateKey(value);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = addDays(dayStart, 1);
  dayEnd.setHours(0, 0, 0, 0);
  // Android's legacy Calendar Provider query returns only events fully contained in the
  // requested range. Expand the query so ordinary overnight events (for example 23:00-06:00
  // sleep) are present, then apply the correct overlap filter ourselves.
  const queryStart = addDays(dayStart, -1);
  queryStart.setHours(0, 0, 0, 0);
  const queryEnd = addDays(dayEnd, 1);
  queryEnd.setHours(0, 0, 0, 0);
  const colorByCalendar = new Map(calendars.map((calendar) => [calendar.id, calendar.color]));
  const events = await Calendar.getEventsAsync(calendarIds, queryStart, queryEnd);
  const uniqueEvents = new Map<string, PlannedEvent>();
  for (const event of events) {
    const plannedEvent = {
      id: event.id,
      calendarId: event.calendarId,
      title: event.title || 'Untitled event',
      notes: event.notes || undefined,
      color: colorByCalendar.get(event.calendarId) ?? '#8E8C86',
      startDate: new Date(event.startDate),
      endDate: new Date(event.endDate),
      allDay: event.allDay,
    } satisfies PlannedEvent;
    if (plannedEvent.startDate >= dayEnd || plannedEvent.endDate <= dayStart) continue;

    // A padded Android query is required for overnight events, but some providers can
    // return the same occurrence more than once. Keep recurring occurrences distinct by
    // including their concrete start/end times in the key.
    const occurrenceKey = [
      plannedEvent.calendarId,
      plannedEvent.id,
      plannedEvent.startDate.getTime(),
      plannedEvent.endDate.getTime(),
    ].join(':');
    uniqueEvents.set(occurrenceKey, plannedEvent);
  }
  return [...uniqueEvents.values()].sort(
    (left, right) => left.startDate.getTime() - right.startDate.getTime(),
  );
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
  const calendars = await listDeviceCalendars();
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
  }, { startNewActivityTask: false });
}

export async function openPlannedEvent(event: PlannedEvent) {
  if (isWeb()) return null;
  return Calendar.openEventInCalendarAsync(
    { id: event.id, instanceStartDate: event.startDate },
    { allowsEditing: true, startNewActivityTask: false },
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
  const category = categoryById(segment.categoryId);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lines = segment.entries.map(
    (entry) => `${minuteLabel(entry.minuteIndex, true)}  ${entry.text}`,
  );
  const marker = `Context block: ${segment.blockId}`;
  const projectionMarker = `Context projection: ${segment.segmentKey}`;
  return {
    title: segmentTitle(segment),
    startDate: localDateAtMinute(segment.dateKey, segment.startMinute),
    endDate: localDateAtMinute(segment.dateKey, segment.endMinute + 1),
    timeZone,
    notes: [
      category.name,
      '',
      ...lines,
      '',
      marker,
      projectionMarker,
      'Full minute record available in Context.',
    ].join('\n'),
  };
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
  const eventId = await Calendar.createEventAsync(calendarId, eventDetails(segment));
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

  const [segments, bindings] = await Promise.all([
    getDaySegments(value),
    getSyncBindings(value),
  ]);
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
      if (!canContinue()) throw new ProjectionCancelledError();
      created += 1;
    }
  }

  let removed = 0;
  let cleanupError: unknown;
  for (const binding of unused.values()) {
    if (!canContinue()) throw new ProjectionCancelledError();
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
