import * as Crypto from 'expo-crypto';
import { dismissLedgerConflict, getLedgerConflicts, getSyncDocuments, putSyncDocument } from './database';
import type { SyncDocument } from '../sync/types';
import { applyChecklistListChange, CHECKLIST_FLOW_KEY, DEFAULT_CHECKLIST_LIST_ID,
  readChecklistCollection, createChecklistListInCollection, renameChecklistListInCollection,
  moveChecklistTaskToList, replaceChecklistListInCollection, type ChecklistChange, type ChecklistCollection, type ChecklistListSummary,
  type ChecklistFlow, type ChecklistTaskFormat, type ChecklistTaskSource } from '../utils/checklist-flow';

export type ChecklistFlowSnapshot = { flow: ChecklistFlow; revision: string | null;
  collection: ChecklistCollection; listId: string; lists: ChecklistListSummary[] };

function snapshot(collection: ChecklistCollection, revision: string | null, listId: string): ChecklistFlowSnapshot {
  const list = collection.lists.find((candidate) => candidate.id === listId);
  if (!list) throw new Error('This checklist changed or is no longer available. Choose a checklist before editing.');
  return { collection, revision, listId, flow: { kind: 'checklistFlow', version: 1, items: list.items },
    lists: collection.lists.map((candidate) => ({ id: candidate.id, name: candidate.name, taskCount: candidate.items.length })) };
}

/** Recovery can inspect the current generation even if a future or malformed
 * remote snapshot cannot yet be opened by this client. */
export async function getChecklistFlowRevision(): Promise<string | null> {
  return (await getSyncDocuments(CHECKLIST_FLOW_KEY)).find((item) => item.key === CHECKLIST_FLOW_KEY)?.revision ?? null;
}

export async function getChecklistFlow(listId = DEFAULT_CHECKLIST_LIST_ID): Promise<ChecklistFlowSnapshot> {
  const document = (await getSyncDocuments(CHECKLIST_FLOW_KEY)).find((item) => item.key === CHECKLIST_FLOW_KEY);
  return snapshot(readChecklistCollection(document?.value), document?.revision ?? null, listId);
}

async function changeCollection(change: (collection: ChecklistCollection) => ChecklistCollection,
  expectedRevision: string | null, resultListId: string): Promise<ChecklistFlowSnapshot> {
  const before = await getChecklistFlow();
  if (before.revision !== expectedRevision) throw new Error('The checklist changed on another device. Refresh it before applying this edit.');
  const collection = change(before.collection);
  // A read-only V1 migration or a no-op action must not publish a new version.
  if (JSON.stringify(collection) === JSON.stringify(before.collection)) return snapshot(collection, before.revision, resultListId);
  const committed = await putSyncDocument(CHECKLIST_FLOW_KEY, collection, { expectedRevision });
  return snapshot(readChecklistCollection(committed.value), committed.revision, resultListId);
}

/** The database verifies the observed revision inside its exclusive write
 * transaction. A downloaded edit never gets silently overwritten by an old
 * open row editor, drag, or Reset action. */
export async function changeChecklistFlow(change: ChecklistChange, expectedRevision: string | null,
  listId = DEFAULT_CHECKLIST_LIST_ID): Promise<ChecklistFlowSnapshot> {
  return changeCollection((collection) => applyChecklistListChange(collection, listId, change), expectedRevision, listId);
}

export async function createChecklistList(name: string, expectedRevision: string | null): Promise<ChecklistFlowSnapshot> {
  const listId = `list_${Crypto.randomUUID().replace(/-/g, '')}`;
  return changeCollection((collection) => createChecklistListInCollection(collection, listId, name), expectedRevision, listId);
}

export async function renameChecklistList(listId: string, name: string,
  expectedRevision: string | null): Promise<ChecklistFlowSnapshot> {
  return changeCollection((collection) => renameChecklistListInCollection(collection, listId, name), expectedRevision, listId);
}

export async function transferChecklistTask(sourceListId: string, taskId: string, destinationListId: string,
  expectedRevision: string | null): Promise<ChecklistFlowSnapshot> {
  return changeCollection((collection) => moveChecklistTaskToList(collection, sourceListId, taskId, destinationListId),
    expectedRevision, sourceListId);
}

/** History supplies the original list ID and observed collection revision. No
 * fresh peer version may be adopted to make an old Undo/Redo appear successful. */
export async function replaceChecklistList(listId: string, flow: ChecklistFlow,
  expectedRevision: string | null): Promise<ChecklistFlowSnapshot> {
  return changeCollection((collection) => replaceChecklistListInCollection(collection, listId, flow), expectedRevision, listId);
}

/** A transfer undo restores both affected lists at one observed revision. */
export async function replaceChecklistCollection(listId: string, collection: ChecklistCollection,
  expectedRevision: string | null): Promise<ChecklistFlowSnapshot> {
  return changeCollection(() => readChecklistCollection(collection), expectedRevision, listId);
}

/** Imported task text is a snapshot. Creating/checking/deleting a task does not
 * change its source minutes or schedule a calendar event. */
export async function addChecklistTask(text: string, source?: ChecklistTaskSource,
  format: ChecklistTaskFormat = {}, listId = DEFAULT_CHECKLIST_LIST_ID): Promise<ChecklistFlowSnapshot & { taskId: string }> {
  const before = await getChecklistFlow(listId);
  const taskId = `task_${Crypto.randomUUID().replace(/-/g, '')}`;
  const result = await changeChecklistFlow({ type: 'add', item: {
    id: taskId, text, checked: false, parentId: null, format, ...(source ? { source } : {}),
  } }, before.revision, listId);
  return { ...result, taskId };
}

export async function getChecklistFlowConflicts(): Promise<SyncDocument[]> {
  // Malformed versions remain in the ledger's conflict table but are never
  // presented as a restorable list that could overwrite validated local data.
  return (await getLedgerConflicts(CHECKLIST_FLOW_KEY)).filter((document) => {
    if (document.key !== CHECKLIST_FLOW_KEY) return false;
    try { readChecklistCollection(document.value); return true; } catch { return false; }
  });
}

export async function restoreChecklistFlowConflict(document: SyncDocument,
  expectedRevision: string | null, listId = DEFAULT_CHECKLIST_LIST_ID): Promise<ChecklistFlowSnapshot> {
  if (document.key !== CHECKLIST_FLOW_KEY) throw new Error('Choose a checklist version.');
  const known = (await getChecklistFlowConflicts()).find((item) => item.revision === document.revision);
  if (!known || JSON.stringify(known.value) !== JSON.stringify(document.value)) throw new Error('This checklist version is no longer available.');
  const collection = readChecklistCollection(known.value);
  const committed = await putSyncDocument(CHECKLIST_FLOW_KEY, collection, { expectedRevision });
  await dismissLedgerConflict(CHECKLIST_FLOW_KEY, document.revision);
  return snapshot(readChecklistCollection(committed.value), committed.revision,
    collection.lists.some((list) => list.id === listId) ? listId : DEFAULT_CHECKLIST_LIST_ID);
}

export async function dismissChecklistFlowConflict(document: SyncDocument) {
  if (document.key !== CHECKLIST_FLOW_KEY) throw new Error('Choose a checklist version.');
  await dismissLedgerConflict(CHECKLIST_FLOW_KEY, document.revision);
}
