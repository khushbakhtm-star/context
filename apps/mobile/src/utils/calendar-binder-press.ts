export const CALENDAR_BINDER_DOUBLE_TAP_MS = 300;

/** Defer the Now shortcut until a second tap can claim the view menu. A second
 * touch-down pauses the first action so holding it can still open date selection. */
export function createCalendarBinderPress(actions: {
  allowed: () => boolean;
  single: () => void;
  double: () => void;
  long: () => void;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waitingAt: number | null = null;
  let second = false;
  let held = false;
  let generation = 0;
  let gesture = 0;
  let delivered = false;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => { if (timer != null) clearTimeout(timer); timer = null; generation += 1; };
  const clearRelease = () => { if (releaseTimer != null) clearTimeout(releaseTimer); releaseTimer = null; };
  function cancel() { clearTimer(); clearRelease(); waitingAt = null; second = false; gesture += 1; }
  return {
    pressIn() {
      clearRelease(); gesture += 1; delivered = false;
      held = false;
      const elapsed = waitingAt == null ? null : Date.now() - waitingAt;
      clearTimer();
      second = elapsed != null && elapsed >= 0 && elapsed <= CALENDAR_BINDER_DOUBLE_TAP_MS;
      if (waitingAt != null && !second) {
        waitingAt = null;
        if (actions.allowed()) actions.single();
      }
    },
    press() {
      clearRelease(); delivered = true;
      if (held) { held = false; return; }
      if (!actions.allowed()) { cancel(); return; }
      if (second && waitingAt != null) { cancel(); actions.double(); return; }
      cancel();
      waitingAt = Date.now();
      const expected = generation;
      timer = setTimeout(() => {
        if (generation !== expected) return;
        timer = null; waitingAt = null;
        if (actions.allowed()) actions.single();
      }, CALENDAR_BINDER_DOUBLE_TAP_MS);
    },
    // Raw touch-end is paired with the physical gesture. onPressOut cannot be
    // used here: Pressability may delay it until after a valid onPress.
    touchEnd() {
      if (delivered || held) return;
      clearRelease();
      const expected = gesture;
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        if (gesture === expected && !delivered) cancel();
      }, 0);
    },
    longPress() {
      if (held) return;
      cancel(); held = true; delivered = true;
      if (actions.allowed()) actions.long();
    },
    cancelPress() { cancel(); held = true; delivered = true; },
    cancel,
  };
}
