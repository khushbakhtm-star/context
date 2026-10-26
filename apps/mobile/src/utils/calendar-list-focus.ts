export type CalendarViewFocusRequest = { dateKey: string; token: number };
type CalendarList = {
  scrollToIndex: (options: { index: number; animated: boolean; viewPosition: number; viewOffset: number }) => void;
  scrollToOffset: (options: { offset: number; animated: boolean }) => void;
};

/** Variable-height agenda rows may not be measured yet. Bring the target into the
 * render window, then retry its exact position. New requests and manual drags
 * cancel older work; a slow/closed view cannot keep moving the user's viewport. */
export function createCalendarListFocus(getList: () => CalendarList | null, isActive: () => boolean) {
  let pending: { index: number; viewOffset: number; attempts: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  function clearTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function cancel() { clearTimer(); pending = null; }
  function move() {
    clearTimer();
    const target = pending;
    if (!target || !isActive()) { cancel(); return; }
    if (++target.attempts > 8) { cancel(); return; }
    const list = getList();
    if (!list) { timer = setTimeout(move, 150); return; }
    try {
      list.scrollToIndex({ index: target.index, animated: false, viewPosition: 0, viewOffset: target.viewOffset });
      // RN may report an unmeasured index while dispatching scrollToIndex.
      if (pending === target && timer === null) timer = setTimeout(cancel, 200);
    } catch { cancel(); }
  }
  return {
    request(index: number, viewOffset = 0) {
      cancel();
      if (!Number.isInteger(index) || index < 0 || !Number.isFinite(viewOffset) || !isActive()) return;
      pending = { index, viewOffset, attempts: 0 };
      timer = setTimeout(move, 0);
    },
    onFailure(info: { index: number; averageItemLength: number }) {
      if (!pending || info.index !== pending.index || !isActive()) return;
      clearTimer();
      const average = Number.isFinite(info.averageItemLength) ? Math.max(0, info.averageItemLength) : 0;
      getList()?.scrollToOffset({ offset: average * pending.index, animated: false });
      timer = setTimeout(move, 150);
    },
    cancel,
  };
}
