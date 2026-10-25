import { applySpreadsheetCells, getDayEntries, getDaySegments, getEntriesBetween, getSyncDocuments, type SpreadsheetCellState } from '../data/database';
import { inlineMinuteDrafts, retryInlineMinuteLinks } from './inline-minutes';
import { CELL_FORMAT_PREFIX, cellFormatKey, formatFromDocument, isActivityGroupId, normalizeCellFormat, validateMinuteCellRange,
  type CellFormat, type MinuteCellRange } from '../utils/cell-format';
import { inlineMinuteKey, type InlineMinuteValue } from '../utils/inline-minute-drafts';
import { addDays, dateKey } from '../utils/time';

export type { CellFormat, MinuteCellRange } from '../utils/cell-format';
export type CellFormatPatch = { bold?: boolean; italic?: boolean; textColor?: string | null };
export type SpreadsheetCommit = { affectedDates: string[]; textChanged: boolean };
export type ActivityGroup = { blockId: string; dateKey: string; startMinute: number; endMinute: number;
  title: string; categoryId: string };

export async function getDayActivityGroups(day: string): Promise<ActivityGroup[]> {
  return (await getDaySegments(day)).flatMap((segment) => segment.activityTitle ? [{
    blockId: segment.blockId, dateKey: day, startMinute: segment.startMinute, endMinute: segment.endMinute,
    title: segment.activityTitle, categoryId: segment.categoryId,
  }] : []);
}
type CellState = SpreadsheetCellState & { display?: InlineMinuteValue };
type Command = { day: string; before: Promise<CellState[]>; after: CellState[];
  textChanged: boolean; formatChanged: boolean; draftKey?: string; draftRevision?: number };
type Typing = { key: string; command: Command; lastAt: number };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export async function getDayCellFormats(day: string): Promise<Map<number, CellFormat>> {
  const documents = await getSyncDocuments(`${CELL_FORMAT_PREFIX}${day}:`);
  const result = new Map<number, CellFormat>();
  for (const document of documents) {
    const suffix = document.key.slice(`${CELL_FORMAT_PREFIX}${day}:`.length);
    if (!/^(?:0|[1-9]\d{0,3})$/.test(suffix) || Number(suffix) > 1439) continue;
    const format = formatFromDocument(document.value);
    if (Object.keys(format).length) result.set(Number(suffix), format);
  }
  return result;
}

async function readCells(range: MinuteCellRange): Promise<CellState[]> {
  const [entries, formats] = await Promise.all([getDayEntries(range.dateKey), getDayCellFormats(range.dateKey)]);
  const entryByMinute = new Map(entries.map((entry) => [entry.minuteIndex, entry]));
  return Array.from({ length: range.endMinute - range.startMinute + 1 }, (_, offset) => {
    const minuteIndex = range.startMinute + offset;
    const display = inlineMinuteDrafts.get(range.dateKey, minuteIndex);
    return { minuteIndex, entry: entryByMinute.get(minuteIndex) ?? null, format: formats.get(minuteIndex) ?? {},
      ...(display ? { display: valueOf(display) } : {}) };
  });
}
function valueOf(value: InlineMinuteValue): InlineMinuteValue {
  return { dateKey: value.dateKey, minuteIndex: value.minuteIndex, text: value.text,
    categoryId: value.categoryId, keepColor: value.keepColor };
}
function entryOf(value: InlineMinuteValue) {
  return value.text.trim() || value.keepColor ? { text: value.text.trim(), categoryId: value.categoryId } : null;
}

/** Undo restores Context's cells in this running editing session. External calendar
 * cancellations/notification identity are not a reversible history store. Content and
 * formatting are journaled separately through the existing encrypted ledger stream. */
class SpreadsheetEditor {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private typing: Typing | null = null;
  private busy = false;
  private formatVersion = 0;
  private listeners = new Set<() => void>();
  private commits = new Set<(event: SpreadsheetCommit) => void>();
  private operations: Promise<unknown> = Promise.resolve();
  private deferredEdits = new Map<string, { day: string; minute: number; changes: Partial<InlineMinuteValue> }>();

  constructor() {
    inlineMinuteDrafts.subscribeCommits((value, result) => {
      if (result.readBackFailed) return;
      const draft = inlineMinuteDrafts.get(value.dateKey, value.minuteIndex);
      const key = inlineMinuteKey(value.dateKey, value.minuteIndex);
      const candidates = [...this.undoStack, ...(this.typing ? [this.typing.command] : [])].reverse();
      const command = candidates.find((item) => item.draftKey === key && item.draftRevision === draft?.savedRevision);
      const cell = command?.after[0];
      if (cell && (cell.entry?.text ?? '').trim() === value.text.trim() &&
          (!cell.entry || cell.entry.categoryId === value.categoryId)) {
        cell.entry = result.entry ? { ...result.entry } : null;
      }
    });
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  subscribeCommits(listener: (event: SpreadsheetCommit) => void) { this.commits.add(listener); return () => { this.commits.delete(listener); }; }
  snapshot() { return { canUndo: Boolean(this.typing || this.undoStack.length), canRedo: this.redoStack.length > 0,
    busy: this.busy, formatVersion: this.formatVersion }; }
  private notify() { for (const listener of this.listeners) { try { listener(); } catch { /* stale observers are isolated */ } } }
  private boundary() {
    if (!this.typing) return;
    this.undoStack.push(this.typing.command);
    this.typing = null;
    this.trimHistory();
  }
  private trimHistory() { if (this.undoStack.length > 50) this.undoStack.splice(0, this.undoStack.length - 50); }

  edit(day: string, minute: number, changes: Partial<Pick<InlineMinuteValue, 'text' | 'categoryId' | 'keepColor'>>) {
    if (this.busy) {
      const key = inlineMinuteKey(day, minute);
      const old = this.deferredEdits.get(key);
      this.deferredEdits.set(key, { day, minute, changes: { ...old?.changes, ...changes } });
      return;
    }
    const current = inlineMinuteDrafts.get(day, minute);
    if (!current || Object.entries(changes).every(([key, value]) => current[key as keyof InlineMinuteValue] === value)) return;
    const key = inlineMinuteKey(day, minute);
    const textOnly = !('categoryId' in changes);
    const coalesce = this.typing?.key === key && textOnly && Date.now() - this.typing.lastAt < 1500;
    if (!coalesce) {
      this.boundary();
      const raw = valueOf(current);
      const priorEdited = current.revision !== current.savedRevision;
      // Queue the baseline read before the debounce can write this change. If the
      // preceding typing is still unsaved, its raw value is the next command's baseline.
      const before = inlineMinuteDrafts.runExclusive(async () => {
        const cells = await readCells({ dateKey: day, startMinute: minute, endMinute: minute });
        const cell = cells[0]!;
        if (priorEdited) cell.entry = entryOf(raw) ? { ...cell.entry, ...entryOf(raw)! } :
          isActivityGroupId(cell.entry?.blockId) ? { ...cell.entry!, text: '', categoryId: raw.categoryId } : null;
        cell.display = raw;
        return cells;
      });
      // Attach a handler immediately so a database read failure stays reviewable.
      void before.catch(() => {});
      const command: Command = { day, before, after: [], textChanged: true, formatChanged: false };
      command.before = before.then((cells) => {
        const member = cells[0]?.entry;
        if (isActivityGroupId(member?.blockId)) {
          const after = command.after[0];
          if (after) after.entry = { ...member, ...after.entry,
            text: after.display?.text.trim() ?? after.entry?.text ?? '',
            categoryId: after.display?.categoryId ?? after.entry?.categoryId ?? member!.categoryId,
            blockId: member!.blockId };
        }
        return cells;
      });
      void command.before.catch(() => {});
      this.typing = { key, command, lastAt: Date.now() };
    }
    inlineMinuteDrafts.edit(day, minute, changes);
    const next = inlineMinuteDrafts.get(day, minute)!;
    this.typing!.command.after = [{ minuteIndex: minute, entry: entryOf(next), format: {}, display: valueOf(next) }];
    this.typing!.command.draftKey = key;
    this.typing!.command.draftRevision = next.revision;
    this.typing!.lastAt = Date.now();
    this.redoStack = [];
    if (!textOnly) this.boundary();
    this.notify();
  }

  private async checkedFlush() {
    await inlineMinuteDrafts.flushAll();
    if (inlineMinuteDrafts.snapshot().some((draft) => draft.error || draft.revision !== draft.savedRevision)) {
      throw new Error('A minute has not saved yet. Retry saving before changing the selection.');
    }
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const task = async () => {
      this.busy = true;
      this.boundary();
      this.notify();
      try { await this.checkedFlush(); return await work(); }
      finally {
        this.busy = false;
        this.notify();
        const edits = [...this.deferredEdits.values()];
        this.deferredEdits.clear();
        for (const edit of edits) this.edit(edit.day, edit.minute, edit.changes);
      }
    };
    const job = this.operations.then(task, task);
    this.operations = job.then(() => undefined, () => undefined);
    return job;
  }
  private async apply(command: Command, undo: boolean) {
    const before = await command.before;
    const target = undo ? before : command.after;
    const expected = undo ? command.after : before;
    const result = await inlineMinuteDrafts.runExclusive(() => applySpreadsheetCells(command.day, target, expected,
      { textChanged: command.textChanged, formatChanged: command.formatChanged }));
    if (command.textChanged) {
      inlineMinuteDrafts.rebaseCommitted(target.map((cell) => cell.display ?? {
        dateKey: command.day, minuteIndex: cell.minuteIndex, text: cell.entry?.text ?? '',
        categoryId: cell.entry?.categoryId ?? 'unaccounted', keepColor: Boolean(cell.entry && !cell.entry.text.trim()),
      }));
    }
    // Commands (including Undo/Redo) invalidate format reads once. Ordinary
    // keystrokes use the draft subscription and do not refetch per-minute styles.
    this.formatVersion += 1;
    this.notify();
    for (const listener of this.commits) { try { listener(result); } catch { /* observers cannot invalidate a commit */ } }
    if (result.textChanged) void retryInlineMinuteLinks();
  }
  private async perform(command: Command) {
    await this.apply(command, false);
    this.undoStack.push(command); this.trimHistory(); this.redoStack = []; this.notify();
  }
  format(range: MinuteCellRange, patch: CellFormatPatch) {
    validateMinuteCellRange(range);
    if ((patch.bold !== undefined && typeof patch.bold !== 'boolean') ||
        (patch.italic !== undefined && typeof patch.italic !== 'boolean') ||
        (patch.textColor != null && !/^#[0-9a-f]{6}$/i.test(patch.textColor))) {
      return Promise.reject(new Error('Use a six-digit text color and valid formatting choices.'));
    }
    return this.enqueue(async () => {
      const before = await readCells(range);
      const after = before.map((cell) => ({ ...clone(cell), format: normalizeCellFormat({ ...cell.format, ...patch }) }));
      await this.perform({ day: range.dateKey, before: Promise.resolve(before), after, textChanged: false, formatChanged: true });
    });
  }
  fill(range: MinuteCellRange, sourceMinute: number) {
    validateMinuteCellRange(range);
    if (!Number.isInteger(sourceMinute) || sourceMinute < 0 || sourceMinute > 1439) return Promise.reject(new Error('Choose a valid source minute.'));
    return this.enqueue(async () => {
      const before = await readCells(range);
      const source = (await readCells({ dateKey: range.dateKey, startMinute: sourceMinute, endMinute: sourceMinute }))[0]!;
      const blockId = source.entry?.blockId ?? `sheet_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      const after = before.map((cell) => ({ minuteIndex: cell.minuteIndex,
        // A format-only empty source fills formatting without silently clearing notes.
        entry: source.entry ? { text: source.entry.text, categoryId: source.entry.categoryId, blockId } : cell.entry,
        format: clone(source.format) }));
      await this.perform({ day: range.dateKey, before: Promise.resolve(before), after,
        textChanged: Boolean(source.entry), formatChanged: true });
    });
  }
  group(range: MinuteCellRange, input: { title: string; categoryId: string }) {
    validateMinuteCellRange(range);
    const title = input.title.trim();
    if (!title || title.length > 200 || !/^[A-Za-z0-9_-]{1,160}$/.test(input.categoryId)) {
      return Promise.reject(new Error('Enter an activity title of up to 200 characters and choose a color.'));
    }
    return this.enqueue(async () => {
      const before = await readCells(range);
      const candidate = before[0]?.entry?.blockId;
      const allEntries = await getEntriesBetween(dateKey(addDays(range.dateKey, -1)), dateKey(addDays(range.dateKey, 1)));
      const wholeExisting = isActivityGroupId(candidate) && before.every((cell) => cell.entry?.blockId === candidate) &&
        !allEntries.some((entry) => entry.blockId === candidate &&
          (entry.dateKey !== range.dateKey || entry.minuteIndex < range.startMinute || entry.minuteIndex > range.endMinute));
      const blockId = wholeExisting ? candidate : `activity_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      const after = before.map((cell) => ({ minuteIndex: cell.minuteIndex,
        // The title belongs to the activity; every minute keeps its own note.
        entry: { ...cell.entry, text: cell.entry?.text ?? '', categoryId: input.categoryId, blockId },
        format: normalizeCellFormat({ ...cell.format, activityGroup: { id: blockId, title } }) }));
      await this.perform({ day: range.dateKey, before: Promise.resolve(before), after, textChanged: true, formatChanged: true });
    });
  }
  clear(range: MinuteCellRange) {
    validateMinuteCellRange(range);
    return this.enqueue(async () => {
      const before = await readCells(range);
      await this.perform({ day: range.dateKey, before: Promise.resolve(before),
        after: before.map((cell) => ({ minuteIndex: cell.minuteIndex, entry: null, format: {} })),
        textChanged: true, formatChanged: true });
    });
  }
  undo() { return this.enqueue(async () => {
    const command = this.undoStack.at(-1); if (!command) return;
    await this.apply(command, true); this.undoStack.pop(); this.redoStack.push(command); this.notify();
  }); }
  redo() { return this.enqueue(async () => {
    const command = this.redoStack.at(-1); if (!command) return;
    await this.apply(command, false); this.redoStack.pop(); this.undoStack.push(command); this.notify();
  }); }
}

export const spreadsheetEditor = new SpreadsheetEditor();
export const editInlineMinute = (day: string, minute: number,
  changes: Partial<Pick<InlineMinuteValue, 'text' | 'categoryId' | 'keepColor'>>) => spreadsheetEditor.edit(day, minute, changes);
export const applyCellFormat = (range: MinuteCellRange, patch: CellFormatPatch) => spreadsheetEditor.format(range, patch);
export const fillMinuteRange = (range: MinuteCellRange, sourceMinute: number) => spreadsheetEditor.fill(range, sourceMinute);
export const clearMinuteRange = (range: MinuteCellRange) => spreadsheetEditor.clear(range);
export const groupMinuteRange = (range: MinuteCellRange, input: { title: string; categoryId: string }) => spreadsheetEditor.group(range, input);
export const undoSpreadsheetEdit = () => spreadsheetEditor.undo();
export const redoSpreadsheetEdit = () => spreadsheetEditor.redo();
export const subscribeSpreadsheetCommits = (listener: (event: SpreadsheetCommit) => void) => spreadsheetEditor.subscribeCommits(listener);
