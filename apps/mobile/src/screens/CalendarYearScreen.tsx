import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';
import { calendarYearMonths } from '../utils/calendar-view-mode';
import { isDateKey, monthDateCells } from '../utils/date-selection';
import { addDays, dateKey, formatDayHeading, minuteIndexForDate, parseDateKey } from '../utils/time';
import type { CalendarViewFocusRequest } from '../utils/calendar-list-focus';

type Props = {
  focusRequest?: CalendarViewFocusRequest | null;
  activeDate: string;
  onOpenMinute: (day: string, minute: number) => void;
  onOpenMonth?: (month: string) => void;
};

export function CalendarYearScreen({ activeDate, focusRequest, onOpenMinute, onOpenMonth }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width, fontScale } = useWindowDimensions();
  const [today, setToday] = useState(() => dateKey(new Date()));
  const months = useMemo(() => calendarYearMonths(activeDate), [activeDate]);
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(addDays('2026-10-19', index))), []);
  const twoColumns = width >= 360 && fontScale <= 1.25;
  const compact = twoColumns && width < 720;
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const pendingFocus = useRef<CalendarViewFocusRequest | null>(null);
  const geometry = useMemo(() => ({ top: null as number | null, offsets: new Map<string, number>() }),
    [activeDate.slice(0, 4), twoColumns, width, fontScale]);
  const revealFocus = () => {
    const pending = pendingFocus.current;
    if (!pending || !scroll.current || geometry.top === null || AppState.currentState !== 'active') return;
    const offset = geometry.offsets.get(`${pending.dateKey.slice(0, 7)}-01`);
    if (offset === undefined) return;
    scroll.current.scrollTo({ y: geometry.top + offset, animated: false });
    pendingFocus.current = null;
  };
  useEffect(() => {
    pendingFocus.current = focusRequest && isDateKey(focusRequest.dateKey) ? focusRequest : null;
    revealFocus();
    return () => { pendingFocus.current = null; };
  }, [focusRequest?.token, focusRequest?.dateKey, geometry]);

  useEffect(() => {
    const update = () => setToday(dateKey(new Date()));
    const timer = setInterval(update, 60_000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') update(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);

  const openDay = (day: string) => {
    if (!isDateKey(day)) return;
    const now = new Date();
    onOpenMinute(day, day === dateKey(now) ? minuteIndexForDate(now) : 9 * 60);
  };

  return <ScrollView key={`${activeDate.slice(0, 4)}:${twoColumns}:${width}:${fontScale}`} ref={scroll} style={styles.container} contentContainerStyle={styles.content}
    onScrollBeginDrag={() => { pendingFocus.current = null; }}>
    <Text accessibilityRole="header" style={styles.year}>{activeDate.slice(0, 4)}</Text>
    <View style={styles.months} onLayout={(event) => { geometry.top = event.nativeEvent.layout.y; revealFocus(); }}>
      {months.map((month) => {
        const title = new Intl.DateTimeFormat(undefined, { month: 'long' }).format(parseDateKey(month));
        const cells = monthDateCells(month);
        return <View key={month} style={[styles.month, twoColumns && styles.halfMonth]}
          onLayout={(event) => { geometry.offsets.set(month, event.nativeEvent.layout.y); revealFocus(); }}>
          {onOpenMonth ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title} ${month.slice(0, 4)}`}
            onPress={() => onOpenMonth(month)} style={styles.monthTitleButton}>
            <Text style={[styles.monthTitle, compact && styles.compactMonthTitle]}>{title}</Text>
          </Pressable> : <Text accessibilityRole="header" style={[styles.monthTitle, compact && styles.compactMonthTitle]}>{title}</Text>}
          <View style={styles.weekRow}>{weekdays.map((weekday, index) =>
            <Text key={index} style={[styles.weekday, compact && styles.compactWeekday]}>{weekday}</Text>)}</View>
          {Array.from({ length: 6 }, (_, week) => <View key={week} style={styles.weekRow}>
            {cells.slice(week * 7, week * 7 + 7).map((cell) => cell.inMonth && isDateKey(cell.dateKey)
              ? <Pressable key={cell.dateKey} accessibilityRole="button" accessibilityLabel={`Open ${formatDayHeading(cell.dateKey)}, ${month.slice(0, 4)}`}
                  accessibilityState={{ selected: cell.dateKey === activeDate }} onPress={() => openDay(cell.dateKey)}
                  style={[styles.day, compact && styles.compactDay]}>
                  <View style={[styles.dayCircle, compact && styles.compactDayCircle,
                    cell.dateKey === activeDate && styles.selectedDay, cell.dateKey === today && styles.today]}>
                    <Text maxFontSizeMultiplier={1.5} style={[styles.dayNumber, compact && styles.compactDayNumber,
                      cell.dateKey === today && styles.todayNumber]}>{cell.day}</Text>
                  </View>
                </Pressable>
              : <View key={cell.dateKey} style={[styles.day, compact && styles.compactDay]} />)}
          </View>)}
        </View>;
      })}
    </View>
  </ScrollView>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: 12, paddingBottom: 24 },
  year: { color: colors.ink, fontSize: 26, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  months: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  month: { width: '100%', marginBottom: 22, paddingHorizontal: 2 },
  halfMonth: { width: '48%' },
  monthTitleButton: { minHeight: 44, justifyContent: 'center' },
  monthTitle: { color: colors.ink, fontSize: 18, fontWeight: '600' },
  compactMonthTitle: { fontSize: 15 },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, paddingVertical: 8, textAlign: 'center', color: colors.muted, fontSize: 12 },
  compactWeekday: { paddingVertical: 5, fontSize: 10 },
  day: { flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  compactDay: { minHeight: 26 },
  dayCircle: { minWidth: 32, minHeight: 32, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  compactDayCircle: { minWidth: 22, minHeight: 22, borderRadius: 12 },
  selectedDay: { backgroundColor: colors.selectedDay },
  today: { backgroundColor: colors.accent },
  dayNumber: { color: colors.ink, fontSize: 14, fontVariant: ['tabular-nums'] },
  compactDayNumber: { fontSize: 11 },
  todayNumber: { color: colors.onAccent, fontWeight: '700' },
});
