import { AppState } from 'react-native';
import { applySpreadsheetTransaction, getSetting, getSpreadsheetCells, listWearReceiptSettings, setSetting,
  type SpreadsheetCellState } from '../data/database';
import { listCategories, listSelectableActivityCategories } from '../services/categories';
import { inlineMinuteDrafts, retryInlineMinuteLinks } from '../services/inline-minutes';
import { hashValue } from '../sync/codec';
import { dateKey } from '../utils/time';
import { wearNative } from './native';
import { parseWearInbox, wearCellVersion, wearDate, WEAR_DAY_BYTE_LIMIT, WEAR_TEXT_LIMIT,
  type WearAck, type WearCell, type WearEdit, type WearInboxItem } from './protocol';

type Receipt = { operationId: string; fingerprint: string; dateKey: string; minuteIndex: number;
  status: 'applied' | 'conflict' | 'error'; pendingAck: boolean; request?: WearEdit; message?: string };
export type WearConflict = { operationId: string; dateKey: string; minuteIndex: number; watchText: string;
  phone: WearCell };
export type WearState = { available: boolean; enabled: boolean; running: boolean; connectedNodeCount: number;
  pendingCount: number; error: string | null; conflicts: WearConflict[] };
let state: WearState = { available: Boolean(wearNative), enabled: false, running: false,
  connectedNodeCount: 0, pendingCount: 0, error: null, conflicts: [] };
let generation = 0;
let initialized = false;
let initialization: Promise<void> | null = null;
let nativeSubscription: { remove(): void } | null = null;
let work: Promise<unknown> = Promise.resolve();
let consentWrites: Promise<unknown> = Promise.resolve();
let draining: Promise<void> | null = null;
let drainAgain = false;
const listeners = new Set<() => void>();
const changes = new Set<(affectedDates: string[]) => void>();
const receiptKey = (id: string) => `wear.receipt.${id}`;
const notify = () => { for (const listener of listeners) { try { listener(); } catch { /* stale screen */ } } };
const update = (value: Partial<WearState>) => { state = { ...state, ...value }; notify(); };
export const getWearState = (): WearState => ({ ...state, conflicts: [...state.conflicts] });
export function subscribeWearState(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function subscribeWearCommits(listener: (days: string[]) => void) { changes.add(listener); return () => { changes.delete(listener); }; }
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = work.then(task, task); work = next.then(() => undefined, () => undefined); return next;
}
function current(epoch: number) { return state.enabled && generation === epoch && AppState.currentState === 'active'; }
function cellValue(cell: SpreadsheetCellState): WearCell {
  return { minuteIndex: cell.minuteIndex, text: cell.entry?.text ?? '', categoryId: cell.entry?.categoryId ?? 'unaccounted',
    version: wearCellVersion(cell.version?.minuteRevision ?? null, cell.version?.formatRevision ?? null) };
}
async function readCell(day: string, minute: number) {
  return (await getSpreadsheetCells({ dateKey: day, startMinute: minute, endMinute: minute }))[0]!;
}
function validReceipt(value: unknown): value is Receipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Receipt;
  return typeof item.operationId === 'string' && /^[0-9a-f-]{36}$/i.test(item.operationId) &&
    typeof item.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(item.fingerprint) && wearDate(item.dateKey) &&
    Number.isInteger(item.minuteIndex) && item.minuteIndex >= 0 && item.minuteIndex < 1440 &&
    ['applied', 'conflict', 'error'].includes(item.status) && typeof item.pendingAck === 'boolean';
}
async function receiptFor(id: string) {
  const value = await getSetting<unknown>(receiptKey(id), null); return validReceipt(value) ? value : null;
}
async function flushPhoneDrafts() {
  await inlineMinuteDrafts.flushAll();
  if (inlineMinuteDrafts.snapshot().some((draft) => draft.error || draft.revision !== draft.savedRevision)) {
    throw new Error('A phone minute has not saved yet. Watch notes remain waiting.');
  }
}
async function acknowledge(receipt: Receipt, epoch: number) {
  if (!wearNative || !current(epoch)) throw new Error('Watch synchronization is paused.');
  const entry = cellValue(await readCell(receipt.dateKey, receipt.minuteIndex));
  const ack: WearAck = { version: 1, operationId: receipt.operationId, dateKey: receipt.dateKey,
    minuteIndex: receipt.minuteIndex, status: receipt.status, entry,
    ...(receipt.message ? { message: receipt.message } : {}) };
  if (!current(epoch)) throw new Error('Watch synchronization is paused.');
  await wearNative.publishAckAsync(JSON.stringify(ack));
  // A delivered DataItem is durable even when the watch is disconnected. Request IDs
  // can replay receipts after consent withdrawal or an interrupted acknowledgment.
  if (current(epoch)) await setSetting(receiptKey(receipt.operationId), { ...receipt, pendingAck: false });
}
async function refreshConflicts() {
  const records = await listWearReceiptSettings('conflict');
  const conflicts: WearConflict[] = [];
  for (const { value } of records) {
    if (!validReceipt(value) || !value.request) continue;
    conflicts.push({ operationId: value.operationId, dateKey: value.dateKey, minuteIndex: value.minuteIndex,
      watchText: value.request.text, phone: cellValue(await readCell(value.dateKey, value.minuteIndex)) });
  }
  update({ conflicts });
}
async function sendDay(day: string, epoch: number, requestId?: string) {
  if (!wearNative || !current(epoch)) return;
  // Category initialization can write defaults. Keep it outside the atomic day read
  // rather than starting competing transactions during the first watch connection.
  const allCategories = await listCategories();
  const eligible = await listSelectableActivityCategories();
  const cells = await getSpreadsheetCells({ dateKey: day, startMinute: 0, endMinute: 1439 });
  const clock = await getSetting<unknown>('calendar.clock-format', '12h');
  const selectable = new Set(eligible.map((category) => category.id));
  const entries = cells.filter((cell) => cell.entry || cell.version?.minuteRevision || cell.version?.formatRevision).map(cellValue);
  const payload = JSON.stringify({ version: 1, dateKey: day, snapshotId: hashValue([day, Date.now(), Math.random(), entries]),
    requestId, generatedAt: Date.now(), clockFormat: clock === '24h' ? '24h' : '12h', entries,
    categories: allCategories.map((category) => ({ id: category.id, name: category.name, color: category.color,
      selectable: selectable.has(category.id) })) });
  if (new TextEncoder().encode(payload).byteLength > WEAR_DAY_BYTE_LIMIT) {
    throw new Error('This day is too large for the watch. Its complete record remains on the phone.');
  }
  if (current(epoch)) await wearNative.publishDayAsync(payload);
}
async function conflict(operation: WearEdit, fingerprint: string, epoch: number) {
  const receipt: Receipt = { operationId: operation.operationId, fingerprint, dateKey: operation.dateKey,
    minuteIndex: operation.minuteIndex, status: 'conflict', pendingAck: true, request: operation,
    message: 'The phone minute changed. Review both notes in Context on the phone.' };
  await setSetting(receiptKey(operation.operationId), receipt);
  await refreshConflicts(); await acknowledge(receipt, epoch);
}
async function applyOperation(operation: WearEdit, fingerprint: string, epoch: number,
  resolution?: { choice: 'watch' | 'append' | 'phone'; expectedPhoneVersion: string }) {
  await flushPhoneDrafts();
  const result = await inlineMinuteDrafts.runExclusive(async () => {
    const before = await readCell(operation.dateKey, operation.minuteIndex);
    const canonical = cellValue(before);
    if (resolution && canonical.version !== resolution.expectedPhoneVersion) {
      throw new Error('The phone minute changed again. Review the latest notes before choosing.');
    }
    const draftRevision = inlineMinuteDrafts.get(operation.dateKey, operation.minuteIndex)?.revision;
    const categoryId = operation.categoryId ?? before.entry?.categoryId ?? 'unaccounted';
    if (resolution?.choice !== 'phone' && operation.categoryId && operation.categoryId !== canonical.categoryId &&
        !(await listSelectableActivityCategories({ writableOnly: false })).some((category) => category.id === operation.categoryId)) {
      throw new Error('The watch activity color is no longer available. Choose another color on the watch.');
    }
    const equivalent = canonical.text === operation.text.trim() && canonical.categoryId === categoryId;
    const emptyUnknownTarget = !before.version?.minuteRevision && !before.entry;
    const matches = operation.baseKnown ? canonical.version === (operation.expectedVersion ?? '[null,null]') : emptyUnknownTarget;
    if (!resolution && !matches && !equivalent) return null;
    const text = resolution?.choice === 'phone' ? canonical.text : resolution?.choice === 'append'
      ? [canonical.text, operation.text.trim()].filter(Boolean).join('\n') : operation.text.trim();
    if (resolution?.choice !== 'phone' && Array.from(text).length > WEAR_TEXT_LIMIT) {
      throw new Error('The combined note is too long. Both notes remain available for review.');
    }
    const chosenCategory = resolution?.choice === 'phone' ? canonical.categoryId : categoryId;
    const entry = resolution?.choice === 'phone' ? before.entry : text || before.entry || operation.categoryId
      ? { ...before.entry, text, categoryId: chosenCategory } : null;
    const receipt: Receipt = { operationId: operation.operationId, fingerprint, dateKey: operation.dateKey,
      minuteIndex: operation.minuteIndex, status: 'applied', pendingAck: true };
    const canApply = () => current(epoch) && inlineMinuteDrafts.get(operation.dateKey, operation.minuteIndex)?.revision === draftRevision;
    const changed = await applySpreadsheetTransaction([{ day: operation.dateKey, expected: [before],
      target: [{ minuteIndex: operation.minuteIndex, entry, format: before.format }] }],
    { textChanged: true, formatChanged: false, canApply,
      localReceipt: { key: receiptKey(operation.operationId), value: receipt } },
    [{ day: operation.dateKey, cells: [before] }]);
    // A keystroke arriving after the transaction's final guard remains a newer local
    // draft. Never erase it while rebasing the acknowledged watch write.
    if (inlineMinuteDrafts.get(operation.dateKey, operation.minuteIndex)?.revision === draftRevision) {
      inlineMinuteDrafts.rebaseCommitted([{ dateKey: operation.dateKey, minuteIndex: operation.minuteIndex,
        text: entry?.text ?? '', categoryId: entry?.categoryId ?? 'unaccounted', keepColor: Boolean(entry && !entry.text.trim()) }]);
    }
    return { receipt, changed: changed.textChanged };
  });
  if (!result) { await conflict(operation, fingerprint, epoch); return; }
  if (result.changed) {
    for (const listener of changes) { try { listener([operation.dateKey]); } catch { /* local observers */ } }
    void retryInlineMinuteLinks();
  }
  await acknowledge(result.receipt, epoch);
  await sendDay(operation.dateKey, epoch);
}
async function processItem(item: WearInboxItem, epoch: number) {
  if (!wearNative || !current(epoch)) return;
  let parsed: ReturnType<typeof parseWearInbox>;
  try { parsed = parseWearInbox(item); }
  catch { update({ error: 'An invalid watch item was ignored. Notes saved on the watch remain there.' });
    await wearNative.acknowledgeInboxAsync(item.id); return; }
  if (parsed.kind === 'request') {
    await sendDay(parsed.value.dateKey, epoch, parsed.value.requestId);
    for (const id of parsed.value.pendingOperationIds ?? []) {
      const receipt = await receiptFor(id);
      if (receipt && receipt.dateKey === parsed.value.dateKey) await acknowledge(receipt, epoch);
    }
    if (current(epoch)) await wearNative.acknowledgeInboxAsync(item.id);
    return;
  }
  const operation = parsed.value;
  const fingerprint = hashValue(operation);
  const previous = await receiptFor(operation.operationId);
  if (previous && previous.fingerprint !== fingerprint) {
    // Never replace an immutable operation or erase its retained conflict text.
    const ack: WearAck = { version: 1, operationId: operation.operationId, dateKey: operation.dateKey,
      minuteIndex: operation.minuteIndex, status: 'error', entry: cellValue(await readCell(operation.dateKey, operation.minuteIndex)),
      message: 'This watch operation ID was reused. Save the note again as a new operation.' };
    if (current(epoch)) { await wearNative.publishAckAsync(JSON.stringify(ack)); await wearNative.acknowledgeInboxAsync(item.id); }
    return;
  }
  if (previous?.status === 'applied' || previous?.status === 'conflict') await acknowledge(previous, epoch);
  else await applyOperation(operation, fingerprint, epoch);
  if (current(epoch)) await wearNative.acknowledgeInboxAsync(item.id);
}
export function drainWearInbox() {
  if (draining) { drainAgain = true; return draining; }
  const task = enqueue(async () => {
    const epoch = generation;
    if (!wearNative || !current(epoch)) return;
    update({ running: true, error: null });
    try {
      let lastError: string | null = null;
      for (const { value } of await listWearReceiptSettings('pending')) {
        if (validReceipt(value)) {
          try { await acknowledge(value, epoch); } catch { lastError = 'A watch reply is waiting to reconnect.'; }
        }
      }
      await wearNative.scanPendingAsync();
      const failed = new Set<string>();
      for (let batch = 0; batch < 8 && current(epoch); batch += 1) {
        const items = (await wearNative.drainInboxAsync()).filter((item) => !failed.has(item.id)); if (!items.length) break;
        for (const item of items) if (current(epoch)) {
          try { await processItem(item, epoch); }
          catch (error) { failed.add(item.id); lastError = error instanceof Error ? error.message : 'A watch note is waiting.'; }
        }
        await wearNative.scanPendingAsync();
      }
      await refreshConflicts();
      const status = await wearNative.getStatusAsync();
      update({ connectedNodeCount: status.connectedNodeCount, pendingCount: status.pendingCount,
        error: status.error ? 'The watch connection is waiting. Keep both devices nearby.' : lastError });
    } catch (error) {
      update({ error: error instanceof Error ? error.message : 'Watch synchronization is waiting. Your notes remain saved.' });
    } finally { update({ running: false }); }
  });
  draining = task.finally(() => {
    draining = null;
    const again = drainAgain; drainAgain = false;
    if (again && state.enabled && AppState.currentState === 'active') void drainWearInbox();
  });
  return draining;
}
export async function initializeWearBridge() {
  if (!wearNative || initialized) return;
  initialization ??= (async () => {
    const epoch = generation;
    nativeSubscription?.remove();
    const subscription = wearNative.addListener('onInboxChanged', (event) => {
      if (state.enabled && (event?.pendingCount ?? 1) > 0) void drainWearInbox();
    });
    nativeSubscription = subscription;
    let completed = false;
    try {
      const [saved, nativeStatus] = await Promise.all([getSetting<unknown>('wear.enabled', false), wearNative.getStatusAsync()]);
      if (epoch !== generation) return;
      if (nativeStatus.error && !nativeStatus.enabled) {
        update({ enabled: false, error: 'The watch connection is unavailable. Previously saved notes remain waiting.' });
        return;
      }
      // Native consent is also durable. A crash after native revocation but before
      // the JS preference write must not re-enable access at the next start.
      const configuredGeneration = generation + 1;
      await setWearEnabled(saved === true && nativeStatus.enabled);
      if (generation !== configuredGeneration) return;
      initialized = true; completed = true;
      await enqueue(refreshConflicts);
    } finally {
      if (!completed) {
        subscription.remove();
        if (nativeSubscription === subscription) nativeSubscription = null;
      }
    }
  })();
  try { await initialization; } finally { initialization = null; }
}
export async function setWearEnabled(enabled: boolean) {
  if (!wearNative) return;
  const native = wearNative;
  const epoch = ++generation; update({ enabled: false, error: null });
  const earlierWork = work;
  const task = consentWrites.then(async () => {
    if (generation !== epoch) return;
    if (!enabled) await native.setEnabledAsync(false);
    // Let a canceled ledger transaction release its database writer before saving
    // the preference. Native revocation above does not wait for that transaction.
    await earlierWork;
    if (generation !== epoch) return;
    await setSetting('wear.enabled', enabled);
    if (enabled) await native.setEnabledAsync(true);
    if (generation !== epoch) return;
    update({ enabled });
    if (enabled) {
      void drainWearInbox();
      void publishWearDay(dateKey(new Date())).catch(() => update({ error: 'A watch day is waiting to synchronize.' }));
    }
  });
  consentWrites = task.then(() => undefined, () => undefined);
  return task;
}
export const publishWearDay = (day: string) => enqueue(async () => {
  if (!wearDate(day)) return; await sendDay(day, generation);
});
export const refreshWearStatus = () => enqueue(async () => {
  if (!wearNative) return;
  const status = await wearNative.getStatusAsync();
  update({ connectedNodeCount: status.connectedNodeCount, pendingCount: status.pendingCount,
    error: status.error ? 'The watch connection is waiting. Keep both devices nearby.' : null });
  await refreshConflicts();
});
export function resolveWearConflict(id: string, choice: 'watch' | 'append' | 'phone', expectedPhoneVersion: string) {
  return enqueue(async () => {
    const epoch = generation;
    if (!current(epoch)) throw new Error('Enable watch synchronization and keep Context open to review this note.');
    const receipt = await receiptFor(id);
    if (!receipt || receipt.status !== 'conflict' || !receipt.request) throw new Error('This note is already resolved.');
    await applyOperation(receipt.request, receipt.fingerprint, epoch, { choice, expectedPhoneVersion });
    await refreshConflicts();
  });
}
export function stopWearBridge() {
  generation += 1; initialized = false; drainAgain = false; nativeSubscription?.remove(); nativeSubscription = null;
}
