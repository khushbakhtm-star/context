import { CHECKLIST_FLOW_KEY, applyChecklistChange, readChecklistFlow,
  type ChecklistChange, type ChecklistFlow, type ChecklistTask } from '../shared/utils/checklist-flow';
import { applyDocumentValues, type BrowserLedgerState } from './ledger';

export function browserChecklist(state: BrowserLedgerState) {
  const document = state.documents.find((candidate) => candidate.key === CHECKLIST_FLOW_KEY);
  return { flow: readChecklistFlow(document?.value ?? null), revision: document?.revision };
}

/** The expected revision belongs to the list the user actually saw, including
 * absence. A queued edit must never silently replace newly downloaded tasks. */
export function changeBrowserChecklist(state: BrowserLedgerState, expected: string | undefined,
  command: ChecklistChange, now = Date.now()) {
  const current = browserChecklist(state);
  if (current.revision !== expected) throw new Error('Your task list changed on another device. Your draft is still here; review the latest list before saving.');
  const next = applyChecklistChange(current.flow, command);
  return applyDocumentValues(state, [{ key: CHECKLIST_FLOW_KEY, value: next as unknown as Record<string, unknown> }], now);
}

export function restoreBrowserChecklist(state: BrowserLedgerState, expected: string | undefined,
  value: unknown, now = Date.now()) {
  if (browserChecklist(state).revision !== expected) throw new Error('Your task list changed. Review the latest list before restoring this version.');
  const restored = readChecklistFlow(value);
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

export function browserChecklistVersions(state: BrowserLedgerState): { revision: string; flow: ChecklistFlow }[] {
  return state.conflicts.filter((document) => document.key === CHECKLIST_FLOW_KEY && document.value !== null)
    .flatMap((document) => { try { return [{ revision: document.revision, flow: readChecklistFlow(document.value) }]; } catch { return []; } })
    .slice(-20).reverse();
}
