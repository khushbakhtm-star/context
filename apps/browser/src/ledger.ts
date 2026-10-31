import { compareRevisions, hashValue, mergeDocuments, validateBatch } from '../shared/sync/codec';
import type { SyncBatch, SyncDocument } from '../shared/sync/types';
import { parseSpreadsheetCells, spreadsheetPasteRanges } from '../shared/utils/spreadsheet-paste';
import { cellEventLabel, cellFormatKey, formatFromDocument, isActivityGroupId } from '../shared/utils/cell-format';

export type BrowserLedgerState = { version: 1; device: string; wall: number; counter: number;
  documents: SyncDocument[]; conflicts: SyncDocument[]; pending: Record<string, string>; seen: string[];
  upload: null | { name: string; ciphertext: string; batch: SyncBatch; driveId?: string } };
export type CellChange = { day: string; minute: number; text: string };
export type UndoEdit = { before: SyncDocument[]; after: SyncDocument[];
  blockGuards?: { blockId: string; members: { key: string; revision: string }[] }[];
  documentGuards?: { key: string; revision: string | null }[];
  activityEditGuards?: { key: string; revision: string }[];
  projectionGuards?: { blockId: string; documents: { key: string; revision: string }[] }[] };
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
  const documentRevisions = new Map(state.documents.map((doc) => [doc.key, doc.revision]));
  for (const [key, revision] of Object.entries(state.pending)) {
    if (typeof revision !== 'string' || documentRevisions.get(key) !== revision) throw new Error('Invalid pending browser revision.');
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
const ACTIVITY_EDIT_PREFIX = 'category:minuteFormat:activityEdit:';
const activityEditKey = (blockId: string) => `${ACTIVITY_EDIT_PREFIX}${blockId}`;
type ActivityClaim = { dateKey: string; minuteIndex: number; blockId: string };
function touchedMinuteKeys(keys: Iterable<string>) {
  return new Set([...keys].flatMap((key) => {
    if (key.startsWith('minute:')) return [key];
    const format = /^category:minuteFormat:(\d{4}-\d{2}-\d{2}):(\d{1,4})$/.exec(key);
    return format ? [minuteKey(format[1]!, Number(format[2]))] : [];
  }));
}
function activityLabel(documents: Map<string, SyncDocument>, minute: Record<string, unknown> | null | undefined) {
  return minute ? cellEventLabel(formatFromDocument(documents.get(cellFormatKey(String(minute.dateKey), Number(minute.minuteIndex)))?.value),
    String(minute.blockId)) : undefined;
}
function affectedActivityBlocks(before: Map<string, SyncDocument>, after: Map<string, SyncDocument>, keys: Iterable<string>) {
  const blocks = new Set<string>();
  const touchedMinutes = new Set<string>();
  const include = (document: SyncDocument | undefined) => {
    const id = document?.value?.blockId;
    if (typeof id !== 'string' || !id) return;
    // Use the existing compatible category namespace without allowing arbitrary identifiers
    // to escape the transport's length/alphabet bounds.
    validateBatch({ version: 1, id: 'browser_activity_edit_key', documents: [{
      key: activityEditKey(id), revision: '0000000000000000:00000000:browser_validation', value: null,
    }] });
    blocks.add(id);
  };
  for (const key of keys) {
    if (key.startsWith('minute:')) { touchedMinutes.add(key); include(before.get(key)); include(after.get(key)); continue; }
    const format = /^category:minuteFormat:(\d{4}-\d{2}-\d{2}):(\d{1,4})$/.exec(key);
    if (format) {
      const minute = minuteKey(format[1]!, Number(format[2]));
      touchedMinutes.add(minute);
      include(before.get(minute)); include(after.get(minute));
    }
  }
  // A real user edit to an exact still-detached note is also newer work on its
  // former event. Regrouping revokes that claim instead of advancing this clock.
  for (const document of before.values()) if (document.key.startsWith(ACTIVITY_EDIT_PREFIX) &&
      document.value?.kind === 'activityEdit' && typeof document.value.blockId === 'string' &&
      document.key === activityEditKey(document.value.blockId) &&
      retainedDetachedMembers(document.value, after).some((member) => touchedMinutes.has(minuteKey(member.dateKey, member.minuteIndex)))) {
    blocks.add(document.value.blockId);
  }
  const titled = new Set([...blocks].filter(isActivityGroupId));
  for (const id of blocks) if (before.get(activityEditKey(id))?.value?.kind === 'activityEdit') titled.add(id);
  for (const documents of [before, after]) for (const document of documents.values()) {
    if (!document.key.startsWith('minute:') || !document.value || !blocks.has(String(document.value.blockId))) continue;
    const value = document.value; const id = String(value.blockId);
    if (cellEventLabel(formatFromDocument(documents.get(cellFormatKey(String(value.dateKey), Number(value.minuteIndex)))?.value), id)) {
      titled.add(id);
    }
  }
  // Standalone notes already carry their own manual updatedAt. Activity intent is
  // reserved for a deliberate border or a known calendar-event label.
  for (const blockId of blocks) if (!titled.has(blockId)) blocks.delete(blockId);
  return blocks;
}
function claimMembers(previous: Record<string, unknown> | null | undefined, field: 'detachedMembers' | 'derivedMembers'): ActivityClaim[] {
  const members = previous?.[field];
  if (!Array.isArray(members) || members.length > 1440) return [];
  const seen = new Set<string>();
  for (const member of members) {
    if (!member || typeof member !== 'object' || typeof member.dateKey !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(member.dateKey) || !Number.isInteger(member.minuteIndex) ||
        member.minuteIndex < 0 || member.minuteIndex >= 1440 || typeof member.blockId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(member.blockId)) return [];
    const key = minuteKey(member.dateKey, member.minuteIndex);
    if (seen.has(key)) return []; seen.add(key);
  }
  return members;
}
function retainedDetachedMembers(previous: Record<string, unknown> | null | undefined, after: Map<string, SyncDocument>) {
  return claimMembers(previous, 'detachedMembers').filter((member) => {
    const minute = after.get(minuteKey(member.dateKey, member.minuteIndex))?.value;
    return minute?.blockId === member.blockId && !activityLabel(after, minute);
  });
}
function indexedMinuteMembers(documents: Map<string, SyncDocument>) {
  const result = new Map<string, SyncDocument[]>();
  for (const document of documents.values()) if (document.key.startsWith('minute:') && document.value) {
    const id = String(document.value.blockId); const members = result.get(id) ?? [];
    members.push(document); result.set(id, members);
  }
  return result;
}
function retainedDerivedMembers(previous: Record<string, unknown> | null | undefined, after: Map<string, SyncDocument>,
  indexed: ReturnType<typeof indexedMinuteMembers>) {
  const claims = claimMembers(previous, 'derivedMembers'); const retained: ActivityClaim[] = [];
  for (const id of new Set(claims.map((member) => member.blockId))) {
    const group = claims.filter((member) => member.blockId === id); const members = indexed.get(id) ?? [];
    const coordinates = new Set(group.map((member) => minuteKey(member.dateKey, member.minuteIndex)));
    if (members.length === group.length && members.every((member) => coordinates.has(member.key) && activityLabel(after, member.value))) {
      retained.push(...group);
    }
  }
  return retained;
}
function changedActivityClaims(before: Map<string, SyncDocument>, after: Map<string, SyncDocument>, keys: Iterable<string>,
  beforeMembers: ReturnType<typeof indexedMinuteMembers>) {
  const detached = new Map<string, ActivityClaim[]>(), derived = new Map<string, ActivityClaim[]>();
  const regrouped = new Set<string>();
  const add = (map: Map<string, ActivityClaim[]>, owner: string, member: ActivityClaim) => {
    const members = map.get(owner) ?? []; members.push(member); map.set(owner, members);
  };
  for (const key of touchedMinuteKeys(keys)) {
    const old = before.get(key)?.value, next = after.get(key)?.value;
    const oldId = old?.blockId, nextId = next?.blockId;
    const oldLabel = activityLabel(before, old), nextLabel = activityLabel(after, next);
    if (next && typeof nextId === 'string' && nextLabel && (!oldLabel || oldId !== nextId || oldLabel.title !== nextLabel.title)) regrouped.add(nextId);
    if (!old || !next || typeof oldId !== 'string' || typeof nextId !== 'string' || oldId === nextId || !oldLabel) continue;
    const member = { dateKey: String(next.dateKey), minuteIndex: Number(next.minuteIndex), blockId: nextId };
    if (!nextLabel) add(detached, oldId, member);
    else if (isActivityGroupId(nextId) && !beforeMembers.has(nextId) && oldLabel.title === nextLabel.title &&
        old.text === next.text && old.categoryId === next.categoryId) add(derived, oldId, member);
  }
  // Independent regrouping and moves cannot claim another bordered activity.
  for (const id of derived.keys()) if (!detached.has(id)) derived.delete(id);
  return { detached, derived, regrouped };
}
/** Derived local intent is committed with the user's actual edits, but stays outside
 * visible cell counts and Undo snapshots. Cloud merges and acknowledgements never call this. */
function recordActivityEdits(state: BrowserLedgerState, before: Map<string, SyncDocument>,
  after: Map<string, SyncDocument>, changedKeys: Iterable<string>, now: number) {
  const keys = [...changedKeys];
  const blocks = affectedActivityBlocks(before, after, keys);
  const beforeMembers = indexedMinuteMembers(before), afterMembers = indexedMinuteMembers(after);
  const claims = changedActivityClaims(before, after, keys, beforeMembers);
  const survivingTitles = new Set<string>();
  for (const document of after.values()) {
    if (!document.key.startsWith('minute:') || !document.value || !blocks.has(String(document.value.blockId))) continue;
    const value = document.value;
    if (cellEventLabel(formatFromDocument(after.get(cellFormatKey(String(value.dateKey), Number(value.minuteIndex)))?.value), String(value.blockId))) {
      survivingTitles.add(String(value.blockId));
    }
  }
  const guards: NonNullable<UndoEdit['activityEditGuards']> = [];
  for (const blockId of blocks) {
    const key = activityEditKey(blockId); const revision = tick(state, now);
    const previous = after.get(key)?.value;
    const previousTime = typeof previous?.updatedAt === 'string' ? Date.parse(previous.updatedAt) : Number.NaN;
    const timestamp = Math.max(Math.floor(now), Number.isFinite(previousTime) ? previousTime + 1 : Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(new Date(timestamp).getTime())) throw new Error('The activity edit clock exceeds supported bounds.');
    const updatedAt = new Date(timestamp).toISOString();
    const deleted = !survivingTitles.has(blockId);
    const value: Record<string, unknown> = { ...clone(previous ?? {}), kind: 'activityEdit', blockId, updatedAt, deleted };
    delete value.detachedMembers; delete value.derivedMembers;
    const mergeClaims = (field: 'detachedMembers' | 'derivedMembers', added: ActivityClaim[]) => {
      const merged = new Map<string, ActivityClaim>();
      for (const member of [...(!claims.regrouped.has(blockId) ? claimMembers(previous, field) : []), ...added]) {
        merged.set(minuteKey(member.dateKey, member.minuteIndex), member);
      }
      return [...merged.values()];
    };
    const detached = mergeClaims('detachedMembers', claims.detached.get(blockId) ?? []);
    const derived = mergeClaims('derivedMembers', claims.derived.get(blockId) ?? []);
    if (detached.length + derived.length > 1440) throw new Error('This activity has too many split minutes. Review it before editing.');
    const retained = retainedDetachedMembers({ detachedMembers: detached }, after);
    const siblings = retainedDerivedMembers({ derivedMembers: derived }, after, afterMembers);
    if (retained.length) value.detachedMembers = clone(retained);
    if (siblings.length) value.derivedMembers = clone(siblings);
    after.set(key, { key, revision, value });
    state.pending[key] = revision; guards.push({ key, revision });
  }
  // Regrouping an unbordered note revokes its former group's restoration claim.
  // This bookkeeping shares the user command without inventing a new edit time
  // for an event that the user did not change.
  const touchedMinutes = touchedMinuteKeys(keys);
  const touchedBlocks = new Set([...touchedMinutes].flatMap((key) => [before.get(key)?.value?.blockId, after.get(key)?.value?.blockId]));
  for (const document of before.values()) {
    const previous = document.value;
    if (!document.key.startsWith(ACTIVITY_EDIT_PREFIX) || previous?.kind !== 'activityEdit' ||
        typeof previous.blockId !== 'string' || document.key !== activityEditKey(previous.blockId) ||
        blocks.has(previous.blockId) || ![...claimMembers(previous, 'detachedMembers'), ...claimMembers(previous, 'derivedMembers')]
          .some((member) => touchedMinutes.has(minuteKey(member.dateKey, member.minuteIndex)) || touchedBlocks.has(member.blockId))) continue;
    const retained = retainedDetachedMembers(previous, after);
    const siblings = retainedDerivedMembers(previous, after, afterMembers);
    if (hashValue(retained) === hashValue(previous.detachedMembers ?? []) && hashValue(siblings) === hashValue(previous.derivedMembers ?? [])) continue;
    const value = clone(previous); delete value.detachedMembers; delete value.derivedMembers;
    if (retained.length) value.detachedMembers = clone(retained);
    if (siblings.length && retained.length + siblings.length <= 1440) value.derivedMembers = clone(siblings);
    const revision = tick(state, now); const key = document.key;
    after.set(key, { key, revision, value }); state.pending[key] = revision; guards.push({ key, revision });
  }
  return guards;
}
export type DocumentValueChange = { key: string; value: Record<string, unknown> | null };
/** Apply one local command without borrowing calendar/projection ownership. All
 * affected documents participate in the same causal Undo and pending upload. */
export function applyDocumentValues(state: BrowserLedgerState, changes: readonly DocumentValueChange[], now = Date.now()):
  { state: BrowserLedgerState; undo: UndoEdit } {
  // A 10,000-cell move can change a minute and its format at both endpoints.
  if (changes.length > 40_000 || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) {
    throw new Error('This formatting command exceeds supported bounds.');
  }
  const next = clone(state); const map = new Map(next.documents.map((doc) => [doc.key, doc]));
  const original = new Map(map);
  const before: SyncDocument[] = []; const after: SyncDocument[] = []; const seen = new Set<string>();
  for (const change of changes) {
    if (!/^(?:minute|category):/.test(change.key) || change.key.startsWith(ACTIVITY_EDIT_PREFIX) || seen.has(change.key)) throw new Error('Invalid or duplicate editable ledger record.');
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
  const activityEditGuards = recordActivityEdits(next, original, map, after.map((document) => document.key), now);
  next.documents = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { state: next, undo: { before, after, ...(activityEditGuards.length ? { activityEditGuards } : {}) } };
}
export function editCells(state: BrowserLedgerState, changes: CellChange[], now = Date.now()): { state: BrowserLedgerState; undo: UndoEdit } {
  if (!changes.length || changes.length > 10_000 || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('Select between 1 and 10,000 cells and use a valid edit time.');
  const next = clone(state); const map = new Map(next.documents.map((doc) => [doc.key, doc]));
  const original = new Map(map);
  const before: SyncDocument[] = []; const after: SyncDocument[] = []; const seen = new Set<string>();
  for (const change of changes) {
    const key = minuteKey(change.day, change.minute);
    validateBatch({ version: 1, id: 'browser_coordinate', documents: [{ key, revision: '0000000000000000:00000000:browser_validation', value: null }] });
    if (seen.has(key) || typeof change.text !== 'string' || change.text.length > 50_000) throw new Error('Invalid or duplicate pasted cell.');
    seen.add(key); const old = map.get(key);
    if ((!old?.value && change.text === '') || old?.value?.text === change.text) continue;
    const revision = tick(next, now); const timestamp = new Date(now).toISOString();
    before.push(old ? clone(old) : { key, revision, value: null });
    // Keep phone group/category ownership; changed text records a genuine user
    // edit. New minutes do not claim calendar ownership.
    const value = old?.value ? { ...clone(old.value), text: change.text, source: 'manual', updatedAt: timestamp } : {
      id: `browser_${crypto.randomUUID().replaceAll('-', '')}`, dateKey: change.day, minuteIndex: change.minute,
      text: change.text, categoryId: 'unaccounted', blockId: `browser_${crypto.randomUUID().replaceAll('-', '')}`,
      source: 'manual', createdAt: timestamp, updatedAt: timestamp,
    };
    const document = { key, revision, value }; map.set(key, document); after.push(clone(document)); next.pending[key] = revision;
  }
  const activityEditGuards = recordActivityEdits(next, original, map, after.map((document) => document.key), now);
  next.documents = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { state: next, undo: { before, after, ...(activityEditGuards.length ? { activityEditGuards } : {}) } };
}
export function undoEdit(state: BrowserLedgerState, undo: UndoEdit, now = Date.now()): BrowserLedgerState {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('Use a valid edit time.');
  const next = clone(state); const map = new Map(next.documents.map((doc) => [doc.key, doc]));
  const original = new Map(map);
  const groupedRevisions = (prefix: string) => {
    const result = new Map<string, { key: string; revision: string }[]>();
    for (const doc of next.documents) if (doc.key.startsWith(prefix) && doc.value && typeof doc.value.blockId === 'string') {
      const rows = result.get(doc.value.blockId) ?? []; rows.push({ key: doc.key, revision: doc.revision }); result.set(doc.value.blockId, rows);
    }
    for (const rows of result.values()) rows.sort((a, b) => a.key.localeCompare(b.key));
    return result;
  };
  const projectionRevisions = undo.projectionGuards?.length ? groupedRevisions('projection:') : null;
  const memberRevisions = undo.blockGuards?.length ? groupedRevisions('minute:') : null;
  for (const expected of undo.documentGuards ?? []) if ((map.get(expected.key)?.revision ?? null) !== expected.revision) {
    throw new Error('These cells changed since this edit. Undo would overwrite newer work.');
  }
  for (const expected of undo.activityEditGuards ?? []) if (map.get(expected.key)?.revision !== expected.revision) {
    throw new Error('This activity changed since this edit. Undo would overwrite newer work.');
  }
  for (const guard of undo.projectionGuards ?? []) {
    const documents = projectionRevisions!.get(guard.blockId) ?? [];
    if (hashValue(documents) !== hashValue(guard.documents)) throw new Error('This calendar link changed since this edit. Review it before Undo.');
  }
  for (const guard of undo.blockGuards ?? []) {
    const members = memberRevisions!.get(guard.blockId) ?? [];
    if (hashValue(members) !== hashValue(guard.members)) throw new Error('This activity changed since this edit. Undo would overwrite newer work.');
  }
  for (const expected of undo.after) if (map.get(expected.key)?.revision !== expected.revision) throw new Error('These cells changed since this edit. Undo would overwrite newer work.');
  for (const previous of undo.before) {
    const revision = tick(next, now); const restored = clone(previous);
    const current = original.get(previous.key)?.value;
    if (previous.key.startsWith('minute:') && restored.value && current && restored.value.text !== current.text) {
      restored.value.source = 'manual'; restored.value.updatedAt = new Date(now).toISOString();
    }
    map.set(previous.key, { ...restored, revision }); next.pending[previous.key] = revision;
  }
  recordActivityEdits(next, original, map, undo.before.map((document) => document.key), now);
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
