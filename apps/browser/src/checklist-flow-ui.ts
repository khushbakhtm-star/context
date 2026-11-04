import { checklistRows, checklistSubtreeIds, prioritizeChecklistRows, type ChecklistChange, type ChecklistFlow, type ChecklistTask } from '../shared/utils/checklist-flow';
import { newBrowserTask } from './checklist-flow';

type Snapshot = { scope: object; name?: string; flow: ChecklistFlow; revision: string | undefined;
  versions: { revision: string; flow: ChecklistFlow }[]; canMoveToList?: boolean };
export type ChecklistFlowHooks = {
  snapshot(): Snapshot | null;
  change(command: ChecklistChange, expected: string | undefined, scope: object): Promise<string | undefined>;
  restore(value: ChecklistFlow, expected: string | undefined, scope: object): Promise<void>;
  moveToList?(taskId: string, expected: string | undefined, scope: object): Promise<void>;
  source(source: NonNullable<ChecklistTask['source']>): void;
  back(): void;
  error(error: unknown): void;
};
const button = (label: string, text: string, action: () => void) => {
  const node = document.createElement('button'); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label);
  node.textContent = text; node.onpointerdown = (event) => { event.preventDefault(); }; node.onclick = action; return node;
};

/** Plain text plus typed row formatting: pasted HTML is never executed. */
export class ChecklistFlowUI {
  private revision: string | undefined;
  private rendered = false;
  private hiddenCompleted = false;
  private composerOpen = false;
  private draft: { id: string; input: HTMLTextAreaElement; original: string; revision: string | undefined; scope: object } | null = null;
  private composerDraft: { input: HTMLTextAreaElement; revision: string | undefined; scope: object; parentId: string | null; taskId?: string; savedText?: string } | null = null;
  private saving: Promise<{ revision: string | undefined; scope: object } | null> | null = null;
  private savingComposer: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private dragged: { id: string; pointerId: number; row: HTMLElement; ready: Promise<string | undefined>; target: HTMLElement | null; after: boolean } | null = null;
  private addParent: string | null = null;
  private message: HTMLElement | null = null;
  constructor(private host: HTMLElement, private hooks: ChecklistFlowHooks) {
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', () => { this.cancelDrag(); this.refresh(); });
      window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && this.dragged) { event.preventDefault(); this.cancelDrag(); this.refresh(); } });
    }
  }
  hasDraft() { return Boolean(this.draft || this.composerDraft?.input.value.length); }
  clear() { this.draft = null; this.composerDraft = null; this.dragged = null; this.rendered = false; this.addParent = null; this.composerOpen = false; this.host.replaceChildren(); }
  setHideCompleted(value: boolean) { this.hiddenCompleted = value; this.refresh(true); }
  async resetChecks() { const current = this.hooks.snapshot(); if (current) await this.command({ type: 'reset' }, current.revision, current.scope); }
  async openComposer(parentId: string | null = null) {
    await this.act(async () => { this.addParent = parentId; this.composerOpen = true; });
    this.host.querySelector<HTMLTextAreaElement>('.checklist-add textarea')?.focus();
  }
  refresh(force = false) {
    if (this.host.hidden) return;
    let current: Snapshot | null;
    try { current = this.hooks.snapshot(); } catch (error) { this.hooks.error(error); return; }
    if (!current) { this.clear(); const text = document.createElement('p'); text.textContent = 'Connect Google and unlock your private ledger to use your checklist.'; this.host.append(text); return; }
    if (this.dragged || this.draft) return;
    if (!force && this.rendered && this.revision === current.revision) return;
    const composerHadFocus = Boolean(this.composerDraft && document.activeElement === this.composerDraft.input);
    this.rendered = true; this.revision = current.revision; this.host.replaceChildren();
    if (current.name) { const title = document.createElement('h1'); title.className = 'priority-list-name'; title.textContent = current.name; this.host.append(title); }
    this.message = document.createElement('p'); this.message.className = 'checklist-message'; this.message.setAttribute('role', 'status'); this.host.append(this.message);
    const list = document.createElement('div'); list.className = 'checklist-rows'; list.setAttribute('role', 'list'); list.setAttribute('aria-label', current.name ?? 'Priority');
    const rows = prioritizeChecklistRows(checklistRows(current.flow, this.hiddenCompleted));
    for (const { task, depth } of rows) list.append(this.row(task, depth, current));
    this.host.append(list);
    if (this.composerOpen || this.composerDraft) this.composer(current, composerHadFocus);
    else { const add = button('Add a task', '+', () => { void this.openComposer(); }); add.className = 'priority-add'; this.host.append(add); }
    if (current.versions.length) this.versions(current);
  }
  async flush() { await this.queue; await this.saveDraft(); await this.saveComposer(); this.refresh(true); }
  private act(work: () => Promise<void>, guard?: { revision: string | undefined; scope: object }) {
    const intendedScope = guard?.scope ?? this.hooks.snapshot()?.scope;
    const pending = this.queue.then(async () => {
      if (this.hooks.snapshot()?.scope !== intendedScope || (guard && this.hooks.snapshot()?.revision !== guard.revision)) throw new Error('Your task list changed. Review the latest list before trying again.');
      const saved = await this.saveDraft(); const current = this.hooks.snapshot();
      if (current?.scope !== intendedScope) throw new Error('The account or checklist changed. Reopen Priority.');
      if (guard && current?.revision !== (saved && saved.scope === intendedScope ? saved.revision : guard.revision)) throw new Error('Your task list changed. Review the latest list before trying again.');
      await work(); this.refresh(true);
    });
    this.queue = pending.catch((error) => { this.hooks.error(error); if (this.message) this.message.textContent = error instanceof Error ? error.message : 'The task could not be saved.'; });
    return this.queue;
  }
  private command(command: ChecklistChange, revision: string | undefined, scope: object) {
    return this.act(async () => { const current = this.hooks.snapshot(); if (!current) throw new Error('Unlock your private ledger first.'); await this.hooks.change(command, current.revision, scope); }, { revision, scope });
  }
  private async saveDraft() {
    if (this.saving) return this.saving;
    const draft = this.draft; if (!draft) return null;
    if (draft.input.value === draft.original) { if (this.draft === draft) this.draft = null; return { revision: draft.revision, scope: draft.scope }; }
    this.saving = (async () => {
      while (this.draft === draft) {
        const text = draft.input.value;
        const acknowledgedRevision = await this.hooks.change({ type: 'edit', id: draft.id, text }, draft.revision, draft.scope);
        draft.original = text; draft.revision = acknowledgedRevision;
        if (this.hooks.snapshot()?.scope !== draft.scope) return null;
        if (this.draft === draft && draft.input.value === text) { this.draft = null; break; }
      }
      return { revision: draft.revision, scope: draft.scope };
    })().finally(() => { this.saving = null; });
    return this.saving;
  }
  private cancelDrag() {
    this.dragged?.target?.classList.remove('drop-before', 'drop-after'); this.dragged?.row.classList.remove('dragging'); this.dragged = null;
  }
  private async saveComposer() {
    if (this.savingComposer) return this.savingComposer;
    const draft = this.composerDraft; if (!draft) return;
    if (!draft.input.value.trim()) { if (this.composerDraft === draft) this.composerDraft = null; return; }
    this.savingComposer = (async () => {
      // New tasks are additive to the latest list. The exact account/session and
      // the store's queued CAS still fence the write; no existing task is reset.
      while (this.composerDraft === draft) {
        const current = this.hooks.snapshot(); if (!current || current.scope !== draft.scope) throw new Error('The connected account changed. Your draft has not been copied to another account.');
        const text = draft.input.value;
        let acknowledgedRevision: string | undefined;
        if (draft.taskId) acknowledgedRevision = await this.hooks.change({ type: 'edit', id: draft.taskId, text }, draft.revision, draft.scope);
        else {
          const task = newBrowserTask(text); task.parentId = draft.parentId;
          acknowledgedRevision = await this.hooks.change({ type: 'add', item: task }, current.revision, draft.scope); draft.taskId = task.id;
        }
        if (this.composerDraft !== draft || this.hooks.snapshot()?.scope !== draft.scope) return;
        draft.savedText = text; draft.revision = acknowledgedRevision;
        if (draft.input.value === text) { draft.input.value = ''; this.composerDraft = null; this.addParent = null; this.composerOpen = false; break; }
      }
    })().finally(() => { this.savingComposer = null; });
    return this.savingComposer;
  }
  private row(task: ChecklistTask, depth: number, snapshot: Snapshot) {
    const row = document.createElement('div'); row.className = `checklist-row${task.checked ? ' completed' : ''}`;
    row.dataset.taskId = task.id; row.dataset.depth = String(depth); row.style.setProperty('--task-depth', String(depth)); row.setAttribute('role', 'listitem');
    const tick = document.createElement('input'); tick.type = 'checkbox'; tick.checked = task.checked; tick.setAttribute('aria-label', `${task.checked ? 'Mark incomplete' : 'Complete'}: ${task.text || 'Untitled task'}`);
    tick.onchange = () => { void this.command({ type: 'check', id: task.id, checked: tick.checked }, snapshot.revision, snapshot.scope); };
    const input = document.createElement('textarea'); input.rows = 1; input.value = task.text; input.maxLength = 50_000; input.placeholder = 'Task'; input.setAttribute('aria-label', `Edit task: ${task.text || 'Untitled task'}`);
    input.style.fontWeight = task.format.bold ? '700' : '400'; input.style.fontStyle = task.format.italic ? 'italic' : 'normal'; input.style.textDecoration = task.format.underline ? 'underline' : 'none';
    if (task.format.textColor) input.style.color = task.format.textColor;
    const size = () => { input.style.height = 'auto'; input.style.height = `${Math.min(220, Math.max(40, input.scrollHeight))}px`; };
    input.onfocus = () => { this.draft = { id: task.id, input, original: task.text, revision: snapshot.revision, scope: snapshot.scope }; };
    input.oninput = size;
    input.onblur = () => { void this.act(async () => {}); };
    input.onkeydown = (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); input.blur(); }
      else if (event.key === 'Escape') { input.value = task.text; this.draft = null; input.blur(); this.refresh(true); } };
    const handle = button(`Drag ${task.text || 'task'} to reorder`, '⠿', () => {}); handle.className = 'checklist-drag'; handle.setAttribute('aria-describedby', 'checklist-move-help');
    handle.onpointerdown = (event) => {
      if (event.button !== 0 || this.dragged) return; event.preventDefault();
      const initialRevision = this.hooks.snapshot()?.revision;
      if (initialRevision !== snapshot.revision || this.hooks.snapshot()?.scope !== snapshot.scope) { this.hooks.error(new Error('Your task list changed. Review the latest list before moving it.')); this.refresh(true); return; }
      const ready = this.saveDraft().then((acknowledgement) => { if (this.hooks.snapshot()?.scope !== snapshot.scope) throw new Error('The connected account changed. Reopen your checklist.'); return acknowledgement?.revision ?? initialRevision; }); void ready.catch(() => undefined);
      this.dragged = { id: task.id, pointerId: event.pointerId, row, ready, target: null, after: false };
      handle.setPointerCapture(event.pointerId); row.classList.add('dragging');
    };
    handle.onpointermove = (event) => {
      const drag = this.dragged; if (!drag || drag.pointerId !== event.pointerId) return;
      drag.target?.classList.remove('drop-before', 'drop-after'); const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-task-id]') ?? null;
      const excluded = new Set(checklistSubtreeIds(snapshot.flow, task.id));
      if (target && this.host.contains(target) && !excluded.has(target.dataset.taskId!)) {
        const rect = target.getBoundingClientRect(); drag.target = target; drag.after = event.clientY >= rect.top + rect.height / 2; target.classList.add(drag.after ? 'drop-after' : 'drop-before');
      } else drag.target = null;
      const container = this.host.parentElement; if (container) { const bounds = container.getBoundingClientRect(); if (event.clientY < bounds.top + 45) container.scrollTop -= 18; else if (event.clientY > bounds.bottom - 45) container.scrollTop += 18; }
    };
    const cancel = () => { this.cancelDrag(); };
    handle.onpointercancel = () => { cancel(); this.refresh(); };
    handle.onlostpointercapture = (event) => { if (this.dragged?.pointerId === event.pointerId) { cancel(); this.refresh(); } };
    handle.onpointerup = (event) => {
      const drag = this.dragged; if (!drag || drag.pointerId !== event.pointerId) return; const targetId = drag.target?.dataset.taskId; cancel();
      if (!targetId) return;
      void this.act(async () => {
        const expected = await drag.ready; const latest = this.hooks.snapshot(); if (!latest) throw new Error('Unlock your private ledger first.');
        const target = snapshot.flow.items.find((value) => value.id === targetId)!;
        let beforeId: string | null = target.id;
        if (drag.after) { const siblings = snapshot.flow.items.filter((value) => value.parentId === target.parentId && value.id !== task.id); beforeId = siblings[siblings.findIndex((value) => value.id === target.id) + 1]?.id ?? null; }
        await this.hooks.change({ type: 'move', id: task.id, parentId: target.parentId, beforeId }, expected, snapshot.scope);
      });
    };
    const details = document.createElement('details'); details.className = 'checklist-tools'; const summary = document.createElement('summary'); summary.textContent = '⋯'; summary.setAttribute('aria-label', `Task options: ${task.text || 'Untitled task'}`); details.append(summary);
    const actions = document.createElement('div'); actions.className = 'checklist-actions';
    for (const [key, label, text] of [['bold', 'Bold', 'B'], ['italic', 'Italic', 'I'], ['underline', 'Underline', 'U']] as const) {
      const control = button(label, text, () => { void this.command({ type: 'edit', id: task.id, format: { ...task.format, [key]: !task.format[key] } }, snapshot.revision, snapshot.scope); });
      control.setAttribute('aria-pressed', String(Boolean(task.format[key]))); control.className = `task-${key}`; actions.append(control);
    }
    const colorLabel = document.createElement('label'); colorLabel.className = 'checklist-text-color'; colorLabel.title = 'Text color'; colorLabel.append(document.createTextNode('A'));
    const color = document.createElement('input'); color.type = 'color'; color.value = task.format.textColor ?? '#242424'; color.setAttribute('aria-label', 'Task text color');
    color.onchange = () => { void this.command({ type: 'edit', id: task.id, format: { ...task.format, textColor: color.value } }, snapshot.revision, snapshot.scope); }; colorLabel.append(color); actions.append(colorLabel);
    actions.append(button('Reset text color', 'A↻', () => { const format = { ...task.format }; delete format.textColor; void this.command({ type: 'edit', id: task.id, format }, snapshot.revision, snapshot.scope); }));
    actions.append(button('Add subtask', '+ Subtask', () => { void this.openComposer(task.id); }),
      button('Move task up', '↑', () => { void this.command({ type: 'moveRelative', id: task.id, direction: 'up' }, snapshot.revision, snapshot.scope); }),
      button('Move task down', '↓', () => { void this.command({ type: 'moveRelative', id: task.id, direction: 'down' }, snapshot.revision, snapshot.scope); }),
      button('Indent task', '→', () => { void this.command({ type: 'indent', id: task.id }, snapshot.revision, snapshot.scope); }),
      button('Outdent task', '←', () => { void this.command({ type: 'outdent', id: task.id }, snapshot.revision, snapshot.scope); }),
      button('Delete task and subtasks', 'Delete', () => { void this.command({ type: 'delete', id: task.id }, snapshot.revision, snapshot.scope); }));
    if (snapshot.canMoveToList && this.hooks.moveToList) actions.append(button('Move to checklist', 'Move to checklist', () => {
      void this.act(async () => {
        const current = this.hooks.snapshot();
        if (current) await this.hooks.moveToList!(task.id, current.revision, snapshot.scope);
      }, snapshot);
    }));
    if (task.source) actions.append(button('Open source minute', '↗', () => { void this.flush().then(() => this.hooks.source(task.source!)).catch(this.hooks.error); }));
    details.append(actions); row.append(tick, input, handle, details);
    requestAnimationFrame(size); return row;
  }
  private composer(snapshot: Snapshot, restoreFocus: boolean) {
    const form = document.createElement('form'); form.className = 'checklist-add';
    const preserved = this.composerDraft?.scope === snapshot.scope ? this.composerDraft : null;
    const input = preserved?.input ?? document.createElement('textarea');
    input.rows = 1; input.maxLength = 50_000; input.placeholder = (preserved?.parentId ?? this.addParent) ? 'Add a subtask' : 'Add a task'; input.setAttribute('aria-label', input.placeholder);
    const captureDraft = () => { if (!this.composerDraft || this.composerDraft.input !== input) this.composerDraft = {
      input, revision: snapshot.revision, scope: snapshot.scope, parentId: this.addParent }; };
    input.oninput = captureDraft;
    const add = document.createElement('button'); add.type = 'submit'; add.textContent = '+'; add.setAttribute('aria-label', input.placeholder);
    form.onsubmit = (event) => { event.preventDefault(); const text = input.value; if (!text.trim()) { input.focus(); return; }
      captureDraft(); void this.act(() => this.saveComposer()); };
    input.onkeydown = (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } };
    form.append(input, add); if (this.addParent) form.append(button('Make this a top-level task', '←', () => { this.addParent = null; if (this.composerDraft) this.composerDraft.parentId = null; this.refresh(true); })); this.host.append(form);
    if (restoreFocus) input.focus({ preventScroll: true });
    const help = document.createElement('p'); help.id = 'checklist-move-help'; help.className = 'visually-hidden'; help.textContent = 'Drag a handle to move a task and its subtasks. Task options also provide Move up, Move down, Indent and Outdent.'; this.host.append(help);
  }
  private versions(current: Snapshot) {
    const details = document.createElement('details'); details.className = 'checklist-versions'; const title = document.createElement('summary'); title.textContent = 'Other task versions'; details.append(title);
    for (const version of current.versions) {
      const block = document.createElement('section'); const preview = document.createElement('p'); preview.textContent = version.flow.items.slice(0, 4).map((task) => `${task.checked ? '☑' : '☐'} ${task.text}`).join('\n');
      const restore = button('Restore this task-list version', 'Restore this version', () => { void this.act(async () => { await this.hooks.restore(version.flow, current.revision, current.scope); }); });
      block.append(preview, restore); details.append(block);
    }
    this.host.append(details);
  }
}
