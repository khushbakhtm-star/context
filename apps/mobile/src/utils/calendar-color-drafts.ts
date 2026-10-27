import type { MinuteEntry } from '../types';
import type { InlineMinuteDraft, InlineMinuteValue } from './inline-minute-drafts';

type DraftStore = {
  get: (day: string, minute: number) => InlineMinuteDraft | null;
  rebaseCommitted: (values: InlineMinuteValue[]) => void;
};

/** Source color imports must not overwrite raw typing, including typing that starts
 * after the database commit but before its focused editor cache is refreshed. */
export function calendarColorDraftObserver(store: DraftStore, active: () => boolean, changed: () => void) {
  const reviewed = new Map<string, InlineMinuteDraft>();
  let skipped = false;
  const key = (entry: Pick<MinuteEntry, 'dateKey' | 'minuteIndex'>) => `${entry.dateKey}:${entry.minuteIndex}`;
  const clean = (draft: InlineMinuteDraft) => !draft.saving && !draft.error && draft.revision === draft.savedRevision;
  return {
    canImport(entries: readonly MinuteEntry[]) {
      if (!active()) { skipped = true; return false; }
      for (const entry of entries) {
        const draft = store.get(entry.dateKey, entry.minuteIndex);
        if (draft && (!clean(draft) || draft.text !== entry.text || draft.categoryId !== entry.categoryId)) {
          skipped = true;
          return false;
        }
      }
      for (const entry of entries) {
        const draft = store.get(entry.dateKey, entry.minuteIndex);
        if (draft) reviewed.set(key(entry), draft);
        else reviewed.delete(key(entry));
      }
      while (reviewed.size > 2880) reviewed.delete(reviewed.keys().next().value!);
      return true;
    },
    onImported(entries: readonly MinuteEntry[], replaceText = false) {
      const rebases: InlineMinuteValue[] = [];
      for (const entry of entries) {
        const captured = reviewed.get(key(entry));
        reviewed.delete(key(entry));
        if (!captured) continue;
        const current = store.get(entry.dateKey, entry.minuteIndex);
        if (!active() || !current || !clean(current) || current.revision !== captured.revision ||
            current.savedRevision !== captured.savedRevision || current.text !== captured.text ||
            current.categoryId !== captured.categoryId || current.keepColor !== captured.keepColor ||
            !replaceText && entry.text !== captured.text) {
          skipped = true;
          continue;
        }
        rebases.push({ dateKey: entry.dateKey, minuteIndex: entry.minuteIndex, text: replaceText ? entry.text : current.text,
          categoryId: entry.categoryId, keepColor: replaceText ? Boolean(entry.blockId && !entry.text.trim()) : current.keepColor });
      }
      if (rebases.length) store.rebaseCommitted(rebases);
      if (active()) changed();
    },
    /** A later foreground/manual refresh can retry after the raw draft is saved. */
    consumeSkipped() { const value = skipped; skipped = false; return value; },
  };
}
