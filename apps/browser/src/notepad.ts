import { flushBrowserText } from './editor';
import { setCanvasText, type CanvasDocument, type CanvasTextRange } from '../shared/utils/canvas';
import { browserCanvas, NOTEPAD_LIMIT, setBrowserCanvas, type BrowserLedgerState } from './ledger';
import type { BrowserStore } from './store';

type NotepadStore = Pick<BrowserStore, 'state' | 'update'>;
type NotepadSnapshot = { text: string; canvas?: CanvasDocument };
type NotepadSession = {
  store: NotepadStore;
  original: string;
  revision: undefined;
  input: HTMLTextAreaElement;
  draft?: CanvasDocument;
  saved: NotepadSnapshot;
};
const HISTORY_LIMIT = 24;
function readSnapshot(state: BrowserLedgerState): NotepadSnapshot {
  return { text: state.canvas?.text ?? state.notepad ?? '', canvas: state.canvas };
}
function sameSnapshot(left: NotepadSnapshot, right: NotepadSnapshot) {
  return left.text === right.text && (left.canvas === right.canvas ||
    JSON.stringify(left.canvas) === JSON.stringify(right.canvas));
}

/** The pad stays in the encrypted cache for the current browser account.
 * It never becomes a ledger document or joins a cloud upload. */
export class BrowserNotepad {
  private session: NotepadSession | null = null;
  private saving: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private undoStack: NotepadSnapshot[] = [];
  private redoStack: NotepadSnapshot[] = [];
  private historyOperation: object | null = null;
  private lastHistoryState = { undo: false, redo: false };

  constructor(private input: HTMLTextAreaElement, private message: HTMLElement, retry: HTMLButtonElement,
    private onHistoryChange?: () => void) {
    this.retry = retry;
    input.maxLength = NOTEPAD_LIMIT;
    let beforeInput: { text: string; range: CanvasTextRange } | undefined;
    input.onbeforeinput = (event) => {
      let start = input.selectionStart;
      let end = input.selectionEnd;
      if (start === end && event.inputType === 'deleteContentBackward') start = Math.max(0, start - 1);
      else if (start === end && event.inputType === 'deleteContentForward') end = Math.min(input.value.length, end + 1);
      beforeInput = { text: input.value, range: { start, end } };
    };
    input.oninput = () => {
      clearTimeout(this.timer);
      const session = this.session;
      if (!session) return;
      if (session.draft) {
        const hint = beforeInput?.text === session.draft.text ? beforeInput.range : undefined;
        session.draft = !this.saving && input.value === session.original
          ? browserCanvas(session.store.state)
          : setCanvasText(session.draft, input.value, hint);
      }
      beforeInput = undefined;
      this.message.textContent = 'Saving…';
      this.retry.hidden = true;
      this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 350);
      this.notifyHistory();
    };
    input.onblur = () => { void this.flush().catch(() => {}); };
    retry.onclick = () => { void this.flush().catch(() => {}); };
  }
  private readonly retry: HTMLButtonElement;

  bind(store: NotepadStore | null) {
    if ((this.session?.store ?? null) === store && this.input.disabled === !store) return;
    clearTimeout(this.timer);
    this.saving = null;
    this.undoStack = [];
    this.redoStack = [];
    this.historyOperation = null;
    const saved = store ? readSnapshot(store.state) : null;
    this.session = store && saved ? { store, input: this.input, original: saved.text, revision: undefined, draft: saved.canvas, saved } : null;
    this.input.value = saved?.text ?? '';
    this.input.disabled = !store;
    this.input.readOnly = false;
    this.retry.hidden = true;
    this.message.textContent = store ? '' : 'Unlock Context to use Notepad.';
    this.notifyHistory();
  }

  hasDraft() {
    return Boolean(this.saving || this.session && this.input.value !== this.session.original);
  }

  historyState() {
    const ready = Boolean(this.session && !this.historyOperation);
    const typing = this.session !== null && this.input.value !== this.session.original;
    return { undo: ready && (typing || this.undoStack.length > 0), redo: ready && !typing && this.redoStack.length > 0 };
  }

  async undo() { await this.restoreHistory('undo'); }
  async redo() { await this.restoreHistory('redo'); }

  private notifyHistory() {
    const next = this.historyState();
    if (next.undo === this.lastHistoryState.undo && next.redo === this.lastHistoryState.redo) return;
    this.lastHistoryState = next;
    this.onHistoryChange?.();
  }

  private async restoreHistory(direction: 'undo' | 'redo') {
    const session = this.session;
    if (!session || !this.historyState()[direction]) return;
    const operation = {};
    this.historyOperation = operation;
    this.input.readOnly = true;
    this.notifyHistory();
    try {
      await this.flush();
      if (this.historyOperation !== operation || this.session !== session) return;
      const source = direction === 'undo' ? this.undoStack : this.redoStack;
      const destination = direction === 'undo' ? this.redoStack : this.undoStack;
      const next = source.at(-1);
      if (!next) return;
      const previous = session.saved;
      const state = await session.store.update((current) => {
        if (this.session !== session || !sameSnapshot(readSnapshot(current), previous)) {
          throw new Error('This notepad changed elsewhere. Its newer text has been kept.');
        }
        return next.canvas ? setBrowserCanvas(current, next.canvas) : { ...current, notepad: next.text };
      });
      if (this.historyOperation !== operation || this.session !== session) return;
      source.pop();
      destination.push(previous);
      session.saved = readSnapshot(state);
      session.original = session.saved.text;
      session.draft = session.saved.canvas;
      this.input.value = session.original;
      this.message.textContent = direction === 'undo' ? 'Edit undone.' : 'Edit restored.';
      this.retry.hidden = true;
    } finally {
      if (this.historyOperation === operation) {
        this.historyOperation = null;
        this.input.readOnly = false;
        this.notifyHistory();
      }
    }
  }

  focusEnd() {
    if (!this.session || this.input.disabled) return;
    this.input.focus();
    const end = this.input.value.length;
    this.input.setSelectionRange(end, end);
    this.input.scrollTop = this.input.scrollHeight;
  }

  async flush() {
    clearTimeout(this.timer);
    if (this.saving) return this.saving;
    const session = this.session;
    if (!session) return;
    if (this.input.value === session.original) {
      this.message.textContent = 'Saved on this browser.';
      this.retry.hidden = true;
      return;
    }
    const pending = flushBrowserText(session, () => this.session === session, async (text) => {
      const draft = session.draft?.text === text ? session.draft : undefined;
      const previous = session.saved;
      const saved = await session.store.update((state) => {
        const current = browserCanvas(state);
        if (this.session !== session || !sameSnapshot(readSnapshot(state), previous)) {
          throw new Error('This notepad changed elsewhere. Your draft is still here.');
        }
        return state.canvas ? setBrowserCanvas(state, draft ?? setCanvasText(current, text)) : { ...state, notepad: text };
      });
      if (this.session === session) {
        session.saved = readSnapshot(saved);
        this.undoStack = [...this.undoStack.slice(-(HISTORY_LIMIT - 1)), previous];
        this.redoStack = [];
      }
      return undefined;
    }).then((current) => {
      if (!current) return;
      this.message.textContent = 'Saved on this browser.';
      this.retry.hidden = true;
    }).catch((error: unknown) => {
      if (this.session === session) {
        this.message.textContent = 'Not saved. Your draft is still here.';
        this.retry.hidden = false;
      }
      throw error;
    }).finally(() => {
      if (this.saving === pending) this.saving = null;
      if (this.session === session) this.notifyHistory();
    });
    this.saving = pending;
    return pending;
  }
}
