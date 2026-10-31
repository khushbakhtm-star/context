import { hashValue, validateBatch } from '../shared/sync/codec';
import { cellFormatKey, cellEventLabel, formatFromDocument, isActivityGroupId } from '../shared/utils/cell-format';
import { applyDocumentValues, minuteKey, type BrowserLedgerState, type DocumentValueChange, type UndoEdit } from './ledger';

export type FormatCoordinate = { day: string; minute: number };
export type BrowserFill = { categoryId?: string; color: string; name?: string; providerColorId?: string; accountId?: string };
export type BrowserFormatPatch = { bold?: boolean; italic?: boolean; underline?: boolean; textColor?: string | null; fill?: BrowserFill | null };
// Same documented CalendarApp.Color fallback as the phone; provider palettes may extend it.
export const GOOGLE_ACTIVITY_COLORS = ['#2952A3', '#8D6F47', '#4E5D6C', '#865A5A', '#5A6986', '#0D7813', '#5229A3',
  '#528800', '#88880E', '#6E6E41', '#BE6D00', '#B1365F', '#705770', '#7A367A', '#A32929', '#B1440E', '#29527A', '#4A716C', '#28754E', '#1B887A', '#AB8B00'] as const;
const COLOR = /^#[0-9A-F]{6}$/i;
const CATEGORY_ID = /^[A-Za-z0-9_-]{1,160}$/;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function categoryForFill(state: BrowserLedgerState, fill: BrowserFill, allowedColors: readonly string[], now: number) {
  if (!object(fill) || typeof fill.color !== 'string' || !COLOR.test(fill.color) ||
      !allowedColors.some((color) => typeof color === 'string' && COLOR.test(color) && color.toUpperCase() === fill.color.toUpperCase())) {
    throw new Error('Choose a color from the Google Calendar palette.');
  }
  const color = fill.color.toUpperCase();
  const categories = state.documents.filter((doc) => /^category:[A-Za-z0-9_-]{1,160}$/.test(doc.key) &&
    doc.value && doc.key === `category:${doc.value.id}`);
  const valid = (value: Record<string, unknown>) => typeof value.id === 'string' && CATEGORY_ID.test(value.id) &&
    typeof value.name === 'string' && value.name.trim() && value.name.length <= 200 &&
    typeof value.color === 'string' && value.color.toUpperCase() === color && value.archived !== true;
  if (fill.categoryId !== undefined) {
    const selected = categories.find((doc) => doc.key === `category:${fill.categoryId}`);
    if (!CATEGORY_ID.test(fill.categoryId) || !selected?.value || !valid(selected.value)) throw new Error('This activity color changed. Select it again.');
    return { id: fill.categoryId, change: null };
  }
  const scoped = fill.providerColorId !== undefined || fill.accountId !== undefined;
  if (scoped && (typeof fill.accountId !== 'string' || !fill.accountId.trim() || fill.accountId.length > 200 ||
      typeof fill.providerColorId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(fill.providerColorId))) {
    throw new Error('The Google Calendar color identity is unavailable.');
  }
  const matching = categories.find((doc) => valid(doc.value!) && (scoped
    ? doc.value!.provider === 'google' && doc.value!.accountId === fill.accountId && doc.value!.providerColorId === fill.providerColorId
    : !doc.value!.provider));
  if (matching) return { id: String(matching.value!.id), change: null };
  if (fill.name !== undefined && typeof fill.name !== 'string') throw new Error('Use a valid activity name.');
  const name = fill.name?.trim() || color;
  if (typeof name !== 'string' || name.length > 200) throw new Error('Use an activity name of up to 200 characters.');
  const base = scoped ? `browser_google_${hashValue([fill.accountId, fill.providerColorId, color]).slice(0, 40)}` : `google_palette_${color.slice(1).toLowerCase()}`;
  let id = base; let suffix = 0;
  while (state.documents.some((doc) => doc.key === `category:${id}`)) id = `${base}_${++suffix}`;
  const value: Record<string, unknown> = { id, name, color, updatedAt: new Date(now).toISOString(), ...(scoped ? {
    provider: 'google', accountId: fill.accountId!, providerColorId: fill.providerColorId!, googleColorVerified: true,
    providerOriginalColor: color, providerOriginalName: name,
  } : {}) };
  return { id, change: { key: `category:${id}`, value } satisfies DocumentValueChange };
}

/** Formatting is a local ledger command. It never changes a note, group or
 * projection identity, and all its documents share one optimistic Undo. */
export function formatCells(state: BrowserLedgerState, coords: readonly FormatCoordinate[], patch: BrowserFormatPatch,
  allowedColors: readonly string[], now = Date.now()): { state: BrowserLedgerState; undo: UndoEdit } {
  if (!Array.isArray(coords) || !coords.length || coords.length > 10_000 || !Array.isArray(allowedColors) || !object(patch) ||
      (patch.fill !== undefined && patch.fill !== null && !object(patch.fill)) || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime()) ||
      Object.keys(patch).some((key) => !['bold', 'italic', 'underline', 'textColor', 'fill'].includes(key))) throw new Error('Choose between 1 and 10,000 cells and valid formatting.');
  for (const key of ['bold', 'italic', 'underline'] as const) if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw new Error('Choose valid text formatting.');
  if (patch.textColor !== undefined && patch.textColor !== null && (typeof patch.textColor !== 'string' || !COLOR.test(patch.textColor))) throw new Error('Use a six-digit text color.');
  const fill = patch.fill ? categoryForFill(state, patch.fill, allowedColors, now) : null;
  const map = new Map(state.documents.map((doc) => [doc.key, doc])); const changes: DocumentValueChange[] = [];
  if (fill?.change) changes.push(fill.change);
  const timestamp = new Date(now).toISOString(); const seen = new Set<string>();
  for (const coordinate of coords) {
    const key = minuteKey(coordinate.day, coordinate.minute);
    validateBatch({ version: 1, id: 'browser_format_coordinate', documents: [{ key, revision: '0000000000000000:00000000:browser_validation', value: null }] });
    if (seen.has(key)) throw new Error('Select each minute only once.'); seen.add(key);
    const minute = map.get(key)?.value; const formatKey = cellFormatKey(coordinate.day, coordinate.minute); const existingFormat = map.get(formatKey)?.value;
    const normalized = formatFromDocument(existingFormat);
    const raw = existingFormat?.kind === 'minuteFormat' && object(existingFormat.format) ? existingFormat.format : normalized;
    const format = structuredClone(raw);
    for (const style of ['bold', 'italic', 'underline'] as const) if (patch[style] !== undefined) {
      if (patch[style]) format[style] = true; else delete format[style];
    }
    if (patch.textColor !== undefined) { if (patch.textColor === null) delete format.textColor; else format.textColor = patch.textColor.toUpperCase(); }
    if (patch.fill === null) {
      format.noFill = true;
      if (minute) {
        const keep = String(minute.text ?? '').trim().length > 0 || isActivityGroupId(minute.blockId) || Boolean(cellEventLabel(normalized, String(minute.blockId ?? '')));
        changes.push({ key, value: keep ? { ...structuredClone(minute), categoryId: 'unaccounted',
          updatedAt: minute.categoryId === 'unaccounted' ? minute.updatedAt : timestamp } : null });
      }
    } else if (fill) {
      delete format.noFill;
      if (minute) changes.push({ key, value: { ...structuredClone(minute), categoryId: fill.id,
        updatedAt: minute.categoryId === fill.id ? minute.updatedAt : timestamp } });
      else changes.push({ key, value: { id: `browser_${crypto.randomUUID().replaceAll('-', '')}`, dateKey: coordinate.day,
        minuteIndex: coordinate.minute, text: '', categoryId: fill.id, blockId: `browser_${crypto.randomUUID().replaceAll('-', '')}`,
        source: 'manual', createdAt: timestamp, updatedAt: timestamp } });
    }
    const opaqueEnvelope = existingFormat?.kind === 'minuteFormat' && Object.keys(existingFormat).some((field) => field !== 'kind' && field !== 'format');
    changes.push({ key: formatKey, value: Object.keys(format).length || opaqueEnvelope
      ? { ...structuredClone(existingFormat ?? {}), kind: 'minuteFormat', format } : null });
  }
  return applyDocumentValues(state, changes, now);
}

const civilMinute = (point: FormatCoordinate) => Date.parse(`${point.day}T00:00:00Z`) / 60000 + point.minute;
function validCoordinate(coordinate: FormatCoordinate) {
  if (!coordinate || typeof coordinate.day !== 'string' || !Number.isInteger(coordinate.minute)) throw new Error('Choose a valid date and minute.');
  validateBatch({ version: 1, id: 'browser_group_coordinate', documents: [{ key: minuteKey(coordinate.day, coordinate.minute),
    revision: '0000000000000000:00000000:browser_validation', value: null }] });
  return coordinate;
}
function fromCivilMinute(value: number): FormatCoordinate {
  const date = new Date(value * 60000); const day = date.toISOString().slice(0, 10);
  return validCoordinate({ day, minute: date.getUTCHours() * 60 + date.getUTCMinutes() });
}
/** Explicit inclusive event endpoints describe one chronological run, including midnight. */
export function contiguousMinuteSpan(start: FormatCoordinate, end: FormatCoordinate): FormatCoordinate[] {
  const first = civilMinute(validCoordinate(start)); const last = civilMinute(validCoordinate(end));
  if (last < first || last - first >= 1440) throw new Error('Choose chronological endpoints for an activity of at most 24 hours.');
  return Array.from({ length: last - first + 1 }, (_, index) => fromCivilMinute(first + index));
}
function consecutiveSelection(coords: readonly FormatCoordinate[]) {
  if (!Array.isArray(coords) || !coords.length || coords.length > 1440) throw new Error('Select consecutive minutes for an activity of at most 24 hours.');
  const selected = coords.map((coordinate) => ({ ...validCoordinate(coordinate) })).sort((left, right) => civilMinute(left) - civilMinute(right));
  if (selected.some((coordinate, index) => index > 0 && civilMinute(coordinate) !== civilMinute(selected[index - 1]!) + 1)) {
    throw new Error('Select consecutive minutes across the chosen dates.');
  }
  return selected;
}
function formatEnvelope(value: Record<string, unknown> | null | undefined) {
  return value?.kind === 'minuteFormat' && object(value.format) ? structuredClone(value.format) : { ...formatFromDocument(value) };
}
function formatValue(existing: Record<string, unknown> | null | undefined, format: Record<string, unknown>) {
  const opaqueEnvelope = existing?.kind === 'minuteFormat' && Object.keys(existing).some((field) => field !== 'kind' && field !== 'format');
  return Object.keys(format).length || opaqueEnvelope ? { ...structuredClone(existing ?? {}), kind: 'minuteFormat', format } : null;
}

function selectedEventIds(state: BrowserLedgerState, coords: readonly FormatCoordinate[]) {
  const map = new Map(state.documents.map((doc) => [doc.key, doc]));
  return new Set(coords.flatMap((point) => {
    const minute = map.get(minuteKey(point.day, point.minute))?.value;
    const label = cellEventLabel(formatFromDocument(map.get(cellFormatKey(point.day, point.minute))?.value), String(minute?.blockId ?? ''));
    return minute && (label || isActivityGroupId(minute.blockId)) ? [String(minute.blockId)] : [];
  }));
}

/** Capture exact members as well as selected cells before an asynchronous edit.
 * A newly arrived outside member must not be silently absorbed by a stale split. */
export function eventSelectionKeys(state: BrowserLedgerState, coords: readonly FormatCoordinate[]): string[] {
  const ids = selectedEventIds(state, coords);
  const points = new Map(coords.map((point) => [minuteKey(point.day, point.minute), point]));
  for (const doc of state.documents) if (doc.key.startsWith('minute:') && doc.value && ids.has(String(doc.value.blockId))) {
    points.set(doc.key, { day: String(doc.value.dateKey), minute: Number(doc.value.minuteIndex) });
  }
  if (points.size > 10_000) throw new Error('Select fewer event minutes before changing these borders.');
  return [...new Set([...points.values()].flatMap((point) => [minuteKey(point.day, point.minute), cellFormatKey(point.day, point.minute)]))].sort();
}
export function eventSelectionFingerprint(state: BrowserLedgerState, coords: readonly FormatCoordinate[]) {
  const revisions = new Map(state.documents.map((doc) => [doc.key, doc.revision]));
  return hashValue(eventSelectionKeys(state, coords).map((key) => [key, revisions.get(key) ?? null]));
}

function eventSelection(state: BrowserLedgerState, coords: readonly FormatCoordinate[], mode: 'group' | 'ungroup' | 'reset',
  now: number, input?: { title: string; fill?: BrowserFill }, allowedColors: readonly string[] = []):
  { state: BrowserLedgerState; undo: UndoEdit } {
  const selected = consecutiveSelection(coords);
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('Use a valid edit time.');
  const map = new Map(state.documents.map((doc) => [doc.key, doc]));
  const selectedKeys = new Set(selected.map((point) => minuteKey(point.day, point.minute)));
  const ids = selectedEventIds(state, selected); const allIds = new Set(ids);
  if (mode === 'ungroup' && !ids.size) return applyDocumentValues(state, [], now);
  eventSelectionKeys(state, selected);
  const targetId = mode === 'group' ? ids.size === 1 ? [...ids][0]! : `activity_${crypto.randomUUID().replaceAll('-', '')}` : null;
  if (targetId) allIds.add(targetId);
  const changes = new Map<string, DocumentValueChange>();
  const set = (key: string, value: Record<string, unknown> | null) => changes.set(key, { key, value });
  const timestamp = new Date(now).toISOString();
  const withLabel = (format: Record<string, unknown>, id: string, title: string) => {
    delete format.activityGroup; delete format.calendarEvent;
    format[isActivityGroupId(id) ? 'activityGroup' : 'calendarEvent'] = { id, title }; return format;
  };
  const civil = (value: Record<string, unknown>) => Date.parse(String(value.dateKey) + 'T00:00:00Z') / 60000 + Number(value.minuteIndex);
  for (const id of ids) {
    const labelFor = (value: Record<string, unknown>) => cellEventLabel(formatFromDocument(map.get(cellFormatKey(String(value.dateKey),
      Number(value.minuteIndex)))?.value), id);
    const selectedTitles = new Set(selected.flatMap((point) => {
      const value = map.get(minuteKey(point.day, point.minute))?.value;
      const label = value?.blockId === id ? labelFor(value) : null;
      return label ? [label.title] : [];
    }));
    // Ordinary legacy block IDs can also belong to unrelated, unbordered notes.
    // Only the exact selected border may participate in its split.
    const members = state.documents.filter((doc) => doc.key.startsWith('minute:') && doc.value?.blockId === id &&
      (isActivityGroupId(id) || selectedTitles.has(labelFor(doc.value)?.title ?? '')))
      .sort((a, b) => civil(a.value!) - civil(b.value!));
    if (members.length > 1440) throw new Error('Select an event of at most 24 hours before changing its border.');
    let run: typeof members = []; let runIndex = 0;
    const finish = () => {
      if (!run.length) return;
      const title = labelFor(run[0]!.value!)?.title ?? 'Activity';
      const nextId = runIndex++ === 0 && targetId !== id ? id : `activity_${crypto.randomUUID().replaceAll('-', '')}`;
      allIds.add(nextId);
      for (const doc of run) {
        set(doc.key, { ...structuredClone(doc.value!), blockId: nextId, updatedAt: timestamp });
        const key = cellFormatKey(String(doc.value!.dateKey), Number(doc.value!.minuteIndex)); const previous = map.get(key)?.value;
        set(key, formatValue(previous, withLabel(formatEnvelope(previous), nextId, title)));
      }
      run = [];
    };
    for (const doc of members.filter((doc) => !selectedKeys.has(doc.key))) {
      if (run.length && (civil(doc.value!) !== civil(run.at(-1)!.value!) + 1 ||
          labelFor(doc.value!)?.title !== labelFor(run.at(-1)!.value!)?.title)) finish();
      run.push(doc);
    }
    finish();
  }
  const fill = input?.fill ? categoryForFill(state, input.fill, allowedColors, now) : null;
  if (fill?.change) set(fill.change.key, fill.change.value);
  const firstMinute = map.get(minuteKey(selected[0]!.day, selected[0]!.minute))?.value;
  const categoryId = fill?.id ?? String(firstMinute?.categoryId ?? 'unaccounted');
  for (const point of selected) {
    const key = minuteKey(point.day, point.minute); const minute = map.get(key)?.value;
    const formatKey = cellFormatKey(point.day, point.minute); const existing = map.get(formatKey)?.value;
    if (mode === 'reset') { set(key, null); set(formatKey, { kind: 'minuteFormat', format: { noFill: true } }); }
    else if (mode === 'group') {
      set(key, minute ? { ...structuredClone(minute), blockId: targetId!, categoryId, updatedAt: timestamp } : {
        id: `browser_${crypto.randomUUID().replaceAll('-', '')}`, dateKey: point.day, minuteIndex: point.minute,
        text: '', categoryId, blockId: targetId!, source: 'manual', createdAt: timestamp, updatedAt: timestamp,
      });
      const format = formatEnvelope(existing); delete format.noFill;
      set(formatKey, formatValue(existing, withLabel(format, targetId!, input!.title.trim())));
    } else if (minute && ids.has(String(minute.blockId))) {
      set(key, { ...structuredClone(minute), blockId: `browser_${crypto.randomUUID().replaceAll('-', '')}`, updatedAt: timestamp });
      const format = formatEnvelope(existing); delete format.activityGroup; delete format.calendarEvent;
      set(formatKey, formatValue(existing, format));
    }
  }
  const result = applyDocumentValues(state, [...changes.values()], now);
  result.undo.blockGuards = [...allIds].map((blockId) => ({ blockId, members: result.state.documents
    .filter((doc) => doc.key.startsWith('minute:') && doc.value?.blockId === blockId)
    .map(({ key, revision }) => ({ key, revision })).sort((a, b) => a.key.localeCompare(b.key)) }));
  return result;
}

/** Calendar writes remain the phone's separately authorized responsibility. */
export function groupSelection(state: BrowserLedgerState, coords: readonly FormatCoordinate[], input: { title: string; fill?: BrowserFill },
  allowedColors: readonly string[], now = Date.now()) {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200) throw new Error('Enter an activity title of up to 200 characters.');
  return eventSelection(state, coords, 'group', now, input, allowedColors);
}
export function ungroupSelection(state: BrowserLedgerState, coords: readonly FormatCoordinate[], now = Date.now()) {
  return eventSelection(state, coords, 'ungroup', now);
}
export function resetCellsSelection(state: BrowserLedgerState, coords: readonly FormatCoordinate[], now = Date.now()) {
  return eventSelection(state, coords, 'reset', now);
}

export type CellTransferOptions = { copy?: boolean; expectedFingerprint?: string };
const OCCUPIED_DESTINATION = 'The destination contains notes or formatting. Choose empty cells, or use Reset cells on the destination first; Reset can be undone.';
function emptyDestinationFormat(value: Record<string, unknown> | null | undefined) {
  if (value == null) return true;
  // Reset cells deliberately leaves this marker to suppress a projected plan's
  // fill. It carries no user styling; opaque envelopes and real styles remain occupied.
  return value.kind === 'minuteFormat' && Object.keys(value).length === 2 && object(value.format) &&
    Object.keys(value.format).length === 1 && value.format.noFill === true;
}
function transferCoordinates(coords: readonly FormatCoordinate[], destination: FormatCoordinate) {
  if (!Array.isArray(coords) || !coords.length || coords.length > 10_000) throw new Error('Select between 1 and 10,000 cells to move.');
  const source = coords.map((point) => ({ ...validCoordinate(point) })).sort((a, b) => civilMinute(a) - civilMinute(b));
  const keys = new Set(source.map((point) => minuteKey(point.day, point.minute)));
  if (keys.size !== source.length) throw new Error('Select each minute only once.');
  const shift = civilMinute(validCoordinate(destination)) - civilMinute(source[0]!);
  let target: FormatCoordinate[];
  try { target = source.map((point) => fromCivilMinute(civilMinute(point) + shift)); }
  catch { throw new Error('The destination goes beyond supported dates. Choose another cell.'); }
  return { source, target, shift };
}

/** Translate a grab/drop pair without confusing the grabbed cell with the selection's start. */
export function cellTransferDestination(coords: readonly FormatCoordinate[], grabbed: FormatCoordinate,
  dropped: FormatCoordinate): FormatCoordinate {
  const { source } = transferCoordinates(coords, validCoordinate(grabbed));
  if (!source.some((point) => point.day === grabbed.day && point.minute === grabbed.minute)) throw new Error('Drag from within the selected cells.');
  const destination = fromCivilMinute(civilMinute(source[0]!) + civilMinute(validCoordinate(dropped)) - civilMinute(grabbed));
  transferCoordinates(source, destination); return destination;
}

function transferScope(state: BrowserLedgerState, source: readonly FormatCoordinate[], target: readonly FormatCoordinate[]) {
  const map = new Map(state.documents.map((doc) => [doc.key, doc]));
  const ids = new Set(source.flatMap((point) => {
    const value = map.get(minuteKey(point.day, point.minute))?.value;
    return value && typeof value.blockId === 'string' ? [value.blockId] : [];
  }));
  const members = state.documents.filter((doc) => doc.key.startsWith('minute:') && doc.value && ids.has(String(doc.value.blockId)));
  const membersById = new Map<string, typeof members>(); const projectionsById = new Map<string, typeof members>();
  for (const doc of members) { const blockId = String(doc.value!.blockId); const rows = membersById.get(blockId) ?? []; rows.push(doc); membersById.set(blockId, rows); }
  const sourcePoints = new Map(source.map((point) => [minuteKey(point.day, point.minute), point]));
  for (const member of members) sourcePoints.set(member.key, { day: String(member.value!.dateKey), minute: Number(member.value!.minuteIndex) });
  if (sourcePoints.size > 10_000) throw new Error('This selection belongs to larger activities. Select fewer activity minutes before moving.');
  const points = [...sourcePoints.values(), ...target];
  const keys = new Set(points.flatMap((point) => [minuteKey(point.day, point.minute), cellFormatKey(point.day, point.minute)]));
  for (const doc of state.documents) if (doc.key.startsWith('projection:') && doc.value && ids.has(String(doc.value.blockId))) {
    keys.add(doc.key); const blockId = String(doc.value.blockId); const rows = projectionsById.get(blockId) ?? [];
    rows.push(doc); projectionsById.set(blockId, rows);
  }
  return { map, ids, membersById, projectionsById, keys: [...keys].sort() };
}

/** A drag snapshot includes blank destinations, every affected member and calendar-link revisions. */
export function cellTransferFingerprint(state: BrowserLedgerState, coords: readonly FormatCoordinate[],
  destination: FormatCoordinate, options: Pick<CellTransferOptions, 'copy'> = {}) {
  const { source, target } = transferCoordinates(coords, destination);
  const scope = transferScope(state, source, target);
  return hashValue({ copy: options.copy === true, source, target,
    documents: scope.keys.map((key) => [key, scope.map.get(key)?.revision ?? null]) });
}

function movedFormat(value: Record<string, unknown> | null | undefined, previousId: string, nextId: string) {
  if (previousId === nextId) return value ? structuredClone(value) : null;
  const label = cellEventLabel(formatFromDocument(value), previousId);
  if (!label) return value ? structuredClone(value) : null;
  const format = formatEnvelope(value); delete format.activityGroup; delete format.calendarEvent;
  format[isActivityGroupId(nextId) ? 'activityGroup' : 'calendarEvent'] = { id: nextId, title: label.title };
  return formatValue(value, format);
}
const freshBlock = (bordered: boolean) => `${bordered ? 'activity' : 'browser'}_${crypto.randomUUID().replaceAll('-', '')}`;

/** Full-cell moves use one civil-minute translation and one optimistic Undo.
 * Existing provider-linked cells can only be copied with fresh identities: the
 * current shared transport has no atomic commit marker spanning multiple files,
 * so moving their old tombstones before new cells arrive could delete a source
 * event. Local activities remain movable; provider projections are never written. */
export function transferCells(state: BrowserLedgerState, coords: readonly FormatCoordinate[], destination: FormatCoordinate,
  options: CellTransferOptions = {}, now = Date.now()): { state: BrowserLedgerState; undo: UndoEdit; destinationCoords: FormatCoordinate[] } {
  if (!object(options) || Object.keys(options).some((key) => !['copy', 'expectedFingerprint'].includes(key)) ||
      options.copy !== undefined && typeof options.copy !== 'boolean' ||
      options.expectedFingerprint !== undefined && typeof options.expectedFingerprint !== 'string') throw new Error('Choose a valid move or copy operation.');
  const { source, target, shift } = transferCoordinates(coords, destination);
  if (options.expectedFingerprint !== undefined && cellTransferFingerprint(state, source, destination, options) !== options.expectedFingerprint) {
    throw new Error('These cells or their calendar links changed. Select them again before moving.');
  }
  const scope = transferScope(state, source, target); const { map, ids, membersById, projectionsById } = scope;
  const sourceKeys = new Set(source.map((point) => minuteKey(point.day, point.minute)));
  if (!shift) return { ...applyDocumentValues(state, [], now), destinationCoords: target };
  if (!options.copy) {
    const linked = [...ids].some((id) => (projectionsById.get(id) ?? []).some((doc) => doc.value!.state !== 'deleted')) ||
      source.some((point) => {
        const value = map.get(minuteKey(point.day, point.minute))?.value;
        const label = formatFromDocument(map.get(cellFormatKey(point.day, point.minute))?.value).calendarEvent;
        return value && label?.id === value.blockId;
      });
    if (linked) throw new Error('Move this linked calendar event on your phone. Browser moves will be available after a synchronization update.');
  }
  for (const point of target) {
    const key = minuteKey(point.day, point.minute);
    if (!options.copy && sourceKeys.has(key)) continue;
    if (map.get(key)?.value || !emptyDestinationFormat(map.get(cellFormatKey(point.day, point.minute))?.value)) {
      throw new Error(OCCUPIED_DESTINATION);
    }
  }
  const timestamp = new Date(now).toISOString();
  const changes = new Map<string, DocumentValueChange>();
  const set = (key: string, value: Record<string, unknown> | null) => changes.set(key, { key, value });
  const affectedIds = new Set(ids); const replacementIds = new Map<string, string>();
  const labelFor = (value: Record<string, unknown>) => cellEventLabel(formatFromDocument(map.get(cellFormatKey(String(value.dateKey), Number(value.minuteIndex)))?.value), String(value.blockId));
  for (const id of ids) {
    const all = membersById.get(id)!
      .sort((a, b) => civilMinute({ day: String(a.value!.dateKey), minute: Number(a.value!.minuteIndex) }) -
        civilMinute({ day: String(b.value!.dateKey), minute: Number(b.value!.minuteIndex) }));
    const chosen = all.filter((doc) => sourceKeys.has(doc.key));
    const bordered = chosen.some((doc) => Boolean(labelFor(doc.value!)));
    if ((bordered || isActivityGroupId(id)) && all.length > 1440) throw new Error('Select an activity of at most 24 hours before moving or copying its cells.');
    const complete = !options.copy && all.length <= 1440 && all.every((doc) => sourceKeys.has(doc.key) && Boolean(labelFor(doc.value!))) &&
      (isActivityGroupId(id) || all.every((doc, index) => labelFor(doc.value!)?.title === labelFor(all[0]!.value!)?.title &&
        (!index || civilMinute({ day: String(doc.value!.dateKey), minute: Number(doc.value!.minuteIndex) }) ===
          civilMinute({ day: String(all[index - 1]!.value!.dateKey), minute: Number(all[index - 1]!.value!.minuteIndex) }) + 1)));
    const nextId = complete ? id : freshBlock(bordered || isActivityGroupId(id));
    replacementIds.set(id, nextId); affectedIds.add(nextId);
    if (options.copy || complete || !bordered && !isActivityGroupId(id)) continue;
    const selectedTitles = new Set(chosen.flatMap((doc) => labelFor(doc.value!) ? [labelFor(doc.value!)!.title] : []));
    const remainders = all.filter((doc) => !sourceKeys.has(doc.key) &&
      (isActivityGroupId(id) || selectedTitles.has(labelFor(doc.value!)?.title ?? '')));
    let run: typeof remainders = []; let runIndex = 0;
    const finish = () => {
      if (!run.length) return;
      const remainderId = runIndex++ === 0 ? id : freshBlock(true); affectedIds.add(remainderId);
      if (remainderId !== id) for (const doc of run) {
        set(doc.key, { ...structuredClone(doc.value!), blockId: remainderId, source: 'manual', updatedAt: timestamp });
        const key = cellFormatKey(String(doc.value!.dateKey), Number(doc.value!.minuteIndex));
        set(key, movedFormat(map.get(key)?.value, id, remainderId));
      }
      run = [];
    };
    for (const doc of remainders) {
      const previous = run.at(-1)?.value;
      if (previous && (civilMinute({ day: String(doc.value!.dateKey), minute: Number(doc.value!.minuteIndex) }) !==
          civilMinute({ day: String(previous.dateKey), minute: Number(previous.minuteIndex) }) + 1 ||
          labelFor(doc.value!)?.title !== labelFor(previous)?.title)) finish();
      run.push(doc);
    }
    finish();
  }
  if (!options.copy) for (const point of source) { set(minuteKey(point.day, point.minute), null); set(cellFormatKey(point.day, point.minute), null); }
  for (let index = 0; index < source.length; index++) {
    const from = source[index]!; const to = target[index]!;
    const original = map.get(minuteKey(from.day, from.minute))?.value;
    const format = map.get(cellFormatKey(from.day, from.minute))?.value;
    if (!original) { set(minuteKey(to.day, to.minute), null); set(cellFormatKey(to.day, to.minute), format ? structuredClone(format) : null); continue; }
    const previousId = String(original.blockId); const nextId = replacementIds.get(previousId)!;
    const detached = options.copy || previousId !== nextId;
    set(minuteKey(to.day, to.minute), { ...structuredClone(original), dateKey: to.day, minuteIndex: to.minute,
      blockId: nextId, updatedAt: timestamp, ...(detached ? { source: 'manual' } : {}), ...(options.copy ? {
        id: `browser_${crypto.randomUUID().replaceAll('-', '')}`, createdAt: timestamp,
      } : {}) });
    set(cellFormatKey(to.day, to.minute), movedFormat(format, previousId, nextId));
  }
  const result = applyDocumentValues(state, [...changes.values()], now);
  guardTransferUndo(result, scope, affectedIds);
  return { ...result, destinationCoords: target };
}

function guardTransferUndo(result: { state: BrowserLedgerState; undo: UndoEdit }, scope: ReturnType<typeof transferScope>, affectedIds: Set<string>) {
  const finalMap = new Map(result.state.documents.map((doc) => [doc.key, doc]));
  const finalMembers = new Map<string, { key: string; revision: string }[]>();
  const finalProjections = new Map<string, { key: string; revision: string }[]>();
  for (const doc of result.state.documents) if (doc.value && affectedIds.has(String(doc.value.blockId))) {
    const groups = doc.key.startsWith('minute:') ? finalMembers : doc.key.startsWith('projection:') ? finalProjections : null;
    if (groups) { const id = String(doc.value.blockId); const rows = groups.get(id) ?? []; rows.push({ key: doc.key, revision: doc.revision }); groups.set(id, rows); }
  }
  result.undo.documentGuards = scope.keys.map((key) => ({ key, revision: finalMap.get(key)?.revision ?? null }));
  result.undo.blockGuards = [...affectedIds].map((blockId) => ({ blockId, members: (finalMembers.get(blockId) ?? []).sort((a, b) => a.key.localeCompare(b.key)) }));
  result.undo.projectionGuards = [...affectedIds].map((blockId) => ({ blockId, documents: (finalProjections.get(blockId) ?? []).sort((a, b) => a.key.localeCompare(b.key)) }));
}

export type ClipboardTransferOptions = { copy: boolean; expectedSourceFingerprint?: string; expectedFingerprint?: string };
function clipboardCoordinates(coords: readonly FormatCoordinate[], destinations: readonly FormatCoordinate[], copy: boolean) {
  const { source } = transferCoordinates(coords, coords[0]!);
  const orderedDestinations = transferCoordinates(destinations, destinations[0]!).source;
  const repeated = copy && source.length === 1 && orderedDestinations.length > 1;
  const target = repeated ? orderedDestinations : transferCoordinates(source, orderedDestinations[0]!).target;
  return { source, target, repeated };
}

export function clipboardTransferFingerprint(state: BrowserLedgerState, coords: readonly FormatCoordinate[],
  destinations: readonly FormatCoordinate[], options: Pick<ClipboardTransferOptions, 'copy'>) {
  const { source, target } = clipboardCoordinates(coords, destinations, options.copy);
  const scope = transferScope(state, source, target);
  return hashValue({ copy: options.copy === true, source, target,
    documents: scope.keys.map((key) => [key, scope.map.get(key)?.revision ?? null]) });
}

/** A copied single cell can fill a destination selection. Cut and multi-cell
 * sources translate once; all repetitions share one command and guarded Undo. */
export function transferClipboardCells(state: BrowserLedgerState, coords: readonly FormatCoordinate[], destinations: readonly FormatCoordinate[],
  options: ClipboardTransferOptions, now = Date.now()): { state: BrowserLedgerState; undo: UndoEdit; destinationCoords: FormatCoordinate[] } {
  if (!object(options) || typeof options.copy !== 'boolean' ||
      Object.keys(options).some((key) => !['copy', 'expectedSourceFingerprint', 'expectedFingerprint'].includes(key)) ||
      options.expectedSourceFingerprint !== undefined && typeof options.expectedSourceFingerprint !== 'string' ||
      options.expectedFingerprint !== undefined && typeof options.expectedFingerprint !== 'string') throw new Error('Choose a valid clipboard operation.');
  const { source, target, repeated } = clipboardCoordinates(coords, destinations, options.copy);
  if (options.expectedSourceFingerprint !== undefined &&
      cellTransferFingerprint(state, source, source[0]!, { copy: false }) !== options.expectedSourceFingerprint) {
    throw new Error('The copied or cut cells changed. Copy or cut them again before pasting.');
  }
  if (options.expectedFingerprint !== undefined && clipboardTransferFingerprint(state, source, destinations, options) !== options.expectedFingerprint) {
    throw new Error('These cells or their calendar links changed. Select them again before pasting.');
  }
  if (!repeated) return transferCells(state, source, target[0]!, { copy: options.copy }, now);
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('Use a valid edit time.');
  const scope = transferScope(state, source, target); const from = source[0]!;
  const sourceKey = minuteKey(from.day, from.minute); const original = scope.map.get(sourceKey)?.value;
  const format = scope.map.get(cellFormatKey(from.day, from.minute))?.value;
  for (const point of target) {
    if (minuteKey(point.day, point.minute) === sourceKey) continue;
    if (scope.map.get(minuteKey(point.day, point.minute))?.value || !emptyDestinationFormat(scope.map.get(cellFormatKey(point.day, point.minute))?.value)) {
      throw new Error(OCCUPIED_DESTINATION);
    }
  }
  const changes: DocumentValueChange[] = []; const affectedIds = new Set(scope.ids); const timestamp = new Date(now).toISOString();
  for (const point of target) {
    const key = minuteKey(point.day, point.minute); if (key === sourceKey) continue;
    if (!original) {
      changes.push({ key, value: null }, { key: cellFormatKey(point.day, point.minute), value: format ? structuredClone(format) : null });
      continue;
    }
    const previousId = String(original.blockId);
    const bordered = Boolean(cellEventLabel(formatFromDocument(format), previousId));
    const blockId = freshBlock(bordered || isActivityGroupId(previousId)); affectedIds.add(blockId);
    changes.push({ key, value: { ...structuredClone(original), id: `browser_${crypto.randomUUID().replaceAll('-', '')}`,
      dateKey: point.day, minuteIndex: point.minute, blockId, source: 'manual', createdAt: timestamp, updatedAt: timestamp } },
    { key: cellFormatKey(point.day, point.minute), value: movedFormat(format, previousId, blockId) });
  }
  const result = applyDocumentValues(state, changes, now); guardTransferUndo(result, scope, affectedIds);
  return { ...result, destinationCoords: target };
}
