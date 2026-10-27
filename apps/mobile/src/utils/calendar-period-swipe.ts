export type CalendarSwipeGesture = { dx: number; dy: number; numberActiveTouches: number };
export type CalendarPeriodDirection = -1 | 1;

/** A one-finger horizontal page gesture. Once vertical motion or multi-touch wins,
 * the same contact cannot later become navigation. Selection/drag owns its contact. */
export function createCalendarPeriodSwipe() {
  let state: 'idle' | 'pending' | 'horizontal' | 'blocked' = 'idle';
  return {
    start(touches: number, blocked = false) { state = blocked || touches !== 1 ? 'blocked' : 'pending'; },
    move(gesture: CalendarSwipeGesture, blocked = false): boolean {
      if (blocked || gesture.numberActiveTouches !== 1) state = 'blocked';
      if (state === 'idle' || state === 'blocked') return false;
      const x = Math.abs(gesture.dx), y = Math.abs(gesture.dy);
      if (y >= 12 && y >= x / 1.7) { state = 'blocked'; return false; }
      if (state === 'pending' && x >= 20 && x > y * 1.7) state = 'horizontal';
      return state === 'horizontal';
    },
    finish(gesture: CalendarSwipeGesture, blocked = false): CalendarPeriodDirection | null {
      const permitted = !blocked && state === 'horizontal' && gesture.numberActiveTouches === 0 &&
        Math.abs(gesture.dx) >= 56 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.7;
      state = 'idle'; return permitted ? gesture.dx < 0 ? 1 : -1 : null;
    },
    cancel() { state = 'blocked'; },
    get claimed() { return state === 'horizontal'; },
  };
}
