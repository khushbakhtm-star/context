import { compareRevisions, hashValue, mergeDocuments, validateBatch } from '../shared/sync/codec';
import type { SyncBatch, SyncDocument } from '../shared/sync/types';
import { parseSpreadsheetCells, spreadsheetPasteRanges } from '../shared/utils/spreadsheet-paste';

export type BrowserLedgerState = { version: 1; device: string; wall: number; counter: number;
  documents: SyncDocument[]; conflicts: SyncDocument[]; pending: Record<string, string>; seen: string[];
  upload: null | { name: string; ciphertext: string; batch: SyncBatch; driveId?: string } };
export type CellChange = { day: string; minute: number; text: string };
export type UndoEdit = { before: SyncDocument[]; after: SyncDocument[] };
export const minuteKey = (day: string, minute: number) => `minute:${day}:${minute}`;
export function emptyLedger(device: string): BrowserLedgerState {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(device)) throw new Error('Invalid browser ledger identity.');
  return { version: 1, device, wall: 0, counter: 0, documents: [], conflicts: [], pending: {}, seen: [], upload: null };
}
const clone = <T>(value: T): T => structuredClone(value);
export function validateState(state: BrowserLedgerState): BrowserLedgerState {
  if (state?.version !== 1 || !/^[A-Za-z0-9_-]{8,128}$/.test(state.device) ||
      !Number.isSafeInteger(state.wall) || state.wall < 0 || !Number.isInteger(state.counter) || state.counter < 0 ||
      state.counter > 99_999_999 || !Array.isArray(state.documents) || !Array.isArray(state.conflicts) ||
      !Array.isArray(state.seen) || state.seen.some((id) => typeof id !== 'string') ||
      !state.pending || typeof state.pending !== 'object') throw new Error('The browser ledger cache is invalid.');
  for (let i = 0; i < state.documents.length; i += 500) validateBatch({ version: 1, id: 'browser_validation', documents: state.documents.slice(i, i + 500) });
  for (const doc of state.documents) validateMinute(doc);
  for (let i = 0; i < state.conflicts.length; i += 1) validateBatch({ version: 1, id: 'browser_conflict', documents: [state.conflicts[i]] });
  for (const doc of state.conflicts) validateMinute(doc);
  for (const [key, revision] of Object.entries(state.pending)) {
    if (typeof revision !== 'string' || !state.documents.some((doc) => doc.key === key && doc.revision === revision)) throw new Error('Invalid pending browser revision.');
  }
  if (new Set(state.documents.map((doc) => doc.key)).size !== state.documents.length) throw new Error('Duplicate browser ledger records.');
  if (state.upload) {
    validateBatch(state.upload.batch);
    if (!/^context-[A-Za-z0-9._-]{1,180}\.json$/.test(state.upload.name) || typeof state.upload.ciphertext !== 'string') throw new Error('Invalid pending upload.');
    if (state.upload.driveId !== undefined && !/^[A-Za-z0-9_-]{1,200}$/.test(state.upload.driveId)) throw new Error('Invalid pending Drive identifier.');
  }
  return state;
}
function validateMinute(document: SyncDocument) {
  if (!document.key.startsWith('minute:') || document.value === null) return;
  const [, day, minute] = document.key.split(':'); const value = document.value;
  if (value.dateKey !== day || value.minuteIndex !== Number(minute) || typeof value.text !== 'string' ||
      typeof value.categoryId !== 'string' || typeof value.blockId !== 'string' ||
      typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') throw new Error('Invalid synchronized minute content.');
}
export function getMinute(state: BrowserLedgerState, day: string, minute: number): SyncDocument | undefined {
  return state.documents.find((doc) => doc.key === minuteKey(day, minute));
}
export function mergeLedger(state: BrowserLedgerState, documents: SyncDocument[]): BrowserLedgerState {
  const next = clone(state); const existing = new Map(next.documents.map((doc) => [doc.key, doc]));
  for (let i = 0; i < documents.length; i += 500) validateBatch({ version: 1, id: 'browser_merge', documents: documents.slice(i, i + 500) });
  for (const incoming of documents) {
    validateMinute(incoming);
    const [wall, counter] = incoming.revision.split(':').map(Number);
    if (!Number.isSafeInteger(wall) || wall! < 0 || !Number.isInteger(counter) || counter! < 0 || counter! > 99_999_999) throw new Error('The remote ledger clock exceeds supported bounds.');
    if (wall! > next.wall) { next.wall = wall!; next.counter = counter!; }
    else if (wall === next.wall) next.counter = Math.max(next.counter, counter!);
    const previous = existing.get(incoming.key);
    if (previous && previous.revision !== incoming.revision && hashValue(previous.value) !== hashValue(incoming.value)) {
      const loser = compareRevisions(previous.revision, incoming.revision) > 0 ? incoming : previous;
      if (!next.conflicts.some((doc) => doc.key === loser.key && doc.revision === loser.revision)) next.conflicts.push(clone(loser));
    }
  }
  next.documents = mergeDocuments(next.documents, documents);
  // A remote winner supersedes only the matching local upload revision; queued older batches remain immutable.
  for (const incoming of documents) if (next.pending[incoming.key] &&
      compareRevisions(incoming.revision, next.pending[incoming.key]!) >= 0) delete next.pending[incoming.key];
  return next;
}
function tick(state: BrowserLedgerState, now: number): string {
  const wall = Math.max(state.wall, Math.max(0, Math.floor(now)));
  state.counter = wall === state.wall ? state.counter + 1 : 0; state.wall = wall;
  if (state.counter > 99_999_999) { state.wall++; state.counter = 0; }
  if (!Number.isSafeInteger(state.wall)) throw new Error('The ledger clock exceeds supported bounds.');
  return `${String(state.wall).padStart(16, '0')}:${String(state.counter).padStart(8, '0')}:${state.device}`;
}
export type DocumentValueChange = { key: string; value: Record<string, unknown> | null };
/** Apply one local command without borrowing calendar/projection ownership. All
 * affected documents participate in the same causal Undo and pending upload. */
export function applyDocumentValues(state: BrowserLedgerState, changes: readonly DocumentValueChange[], now = Date.now()):
  { state: BrowserLedgerState; undo: UndoEdit } {
  if (changes.length > 30_000 || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) {
    throw new Error('This formatting command exceeds supported bounds.');
  }
  const next = clone(state); const map = new Map(next.documents.map((doc) => [doc.key, doc]));
  const before: SyncDocument[] = []; const after: SyncDocument[] = []; const seen = new Set<string>();
  for (const change of changes) {
    if (!/^(?:minute|category):/.test(change.key) || seen.has(change.key)) throw new Error('Invalid or duplicate editable ledger record.');
    seen.add(change.key);
    const candidate = { key: change.key, revision: '0000000000000000:00000000:browser_validation', value: change.value };
    validateBatch({ version: 1, id: 'browser_edit_validation', documents: [candidate] }); validateMinute(candidate);
    const old = map.get(change.key);
    if (hashValue(old?.value ?? null) === hashValue(change.value)) continue;
    const revision = tick(next, now);
    before.push(old ? clone(old) : { key: change.key, revision, value: null });
    const document = { key: change.key, revision, value: clone(change.value) };
    map.set(change.key, document); after.push(clone(document)); next.pending[change.key] = revision;
  }
  next.documents = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { state: next, undo: { before, after } };
}
export function editCells(state: BrowserLedgerState, changes: CellChange[], now = Date.now()): { state: BrowserLedgerState; undo: UndoEdit } {
  if (!changes.length || changes.length > 10_000) throw new Error('Select between 1 and 10,000 cells.');
  const next = clone(state); const map = new Map(next.documents.map((doc) => [doc.key, doc]));
  const before: SyncDocument[] = []; const after: SyncDocument[] = []; const seen = new Set<string>();
  for (const change of changes) {
    const key = minuteKey(change.day, change.minute);
    validateBatch({ version: 1, id: 'browser_coordinate', documents: [{ key, revision: '0000000000000000:00000000:browser_validation', value: null }] });
    if (seen.has(key) || typeof change.text !== 'string' || change.text.length > 50_000) throw new Error('Invalid or duplicate pasted cell.');
    seen.add(key); const old = map.get(key);
    if ((!old?.value && change.text === '') || old?.value?.text === change.text) continue;
    const revision = tick(next, now); const timestamp = new Date(now).toISOString();
    before.push(old ? clone(old) : { key, revision, value: null });
    // Keep the exact phone group/category/source identity. New minutes do not claim calendar ownership.
    const value = old?.value ? { ...clone(old.value), text: change.text, updatedAt: timestamp } : {
      id: `browser_${crypto.randomUUID().replaceAll('-', '')}`, dateKey: change.day, minuteIndex: change.minute,
      text: change.text, categoryId: 'unaccounted', blockId: `browser_${crypto.randomUUID().replaceAll('-', '')}`,
      source: 'manual', createdAt: timestamp, updatedAt: timestamp,
    };
    const document = { key, revision, value }; map.set(key, document); after.push(clone(document)); next.pending[key] = revision;
  }
  next.documents = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { state: next, undo: { before, after } };
}
export function undoEdit(state: BrowserLedgerState, undo: UndoEdit, now = Date.now()): BrowserLedgerState {
  const next = clone(state); const map = new Map(next.documents.map((doc) => [doc.key, doc]));
  for (const expected of undo.after) if (map.get(expected.key)?.revision !== expected.revision) throw new Error('These cells changed since this edit. Undo would overwrite newer work.');
  for (const previous of undo.before) {
    const revision = tick(next, now); map.set(previous.key, { ...clone(previous), revision }); next.pending[previous.key] = revision;
  }
  next.documents = [...map.values()].sort((a, b) => a.key.localeCompare(b.key)); return next;
}
export function pastedChanges(text: string, day: string, minute: number, selectedEnd?: { day: string; minute: number }): CellChange[] {
  const matrix = parseSpreadsheetCells(text);
  if (matrix.rows === 1 && matrix.columns === 1 && selectedEnd) {
    const startDay = [day, selectedEnd.day].sort()[0]!; const lastDay = [day, selectedEnd.day].sort()[1]!;
    const firstMinute = Math.min(minute, selectedEnd.minute); const lastMinute = Math.max(minute, selectedEnd.minute);
    const days: string[] = []; for (let offset = 0; offset < 31; offset++) {
      const next = new Date(`${startDay}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + offset); const value = next.toISOString().slice(0, 10); if (value > lastDay) break; days.push(value);
    }
    if (days.at(-1) !== lastDay || days.length * (lastMinute - firstMinute + 1) > 10_000) throw new Error('Paste at most 10,000 cells across 31 days.');
    return days.flatMap((date) => Array.from({ length: lastMinute - firstMinute + 1 }, (_, index) => ({ day: date, minute: firstMinute + index, text: matrix.cells[0]![0]! })));
  }
  if (selectedEnd) { day = [day, selectedEnd.day].sort()[0]!; minute = Math.min(minute, selectedEnd.minute); }
  const ranges = spreadsheetPasteRanges(matrix, { dateKey: day, startMinute: minute });
  return matrix.cells.flatMap((row, r) => row.map((text, c) => ({ day: ranges[c]!.dateKey, minute: minute + r, text })));
}
