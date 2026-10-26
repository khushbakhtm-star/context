/** Fold a burst of committed minutes into one pass over their affected dates.
 * Failed work stays pending for a later request/foreground retry; it never spins. */
export function createCoalescedDateWork(run: (dates: string[]) => Promise<void>, isActive: () => boolean, delay = 750) {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let suspended = false;
  let disposed = false;
  function schedule() {
    if (disposed || suspended || timer || running || !pending.size || !isActive()) return;
    timer = setTimeout(() => { timer = null; void execute(); }, delay);
  }
  async function execute() {
    if (disposed || suspended || running || !pending.size || !isActive()) return;
    running = true;
    const dates = [...pending].sort();
    pending.clear();
    let succeeded = false;
    try { await run(dates); succeeded = true; }
    catch { for (const date of dates) pending.add(date); }
    finally {
      running = false;
      if (succeeded) schedule();
    }
  }
  return {
    request(dates: readonly string[]) { if (!disposed) { for (const date of dates) pending.add(date); schedule(); } },
    suspend() { suspended = true; if (timer) clearTimeout(timer); timer = null; },
    resume() { suspended = false; schedule(); },
    dispose() { disposed = true; if (timer) clearTimeout(timer); timer = null; pending.clear(); },
  };
}
