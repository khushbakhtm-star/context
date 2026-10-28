import type { ActivitySegment, SyncBinding } from '../types';
import { activityIntervalAbsoluteEnd, bindingInterval } from './activity-translation';
import { isCalendarEventId, validateMinuteCellRange } from './cell-format';

export type NativeBoundRetimeInput = {
  blockId: string;
  selectedCalendarId: string;
  hasAccountOwner: boolean;
  /** Complete global sets for this exact block, not just the displayed day. */
  bindings: readonly SyncBinding[];
  segments: readonly ActivitySegment[];
  processingDate: string;
};

type ReadyRetime = {
  binding: SyncBinding;
  segment: ActivitySegment;
  afterBinding: Omit<SyncBinding, 'updatedAt'>;
  sourceDate: string;
  targetDate: string;
  needsRemap: boolean;
};

export type NativeBoundRetimePlan =
  | { kind: 'deferred'; reason: 'account-owned' | 'invalid-input' | 'ambiguous-bindings' | 'different-calendar' |
      'ambiguous-segments' | 'unbordered' | 'invalid-segment' | 'unrelated-date' }
  | (ReadyRetime & { kind: 'unchanged' | 'retime' | 'defer-source-cleanup' });

function validDay(day: string) {
  try {
    validateMinuteCellRange({ dateKey: day, startMinute: 0, endMinute: 0 });
    return Number(day.slice(0, 4)) >= 1000;
  } catch { return false; }
}

/** Plan geometry only: this never proves a source write or a receipt. The caller
 * still verifies exact provider content, raw drafts, member/binding snapshots,
 * current target and account authority before a same-ID write and atomic rekey.
 * A matching target receipt can skip the write, but must not skip needsRemap.
 */
export function planNativeBoundRetime(input: NativeBoundRetimeInput): NativeBoundRetimePlan {
  if (input.hasAccountOwner) return { kind: 'deferred', reason: 'account-owned' };
  if (typeof input.hasAccountOwner !== 'boolean' || !isCalendarEventId(input.blockId) || typeof input.selectedCalendarId !== 'string' || !input.selectedCalendarId ||
      !validDay(input.processingDate) || !Array.isArray(input.bindings) || !Array.isArray(input.segments)) {
    return { kind: 'deferred', reason: 'invalid-input' };
  }
  if (input.bindings.length !== 1) return { kind: 'deferred', reason: 'ambiguous-bindings' };
  const binding: SyncBinding = input.bindings[0]!;
  if (!binding || binding.blockId !== input.blockId || typeof binding.segmentKey !== 'string' ||
      typeof binding.eventId !== 'string' || !binding.eventId || typeof binding.updatedAt !== 'string') {
    return { kind: 'deferred', reason: 'invalid-input' };
  }
  if (binding.calendarId !== input.selectedCalendarId) return { kind: 'deferred', reason: 'different-calendar' };
  const before = bindingInterval(binding.segmentKey, input.blockId);
  if (!before || !validDay(binding.dateKey) || before.dateKey !== binding.dateKey) {
    return { kind: 'deferred', reason: 'invalid-input' };
  }
  if (input.segments.length !== 1) return { kind: 'deferred', reason: 'ambiguous-segments' };
  const segment: ActivitySegment = input.segments[0]!;
  if (!segment || typeof segment.activityTitle !== 'string' || !segment.activityTitle.trim() || segment.activityTitle.trim().length > 200) {
    return { kind: 'deferred', reason: 'unbordered' };
  }
  const targetInterval = bindingInterval(segment.segmentKey, input.blockId);
  if (!targetInterval || targetInterval.dateKey !== segment.dateKey || targetInterval.startMinute !== segment.startMinute ||
      activityIntervalAbsoluteEnd(targetInterval) !== segment.endMinute) return { kind: 'deferred', reason: 'invalid-segment' };
  if (!validDay(segment.dateKey) || segment.blockId !== input.blockId ||
      segment.segmentKey !== `${segment.dateKey}:${input.blockId}:${segment.startMinute}-${segment.endMinute}` ||
      !Array.isArray(segment.entries) || segment.entries.length !== segment.endMinute - segment.startMinute + 1 ||
      new Set(segment.entries.map((entry) => entry?.id)).size !== segment.entries.length ||
      segment.entries.some((entry, index) => !entry || entry.blockId !== input.blockId ||
        Date.parse(`${entry.dateKey}T00:00:00Z`) / 60_000 + entry.minuteIndex !==
          Date.parse(`${segment.dateKey}T00:00:00Z`) / 60_000 + segment.startMinute + index ||
        !validDay(entry.dateKey) || !Number.isInteger(entry.minuteIndex) || entry.minuteIndex < 0 || entry.minuteIndex >= 1440 || typeof entry.id !== 'string' || !entry.id ||
        typeof entry.text !== 'string' || typeof entry.categoryId !== 'string' || !entry.categoryId)) {
    return { kind: 'deferred', reason: 'invalid-segment' };
  }
  const targetDate = segment.dateKey;
  const targetDays = new Set(segment.entries.map((entry) => entry.dateKey));
  if (!targetDays.has(input.processingDate) && input.processingDate !== binding.dateKey && input.processingDate !== before.endDateKey) {
    return { kind: 'deferred', reason: 'unrelated-date' };
  }
  const needsRemap = binding.segmentKey !== segment.segmentKey || binding.dateKey !== targetDate;
  return {
    kind: !targetDays.has(input.processingDate) ? 'defer-source-cleanup' : needsRemap ? 'retime' : 'unchanged',
    binding: { ...binding },
    segment: { ...segment, entries: segment.entries.map((entry) => ({ ...entry })) },
    afterBinding: { segmentKey: segment.segmentKey, blockId: input.blockId, dateKey: targetDate,
      calendarId: binding.calendarId, eventId: binding.eventId },
    sourceDate: binding.dateKey,
    targetDate,
    needsRemap,
  };
}
