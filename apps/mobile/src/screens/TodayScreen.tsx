import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  Animated, AppState, FlatList, Keyboard, KeyboardAvoidingView, Linking, PanResponder, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
  type GestureResponderEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../appearance';
import { MinuteEditor } from '../components/MinuteEditor';
import { SpreadsheetToolbar } from '../components/SpreadsheetToolbar';
import { deleteMinuteEntry, getDayEntries, getMinuteEntry, saveMinuteRange } from '../data/database';
import { flushPendingActuals, loadPlannedEvents, openPlannedEvent } from '../services/calendar';
import { listCategories } from '../services/categories';
import { flushInlineMinutes, inlineMinuteDrafts, subscribeInlineMinuteCommits,
  subscribeInlineMinuteLinkWarnings } from '../services/inline-minutes';
import { applyCellFormat, clearMinuteRange, editInlineMinute, fillMinuteRange, getDayCellFormats,
  redoSpreadsheetEdit, spreadsheetEditor, undoSpreadsheetEdit, type CellFormat } from '../services/spreadsheet';
import { CATEGORIES, categoryById, type ActivityCategory, type AppColors } from '../theme';
import { inlineMinuteKey } from '../utils/inline-minute-drafts';
import { calendarGridLayout, calendarZoomOffsets, normalizeCalendarZoom, parseCalendarMinute, revealCalendarDay,
  type CalendarZoomAnchor } from '../utils/calendar-layout';
import { getAccounts } from '../sync/accounts';
import { linkActualsToAccounts, loadAccountPlans, synchronizeAccounts } from '../sync/engine';
import type { CalendarPreferences, DeviceCalendar, MinuteEntry, PlannedEvent } from '../types';
import {
  calendarEntriesAreCurrent, calendarLoadIsCurrent, calendarSelectionIsCurrent, indexCalendarDay,
  loadCalendarMinuteSelection, parseCalendarDateInput, visibleCalendarDates,
  type CalendarDayCount, type CalendarMinuteSelection,
} from '../utils/calendar-grid';
import {
  addDays, dateKey, formatDayHeading, MINUTES_PER_DAY, minuteIndexForDate, minuteLabel, parseDateKey,
} from '../utils/time';

const MINUTE_ITEMS = Array.from({ length: MINUTES_PER_DAY }, (_, index) => index);
const DAY_COUNTS: CalendarDayCount[] = [1, 3, 7];

type FocusRequest = { dateKey: string; minuteIndex: number; token: number; openEditor?: boolean } | null;
type DayData = { entries: MinuteEntry[]; plans: PlannedEvent[]; calendarReadError: boolean;
  formats?: Map<number, CellFormat>; formatReadError?: boolean };
type Props = {
  activeDate: string;
  onDateChange: (value: string) => void;
  calendars: DeviceCalendar[];
  preferences: CalendarPreferences;
  dataVersion: number;
  focusRequest: FocusRequest;
  onFocusConsumed: (token?: number) => void;
  onDataChanged: () => void;
  onOpenSettings: () => void;
  dayCount?: CalendarDayCount;
  onDayCountChange?: (count: CalendarDayCount) => void;
  onOpenMenu?: () => void;
  planRequest?: number;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
};

export function TodayScreen({
  activeDate, onDateChange, calendars, preferences, dataVersion, focusRequest,
  onFocusConsumed, onDataChanged, onOpenSettings, dayCount = 1, onDayCountChange, onOpenMenu,
  zoom = 1, onZoomChange,
}: Props) {
  const { colors, resolvedMode } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [viewportWidth, setViewportWidth] = useState(windowWidth);
  const [liveZoom, setLiveZoom] = useState(() => normalizeCalendarZoom(zoom));
  const [pinching, setPinching] = useState(false);
  const zoomRef = useRef(liveZoom);
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  const baseDays = useMemo(() => visibleCalendarDates(activeDate, dayCount), [activeDate, dayCount]);
  const navigationKey = activeDate + '|' + dayCount;
  const navigationKeyRef = useRef(navigationKey);
  const navigationGenerationRef = useRef(0);
  if (navigationKeyRef.current !== navigationKey) {
    navigationKeyRef.current = navigationKey;
    navigationGenerationRef.current += 1;
  }
  const dateBufferRef = useRef({ key: navigationKey, count: dayCount as number });
  const gridLayout = useMemo(() => {
    if (dateBufferRef.current.key !== navigationKey) dateBufferRef.current = { key: navigationKey, count: dayCount };
    const layout = calendarGridLayout(viewportWidth, dayCount, liveZoom, dateBufferRef.current.count);
    dateBufferRef.current.count = layout.dayCount;
    return layout;
  }, [viewportWidth, dayCount, liveZoom, navigationKey]);
  const styles = useMemo(() => createStyles(colors, resolvedMode, gridLayout), [colors, resolvedMode, gridLayout]);
  const days = useMemo(() => Array.from({ length: gridLayout.dayCount }, (_, index) => dateKey(addDays(baseDays[0]!, index))),
    [baseDays, gridLayout.dayCount]);
  const dayLabels = useMemo(() => new Map(days.map((day) => [day, formatDayHeading(day)])), [days]);
  const rangeKey = days.join('|');
  const rangeRef = useRef(rangeKey);
  const visibleDaysRef = useRef(days);
  const listRef = useRef<FlatList<number>>(null);
  const horizontalRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const horizontalOffset = useRef(new Animated.Value(0)).current;
  const horizontalOffsetRef = useRef(0);
  const verticalOffsetRef = useRef(0);
  const gridViewportRef = useRef<ComponentRef<typeof View>>(null);
  const minuteViewportRef = useRef<ComponentRef<typeof View>>(null);
  const bodyWindowRef = useRef({ x: 0, y: insets.top + 92, height: 500 });
  const pendingZoomAnchorRef = useRef<(CalendarZoomAnchor & { generation: number }) | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number; anchor: CalendarZoomAnchor; generation: number } | null>(null);
  const pinchFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const pendingPinchZoomRef = useRef<number | null>(null);
  const gridLayoutRef = useRef(gridLayout);
  gridLayoutRef.current = gridLayout;
  const loadTokenRef = useRef(0);
  const selectionTokenRef = useRef(0);
  const focusTokenRef = useRef<number | null>(null);
  const currentFocusRef = useRef(focusRequest);
  const localEpochsRef = useRef(new Map<string, number>());
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncDatesRef = useRef(new Set<string>());
  const projectionChainRef = useRef<Promise<void>>(Promise.resolve());
  const projectionMessageTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const appStateRef = useRef(AppState.currentState);
  const [dayData, setDayData] = useState<Record<string, DayData>>({});
  const [editor, setEditor] = useState<CalendarMinuteSelection | null>(null);
  const [inlineSelection, setInlineSelection] = useState<CalendarMinuteSelection | null>(null);
  const inlineSelectionRef = useRef(inlineSelection);
  const inlineInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [inlineVersion, setInlineVersion] = useState(0);
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  const [spreadsheetState, setSpreadsheetState] = useState(() => spreadsheetEditor.snapshot());
  const [rangePanelOpen, setRangePanelOpen] = useState(false);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  const [rangeEndInput, setRangeEndInput] = useState('');
  const [toolbarError, setToolbarError] = useState<string | null>(null);
  const [toolBusy, setToolBusy] = useState(false);
  const toolBusyRef = useRef(false);
  const [availableColors, setAvailableColors] = useState<ActivityCategory[]>(() => CATEGORIES.filter((item) => !item.archived));
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [projectionWarning, setProjectionWarning] = useState<string | null>(null);
  const [accountWarning, setAccountWarning] = useState<string | null>(null);
  const [inlineLinkWarning, setInlineLinkWarning] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [dateInputOpen, setDateInputOpen] = useState(false);
  const [dateInput, setDateInput] = useState('');
  const [dateInputError, setDateInputError] = useState(false);
  const dayDataRef = useRef(dayData);
  const editorRef = useRef(editor);
  const clockDayRef = useRef(dateKey(now));
  const pendingRolloverRef = useRef<{ from: string; to: string } | null>(null);
  rangeRef.current = rangeKey;
  visibleDaysRef.current = days;
  dayDataRef.current = dayData;
  editorRef.current = editor;
  inlineSelectionRef.current = inlineSelection;
  currentFocusRef.current = focusRequest;

  const projectionConfigRef = useRef({ enabled: preferences.syncActuals, calendarId: preferences.writeCalendarId });
  projectionConfigRef.current = { enabled: preferences.syncActuals, calendarId: preferences.writeCalendarId };

  function measureMinuteViewport() {
    gridViewportRef.current?.measureInWindow((x) => { bodyWindowRef.current.x = x; });
    minuteViewportRef.current?.measureInWindow((_x, y, _width, height) => {
      bodyWindowRef.current.y = y; bodyWindowRef.current.height = height;
    });
  }

  function captureZoomAnchor(point?: { x: number; y: number }): CalendarZoomAnchor {
    const layout = gridLayoutRef.current;
    const bounds = bodyWindowRef.current;
    const viewportX = Math.max(Math.min(layout.railWidth, layout.viewportWidth - 1), Math.min(layout.viewportWidth,
      point ? point.x - bounds.x : (layout.railWidth + layout.viewportWidth) / 2));
    const viewportY = Math.max(0, Math.min(bounds.height, point ? point.y - bounds.y : bounds.height / 2));
    return { minute: (verticalOffsetRef.current + viewportY) / layout.rowHeight,
      day: (horizontalOffsetRef.current + viewportX - layout.railWidth) / layout.dayWidth, viewportX, viewportY };
  }

  function restoreZoomAnchor() {
    const anchor = pendingZoomAnchorRef.current;
    if (!anchor || !mountedRef.current || anchor.generation !== navigationGenerationRef.current) return;
    const offsets = calendarZoomOffsets(anchor, gridLayoutRef.current, bodyWindowRef.current.height);
    horizontalOffsetRef.current = offsets.x; verticalOffsetRef.current = offsets.y;
    horizontalOffset.setValue(offsets.x);
    horizontalRef.current?.scrollTo({ x: offsets.x, animated: false });
    listRef.current?.scrollToOffset({ offset: offsets.y, animated: false });
  }

  function applyLiveZoom(value: number, anchor: CalendarZoomAnchor) {
    const next = normalizeCalendarZoom(value);
    if (next === zoomRef.current) return;
    pendingZoomAnchorRef.current = { ...anchor, generation: navigationGenerationRef.current };
    zoomRef.current = next;
    setLiveZoom(next);
  }

  function finishPinch() {
    if (pinchFrameRef.current != null) cancelAnimationFrame(pinchFrameRef.current);
    pinchFrameRef.current = null;
    const pinch = pinchRef.current;
    if (!pinch || pinch.generation !== navigationGenerationRef.current || !mountedRef.current) {
      pinchRef.current = null; pendingPinchZoomRef.current = null; pendingZoomAnchorRef.current = null;
      setPinching(false); return;
    }
    if (pinch && pendingPinchZoomRef.current != null) applyLiveZoom(pendingPinchZoomRef.current, pinch.anchor);
    pendingPinchZoomRef.current = null;
    pinchRef.current = null;
    setPinching(false);
    onZoomChangeRef.current?.(zoomRef.current);
    const generation = navigationGenerationRef.current;
    const anchor = pendingZoomAnchorRef.current;
    requestAnimationFrame(() => {
      if (!mountedRef.current || generation !== navigationGenerationRef.current || pendingZoomAnchorRef.current !== anchor) return;
      restoreZoomAnchor();
      requestAnimationFrame(() => {
        if (mountedRef.current && generation === navigationGenerationRef.current &&
            !pinchRef.current && pendingZoomAnchorRef.current === anchor) pendingZoomAnchorRef.current = null;
      });
    });
  }

  const pinchResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length === 2,
    onMoveShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length === 2,
    onPanResponderGrant: (event: GestureResponderEvent) => {
      const [first, second] = event.nativeEvent.touches;
      if (!first || !second) return;
      const distance = Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY);
      if (distance < 8) return;
      horizontalRef.current?.scrollTo({ x: horizontalOffsetRef.current, animated: false });
      listRef.current?.scrollToOffset({ offset: verticalOffsetRef.current, animated: false });
      pinchRef.current = { distance, zoom: zoomRef.current, generation: navigationGenerationRef.current,
        anchor: captureZoomAnchor({ x: (first.pageX + second.pageX) / 2, y: (first.pageY + second.pageY) / 2 }) };
      setPinching(true);
    },
    onPanResponderMove: (event: GestureResponderEvent) => {
      const pinch = pinchRef.current;
      const [first, second] = event.nativeEvent.touches;
      if (!pinch || !first || !second || pinch.generation !== navigationGenerationRef.current) return;
      pendingPinchZoomRef.current = pinch.zoom * Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY) / pinch.distance;
      if (pinchFrameRef.current == null) pinchFrameRef.current = requestAnimationFrame(() => {
        pinchFrameRef.current = null;
        if (mountedRef.current && pinchRef.current && pinchRef.current.generation === navigationGenerationRef.current &&
            pendingPinchZoomRef.current != null) applyLiveZoom(pendingPinchZoomRef.current, pinchRef.current.anchor);
      });
    },
    onPanResponderRelease: finishPinch,
    onPanResponderTerminate: finishPinch,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), []);

  useEffect(() => {
    const next = normalizeCalendarZoom(zoom);
    if (!pinchRef.current && next !== zoomRef.current) applyLiveZoom(next, captureZoomAnchor());
  }, [zoom]);

  useEffect(() => {
    const generation = navigationGenerationRef.current;
    requestAnimationFrame(() => {
      if (!mountedRef.current || generation !== navigationGenerationRef.current) return;
      measureMinuteViewport();
      if (pendingZoomAnchorRef.current) {
        const anchor = pendingZoomAnchorRef.current;
        restoreZoomAnchor();
        requestAnimationFrame(() => {
          if (mountedRef.current && generation === navigationGenerationRef.current && !pinchRef.current &&
              pendingZoomAnchorRef.current === anchor) pendingZoomAnchorRef.current = null;
        });
      } else if (horizontalOffsetRef.current > gridLayout.maxOffset) {
        horizontalRef.current?.scrollTo({ x: gridLayout.maxOffset, animated: false });
      }
    });
  }, [gridLayout]);

  useEffect(() => () => { if (pinchFrameRef.current != null) cancelAnimationFrame(pinchFrameRef.current); }, []);
  const onHorizontalScroll = useMemo(() => Animated.event(
    [{ nativeEvent: { contentOffset: { x: horizontalOffset } } }],
    { useNativeDriver: true, listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      horizontalOffsetRef.current = event.nativeEvent.contentOffset.x;
    } },
  ), [horizontalOffset]);

  useEffect(() => {
    const offset = revealCalendarDay(0, Math.max(0, visibleDaysRef.current.indexOf(activeDate)), gridLayoutRef.current);
    const generation = navigationGenerationRef.current;
    requestAnimationFrame(() => {
      if (!mountedRef.current || generation !== navigationGenerationRef.current) return;
      horizontalOffsetRef.current = offset;
      horizontalOffset.setValue(offset);
      horizontalRef.current?.scrollTo({ x: offset, animated: false });
    });
  }, [navigationKey, horizontalOffset]);

  const reload = useCallback(async () => {
    const requestedRange = rangeKey;
    const requestedDays = [...days];
    const epochs = new Map(requestedDays.map((day) => [day, localEpochsRef.current.get(day) ?? 0]));
    const requestedFormatVersion = spreadsheetEditor.snapshot().formatVersion;
    const token = ++loadTokenRef.current;
    const request = { rangeKey: requestedRange, token, entryEpochs: epochs };
    const currentLoadState = () => ({ mounted: mountedRef.current, rangeKey: rangeRef.current,
      token: loadTokenRef.current });
    const results = await Promise.allSettled(requestedDays.map(async (day) => {
      const [entries, planResults, formats] = await Promise.all([
        getDayEntries(day),
        Promise.allSettled([
          loadPlannedEvents(preferences.selectedCalendarIds, day, calendars), loadAccountPlans(day),
        ]),
        getDayCellFormats(day).catch(() => null),
      ]);
      return { day, entries, plans: planResults.flatMap((result) => result.status === 'fulfilled' ? result.value : []),
        calendarReadError: planResults.some((result) => result.status === 'rejected'), formats };
    }));
    if (!calendarLoadIsCurrent(request, currentLoadState())) return false;
    setDayData((previous) => {
      if (!calendarLoadIsCurrent(request, currentLoadState())) return previous;
      const next: Record<string, DayData> = {};
      for (const day of requestedDays) if (previous[day]) next[day] = previous[day]!;
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const value = result.value;
        const entriesStillCurrent = calendarEntriesAreCurrent(value.day, request, localEpochsRef.current);
        next[value.day] = { entries: entriesStillCurrent ? value.entries : previous[value.day]?.entries ?? [],
          plans: value.plans, calendarReadError: value.calendarReadError,
          formats: value.formats && requestedFormatVersion === spreadsheetEditor.snapshot().formatVersion
            ? value.formats : previous[value.day]?.formats,
          formatReadError: value.formats == null };
      }
      return next;
    });
    setLoadError(results.some((result) => result.status === 'rejected'));
    return true;
  }, [rangeKey, days, calendars, preferences.selectedCalendarIds, spreadsheetState.formatVersion]);

  useEffect(() => {
    loadTokenRef.current += 1;
    selectionTokenRef.current += 1;
  }, [rangeKey]);

  useEffect(() => {
    if (pinchFrameRef.current != null) cancelAnimationFrame(pinchFrameRef.current);
    pinchFrameRef.current = null;
    pinchRef.current = null;
    pendingPinchZoomRef.current = null;
    pendingZoomAnchorRef.current = null;
    setPinching(false);
    const previous = inlineSelectionRef.current;
    if (previous) inlineMinuteDrafts.close(inlineMinuteKey(previous.dateKey, previous.minuteIndex));
    setInlineSelection(null);
    setColorPanelOpen(false);
    setRangePanelOpen(false);
    setRangeEnd(null);
    setToolbarError(null);
    Keyboard.dismiss();
    setLoadError(false);
    setRefreshing(false);
  }, [navigationKey]);

  useEffect(() => inlineMinuteDrafts.subscribe(() => setInlineVersion((value) => value + 1)), []);
  useEffect(() => subscribeInlineMinuteLinkWarnings(setInlineLinkWarning), []);
  useEffect(() => spreadsheetEditor.subscribe(() => setSpreadsheetState(spreadsheetEditor.snapshot())), []);

  useEffect(() => {
    setRangePanelOpen(false);
    setRangeEnd(null);
    setToolbarError(null);
  }, [inlineSelection?.dateKey, inlineSelection?.minuteIndex]);

  useEffect(() => {
    let current = true;
    void listCategories(false).then((values) => { if (current) setAvailableColors(values); }).catch(() => {});
    return () => { current = false; };
  }, [dataVersion, colorPanelOpen]);

  const inlineDrafts = useMemo(() => inlineMinuteDrafts.snapshot(), [inlineVersion]);
  const draftsByKey = useMemo(() => new Map(inlineDrafts.map((draft) => [draft.key, draft])), [inlineDrafts]);
  const inlineError = inlineDrafts.some((draft) => draft.error);

  useEffect(() => { void reload(); }, [dataVersion, reload]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const updateAtMinuteBoundary = () => {
      const current = new Date();
      setNow(current);
      timer = setTimeout(updateAtMinuteBoundary,
        60_000 - current.getSeconds() * 1_000 - current.getMilliseconds() + 25);
    };
    updateAtMinuteBoundary();
    return () => { if (timer) clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const wasAway = appStateRef.current !== 'active';
      appStateRef.current = state;
      if (state !== 'active') {
        const selected = inlineSelectionRef.current;
        if (selected) inlineMinuteDrafts.close(inlineMinuteKey(selected.dateKey, selected.minuteIndex));
        setInlineSelection(null);
        setColorPanelOpen(false);
      }
      if (state === 'active' && wasAway) { setNow(new Date()); void reload(); }
    });
    return () => subscription.remove();
  }, [reload]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadTokenRef.current += 1;
      selectionTokenRef.current += 1;
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
        const queuedDates = [...pendingSyncDatesRef.current];
        pendingSyncDatesRef.current.clear();
        const config = projectionConfigRef.current;
        if (config.enabled && config.calendarId && queuedDates.length) {
          projectionChainRef.current = projectionChainRef.current
            .then(async () => void (await flushPendingActuals(config.calendarId!, queuedDates)))
            .catch(() => { /* The durable outbox retains work if the screen closes. */ });
        }
      }
    };
  }, []);

  const indexedDays = useMemo(() => new Map(days.map((day) => {
    const data = dayData[day];
    return [day, indexCalendarDay(day, data?.entries ?? [], data?.plans ?? [])];
  })), [days, dayData]);
  const today = dateKey(now);
  const currentMinute = minuteIndexForDate(now);
  const calendarReadError = days.some((day) => dayData[day]?.calendarReadError);
  const hasAllDay = days.some((day) => dayData[day]?.plans.some((plan) => plan.allDay));

  useEffect(() => {
    if (clockDayRef.current !== today) {
      if (activeDate === clockDayRef.current) pendingRolloverRef.current = { from: activeDate, to: today };
      clockDayRef.current = today;
    }
    const pending = pendingRolloverRef.current;
    if (!pending) return;
    if (activeDate !== pending.from) { pendingRolloverRef.current = null; return; }
    // Follow the current day after midnight, but finish any dated draft or date selection first.
    if (!editor && !inlineSelection && !dateInputOpen) {
      pendingRolloverRef.current = null;
      onDateChange(pending.to);
    }
  }, [activeDate, today, editor, inlineSelection, dateInputOpen, onDateChange]);

  const jumpToMinute = useCallback((minute: number) => {
    const generation = navigationGenerationRef.current;
    requestAnimationFrame(() => {
      if (!mountedRef.current || generation !== navigationGenerationRef.current) return;
      listRef.current?.scrollToIndex({ index: Math.max(0, Math.min(1439, minute - 3)), animated: false });
    });
  }, []);

  useEffect(() => {
    if (!editorRef.current) jumpToMinute(visibleDaysRef.current.includes(dateKey(new Date()))
      ? minuteIndexForDate(new Date()) : 9 * 60);
    // Changing the viewed range positions the ledger; refreshes and clock ticks do not move it.
  }, [navigationKey, jumpToMinute]);

  const openMinute = useCallback(async (day: string, minute: number) => {
    const token = ++selectionTokenRef.current;
    const requestedRange = rangeRef.current;
    const request = { dateKey: day, minuteIndex: minute, rangeKey: requestedRange, token };
    const currentSelectionState = () => ({ mounted: mountedRef.current, rangeKey: rangeRef.current,
      token: selectionTokenRef.current, visibleDays: visibleDaysRef.current });
    try {
      // Read the local minute before opening so a fast tap during a calendar refresh cannot
      // initialize an existing entry as an empty draft. The editor keeps this dated snapshot.
      const selection = await loadCalendarMinuteSelection(request, {
        readEntry: getMinuteEntry,
        readPlans: (value) => dayDataRef.current[value]?.plans ?? [],
        currentState: currentSelectionState,
      });
      if (!selection || !calendarSelectionIsCurrent(request, currentSelectionState())) return;
      setActionError(null);
      setEditor((previous) => calendarSelectionIsCurrent(request, currentSelectionState()) ? selection : previous);
    } catch {
      if (mountedRef.current && token === selectionTokenRef.current) {
        setActionError('This minute could not be opened. Please try again.');
      }
    }
  }, []);

  const revealInlineMinute = useCallback((minute: number, day?: string) => {
    const generation = navigationGenerationRef.current;
    requestAnimationFrame(() => {
      if (!mountedRef.current || generation !== navigationGenerationRef.current) return;
      const selectedDay = day ?? inlineSelectionRef.current?.dateKey;
      if (selectedDay) {
        const offset = revealCalendarDay(horizontalOffsetRef.current,
          visibleDaysRef.current.indexOf(selectedDay), gridLayoutRef.current);
        horizontalOffsetRef.current = offset;
        horizontalRef.current?.scrollTo({ x: offset, animated: false });
      }
      listRef.current?.scrollToIndex({ index: minute, viewPosition: 0.3, animated: false });
    });
  }, []);

  const openInlineMinute = useCallback(async (day: string, minute: number, showColors = false) => {
    const token = ++selectionTokenRef.current;
    const request = { dateKey: day, minuteIndex: minute, rangeKey: rangeRef.current, token };
    const currentState = () => ({ mounted: mountedRef.current, rangeKey: rangeRef.current,
      token: selectionTokenRef.current, visibleDays: visibleDaysRef.current });
    try {
      const selection = await loadCalendarMinuteSelection(request, { readEntry: getMinuteEntry,
        readPlans: (value) => dayDataRef.current[value]?.plans ?? [], currentState });
      if (!selection || !calendarSelectionIsCurrent(request, currentState())) return;
      inlineMinuteDrafts.activate({ dateKey: day, minuteIndex: minute,
        text: selection.entry?.text ?? selection.plan?.title ?? '',
        categoryId: selection.entry?.categoryId ?? selection.plan?.categoryId ?? 'unaccounted',
        keepColor: Boolean(selection.entry && !selection.entry.text.trim()) });
      setActionError(null);
      setEditor(null);
      setInlineSelection(selection);
      setColorPanelOpen(showColors);
      setRangePanelOpen(false);
      setRangeEnd(null);
      if (showColors) Keyboard.dismiss();
      revealInlineMinute(minute, day);
    } catch {
      if (mountedRef.current && token === selectionTokenRef.current) setActionError('This minute could not be opened. Please try again.');
    }
  }, [revealInlineMinute]);

  useEffect(() => {
    if (inlineSelection && !colorPanelOpen) requestAnimationFrame(() => inlineInputRef.current?.focus());
  }, [inlineSelection?.dateKey, inlineSelection?.minuteIndex, colorPanelOpen]);

  useEffect(() => {
    const keyboard = Keyboard.addListener('keyboardDidShow', () => {
      const selected = inlineSelectionRef.current;
      if (selected) revealInlineMinute(selected.minuteIndex);
    });
    return () => keyboard.remove();
  }, [revealInlineMinute]);

  useEffect(() => subscribeInlineMinuteCommits((commit) => {
    markLocalChange(commit.affectedDates);
    setDayData((previous) => {
      const data = previous[commit.dateKey];
      if (!data || commit.readBackFailed) return previous;
      const entries = data.entries.filter((entry) => entry.minuteIndex !== commit.minuteIndex);
      if (commit.entry) entries.push(commit.entry);
      return { ...previous, [commit.dateKey]: { ...data, entries } };
    });
    for (const day of commit.affectedDates) refreshLocalEntries(day);
  }), []);

  useEffect(() => () => {
    const selection = inlineSelectionRef.current;
    if (selection) inlineMinuteDrafts.close(inlineMinuteKey(selection.dateKey, selection.minuteIndex));
    void flushInlineMinutes();
  }, []);

  async function showMinuteDetails(day: string, minute: number) {
    const token = ++selectionTokenRef.current;
    await inlineMinuteDrafts.flushAll();
    if (inlineMinuteDrafts.get(day, minute)?.error || token !== selectionTokenRef.current) return;
    inlineMinuteDrafts.close(inlineMinuteKey(day, minute));
    Keyboard.dismiss();
    setInlineSelection(null);
    setColorPanelOpen(false);
    await openMinute(day, minute);
  }

  useEffect(() => {
    if (!focusRequest || !days.includes(focusRequest.dateKey) || focusTokenRef.current === focusRequest.token) return;
    focusTokenRef.current = focusRequest.token;
    jumpToMinute(focusRequest.minuteIndex);
    const focusToken = focusRequest.token;
    if (focusRequest.openEditor === false) { onFocusConsumed(focusToken); return; }
    void openInlineMinute(focusRequest.dateKey, focusRequest.minuteIndex).finally(() => {
      if (currentFocusRef.current?.token === focusToken) onFocusConsumed(focusToken);
    });
  }, [days, focusRequest, jumpToMinute, openInlineMinute, onFocusConsumed]);

  const queueCalendarProjection = useCallback((values: string[]) => {
    const config = projectionConfigRef.current;
    const messageToken = ++projectionMessageTokenRef.current;
    if (!config.enabled || !config.calendarId) {
      pendingSyncDatesRef.current.clear();
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
      return;
    }
    for (const value of values) pendingSyncDatesRef.current.add(value);
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      const queuedDates = [...pendingSyncDatesRef.current];
      pendingSyncDatesRef.current.clear();
      const project = async () => {
        const latest = projectionConfigRef.current;
        if (!latest.enabled || !latest.calendarId) return;
        try {
          const result = await flushPendingActuals(latest.calendarId, queuedDates);
          if (mountedRef.current && messageToken === projectionMessageTokenRef.current) {
            setProjectionWarning(result.failed > 0 || result.remaining > 0 ? 'Calendar copy needs a retry.' : null);
          }
        } catch {
          if (mountedRef.current && messageToken === projectionMessageTokenRef.current) {
            setProjectionWarning('Calendar copy needs a retry.');
          }
        }
      };
      projectionChainRef.current = projectionChainRef.current.then(project, project);
    }, 700);
  }, []);

  function markLocalChange(values: string[]) {
    for (const value of values) localEpochsRef.current.set(value, (localEpochsRef.current.get(value) ?? 0) + 1);
  }

  function refreshLocalEntries(value: string) {
    const epoch = localEpochsRef.current.get(value) ?? 0;
    void getDayEntries(value).then((entries) => {
      if (!mountedRef.current || !visibleDaysRef.current.includes(value) ||
          (localEpochsRef.current.get(value) ?? 0) !== epoch) return;
      setDayData((previous) => {
        if (!visibleDaysRef.current.includes(value) || (localEpochsRef.current.get(value) ?? 0) !== epoch) return previous;
        return { ...previous, [value]: {
          entries, plans: previous[value]?.plans ?? [], calendarReadError: previous[value]?.calendarReadError ?? false,
          formats: previous[value]?.formats, formatReadError: previous[value]?.formatReadError,
        } };
      });
    }).catch(() => { /* The committed ledger entry remains durable and refresh can retry. */ });
  }

  async function save(text: string, categoryId: string, durationMinutes: number, replacePlan: boolean,
    sourceScope: 'occurrence' | 'series') {
    const selection = editor;
    if (!selection) return;
    const selectedPlan = selection.plan;
    if (replacePlan && selectedPlan?.accountEvent) {
      const connected = (await getAccounts()).find((account) => account.id === selectedPlan.accountEvent!.accountId);
      if (!connected?.consent.calendarWrite || !connected.consent.replaceOccurrences) {
        throw new Error('Allow source occurrence changes under Settings → Accounts, or turn off plan replacement.');
      }
      if (sourceScope === 'series' && !connected.consent.editSeries) {
        throw new Error('Allow recurring-series changes for this account before selecting that scope.');
      }
      if (selectedPlan.accountEvent.event.isInvitation && !connected.consent.editInvitations) {
        throw new Error('Allow invitation changes for this account before changing the source meeting.');
      }
      if (selectedPlan.accountEvent.event.canEdit === false) {
        throw new Error('The source provider does not allow editing this event. Turn off source replacement to record a separate actual.');
      }
    }
    const potentialDates = [selection.dateKey];
    if (selection.minuteIndex + durationMinutes > MINUTES_PER_DAY) {
      potentialDates.push(dateKey(addDays(selection.dateKey, 1)));
    }
    markLocalChange(potentialDates);
    const affectedDates = await saveMinuteRange({ dateKey: selection.dateKey,
      startMinute: selection.minuteIndex, durationMinutes, text, categoryId });
    for (const value of affectedDates) refreshLocalEntries(value);
    try {
      await linkActualsToAccounts(affectedDates, replacePlan ? selectedPlan : null,
        { dateKey: selection.dateKey, minuteIndex: selection.minuteIndex }, sourceScope);
      setAccountWarning(null);
    } catch { setAccountWarning('Account synchronization needs review.'); }
    onDataChanged();
    void synchronizeAccounts();
    queueCalendarProjection(affectedDates);
  }

  async function remove() {
    const selection = editor;
    if (!selection) return;
    markLocalChange([selection.dateKey]);
    await deleteMinuteEntry(selection.dateKey, selection.minuteIndex);
    refreshLocalEntries(selection.dateKey);
    await linkActualsToAccounts([selection.dateKey], null,
      { dateKey: selection.dateKey, minuteIndex: selection.minuteIndex });
    onDataChanged();
    void synchronizeAccounts();
    queueCalendarProjection([selection.dateKey]);
  }

  async function refresh() {
    const requestedRange = rangeRef.current;
    setRefreshing(true);
    try { await reload(); }
    finally { if (mountedRef.current && requestedRange === rangeRef.current) setRefreshing(false); }
  }

  async function openPlan(plan: PlannedEvent) {
    try {
      if (plan.accountEvent) {
        const account = (await getAccounts()).find((item) => item.id === plan.accountEvent!.accountId);
        await Linking.openURL(account?.provider === 'microsoft'
          ? 'https://outlook.office.com/calendar/' : 'https://calendar.google.com/calendar/');
      } else await openPlannedEvent(plan);
      await reload();
    } catch { setActionError('The calendar plan could not be opened.'); }
  }

  function goToEnteredDate() {
    const next = parseCalendarDateInput(dateInput);
    if (!next) { setDateInputError(true); return; }
    setDateInputError(false);
    setDateInputOpen(false);
    onDateChange(next);
  }

  const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long' });
  const monthTitle = monthFormat.format(parseDateKey(activeDate));
  const notice = (inlineError ? 'A minute could not be saved. Tap to retry; your draft is kept.' : null) ?? actionError ??
    (inlineLinkWarning ? 'Account synchronization needs a retry. Your minute is saved.' : null) ?? accountWarning ?? projectionWarning ??
    (loadError ? 'Some ledger rows could not refresh. Pull down to retry.' :
      calendarReadError ? 'Some calendar plans could not load. Pull down to retry.' :
        days.some((day) => dayData[day]?.formatReadError) ? 'Some text styles could not refresh. Pull down to retry.' : null);
  const selectedDraft = inlineSelection
    ? draftsByKey.get(inlineMinuteKey(inlineSelection.dateKey, inlineSelection.minuteIndex)) : undefined;
  const selectedColor = selectedDraft ? categoryById(selectedDraft.categoryId) : undefined;
  const pickerColors = selectedColor && !availableColors.some((item) => item.id === selectedColor.id)
    ? [...availableColors, selectedColor] : availableColors;
  const selectedRange = inlineSelection ? { dateKey: inlineSelection.dateKey,
    startMinute: Math.min(inlineSelection.minuteIndex, rangeEnd ?? inlineSelection.minuteIndex),
    endMinute: Math.max(inlineSelection.minuteIndex, rangeEnd ?? inlineSelection.minuteIndex) } : null;
  const selectedFormat = inlineSelection
    ? dayData[inlineSelection.dateKey]?.formats?.get(inlineSelection.minuteIndex) ?? {} : {};

  async function runSpreadsheetTool(work: () => Promise<unknown>) {
    if (toolBusyRef.current) return;
    toolBusyRef.current = true;
    setToolBusy(true); setToolbarError(null);
    try { await work(); }
    catch (error) { if (mountedRef.current) setToolbarError(error instanceof Error ? error.message : 'This edit could not be applied. Try again.'); }
    finally { toolBusyRef.current = false; if (mountedRef.current) setToolBusy(false); }
  }

  function openRangePanel() {
    if (!inlineSelection) return;
    setColorPanelOpen(false);
    setRangeEnd(inlineSelection.minuteIndex);
    setRangeEndInput(minuteLabel(inlineSelection.minuteIndex, true));
    setRangePanelOpen(true);
    Keyboard.dismiss();
  }

  function parsedRange() {
    if (!inlineSelection) return null;
    const end = rangePanelOpen ? parseCalendarMinute(rangeEndInput) : inlineSelection.minuteIndex;
    if (end == null) { setToolbarError('Enter an end time such as 10:20 AM.'); return null; }
    return { dateKey: inlineSelection.dateKey, startMinute: Math.min(inlineSelection.minuteIndex, end),
      endMinute: Math.max(inlineSelection.minuteIndex, end) };
  }

  function formatSelection(patch: Partial<CellFormat>) {
    const range = parsedRange();
    if (range) void runSpreadsheetTool(() => applyCellFormat(range, patch));
  }

  function stepZoom(amount: number) {
    const next = normalizeCalendarZoom(zoomRef.current + amount);
    applyLiveZoom(next, captureZoomAnchor());
    onZoomChangeRef.current?.(next);
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top} onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}>
      <View ref={gridViewportRef} style={styles.gridViewport} onLayout={measureMinuteViewport} {...pinchResponder.panHandlers}>
      <Animated.ScrollView ref={horizontalRef} horizontal directionalLockEnabled nestedScrollEnabled scrollEnabled={!pinching}
        style={styles.horizontalViewport} contentContainerStyle={[styles.horizontalContent, { width: gridLayout.contentWidth }]}
        keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={dayCount > 1}
        onScroll={onHorizontalScroll} scrollEventThrottle={16}>
        <View style={[styles.gridContent, { width: gridLayout.contentWidth }]}>
          <View style={styles.dateHeader}>
            <Animated.View style={[styles.headerRail, { transform: [{ translateX: horizontalOffset }] }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Calendar date, view and zoom"
                accessibilityState={{ expanded: modeMenuOpen }}
                onPress={() => { const open = !modeMenuOpen; setDateInput(activeDate); setDateInputError(false);
                  setColorPanelOpen(false); setRangePanelOpen(false); setDateInputOpen(open); setModeMenuOpen(open); }}
                style={styles.monthButton}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={styles.monthTitle}>{monthTitle}</Text>
              </Pressable>
              <View style={styles.railControls}>
                <Pressable accessibilityRole="button" accessibilityLabel="Open navigation menu"
                  onPress={onOpenMenu ?? onOpenSettings} style={styles.menuButton}>
                  <View style={styles.menuLine} /><View style={styles.menuLine} /><View style={styles.menuLine} />
                </Pressable>
              </View>
            </Animated.View>
            {days.map((day) => (
              <Pressable key={day} accessibilityRole="button" accessibilityLabel={dayLabels.get(day)}
                onPress={() => { onDateChange(day); onDayCountChange?.(1); }}
                style={[styles.dateColumn, { width: gridLayout.dayWidth }]}>
                <Text numberOfLines={1} maxFontSizeMultiplier={1.25} style={[styles.weekday, day === today && styles.todayWeekday]}>
                  {new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(parseDateKey(day))}
                </Text>
                <View style={[styles.dateCircle, day === today && styles.todayCircle]}>
                  <Text maxFontSizeMultiplier={1.25} style={[styles.dateNumber, day === today && styles.todayNumber]}>
                    {parseDateKey(day).getDate()}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
          <Animated.View style={[styles.floatingControls, { width: gridLayout.viewportWidth,
            transform: [{ translateX: horizontalOffset }] }]}>

      {modeMenuOpen ? (
        <View>
        <View style={styles.modeChoices}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous dates"
            onPress={() => onDateChange(dateKey(addDays(activeDate, -dayCount)))} style={styles.dateArrow}>
            <Text style={styles.arrow}>‹</Text>
          </Pressable>
          {DAY_COUNTS.map((count) => (
            <Pressable key={count} accessibilityRole="radio" accessibilityState={{ checked: count === dayCount }}
              onPress={() => { onDayCountChange?.(count); setModeMenuOpen(false); setDateInputOpen(false); }}
              style={[styles.modeChoice, count === dayCount && styles.selectedModeChoice]}>
              <Text style={[styles.modeChoiceText, count === dayCount && styles.selectedModeText]}>
                {count === 1 ? 'Day' : count + ' days'}
              </Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" accessibilityLabel="Next dates"
            onPress={() => onDateChange(dateKey(addDays(activeDate, dayCount)))} style={styles.dateArrow}>
            <Text style={styles.arrow}>›</Text>
          </Pressable>
        </View>
        <View style={styles.zoomChoices}>
          <Text style={styles.zoomLabel}>Zoom</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Zoom out minute grid" disabled={liveZoom <= 0.5}
            onPress={() => stepZoom(-0.1)} style={styles.zoomButton}><Text style={styles.zoomButtonText}>−</Text></Pressable>
          <Text accessibilityLiveRegion="polite" style={styles.zoomLabel}>{Math.round(liveZoom * 100)}%</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Zoom in minute grid" disabled={liveZoom >= 2.5}
            onPress={() => stepZoom(0.1)} style={styles.zoomButton}><Text style={styles.zoomButtonText}>+</Text></Pressable>
        </View>
        </View>
      ) : null}

      {dateInputOpen ? (
        <View style={styles.dateJump}>
          <TextInput value={dateInput} onChangeText={setDateInput}
            onSubmitEditing={goToEnteredDate} returnKeyType="go" accessibilityLabel="Go to date"
            placeholder="MM/DD/YYYY" placeholderTextColor={colors.muted} style={styles.dateInput} />
          <Pressable accessibilityRole="button" onPress={goToEnteredDate} style={styles.goButton}>
            <Text style={styles.goText}>Go</Text>
          </Pressable>
          {dateInputError ? <Text style={styles.dateError}>Enter a valid date.</Text> : null}
        </View>
      ) : null}

      {colorPanelOpen && inlineSelection ? (
        <View style={styles.colorPanel}>
          <View style={styles.colorPanelHeading}>
            <Text numberOfLines={1} style={styles.colorPanelTime}>
              {formatDayHeading(inlineSelection.dateKey)} · {minuteLabel(inlineSelection.minuteIndex, true)}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void showMinuteDetails(inlineSelection.dateKey, inlineSelection.minuteIndex)}
              style={styles.colorPanelAction}><Text style={styles.colorPanelActionText}>Details</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Close colors" onPress={() => setColorPanelOpen(false)}
              style={styles.colorPanelAction}><Text style={styles.colorPanelActionText}>×</Text></Pressable>
          </View>
          <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator
            contentContainerStyle={styles.colorChoices}>
            {pickerColors.map((item) => (
              <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={item.name + ', ' + item.color}
                accessibilityState={{ checked: selectedDraft?.categoryId === item.id }}
                onPress={() => {
                  const current = inlineMinuteDrafts.get(inlineSelection.dateKey, inlineSelection.minuteIndex);
                  if (!current) return;
                  markLocalChange([current.dateKey]);
                  editInlineMinute(current.dateKey, current.minuteIndex,
                    { categoryId: item.id, keepColor: !current.text.trim() });
                }} style={[styles.colorChoice, selectedDraft?.categoryId === item.id && styles.selectedColorChoice]}>
                <View style={[styles.colorCircle, { backgroundColor: item.color }]} />
              </Pressable>
            ))}
          </ScrollView>
          {selectedColor ? <Text style={styles.colorName}>{selectedColor.name}</Text> : null}
        </View>
      ) : null}

      {rangePanelOpen && inlineSelection ? (
        <View style={styles.rangePanel}>
          <Text style={styles.rangeCaption}>{formatDayHeading(inlineSelection.dateKey)} · From {minuteLabel(inlineSelection.minuteIndex, true)}</Text>
          <Text style={styles.rangeCaveat}>Undo restores Context entries; calendar changes may need separate review.</Text>
          <View style={styles.rangeControls}>
            <Text style={styles.rangeCaption}>To</Text>
            <TextInput value={rangeEndInput} accessibilityLabel="Last minute of selected range"
              placeholder="10:20 AM" placeholderTextColor={colors.muted} autoCapitalize="characters"
              returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()}
              onChangeText={(value) => {
                setRangeEndInput(value); const parsed = parseCalendarMinute(value);
                if (parsed != null) { setRangeEnd(parsed); setToolbarError(null); }
              }} style={styles.rangeInput} />
            <Pressable accessibilityRole="button" disabled={toolBusy || spreadsheetState.busy}
              accessibilityLabel="Fill selected minutes from the active minute"
              onPress={() => { const range = parsedRange(); if (range) void runSpreadsheetTool(() => fillMinuteRange(range, inlineSelection.minuteIndex)); }}
              style={styles.rangeAction}><Text style={styles.rangeActionText}>Fill</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={toolBusy || spreadsheetState.busy}
              accessibilityLabel="Clear selected minutes"
              onPress={() => { const range = parsedRange(); if (range) void runSpreadsheetTool(() => clearMinuteRange(range)); }}
              style={styles.rangeAction}><Text style={styles.rangeActionText}>Clear</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Close minute range"
              onPress={() => { setRangePanelOpen(false); setRangeEnd(null); setToolbarError(null); }} style={styles.colorPanelAction}>
              <Text style={styles.colorPanelActionText}>×</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {notice ? (
        <Pressable onPress={inlineError || inlineLinkWarning ? () => void flushInlineMinutes() : calendarReadError ? onOpenSettings : () => void refresh()} style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </Pressable>
      ) : null}

          </Animated.View>
      {hasAllDay ? (
        <View style={styles.allDayRow}>
          <Animated.View style={[styles.allDayRail, { transform: [{ translateX: horizontalOffset }] }]}>
            <Text style={styles.allDayLabel}>All day</Text>
          </Animated.View>
          {days.map((day) => {
            const plans = dayData[day]?.plans.filter((plan) => plan.allDay) ?? [];
            return <Pressable key={day} disabled={!plans.length} onPress={() => void openPlan(plans[0]!)}
              style={[styles.allDayCell, { width: gridLayout.dayWidth }]}>
              <Text numberOfLines={2} style={styles.allDayText}>{plans.map((plan) => plan.title).join(' · ')}</Text>
            </Pressable>;
          })}
        </View>
      ) : null}

      <View ref={minuteViewportRef} style={styles.minuteViewport} onLayout={measureMinuteViewport}>
      <FlatList ref={listRef} data={MINUTE_ITEMS} keyExtractor={(minute) => minute.toString()}
        style={styles.minuteList} contentContainerStyle={styles.minuteListContent}
        getItemLayout={(_, index) => ({ length: gridLayout.rowHeight, offset: gridLayout.rowHeight * index, index })}
        initialNumToRender={24} maxToRenderPerBatch={24} windowSize={9} keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag" removeClippedSubviews={false}
        scrollEnabled={!pinching} scrollEventThrottle={16}
        onScroll={(event) => { verticalOffsetRef.current = event.nativeEvent.contentOffset.y; }}
        onContentSizeChange={() => { if (pendingZoomAnchorRef.current) restoreZoomAnchor(); }}
        onLayout={() => {
          measureMinuteViewport();
          if (pinchRef.current || pendingZoomAnchorRef.current) return;
          const selected = inlineSelectionRef.current;
          if (selected) revealInlineMinute(selected.minuteIndex);
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ink}
          colors={[colors.currentTime]} progressBackgroundColor={colors.surface} />}
        onScrollToIndexFailed={({ index }) => listRef.current?.scrollToOffset({ offset: index * gridLayout.rowHeight, animated: false })}
        renderItem={({ item: minute }) => (
          <View style={styles.minuteRow}>
            <Animated.View style={[styles.timeRailWrapper, { transform: [{ translateX: horizontalOffset }] }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={minuteLabel(minute, true) + ', choose minute color'}
              accessibilityState={{ expanded: colorPanelOpen && inlineSelection?.minuteIndex === minute }}
              onPress={() => void openInlineMinute(inlineSelectionRef.current?.dateKey ?? activeDate, minute, true)}
              style={styles.timeRail}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} maxFontSizeMultiplier={1.4} style={[styles.minuteTime,
                minute === currentMinute && days.includes(today) && styles.currentMinuteText]}>{minuteLabel(minute, true)}</Text>
            </Pressable>
            </Animated.View>
            {days.map((day) => {
              const index = indexedDays.get(day);
              const entry = index?.entriesByMinute.get(minute);
              const draft = draftsByKey.get(inlineMinuteKey(day, minute));
              const plans = index?.plansByMinute.get(minute) ?? [];
              const plan = plans[0];
              const hasDraftValue = draft && (draft.revision > 0 || Boolean(entry));
              const color = hasDraftValue ? categoryById(draft.categoryId).color : entry ? categoryById(entry.categoryId).color : plan?.color;
              const inline = inlineSelection?.dateKey === day && inlineSelection.minuteIndex === minute;
              const rangeSelected = rangePanelOpen && selectedRange?.dateKey === day &&
                minute >= selectedRange.startMinute && minute <= selectedRange.endMinute;
              const format = dayData[day]?.formats?.get(minute) ?? {};
              const textStyle = { fontWeight: format.bold ? '700' as const : '400' as const,
                fontStyle: format.italic ? 'italic' as const : 'normal' as const, color: format.textColor ?? colors.ink };
              const displayedText = draft?.text ?? entry?.text ?? plan?.title;
              const isCurrent = day === today && minute === currentMinute;
              return (
                <Pressable key={day} accessibilityRole={inline ? undefined : 'button'}
                  accessibilityLabel={inline ? undefined : dayLabels.get(day) + ', ' + minuteLabel(minute, true) +
                    (displayedText ? ', ' + displayedText : ', tap to record')}
                  accessibilityHint={inline ? undefined : 'Type in this cell. Hold for minute details.'}
                  onPress={() => {
                    if (rangePanelOpen && inlineSelection) {
                      if (day !== inlineSelection.dateKey) { setToolbarError('Choose an end minute in the same date column.'); return; }
                      setRangeEnd(minute); setRangeEndInput(minuteLabel(minute, true)); setToolbarError(null); return;
                    }
                    if (!inline || colorPanelOpen) void openInlineMinute(day, minute);
                  }}
                  onLongPress={inline || rangePanelOpen ? undefined : () => { void showMinuteDetails(day, minute); }}
                  style={[styles.dayCell, { width: gridLayout.dayWidth }, rangeSelected && styles.rangeCell,
                    rangeSelected && minute === selectedRange?.startMinute && styles.rangeFirstCell,
                    rangeSelected && minute === selectedRange?.endMinute && styles.rangeLastCell,
                    inline && styles.editingCell]}>
                  <View pointerEvents="none" style={[styles.cellBackground,
                    color && /^#[0-9a-f]{6}$/i.test(color) ? { backgroundColor: color + '30' } : null]} />
                  {inline && draft ? <TextInput ref={inlineInputRef} value={draft.text}
                    editable={!spreadsheetState.busy && !toolBusy}
                    multiline scrollEnabled returnKeyType="done" submitBehavior="blurAndSubmit"
                    accessibilityLabel={dayLabels.get(day) + ', ' + minuteLabel(minute, true) + ', minute text'}
                    placeholder="Tap to record" placeholderTextColor={colors.muted} selectionColor={colors.currentTime}
                    onChangeText={(text) => {
                      markLocalChange([day]);
                      const current = inlineMinuteDrafts.get(day, minute);
                      editInlineMinute(day, minute, { text, keepColor: text.trim() ? false : current?.keepColor ?? false });
                    }}
                    onBlur={() => { void inlineMinuteDrafts.flush(inlineMinuteKey(day, minute)); }}
                    onFocus={() => revealInlineMinute(minute)}
                    onSubmitEditing={() => {
                      inlineMinuteDrafts.close(inlineMinuteKey(day, minute));
                      setInlineSelection(null); setColorPanelOpen(false); Keyboard.dismiss();
                    }} style={[styles.cellText, styles.inlineInput, {
                      width: Math.max(1, Math.min(gridLayout.dayWidth - 12,
                        gridLayout.viewportWidth - gridLayout.railWidth - 12)),
                    }, textStyle]} />
                    : <Text numberOfLines={1} maxFontSizeMultiplier={1.4}
                      style={[styles.cellText, !entry && !draft && styles.planText,
                        !displayedText && styles.placeholder, textStyle]}>
                      {displayedText ?? ''}
                    </Text>}
                  {isCurrent ? <View pointerEvents="none" style={styles.currentLine}>
                    <View style={styles.currentDot} />
                  </View> : null}
                </Pressable>
              );
            })}
          </View>
        )}
      />
      </View>

        </View>
      </Animated.ScrollView>
      </View>

      <SpreadsheetToolbar visible={Boolean(inlineSelection)} format={selectedFormat}
        canUndo={spreadsheetState.canUndo} canRedo={spreadsheetState.canRedo}
        busy={toolBusy || spreadsheetState.busy}
        selectionLabel={selectedRange ? minuteLabel(selectedRange.startMinute, true) +
          (selectedRange.endMinute !== selectedRange.startMinute ? ' – ' + minuteLabel(selectedRange.endMinute, true) : '') : ''}
        error={toolbarError}
        onToggleBold={() => formatSelection({ bold: !selectedFormat.bold })}
        onToggleItalic={() => formatSelection({ italic: !selectedFormat.italic })}
        onTextColor={(color) => formatSelection({ textColor: color ?? undefined })}
        onUndo={() => { void runSpreadsheetTool(undoSpreadsheetEdit); }}
        onRedo={() => { void runSpreadsheetTool(redoSpreadsheetEdit); }}
        onFill={openRangePanel}
        onDone={() => {
          const selected = inlineSelectionRef.current;
          if (selected) inlineMinuteDrafts.close(inlineMinuteKey(selected.dateKey, selected.minuteIndex));
          setInlineSelection(null); setColorPanelOpen(false); setRangePanelOpen(false); Keyboard.dismiss();
        }} />

      <MinuteEditor visible={editor != null} dateKey={editor?.dateKey ?? activeDate}
        minuteIndex={editor?.minuteIndex ?? 0} entry={editor?.entry ?? null} plan={editor?.plan ?? null}
        planDurationMinutes={editor?.planDuration} onClose={() => setEditor(null)} onSave={save} onDelete={remove}
        onOpenPlan={editor?.plan ? () => openPlan(editor.plan!) : undefined} />
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: AppColors, mode: 'light' | 'dark', layout: ReturnType<typeof calendarGridLayout>) {
  const grid = mode === 'dark' ? '#000000' : colors.surface;
  const gridLine = mode === 'dark' ? '#3A393D' : colors.hairline;
  const focusedCell = mode === 'dark' ? '#C4B8E7' : '#8D7FAD';
  const rowHeight = layout.rowHeight;
  const railWidth = layout.railWidth;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.paper },
    gridViewport: { flex: 1 },
    horizontalViewport: { flex: 1, backgroundColor: grid },
    horizontalContent: { height: '100%' },
    gridContent: { height: '100%', backgroundColor: grid },
    headerRail: { width: railWidth, height: 92, zIndex: 20, backgroundColor: colors.paper },
    monthButton: { minHeight: 43, justifyContent: 'center', paddingHorizontal: 7 },
    monthTitle: { color: colors.ink, fontSize: 18, fontWeight: '400' },
    railControls: { flexDirection: 'row', alignItems: 'center' },
    zoomChoices: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 3 },
    zoomLabel: { color: colors.graphite, fontSize: 12, minWidth: 42, textAlign: 'center' },
    zoomButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    zoomButtonText: { color: colors.ink, fontSize: 24 },
    dateArrow: { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    arrow: { color: colors.graphite, fontSize: 29, fontWeight: '400' },
    floatingControls: { zIndex: 21, backgroundColor: colors.paper },
    modeChoices: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 4, paddingHorizontal: 6, paddingBottom: 6 },
    modeChoice: { minHeight: 44, minWidth: 65, paddingHorizontal: 8, borderRadius: 3,
      alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel },
    selectedModeChoice: { backgroundColor: colors.accent },
    modeChoiceText: { color: colors.graphite, fontSize: 12, fontWeight: '600' },
    selectedModeText: { color: colors.onAccent },
    dateJump: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
    dateInput: { flex: 1, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.hairline,
      borderRadius: 10, backgroundColor: colors.surface, color: colors.ink, fontSize: 14 },
    goButton: { minHeight: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.accent,
      justifyContent: 'center' },
    goText: { color: colors.onAccent, fontWeight: '600' },
    dateError: { width: '100%', color: colors.danger, fontSize: 12 },
    dateHeader: { flexDirection: 'row', alignItems: 'center', height: 92,
      borderBottomWidth: 1, borderBottomColor: gridLine, backgroundColor: colors.paper },
    menuButton: { width: railWidth, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 5 },
    menuLine: { height: 3, width: 28, backgroundColor: colors.graphite },
    dateColumn: { height: 92, alignItems: 'center', justifyContent: 'center' },
    weekday: { color: colors.muted, fontSize: 14, fontWeight: '600' },
    todayWeekday: { color: mode === 'dark' ? '#C4B8E7' : '#8D7FAD' },
    dateCircle: { width: 46, height: 46, marginTop: 3, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
    todayCircle: { backgroundColor: colors.selectedDay },
    dateNumber: { color: colors.graphite, fontSize: 25, fontWeight: '500' },
    todayNumber: { color: colors.onSelectedDay },
    notice: { paddingVertical: 7, paddingHorizontal: 14, backgroundColor: colors.panel },
    noticeText: { color: colors.warning, fontSize: 11, lineHeight: 16 },
    allDayRow: { flexDirection: 'row', alignItems: 'center', minHeight: 34, borderBottomWidth: 1, borderBottomColor: gridLine },
    allDayRail: { width: railWidth, minHeight: 34, zIndex: 15, justifyContent: 'center', backgroundColor: grid,
      borderRightWidth: 1, borderRightColor: gridLine },
    allDayLabel: { paddingHorizontal: 5, color: colors.muted, fontSize: 10, textAlign: 'right' },
    allDayCell: { minHeight: 34, paddingHorizontal: 5, justifyContent: 'center', borderRightWidth: 1, borderRightColor: gridLine },
    allDayText: { color: colors.graphite, fontSize: 10 },
    minuteList: { flex: 1, minHeight: 0 },
    minuteViewport: { flex: 1, minHeight: 0 },
    minuteListContent: { paddingBottom: 0 },
    minuteRow: { height: rowHeight, flexDirection: 'row' },
    timeRailWrapper: { width: railWidth, height: rowHeight, zIndex: 15, backgroundColor: grid },
    timeRail: { width: railWidth, height: rowHeight, justifyContent: 'center', alignItems: 'flex-end', paddingRight: 6,
      borderRightWidth: 1, borderBottomWidth: 1, borderColor: gridLine },
    minuteTime: { color: colors.ink, fontSize: Math.round(16 * layout.zoom), fontWeight: '400', fontVariant: ['tabular-nums'], includeFontPadding: false },
    currentMinuteText: { color: colors.ink, fontWeight: '600' },
    colorPanel: { paddingHorizontal: 12, paddingBottom: 7, borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.hairline, backgroundColor: colors.panel },
    colorPanelHeading: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
    colorPanelTime: { flex: 1, color: colors.graphite, fontSize: 11 },
    colorPanelAction: { minHeight: 40, minWidth: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
    colorPanelActionText: { color: colors.graphite, fontSize: 12, fontWeight: '600' },
    colorChoices: { gap: 5, alignItems: 'center', paddingHorizontal: 2, paddingBottom: 3 },
    colorChoice: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: 'transparent',
      alignItems: 'center', justifyContent: 'center' },
    selectedColorChoice: { borderColor: colors.ink },
    colorCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.swatchBorder },
    colorName: { color: colors.muted, fontSize: 10, paddingLeft: 5, paddingTop: 2 },
    rangePanel: { paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1,
      borderBottomColor: gridLine, backgroundColor: colors.panel },
    rangeCaption: { color: colors.graphite, fontSize: 11 },
    rangeCaveat: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
    rangeControls: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
    rangeInput: { flex: 1, minWidth: 90, minHeight: 40, borderWidth: 1, borderColor: colors.hairline,
      paddingHorizontal: 7, paddingVertical: 4, color: colors.ink, fontSize: 13, backgroundColor: colors.surface },
    rangeAction: { minHeight: 40, minWidth: 42, paddingHorizontal: 7, justifyContent: 'center', alignItems: 'center' },
    rangeActionText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
    dayCell: { height: rowHeight, justifyContent: 'center', paddingLeft: 5, paddingRight: 4,
      borderRightWidth: 1, borderBottomWidth: 1, borderColor: gridLine },
    cellBackground: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: grid },
    cellText: { color: colors.ink, fontSize: Math.round(16 * layout.zoom), lineHeight: Math.round(21 * layout.zoom), fontWeight: '400', includeFontPadding: false },
    editingCell: { borderWidth: 2, borderColor: focusedCell, zIndex: 2 },
    rangeCell: { borderLeftWidth: 2, borderLeftColor: focusedCell, borderRightWidth: 2, borderRightColor: focusedCell },
    rangeFirstCell: { borderTopWidth: 2, borderTopColor: focusedCell },
    rangeLastCell: { borderBottomWidth: 2, borderBottomColor: focusedCell },
    inlineInput: { paddingVertical: Math.round(layout.zoom), paddingHorizontal: 0, margin: 0, maxHeight: rowHeight - 4,
      textAlignVertical: 'center', backgroundColor: 'transparent' },
    placeholder: { color: colors.muted, fontWeight: '400', fontSize: 11 },
    planText: { color: colors.graphite, fontWeight: '400' },
    currentLine: { position: 'absolute', left: 0, right: 0, top: 0,
      height: 1.5, backgroundColor: colors.currentTime },
    currentDot: { position: 'absolute', left: -3, top: -3.25, width: 8, height: 8,
      borderRadius: 4, backgroundColor: colors.currentTime },
  });
}
