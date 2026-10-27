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

function consecutiveSelection(coords: readonly FormatCoordinate[]) {
  if (!Array.isArray(coords) || !coords.length || coords.length > 1440) throw new Error('Select consecutive minutes within one day.');
  const selected = coords.map((coordinate) => ({ ...coordinate })).sort((left, right) => left.minute - right.minute);
  for (let index = 0; index < selected.length; index++) {
    const coordinate = selected[index]!;
    validateBatch({ version: 1, id: 'browser_group_coordinate', documents: [{ key: minuteKey(coordinate.day, coordinate.minute),
      revision: '0000000000000000:00000000:browser_validation', value: null }] });
    if (coordinate.day !== selected[0]!.day || index && coordinate.minute !== selected[index - 1]!.minute + 1) {
      throw new Error('Select consecutive minutes within one day.');
    }
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
