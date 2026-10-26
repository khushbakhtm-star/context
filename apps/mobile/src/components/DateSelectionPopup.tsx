import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { AppState, Keyboard, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
  type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';
import { isDateKey, monthDateCells, normalizeSelectedDates, shiftCalendarMonth, toggleSelectedDate } from '../utils/date-selection';
import { dateKey, formatDayHeading, parseDateKey } from '../utils/time';
import { anchoredDateRange, dateAtGridPoint, isContiguousDateRange, MAX_RANGE_DAYS, rangeGestureSelection, rangeMonthPageTarget,
  type DateGridCellRect } from '../utils/date-range-selection';
import { InfoButton } from './InfoButton';

type SelectionMode = 'pick' | 'range';
type Rect = { x: number; y: number; width: number; height: number };
type GridGeometry = { grid: Rect; clip: Rect; cells: DateGridCellRect[] };
type RangeGesture = { anchor: string; before: string[]; beforeTapped: boolean; beforeMonth: string; beforeScroll: number;
  sequence: number; point: { x: number; y: number }; paging: boolean; scrolling: boolean;
  edge: { direction: -1 | 1; since: number } | null };

type Props = {
  visible: boolean;
  selectedDates: readonly string[];
  anchorDate?: string;
  singleDate?: boolean;
  onApply: (dates: string[]) => void;
  onClose: () => void;
};

export function DateSelectionPopup({ visible, selectedDates, anchorDate, singleDate = false, onApply, onClose }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [draft, setDraft] = useState<string[]>([]);
  const [month, setMonth] = useState(dateKey(new Date()));
  const [mode, setMode] = useState<SelectionMode>('pick');
  const [rangeActive, setRangeActive] = useState(false);
  const dateTappedRef = useRef(false);
  const draftRef = useRef<string[]>([]);
  const modeRef = useRef<SelectionMode>('pick');
  const singleDateRef = useRef(singleDate);
  const visibleRef = useRef(visible);
  const mountedRef = useRef(true);
  const savedPickRef = useRef<{ dates: string[]; tapped: boolean } | null>(null);
  const rangeRef = useRef<RangeGesture | null>(null);
  const physicalRangeTouchRef = useRef(false);
  const physicalTouchSequence = useRef(0);
  const edgeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gestureSequence = useRef(0);
  const measurementSequence = useRef(0);
  const geometryRef = useRef<GridGeometry | null>(null);
  const gridRef = useRef<ComponentRef<typeof View>>(null);
  const verticalScrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const horizontalScrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const verticalOffsetRef = useRef(0);
  const verticalSizeRef = useRef({ viewport: 0, content: 0 });
  const horizontalOffsetRef = useRef(0);
  const monthRef = useRef(month);
  modeRef.current = mode;
  singleDateRef.current = singleDate;
  visibleRef.current = visible;
  monthRef.current = month;
  const selectedKey = selectedDates.join('|');
  const selected = useMemo(() => new Set(draft), [draft]);
  const cells = useMemo(() => monthDateCells(month), [month]);
  const cellsRef = useRef(cells);
  const renderedMonthRef = useRef(month);
  cellsRef.current = cells;
  renderedMonthRef.current = month;
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, index) => cells.slice(index * 7, index * 7 + 7)), [cells]);

  function writeDraft(dates: string[]) {
    if (dates.length === draftRef.current.length && dates.every((day, index) => day === draftRef.current[index])) return;
    draftRef.current = dates;
    if (mountedRef.current) setDraft(dates);
  }

  function cancelRange() {
    const gesture = rangeRef.current;
    rangeRef.current = null;
    gestureSequence.current += 1;
    if (edgeTimerRef.current) { clearInterval(edgeTimerRef.current); edgeTimerRef.current = null; }
    if (gesture) {
      writeDraft(gesture.before);
      dateTappedRef.current = gesture.beforeTapped;
      if (mountedRef.current && monthRef.current !== gesture.beforeMonth) {
        monthRef.current = gesture.beforeMonth;
        setMonth(gesture.beforeMonth);
        invalidateGeometry();
      }
      if (gesture.scrolling) verticalScrollRef.current?.scrollTo({ y: gesture.beforeScroll, animated: false });
      requestAnimationFrame(() => { if (mountedRef.current && visibleRef.current && !rangeRef.current) measureGeometry(); });
    }
    if (mountedRef.current) setRangeActive(false);
  }

  function invalidateGeometry() {
    measurementSequence.current += 1;
    geometryRef.current = null;
  }

  function measureGeometry(keepGesture = false) {
    if (!visibleRef.current || !mountedRef.current) return;
    if (!keepGesture) cancelRange();
    invalidateGeometry();
    const sequence = measurementSequence.current;
    const gesture = keepGesture ? rangeRef.current : null;
    const renderedMonth = renderedMonthRef.current;
    const renderedCells = cellsRef.current;
    if (gesture?.paging && monthRef.current !== renderedMonth) return;
    const measurements: Rect[] = [];
    const elements = [gridRef.current, verticalScrollRef.current, horizontalScrollRef.current];
    if (elements.some((element) => !element)) return;
    elements.forEach((element, index) => element!.measureInWindow((x, y, measuredWidth, measuredHeight) => {
      if (!mountedRef.current || !visibleRef.current || sequence !== measurementSequence.current) return;
      if (renderedMonth !== renderedMonthRef.current || renderedMonth !== monthRef.current) return;
      if (gesture && (rangeRef.current !== gesture || gesture.sequence !== gestureSequence.current)) return;
      if (![x, y, measuredWidth, measuredHeight].every(Number.isFinite) || measuredWidth <= 0 || measuredHeight <= 0) return;
      measurements[index] = { x, y, width: measuredWidth, height: measuredHeight };
      if (!measurements[0] || !measurements[1] || !measurements[2]) return;
      const grid = measurements[0];
      const left = Math.max(...measurements.map((rect) => rect.x));
      const top = Math.max(...measurements.map((rect) => rect.y));
      const right = Math.min(...measurements.map((rect) => rect.x + rect.width));
      const bottom = Math.min(...measurements.map((rect) => rect.y + rect.height));
      if (right <= left || bottom <= top) return;
      geometryRef.current = { grid, clip: { x: left, y: top, width: right - left, height: bottom - top },
        cells: renderedCells.map((cell, cellIndex) => ({ dateKey: cell.dateKey,
          x: grid.x + cellIndex % 7 * grid.width / 7, y: grid.y + Math.floor(cellIndex / 7) * grid.height / 6,
          width: grid.width / 7, height: grid.height / 6 })) };
      if (gesture) {
        gesture.paging = false;
        updateRangeAtPoint(gesture.point.x, gesture.point.y);
      }
    }));
  }

  function visibleCellRects(x: number, y: number): DateGridCellRect[] {
    const geometry = geometryRef.current;
    if (!geometry || x < geometry.clip.x || y < geometry.clip.y ||
        x >= geometry.clip.x + geometry.clip.width || y >= geometry.clip.y + geometry.clip.height) return [];
    return geometry.cells;
  }

  function updateRangeAtPoint(x: number, y: number) {
    const gesture = rangeRef.current;
    if (!gesture || gesture.paging || gesture.sequence !== gestureSequence.current) return;
    const next = rangeGestureSelection(gesture.anchor, x, y, visibleCellRects(x, y));
    if (next) writeDraft(next);
  }

  function advanceRangeEdge() {
    const gesture = rangeRef.current;
    const geometry = geometryRef.current;
    if (!gesture || !geometry || gesture.paging || gesture.sequence !== gestureSequence.current) return;
    if (!visibleRef.current || AppState.currentState !== 'active' || modeRef.current !== 'range') { cancelRange(); return; }
    const { x, y } = gesture.point;
    const { grid, clip } = geometry;
    if (x < clip.x || x >= clip.x + clip.width || y < clip.y || y >= clip.y + clip.height) {
      gesture.edge = null; return;
    }
    const direction: -1 | 1 | null = y < clip.y + 14 ? -1 : y >= clip.y + clip.height - 14 ? 1 : null;
    if (!direction) { gesture.edge = null; return; }
    // Reveal clipped weeks first on short screens. Manual scrolling stays disabled during the drag.
    const clipped = direction < 0 ? grid.y < clip.y - 0.5 : grid.y + grid.height > clip.y + clip.height + 0.5;
    const maxOffset = Math.max(0, verticalSizeRef.current.content - verticalSizeRef.current.viewport);
    const nextOffset = Math.max(0, Math.min(maxOffset, verticalOffsetRef.current + direction * 10));
    if (clipped && Math.abs(nextOffset - verticalOffsetRef.current) > 0.5) {
      gesture.edge = null;
      gesture.scrolling = true;
      invalidateGeometry();
      verticalScrollRef.current?.scrollTo({ y: nextOffset, animated: false });
      requestAnimationFrame(() => {
        if (rangeRef.current === gesture && gesture.sequence === gestureSequence.current) measureGeometry(true);
      });
      return;
    }
    // A held edge can cross a month without ever selecting a hidden date cell.
    if (draftRef.current.length >= MAX_RANGE_DAYS && (direction < 0 ? draftRef.current[0]! < gesture.anchor :
        draftRef.current[draftRef.current.length - 1]! > gesture.anchor)) { gesture.edge = null; return; }
    if (gesture.edge?.direction !== direction) { gesture.edge = { direction, since: Date.now() }; return; }
    if (Date.now() - gesture.edge.since < 650) return;
    const target = rangeMonthPageTarget(gesture.anchor, monthRef.current, direction);
    gesture.edge = null;
    if (!target) return;
    gesture.paging = true;
    invalidateGeometry();
    monthRef.current = target;
    setMonth(target);
  }

  function point(event: GestureResponderEvent, released = false) {
    const touches = event.nativeEvent.touches;
    if (touches.length === 1) return touches[0] ?? null;
    return released && touches.length === 0 && event.nativeEvent.changedTouches.length === 1
      ? event.nativeEvent.changedTouches[0] ?? null : null;
  }

  function endPhysicalTouch(event: GestureResponderEvent, cancelled = false) {
    if (!cancelled && event.nativeEvent.touches.length) return;
    const sequence = physicalTouchSequence.current;
    requestAnimationFrame(() => { if (sequence === physicalTouchSequence.current) physicalRangeTouchRef.current = false; });
  }

  function selectAccessibleRangeDay(day: string) {
    if (rangeRef.current || !visibleRef.current || AppState.currentState !== 'active' || !isDateKey(day)) return;
    dateTappedRef.current = true;
    savedPickRef.current = null;
    writeDraft(anchoredDateRange(day, day));
  }

  function rangeMayStart(event: GestureResponderEvent) {
    if (singleDateRef.current || rangeRef.current || modeRef.current !== 'range' || !visibleRef.current || AppState.currentState !== 'active') return false;
    const touch = point(event);
    return Boolean(touch && dateAtGridPoint(touch.pageX, touch.pageY, visibleCellRects(touch.pageX, touch.pageY)));
  }

  function updateRange(event: GestureResponderEvent, released = false) {
    const gesture = rangeRef.current;
    if (!gesture || gesture.sequence !== gestureSequence.current) return;
    if (event.nativeEvent.touches.length > 1 || !visibleRef.current || AppState.currentState !== 'active' || modeRef.current !== 'range') {
      cancelRange(); return;
    }
    const touch = point(event, released);
    if (!touch) return;
    gesture.point = { x: touch.pageX, y: touch.pageY };
    updateRangeAtPoint(touch.pageX, touch.pageY);
  }

  const rangeResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: rangeMayStart,
    onStartShouldSetPanResponder: rangeMayStart,
    onPanResponderGrant: (event) => {
      const touch = point(event);
      const anchor = touch && dateAtGridPoint(touch.pageX, touch.pageY, visibleCellRects(touch.pageX, touch.pageY));
      if (!anchor || !rangeMayStart(event)) { cancelRange(); return; }
      rangeRef.current = { anchor, before: [...draftRef.current], beforeTapped: dateTappedRef.current,
        beforeMonth: monthRef.current, beforeScroll: verticalOffsetRef.current, sequence: ++gestureSequence.current,
        point: { x: touch!.pageX, y: touch!.pageY }, paging: false, scrolling: false, edge: null };
      dateTappedRef.current = true;
      setRangeActive(true);
      writeDraft(anchoredDateRange(anchor, anchor));
      edgeTimerRef.current = setInterval(advanceRangeEdge, 80);
    },
    onPanResponderStart: (event) => { if (event.nativeEvent.touches.length !== 1) cancelRange(); },
    onPanResponderMove: (event) => updateRange(event),
    onPanResponderRelease: (event) => {
      updateRange(event, true);
      if (!rangeRef.current) return;
      rangeRef.current = null;
      gestureSequence.current += 1;
      if (edgeTimerRef.current) { clearInterval(edgeTimerRef.current); edgeTimerRef.current = null; }
      savedPickRef.current = null;
      setRangeActive(false);
      requestAnimationFrame(() => { if (!rangeRef.current) measureGeometry(); });
    },
    onPanResponderTerminationRequest: () => rangeRef.current == null,
    onPanResponderTerminate: cancelRange,
    onPanResponderReject: cancelRange,
    onShouldBlockNativeResponder: () => true,
  }), []);

  function changeMode(next: SelectionMode) {
    if (next === modeRef.current) return;
    cancelRange();
    invalidateGeometry();
    physicalRangeTouchRef.current = false;
    physicalTouchSequence.current += 1;
    if (next === 'range' && !isContiguousDateRange(draftRef.current)) {
      savedPickRef.current = { dates: [...draftRef.current], tapped: dateTappedRef.current };
      writeDraft([]);
    } else if (next === 'pick' && savedPickRef.current) {
      writeDraft(savedPickRef.current.dates);
      dateTappedRef.current = savedPickRef.current.tapped;
      savedPickRef.current = null;
    }
    modeRef.current = next;
    if (next === 'range') horizontalScrollRef.current?.scrollTo({ x: 0, animated: false });
    setMode(next);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; rangeRef.current = null; gestureSequence.current += 1; invalidateGeometry();
      if (edgeTimerRef.current) { clearInterval(edgeTimerRef.current); edgeTimerRef.current = null; } };
  }, []);

  useEffect(() => {
    cancelRange();
    invalidateGeometry();
    physicalRangeTouchRef.current = false;
    physicalTouchSequence.current += 1;
    if (!visible) return;
    verticalOffsetRef.current = 0;
    horizontalOffsetRef.current = 0;
    verticalSizeRef.current = { viewport: 0, content: 0 };
    verticalScrollRef.current?.scrollTo({ y: 0, animated: false });
    horizontalScrollRef.current?.scrollTo({ x: 0, animated: false });
    Keyboard.dismiss();
    dateTappedRef.current = false;
    const dates = normalizeSelectedDates(selectedDates).slice(0, singleDate ? 1 : undefined);
    if (singleDate) { modeRef.current = 'pick'; setMode('pick'); }
    const needsRange = modeRef.current === 'range' && !isContiguousDateRange(dates);
    savedPickRef.current = needsRange ? { dates, tapped: false } : null;
    writeDraft(needsRange ? [] : dates);
    setMonth(isDateKey(anchorDate) ? anchorDate : dates[0] ?? dateKey(new Date()));
    requestAnimationFrame(() => measureGeometry());
  }, [visible, selectedKey, anchorDate, singleDate]);

  useEffect(() => {
    cancelRange(); invalidateGeometry();
    if (visible) requestAnimationFrame(() => measureGeometry());
  }, [width, height]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      cancelRange(); invalidateGeometry();
      physicalRangeTouchRef.current = false;
      physicalTouchSequence.current += 1;
      if (state === 'active' && visibleRef.current) requestAnimationFrame(() => measureGeometry());
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!visibleRef.current) return;
    const gesture = rangeRef.current;
    requestAnimationFrame(() => {
      if (gesture ? rangeRef.current === gesture && gesture.sequence === gestureSequence.current : !rangeRef.current) {
        measureGeometry(Boolean(gesture));
      }
    });
  }, [month, mode]);

  const today = dateKey(new Date());
  const cardWidth = Math.min(480, Math.max(240, width - 24));
  const gridWidth = mode === 'range' ? cardWidth - 24 : Math.max(308, cardWidth - 24);
  const monthTitle = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(parseDateKey(month));
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(undefined, { weekday: 'narrow' })
    .format(new Date(2026, 0, 5 + index, 12)));
  const close = () => { cancelRange(); invalidateGeometry(); onClose(); };
  const canApply = draft.length > 0 && (!singleDate || draft.length === 1) && !rangeActive && (mode === 'pick' || isContiguousDateRange(draft));
  const apply = () => {
    if (rangeRef.current || !canApply) return;
    if (!dateTappedRef.current) { close(); return; }
    if (draft.length) onApply(normalizeSelectedDates(draft));
  };

  if (!visible) return null;
  return <Modal visible transparent animationType="fade" onRequestClose={close} onShow={() => measureGeometry()}>
    <View style={[styles.overlay, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <Pressable accessible={false} style={styles.backdrop} onPress={close} />
      <View accessibilityViewIsModal onAccessibilityEscape={close} style={[styles.card,
        { width: cardWidth, maxHeight: Math.max(180, height - insets.top - insets.bottom - 32) }]}>
        <ScrollView ref={verticalScrollRef} bounces={false} scrollEnabled={!rangeActive} scrollEventThrottle={16}
          onScroll={(event) => {
            const offset = event.nativeEvent.contentOffset.y;
            const changed = Math.abs(offset - verticalOffsetRef.current) > 0.5;
            verticalOffsetRef.current = offset;
            if (changed) measureGeometry(Boolean(rangeRef.current?.scrolling));
          }} onLayout={(event) => { verticalSizeRef.current.viewport = event.nativeEvent.layout.height;
            measureGeometry(Boolean(rangeRef.current?.paging || rangeRef.current?.scrolling)); }}
          onContentSizeChange={(_contentWidth, contentHeight) => {
            verticalSizeRef.current.content = contentHeight;
            measureGeometry(Boolean(rangeRef.current?.paging || rangeRef.current?.scrolling));
          }} contentContainerStyle={styles.content}>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={styles.title}>{singleDate ? 'Select date' : 'Select dates'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close date selection" style={styles.iconButton} onPress={close}>
              <Text allowFontScaling={false} style={styles.close}>×</Text>
            </Pressable>
          </View>
          <View style={styles.monthRow}>
            <Text accessibilityRole="header" style={styles.month}>{monthTitle}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous month" style={styles.iconButton}
              disabled={rangeActive || shiftCalendarMonth(month, -1) === month}
              onPress={() => { cancelRange(); invalidateGeometry(); setMonth((value) => shiftCalendarMonth(value, -1)); }}>
              <Text allowFontScaling={false} style={styles.arrow}>‹</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next month" style={styles.iconButton}
              disabled={rangeActive || shiftCalendarMonth(month, 1) === month}
              onPress={() => { cancelRange(); invalidateGeometry(); setMonth((value) => shiftCalendarMonth(value, 1)); }}>
              <Text allowFontScaling={false} style={styles.arrow}>›</Text>
            </Pressable>
          </View>
          <ScrollView ref={horizontalScrollRef} horizontal showsHorizontalScrollIndicator={false} bounces={false}
            scrollEnabled={mode === 'pick' && !rangeActive} scrollEventThrottle={16}
            onScroll={(event) => {
              const offset = event.nativeEvent.contentOffset.x;
              const changed = Math.abs(offset - horizontalOffsetRef.current) > 0.5;
              horizontalOffsetRef.current = offset;
              if (changed) measureGeometry();
            }} onLayout={() => measureGeometry(Boolean(rangeRef.current?.paging))}>
          <View style={{ width: gridWidth }}>
          <View style={styles.week}>
            {weekdays.map((day, index) => <Text key={index} maxFontSizeMultiplier={1.4} style={styles.weekday}>{day}</Text>)}
          </View>
          <View ref={gridRef} collapsable={false} onLayout={() => measureGeometry(Boolean(rangeRef.current?.paging))}
            onTouchStart={(event) => {
              if (modeRef.current !== 'range') return;
              physicalRangeTouchRef.current = true;
              physicalTouchSequence.current += 1;
              if (event.nativeEvent.touches.length > 1) cancelRange();
            }} onTouchEnd={endPhysicalTouch} onTouchCancel={(event) => { cancelRange(); endPhysicalTouch(event, true); }}
            {...rangeResponder.panHandlers}>
          {weeks.map((week, index) => <View key={index} style={styles.week}>
            {week.map((cell, column) => <Pressable key={column} accessibilityRole="checkbox" disabled={!isDateKey(cell.dateKey)}
              accessibilityLabel={formatDayHeading(cell.dateKey) + ', ' + cell.dateKey.slice(0, 4) + (cell.dateKey === today ? ', today' : '')}
              accessibilityState={{ checked: selected.has(cell.dateKey) }}
              accessibilityActions={mode === 'range' ? [{ name: 'activate', label: 'Select this date' }] : undefined}
              onAccessibilityAction={(event) => {
                if (modeRef.current === 'range' && event.nativeEvent.actionName === 'activate') selectAccessibleRangeDay(cell.dateKey);
              }}
              onPress={() => {
                if (singleDateRef.current) {
                  dateTappedRef.current = true;
                  writeDraft([cell.dateKey]);
                  return;
                }
                if (modeRef.current === 'range') {
                  // Physical Range input belongs exclusively to the grid responder.
                  // In particular, a rejected two-finger gesture must not become a date tap.
                  if (!physicalRangeTouchRef.current) selectAccessibleRangeDay(cell.dateKey);
                  return;
                }
                const startNewSelection = !dateTappedRef.current;
                dateTappedRef.current = true;
                writeDraft(toggleSelectedDate(draftRef.current, cell.dateKey, startNewSelection));
              }}
              style={({ pressed }) => [styles.day, pressed && styles.pressed]}>
              <View style={[styles.dayCircle, mode === 'range' && { minWidth: 0, width: Math.min(36, gridWidth / 7 - 4) },
                cell.dateKey === today && styles.today,
                selected.has(cell.dateKey) && styles.selected]}>
                <Text maxFontSizeMultiplier={mode === 'range' ? 1.2 : 1.4} style={[styles.dayText, !cell.inMonth && styles.otherMonth,
                  selected.has(cell.dateKey) && styles.selectedText]}>{cell.day}</Text>
              </View>
            </Pressable>)}
          </View>)}
          </View>
          </View>
          </ScrollView>
          {!singleDate ? <View style={styles.selectionRow}>
            <Text accessibilityLiveRegion="polite" numberOfLines={1} maxFontSizeMultiplier={1.3}
              style={styles.count}>{draft.length} {draft.length === 1 ? 'day' : 'days'}</Text>
            <View style={styles.modeButtons}>
              {(['pick', 'range'] as const).map((option) => <Pressable key={option} accessibilityRole="button"
                accessibilityLabel={option === 'pick' ? 'Pick individual dates' : 'Glide to select a consecutive range, up to 28 days'}
                accessibilityState={{ selected: mode === option, disabled: rangeActive }} disabled={rangeActive}
                onPress={() => changeMode(option)} style={[styles.modeButton, mode === option && styles.modeSelected]}>
                <Text maxFontSizeMultiplier={1.2} style={[styles.modeText, mode === option && styles.modeTextSelected]}>
                  {option === 'pick' ? 'Pick' : 'Range'}
                </Text>
              </Pressable>)}
            </View>
            <InfoButton title="Date selection" message={`Pick: tap separate dates in any order. Your first tap starts a new selection. Range: touch a date and glide across the calendar without lifting your finger to select up to ${MAX_RANGE_DAYS} consecutive days. You can glide forward or backward. Hold near the top or bottom edge to reveal more weeks or continue into another month. Cancelled or two-finger gestures keep the selection from before the drag. Done shows minute cells for up to seven days, or a month overview for more days. Switching back to Pick before completing a new range restores your previous picks.`} />
          </View> : null}
          <View style={styles.footer}>
            <Pressable accessibilityRole="button" onPress={close} style={styles.action}><Text style={styles.actionText}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canApply }} disabled={!canApply}
              onPress={apply} style={[styles.action, styles.done, !canApply && styles.disabled]}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  overlay: { flex: 1, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim },
  card: { backgroundColor: colors.paper, borderColor: colors.hairline, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, overflow: 'hidden' },
  content: { padding: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8 },
  title: { flex: 1, color: colors.ink, fontSize: 18, fontWeight: '600' },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  close: { color: colors.muted, fontSize: 27 },
  arrow: { color: colors.ink, fontSize: 30 },
  monthRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingVertical: 6 },
  month: { flex: 1, color: colors.ink, fontSize: 18, fontWeight: '500', flexShrink: 1 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, color: colors.muted, textAlign: 'center', fontSize: 12, paddingVertical: 8 },
  day: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.65 },
  dayCircle: { minWidth: 36, minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  today: { borderColor: colors.muted },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayText: { color: colors.ink, fontSize: 15, lineHeight: 23, textAlign: 'center' },
  otherMonth: { color: colors.muted },
  selectedText: { color: colors.onAccent },
  selectionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 12, gap: 4 },
  count: { minWidth: 60, flexGrow: 1, color: colors.muted, fontSize: 13, paddingLeft: 4 },
  modeButtons: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, borderRadius: 9, overflow: 'hidden' },
  modeButton: { minWidth: 44, minHeight: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  modeSelected: { backgroundColor: colors.panel },
  modeText: { color: colors.muted, fontSize: 12 },
  modeTextSelected: { color: colors.ink, fontWeight: '600' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 4, gap: 4 },
  action: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center' },
  actionText: { color: colors.graphite, fontSize: 15, fontWeight: '500' },
  done: { backgroundColor: colors.accent, borderRadius: 22 },
  doneText: { color: colors.onAccent, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.35 },
});
