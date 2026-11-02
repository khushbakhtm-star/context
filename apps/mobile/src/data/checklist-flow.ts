import * as Crypto from 'expo-crypto';
import { dismissLedgerConflict, getLedgerConflicts, getSyncDocuments, putSyncDocument } from './database';
import type { SyncDocument } from '../sync/types';
import { applyChecklistChange, CHECKLIST_FLOW_KEY, readChecklistFlow, type ChecklistChange,
  type ChecklistFlow, type ChecklistTaskFormat, type ChecklistTaskSource } from '../utils/checklist-flow';

export type ChecklistFlowSnapshot = { flow: ChecklistFlow; revision: string | null };

/** Recovery can inspect the current generation even if a future or malformed
 * remote snapshot cannot yet be opened by this client. */
export async function getChecklistFlowRevision(): Promise<string | null> {
  return (await getSyncDocuments(CHECKLIST_FLOW_KEY)).find((item) => item.key === CHECKLIST_FLOW_KEY)?.revision ?? null;
}

export async function getChecklistFlow(): Promise<ChecklistFlowSnapshot> {
  const document = (await getSyncDocuments(CHECKLIST_FLOW_KEY)).find((item) => item.key === CHECKLIST_FLOW_KEY);
  return { flow: readChecklistFlow(document?.value), revision: document?.revision ?? null };
}

/** The database verifies the observed revision inside its exclusive write
 * transaction. A downloaded edit never gets silently overwritten by an old
 * open row editor, drag, or Reset action. */
export async function changeChecklistFlow(change: ChecklistChange, expectedRevision: string | null): Promise<ChecklistFlowSnapshot> {
  const before = await getChecklistFlow();
  if (before.revision !== expectedRevision) throw new Error('The checklist changed on another device. Refresh it before applying this edit.');
  const flow = applyChecklistChange(before.flow, change);
  if (JSON.stringify(flow) === JSON.stringify(before.flow)) return before;
  await putSyncDocument(CHECKLIST_FLOW_KEY, flow, { expectedRevision });
  return getChecklistFlow();
}

/** Imported task text is a snapshot. Creating/checking/deleting a task does not
 * change its source minutes or schedule a calendar event. */
export async function addChecklistTask(text: string, source?: ChecklistTaskSource,
  format: ChecklistTaskFormat = {}): Promise<ChecklistFlowSnapshot & { taskId: string }> {
  const before = await getChecklistFlow();
  const taskId = `task_${Crypto.randomUUID().replace(/-/g, '')}`;
  const result = await changeChecklistFlow({ type: 'add', item: {
    id: taskId, text, checked: false, parentId: null, format, ...(source ? { source } : {}),
  } }, before.revision);
  return { ...result, taskId };
}

export async function getChecklistFlowConflicts(): Promise<SyncDocument[]> {
  // Malformed versions remain in the ledger's conflict table but are never
  // presented as a restorable list that could overwrite validated local data.
  return (await getLedgerConflicts(CHECKLIST_FLOW_KEY)).filter((document) => {
    if (document.key !== CHECKLIST_FLOW_KEY) return false;
    try { readChecklistFlow(document.value); return true; } catch { return false; }
  });
}

export async function restoreChecklistFlowConflict(document: SyncDocument,
  expectedRevision: string | null): Promise<ChecklistFlowSnapshot> {
  if (document.key !== CHECKLIST_FLOW_KEY) throw new Error('Choose a checklist version.');
  const known = (await getChecklistFlowConflicts()).find((item) => item.revision === document.revision);
  if (!known || JSON.stringify(known.value) !== JSON.stringify(document.value)) throw new Error('This checklist version is no longer available.');
  const flow = readChecklistFlow(known.value);
  await putSyncDocument(CHECKLIST_FLOW_KEY, flow, { expectedRevision });
  await dismissLedgerConflict(CHECKLIST_FLOW_KEY, document.revision);
  return getChecklistFlow();
}

export async function dismissChecklistFlowConflict(document: SyncDocument) {
  if (document.key !== CHECKLIST_FLOW_KEY) throw new Error('Choose a checklist version.');
  await dismissLedgerConflict(CHECKLIST_FLOW_KEY, document.revision);
}
