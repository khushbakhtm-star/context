import { flushBrowserText } from './editor';
import { NOTEPAD_LIMIT } from './ledger';
import type { BrowserStore } from './store';

type NotepadStore = Pick<BrowserStore, 'state' | 'update'>;
type NotepadSession = {
  store: NotepadStore;
  original: string;
  revision: undefined;
  input: HTMLTextAreaElement;
};

/** The pad stays in the encrypted cache for the current browser account.
 * It never becomes a ledger document or joins a cloud upload. */
export class BrowserNotepad {
  private session: NotepadSession | null = null;
  private saving: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private input: HTMLTextAreaElement, private message: HTMLElement, retry: HTMLButtonElement) {
    this.retry = retry;
    input.maxLength = NOTEPAD_LIMIT;
    input.oninput = () => {
      clearTimeout(this.timer);
      if (!this.session) return;
      this.message.textContent = 'Saving…';
      this.retry.hidden = true;
      this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 350);
    };
    input.onblur = () => { void this.flush().catch(() => {}); };
    retry.onclick = () => { void this.flush().catch(() => {}); };
  }
  private readonly retry: HTMLButtonElement;

  bind(store: NotepadStore | null) {
    if ((this.session?.store ?? null) === store && this.input.disabled === !store) return;
    clearTimeout(this.timer);
    this.saving = null;
    const text = store?.state.notepad ?? '';
    this.session = store ? { store, input: this.input, original: text, revision: undefined } : null;
    this.input.value = text;
    this.input.disabled = !store;
    this.retry.hidden = true;
    this.message.textContent = store ? '' : 'Unlock Context to use Notepad.';
  }

  hasDraft() {
    return Boolean(this.saving || this.session && this.input.value !== this.session.original);
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
      await session.store.update((state) => {
        if (this.session !== session || (state.notepad ?? '') !== session.original) {
          throw new Error('This notepad changed elsewhere. Your draft is still here.');
        }
        return { ...state, notepad: text };
      });
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
    });
    this.saving = pending;
    return pending;
  }
}
