/** Re-read a phone calendar after its editor returns, allowing for provider write delays. */
export function createCalendarRefreshBurst(refresh: () => void, isActive: () => boolean) {
  let generation = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function cancel() {
    generation += 1;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  function start() {
    cancel();
    if (!isActive()) return;
    const expectedGeneration = generation;
    refresh();
    // A refresh can synchronously cancel or replace the burst.
    if (generation !== expectedGeneration) return;
    for (const delay of [1000, 4000]) {
      const timer = setTimeout(() => {
        if (generation !== expectedGeneration) return;
        timers.delete(timer);
        if (isActive()) refresh();
      }, delay);
      timers.add(timer);
    }
  }

  return { start, cancel };
}
