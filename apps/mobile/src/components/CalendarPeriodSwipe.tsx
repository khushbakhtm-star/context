import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { AppState, PanResponder, View } from 'react-native';
import { createCalendarPeriodSwipe, type CalendarPeriodDirection } from '../utils/calendar-period-swipe';

/** Non-minute calendar pages retain vertical scrolling and child taps. */
export function CalendarPeriodSwipe({ children, enabled = true, onPage, scope = '' }: {
  children: ReactNode; enabled?: boolean; scope?: string; onPage: (direction: CalendarPeriodDirection) => void;
}) {
  const current = useRef({ enabled, onPage }); current.current = { enabled, onPage };
  const swipe = useRef(createCalendarPeriodSwipe()).current;
  const previousScope = useRef(scope);
  if (previousScope.current !== scope) { previousScope.current = scope; swipe.cancel(); }
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => { if (next !== 'active') swipe.cancel(); });
    return () => { listener.remove(); swipe.cancel(); };
  }, [swipe]);
  const blocked = () => !current.current.enabled || AppState.currentState !== 'active';
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: (event) => { swipe.start(event.nativeEvent.touches.length, blocked()); return false; },
    onMoveShouldSetPanResponderCapture: (_event, gesture) => swipe.move(gesture, blocked()),
    onPanResponderRelease: (_event, gesture) => { const direction = swipe.finish(gesture, blocked()); if (direction) current.current.onPage(direction); },
    onPanResponderTerminate: () => swipe.cancel(), onPanResponderReject: () => swipe.cancel(),
    onPanResponderTerminationRequest: () => false, onShouldBlockNativeResponder: () => true,
  }), [swipe]);
  return <View style={{ flex: 1 }} {...responder.panHandlers}>{children}</View>;
}
