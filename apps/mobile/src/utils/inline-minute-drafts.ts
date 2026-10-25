export type InlineMinuteValue = {
  dateKey: string;
  minuteIndex: number;
  text: string;
  categoryId: string;
  keepColor: boolean;
};

export type InlineMinuteDraft = InlineMinuteValue & {
  key: string;
  revision: number;
  savedRevision: number;
  saving: boolean;
  error: boolean;
};

export const inlineMinuteKey = (day: string, minute: number) => `${day}:${minute}`;

/** Drafts live outside a virtualized row and survive screen navigation. Each coordinate's
 * writes are serialized; an acknowledgement can never erase text typed during that write. */
export class InlineMinuteDrafts<Result> {
  private records = new Map<string, InlineMinuteDraft>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private jobs = new Map<string, Promise<boolean>>();
  private listeners = new Set<() => void>();
  private commitListeners = new Set<(value: InlineMinuteValue, result: Result) => void>();
  private activeKey: string | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private write: (value: InlineMinuteValue) => Promise<Result>, private delay = 450) {}

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  subscribeCommits(listener: (value: InlineMinuteValue, result: Result) => void) {
    this.commitListeners.add(listener); return () => { this.commitListeners.delete(listener); };
  }
  private notify() { for (const listener of this.listeners) { try { listener(); } catch { /* Observers cannot invalidate a ledger save. */ } } }
  snapshot() { return [...this.records.values()].map((value) => ({ ...value })); }
  get(day: string, minute: number) { const value = this.records.get(inlineMinuteKey(day, minute)); return value ? { ...value } : null; }

  activate(value: InlineMinuteValue) {
    const key = inlineMinuteKey(value.dateKey, value.minuteIndex);
    if (this.activeKey && this.activeKey !== key) this.close(this.activeKey);
    this.activeKey = key;
    if (!this.records.has(key)) this.records.set(key, { ...value, key, revision: 0, savedRevision: 0, saving: false, error: false });
    this.notify();
    return this.get(value.dateKey, value.minuteIndex)!;
  }

  edit(day: string, minute: number, changes: Partial<Pick<InlineMinuteValue, 'text' | 'categoryId' | 'keepColor'>>) {
    const key = inlineMinuteKey(day, minute);
    const current = this.records.get(key);
    if (!current) return;
    if (Object.entries(changes).every(([field, value]) => current[field as keyof InlineMinuteValue] === value)) return;
    Object.assign(current, changes);
    current.revision += 1;
    current.error = false;
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); void this.flush(key); }, this.delay));
    this.notify();
  }

  close(key: string) {
    if (this.activeKey === key) this.activeKey = null;
    void this.flush(key).then(() => this.prune(key));
  }

  private prune(key: string) {
    const value = this.records.get(key);
    if (value && this.activeKey !== key && !this.jobs.has(key) && value.revision === value.savedRevision) {
      this.records.delete(key);
      this.notify();
    }
  }

  async flush(key: string): Promise<boolean> {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    const existing = this.jobs.get(key);
    if (existing) return existing;
    const current = this.records.get(key);
    if (!current || current.revision === current.savedRevision) return true;
    const run = async () => {
      current.saving = true;
      this.notify();
      try {
        while (current.revision !== current.savedRevision) {
          const revision = current.revision;
          const value: InlineMinuteValue = { dateKey: current.dateKey, minuteIndex: current.minuteIndex,
            text: current.text, categoryId: current.categoryId, keepColor: current.keepColor };
          const execute = () => this.write(value);
          const writeJob = this.writeChain.then(execute, execute);
          this.writeChain = writeJob.then(() => undefined, () => undefined);
          const result = await writeJob;
          current.savedRevision = revision;
          current.error = false;
          // Commit consumers update durable data/sync, but never replace this raw focused draft.
          for (const listener of this.commitListeners) { try { listener(value, result); } catch { /* The SQLite commit remains acknowledged. */ } }
        }
        return true;
      } catch {
        current.error = true;
        return false;
      } finally {
        current.saving = false;
        this.notify();
      }
    };
    const job = run();
    this.jobs.set(key, job);
    try { return await job; }
    finally { this.jobs.delete(key); this.prune(key); }
  }

  async flushAll(): Promise<void> { await Promise.all([...this.records.keys()].map((key) => this.flush(key))); }
}
