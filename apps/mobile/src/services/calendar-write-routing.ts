import { getAccounts } from '../sync/accounts';
import { getAccountPreferences, type AccountPreferences } from '../sync/engine';
import type { ConnectedAccount } from '../sync/types';

/** Permission permits a writer; only a selected actuals destination configures
 * one. Existing source-specific projection ownership is checked per block by
 * the native projector, including when this global destination is absent. */
export function accountCalendarWriterIsConfigured(account: ConnectedAccount, preferences: AccountPreferences): boolean {
  return (account.provider === 'google' || account.provider === 'microsoft') && account.consent.calendarWrite &&
    typeof preferences.writeCalendarId === 'string' && preferences.writeCalendarId.trim().length > 0;
}

/** Device-local routing only. Never lists provider calendars, requests tokens,
 * changes consent, or chooses an actuals destination on the user's behalf. */
export async function hasConfiguredAccountCalendarWriter(): Promise<boolean> {
  const candidates = (await getAccounts()).filter((account) => account.consent.calendarWrite &&
    (account.provider === 'google' || account.provider === 'microsoft'));
  const configured = await Promise.all(candidates.map(async (account) => ({ account,
    preferences: await getAccountPreferences(account.id) })));
  // A disconnect or permission change while preferences were being read must
  // not leave the native writer suppressed by an obsolete account snapshot.
  const current = await getAccounts();
  return configured.some(({ account, preferences }) => {
    const saved = current.find((item) => item.id === account.id && item.subject === account.subject && item.provider === account.provider);
    return saved ? accountCalendarWriterIsConfigured(saved, preferences) : false;
  });
}
