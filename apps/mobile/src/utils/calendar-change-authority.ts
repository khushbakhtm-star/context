/** Calendar versions/ETags and event start times are not modification times.
 * Only genuine provider mutation timestamps can order an edit against Context. */
export function calendarMutationTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const civil = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (!Number.isFinite(civil.getTime()) || civil.toISOString().slice(0, 10) !== `${year}-${month}-${day}` ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** Resolve competing *changed* states. Equal timestamps consistently favor the
 * calendar. A confirmed missing event has no invented deletion timestamp: its
 * absence wins unless a genuine older deletion can be compared to a local edit.
 * Permission/network failures must never be passed as confirmed deletions. */
export function latestCalendarChange(input: {
  localUpdatedAt: number | null;
  remoteUpdatedAt?: string;
  remoteDeleted?: boolean;
}): 'context' | 'calendar' | 'unknown' {
  const local = input.localUpdatedAt !== null && Number.isFinite(input.localUpdatedAt) && input.localUpdatedAt >= 0
    ? input.localUpdatedAt : null;
  const remote = calendarMutationTime(input.remoteUpdatedAt);
  if (input.remoteDeleted && remote === null) return 'calendar';
  if (local === null || remote === null) return 'unknown';
  return local > remote ? 'context' : 'calendar';
}
