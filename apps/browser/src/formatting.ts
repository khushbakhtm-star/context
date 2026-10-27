import { hashValue, validateBatch } from '../shared/sync/codec';
import { cellFormatKey, formatFromDocument, isActivityGroupId } from '../shared/utils/cell-format';
import { applyDocumentValues, minuteKey, type BrowserLedgerState, type DocumentValueChange, type UndoEdit } from './ledger';

export type FormatCoordinate = { day: string; minute: number };
export type BrowserFill = { categoryId?: string; color: string; name?: string; providerColorId?: string; accountId?: string };
export type BrowserFormatPatch = { bold?: boolean; italic?: boolean; underline?: boolean; textColor?: string | null; fill?: BrowserFill | null };
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
        const keep = String(minute.text ?? '').trim().length > 0 || isActivityGroupId(minute.blockId);
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

/** A deliberate Group creates only local ledger membership; the phone remains
 * responsible for any separately authorized calendar projection. */
export function groupSelection(state: BrowserLedgerState, coords: readonly FormatCoordinate[], input: { title: string; fill?: BrowserFill },
  allowedColors: readonly string[], now = Date.now()): { state: BrowserLedgerState; undo: UndoEdit } {
  const selected = consecutiveSelection(coords);
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200 ||
      !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('Enter an activity title of up to 200 characters.');
  const map = new Map(state.documents.map((doc) => [doc.key, doc]));
  for (const coordinate of selected) {
    const minute = map.get(minuteKey(coordinate.day, coordinate.minute))?.value;
    const format = formatFromDocument(map.get(cellFormatKey(coordinate.day, coordinate.minute))?.value);
    if (isActivityGroupId(minute?.blockId) || format.activityGroup) throw new Error('Ungroup the whole existing activity before grouping these minutes.');
  }
  const fill = input.fill ? categoryForFill(state, input.fill, allowedColors, now) : null;
  const first = selected[0]!; const firstMinute = map.get(minuteKey(first.day, first.minute))?.value;
  const categoryId = fill?.id ?? (typeof firstMinute?.categoryId === 'string' ? firstMinute.categoryId : 'unaccounted');
  const id = `activity_${crypto.randomUUID().replaceAll('-', '')}`; const title = input.title.trim(); const timestamp = new Date(now).toISOString();
  const changes: DocumentValueChange[] = fill?.change ? [fill.change] : [];
  for (const coordinate of selected) {
    const key = minuteKey(coordinate.day, coordinate.minute); const minute = map.get(key)?.value;
    const formatKey = cellFormatKey(coordinate.day, coordinate.minute); const existing = map.get(formatKey)?.value;
    changes.push({ key, value: minute ? { ...structuredClone(minute), blockId: id, categoryId, updatedAt: timestamp } : {
      id: `browser_${crypto.randomUUID().replaceAll('-', '')}`, dateKey: coordinate.day, minuteIndex: coordinate.minute,
      text: '', categoryId, blockId: id, source: 'manual', createdAt: timestamp, updatedAt: timestamp,
    } });
    const format = formatEnvelope(existing); delete format.noFill; format.activityGroup = { id, title };
    changes.push({ key: formatKey, value: formatValue(existing, format) });
  }
  return applyDocumentValues(state, changes, now);
}

/** Partial calendar-group detachment needs the phone's split/relink workflow.
 * The browser safely supports only complete locally visible group membership. */
export function ungroupSelection(state: BrowserLedgerState, coords: readonly FormatCoordinate[], now = Date.now()):
  { state: BrowserLedgerState; undo: UndoEdit } {
  const selected = consecutiveSelection(coords); const selectedKeys = new Set(selected.map((coordinate) => minuteKey(coordinate.day, coordinate.minute)));
  const map = new Map(state.documents.map((doc) => [doc.key, doc])); const groups = new Set<string>();
  for (const coordinate of selected) {
    const minute = map.get(minuteKey(coordinate.day, coordinate.minute))?.value;
    const label = formatFromDocument(map.get(cellFormatKey(coordinate.day, coordinate.minute))?.value).activityGroup;
    if (isActivityGroupId(minute?.blockId)) groups.add(minute.blockId);
    if (label) groups.add(label.id);
  }
  if (!groups.size) return applyDocumentValues(state, [], now);
  for (const doc of state.documents) {
    if (doc.key.startsWith('minute:') && doc.value && groups.has(String(doc.value.blockId)) && !selectedKeys.has(doc.key)) {
      throw new Error('Select the whole activity before ungrouping it.');
    }
    const label = formatFromDocument(doc.value).activityGroup;
    if (doc.key.startsWith('category:minuteFormat:') && label && groups.has(label.id)) {
      const coordinateKey = doc.key.replace('category:minuteFormat:', 'minute:');
      if (!selectedKeys.has(coordinateKey)) throw new Error('Select the whole activity before ungrouping it.');
    }
  }
  const timestamp = new Date(now).toISOString(); const changes: DocumentValueChange[] = [];
  for (const coordinate of selected) {
    const key = minuteKey(coordinate.day, coordinate.minute); const minute = map.get(key)?.value;
    const formatKey = cellFormatKey(coordinate.day, coordinate.minute); const existing = map.get(formatKey)?.value;
    const label = formatFromDocument(existing).activityGroup;
    if (minute && groups.has(String(minute.blockId))) changes.push({ key,
      value: { ...structuredClone(minute), blockId: `browser_${crypto.randomUUID().replaceAll('-', '')}`, updatedAt: timestamp } });
    if (label && groups.has(label.id)) {
      const format = formatEnvelope(existing); delete format.activityGroup;
      changes.push({ key: formatKey, value: formatValue(existing, format) });
    }
  }
  return applyDocumentValues(state, changes, now);
}
