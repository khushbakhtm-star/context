import { dateKey, addDays, minuteLabel, parseDateKey, startOfWeek } from '../shared/utils/time';
import { cellEventLabel, formatFromDocument, cellFormatKey } from '../shared/utils/cell-format';
import { calendarCellColor } from '../shared/utils/calendar-cell-color';
import { BrowserStore } from './store';
import { GoogleConnection, type BrowserPlan } from './google';
import { editCells, getMinute, minuteKey, pastedChanges, undoEdit, type CellChange, type UndoEdit } from './ledger';
import { flushBrowserText } from './editor';
import { serializeSpreadsheetCells } from '../shared/utils/spreadsheet-paste';
import { eventSelectionFingerprint, formatCells, groupSelection, ungroupSelection, resetCellsSelection,
  contiguousMinuteSpan, cellTransferDestination, cellTransferFingerprint, transferCells,
  clipboardTransferFingerprint, transferClipboardCells,
  GOOGLE_ACTIVITY_COLORS, type BrowserFormatPatch, type BrowserFill } from './formatting';
import { minuteCellPresentation } from './cell-presentation';
import { effectiveTextColor } from './text-color';
import { bindComposerViewport } from './composer-viewport';
import { bindMouseSelection, type GridPoint } from './mouse-selection';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const main = element('main'), grid = element('grid'), options = element<HTMLDialogElement>('options');
const dayInput = element<HTMLInputElement>('day'), daysInput = element<HTMLSelectElement>('days');
const passInput = element<HTMLInputElement>('passphrase');
let lastStatus = 'Connect Google and unlock the same private ledger you use on your phone.';
const status = (message: string, error = false) => { lastStatus = message; element('status').textContent = message; element('status').dataset.error = String(error); element('sync-warning').hidden = !error; element('sync').title = `${message} Hold or press Shift+F10 for details.`; element('sync').setAttribute('aria-label', error ? 'Synchronization needs attention. Activate to retry; hold for details.' : 'Synchronize private ledger. Hold for details.'); };
const info = (title: string, text: string) => { element('info-title').textContent = title; element('info-text').textContent = text; element<HTMLDialogElement>('info-dialog').showModal(); };
let connection: GoogleConnection; let store: BrowserStore | null = null; let passphrase = ''; let busy = false;
let unlockRequest = 0;
let day = dateKey(new Date()); let days = 1; let clock12 = true; let plans: BrowserPlan[] = [];
let calendars: { id: string; title: string; color: string; primary: boolean }[] = []; let selectedCalendars = new Set<string>();
let selected = { day, minute: new Date().getHours() * 60 + new Date().getMinutes() }; let undo: UndoEdit | null = null;
let editor: { input: HTMLTextAreaElement; day: string; minute: number; revision: string | undefined; original: string; saving: Promise<void> | null } | null = null;
let entryBarMode: 'entry' | 'format' | null = null;
let commandBusy = false;
let cellHoldTimer: ReturnType<typeof setTimeout> | undefined; let cellHeld = false;
const entryInput = element<HTMLTextAreaElement>('minute-entry');
const composerViewport = bindComposerViewport(window, main, [element('entry-bar')]);
let liveFillColors: { color: string; providerColorId: string }[] = [];
let groupSelectionStamp: string | null = null;
let groupSelectionRevision: string | null = null;
let groupCoordinates: GridPoint[] = [];
let groupRangeConfirmed = true;
let groupFillOptions: BrowserFill[] = [];
let viewGeneration = 0; let drag: { day: string; minute: number } | null = null; let rangeEnd: { day: string; minute: number } | null = null;
let firstRendered = -1;
let moveDraft: { store: BrowserStore; coords: GridPoint[]; grabbed: GridPoint; origin: GridPoint; fingerprint: string; stamp: string } | null = null;
let movePreview: GridPoint[] = [];
type CellClipboard = { store: BrowserStore; coords: GridPoint[]; origin: GridPoint; fingerprint: string; text: string; cut: boolean };
let cellClipboard: CellClipboard | null = null;
const settings = { appearance: 'system', clock: '12' };
function report(error: unknown) { status(error instanceof Error ? error.message : 'The action could not finish. Your saved notes remain available.', true); }
function selectionCells(): { day: string; minute: number }[] {
  const end = rangeEnd ?? selected; const startDay = [selected.day, end.day].sort()[0]!; const lastDay = [selected.day, end.day].sort()[1]!;
  const first = Math.min(selected.minute, end.minute), last = Math.max(selected.minute, end.minute);
  const result: { day: string; minute: number }[] = [];
  for (let i = 0; i < 31; i++) { const date = dateKey(addDays(startDay, i)); if (date > lastDay) break;
    for (let minute = first; minute <= last; minute++) result.push({ day: date, minute }); }
  if (result.length > 10_000 || !result.length || result.at(-1)!.day !== lastDay) throw new Error('Select at most10,000 cells within31days.');
  return result;
}
function selectionStamp() { return `${selected.day}:${selected.minute}:${rangeEnd?.day ?? ''}:${rangeEnd?.minute ?? ''}`; }
function isInSelection(date: string, minute: number) { const end = rangeEnd ?? selected; return date >= [selected.day, end.day].sort()[0]! && date <= [selected.day, end.day].sort()[1]! && minute >= Math.min(selected.minute, end.minute) && minute <= Math.max(selected.minute, end.minute); }
function updateBars() {
  element('entry-bar').hidden = !store || entryBarMode !== 'entry'; element('cell-format-menu').hidden = !store || entryBarMode !== 'format';
  document.body.classList.toggle('has-entry-bar', Boolean(store && entryBarMode === 'entry'));
  composerViewport.refresh();
  for (const id of ['save-text', 'format-bold', 'format-italic', 'format-underline', 'format-text-color', 'format-fill', 'finish-format']) element<HTMLButtonElement>(id).disabled = commandBusy;
  if (!store || entryBarMode !== 'format') return;
  const map = new Map(store.state.documents.map((doc) => [doc.key, doc])); let coords;
  try { coords = selectionCells(); } catch { return; }
  const formats = coords.map((point) => formatFromDocument(map.get(cellFormatKey(point.day, point.minute))?.value));
  for (const key of ['bold', 'italic', 'underline'] as const) element(`format-${key}`).setAttribute('aria-pressed', String(formats.every((format) => format[key] === true)));
  const first = formats[0]; const selectedNode = cell(coords[0]!.day, coords[0]!.minute);
  const color = effectiveTextColor(first?.textColor, getComputedStyle(selectedNode ?? document.body).color);
  element('format-text-color').style.color = color; element<HTMLInputElement>('text-color').value = color;
  const firstEntry = map.get(minuteKey(coords[0]!.day, coords[0]!.minute))?.value; const category = firstEntry ? map.get(`category:${firstEntry.categoryId}`)?.value : null;
  element('fill-mark').style.backgroundColor = first?.noFill ? 'transparent' : typeof category?.color === 'string' && /^#[0-9a-f]{6}$/i.test(category.color) ? category.color : 'transparent';
}
function mirrorDraft() {
  if (!editor) return; const node = cell(editor.day, editor.minute);
  if (node) { setCellNote(node, editor.input.value); node.classList.remove('planned'); node.setAttribute('aria-label', `${editor.day}, ${minuteLabel(editor.minute, clock12)}, ${editor.input.value}`); }
}
function setCellNote(node: HTMLElement, text: string) {
  const note = node.querySelector<HTMLElement>('.cell-note');
  if (note) note.textContent = text; else node.textContent = text;
}
function openGroup() {
  if (!store) return;
  const coords = selectionCells(); groupSelectionStamp = selectionStamp();
  groupCoordinates = coords; groupSelectionRevision = eventSelectionFingerprint(store.state, coords);
  const first = coords[0]!, last = coords.at(-1)!;
  const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  element<HTMLInputElement>('group-from-date').value = first.day; element<HTMLInputElement>('group-from-time').value = time(first.minute);
  element<HTMLInputElement>('group-through-date').value = last.day; element<HTMLInputElement>('group-through-time').value = time(last.minute);
  groupRangeConfirmed = first.day === last.day;
  element('group-range-error').textContent = groupRangeConfirmed ? '' : 'Choose From and Through for one consecutive activity, including overnight. Through includes the whole minute.';
  const entry = getMinute(store.state, selected.day, selected.minute)?.value;
  const format = formatFromDocument(store.state.documents.find((doc) => doc.key === cellFormatKey(selected.day, selected.minute))?.value);
  element<HTMLInputElement>('group-title').value = cellEventLabel(format, String(entry?.blockId ?? ''))?.title ?? String(entry?.text ?? '').slice(0, 200);
  groupFillOptions = [...importedFillOptions(), ...liveFillColors, ...GOOGLE_ACTIVITY_COLORS.map((color) => ({ color, name: color }))];
  const colors = element<HTMLSelectElement>('group-color'); colors.replaceChildren();
  groupFillOptions.forEach((fill, index) => { const option = document.createElement('option'); option.value = String(index);
    option.textContent = fill.name ?? fill.color; colors.append(option); });
  const current = groupFillOptions.findIndex((fill) => fill.categoryId === entry?.categoryId);
  colors.value = String(current >= 0 ? current : Math.max(0, groupFillOptions.findIndex((fill) => fill.color === '#5A6986')));
  element<HTMLDialogElement>('group-dialog').showModal();
}
function readGroupRange() {
  const point = (prefix: string): GridPoint => {
    const time = element<HTMLInputElement>(`${prefix}-time`).value;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Choose a valid time for both endpoints.');
    return { day: element<HTMLInputElement>(`${prefix}-date`).value, minute: Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) };
  };
  return contiguousMinuteSpan(point('group-from'), point('group-through'));
}
function changeGroupRange() {
  if (!store) return;
  try { groupCoordinates = readGroupRange(); groupRangeConfirmed = true;
    groupSelectionRevision = eventSelectionFingerprint(store.state, groupCoordinates); element('group-range-error').textContent = ''; }
  catch (error) { groupRangeConfirmed = false; element('group-range-error').textContent = error instanceof Error ? error.message : 'Choose a valid activity range.'; }
}
function closeCellMenu() { element('cell-menu').hidden = true; }
function showCellFormatting(x: number, y: number) {
  if (!store) return; entryBarMode = 'format'; updateBars(); const popup = element('cell-format-menu');
  popup.style.left = `${Math.max(6, Math.min(x, innerWidth - popup.offsetWidth - 6))}px`;
  popup.style.top = `${Math.max(6, Math.min(y, innerHeight - popup.offsetHeight - 6))}px`;
}
async function cellCommand(work: () => Promise<void>) {
  if (commandBusy) return; commandBusy = true; updateBars();
  try { await work(); closeCellMenu(); }
  catch (error) { report(error); }
  finally { commandBusy = false; updateBars(); }
}
async function writeSelectedText(changes: CellChange[], source?: { stamp: string; expected: Map<string, string | undefined> }) {
  if (!store) throw new Error('Unlock your ledger first.'); const active = store; const stamp = source?.stamp ?? selectionStamp();
  const expected = source?.expected ?? new Map(changes.map((point) => [minuteKey(point.day, point.minute), getMinute(active.state, point.day, point.minute)?.revision]));
  let result: ReturnType<typeof editCells> | undefined;
  await active.update((state) => { if (store !== active || selectionStamp() !== stamp) throw new Error('The selection changed. Try again.');
    for (const point of changes) if (getMinute(state, point.day, point.minute)?.revision !== expected.get(minuteKey(point.day, point.minute))) throw new Error('These cells changed. Select them again and retry.');
    result = editCells(state, changes); return result.state; });
  if (result!.undo.after.length) undo = result!.undo; render(); void synchronize(false);
}
async function showCellMenu(x: number, y: number) {
  if (!store || commandBusy) return; const stamp = selectionStamp(); await saveEditor(); if (!store || selectionStamp() !== stamp) return;
  entryBarMode = null; updateBars(); const menu = element('cell-menu'); menu.replaceChildren();
  const active = store; const coords = selectionCells(); const documents = new Map(store.state.documents.map((doc) => [doc.key, doc]));
  const menuRevision = eventSelectionFingerprint(active.state, coords), origin = coords[0]!;
  const clipboardRevision = cellTransferFingerprint(active.state, coords, origin);
  const textValues = coords.map((point) => String(documents.get(minuteKey(point.day, point.minute))?.value?.text ?? ''));
  const source = { stamp, expected: new Map(coords.map((point) => [minuteKey(point.day, point.minute), documents.get(minuteKey(point.day, point.minute))?.revision])) };
  const copiedText = new Map(coords.map((point, index) => [minuteKey(point.day, point.minute), textValues[index]!]));
  const distinct = [...new Set(textValues.filter((text) => text.length))];
  const add = (label: string, action: () => Promise<void>) => { const button = document.createElement('button'); button.textContent = label; button.setAttribute('role', 'menuitem'); button.onclick = () => { void cellCommand(action); }; menu.append(button); return button; };
  const copy = async (cut = false) => { const first = Math.min(...coords.map((point) => point.minute)), last = Math.max(...coords.map((point) => point.minute)); const days = [...new Set(coords.map((point) => point.day))];
    const matrix = Array.from({ length: last - first + 1 }, (_, r) => days.map((date) => copiedText.get(minuteKey(date, first + r)) ?? ''));
    if (!navigator.clipboard?.writeText) throw new Error('Use the browser’s Copy command or keyboard shortcut.'); const text = serializeSpreadsheetCells(matrix);
    await navigator.clipboard.writeText(text);
    if (store !== active || selectionStamp() !== stamp || cellTransferFingerprint(active.state, coords, origin) !== clipboardRevision) throw new Error('The source cells changed. Copy or Cut them again.');
    cellClipboard = { store: active, coords: coords.map((point) => ({ ...point })), origin: { ...origin }, fingerprint: clipboardRevision, text, cut }; };
  add('Cut', () => copy(true));
  add('Copy', () => copy(false));
  add('Paste', async () => { if (!navigator.clipboard?.readText) throw new Error('Select the destination and use Ctrl+V or⌘V.'); const text = await navigator.clipboard.readText(); if (selectionStamp() !== stamp) throw new Error('The selection changed. Paste again.'); await paste(text); });
  if (distinct.length) add('Clear', () => writeSelectedText(coords.map((point) => ({ ...point, text: '' })), source));
  if (coords.length > 1 && distinct.length === 1) add('AutoFill', () => writeSelectedText(coords.map((point) => ({ ...point, text: distinct[0]! })), source));
  const sameDay = coords.every((point) => point.day === coords[0]!.day);
  const hasGroup = coords.some((point) => {
    const minute = documents.get(minuteKey(point.day, point.minute))?.value;
    return /^activity_[A-Za-z0-9_-]+$/.test(String(minute?.blockId ?? '')) || Boolean(cellEventLabel(formatFromDocument(documents.get(cellFormatKey(point.day, point.minute))?.value), String(minute?.blockId ?? '')));
  });
  add('Group', async () => { openGroup(); });
  const menuMutation = async (make: Parameters<typeof mutateSelection>[0]) => {
    if (store !== active || selectionStamp() !== stamp || eventSelectionFingerprint(active.state, coords) !== menuRevision) throw new Error('These cells changed. Select them again before changing their event or formatting.');
    await mutateSelection(make, coords);
  };
  if (sameDay && hasGroup) add('Ungroup', () => menuMutation((state, points) => ungroupSelection(state, points)));
  const resettable = coords.some((point) => {
    const minute = documents.get(minuteKey(point.day, point.minute))?.value;
    const format = formatFromDocument(documents.get(cellFormatKey(point.day, point.minute))?.value);
    return Boolean(String(minute?.text ?? '').length || minute && !format.noFill ||
      Object.keys(format).some((key) => key !== 'noFill') || !format.noFill && planForMinute(point.day, point.minute));
  });
  if (sameDay && resettable) add('Reset cells', () => menuMutation((state, points) => resetCellsSelection(state, points)));
  const formatButton = add('Format cells', async () => { showCellFormatting(x, y); }); formatButton.setAttribute('aria-label', 'Format cells'); formatButton.title = 'Format cells';
  const mark = document.createElement('span'); mark.className = 'format-trigger'; mark.textContent = 'A'; mark.setAttribute('aria-hidden', 'true'); formatButton.replaceChildren(mark);
  menu.hidden = false; menu.style.left = `${Math.max(6, Math.min(x, innerWidth - menu.offsetWidth - 6))}px`; menu.style.top = `${Math.max(6, Math.min(y, innerHeight - menu.offsetHeight - 6))}px`;
}
async function mutateSelection(make: (state: BrowserStore['state'], coords: { day: string; minute: number }[]) => { state: BrowserStore['state']; undo: UndoEdit }, coordinates = selectionCells()) {
  if (!store) throw new Error('Unlock your ledger first.'); const active = store; const stamp = selectionStamp(); const coords = coordinates;
  const eventRevision = eventSelectionFingerprint(active.state, coords);
  const expected = new Map(coords.flatMap((point) => [minuteKey(point.day, point.minute), cellFormatKey(point.day, point.minute)]).map((key) => [key, active.state.documents.find((doc) => doc.key === key)?.revision]));
  let result: ReturnType<typeof make> | undefined;
  await active.update((state) => { if (store !== active || selectionStamp() !== stamp) throw new Error('The selection changed. Try again.');
    if (eventSelectionFingerprint(state, coords) !== eventRevision) throw new Error('This activity changed. Select its cells again.');
    const map = new Map(state.documents.map((doc) => [doc.key, doc.revision])); for (const [key, revision] of expected) if (map.get(key) !== revision) throw new Error('These cells changed. Select them again.');
    result = make(state, coords); return result.state; });
  if (result!.undo.after.length) undo = result!.undo; render(); void synchronize(false);
}
function importedFillOptions() {
  if (!store) return [] as { categoryId: string; color: string; name: string; providerColorId?: string; accountId?: string }[];
  return store.state.documents.flatMap((doc) => {
    const value = doc.value; if (!doc.key.startsWith('category:') || doc.key.startsWith('category:minuteFormat:') || !value || typeof value.id !== 'string' || typeof value.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.color)) return [];
    const exact = value.color.toUpperCase(); const fallbackId = /^google_palette_([a-f0-9]{6})$/.exec(value.id);
    const google = value.provider === 'google' && typeof value.accountId === 'string' &&
      (value.googleColorVerified === true || typeof value.providerColorId === 'string' || typeof value.providerLabelId === 'string') &&
      (value.providerOriginalColor === undefined || value.providerOriginalColor === value.color);
    if (!(google || fallbackId && exact === `#${fallbackId[1]!.toUpperCase()}`)) return [];
    return [{ categoryId: value.id, color: exact, name: typeof value.name === 'string' ? value.name : exact,
      ...(typeof value.providerColorId === 'string' ? { providerColorId: value.providerColorId } : {}),
      ...(typeof value.accountId === 'string' ? { accountId: value.accountId } : {}) }];
  });
}
async function formatSelection(patch: BrowserFormatPatch) {
  if (!store || entryBarMode !== 'format') return; const active = store; const stamp = selectionStamp(); const coords = selectionCells();
  const expected = new Map(coords.flatMap((point) => [minuteKey(point.day, point.minute), cellFormatKey(point.day, point.minute)]).map((key) => [key, active.state.documents.find((doc) => doc.key === key)?.revision]));
  const allowed = [...GOOGLE_ACTIVITY_COLORS, ...importedFillOptions().map((value) => value.color), ...liveFillColors.map((value) => value.color)]; let result: ReturnType<typeof formatCells> | undefined;
  await active.update((state) => {
    if (store !== active || selectionStamp() !== stamp || entryBarMode !== 'format') throw new Error('The selection changed. Choose the format again.');
    const map = new Map(state.documents.map((doc) => [doc.key, doc.revision]));
    for (const [key, revision] of expected) if (map.get(key) !== revision) throw new Error('These cells changed. Select them again before formatting.');
    result = formatCells(state, coords, patch, allowed); return result.state;
  });
  if (result!.undo.after.length) undo = result!.undo; render(); void synchronize(false);
}
function toggleFormat(key: 'bold' | 'italic' | 'underline') {
  if (!store) return; const all = selectionCells().every((point) => formatFromDocument(store!.state.documents.find((doc) => doc.key === cellFormatKey(point.day, point.minute))?.value)[key] === true);
  void cellCommand(() => formatSelection({ [key]: !all }));
}
function showFillOptions() {
  if (!store || entryBarMode !== 'format') return; const list = element('fill-colors'); list.replaceChildren();
  const imported = importedFillOptions(); const options = [...imported, ...liveFillColors.map((value) => ({ ...value, name: value.color, accountId: `google:${connection.identity?.subject ?? ''}` }))];
  const seen = new Set<string>();
  for (const option of options) { if (seen.has(option.color)) continue; seen.add(option.color); const button = document.createElement('button'); button.style.backgroundColor = option.color;
    button.setAttribute('aria-label', `Use fill ${option.name}, ${option.color}`); button.title = `${option.name} ${option.color}`;
    button.onclick = () => { void cellCommand(async () => { await formatSelection({ fill: option }); element<HTMLDialogElement>('fill-dialog').close(); }); }; list.append(button); }
  element('load-fill-colors').hidden = liveFillColors.length > 0; const dialog = element<HTMLDialogElement>('fill-dialog'); if (!dialog.open) dialog.showModal();
}
function dates() {
  const first = days === 7 ? startOfWeek(parseDateKey(day)) : day;
  return Array.from({ length: days }, (_, index) => dateKey(addDays(first, index)));
}
function planForMinute(date: string, minute: number) {
  const instant = new Date(`${date}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`);
  return plans.find((event) => !event.allDay && instant >= new Date(event.start) && instant < new Date(event.end));
}
function cell(day: string, minute: number) { return grid.querySelector<HTMLElement>(`[data-day="${day}"][data-minute="${minute}"]`); }
function updateHeader() {
  const now = new Date(); element('month').textContent = now.toLocaleDateString(undefined, { month: 'short' }); element('date').textContent = String(now.getDate());
  dayInput.value = day; daysInput.value = String(days); element<HTMLButtonElement>('undo').disabled = !undo || !store;
  element('identity').textContent = connection?.identity?.email ?? 'No Google account connected';
  element<HTMLButtonElement>('unlock').disabled = !connection?.isAuthorized() || busy;
}
function select(target: { day: string; minute: number }, extend = false) {
  if (!extend) { selected = target; rangeEnd = null; } else rangeEnd = target;
  paintSelection(); updateBars();
}
function paintSelection() {
  const end = rangeEnd ?? selected; const startDay = [selected.day, end.day].sort()[0]!; const endDay = [selected.day, end.day].sort()[1]!;
  const first = Math.min(selected.minute, end.minute), last = Math.max(selected.minute, end.minute);
  const preview = new Set(movePreview.map((point) => minuteKey(point.day, point.minute)));
  for (const node of grid.querySelectorAll<HTMLElement>('.cell')) {
    const active = node.dataset.day! >= startDay && node.dataset.day! <= endDay && Number(node.dataset.minute) >= first && Number(node.dataset.minute) <= last;
    node.classList.toggle('selected', active); node.setAttribute('aria-selected', String(active));
    node.classList.toggle('selection-top', active && Number(node.dataset.minute) === first);
    node.classList.toggle('selection-bottom', active && Number(node.dataset.minute) === last);
    node.classList.toggle('selection-left', active && node.dataset.day === startDay);
    node.classList.toggle('selection-right', active && node.dataset.day === endDay);
    node.classList.toggle('move-target', preview.has(minuteKey(node.dataset.day!, Number(node.dataset.minute))));
  }
}
function selectedBorder(target: EventTarget | null, x: number, y: number) {
  if (editor || !(target instanceof Element)) return false;
  const node = target.closest<HTMLElement>('.cell.selected'); if (!node) return false;
  const rect = node.getBoundingClientRect(), edge = 5;
  return node.classList.contains('selection-left') && x - rect.left <= edge || node.classList.contains('selection-right') && rect.right - x <= edge ||
    node.classList.contains('selection-top') && y - rect.top <= edge || node.classList.contains('selection-bottom') && rect.bottom - y <= edge;
}
function clearMovePreview() { moveDraft = null; movePreview = []; grid.classList.remove('moving-cells'); paintSelection(); }
function previewMove(point: GridPoint) {
  if (!moveDraft) return;
  try {
    const destination = cellTransferDestination(moveDraft.coords, moveDraft.grabbed, point);
    const first = Date.parse(`${moveDraft.origin.day}T00:00:00Z`) / 60_000 + moveDraft.origin.minute;
    const shift = Date.parse(`${destination.day}T00:00:00Z`) / 60_000 + destination.minute - first;
    movePreview = moveDraft.coords.map((source) => {
      const instant = new Date(Date.parse(`${source.day}T00:00:00Z`) + (source.minute + shift) * 60_000);
      return { day: instant.toISOString().slice(0, 10), minute: instant.getUTCHours() * 60 + instant.getUTCMinutes() };
    }); grid.classList.add('moving-cells'); paintSelection();
  } catch { movePreview = []; paintSelection(); }
}
async function completeMove(point: GridPoint, copy: boolean) {
  const draft = moveDraft; clearMovePreview(); if (!draft) return;
  await cellCommand(async () => { try {
    if (store !== draft.store || selectionStamp() !== draft.stamp || cellTransferFingerprint(draft.store.state, draft.coords, draft.origin) !== draft.fingerprint) throw new Error('The selected cells changed. Select them again before moving.');
    const destination = cellTransferDestination(draft.coords, draft.grabbed, point);
    const fingerprint = cellTransferFingerprint(draft.store.state, draft.coords, destination, { copy });
    let result: ReturnType<typeof transferCells> | undefined;
    await draft.store.update((state) => {
      if (store !== draft.store || selectionStamp() !== draft.stamp) throw new Error('The selection changed. Try moving again.');
      result = transferCells(state, draft.coords, destination, { copy, expectedFingerprint: fingerprint }); return result.state;
    });
    if (result!.undo.after.length) undo = result!.undo;
    const target = result!.destinationCoords; selected = { ...target[0]! }; rangeEnd = null;
    const uniqueDays = new Set(target.map((value) => value.day)), uniqueMinutes = new Set(target.map((value) => value.minute));
    if (target.length > 1 && uniqueDays.size * uniqueMinutes.size === target.length) rangeEnd = { ...target.at(-1)! };
    entryBarMode = null; render(); void synchronize(false);
    } catch (error) { info(copy ? 'Copy cells' : 'Move cells', error instanceof Error ? error.message : 'The cells could not be moved.'); throw error; }
  });
}
function render() {
  updateHeader(); updateBars(); if (!store) { grid.hidden = true; element('welcome').hidden = false; return; }
  grid.hidden = false; element('welcome').hidden = true;
  const restoreFocus = document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('cell');
  const scrollTop = main.scrollTop; const scrollLeft = main.scrollLeft;
  grid.replaceChildren(); const visible = dates(); const timeWidth = clock12 ? '78px' : '51px';
  grid.style.setProperty('--time-width', timeWidth); grid.style.setProperty('--columns', `${timeWidth} repeat(${visible.length},minmax(0,1fr))`);
  const heading = document.createElement('div'); heading.className = 'grid-heading'; heading.setAttribute('role', 'row'); heading.append(document.createElement('div'));
  for (const date of visible) { const node = document.createElement('div'); const parsed = new Date(`${date}T12:00:00`); node.append(document.createTextNode(parsed.toLocaleDateString(undefined, { weekday: 'short', month: 'short' })));
    const strong = document.createElement('strong'); strong.textContent = String(parsed.getDate()); node.append(strong); heading.append(node); }
  grid.append(heading); const docs = new Map(store.state.documents.map((doc) => [doc.key, doc]));
  const today = dateKey(new Date()); const minuteNow = new Date().getHours() * 60 + new Date().getMinutes();
  const first = Math.max(0, Math.floor((scrollTop - 50) / 32) - 12); const through = Math.min(1440, first + Math.ceil(main.clientHeight / 32) + 30); firstRendered = first;
  const before = document.createElement('div'); before.style.height = `${first * 32}px`; before.setAttribute('aria-hidden', 'true'); grid.append(before);
  for (let minute = first; minute < through; minute++) {
    const row = document.createElement('div'); row.className = `minute-row${visible.includes(today) && minute === minuteNow ? ' current' : ''}`; row.setAttribute('role', 'row'); row.dataset.row = String(minute);
    const time = document.createElement('div'); time.className = 'time'; time.textContent = minuteLabel(minute, clock12); row.append(time);
    for (const date of visible) {
      const node = document.createElement('div'); node.className = 'cell'; node.tabIndex = 0; node.setAttribute('role', 'gridcell'); node.dataset.day = date; node.dataset.minute = String(minute);
      const doc = docs.get(minuteKey(date, minute)); const value = doc?.value; const format = formatFromDocument(docs.get(cellFormatKey(date, minute))?.value);
      const plan = planForMinute(date, minute);
      const draft = editor?.day === date && editor.minute === minute ? editor.input.value : undefined;
      const presentation = minuteCellPresentation(docs, date, minute, planForMinute);
      if (presentation.borderId) { node.classList.add('event-cell');
        if (presentation.first) { node.classList.add('event-first'); const title = document.createElement('span'); title.className = 'cell-event-title';
          title.textContent = `▣ ${presentation.title ?? ''}`; title.setAttribute('aria-label', `Activity: ${presentation.title ?? ''}`); node.append(title); }
        if (presentation.last) node.classList.add('event-last');
      }
      const note = document.createElement('span'); note.className = 'cell-note'; note.textContent = draft ?? presentation.text; node.append(note);
      if (presentation.planned) node.classList.add('planned');
      const category = value ? docs.get(`category:${value.categoryId}`)?.value : undefined;
      const background = calendarCellColor({ hasActual: Boolean(value), actualColor: typeof category?.color === 'string' ? category.color : undefined, planColor: plan?.color, noFill: format.noFill });
      if (background) { node.style.backgroundColor = background; node.classList.add('recorded'); }
      if (format.bold) node.style.fontWeight = '700'; if (format.italic) node.style.fontStyle = 'italic'; if (format.underline) node.style.textDecoration = 'underline'; if (format.textColor) node.style.color = format.textColor;
      node.setAttribute('aria-label', `${date}, ${minuteLabel(minute, clock12)}${value ? `, ${String(value.text ?? '')}` : plan ? `, planned: ${plan.title}` : ', empty cell'}`);
      node.addEventListener('pointerdown', (event) => {
        if (commandBusy || event.button !== 0 || event.pointerType !== 'touch') return;
        cellHeld = false; closeCellMenu(); if (cellHoldTimer) clearTimeout(cellHoldTimer);
        const target = { day: date, minute }; const keepRange = isInSelection(date, minute) && Boolean(rangeEnd);
        if (!keepRange) select(target, event.shiftKey); drag = target;
        cellHoldTimer = setTimeout(() => { cellHeld = true; drag = null; void showCellMenu(event.clientX, event.clientY).catch(report); }, 450);
      });
      node.addEventListener('pointerenter', () => { if (drag && !commandBusy && !cellHeld) { if (cellHoldTimer) clearTimeout(cellHoldTimer); select({ day: date, minute }, true); } });
      node.addEventListener('click', () => { if (cellHeld || commandBusy || rangeEnd || mouseSelection.suppressesClick()) return; beginEdit(date, minute); });
      node.addEventListener('contextmenu', (event) => { event.preventDefault(); mouseSelection.cancel(false); if (!isInSelection(date, minute)) select({ day: date, minute }); void showCellMenu(event.clientX, event.clientY).catch(report); });
      node.addEventListener('dblclick', () => beginEdit(date, minute, undefined, true)); node.addEventListener('keydown', (event) => cellKey(event, date, minute)); row.append(node);
    }
    grid.append(row);
  }
  const after = document.createElement('div'); after.style.height = `${(1440 - through) * 32}px`; after.setAttribute('aria-hidden', 'true'); grid.append(after);
  main.scrollTop = scrollTop; main.scrollLeft = scrollLeft;
  paintSelection();
  if (restoreFocus) { const endpoint = rangeEnd ?? selected; cell(endpoint.day, endpoint.minute)?.focus({ preventScroll: true }); }
  updateBars();
}
async function saveEditor() {
  if (!editor || !store) return; const current = editor; const activeStore = store;
  if (current.saving) return current.saving;
  current.saving = (async () => {
    let sessionUndo: UndoEdit | null = null;
    const complete = await flushBrowserText(current, () => store === activeStore && editor === current, async (text, expectedRevision) => {
      let result: ReturnType<typeof editCells> | undefined;
      await activeStore.update((state) => {
        if (getMinute(state, current.day, current.minute)?.revision !== expectedRevision) throw new Error('This minute changed on another device. Your unsaved text is still in the editor; copy it before reloading.');
        result = editCells(state, [{ day: current.day, minute: current.minute, text }]); return result.state;
      });
      if (result!.undo.after.length) {
        const activityEditGuards = [...new Map([...(sessionUndo?.activityEditGuards ?? []),
          ...(result!.undo.activityEditGuards ?? [])].map((guard) => [guard.key, guard])).values()];
        sessionUndo = { before: sessionUndo?.before ?? result!.undo.before, after: result!.undo.after,
          ...(activityEditGuards.length ? { activityEditGuards } : {}) }; undo = sessionUndo;
      }
      status('Saved on this browser. Synchronization will send this note to your phone.');
      return getMinute(result!.state, current.day, current.minute)?.revision;
    });
    if (complete && editor === current) { editor = null; entryBarMode = null; entryInput.blur(); render(); }
  })().catch((error) => { current.saving = null; if (editor === current) current.input.focus(); throw error; });
  return current.saving;
}
function beginEdit(date: string, minute: number, initial?: string, focus = false) {
  if (!store) { options.showModal(); return; }
  if (editor) { if (editor.day === date && editor.minute === minute) { if (initial !== undefined) { editor.input.value = initial; mirrorDraft(); } if (focus || initial !== undefined) editor.input.focus(); return; } void saveEditor().then(() => beginEdit(date, minute, initial, focus)).catch(report); return; }
  const node = cell(date, minute); if (!node) return; select({ day: date, minute }); const document = getMinute(store.state, date, minute); const original = String(document?.value?.text ?? '');
  entryInput.value = initial ?? original; entryInput.setAttribute('aria-label', `Minute text for ${minuteLabel(minute, clock12)} on ${date}`);
  editor = { input: entryInput, day: date, minute, revision: document?.revision, original, saving: null }; entryBarMode = 'entry'; updateBars(); mirrorDraft();
  node.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  if (focus || initial !== undefined) { entryInput.focus(); entryInput.setSelectionRange(entryInput.value.length, entryInput.value.length); }
}
function cellKey(event: KeyboardEvent, date: string, minute: number) {
  if (commandBusy) { event.preventDefault(); return; }
  if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); beginEdit(date, minute, undefined, true); }
  else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); beginEdit(date, minute, event.key); }
  else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault(); const target = { day: dateKey(addDays(date, event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)), minute: Math.max(0, Math.min(1439, minute + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0))) };
    select(target, event.shiftKey); if (!cell(target.day, target.minute)) scrollMinute(target.minute); cell(target.day, target.minute)?.focus();
  }
}
async function paste(text: string) {
  if (!store) throw new Error('Unlock your ledger before pasting.');
  const clip = cellClipboard;
  if (clip && clip.store === store && clip.text === text) {
    try { await pasteInternalCells(clip); } catch (error) { info('Paste cells', error instanceof Error ? error.message : 'The cells could not be pasted.'); throw error; }
    return;
  }
  const active = store, stamp = selectionStamp();
  const changes = pastedChanges(text, selected.day, selected.minute, rangeEnd ?? undefined); const expected = new Map(changes.map((change) => [minuteKey(change.day, change.minute), getMinute(store!.state, change.day, change.minute)?.revision]));
  let result: ReturnType<typeof editCells> | undefined;
  await active.update((state) => {
    if (store !== active || selectionStamp() !== stamp) throw new Error('The paste destination changed. Select it again and retry.');
    for (const change of changes) if (getMinute(state, change.day, change.minute)?.revision !== expected.get(minuteKey(change.day, change.minute))) throw new Error('The paste destination changed. Select it again and retry.');
    result = editCells(state, changes); return result.state;
  }); if (result!.undo.after.length) undo = result!.undo; render(); status(`Saved ${result!.undo.after.length.toLocaleString()} changed cells. ${changes[0]!.day} through ${changes.at(-1)!.day}.`); void synchronize(false);
}
async function pasteInternalCells(clip: CellClipboard) {
  const active = store, stamp = selectionStamp(); if (!active || clip.store !== active || cellClipboard !== clip) throw new Error('Copy or Cut the cells again in this unlocked ledger.');
  if (cellTransferFingerprint(active.state, clip.coords, clip.origin) !== clip.fingerprint) throw new Error('The source cells changed. Copy or Cut them again.');
  const destinations = selectionCells(), copy = !clip.cut;
  const fingerprint = clipboardTransferFingerprint(active.state, clip.coords, destinations, { copy });
  let result: ReturnType<typeof transferClipboardCells> | undefined;
  await active.update((state) => {
    if (store !== active || cellClipboard !== clip || selectionStamp() !== stamp) throw new Error('The clipboard or destination changed. Copy or Cut the cells again.');
    result = transferClipboardCells(state, clip.coords, destinations, { copy, expectedSourceFingerprint: clip.fingerprint, expectedFingerprint: fingerprint }); return result.state;
  });
  if (result!.undo.after.length) undo = result!.undo;
  if (clip.cut) cellClipboard = null;
  entryBarMode = null; render(); void synchronize(false);
}
async function synchronize(manual = true) {
  if (!store || !passphrase || busy || (editor && !manual)) return; busy = true; updateHeader(); if (manual) status('Synchronizing private ledger…');
  const active = store;
  try { if (editor) await saveEditor(); await active.drain(); const result = await connection.sync(active, passphrase);
    if (store !== active) return; render(); status(`Synchronized. ${result.downloaded} downloaded batches, ${result.uploaded} uploaded batches.${active.state.conflicts.length ? ' Other note versions are available in Settings.' : ''}`);
  } catch (error) { if (store === active) report(error); }
  finally { busy = false; updateHeader(); }
}
async function refreshPlans() {
  const generation = ++viewGeneration; const target = dates();
  if (!connection.canReadCalendars()) { plans = []; render(); return; }
  try { const loaded: BrowserPlan[] = [];
    for (const date of target) loaded.push(...await connection.plans(date, calendars.filter((value) => selectedCalendars.has(value.id))));
    if (generation !== viewGeneration) return; plans = [...new Map(loaded.map((event) => [event.id, event])).values()]; render();
  } catch (error) { if (generation === viewGeneration) report(error); }
}
async function connect(calendarRead = false) {
  cellClipboard = null;
  try { const identity = await connection.authorize(calendarRead); updateHeader(); status(`Connected ${identity.email}. Unlock the same ledger as your phone.`);
    if (calendarRead) { calendars = await connection.calendars(); selectedCalendars = new Set(calendars.filter((value) => value.primary).map((value) => value.id)); renderCalendarChoices(); await refreshPlans(); }
  } catch (error) { report(error); }
}
function renderCalendarChoices() {
  const list = element('calendars'); list.replaceChildren();
  for (const calendar of calendars) { const label = document.createElement('label'); label.className = 'calendar-choice'; const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selectedCalendars.has(calendar.id);
    input.addEventListener('change', () => { input.checked ? selectedCalendars.add(calendar.id) : selectedCalendars.delete(calendar.id); void refreshPlans(); }); label.append(input, document.createTextNode(calendar.title)); list.append(label); }
}
function scrollMinute(minute: number) { main.scrollTop = Math.max(0, 50 + minute * 32 - main.clientHeight / 2); render(); }
function goNow() { day = dateKey(new Date()); selected = { day, minute: new Date().getHours() * 60 + new Date().getMinutes() }; rangeEnd = null; plans = []; render(); scrollMinute(selected.minute); void refreshPlans(); }
async function navigation(action: () => void) { if (commandBusy) return; mouseSelection.cancel(false); try { await saveEditor(); entryBarMode = null; closeCellMenu(); action(); updateBars(); } catch (error) { report(error); } }
element('menu').onclick = () => { element<HTMLDialogElement>('menu-dialog').showModal(); };
element('settings').onclick = () => { element<HTMLDialogElement>('menu-dialog').close(); updateHeader(); options.showModal(); };
element('editing-info').onclick = () => { info('Editing', 'Click a cell and type in the bottom box, or double-click to focus it. Drag across cells or Shift-click to extend the selection. Release a range to choose Group, Ungroup or other available actions; right-click reopens them. Group names an event without replacing the words inside its minutes. From and Through can include midnight, up to 24 hours. After saving, drag the outside selection border to move the whole cells; Alt-drag copies them to empty cells. Undo restores the previous local edit. Paste spreadsheet text with Ctrl+V / ⌘V; rows are minutes and columns are dates. Formulas remain text.'); };
element('passphrase-info').onclick = () => { info('Ledger passphrase', 'Use the same passphrase as your phone. Google access and the passphrase stay in memory. Notes are encrypted in this browser’s local cache and in Google’s private app folder. Lock Context when finished on a shared computer. Browser storage may be cleared or evicted; synchronize to keep a cross-device copy.'); };
element('calendar-info').onclick = () => { info('Calendar access', 'Calendar access here is read-only. Minute notes synchronize through the private ledger; explicitly authorized phone calendar links can update when the phone synchronizes.'); };
element('start').onclick = () => { options.showModal(); void connect(); };
element('connect').onclick = () => { void connect(); };
element('connect-calendars').onclick = () => { void connect(true); };
let syncHold: ReturnType<typeof setTimeout> | undefined; let syncHeld = false;
element('sync').onpointerdown = () => { syncHeld = false; syncHold = setTimeout(() => { syncHeld = true; info('Synchronization', lastStatus); }, 550); };
element('sync').onpointerup = element('sync').onpointerleave = () => { if (syncHold) clearTimeout(syncHold); };
element('sync').oncontextmenu = (event) => { event.preventDefault(); syncHeld = true; info('Synchronization', lastStatus); };
element('sync').onkeydown = (event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); info('Synchronization', lastStatus); } };
element('sync').onclick = () => { if (syncHeld) { syncHeld = false; return; } if (!store) { options.showModal(); return; } void synchronize(); };
let binderSingle: ReturnType<typeof setTimeout> | undefined; let binderHold: ReturnType<typeof setTimeout> | undefined; let held = false;
element('now').onpointerdown = () => { held = false; binderHold = setTimeout(() => { held = true; if (binderSingle) clearTimeout(binderSingle); updateHeader(); element<HTMLDialogElement>('date-dialog').showModal(); }, 550); };
element('now').onpointerup = element('now').onpointerleave = () => { if (binderHold) clearTimeout(binderHold); };
element('now').onclick = () => { if (held) return; if (binderSingle) clearTimeout(binderSingle); binderSingle = setTimeout(() => { void navigation(goNow); }, 260); };
element('now').ondblclick = () => { if (binderSingle) clearTimeout(binderSingle); element<HTMLDialogElement>('view-dialog').showModal(); };
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-days]')) button.onclick = () => { void navigation(() => { days = Number(button.dataset.days); element<HTMLDialogElement>('view-dialog').close(); render(); void refreshPlans(); }); };
element('apply-dates').onclick = () => { if (!dayInput.value) return; void navigation(() => { day = dayInput.value; days = Number(daysInput.value); plans = []; element<HTMLDialogElement>('date-dialog').close(); render(); void refreshPlans(); }); };
element('previous').onclick = () => { void navigation(() => { day = dateKey(addDays(day, -days)); plans = []; render(); void refreshPlans(); }); };
element('next').onclick = () => { void navigation(() => { day = dateKey(addDays(day, days)); plans = []; render(); void refreshPlans(); }); };
element('undo').onclick = () => { void navigation(() => { if (!store || !undo) return; const target = undo; void store.update((state) => undoEdit(state, target)).then(() => { undo = null; render(); status('Edit undone.'); }).catch(report); }); };
element('lock').onclick = () => { void navigation(() => { unlockRequest++; cellClipboard = null; store?.lock(); store = null; passphrase = ''; passInput.value = ''; connection.lock(); plans = []; liveFillColors = []; undo = null; entryBarMode = null; busy = false; viewGeneration++; render(); status('Context is locked.'); }); };
element<HTMLFormElement>('unlock-form').onsubmit = (event) => { event.preventDefault(); if (busy || !connection.identity) return;
  const request = ++unlockRequest; busy = true; updateHeader();
  const entered = passInput.value; passInput.value = ''; const subject = connection.identity.subject; status('Unlocking the private ledger…');
  void (async () => { const unlocked = await BrowserStore.unlock(subject, entered); if (request !== unlockRequest || connection.identity?.subject !== subject) { unlocked.lock(); return; }
    cellClipboard = null; store?.lock(); store = unlocked; passphrase = entered;
    // A new browser must discover and decrypt the phone ledger before enabling new entries.
    if (!unlocked.hasSavedLedger()) { try { await connection.sync(unlocked, entered); } catch (error) { unlocked.lock(); if (store === unlocked) { store = null; passphrase = ''; } throw error; } }
    if (request !== unlockRequest || store !== unlocked) return;
    options.close(); goNow(); status('Ledger unlocked. Select a minute and type, or paste spreadsheet cells.'); void synchronize(false);
  })().catch((error) => { if (request === unlockRequest) report(error); }).finally(() => { if (request === unlockRequest) { busy = false; updateHeader(); } });
};
element<HTMLSelectElement>('appearance').onchange = (event) => { settings.appearance = (event.target as HTMLSelectElement).value; if (settings.appearance === 'system') delete document.body.dataset.theme; else document.body.dataset.theme = settings.appearance; };
element<HTMLSelectElement>('clock').onchange = (event) => { settings.clock = (event.target as HTMLSelectElement).value; clock12 = settings.clock === '12'; render(); };
element('conflicts').onclick = () => {
  const list = element('conflict-list'); list.replaceChildren(); const versions = store?.state.conflicts.filter((doc) => doc.key.startsWith('minute:')).slice(-100).reverse() ?? [];
  if (!versions.length) list.textContent = 'No other minute-note versions.';
  for (const version of versions) { const node = document.createElement('section'); node.className = 'conflict'; const title = document.createElement('strong'); title.textContent = version.key;
    const text = document.createElement('p'); text.textContent = version.value === null ? '(Deleted note)' : String(version.value.text ?? ''); const restore = document.createElement('button'); restore.textContent = 'Restore this text'; restore.disabled = version.value === null;
    restore.onclick = () => { const [, date, minute] = version.key.split(':'); if (!store || version.value === null) return;
      void store.update((state) => { const result = editCells(state, [{ day: date!, minute: Number(minute), text: String(version.value!.text ?? '') }]); undo = result.undo; return result.state; }).then(() => { render(); status('Note text restored as a new version.'); }).catch(report); };
    node.append(title, text, restore); list.append(node);
  }
  element<HTMLDialogElement>('conflict-dialog').showModal();
};
entryInput.addEventListener('input', mirrorDraft);
entryInput.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); editor = null; entryBarMode = null; entryInput.blur(); render(); }
  else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void saveEditor().catch(report); } });
element('save-text').onclick = () => { void saveEditor().catch(report); };
element('finish-format').onclick = () => { if (!commandBusy) { entryBarMode = null; updateBars(); } };
for (const key of ['bold', 'italic', 'underline'] as const) element(`format-${key}`).onclick = () => toggleFormat(key);
element('format-text-color').onclick = () => { if (entryBarMode === 'format' && !commandBusy) element<HTMLDialogElement>('text-color-dialog').showModal(); };
element('apply-text-color').onclick = () => { const value = element<HTMLInputElement>('text-color').value; void cellCommand(async () => { await formatSelection({ textColor: value }); element<HTMLDialogElement>('text-color-dialog').close(); }); };
element('format-fill').onclick = showFillOptions;
element('reset-fill').onclick = () => { void cellCommand(async () => { await formatSelection({ fill: null }); element<HTMLDialogElement>('fill-dialog').close(); }); };
element('load-fill-colors').onclick = () => { void cellCommand(async () => { if (!connection.canReadCalendars()) await connect(true); liveFillColors = await connection.activityColors(); showFillOptions(); }); };
element<HTMLFormElement>('group-form').onsubmit = (event) => { event.preventDefault(); const title = element<HTMLInputElement>('group-title').value; const stamp = groupSelectionStamp;
  void cellCommand(async () => { try { if (!stamp || selectionStamp() !== stamp) throw new Error('The selection changed. Choose Group again.');
    if (!groupRangeConfirmed) throw new Error('Choose From and Through for one consecutive activity, up to 24 hours.');
    const coords = readGroupRange(); if (JSON.stringify(coords) !== JSON.stringify(groupCoordinates)) throw new Error('The time range changed. Choose its endpoints again.');
    if (!store || eventSelectionFingerprint(store.state, coords) !== groupSelectionRevision) throw new Error('This activity changed. Choose Group again.');
    const fill = groupFillOptions[Number(element<HTMLSelectElement>('group-color').value)]; if (!fill) throw new Error('Choose an activity color.');
    await mutateSelection((state, points) => groupSelection(state, points, { title, fill }, groupFillOptions.map((value) => value.color)), coords);
    element<HTMLDialogElement>('group-dialog').close(); groupSelectionStamp = null; groupSelectionRevision = null; entryBarMode = null; updateBars();
    } catch (error) { element('group-range-error').textContent = error instanceof Error ? error.message : 'The event could not be grouped.'; throw error; } }); };
for (const id of ['group-from-date', 'group-from-time', 'group-through-date', 'group-through-time']) element(id).addEventListener('input', changeGroupRange);
const mouseSelection = bindMouseSelection(grid, main, {
  enabled: () => Boolean(store && !commandBusy && !document.querySelector('dialog[open]')),
  readSelection: () => ({ anchor: selected, end: rangeEnd }),
  restore: (selection) => { selected = selection.anchor; rangeEnd = selection.end; paintSelection(); updateBars(); },
  select: (point, extend) => { if (extend && !editor) entryBarMode = null; select(point, extend); cell(point.day, point.minute)?.focus({ preventScroll: true }); },
  pointFromTarget: (target) => { const node = target instanceof Element ? target.closest<HTMLElement>('.cell') : null;
    return node ? { day: node.dataset.day!, minute: Number(node.dataset.minute) } : null; },
  pointAt: (x, y) => {
    const rect = grid.getBoundingClientRect(), bounds = main.getBoundingClientRect(), visible = dates(), timeWidth = clock12 ? 78 : 51;
    const width = rect.width - timeWidth; if (width <= 0 || bounds.bottom <= bounds.top + 50) return null;
    const column = Math.max(0, Math.min(visible.length - 1, Math.floor((x - rect.left - timeWidth) / width * visible.length)));
    const viewportY = Math.max(bounds.top + 50, Math.min(bounds.bottom - 1, y));
    const minute = Math.max(0, Math.min(1439, Math.floor((main.scrollTop + viewportY - bounds.top - 50) / 32)));
    return { day: visible[column]!, minute };
  },
  viewport: () => { const bounds = main.getBoundingClientRect(); return { top: bounds.top + 50, bottom: bounds.bottom, left: bounds.left, right: bounds.right }; },
  onStart: () => { closeCellMenu(); if (entryBarMode === 'format') { entryBarMode = null; updateBars(); } if (cellHoldTimer) clearTimeout(cellHoldTimer); cellHeld = false; drag = null; },
  onComplete: (x, y) => { void showCellMenu(x, y).catch(report); },
  moveFromTarget: selectedBorder,
  onMoveStart: (grabbed) => {
    if (!store || editor) return false; const coords = selectionCells(), origin = coords[0]!;
    moveDraft = { store, coords, grabbed, origin, fingerprint: cellTransferFingerprint(store.state, coords, origin), stamp: selectionStamp() }; return true;
  },
  onMove: previewMove,
  onMoveComplete: (point, copy) => { void completeMove(point, copy).catch(report); },
  onCancel: clearMovePreview,
  onAutoScroll: () => { const next = Math.max(0, Math.floor((main.scrollTop - 50) / 32) - 12); if (Math.abs(next - firstRendered) > 5) render(); },
});
document.addEventListener('pointerup', () => { drag = null; if (cellHoldTimer) clearTimeout(cellHoldTimer); });
document.addEventListener('pointercancel', () => { drag = null; if (cellHoldTimer) clearTimeout(cellHoldTimer); });
document.addEventListener('pointerdown', (event) => {
  if (!(event.target instanceof Node)) return;
  if (!element('cell-menu').contains(event.target)) closeCellMenu();
  if (entryBarMode === 'format' && !element('cell-format-menu').contains(event.target) && !element('cell-menu').contains(event.target) && !document.querySelector('dialog[open]')) { entryBarMode = null; updateBars(); }
});
main.addEventListener('scroll', () => { const next = Math.max(0, Math.floor((main.scrollTop - 50) / 32) - 12); if (Math.abs(next - firstRendered) > 5) render(); }, { passive: true });
document.addEventListener('paste', (event) => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || document.querySelector('dialog[open]')) return;
  if (commandBusy) { event.preventDefault(); return; }
  event.preventDefault(); const text = event.clipboardData?.getData('text/plain'); if (text === undefined) return; void cellCommand(() => paste(text)); });
document.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); element('undo').click(); } });
window.addEventListener('beforeunload', (event) => { if (editor?.input.value !== editor?.original || (store && Object.keys(store.state.pending).length)) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateHeader(); void synchronize(false); } });
setInterval(() => { updateHeader(); if (!document.hidden && !editor) { const minute = new Date().getHours() * 60 + new Date().getMinutes(); const current = grid.querySelector('.minute-row.current'); if (current?.getAttribute('data-row') !== String(minute)) render(); void synchronize(false); } }, 15_000);
void fetch('./config.json', { cache: 'no-store' }).then((response) => { if (!response.ok) throw new Error('Browser configuration is unavailable.'); return response.json(); }).then((config) => {
  if (typeof config.googleWebClientId !== 'string' || !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(config.googleWebClientId)) throw new Error('The Google browser client is not configured.');
  connection = new GoogleConnection(config.googleWebClientId); render();
}).catch(report);
