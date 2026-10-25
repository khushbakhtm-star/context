import { acknowledgeInlineMinuteLink, deleteMinuteEntry, getMinuteEntry, getPendingInlineMinuteLinks, saveMinuteRange } from '../data/database';
import { linkActualsToAccounts, synchronizeAccounts } from '../sync/engine';
import type { MinuteEntry } from '../types';
import { InlineMinuteDrafts, type InlineMinuteValue } from '../utils/inline-minute-drafts';

export type InlineMinuteCommit = {
  dateKey: string;
  minuteIndex: number;
  affectedDates: string[];
  entry: MinuteEntry | null;
  readBackFailed?: boolean;
};

export const inlineMinuteDrafts = new InlineMinuteDrafts<InlineMinuteCommit>(async (value) => {
  const affectedDates = value.text.trim() || value.keepColor
    ? await saveMinuteRange({ dateKey: value.dateKey, startMinute: value.minuteIndex,
      durationMinutes: 1, text: value.text, categoryId: value.categoryId, allowEmptyText: value.keepColor,
      queueInlineLink: true })
    : (await deleteMinuteEntry(value.dateKey, value.minuteIndex, { queueInlineLink: true }), [value.dateKey]);
  try { return { dateKey: value.dateKey, minuteIndex: value.minuteIndex, affectedDates,
    entry: await getMinuteEntry(value.dateKey, value.minuteIndex) }; }
  catch { return { dateKey: value.dateKey, minuteIndex: value.minuteIndex, affectedDates,
    entry: null, readBackFailed: true }; }
});

// A calendar/account failure must not turn an acknowledged SQLite save into a failed draft.
// Source replacement is never inferred from an inline tap; existing bindings retain ownership.
let accountWork: Promise<void> = Promise.resolve();
let linkWarning = false;
const warningListeners = new Set<(failed: boolean) => void>();
function updateLinkWarning(failed: boolean) {
  linkWarning = failed;
  for (const listener of warningListeners) { try { listener(failed); } catch { /* A stale screen cannot affect durable synchronization. */ } }
}

export function subscribeInlineMinuteLinkWarnings(listener: (failed: boolean) => void) {
  warningListeners.add(listener); listener(linkWarning);
  return () => { warningListeners.delete(listener); };
}

/** The exact inline coordinate is queued in the same SQLite transaction as its text.
 * A crash or account-link failure leaves that ticket for startup/foreground retry. */
export function retryInlineMinuteLinks(): Promise<void> {
  const project = async () => {
    try {
      let failed = false;
      let more = true;
      while (more) {
        const pending = await getPendingInlineMinuteLinks();
        for (const ticket of pending) {
          try {
            await linkActualsToAccounts(ticket.affectedDates, null,
              { dateKey: ticket.dateKey, minuteIndex: ticket.minuteIndex });
            await acknowledgeInlineMinuteLink(ticket);
          } catch { failed = true; }
        }
        more = !failed && pending.length === 100;
      }
      updateLinkWarning(failed);
      void synchronizeAccounts();
    } catch { updateLinkWarning(true); }
  };
  accountWork = accountWork.then(project, project);
  return accountWork;
}
inlineMinuteDrafts.subscribeCommits(() => { void retryInlineMinuteLinks(); });

export function subscribeInlineMinuteCommits(listener: (commit: InlineMinuteCommit) => void) {
  return inlineMinuteDrafts.subscribeCommits((_value: InlineMinuteValue, result) => listener(result));
}

export async function flushInlineMinutes(): Promise<void> {
  await inlineMinuteDrafts.flushAll();
  await retryInlineMinuteLinks();
}
