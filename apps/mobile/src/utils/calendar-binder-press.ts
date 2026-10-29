/** A released tap goes straight to Now. Holding opens view choices and consumes
 * that release, so a held icon cannot also navigate underneath its menu. */
export function createCalendarBinderPress(actions: {
  allowed: () => boolean;
  single: () => void;
  long: () => void;
}) {
  let gesture = 0;
  let delivered = false;
  let cancelled = false;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  const clearRelease = () => { if (releaseTimer != null) clearTimeout(releaseTimer); releaseTimer = null; };
  function cancel() { clearRelease(); cancelled = true; delivered = true; gesture += 1; }
  return {
    pressIn() {
      clearRelease(); gesture += 1; delivered = false; cancelled = false;
    },
    press() {
      clearRelease();
      if (cancelled || delivered) return;
      delivered = true;
      if (!actions.allowed()) { cancel(); return; }
      actions.single();
    },
    // Raw touch-end is paired with the physical gesture. onPressOut cannot be
    // used here: Pressability may delay it until after a valid onPress.
    touchEnd() {
      if (delivered || cancelled) return;
      clearRelease();
      const expected = gesture;
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        if (gesture === expected && !delivered) cancel();
      }, 0);
    },
    longPress() {
      if (cancelled || delivered) return;
      cancel();
      if (actions.allowed()) actions.long();
    },
    cancelPress: cancel,
    cancel,
  };
}
