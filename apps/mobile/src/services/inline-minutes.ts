import { acknowledgeInlineMinuteLink, deferInlineMinuteLink, deleteMinuteEntry, getMinuteEntry, getPendingInlineMinuteLinks, getSpreadsheetCells,
  promoteInlineMinuteLinkForAccountReview, saveMinuteRange } from '../data/database';
import { canAcknowledgeInlineMinuteLink, linkActualsToAccounts, NativeAccountLinkReviewError, requestAccountSynchronization,
  subscribeAccountSync } from '../sync/engine';
import type { MinuteEntry } from '../types';
import { InlineMinuteDrafts, type InlineMinuteValue } from '../utils/inline-minute-drafts';
import { cellEventLabel, isActivityGroupId } from '../utils/cell-format';

export type InlineMinuteCommit = {
  dateKey: string;
  minuteIndex: number;
  affectedDates: string[];
  entry: MinuteEntry | null;
  readBackFailed?: boolean;
};

export const inlineMinuteDrafts = new InlineMinuteDrafts<InlineMinuteCommit>(async (value) => {
  const previous = !value.text.trim() && !value.keepColor ? await getMinuteEntry(value.dateKey, value.minuteIndex) : null;
  const previousCell = previous && !isActivityGroupId(previous.blockId)
    ? (await getSpreadsheetCells({ dateKey: value.dateKey, startMinute: value.minuteIndex, endMinute: value.minuteIndex }))[0]
    : undefined;
  const label = previous && cellEventLabel(previousCell?.format ?? {}, previous.blockId);
  const keepColor = value.keepColor || isActivityGroupId(previous?.blockId) || Boolean(previous && label?.id === previous.blockId);
  const affectedDates = value.text.trim() || keepColor
    ? await saveMinuteRange({ dateKey: value.dateKey, startMinute: value.minuteIndex,
      durationMinutes: 1, text: value.text, categoryId: value.categoryId, allowEmptyText: keepColor,
      queueInlineLink: true })
    : (await deleteMinuteEntry(value.dateKey, value.minuteIndex, { queueInlineLink: true }), [value.dateKey]);
  try { return { dateKey: value.dateKey, minuteIndex: value.minuteIndex, affectedDates,
    entry: await getMinuteEntry(value.dateKey, value.minuteIndex) }; }
  catch { return { dateKey: value.dateKey, minuteIndex: value.minuteIndex, affectedDates,
    entry: null, readBackFailed: true }; }
});

// A calendar/account failure must not turn an acknowledged SQLite save into a failed draft.
// Source replacement is never inferred from an inline tap; existing bindings retain ownership.
let accountWork: Promise<void> | null = null;
let linkRequested = false;
let networkRequested = false;
let linkWarning = false;
let accountLinkRunning = false;
let warningGeneration = 0;
const warningListeners = new Set<(failed: boolean, running?: boolean) => void>();
function updateLinkWarning(failed: boolean) {
  linkWarning = failed;
  for (const listener of warningListeners) { try { listener(failed, accountLinkRunning); } catch { /* A stale screen cannot affect durable synchronization. */ } }
}

export function subscribeInlineMinuteLinkWarnings(listener: (failed: boolean, running?: boolean) => void) {
  warningListeners.add(listener); listener(linkWarning, accountLinkRunning);
  return () => { warningListeners.delete(listener); };
}

/** A completed cloud cycle may have drained tickets independently of this
 * local worker. Inspect every deferred ticket; never acknowledge one here. */
export async function refreshInlineMinuteLinkWarning() {
  const generation = warningGeneration;
  if (accountWork) return;
  try {
    const pending = await getPendingInlineMinuteLinks(1);
    if (generation !== warningGeneration || accountWork) return;
    if (!pending.length) updateLinkWarning(false);
  } catch { /* Preserve the previous warning when the queue cannot be checked. */ }
}

subscribeAccountSync((next) => {
  warningGeneration++;
  accountLinkRunning = next.running || next.cycleComplete === false;
  updateLinkWarning(linkWarning);
  if (!next.running && next.cycleComplete === true) void refreshInlineMinuteLinkWarning();
});

/** The exact inline coordinate is queued in the same SQLite transaction as its text.
 * A crash or account-link failure leaves that ticket for startup/foreground retry. */
export function retryInlineMinuteLinks(options: { synchronize?: boolean } = {}): Promise<void> {
  warningGeneration++;
  linkRequested = true;
  networkRequested ||= options.synchronize !== false;
  if (accountWork) return accountWork;
  const project = async () => {
    try {
      let failed = false;
      let more = true;
      while (more) {
        linkRequested = false;
        const pending = await getPendingInlineMinuteLinks();
        let acknowledged = 0;
        for (const ticket of pending) {
          try {
            await linkActualsToAccounts(ticket.affectedDates, null,
              { dateKey: ticket.dateKey, minuteIndex: ticket.minuteIndex });
            if (!ticket.requiresAccountWriter || await canAcknowledgeInlineMinuteLink(ticket)) {
              if (await acknowledgeInlineMinuteLink(ticket)) acknowledged++;
            } else await deferInlineMinuteLink(ticket);
          } catch (error) {
            failed = true;
            if (error instanceof NativeAccountLinkReviewError) await promoteInlineMinuteLinkForAccountReview(ticket).catch(() => undefined);
            else if (ticket.requiresAccountWriter) await deferInlineMinuteLink(ticket).catch(() => undefined);
          }
        }
        more = !failed && (pending.length === 100 && acknowledged > 0 || linkRequested);
      }
      updateLinkWarning(failed);
      if (networkRequested) requestAccountSynchronization();
    } catch { updateLinkWarning(true); }
    finally { networkRequested = false; }
  };
  // Many commits can arrive during one pass. They share the same drain instead
  // of appending another complete projection/network pass for every caller.
  accountWork = Promise.resolve().then(project).finally(() => { accountWork = null; });
  return accountWork;
}
inlineMinuteDrafts.subscribeCommits(() => { void retryInlineMinuteLinks(); });

export function subscribeInlineMinuteCommits(listener: (commit: InlineMinuteCommit) => void) {
  return inlineMinuteDrafts.subscribeCommits((_value: InlineMinuteValue, result) => listener(result));
}

export async function flushInlineMinutes(): Promise<void> {
  await inlineMinuteDrafts.flushAll();
  // Local acknowledgement is the editing boundary. The durable account-link
  // queue retries independently; navigation and clipboard never await the cloud.
}
