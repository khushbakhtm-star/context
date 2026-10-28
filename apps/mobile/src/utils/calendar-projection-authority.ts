import type { ConnectedAccount, RemoteCalendarEvent } from '../sync/types';

export type AccountProjectionAuthority = {
  hasNativeBinding: boolean;
  /** Only an exact block's non-deleted durable account projection counts. */
  hasAccountProjection: boolean;
  sourceAccountId?: string;
  sourceAccount?: ConnectedAccount | null;
  sourceEvent?: RemoteCalendarEvent | null;
  sourceScope?: 'occurrence' | 'series';
};

/** Additional native-ownership barrier, after normal account writer routing.
 * A configured Actuals calendar never authorizes migration of a native-bound
 * event. Only an existing exact account owner or an explicitly chosen permitted
 * source occurrence can establish that authority. Titles/times are not identity.
 */
export function canCreateAccountProjection(input: AccountProjectionAuthority): boolean {
  if (!input.hasNativeBinding || input.hasAccountProjection) return true;
  const account = input.sourceAccount;
  const event = input.sourceEvent;
  if (!account || !event || input.sourceAccountId !== account.id ||
      (account.provider !== 'google' && account.provider !== 'microsoft') ||
      !account.consent.calendarRead || !account.consent.calendarWrite || !account.consent.replaceOccurrences ||
      !event.id || !event.calendarId || event.deleted || event.allDay || event.isSeriesMaster ||
      event.projectionId != null || event.canEdit === false) return false;
  if (event.isInvitation && !account.consent.editInvitations) return false;
  if (input.sourceScope === 'series' && !account.consent.editSeries) return false;
  return true;
}
