import type { PlannedEvent } from '../types';
import type { ConnectedAccount, RemoteCalendarEvent } from '../sync/types';
import { addDays, dateKey, localDateAtMinute, parseDateKey } from './time';

export const ACCOUNT_PLAN_READ_TIMEOUT_MS = 10_000;
export const ACCOUNT_PLAN_READ_LEASE_MS = 60_000;
const MAX_CACHED_PLANS = 10_000;
const MAX_CACHE_CHARACTERS = 4 * 1024 * 1024;

export type AccountPlanScope = {
  dateKey: string;
  accountId: string;
  subject: string;
  provider: 'google' | 'microsoft';
  calendarIds: string[];
  start: string;
  end: string;
};

export function accountPlanScope(account: ConnectedAccount, value: string,
  selectedCalendarIds: readonly string[]): AccountPlanScope | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1000-01-01' || dateKey(parseDateKey(value)) !== value) {
    throw new Error('Choose a valid calendar date.');
  }
  if (!account.consent.calendarRead || (account.provider !== 'google' && account.provider !== 'microsoft')) return null;
  const calendarIds = [...new Set(selectedCalendarIds.filter((id) => typeof id === 'string' && id.length > 0))].sort();
  if (!calendarIds.length) return null;
  return { dateKey: value, accountId: account.id, subject: account.subject, provider: account.provider, calendarIds,
    start: localDateAtMinute(value, 0).toISOString(), end: localDateAtMinute(dateKey(addDays(value, 1)), 0).toISOString() };
}

export function accountPlanScopeIdentity(scope: AccountPlanScope): string {
  return JSON.stringify([scope.dateKey, scope.accountId, scope.subject, scope.provider, scope.calendarIds, scope.start, scope.end]);
}

function validRemoteEvent(value: unknown): value is RemoteCalendarEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as RemoteCalendarEvent;
  return ['id', 'calendarId', 'title', 'description', 'start', 'end', 'timeZone', 'version'].every((key) =>
    typeof event[key as keyof RemoteCalendarEvent] === 'string') && Boolean(event.id) &&
    ['allDay', 'isSeriesMaster', 'deleted'].every((key) => typeof event[key as keyof RemoteCalendarEvent] === 'boolean') &&
    Number.isFinite(Date.parse(event.start)) && Number.isFinite(Date.parse(event.end)) &&
    Date.parse(event.end) > Date.parse(event.start) && !event.deleted;
}

/** The cache is a device-local display snapshot. Provider event/version data stays
 * opaque and is never converted into a write, projection, or private-ledger record. */
export function encodeAccountPlanCache(scope: AccountPlanScope, plans: readonly PlannedEvent[]): unknown | null {
  if (plans.length > MAX_CACHED_PLANS) return null;
  const snapshot = { version: 1, scope, plans: plans.map((plan) => ({ ...plan,
    startDate: plan.startDate.toISOString(), endDate: plan.endDate.toISOString() })) };
  const text = JSON.stringify(snapshot);
  if (text.length > MAX_CACHE_CHARACTERS) return null;
  const copy: unknown = JSON.parse(text);
  return decodeAccountPlanCache(copy, scope) ? copy : null;
}

export function decodeAccountPlanCache(value: unknown, scope: AccountPlanScope): PlannedEvent[] | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as { version?: unknown; scope?: unknown; plans?: unknown };
  if (snapshot.version !== 1 || JSON.stringify(snapshot.scope) !== JSON.stringify(scope) ||
      !Array.isArray(snapshot.plans) || snapshot.plans.length > MAX_CACHED_PLANS) return null;
  const plans: PlannedEvent[] = [];
  for (const item of snapshot.plans) {
    if (!item || typeof item !== 'object') return null;
    const plan = item as Omit<PlannedEvent, 'startDate' | 'endDate'> & { startDate: unknown; endDate: unknown };
    const event = plan.accountEvent?.event;
    if (typeof plan.id !== 'string' || typeof plan.calendarId !== 'string' || typeof plan.title !== 'string' ||
        typeof plan.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(plan.color) || typeof plan.allDay !== 'boolean' ||
        (plan.notes !== undefined && typeof plan.notes !== 'string') ||
        (plan.categoryId !== undefined && typeof plan.categoryId !== 'string') ||
        plan.sourceProvider !== scope.provider || plan.accountEvent?.accountId !== scope.accountId ||
        !scope.calendarIds.includes(plan.calendarId) || !validRemoteEvent(event) || event.calendarId !== plan.calendarId ||
        event.allDay !== plan.allDay ||
        plan.id !== `${scope.accountId}:${event.id}` || typeof plan.startDate !== 'string' || typeof plan.endDate !== 'string') return null;
    const startDate = new Date(plan.startDate); const endDate = new Date(plan.endDate);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || endDate <= startDate ||
        startDate.getTime() !== Date.parse(event.start) || endDate.getTime() !== Date.parse(event.end) ||
        startDate.getTime() >= Date.parse(scope.end) || endDate.getTime() <= Date.parse(scope.start)) return null;
    plans.push({ ...plan, startDate, endDate });
  }
  return plans;
}

/** A deadline releases UI callers without abandoning/coalescing the underlying
 * provider work. Native credential refresh cannot be safely aborted here. */
export async function accountPlanReadDeadline<T>(job: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('ACCOUNT_PLAN_READ_TIMEOUT')), ACCOUNT_PLAN_READ_TIMEOUT_MS);
  });
  try { return await Promise.race([job, deadline]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
