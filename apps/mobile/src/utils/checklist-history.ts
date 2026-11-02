import { readChecklistFlow, type ChecklistFlow } from './checklist-flow';

export type ChecklistHistoryEntry = { before: ChecklistFlow; after: ChecklistFlow };
export type ChecklistHistory = { listId: string; revision: string | null;
  undo: ChecklistHistoryEntry[]; redo: ChecklistHistoryEntry[] };
export type ChecklistHistoryAction = 'undo' | 'redo';
const MAX_ENTRIES = 24;
const MAX_ESTIMATED_BYTES = 4 * 1024 * 1024;
const copy = (flow: ChecklistFlow) => readChecklistFlow(JSON.parse(JSON.stringify(flow)));
const same = (left: ChecklistFlow, right: ChecklistFlow) => JSON.stringify(left) === JSON.stringify(right);

export function emptyChecklistHistory(listId: string, revision: string | null): ChecklistHistory {
  return { listId, revision, undo: [], redo: [] };
}

/** A peer generation is never silently promoted into an Undo acknowledgement. */
export function observeChecklistHistory(history: ChecklistHistory, listId: string,
  revision: string | null): ChecklistHistory {
  return history.listId === listId && history.revision === revision ? history : emptyChecklistHistory(listId, revision);
}

export function recordChecklistHistory(history: ChecklistHistory, listId: string,
  before: { flow: ChecklistFlow; revision: string | null }, after: { flow: ChecklistFlow; revision: string | null }): ChecklistHistory {
  if (same(before.flow, after.flow)) return observeChecklistHistory(history, listId, after.revision);
  const current = observeChecklistHistory(history, listId, before.revision);
  const undo = [...current.undo, { before: copy(before.flow), after: copy(after.flow) }].slice(-MAX_ENTRIES);
  // This is an in-memory estimate using JS UTF-16 storage, not a synchronization
  // payload calculation. Keep the newest complete edit, even for a very long list.
  while (undo.length > 1 && JSON.stringify(undo).length * 2 > MAX_ESTIMATED_BYTES) undo.shift();
  return { listId, revision: after.revision, undo, redo: [] };
}

export function checklistHistoryTarget(history: ChecklistHistory, action: ChecklistHistoryAction,
  listId: string, observedRevision: string | null): ChecklistFlow {
  if (history.listId !== listId || history.revision !== observedRevision)
    throw new Error('This Priority list changed. Refresh it before undoing or redoing.');
  const entry = history[action].at(-1);
  if (!entry) throw new Error(action === 'undo' ? 'There is no Priority edit to undo.' : 'There is no Priority edit to redo.');
  return copy(action === 'undo' ? entry.before : entry.after);
}

/** Called only with the exact write acknowledgement, after the database CAS succeeds. */
export function acknowledgeChecklistHistory(history: ChecklistHistory, action: ChecklistHistoryAction,
  expectedRevision: string | null, acknowledgedRevision: string | null): ChecklistHistory {
  if (history.revision !== expectedRevision || !acknowledgedRevision)
    throw new Error('The Priority edit acknowledgement changed. Refresh the list.');
  const source = history[action]; const entry = source.at(-1);
  if (!entry) throw new Error('The Priority edit history changed.');
  return { ...history, revision: acknowledgedRevision,
    undo: action === 'undo' ? history.undo.slice(0, -1) : [...history.undo, entry],
    redo: action === 'redo' ? history.redo.slice(0, -1) : [...history.redo, entry] };
}
