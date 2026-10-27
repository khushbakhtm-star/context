import assert from 'node:assert/strict';
import test from 'node:test';
import { createCalendarPeriodSwipe } from '../src/utils/calendar-period-swipe';

test('horizontal motion pages exactly once in the matching direction, but a short flick does not change dates', () => {
  const swipe = createCalendarPeriodSwipe(); swipe.start(1);
  assert.equal(swipe.move({ dx: -24, dy: 2, numberActiveTouches: 1 }), true);
  assert.equal(swipe.finish({ dx: -80, dy: 7, numberActiveTouches: 0 }), 1);
  assert.equal(swipe.finish({ dx: -80, dy: 7, numberActiveTouches: 0 }), null);
  swipe.start(1); swipe.move({ dx: 35, dy: 0, numberActiveTouches: 1 });
  assert.equal(swipe.finish({ dx: 35, dy: 0, numberActiveTouches: 0 }), null);
  swipe.start(1); swipe.move({ dx: 30, dy: 2, numberActiveTouches: 1 });
  assert.equal(swipe.finish({ dx: 90, dy: 2, numberActiveTouches: 0 }), -1);
});
test('vertical scroll, selection/edit/menu ownership, multi-touch and cancelled contacts cannot become period swipes', () => {
  for (const reason of ['vertical', 'blocked-start', 'blocked-move', 'pinch', 'cancel']) {
    const swipe = createCalendarPeriodSwipe(); swipe.start(1, reason === 'blocked-start');
    if (reason === 'vertical') assert.equal(swipe.move({ dx: 3, dy: 16, numberActiveTouches: 1 }), false);
    if (reason === 'blocked-move') swipe.move({ dx: 24, dy: 0, numberActiveTouches: 1 }, true);
    if (reason === 'pinch') swipe.move({ dx: 24, dy: 0, numberActiveTouches: 2 });
    if (reason === 'cancel') swipe.cancel();
    assert.equal(swipe.move({ dx: 100, dy: 0, numberActiveTouches: 1 }), false, reason);
    assert.equal(swipe.finish({ dx: 100, dy: 0, numberActiveTouches: 0 }), null, reason);
  }
  const lateBlock = createCalendarPeriodSwipe(); lateBlock.start(1); lateBlock.move({ dx: 30, dy: 0, numberActiveTouches: 1 });
  assert.equal(lateBlock.finish({ dx: 100, dy: 0, numberActiveTouches: 0 }, true), null);
});
