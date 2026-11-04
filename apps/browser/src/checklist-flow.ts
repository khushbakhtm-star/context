import { CHECKLIST_FLOW_KEY, DEFAULT_CHECKLIST_LIST_ID, applyChecklistListChange, readChecklistCollection,
  createChecklistListInCollection, moveChecklistTaskToList, renameChecklistListInCollection, replaceChecklistListInCollection,
  type ChecklistChange, type ChecklistFlow, type ChecklistTask } from '../shared/utils/checklist-flow';
import { applyDocumentValues, type BrowserLedgerState } from './ledger';

export function browserChecklist(state: BrowserLedgerState, listId = DEFAULT_CHECKLIST_LIST_ID) {
  const document = state.documents.find((candidate) => candidate.key === CHECKLIST_FLOW_KEY);
  const collection = readChecklistCollection(document?.value ?? null);
  const list = collection.lists.find((candidate) => candidate.id === listId);
  if (!list) throw new Error('This checklist changed or is no longer available. Choose a checklist before editing.');
  return { collection, listId, flow: { kind: 'checklistFlow', version: 1, items: list.items } as ChecklistFlow,
    revision: document?.revision,
    lists: collection.lists.map((candidate) => ({ id: candidate.id, name: candidate.name, taskCount: candidate.items.length })) };
}

/** The expected revision belongs to the list the user actually saw, including
 * absence. A queued edit must never silently replace newly downloaded tasks. */
export function changeBrowserChecklist(state: BrowserLedgerState, expected: string | undefined,
  command: ChecklistChange, now = Date.now(), listId = DEFAULT_CHECKLIST_LIST_ID) {
  const current = browserChecklist(state);
  if (current.revision !== expected) throw new Error('Your task list changed on another device. Your draft is still here; review the latest list before saving.');
  const next = applyChecklistListChange(current.collection, listId, command);
  if (JSON.stringify(next) === JSON.stringify(current.collection)) return applyDocumentValues(state, [], now);
  return applyDocumentValues(state, [{ key: CHECKLIST_FLOW_KEY, value: next as unknown as Record<string, unknown> }], now);
}

export function createBrowserChecklistList(state: BrowserLedgerState, expected: string | undefined,
  listId: string, name: string, now = Date.now()) {
  const current = browserChecklist(state);
  if (current.revision !== expected) throw new Error('Your checklists changed on another device. Refresh them before adding a list.');
  const next = createChecklistListInCollection(current.collection, listId, name);
  return applyDocumentValues(state, [{ key: CHECKLIST_FLOW_KEY, value: next as unknown as Record<string, unknown> }], now);
}

export function moveBrowserChecklistTask(state: BrowserLedgerState, expected: string | undefined,
  sourceListId: string, taskId: string, destinationListId: string, now = Date.now()) {
  const current = browserChecklist(state);
  if (current.revision !== expected) throw new Error('Your checklists changed. Review the latest list before moving a task.');
  const next = moveChecklistTaskToList(current.collection, sourceListId, taskId, destinationListId);
  return applyDocumentValues(state, [{ key: CHECKLIST_FLOW_KEY, value: next as unknown as Record<string, unknown> }], now);
}

export function renameBrowserChecklistList(state: BrowserLedgerState, expected: string | undefined,
  listId: string, name: string, now = Date.now()) {
  const current = browserChecklist(state);
  if (current.revision !== expected) throw new Error('Your checklists changed on another device. Refresh them before renaming a list.');
  const next = renameChecklistListInCollection(current.collection, listId, name);
  if (JSON.stringify(next) === JSON.stringify(current.collection)) return applyDocumentValues(state, [], now);
  return applyDocumentValues(state, [{ key: CHECKLIST_FLOW_KEY, value: next as unknown as Record<string, unknown> }], now);
}

export function replaceBrowserChecklistList(state: BrowserLedgerState, expected: string | undefined,
  listId: string, flow: ChecklistFlow, now = Date.now()) {
  const current = browserChecklist(state);
  if (current.revision !== expected) throw new Error('Your checklists changed on another device. Your history cannot replace the newer version.');
  const next = replaceChecklistListInCollection(current.collection, listId, flow);
  if (JSON.stringify(next) === JSON.stringify(current.collection)) return applyDocumentValues(state, [], now);
  return applyDocumentValues(state, [{ key: CHECKLIST_FLOW_KEY, value: next as unknown as Record<string, unknown> }], now);
}

export function restoreBrowserChecklist(state: BrowserLedgerState, expected: string | undefined,
  value: unknown, now = Date.now()) {
  // Recovery still needs the exact observed generation when the current value
  // is malformed or from a future client; do not decode it into an empty list.
  const currentRevision = state.documents.find((document) => document.key === CHECKLIST_FLOW_KEY)?.revision;
  if (currentRevision !== expected) throw new Error('Your task list changed. Review the latest list before restoring this version.');
  const restored = readChecklistCollection(value);
  return applyDocumentValues(state, [{ key: CHECKLIST_FLOW_KEY, value: restored as unknown as Record<string, unknown> }], now);
}

export type MinuteTaskSnapshot = { text: string; source: NonNullable<ChecklistTask['source']> };
/** A task is an independent copy. Creating it never edits, empties, reformats,
 * groups or schedules any of the original minutes. */
export function minuteTaskSnapshot(points: readonly { day: string; minute: number; text: string }[],
  selection?: { start: number; end: number }): MinuteTaskSnapshot {
  if (!points.length || points.length > 10_000) throw new Error('Select between one and 10,000 minute cells.');
  const sorted = [...points].sort((a, b) => a.day.localeCompare(b.day) || a.minute - b.minute);
  let text = sorted.map((point) => point.text).filter((value) => value.trim().length).join('\n');
  if (selection) {
    if (points.length !== 1 || !Number.isInteger(selection.start) || !Number.isInteger(selection.end) ||
      selection.start < 0 || selection.end <= selection.start || selection.end > points[0]!.text.length) throw new Error('Highlight the words you want to turn into a task.');
    text = points[0]!.text.slice(selection.start, selection.end);
  }
  if (!text.trim()) throw new Error('Select some text to create a task.');
  const ranges: NonNullable<ChecklistTask['source']>['ranges'] = [];
  for (const point of sorted) {
    const previous = ranges.at(-1);
    if (previous?.dateKey === point.day && previous.endMinute + 1 === point.minute) previous.endMinute = point.minute;
    else ranges.push({ dateKey: point.day, startMinute: point.minute, endMinute: point.minute });
  }
  return { text, source: { ranges, ...(selection ? { selection: { ...selection } } : {}) } };
}

export const newBrowserTask = (text: string, source?: ChecklistTask['source']): ChecklistTask => ({
  id: `task_${crypto.randomUUID().replaceAll('-', '')}`, text, checked: false, parentId: null, format: {}, ...(source ? { source } : {}),
});

export function browserChecklistVersions(state: BrowserLedgerState, listId = DEFAULT_CHECKLIST_LIST_ID) {
  return state.conflicts.filter((document) => document.key === CHECKLIST_FLOW_KEY && document.value !== null)
    .flatMap((document) => {
      try {
        const collection = readChecklistCollection(document.value);
        const selected = collection.lists.find((list) => list.id === listId) ?? collection.lists.find((list) => list.id === DEFAULT_CHECKLIST_LIST_ID)!;
        return [{ revision: document.revision, collection, listId: selected.id,
          flow: { kind: 'checklistFlow', version: 1, items: selected.items } as ChecklistFlow }];
      } catch { return []; }
    })
    .slice(-20).reverse();
}
