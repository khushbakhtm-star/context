import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';
import { calendarYearMonths } from '../utils/calendar-view-mode';
import { isDateKey, monthDateCells } from '../utils/date-selection';
import { addDays, dateKey, formatDayHeading, minuteIndexForDate, parseDateKey } from '../utils/time';
import type { CalendarViewFocusRequest } from '../utils/calendar-list-focus';
import { calendarYearLayout } from '../utils/calendar-year-layout';

type Props = {
  focusRequest?: CalendarViewFocusRequest | null;
  activeDate: string;
  onOpenMinute: (day: string, minute: number) => void;
  onOpenMonth?: (month: string) => void;
  onFocusedMinuteChange?: (focus: { dateKey: string; minuteIndex: number }) => void;
};

export function CalendarYearScreen({ activeDate, focusRequest, onOpenMinute, onOpenMonth, onFocusedMinuteChange }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width, height, fontScale } = useWindowDimensions();
  const [viewport, setViewport] = useState({ width, height: Math.max(240, height - 100) });
  const [zoom, setZoom] = useState(1);
  const layout = calendarYearLayout(viewport.width, viewport.height, zoom, fontScale);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const [today, setToday] = useState(() => dateKey(new Date()));
  const months = useMemo(() => calendarYearMonths(activeDate), [activeDate]);
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(addDays('2026-10-19', index))), []);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const pendingFocus = useRef<CalendarViewFocusRequest | null>(null);
  const manuallyCancelledFocus = useRef<number | null>(null);
  const focusToken = useRef(focusRequest?.token);
  focusToken.current = focusRequest?.token;
  const geometry = useMemo(() => ({ top: null as number | null, offsets: new Map<string, number>() }),
    [activeDate.slice(0, 4), viewport.width, viewport.height, zoom, fontScale]);
  const gesture = useMemo(() => {
    const distance = (touches: readonly { pageX: number; pageY: number }[]) => touches.length === 2
      ? Math.hypot(touches[0]!.pageX - touches[1]!.pageX, touches[0]!.pageY - touches[1]!.pageY) : 0;
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length === 2,
      onPanResponderGrant: (event) => {
        pendingFocus.current = null;
        manuallyCancelledFocus.current = focusToken.current ?? null;
        const span = distance(event.nativeEvent.touches);
        pinch.current = span > 0 ? { distance: span, zoom: zoomRef.current } : null;
      },
      onPanResponderMove: (event) => {
        const start = pinch.current;
        const span = distance(event.nativeEvent.touches);
        if (AppState.currentState !== 'active' || !start || !span) { pinch.current = null; return; }
        setZoom(Math.max(0.7, Math.min(2.5, start.zoom * span / start.distance)));
      },
      onPanResponderRelease: () => { pinch.current = null; },
      onPanResponderTerminate: () => { pinch.current = null; },
      onPanResponderTerminationRequest: () => false,
    });
  }, []);
  const revealFocus = () => {
    const pending = pendingFocus.current;
    if (!pending || !scroll.current || geometry.top === null || AppState.currentState !== 'active') return;
    const offset = geometry.offsets.get(`${pending.dateKey.slice(0, 7)}-01`);
    if (offset === undefined) return;
    scroll.current.scrollTo({ y: Math.min(layout.maxScroll, Math.max(0, geometry.top + offset)), animated: false });
    pendingFocus.current = null;
  };
  useEffect(() => {
    pendingFocus.current = focusRequest && focusRequest.token !== manuallyCancelledFocus.current && isDateKey(focusRequest.dateKey)
      ? focusRequest : null;
    revealFocus();
    return () => { pendingFocus.current = null; };
  }, [focusRequest?.token, focusRequest?.dateKey, geometry]);

  useEffect(() => {
    const update = () => setToday(dateKey(new Date()));
    const timer = setInterval(update, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') update(); else pinch.current = null;
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  useEffect(() => { pinch.current = null; }, [activeDate.slice(0, 4)]);

  const openDay = (day: string) => {
    if (!isDateKey(day)) return;
    const now = new Date();
    const minute = focusRequest?.dateKey === day && Number.isInteger(focusRequest.minuteIndex)
      ? Math.max(0, Math.min(1439, focusRequest.minuteIndex!))
      : day === dateKey(now) ? minuteIndexForDate(now) : 9 * 60;
    onFocusedMinuteChange?.({ dateKey: day, minuteIndex: minute });
    onOpenMinute(day, minute);
  };

  return <View style={styles.container} {...gesture.panHandlers} onLayout={(event) => {
    const size = event.nativeEvent.layout;
    if (size.width > 0 && size.height > 0) setViewport((previous) => previous.width === size.width && previous.height === size.height
      ? previous : { width: size.width, height: size.height });
  }}>
    <ScrollView key={`${activeDate.slice(0, 4)}:${viewport.width}:${viewport.height}:${fontScale}`} ref={scroll}
      horizontal={false} showsHorizontalScrollIndicator={false} style={styles.container}
      contentContainerStyle={[styles.content, { paddingHorizontal: layout.horizontalPadding }]}
      onScrollBeginDrag={() => { pendingFocus.current = null; manuallyCancelledFocus.current = focusToken.current ?? null; }}>
    <Text accessibilityRole="header" style={[styles.year, { height: layout.headerHeight }]}>{activeDate.slice(0, 4)}</Text>
    <View style={[styles.months, { gap: layout.gap }]} onLayout={(event) => { geometry.top = event.nativeEvent.layout.y; revealFocus(); }}>
      {months.map((month) => {
        const title = new Intl.DateTimeFormat(undefined, { month: 'long' }).format(parseDateKey(month));
        const cells = monthDateCells(month);
        return <View key={month} style={[styles.month, { width: layout.monthWidth, height: layout.monthHeight }]}
          onLayout={(event) => { geometry.offsets.set(month, event.nativeEvent.layout.y); revealFocus(); }}>
          {onOpenMonth ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title} ${month.slice(0, 4)}`}
            onPress={() => onOpenMonth(month)} style={[styles.monthTitleButton, { height: layout.titleHeight }]}>
            <Text allowFontScaling={false} numberOfLines={1} style={[styles.monthTitle, { fontSize: layout.titleFont }]}>{title}</Text>
          </Pressable> : <Text accessibilityRole="header" allowFontScaling={false} numberOfLines={1}
            style={[styles.monthTitle, { fontSize: layout.titleFont, height: layout.titleHeight }]}>{title}</Text>}
          <View style={[styles.weekRow, { height: layout.weekdayHeight }]}>{weekdays.map((weekday, index) =>
            <Text key={index} allowFontScaling={false} style={[styles.weekday, { fontSize: layout.weekdayFont }]}>{weekday}</Text>)}</View>
          {Array.from({ length: 6 }, (_, week) => <View key={week} style={styles.weekRow}>
            {cells.slice(week * 7, week * 7 + 7).map((cell) => cell.inMonth && isDateKey(cell.dateKey)
              ? <Pressable key={cell.dateKey} accessibilityRole="button" accessibilityLabel={`Open ${formatDayHeading(cell.dateKey)}, ${month.slice(0, 4)}`}
                  accessibilityState={{ selected: cell.dateKey === activeDate }} onPress={() => openDay(cell.dateKey)}
                  style={[styles.day, { height: layout.dayHeight }]}>
                  <View style={[styles.dayCircle, { width: layout.circleSize, height: layout.circleSize, borderRadius: layout.circleSize / 2 },
                    cell.dateKey === today && styles.today]}>
                    <Text allowFontScaling={false} style={[styles.dayNumber, { fontSize: layout.dayFont },
                      cell.dateKey === today && styles.todayNumber]}>{cell.day}</Text>
                  </View>
                </Pressable>
              : <View key={cell.dateKey} style={[styles.day, { height: layout.dayHeight }]} />)}
          </View>)}
        </View>;
      })}
    </View>
    </ScrollView>
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: 8 },
  year: { color: colors.ink, fontSize: 22, fontWeight: '600', textAlignVertical: 'center' },
  months: { flexDirection: 'row', flexWrap: 'wrap' },
  month: { paddingHorizontal: 2, overflow: 'hidden' },
  monthTitleButton: { justifyContent: 'center' },
  monthTitle: { color: colors.ink, fontWeight: '600', textAlignVertical: 'center' },
  weekRow: { flexDirection: 'row', alignItems: 'center' },
  weekday: { flex: 1, textAlign: 'center', color: colors.muted },
  day: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  dayCircle: { alignItems: 'center', justifyContent: 'center' },
  today: { backgroundColor: colors.accent },
  dayNumber: { color: colors.ink, fontVariant: ['tabular-nums'] },
  todayNumber: { color: colors.onAccent, fontWeight: '700' },
});
