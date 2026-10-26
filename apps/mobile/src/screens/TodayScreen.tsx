import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  Alert, Animated, AppState, FlatList, Keyboard, KeyboardAvoidingView, Linking, PanResponder, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
  type GestureResponderEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../appearance';
import { MinuteEditor } from '../components/MinuteEditor';
import { MinuteOptionsPopup } from '../components/MinuteOptionsPopup';
import { CellActionMenu } from '../components/CellActionMenu';
import { InfoButton } from '../components/InfoButton';
import { deleteMinuteEntry, getDayEntries, getMinuteEntry, saveMinuteRange } from '../data/database';
import { flushPendingActuals, loadPlannedEventsResult, openPlannedEvent } from '../services/calendar';
import { ensureSourceColorCategory, listSelectableActivityCategories } from '../services/categories';
import { flushInlineMinutes, inlineMinuteDrafts, subscribeInlineMinuteCommits,
  subscribeInlineMinuteLinkWarnings } from '../services/inline-minutes';
import { applyCellFormat, clearTextMinuteRange, clearSpreadsheetClipboard, colorMinuteRange, copyMinuteRange, cutMinuteRange, editInlineMinute,
  fillMinuteRange, getDayActivityGroups, getDayCellFormats, getSpreadsheetClipboard, groupMinuteRange, pasteMinuteRange,
  prepareMinutePaste, getMovableActivityGroup, prepareActivityGroupMove, moveActivityGroup, ungroupMinuteRange,
  spreadsheetEditor, type ActivityGroup, type CellFormat } from '../services/spreadsheet';
import { categoryById, type ActivityCategory, type AppColors } from '../theme';
import { inlineMinuteKey } from '../utils/inline-minute-drafts';
import { activityTextColor, beginInlineCellTap, isInlineCellTap, trackInlineCellTap,
  type InlineCellTap } from '../utils/minute-interactions';
import { minuteAtDragPosition, minuteDragGripOffset, minuteDragScrollOffset } from '../utils/minute-range-drag';
import { analyzeCellSelection } from '../utils/cell-action-policy';
import { calendarCellColor, calendarColor } from '../utils/calendar-cell-color';
import { activityGroupDragGrip, activityGroupDropTarget, activityGroupDragScrollOffsets,
  type ActivityGroupDragGrip, type ActivityGroupDropTarget } from '../utils/activity-group-drag';
import { calendarGridLayout, calendarZoomOffsets, normalizeCalendarZoom, parseCalendarMinute, revealCalendarDay,
  type CalendarZoomAnchor } from '../utils/calendar-layout';
import { getAccounts } from '../sync/accounts';
import { linkActualsToAccounts, loadAccountPlans, synchronizeAccounts } from '../sync/engine';
import type { CalendarPreferences, DeviceCalendar, MinuteEntry, PlannedEvent } from '../types';
import {
  calendarEntriesAreCurrent, calendarLoadIsCurrent, calendarSelectionIsCurrent, indexCalendarDay,
  loadCalendarMinuteSelection, visibleCalendarDates,
  type CalendarDayCount, type CalendarMinuteSelection,
} from '../utils/calendar-grid';
import {
  addDays, dateKey, formatDayHeading, MINUTES_PER_DAY, minuteIndexForDate, minuteLabel, parseDateKey,
} from '../utils/time';

const MINUTE_ITEMS = Array.from({ length: MINUTES_PER_DAY }, (_, index) => index);

type FocusRequest = { dateKey: string; minuteIndex: number; token: number; openEditor?: boolean } | null;
type DayData = { entries: MinuteEntry[]; plans: PlannedEvent[]; calendarReadError: boolean;
  formats?: Map<number, CellFormat>; formatReadError?: boolean; groups?: ActivityGroup[]; groupReadError?: boolean };
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
  selectedDates?: readonly string[] | null;
  dateSelectionOpen?: boolean;
  planRequest?: number;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  clockFormat?: '12h' | '24h';
  onCreatePlan?: () => void;
  viewResetToken?: number;
};

export function TodayScreen({
  activeDate, onDateChange, calendars, preferences, dataVersion, focusRequest,
  onFocusConsumed, onDataChanged, onOpenSettings, dayCount = 1, onDayCountChange, selectedDates, dateSelectionOpen = false,
  zoom = 1, onZoomChange, clockFormat = '12h', onCreatePlan, viewResetToken = 0,
}: Props) {
  const { colors, resolvedMode } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const clockFormatRef = useRef(clockFormat);
  const sourceColorJobs = useRef(new Map<string, Promise<void>>());
  const sourceColorJobEpochs = useRef(new Map<string, number>());
  const sourceColorEligibility = useRef(new Map<string, { categoryId: string; epoch: number }>());
  const explicitColorEpochs = useRef(new Map<string, number>());
  clockFormatRef.current = clockFormat;
  const [measuredTimeWidths, setMeasuredTimeWidths] = useState<Record<string, number>>({});
  const timeWidthKey = clockFormat + '|' + fontScale;
  const [viewportWidth, setViewportWidth] = useState(windowWidth);
  const [liveZoom, setLiveZoom] = useState(() => normalizeCalendarZoom(zoom));
  const [pinching, setPinching] = useState(false);
  const zoomRef = useRef(liveZoom);
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  const explicitDays = useMemo(() => selectedDates?.length ? [...selectedDates] : null, [selectedDates]);
  const gridDayCount = (explicitDays?.length ?? dayCount) as CalendarDayCount;
  const baseDays = useMemo(() => explicitDays ?? visibleCalendarDates(activeDate, dayCount), [activeDate, dayCount, explicitDays]);
  const navigationKey = activeDate + '|' + dayCount + '|' + (explicitDays?.join(',') ?? 'preset') + '|' + viewResetToken;
  const navigationKeyRef = useRef(navigationKey);
  const navigationGenerationRef = useRef(0);
  if (navigationKeyRef.current !== navigationKey) {
    navigationKeyRef.current = navigationKey;
    navigationGenerationRef.current += 1;
  }
  const dateBufferRef = useRef({ key: navigationKey, count: gridDayCount as number });
  const gridLayout = useMemo(() => {
    if (dateBufferRef.current.key !== navigationKey) dateBufferRef.current = { key: navigationKey, count: gridDayCount };
    const layout = calendarGridLayout(viewportWidth, gridDayCount, liveZoom, dateBufferRef.current.count,
      measuredTimeWidths[timeWidthKey], explicitDays != null);
    dateBufferRef.current.count = layout.dayCount;
    return layout;
  }, [viewportWidth, gridDayCount, liveZoom, navigationKey, measuredTimeWidths, timeWidthKey, explicitDays]);
  const styles = useMemo(() => createStyles(colors, resolvedMode, gridLayout), [colors, resolvedMode, gridLayout]);
  const days = useMemo(() => explicitDays ?? Array.from({ length: gridLayout.dayCount }, (_, index) => dateKey(addDays(baseDays[0]!, index))),
    [baseDays, gridLayout.dayCount, explicitDays]);
  const dayLabels = useMemo(() => new Map(days.map((day) => [day, formatDayHeading(day)])), [days]);
  const rangeKey = days.join('|');
  const rangeRef = useRef(rangeKey);
  const visibleDaysRef = useRef(days);
  const listRef = useRef<FlatList<number>>(null);
  const horizontalRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const horizontalOffset = useRef(new Animated.Value(0)).current;
  const horizontalOffsetRef = useRef(0);
  const verticalOffsetRef = useRef(0);
  const positionedViewRef = useRef(false);
  const gridViewportRef = useRef<ComponentRef<typeof View>>(null);
  const minuteViewportRef = useRef<ComponentRef<typeof View>>(null);
  const bodyWindowRef = useRef({ x: 0, y: insets.top + 110, height: 500 });
  const pendingZoomAnchorRef = useRef<(CalendarZoomAnchor & { generation: number }) | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number; anchor: CalendarZoomAnchor; generation: number } | null>(null);
  const pinchFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const pendingPinchZoomRef = useRef<number | null>(null);
  const gridLayoutRef = useRef(gridLayout);
  const railFormatRef = useRef(timeWidthKey);
  if (railFormatRef.current !== timeWidthKey) {
    if (positionedViewRef.current && !pendingZoomAnchorRef.current) {
      pendingZoomAnchorRef.current = { ...captureZoomAnchor(), generation: navigationGenerationRef.current };
    }
    railFormatRef.current = timeWidthKey;
  }
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
  const measurementKey = timeWidthKey + '|' + liveZoom;
  const measurementKeyRef = useRef(measurementKey);
  measurementKeyRef.current = measurementKey;
  const [dayData, setDayData] = useState<Record<string, DayData>>({});
  const [editor, setEditor] = useState<CalendarMinuteSelection | null>(null);
  const [inlineSelection, setInlineSelection] = useState<CalendarMinuteSelection | null>(null);
  const inlineSelectionRef = useRef(inlineSelection);
  const inlineInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const inlineTapRef = useRef<InlineCellTap | null>(null);
  const inputTouchRef = useRef<{ key: string; until: number } | null>(null);
  const inlineTextSelectionRef = useRef({ start: 0, end: 0 });
  const suppressCellPressRef = useRef<{ key: string; until: number } | null>(null);
  const [inlineVersion, setInlineVersion] = useState(0);
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  const [spreadsheetState, setSpreadsheetState] = useState(() => spreadsheetEditor.snapshot());
  const [rangePanelOpen, setRangePanelOpen] = useState(false);
  const [cellMenuOpen, setCellMenuOpen] = useState(false);
  const [rangeSelecting, setRangeSelecting] = useState(false);
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [rangeStartInput, setRangeStartInput] = useState('');
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  const [rangeEndInput, setRangeEndInput] = useState('');
  const [rangeTitle, setRangeTitle] = useState('');
  const [rangeColorId, setRangeColorId] = useState('unaccounted');
  const [rangeColorChosen, setRangeColorChosen] = useState(false);
  const [rangeDragging, setRangeDragging] = useState(false);
  const [fillHandleVisible, setFillHandleVisible] = useState(false);
  const rangeEndRef = useRef(rangeEnd);
  rangeEndRef.current = rangeEnd;
  const rangeStartRef = useRef(rangeStart);
  rangeStartRef.current = rangeStart;
  const rangeDragRef = useRef<{ selection: CalendarMinuteSelection; generation: number; pageY: number; endMinute: number;
    rowHeight: number; dayWidth: number; gripOffset: number } | null>(null);
  const rangeDragSequenceRef = useRef(0);
  const rangeDragTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fillHandleTop = useRef(new Animated.Value(0)).current;
  const fillHandleLeft = useRef(new Animated.Value(0)).current;
  const fillHandleOpacity = useRef(new Animated.Value(0)).current;
  const cellMenuTop = useRef(new Animated.Value(0)).current;
  const cellMenuHeightRef = useRef(100);
  const cellHoldRef = useRef<{ day: string; minute: number; group: boolean; x: number; y: number;
    generation: number; sequence: number } | null>(null);
  const cellHoldSequenceRef = useRef(0);
  const cellHoldTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const groupDragRef = useRef<{ source: ActivityGroup; grip: ActivityGroupDragGrip; target: ActivityGroupDropTarget;
    x: number; y: number; originX: number; originY: number; moved: boolean;
    sequence: number; generation: number; rowHeight: number; dayWidth: number } | null>(null);
  const groupDragSequenceRef = useRef(0);
  const groupDragOwnedRef = useRef(false);
  const groupDragTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [groupDragging, setGroupDragging] = useState(false);
  const [groupDragPreview, setGroupDragPreview] = useState<{ source: ActivityGroup; target: ActivityGroupDropTarget } | null>(null);
  const [toolbarError, setToolbarError] = useState<string | null>(null);
  const [toolBusy, setToolBusy] = useState(false);
  const toolBusyRef = useRef(false);
  const [availableColors, setAvailableColors] = useState<ActivityCategory[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [projectionWarning, setProjectionWarning] = useState<string | null>(null);
  const [accountWarning, setAccountWarning] = useState<string | null>(null);
  const [inlineLinkWarning, setInlineLinkWarning] = useState(false);
  const [now, setNow] = useState(() => new Date());
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
      positionFillHandle();
    });
  }

  function positionFillHandle() {
    if (!mountedRef.current) return;
    const selection = inlineSelectionRef.current;
    if (!selection) { fillHandleOpacity.setValue(0); setFillHandleVisible(false); return; }
    const layout = gridLayoutRef.current;
    const minute = rangeDragRef.current?.endMinute ?? rangeEndRef.current ?? selection.minuteIndex;
    const y = (minute + 1) * layout.rowHeight - verticalOffsetRef.current - 12;
    const height = bodyWindowRef.current.height;
    const column = visibleDaysRef.current.indexOf(selection.dateKey);
    const left = Math.max(layout.railWidth + column * layout.dayWidth, horizontalOffsetRef.current + layout.railWidth);
    const right = Math.min(layout.railWidth + (column + 1) * layout.dayWidth, horizontalOffsetRef.current + layout.viewportWidth);
    const visible = column >= 0 && right - left >= 24 && Boolean(rangeDragRef.current || (y >= -12 && y < height));
    fillHandleLeft.setValue(Math.max(left, right - 25));
    const handleTop = Math.max(0, Math.min(Math.max(0, height - 24), y));
    fillHandleTop.setValue(handleTop);
    fillHandleOpacity.setValue(visible ? 1 : 0); setFillHandleVisible(visible);
    const first = Math.min(rangeStartRef.current ?? selection.minuteIndex, minute);
    const last = Math.max(rangeStartRef.current ?? selection.minuteIndex, minute);
    const visibleTop = Math.max(0, Math.min(height, first * layout.rowHeight - verticalOffsetRef.current));
    const visibleBottom = Math.max(0, Math.min(height, (last + 1) * layout.rowHeight - verticalOffsetRef.current));
    const menuHeight = Math.min(cellMenuHeightRef.current, Math.max(48, height - 12));
    let menuY = visibleBottom - visibleTop < menuHeight + 40
      ? visibleTop >= menuHeight + 12 ? visibleTop - menuHeight - 8 : visibleBottom + 8
      : (visibleTop + visibleBottom - menuHeight) / 2;
    const menuLimit = Math.max(6, height - menuHeight - 6);
    menuY = Math.max(6, Math.min(menuLimit, menuY));
    if (menuY < handleTop + 30 && menuY + menuHeight > handleTop) {
      menuY = handleTop + menuHeight + 38 <= height - 6 ? handleTop + 32 : handleTop - menuHeight - 8;
    }
    cellMenuTop.setValue(Math.max(6, Math.min(menuLimit, menuY)));
  }

  function cancelRangeDrag(updateUI = true) {
    rangeDragSequenceRef.current += 1;
    const drag = rangeDragRef.current;
    rangeDragRef.current = null;
    if (rangeDragTimerRef.current) clearInterval(rangeDragTimerRef.current);
    rangeDragTimerRef.current = null;
    if (drag && updateUI && mountedRef.current) {
      setRangeDragging(false); setRangeSelecting(false); setRangePanelOpen(false); setCellMenuOpen(false);
      setRangeStart(null); setRangeEnd(null); rangeEndRef.current = null;
      positionFillHandle();
    }
  }

  function cancelCellHold() {
    cellHoldSequenceRef.current += 1;
    cellHoldRef.current = null;
    for (const timer of cellHoldTimersRef.current) clearTimeout(timer);
    cellHoldTimersRef.current = [];
  }

  function groupDragGeometry() {
    const bounds = bodyWindowRef.current;
    const layout = gridLayoutRef.current;
    return { left: bounds.x, top: bounds.y, width: layout.viewportWidth, height: bounds.height,
      offsetX: horizontalOffsetRef.current, offsetY: verticalOffsetRef.current,
      railWidth: layout.railWidth, dayWidth: layout.dayWidth, rowHeight: layout.rowHeight,
      dates: visibleDaysRef.current };
  }

  function cancelGroupDrag(updateUI = true) {
    cancelCellHold();
    groupDragSequenceRef.current += 1;
    groupDragOwnedRef.current = false;
    groupDragRef.current = null;
    if (groupDragTimerRef.current) clearInterval(groupDragTimerRef.current);
    groupDragTimerRef.current = null;
    if (updateUI && mountedRef.current) { setGroupDragging(false); setGroupDragPreview(null); }
  }

  function groupDragIsCurrent(drag: NonNullable<typeof groupDragRef.current>) {
    const layout = gridLayoutRef.current;
    return mountedRef.current && AppState.currentState === 'active' &&
      drag.sequence === groupDragSequenceRef.current &&
      drag.generation === navigationGenerationRef.current && drag.rowHeight === layout.rowHeight && drag.dayWidth === layout.dayWidth;
  }

  function updateGroupDrag(x: number, y: number) {
    const drag = groupDragRef.current;
    if (!drag) return;
    if (!groupDragIsCurrent(drag)) { cancelGroupDrag(); return; }
    drag.x = x; drag.y = y;
    if (Math.hypot(x - drag.originX, y - drag.originY) > 4) drag.moved = true;
    const target = activityGroupDropTarget(x, y, groupDragGeometry(), drag.grip);
    if (target) {
      drag.target = target;
      setGroupDragPreview({ source: drag.source, target });
    }
  }

  async function beginGroupDrag(hold: NonNullable<typeof cellHoldRef.current>) {
    if (!hold.group || cellHoldRef.current !== hold || toolBusyRef.current || spreadsheetEditor.snapshot().busy) return;
    let source: ActivityGroup | null;
    try { source = await getMovableActivityGroup(hold.day, hold.minute); }
    catch { return; }
    if (!source || cellHoldRef.current !== hold || hold.generation !== navigationGenerationRef.current ||
        !mountedRef.current || AppState.currentState !== 'active') return;
    const geometry = groupDragGeometry();
    const grip = activityGroupDragGrip(hold.x, hold.y, geometry, source);
    if (!grip) return;
    const target = activityGroupDropTarget(hold.x, hold.y, geometry, grip);
    if (!target) return;
    cancelRangeDrag(false); cancelCellHold();
    selectionTokenRef.current += 1;
    if (pinchFrameRef.current != null) cancelAnimationFrame(pinchFrameRef.current);
    pinchFrameRef.current = null; pinchRef.current = null; pendingPinchZoomRef.current = null;
    pendingZoomAnchorRef.current = null; setPinching(false);
    // Keep the original input/Pressable mounted until the parent owns the held pointer.
    setRangePanelOpen(false); setCellMenuOpen(false); setColorPanelOpen(false);
    inlineTapRef.current = null; inputTouchRef.current = null;
    Keyboard.dismiss();
    groupDragRef.current = { source, grip, target, x: hold.x, y: hold.y,
      originX: hold.x, originY: hold.y, moved: false,
      sequence: ++groupDragSequenceRef.current,
      generation: navigationGenerationRef.current, rowHeight: geometry.rowHeight, dayWidth: geometry.dayWidth };
    setGroupDragging(true); setGroupDragPreview({ source, target });
    groupDragTimerRef.current = setInterval(() => {
      const drag = groupDragRef.current;
      if (!drag) return;
      if (!groupDragIsCurrent(drag)) { cancelGroupDrag(); return; }
      if (!drag.moved || !groupDragOwnedRef.current) return;
      const offsets = activityGroupDragScrollOffsets(drag.x, drag.y, groupDragGeometry());
      if (offsets.x !== horizontalOffsetRef.current) {
        horizontalOffsetRef.current = offsets.x; horizontalOffset.setValue(offsets.x);
        horizontalRef.current?.scrollTo({ x: offsets.x, animated: false });
      }
      if (offsets.y !== verticalOffsetRef.current) {
        verticalOffsetRef.current = offsets.y;
        listRef.current?.scrollToOffset({ offset: offsets.y, animated: false });
      }
      updateGroupDrag(drag.x, drag.y);
    }, 50);
  }

  async function finishGroupDrag(x: number, y: number) {
    const drag = groupDragRef.current;
    if (!drag) return;
    updateGroupDrag(x, y);
    if (groupDragRef.current !== drag || !groupDragIsCurrent(drag)) { cancelGroupDrag(); return; }
    const claimed = groupDragOwnedRef.current;
    groupDragOwnedRef.current = false;
    groupDragRef.current = null;
    if (groupDragTimerRef.current) clearInterval(groupDragTimerRef.current);
    groupDragTimerRef.current = null;
    setGroupDragging(false); setGroupDragPreview(null);
    const source = drag.source;
    const destination = claimed && drag.moved ? { dateKey: drag.target.dateKey, startMinute: drag.target.startMinute }
      : { dateKey: source.dateKey, startMinute: source.startMinute };
    if (destination.dateKey === source.dateKey && destination.startMinute === source.startMinute) {
      await openInlineMinute(source.dateKey, source.startMinute, false, source, true, true);
      return;
    }
    let preview: Awaited<ReturnType<typeof prepareActivityGroupMove>> | null = null;
    const prepared = await runSpreadsheetTool(async () => { preview = await prepareActivityGroupMove(source, destination); });
    if (!prepared || !preview || !groupDragIsCurrent(drag)) return;
    const pending = preview as Awaited<ReturnType<typeof prepareActivityGroupMove>>;
    if (pending.occupiedCount) {
      const replace = await new Promise<boolean>((resolve) => Alert.alert('Replace existing cells?',
        `${pending.occupiedCount} destination ${pending.occupiedCount === 1 ? 'minute contains' : 'minutes contain'} text or formatting.`,
        [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Replace', onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));
      if (!replace || !groupDragIsCurrent(drag)) return;
    }
    const affectedDates = [...new Set([source.dateKey, destination.dateKey])];
    affectedDates.forEach((day) => markLocalChange([day]));
    const moved = await runSpreadsheetTool(async () => {
      await moveActivityGroup(source, destination, { previewToken: pending.token });
      await Promise.all(affectedDates.map(refreshLocalEntries));
    });
    if (moved && groupDragIsCurrent(drag)) {
      const movedGroup = { ...source, dateKey: destination.dateKey, startMinute: destination.startMinute,
        endMinute: destination.startMinute + source.endMinute - source.startMinute };
      await openInlineMinute(destination.dateKey, destination.startMinute, false, movedGroup, true, true);
    }
  }

  async function openLongPressMenu(day: string, minute: number) {
    const selection = inlineSelectionRef.current;
    const start = rangeStartRef.current ?? selection?.minuteIndex ?? -1;
    const end = rangeEndRef.current ?? selection?.minuteIndex ?? -1;
    if (selection?.dateKey === day && minute >= Math.min(start, end) && minute <= Math.max(start, end)) {
      if (!await prepareOptions(selection) || groupDragRef.current) return;
      setColorPanelOpen(false); setRangePanelOpen(false); setCellMenuOpen(true); setToolbarError(null);
      Keyboard.dismiss(); positionFillHandle();
    } else await openInlineMinute(day, minute, false, undefined, true, true);
  }

  function beginCellHold(day: string, minute: number, group: boolean, event: GestureResponderEvent) {
    if (groupDragRef.current || rangeDragRef.current || toolBusyRef.current || spreadsheetEditor.snapshot().busy) return;
    cancelCellHold();
    if (event.nativeEvent.touches.length !== 1) return;
    const hold = { day, minute, group, x: event.nativeEvent.pageX, y: event.nativeEvent.pageY,
      generation: navigationGenerationRef.current, sequence: cellHoldSequenceRef.current };
    cellHoldRef.current = hold;
    cellHoldTimersRef.current.push(setTimeout(() => {
      if (cellHoldRef.current !== hold || hold.generation !== navigationGenerationRef.current) return;
      suppressCellPressRef.current = { key: inlineMinuteKey(day, minute), until: Number.POSITIVE_INFINITY };
      void openLongPressMenu(day, minute);
    }, 450));
    if (group) cellHoldTimersRef.current.push(setTimeout(() => { void beginGroupDrag(hold); }, 1100));
  }

  function moveCellHold(event: GestureResponderEvent) {
    const { pageX: x, pageY: y, touches } = event.nativeEvent;
    if (touches.length !== 1) { cancelGroupDrag(); return; }
    if (groupDragRef.current) { updateGroupDrag(x, y); return; }
    const hold = cellHoldRef.current;
    if (hold && Math.hypot(x - hold.x, y - hold.y) > 8) cancelCellHold();
  }

  function endCellHold(event: GestureResponderEvent) {
    cancelCellHold();
    if (groupDragRef.current) void finishGroupDrag(event.nativeEvent.pageX, event.nativeEvent.pageY);
  }

  function cancelCellInteraction() {
    cancelCellHold();
    if (groupDragRef.current && !groupDragOwnedRef.current) cancelGroupDrag();
  }

  function claimGroupDrag() {
    groupDragOwnedRef.current = true;
    const selection = inlineSelectionRef.current;
    if (selection) inlineMinuteDrafts.close(inlineMinuteKey(selection.dateKey, selection.minuteIndex));
    setInlineSelection(null); setRangeSelecting(false);
  }

  function rangeDragIsCurrent(drag: NonNullable<typeof rangeDragRef.current>) {
    const selected = inlineSelectionRef.current;
    return mountedRef.current && AppState.currentState === 'active' &&
      drag.generation === navigationGenerationRef.current &&
      drag.rowHeight === gridLayoutRef.current.rowHeight && drag.dayWidth === gridLayoutRef.current.dayWidth &&
      selected?.dateKey === drag.selection.dateKey && selected.minuteIndex === drag.selection.minuteIndex;
  }

  function updateRangeDrag(pageY: number) {
    const drag = rangeDragRef.current;
    if (!drag) return;
    if (!rangeDragIsCurrent(drag)) { cancelRangeDrag(); return; }
    drag.pageY = pageY;
    const bounds = bodyWindowRef.current;
    const minute = minuteAtDragPosition(pageY, bounds.y, bounds.height,
      verticalOffsetRef.current, gridLayoutRef.current.rowHeight, drag.gripOffset);
    if (minute != null && minute !== drag.endMinute) {
      drag.endMinute = minute; rangeEndRef.current = minute;
      setRangeEnd(minute); setRangeEndInput(timeLabel(minute));
    }
    positionFillHandle();
  }

  function beginRangeDrag(event: GestureResponderEvent) {
    const selection = inlineSelectionRef.current;
    if (!selection || groupDragRef.current || toolBusyRef.current || spreadsheetEditor.snapshot().busy || event.nativeEvent.touches.length !== 1) return;
    cancelCellHold();
    const initialEnd = rangeEndRef.current ?? selection.minuteIndex;
    const hasRange = rangeStartRef.current != null;
    const gripOffset = minuteDragGripOffset(event.nativeEvent.pageY, bodyWindowRef.current.y,
      verticalOffsetRef.current, gridLayoutRef.current.rowHeight, initialEnd);
    if (gripOffset == null) return;
    cancelRangeDrag(false);
    if (pinchFrameRef.current != null) cancelAnimationFrame(pinchFrameRef.current);
    pinchFrameRef.current = null; pinchRef.current = null; pendingPinchZoomRef.current = null;
    pendingZoomAnchorRef.current = null; setPinching(false);
    horizontalRef.current?.scrollTo({ x: horizontalOffsetRef.current, animated: false });
    listRef.current?.scrollToOffset({ offset: verticalOffsetRef.current, animated: false });
    inlineTapRef.current = null; inputTouchRef.current = null;
    if (!hasRange) configureRangePanel(selection, undefined, false);
    setRangePanelOpen(false); setCellMenuOpen(false);
    rangeDragRef.current = { selection, generation: navigationGenerationRef.current,
      pageY: event.nativeEvent.pageY, endMinute: initialEnd,
      rowHeight: gridLayoutRef.current.rowHeight, dayWidth: gridLayoutRef.current.dayWidth, gripOffset };
    setRangeDragging(true); measureMinuteViewport(); positionFillHandle();
    rangeDragTimerRef.current = setInterval(() => {
      const drag = rangeDragRef.current;
      if (!drag) return;
      if (!rangeDragIsCurrent(drag)) { cancelRangeDrag(); return; }
      const bounds = bodyWindowRef.current;
      const next = minuteDragScrollOffset(drag.pageY, bounds.y, bounds.height,
        verticalOffsetRef.current, gridLayoutRef.current.rowHeight);
      if (next !== verticalOffsetRef.current) {
        verticalOffsetRef.current = next;
        listRef.current?.scrollToOffset({ offset: next, animated: false });
        updateRangeDrag(drag.pageY);
      }
    }, 50);
  }

  async function finishRangeDrag(event: GestureResponderEvent) {
    const drag = rangeDragRef.current;
    if (!drag) return;
    updateRangeDrag(event.nativeEvent.pageY);
    if (!rangeDragRef.current || !rangeDragIsCurrent(drag)) { cancelRangeDrag(); return; }
    const sequence = rangeDragSequenceRef.current;
    rangeDragRef.current = null;
    if (rangeDragTimerRef.current) clearInterval(rangeDragTimerRef.current);
    rangeDragTimerRef.current = null; setRangeDragging(false);
    if (await prepareOptions(drag.selection) && sequence === rangeDragSequenceRef.current && rangeDragIsCurrent(drag)) {
      setCellMenuOpen(true); Keyboard.dismiss();
    }
  }

  const rangeDragResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length === 1,
    onMoveShouldSetPanResponder: (event) => event.nativeEvent.touches.length === 1,
    onPanResponderGrant: beginRangeDrag,
    onPanResponderMove: (event) => {
      if (event.nativeEvent.touches.length !== 1) { cancelRangeDrag(); return; }
      updateRangeDrag(event.nativeEvent.pageY);
    },
    onPanResponderRelease: (event) => { void finishRangeDrag(event); },
    onPanResponderTerminate: () => cancelRangeDrag(),
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), []);

  useEffect(() => { positionFillHandle(); }, [inlineSelection, rangeStart, rangeEnd, gridLayout]);
  useEffect(() => () => cancelRangeDrag(false), []);
  useEffect(() => () => cancelGroupDrag(false), []);

  function timeLabel(minute: number) { return minuteLabel(minute, clockFormatRef.current === '12h'); }

  function recordTimeLabelWidth(width: number, key: string) {
    if (!mountedRef.current || key !== measurementKeyRef.current || !Number.isFinite(width) || width <= 0) return;
    const baseWidth = width / liveZoom;
    if (Math.abs((measuredTimeWidths[timeWidthKey] ?? 0) - baseWidth) < 0.3) return;
    if (positionedViewRef.current && !pendingZoomAnchorRef.current) {
      pendingZoomAnchorRef.current = { ...captureZoomAnchor(), generation: navigationGenerationRef.current };
    }
    setMeasuredTimeWidths((previous) => ({ ...previous, [timeWidthKey]: baseWidth }));
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
    if (rangeDragRef.current || groupDragRef.current) return;
    const anchor = pendingZoomAnchorRef.current;
    if (!anchor || !mountedRef.current || anchor.generation !== navigationGenerationRef.current) return;
    const offsets = calendarZoomOffsets(anchor, gridLayoutRef.current, bodyWindowRef.current.height);
    horizontalOffsetRef.current = offsets.x; verticalOffsetRef.current = offsets.y;
    horizontalOffset.setValue(offsets.x);
    horizontalRef.current?.scrollTo({ x: offsets.x, animated: false });
    listRef.current?.scrollToOffset({ offset: offsets.y, animated: false });
  }

  function applyLiveZoom(value: number, anchor: CalendarZoomAnchor) {
    if (rangeDragRef.current || groupDragRef.current) return;
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
    onStartShouldSetPanResponderCapture: (event) => Boolean(groupDragRef.current) || (!rangeDragRef.current && event.nativeEvent.touches.length === 2),
    onMoveShouldSetPanResponderCapture: (event) => Boolean(groupDragRef.current) || (!rangeDragRef.current && event.nativeEvent.touches.length === 2),
    onPanResponderGrant: (event: GestureResponderEvent) => {
      if (groupDragRef.current) {
        if (event.nativeEvent.touches.length !== 1) cancelGroupDrag();
        else claimGroupDrag();
        return;
      }
      cancelCellHold();
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
      if (groupDragRef.current) {
        if (event.nativeEvent.touches.length !== 1) cancelGroupDrag();
        else updateGroupDrag(event.nativeEvent.pageX, event.nativeEvent.pageY);
        return;
      }
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
    onPanResponderRelease: (event) => {
      if (groupDragRef.current) void finishGroupDrag(event.nativeEvent.pageX, event.nativeEvent.pageY);
      else finishPinch();
    },
    onPanResponderTerminate: () => { cancelGroupDrag(); finishPinch(); },
    onPanResponderReject: () => { cancelGroupDrag(); finishPinch(); },
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
      positionFillHandle();
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
      const [entries, planResults, formats, groups] = await Promise.all([
        getDayEntries(day),
        Promise.allSettled([
          loadPlannedEventsResult(preferences.selectedCalendarIds, day, calendars), loadAccountPlans(day),
        ]),
        getDayCellFormats(day).catch(() => null),
        getDayActivityGroups(day).catch(() => null),
      ]);
      return { day, entries, plans: planResults.flatMap((result) => result.status === 'fulfilled'
        ? Array.isArray(result.value) ? result.value : result.value.plans : []),
        calendarReadError: planResults.some((result) => result.status === 'rejected' ||
          (!Array.isArray(result.value) && result.value.failures.length > 0)), formats, groups };
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
          formatReadError: value.formats == null,
          groups: value.groups && entriesStillCurrent && requestedFormatVersion === spreadsheetEditor.snapshot().formatVersion
            ? value.groups : previous[value.day]?.groups,
          groupReadError: value.groups == null };
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
    cancelRangeDrag();
    cancelGroupDrag();
    if (pinchFrameRef.current != null) cancelAnimationFrame(pinchFrameRef.current);
    pinchFrameRef.current = null;
    pinchRef.current = null;
    pendingPinchZoomRef.current = null;
    pendingZoomAnchorRef.current = null;
    setPinching(false);
    const requestedZoom = normalizeCalendarZoom(zoom);
    if (zoomRef.current !== requestedZoom) {
      dateBufferRef.current = { key: navigationKey, count: gridDayCount };
      zoomRef.current = requestedZoom; setLiveZoom(requestedZoom);
    }
    const previous = inlineSelectionRef.current;
    if (previous) inlineMinuteDrafts.close(inlineMinuteKey(previous.dateKey, previous.minuteIndex));
    setInlineSelection(null);
    setCellMenuOpen(false);
    setColorPanelOpen(false);
    setRangePanelOpen(false);
    setRangeSelecting(false);
    setRangeStart(null);
    setRangeEnd(null);
    setToolbarError(null);
    inlineTapRef.current = null;
    suppressCellPressRef.current = null;
    Keyboard.dismiss();
    setLoadError(false);
    setRefreshing(false);
  }, [navigationKey]);

  useEffect(() => inlineMinuteDrafts.subscribe(() => setInlineVersion((value) => value + 1)), []);
  useEffect(() => subscribeInlineMinuteLinkWarnings(setInlineLinkWarning), []);
  useEffect(() => spreadsheetEditor.subscribe(() => setSpreadsheetState(spreadsheetEditor.snapshot())), []);

  useEffect(() => {
    if (rangeStart != null) setRangeStartInput(timeLabel(rangeStart));
    if (rangeEnd != null) setRangeEndInput(timeLabel(rangeEnd));
    // Changing the display convention keeps the dated range and draft intact.
  }, [clockFormat]);

  useEffect(() => {
    let current = true;
    void listSelectableActivityCategories().then((values) => { if (current) setAvailableColors(values); }).catch(() => {});
    return () => { current = false; };
  }, [dataVersion, colorPanelOpen]);

  const inlineDrafts = useMemo(() => inlineMinuteDrafts.snapshot(), [inlineVersion]);
  const draftsByKey = useMemo(() => new Map(inlineDrafts.map((draft) => [draft.key, draft])), [inlineDrafts]);
  const inlineError = inlineDrafts.some((draft) => draft.error);

  useEffect(() => { void reload(); }, [dataVersion, reload]);

  useEffect(() => {
    if (!preferences.selectedCalendarIds.length) return;
    // Phone calendar sync may finish after the return-to-app refresh burst.
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void reload();
    }, 15_000);
    return () => clearInterval(timer);
  }, [reload, preferences.selectedCalendarIds]);

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
        cancelRangeDrag();
        cancelGroupDrag();
        setCellMenuOpen(false);
        const selected = inlineSelectionRef.current;
        if (selected) inlineMinuteDrafts.close(inlineMinuteKey(selected.dateKey, selected.minuteIndex));
        setInlineSelection(null);
        setColorPanelOpen(false);
        setRangePanelOpen(false);
        setRangeSelecting(false);
        inlineTapRef.current = null;
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
  const indexedGroups = useMemo(() => new Map(days.map((day) => {
    const groups = new Map<number, ActivityGroup>();
    for (const group of dayData[day]?.groups ?? []) {
      for (let minute = group.startMinute; minute <= group.endMinute; minute += 1) groups.set(minute, group);
    }
    return [day, groups];
  })), [days, dayData]);
  const today = dateKey(now);
  const currentMinute = minuteIndexForDate(now);
  const calendarReadError = days.some((day) => dayData[day]?.calendarReadError);
  const hasAllDay = days.some((day) => dayData[day]?.plans.some((plan) => plan.allDay));

  useEffect(() => {
    if (explicitDays) {
      clockDayRef.current = today;
      pendingRolloverRef.current = null;
      return;
    }
    if (clockDayRef.current !== today) {
      if (activeDate === clockDayRef.current) pendingRolloverRef.current = { from: activeDate, to: today };
      clockDayRef.current = today;
    }
    const pending = pendingRolloverRef.current;
    if (!pending) return;
    if (activeDate !== pending.from) { pendingRolloverRef.current = null; return; }
    // Follow the current day after midnight, but finish any dated draft first.
    if (!editor && !inlineSelection && !dateSelectionOpen) {
      pendingRolloverRef.current = null;
      onDateChange(pending.to);
    }
  }, [activeDate, today, editor, inlineSelection, onDateChange, explicitDays, dateSelectionOpen]);

  const jumpToMinute = useCallback((minute: number) => {
    const generation = navigationGenerationRef.current;
    requestAnimationFrame(() => {
      if (!mountedRef.current || generation !== navigationGenerationRef.current || rangeDragRef.current || groupDragRef.current || cellHoldRef.current) return;
      listRef.current?.scrollToIndex({ index: Math.max(0, Math.min(1439, minute - 3)), animated: false });
      positionedViewRef.current = true;
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
      if (!mountedRef.current || generation !== navigationGenerationRef.current || rangeDragRef.current || groupDragRef.current || cellHoldRef.current) return;
      const selectedDay = day ?? inlineSelectionRef.current?.dateKey;
      if (selectedDay) {
        const offset = revealCalendarDay(horizontalOffsetRef.current,
          visibleDaysRef.current.indexOf(selectedDay), gridLayoutRef.current);
        horizontalOffsetRef.current = offset;
        horizontalRef.current?.scrollTo({ x: offset, animated: false });
      }
      listRef.current?.scrollToIndex({ index: minute, viewPosition: 0.3, animated: false });
      positionedViewRef.current = true;
    });
  }, []);

  function configureRangePanel(selection: CalendarMinuteSelection, group?: ActivityGroup, showPopup = true) {
    const start = group?.startMinute ?? selection.minuteIndex;
    const end = group?.endMinute ?? selection.minuteIndex;
    setRangeStart(start); setRangeStartInput(timeLabel(start));
    setRangeEnd(end); setRangeEndInput(timeLabel(end));
    rangeEndRef.current = end; setRangeColorChosen(false);
    const anchorText = inlineMinuteDrafts.get(selection.dateKey, selection.minuteIndex)?.text ?? selection.entry?.text ?? '';
    setRangeTitle(group?.title ?? anchorText.split(/\r?\n/, 1)[0]!.trim().slice(0, 200));
    setRangeColorId(group?.categoryId ?? inlineMinuteDrafts.get(selection.dateKey, selection.minuteIndex)?.categoryId ??
      selection.entry?.categoryId ?? selection.plan?.categoryId ?? 'unaccounted');
    setToolbarError(null); setColorPanelOpen(false); setCellMenuOpen(false); setRangeSelecting(true); setRangePanelOpen(showPopup);
    Keyboard.dismiss();
  }

  async function flushDraftsForOptions() {
    await Promise.all([...sourceColorJobs.current.values()]);
    await inlineMinuteDrafts.flushAll();
    if (inlineMinuteDrafts.snapshot().some((draft) => draft.error || draft.revision !== draft.savedRevision)) {
      if (mountedRef.current) setToolbarError('A minute has not saved yet. Retry saving before opening these options.');
      return false;
    }
    return true;
  }

  function recordExplicitColor(day: string, first: number, last = first) {
    for (let minute = first; minute <= last; minute++) {
      const key = inlineMinuteKey(day, minute);
      explicitColorEpochs.current.set(key, (explicitColorEpochs.current.get(key) ?? 0) + 1);
    }
  }

  function inheritNewMinuteColor(day: string, minute: number, plan: PlannedEvent | undefined,
    initialCategoryId: string, initialRevision: number, hasEntry: boolean) {
    if (hasEntry || !plan || !calendarColor(plan.color)) return;
    const key = inlineMinuteKey(day, minute);
    const epoch = explicitColorEpochs.current.get(key) ?? 0;
    if (initialRevision === 0) sourceColorEligibility.current.set(key, { categoryId: initialCategoryId, epoch });
    const eligible = sourceColorEligibility.current.get(key);
    if (!eligible || eligible.categoryId !== initialCategoryId || eligible.epoch !== epoch || sourceColorJobs.current.has(key)) return;
    sourceColorJobEpochs.current.set(key, epoch);
    const job = (async () => {
      const account = plan.accountEvent ? (await getAccounts()).find((item) => item.id === plan.accountEvent!.accountId) : undefined;
      const provider = plan.sourceProvider ?? (account?.provider === 'google' || account?.provider === 'microsoft' ? account.provider : 'device');
      const label = calendars.find((calendar) => calendar.id === plan.calendarId)?.title || plan.title || 'Calendar activity';
      const category = await ensureSourceColorCategory({ color: plan.color, name: `${label} · ${plan.color}`,
        calendarId: plan.calendarId, provider, accountId: plan.accountEvent?.accountId, preferredCategoryId: plan.categoryId });
      const current = inlineMinuteDrafts.get(day, minute);
      if (!current || !current.text.trim() || current.categoryId !== initialCategoryId ||
          (explicitColorEpochs.current.get(key) ?? 0) !== epoch) return;
      editInlineMinute(day, minute, { categoryId: category.id });
    })().catch(() => {
      if (mountedRef.current) setActionError('The event color could not be preserved. Your minute text is kept for saving.');
    }).finally(() => {
      if (sourceColorJobs.current.get(key) === job) { sourceColorJobs.current.delete(key); sourceColorJobEpochs.current.delete(key); }
    });
    sourceColorJobs.current.set(key, job);
    inlineMinuteDrafts.prepareBeforeSave(key, job);
  }

  async function prepareOptions(selection: CalendarMinuteSelection) {
    const token = ++selectionTokenRef.current;
    const generation = navigationGenerationRef.current;
    if (!await flushDraftsForOptions()) return false;
    const current = inlineSelectionRef.current;
    return mountedRef.current && generation === navigationGenerationRef.current && token === selectionTokenRef.current &&
      current?.dateKey === selection.dateKey && current.minuteIndex === selection.minuteIndex;
  }

  async function openCellOptions(day: string, minute: number) {
    const selection = inlineSelectionRef.current;
    if (!selection || selection.dateKey !== day || selection.minuteIndex !== minute || !await prepareOptions(selection)) return;
    inlineTapRef.current = null;
    setCellMenuOpen(false); setRangePanelOpen(false); setRangeSelecting(false); setColorPanelOpen(true); setToolbarError(null);
    Keyboard.dismiss();
  }

  const openInlineMinute = useCallback(async (day: string, minute: number, showColors = false,
    group?: ActivityGroup, selectRange = false, keepViewport = false) => {
    const token = ++selectionTokenRef.current;
    const request = { dateKey: day, minuteIndex: minute, rangeKey: rangeRef.current, token };
    const currentState = () => ({ mounted: mountedRef.current, rangeKey: rangeRef.current,
      token: selectionTokenRef.current, visibleDays: visibleDaysRef.current });
    try {
      if ((showColors || group || selectRange) && !await flushDraftsForOptions()) return;
      if (!calendarSelectionIsCurrent(request, currentState())) return;
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
      setCellMenuOpen(false);
      setRangePanelOpen(false);
      setRangeSelecting(false);
      setRangeStart(null);
      setRangeEnd(null);
      setToolbarError(null);
      inlineTapRef.current = null;
      inputTouchRef.current = null;
      inlineTextSelectionRef.current = { start: 0, end: 0 };
      const showPaste = !showColors && !group && Boolean(getSpreadsheetClipboard());
      if (group || selectRange || showPaste) configureRangePanel(selection, group, Boolean(group) && !selectRange);
      if (selectRange || showPaste) setCellMenuOpen(true);
      if (showColors || group || selectRange || showPaste) Keyboard.dismiss();
      if (!keepViewport) revealInlineMinute(minute, day);
    } catch {
      if (mountedRef.current && token === selectionTokenRef.current) setActionError('This minute could not be opened. Please try again.');
    }
  }, [revealInlineMinute]);

  useEffect(() => {
    if (!inlineSelection || colorPanelOpen || cellMenuOpen || rangeSelecting) return;
    const token = selectionTokenRef.current;
    const frame = requestAnimationFrame(() => {
      if (mountedRef.current && token === selectionTokenRef.current && !rangeDragRef.current && !groupDragRef.current && !cellHoldRef.current) inlineInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [inlineSelection?.dateKey, inlineSelection?.minuteIndex, colorPanelOpen, cellMenuOpen, rangeSelecting]);

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
    setCellMenuOpen(false);
    setColorPanelOpen(false);
    setRangeSelecting(false); setRangePanelOpen(false);
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

  async function refreshLocalEntries(value: string) {
    const epoch = localEpochsRef.current.get(value) ?? 0;
    const formatVersion = spreadsheetEditor.snapshot().formatVersion;
    await Promise.all([getDayEntries(value), getDayActivityGroups(value).catch(() => null)]).then(([entries, groups]) => {
      if (!mountedRef.current || !visibleDaysRef.current.includes(value) ||
          (localEpochsRef.current.get(value) ?? 0) !== epoch) return;
      setDayData((previous) => {
        if (!visibleDaysRef.current.includes(value) || (localEpochsRef.current.get(value) ?? 0) !== epoch) return previous;
        return { ...previous, [value]: {
          entries, plans: previous[value]?.plans ?? [], calendarReadError: previous[value]?.calendarReadError ?? false,
          formats: previous[value]?.formats, formatReadError: previous[value]?.formatReadError,
          groups: groups && formatVersion === spreadsheetEditor.snapshot().formatVersion ? groups : previous[value]?.groups,
          groupReadError: groups == null,
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

  const notice = (inlineError ? 'A minute could not be saved. Tap to retry; your draft is kept.' : null) ?? toolbarError ?? actionError ??
    (inlineLinkWarning ? 'Account synchronization needs a retry. Your minute is saved.' : null) ?? accountWarning ?? projectionWarning ??
    (loadError ? 'Some ledger rows could not refresh. Pull down to retry.' :
      calendarReadError ? 'Some calendar plans could not load. Pull down to retry.' :
        days.some((day) => dayData[day]?.formatReadError) ? 'Some text styles could not refresh. Pull down to retry.' :
          days.some((day) => dayData[day]?.groupReadError) ? 'Some activity outlines could not refresh. Pull down to retry.' : null);
  const selectedDraft = inlineSelection
    ? draftsByKey.get(inlineMinuteKey(inlineSelection.dateKey, inlineSelection.minuteIndex)) : undefined;
  const selectedColor = selectedDraft ? categoryById(selectedDraft.categoryId) : undefined;
  const selectableColorIds = useMemo(() => new Set(availableColors.map((item) => item.id)), [availableColors]);
  const pickerColors = availableColors;
  const groupColor = categoryById(rangeColorId);
  const groupPickerColors = availableColors;
  const groupHasGoogleColor = selectableColorIds.has(rangeColorId);
  const selectedRange = inlineSelection ? { dateKey: inlineSelection.dateKey,
    startMinute: Math.min(rangeStart ?? inlineSelection.minuteIndex, rangeEnd ?? inlineSelection.minuteIndex),
    endMinute: Math.max(rangeStart ?? inlineSelection.minuteIndex, rangeEnd ?? inlineSelection.minuteIndex) } : null;
  const selectedFormat = inlineSelection
    ? dayData[inlineSelection.dateKey]?.formats?.get(inlineSelection.minuteIndex) ?? {} : {};
  const cellPolicy = useMemo(() => {
    if (!selectedRange) return analyzeCellSelection([]);
    const index = indexedDays.get(selectedRange.dateKey);
    const groups = indexedGroups.get(selectedRange.dateKey);
    return analyzeCellSelection(Array.from({ length: selectedRange.endMinute - selectedRange.startMinute + 1 }, (_, offset) => {
      const minuteIndex = selectedRange.startMinute + offset;
      const draft = draftsByKey.get(inlineMinuteKey(selectedRange.dateKey, minuteIndex));
      return { minuteIndex, text: draft?.text ?? index?.entriesByMinute.get(minuteIndex)?.text ??
        index?.plansByMinute.get(minuteIndex)?.[0]?.title ?? '', groupId: groups?.get(minuteIndex)?.blockId };
    }), inlineSelection?.minuteIndex);
  }, [selectedRange?.dateKey, selectedRange?.startMinute, selectedRange?.endMinute, indexedDays, indexedGroups, draftsByKey, inlineSelection?.minuteIndex]);
  const menuGroup = inlineSelection ? indexedGroups.get(inlineSelection.dateKey)?.get(inlineSelection.minuteIndex) : undefined;
  const menuFillColor = calendarCellColor({ hasActual: Boolean(inlineSelection?.entry || (selectedDraft && selectedDraft.revision > 0)),
    actualColor: categoryById(selectedDraft?.categoryId ?? inlineSelection?.entry?.categoryId ?? 'unaccounted').color,
    groupColor: menuGroup ? categoryById(menuGroup.categoryId).color : undefined,
    planColor: inlineSelection?.plan?.color }) ?? colors.paper;
  const menuTextColor = selectedFormat.textColor ?? activityTextColor(menuFillColor, colors.ink);

  async function runSpreadsheetTool(work: () => Promise<unknown>) {
    if (toolBusyRef.current) return;
    toolBusyRef.current = true;
    setToolBusy(true); setToolbarError(null);
    try { await work(); return true; }
    catch (error) { if (mountedRef.current) setToolbarError(error instanceof Error ? error.message : 'This edit could not be applied. Try again.'); }
    finally { toolBusyRef.current = false; if (mountedRef.current) setToolBusy(false); }
  }

  async function openRangePanel() {
    if (rangeSelecting) { await openCurrentRangeOptions(); return; }
    const selection = inlineSelectionRef.current;
    if (!selection || !await prepareOptions(selection)) return;
    const token = selectionTokenRef.current;
    try {
      const groups = await getDayActivityGroups(selection.dateKey);
      if (!mountedRef.current || token !== selectionTokenRef.current) return;
      configureRangePanel(selection, groups.find((item) => item.startMinute <= selection.minuteIndex && item.endMinute >= selection.minuteIndex));
    } catch {
      if (mountedRef.current && token === selectionTokenRef.current) setToolbarError('Activity options could not load. Try again.');
    }
  }

  async function startRangeFromActive() {
    const selection = inlineSelectionRef.current;
    if (selection && await prepareOptions(selection)) configureRangePanel(selection, undefined, false);
  }

  async function openCurrentRangeOptions() {
    const selection = inlineSelectionRef.current;
    if (selection && await prepareOptions(selection)) { setCellMenuOpen(false); setRangePanelOpen(true); Keyboard.dismiss(); }
  }

  function closeRangeOptions() {
    cancelRangeDrag();
    selectionTokenRef.current += 1;
    setCellMenuOpen(false); setRangePanelOpen(false); setRangeSelecting(false); setRangeStart(null); setRangeEnd(null); setToolbarError(null);
  }

  async function selectRangeEndpoint(day: string, minute: number) {
    const selection = inlineSelectionRef.current;
    if (!selection) return;
    if (day !== selection.dateKey) { setToolbarError('Choose the last minute in the same date column.'); return; }
    setRangeEnd(minute); setRangeEndInput(timeLabel(minute)); setToolbarError(null);
    if (await prepareOptions(selection)) { setCellMenuOpen(true); Keyboard.dismiss(); }
  }

  function parsedRange() {
    if (!inlineSelection) return null;
    const start = rangeSelecting ? parseCalendarMinute(rangeStartInput) : inlineSelection.minuteIndex;
    const end = rangeSelecting ? parseCalendarMinute(rangeEndInput) : inlineSelection.minuteIndex;
    if (start == null || end == null) {
      setToolbarError('Enter times such as ' + (clockFormat === '12h' ? '10:20 AM' : '10:20') + ' within this day.'); return null;
    }
    return { dateKey: inlineSelection.dateKey, startMinute: Math.min(start, end), endMinute: Math.max(start, end) };
  }

  async function groupSelection() {
    const range = parsedRange();
    if (!range) return;
    if (!rangeTitle.trim()) { setToolbarError('Enter an activity title.'); return; }
    if (!groupHasGoogleColor) { setToolbarError('Choose a Google Calendar color.'); return; }
    recordExplicitColor(range.dateKey, range.startMinute, range.endMinute);
    const generation = navigationGenerationRef.current;
    const token = selectionTokenRef.current;
    markLocalChange([range.dateKey]);
    const applied = await runSpreadsheetTool(async () => {
      await groupMinuteRange(range, { title: rangeTitle, categoryId: rangeColorId });
      await refreshLocalEntries(range.dateKey);
    });
    if (applied && mountedRef.current && generation === navigationGenerationRef.current && token === selectionTokenRef.current) {
      setCellMenuOpen(false); setRangePanelOpen(false); setRangeSelecting(false); setRangeStart(null); setRangeEnd(null); setColorPanelOpen(false);
    }
  }

  async function autoFillSelection() {
    const range = parsedRange();
    const selection = inlineSelectionRef.current;
    if (!range || !selection) return;
    if (rangeColorChosen && !groupHasGoogleColor) { setToolbarError('Choose a Google Calendar color for Auto fill.'); return; }
    const sourceMinute = cellPolicy.sourceMinute;
    if (!cellPolicy.canAutoFill || sourceMinute == null) return;
    const sourceText = inlineMinuteDrafts.get(selection.dateKey, sourceMinute)?.text ??
      dayDataRef.current[selection.dateKey]?.entries.find((entry) => entry.minuteIndex === sourceMinute)?.text ?? '';
    if (!rangeColorChosen && !sourceText.trim()) {
      setToolbarError('Enter text in the source minute or choose a color before Auto fill.'); return;
    }
    const token = selectionTokenRef.current;
    const generation = navigationGenerationRef.current;
    markLocalChange([range.dateKey]);
    const applied = await runSpreadsheetTool(async () => {
      if (!rangeColorChosen) {
        const source = await getMinuteEntry(selection.dateKey, sourceMinute);
        if (!source?.text.trim()) {
          throw new Error('Enter and save text in the source minute before Auto fill. A calendar plan title alone is not a recorded minute.');
        }
      }
      await fillMinuteRange(range, sourceMinute, rangeColorChosen ? rangeColorId : undefined);
      await refreshLocalEntries(range.dateKey);
    });
    if (applied && mountedRef.current && token === selectionTokenRef.current && generation === navigationGenerationRef.current) {
      closeRangeOptions();
    }
  }

  async function clearSelection() {
    const range = parsedRange();
    if (!range) return;
    const token = selectionTokenRef.current;
    const generation = navigationGenerationRef.current;
    markLocalChange([range.dateKey]);
    const applied = await runSpreadsheetTool(async () => {
      const day = indexedDays.get(range.dateKey);
      const displayedColors = [];
      for (let minuteIndex = range.startMinute; minuteIndex <= range.endMinute; minuteIndex++) {
        const plan = day?.plansByMinute.get(minuteIndex)?.[0];
        if (plan?.title.trim() && plan.categoryId) displayedColors.push({ minuteIndex, categoryId: plan.categoryId });
      }
      await clearTextMinuteRange(range, displayedColors); await refreshLocalEntries(range.dateKey);
    });
    if (applied && mountedRef.current && token === selectionTokenRef.current && generation === navigationGenerationRef.current) closeRangeOptions();
  }

  async function ungroupSelection() {
    const range = parsedRange();
    const selection = inlineSelectionRef.current;
    if (!range || !selection || !await prepareOptions(selection)) return;
    const token = selectionTokenRef.current;
    const generation = navigationGenerationRef.current;
    markLocalChange([range.dateKey]);
    const applied = await runSpreadsheetTool(async () => {
      await ungroupMinuteRange(range); await refreshLocalEntries(range.dateKey);
    });
    if (applied && selectionStillCurrent(selection, token, generation)) closeRangeOptions();
  }

  async function colorSelection(categoryId: string) {
    const range = parsedRange();
    const selection = inlineSelectionRef.current;
    if (!range || !selection || !await prepareOptions(selection)) return;
    recordExplicitColor(range.dateKey, range.startMinute, range.endMinute);
    const token = selectionTokenRef.current;
    const generation = navigationGenerationRef.current;
    markLocalChange([range.dateKey]);
    const applied = await runSpreadsheetTool(async () => {
      await colorMinuteRange(range, categoryId); await refreshLocalEntries(range.dateKey);
    });
    if (applied && selectionStillCurrent(selection, token, generation)) {
      setRangeColorId(categoryId); setRangeColorChosen(false); positionFillHandle();
    }
  }

  function selectionStillCurrent(selection: CalendarMinuteSelection, token: number, generation: number) {
    const current = inlineSelectionRef.current;
    return mountedRef.current && AppState.currentState === 'active' && token === selectionTokenRef.current &&
      generation === navigationGenerationRef.current && current?.dateKey === selection.dateKey &&
      current.minuteIndex === selection.minuteIndex;
  }

  async function captureSelectedCells(mode: 'cut' | 'copy') {
    const range = parsedRange();
    const selection = inlineSelectionRef.current;
    if (!range || !selection || !await prepareOptions(selection)) return;
    const token = selectionTokenRef.current;
    const generation = navigationGenerationRef.current;
    const applied = await runSpreadsheetTool(async () => {
      if (selection.plan) {
        const [entries, formats] = await Promise.all([getDayEntries(range.dateKey), getDayCellFormats(range.dateKey)]);
        if (!entries.some((entry) => entry.minuteIndex >= range.startMinute && entry.minuteIndex <= range.endMinute) &&
            ![...formats.keys()].some((minute) => minute >= range.startMinute && minute <= range.endMinute)) {
          throw new Error('Record the minute text before moving these cells. Edit an original calendar event through its calendar details.');
        }
      }
      await (mode === 'cut' ? cutMinuteRange(range) : copyMinuteRange(range));
    });
    if (applied && selectionStillCurrent(selection, token, generation)) {
      inlineMinuteDrafts.close(inlineMinuteKey(selection.dateKey, selection.minuteIndex));
      closeRangeOptions(); setInlineSelection(null); setColorPanelOpen(false); Keyboard.dismiss();
    }
  }

  async function pasteSelectedCells() {
    const selection = inlineSelectionRef.current;
    const clipboard = getSpreadsheetClipboard();
    if (!selection || !clipboard || !await prepareOptions(selection)) return;
    const token = selectionTokenRef.current;
    const generation = navigationGenerationRef.current;
    const destination = { dateKey: selection.dateKey, startMinute: selectedRange?.startMinute ?? selection.minuteIndex };
    let preview: Awaited<ReturnType<typeof prepareMinutePaste>> | null = null;
    const prepared = await runSpreadsheetTool(async () => { preview = await prepareMinutePaste(destination); });
    if (!prepared || !preview || !selectionStillCurrent(selection, token, generation)) return;
    const pending = preview as Awaited<ReturnType<typeof prepareMinutePaste>>;
    if (pending.occupiedCount > 0) {
      const replace = await new Promise<boolean>((resolve) => Alert.alert('Replace existing cells?',
        `${pending.occupiedCount} destination ${pending.occupiedCount === 1 ? 'minute contains' : 'minutes contain'} text or formatting.`,
        [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Replace', onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));
      if (!replace || !selectionStillCurrent(selection, token, generation)) return;
    }
    const affectedDates = [...new Set([destination.dateKey, ...(clipboard.mode === 'cut' ? [clipboard.range.dateKey] : [])])];
    affectedDates.forEach((day) => markLocalChange([day]));
    const applied = await runSpreadsheetTool(async () => {
      await pasteMinuteRange(destination, { previewToken: pending.token });
      await Promise.all(affectedDates.map(refreshLocalEntries));
    });
    if (applied && selectionStillCurrent(selection, token, generation)) closeRangeOptions();
  }

  function goToCurrentMinute() {
    cancelRangeDrag();
    cancelGroupDrag();
    const current = new Date();
    const day = dateKey(current);
    navigationGenerationRef.current += 1;
    selectionTokenRef.current += 1;
    if (pinchFrameRef.current != null) cancelAnimationFrame(pinchFrameRef.current);
    pinchFrameRef.current = null; pinchRef.current = null; pendingPinchZoomRef.current = null;
    pendingZoomAnchorRef.current = null; setPinching(false);
    const selection = inlineSelectionRef.current;
    if (selection) inlineMinuteDrafts.close(inlineMinuteKey(selection.dateKey, selection.minuteIndex));
    setInlineSelection(null); setCellMenuOpen(false); setColorPanelOpen(false); setRangePanelOpen(false); setRangeSelecting(false);
    inlineTapRef.current = null;
    inputTouchRef.current = null; suppressCellPressRef.current = null;
    Keyboard.dismiss(); setNow(current);
    revealInlineMinute(minuteIndexForDate(current), day);
  }

  function formatSelection(patch: Partial<CellFormat>) {
    const range = parsedRange();
    if (range) void runSpreadsheetTool(() => applyCellFormat(range, patch));
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 44} onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.timeMeasurement}>
        <Text key={measurementKey} style={[styles.minuteTime, styles.timeMeasurementText]} maxFontSizeMultiplier={1.4}
          onTextLayout={(event) => recordTimeLabelWidth(Math.max(0, ...event.nativeEvent.lines.map((line) => line.width)), measurementKey)}>
          {clockFormat === '12h' ? '12:59 AM\n12:59 PM' : '23:59'}
        </Text>
      </View>
      <View ref={gridViewportRef} style={styles.gridViewport} onLayout={measureMinuteViewport}
        onTouchEnd={endCellHold} onTouchCancel={cancelCellInteraction} {...pinchResponder.panHandlers}>
      <Animated.ScrollView ref={horizontalRef} horizontal directionalLockEnabled nestedScrollEnabled scrollEnabled={!pinching && !rangeDragging && !groupDragging}
        style={styles.horizontalViewport} contentContainerStyle={[styles.horizontalContent, { width: gridLayout.contentWidth }]}
        keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={days.length > 1}
        onScroll={onHorizontalScroll} scrollEventThrottle={16}>
        <View style={[styles.gridContent, { width: gridLayout.contentWidth }]}>
          <View style={styles.dateHeader}>
            <Animated.View style={[styles.headerRail, { transform: [{ translateX: horizontalOffset }] }]} />
            {days.map((day) => (
              <Pressable key={day} accessibilityRole="button" accessibilityLabel={dayLabels.get(day) +
                  (day === today ? ', go to the current minute' : '')}
                onPress={() => {
                  if (day === dateKey(new Date())) goToCurrentMinute();
                  else { onDateChange(day); onDayCountChange?.(1); }
                }}
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

      {spreadsheetState.clipboard ? <View style={styles.selectionPrompt}>
        <Text style={styles.selectionPromptText}>{spreadsheetState.clipboard.mode === 'cut' ? 'Cut' : 'Copied'} · {spreadsheetState.clipboard.count} {spreadsheetState.clipboard.count === 1 ? 'minute' : 'minutes'} · Tap a destination to paste</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel cell clipboard" disabled={toolBusy || spreadsheetState.busy}
          onPress={() => { clearSpreadsheetClipboard(); setToolbarError(null); }} style={styles.rangeAction}>
          <Text style={styles.rangeActionText}>Cancel</Text>
        </Pressable>
      </View> : null}

      {rangeSelecting && !rangePanelOpen && !cellMenuOpen && !rangeDragging && inlineSelection ? <View style={styles.selectionPrompt}>
        <Text style={styles.selectionPromptText}>Tap the last minute in this date column.</Text>
        <Pressable accessibilityRole="button" onPress={() => void openCurrentRangeOptions()} style={styles.rangeAction}>
          <Text style={styles.rangeActionText}>Options</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel minute selection" onPress={closeRangeOptions}
          style={styles.rangeAction}><Text style={styles.rangeActionText}>×</Text></Pressable>
      </View> : null}

      {colorPanelOpen && inlineSelection ? (
        <MinuteOptionsPopup visible onClose={() => setColorPanelOpen(false)}>
        <View style={styles.colorPanel}>
          <View style={styles.colorPanelHeading}>
            <Text numberOfLines={1} style={styles.colorPanelTime}>
              {formatDayHeading(inlineSelection.dateKey)} · {timeLabel(inlineSelection.minuteIndex)}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void showMinuteDetails(inlineSelection.dateKey, inlineSelection.minuteIndex)}
              style={styles.colorPanelAction}><Text style={styles.colorPanelActionText}>Details</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => void startRangeFromActive()}
              style={styles.colorPanelAction}><Text style={styles.colorPanelActionText}>Select minutes</Text></Pressable>
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
                  recordExplicitColor(current.dateKey, current.minuteIndex);
                  markLocalChange([current.dateKey]);
                  editInlineMinute(current.dateKey, current.minuteIndex,
                    { categoryId: item.id, keepColor: !current.text.trim() });
                }} style={[styles.colorChoice, selectedDraft?.categoryId === item.id && styles.selectedColorChoice]}>
                <View style={[styles.colorCircle, { backgroundColor: item.color }]} />
                <Text maxFontSizeMultiplier={1.4} style={styles.colorHex}>{item.color.toUpperCase()}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {selectedColor ? <Text style={styles.colorName}>{selectedColor.name} · {selectedColor.color.toUpperCase()}</Text> : null}
          {toolbarError ? <Text accessibilityRole="alert" style={styles.popupError}>{toolbarError}</Text> : null}
        </View>
        </MinuteOptionsPopup>
      ) : null}

      {rangePanelOpen && inlineSelection ? (
        <MinuteOptionsPopup visible onClose={closeRangeOptions}>
        <View style={styles.rangePanel}>
          <View style={styles.rangeHeading}>
            <Text style={[styles.rangeCaption, styles.rangeHeadingCaption]}>{formatDayHeading(inlineSelection.dateKey)}</Text>
            <InfoButton title="Group" message="Group makes the selected minutes one activity while keeping every minute’s note. Both endpoint minutes are included. Connected calendars receive the activity as an event with timestamped notes when calendar writing is allowed. Undo restores ledger entries; calendar changes still follow the provider’s permissions and review rules." />
            <Pressable accessibilityRole="button" accessibilityLabel="Close minute range"
              onPress={closeRangeOptions} style={styles.colorPanelAction}>
              <Text style={styles.colorPanelActionText}>×</Text>
            </Pressable>
          </View>
          <View style={styles.rangeControls}>
            <Text style={styles.rangeCaption}>From</Text>
            <TextInput value={rangeStartInput} accessibilityLabel="First minute of selected range"
              placeholder={clockFormat === '12h' ? '10:15 AM' : '10:15'} placeholderTextColor={colors.muted} autoCapitalize="characters"
              returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()}
              onChangeText={(value) => {
                setRangeStartInput(value); const parsed = parseCalendarMinute(value);
                if (parsed != null) { setRangeStart(parsed); setToolbarError(null); }
              }} style={styles.rangeInput} />
            <Text style={styles.rangeCaption}>Through</Text>
            <TextInput value={rangeEndInput} accessibilityLabel="Last minute of selected range"
              placeholder={clockFormat === '12h' ? '10:20 AM' : '10:20'} placeholderTextColor={colors.muted} autoCapitalize="characters"
              returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()}
              onChangeText={(value) => {
                setRangeEndInput(value); const parsed = parseCalendarMinute(value);
                if (parsed != null) { setRangeEnd(parsed); setToolbarError(null); }
              }} style={styles.rangeInput} />
          </View>
          <View style={styles.rangeControls}>
            <TextInput value={rangeTitle} maxLength={200} accessibilityLabel="Activity title"
              placeholder="Activity title" placeholderTextColor={colors.muted} onChangeText={setRangeTitle}
              returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} style={[styles.rangeInput, styles.activityTitleInput]} />
            <Pressable accessibilityRole="button" disabled={toolBusy || spreadsheetState.busy || !groupHasGoogleColor}
              accessibilityLabel="Group selected minutes as one activity without changing their notes"
              onPress={() => void groupSelection()} style={[styles.groupAction, !groupHasGoogleColor && styles.groupActionDisabled]}>
              <Text style={styles.groupActionText}>Group</Text>
            </Pressable>
          </View>
          <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator
            contentContainerStyle={styles.colorChoices}>
            {groupPickerColors.map((item) => (
              <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={'Activity color, ' + item.name + ', ' + item.color}
                accessibilityState={{ checked: rangeColorId === item.id }} onPress={() => { setRangeColorId(item.id); setRangeColorChosen(true); }}
                style={[styles.colorChoice, rangeColorId === item.id && styles.selectedColorChoice]}>
                <View style={[styles.colorCircle, { backgroundColor: item.color }]} />
                <Text maxFontSizeMultiplier={1.4} style={styles.colorHex}>{item.color.toUpperCase()}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.rangeFooter}>
            <Text numberOfLines={1} style={styles.rangeColorName}>{groupHasGoogleColor
              ? groupColor.name + ' · ' + groupColor.color.toUpperCase() : 'Choose a color'}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => { setRangePanelOpen(false); Keyboard.dismiss(); }} style={styles.changeSelection}>
            <Text style={styles.rangeActionText}>Change selected minutes</Text>
          </Pressable>
          {toolbarError ? <Text accessibilityRole="alert" style={styles.popupError}>{toolbarError}</Text> : null}
        </View>
        </MinuteOptionsPopup>
      ) : null}

      {notice ? (
        <Pressable onPress={inlineError || inlineLinkWarning ? () => void flushInlineMinutes() : toolbarError
          ? () => setToolbarError(null) : calendarReadError ? onOpenSettings : () => void refresh()} style={styles.notice}>
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
            return <View key={day}
              style={[styles.allDayCell, { width: gridLayout.dayWidth }]}>
              {plans.map((plan) => <Pressable key={`${plan.calendarId}:${plan.id}`} accessibilityRole="button"
                accessibilityLabel={plan.title + ', all day'} onPress={() => void openPlan(plan)}
                style={[styles.allDayEvent, { backgroundColor: calendarColor(plan.color) ?? colors.panel }]}>
                <Text numberOfLines={2} style={[styles.allDayText, { color: activityTextColor(plan.color, colors.ink) }]}>{plan.title}</Text>
              </Pressable>)}
            </View>;
          })}
        </View>
      ) : null}

      <View ref={minuteViewportRef} style={styles.minuteViewport} onLayout={measureMinuteViewport}>
      <FlatList ref={listRef} data={MINUTE_ITEMS} keyExtractor={(minute) => minute.toString()}
        style={styles.minuteList} contentContainerStyle={styles.minuteListContent}
        getItemLayout={(_, index) => ({ length: gridLayout.rowHeight, offset: gridLayout.rowHeight * index, index })}
        initialNumToRender={24} maxToRenderPerBatch={24} windowSize={9} keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag" removeClippedSubviews={false}
        scrollEnabled={!pinching && !rangeDragging && !groupDragging} scrollEventThrottle={16}
        onScroll={(event) => { verticalOffsetRef.current = event.nativeEvent.contentOffset.y; positionFillHandle(); }}
        onContentSizeChange={() => { if (pendingZoomAnchorRef.current) restoreZoomAnchor(); }}
        onLayout={() => {
          measureMinuteViewport();
          if (pinchRef.current || pendingZoomAnchorRef.current || rangeDragRef.current || groupDragRef.current || cellHoldRef.current) return;
          const selected = inlineSelectionRef.current;
          if (selected) revealInlineMinute(selected.minuteIndex);
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ink}
          colors={[colors.currentTime]} progressBackgroundColor={colors.surface} />}
        onScrollToIndexFailed={({ index }) => listRef.current?.scrollToOffset({ offset: index * gridLayout.rowHeight, animated: false })}
        renderItem={({ item: minute }) => (
          <View style={styles.minuteRow}>
            <Animated.View style={[styles.timeRailWrapper, { transform: [{ translateX: horizontalOffset }] }]}>
            <View style={styles.timeRail}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} maxFontSizeMultiplier={1.4} style={[styles.minuteTime,
                minute === currentMinute && days.includes(today) && styles.currentMinuteText]}>{timeLabel(minute)}</Text>
            </View>
            </Animated.View>
            {days.map((day) => {
              const index = indexedDays.get(day);
              const entry = index?.entriesByMinute.get(minute);
              const draft = draftsByKey.get(inlineMinuteKey(day, minute));
              const plans = index?.plansByMinute.get(minute) ?? [];
              const plan = plans[0];
              const hasDraftValue = draft && (draft.revision > 0 || Boolean(entry));
              const sourceColorPending = sourceColorJobs.current.has(inlineMinuteKey(day, minute)) &&
                sourceColorJobEpochs.current.get(inlineMinuteKey(day, minute)) === (explicitColorEpochs.current.get(inlineMinuteKey(day, minute)) ?? 0);
              const color = sourceColorPending && plan ? plan.color : hasDraftValue ? categoryById(draft.categoryId).color :
                entry ? categoryById(entry.categoryId).color : undefined;
              const inline = inlineSelection?.dateKey === day && inlineSelection.minuteIndex === minute;
              const rangeSelected = rangeSelecting && selectedRange?.dateKey === day &&
                minute >= selectedRange.startMinute && minute <= selectedRange.endMinute;
              const group = indexedGroups.get(day)?.get(minute);
              const groupStarts = group?.startMinute === minute;
              const groupColor = group ? categoryById(group.categoryId).color : undefined;
              const previewColor = rangeSelected && rangeColorChosen && groupHasGoogleColor ? categoryById(rangeColorId).color : undefined;
              const solidColor = calendarCellColor({ previewColor, actualColor: color,
                hasActual: Boolean(hasDraftValue || entry), groupColor, planColor: plan?.color });
              const defaultTextColor = activityTextColor(solidColor, colors.ink);
              const titleTextColor = activityTextColor(solidColor ?? groupColor, colors.ink);
              const cellVisibleWidth = Math.max(1, Math.min(gridLayout.dayWidth, gridLayout.viewportWidth - gridLayout.railWidth));
              const badgeWidth = groupStarts ? Math.min(cellVisibleWidth * 0.45, Math.max(28, cellVisibleWidth * 0.4)) : 0;
              const noteWidth = Math.max(1, cellVisibleWidth - badgeWidth - (groupStarts ? 18 : 12));
              const format = dayData[day]?.formats?.get(minute) ?? {};
              const textStyle = { fontWeight: format.bold ? '700' as const : '400' as const,
                fontStyle: format.italic ? 'italic' as const : 'normal' as const,
                textDecorationLine: format.underline ? 'underline' as const : 'none' as const,
                color: format.textColor ?? defaultTextColor };
              const displayedText = draft?.text ?? entry?.text ?? plan?.title;
              const isCurrent = day === today && minute === currentMinute;
              return (
                <Pressable key={day} accessibilityRole={inline && !rangeSelecting ? undefined : 'button'}
                  accessibilityLabel={inline && !rangeSelecting ? undefined : dayLabels.get(day) + ', ' + timeLabel(minute) +
                    (group ? ', ' + group.title : '') + (displayedText ? ', ' + displayedText : ', tap to record')}
                  accessibilityHint={inline && !rangeSelecting ? undefined : rangeSelecting
                    ? 'Hold selected cells for actions. Drag the selection handle to change the range.'
                    : group ? 'Type in this cell. Hold for actions, or hold longer and drag to move this activity.' : 'Type in this cell. Hold for cell actions.'}
                  onPressIn={() => { suppressCellPressRef.current = null; }}
                  onTouchStart={(event) => beginCellHold(day, minute, Boolean(group), event)}
                  onTouchMove={moveCellHold} onTouchEnd={endCellHold} onTouchCancel={cancelCellInteraction}
                  onPress={() => {
                    const suppressed = suppressCellPressRef.current;
                    suppressCellPressRef.current = null;
                    if (suppressed?.key === inlineMinuteKey(day, minute) && Date.now() < suppressed.until) return;
                    if (rangeSelecting && !cellMenuOpen) { void selectRangeEndpoint(day, minute); return; }
                    if (cellMenuOpen) {
                      if (selectedRange?.dateKey === day && minute >= selectedRange.startMinute && minute <= selectedRange.endMinute) return;
                      void openInlineMinute(day, minute); return;
                    }
                    if (!inline) void openInlineMinute(day, minute);
                    else if (inputTouchRef.current?.key !== inlineMinuteKey(day, minute) || Date.now() >= inputTouchRef.current.until) {
                      void openCellOptions(day, minute);
                    }
                  }}
                  accessibilityActions={inline ? undefined : [{ name: 'selectMinutes', label: 'Select multiple minutes' }]}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === 'selectMinutes') void openInlineMinute(day, minute, false, undefined, true);
                  }}
                  style={[styles.dayCell, { width: gridLayout.dayWidth }, rangeSelected && styles.rangeCell,
                    rangeSelected && minute === selectedRange?.startMinute && styles.rangeFirstCell,
                    rangeSelected && minute === selectedRange?.endMinute && styles.rangeLastCell,
                    inline && styles.editingCell]}>
                  <View pointerEvents="none" style={[styles.cellBackground,
                    solidColor ? { backgroundColor: solidColor } : null]} />
                  {group ? <View pointerEvents="none" style={[styles.activityOutline,
                    { borderColor: titleTextColor + '80' }, minute === group.startMinute && styles.activityFirstCell,
                    minute === group.endMinute && styles.activityLastCell]} /> : null}
                  {spreadsheetState.clipboard?.mode === 'cut' && spreadsheetState.clipboard.range.dateKey === day &&
                    minute >= spreadsheetState.clipboard.range.startMinute && minute <= spreadsheetState.clipboard.range.endMinute
                    ? <View pointerEvents="none" style={styles.cutCellOutline} /> : null}
                  {inline && draft && !rangeSelecting ? <TextInput ref={inlineInputRef} value={draft.text}
                    editable={!spreadsheetState.busy && !toolBusy} contextMenuHidden rejectResponderTermination={false}
                    multiline scrollEnabled returnKeyType="done" submitBehavior="blurAndSubmit"
                    accessibilityLabel={dayLabels.get(day) + ', ' + timeLabel(minute) + (group ? ', ' + group.title : '') + ', minute text'}
                    placeholder="Tap to record" placeholderTextColor={solidColor ? defaultTextColor : colors.muted} selectionColor={colors.currentTime}
                    accessibilityHint="Type here. Hold for cell actions, or tap again for minute details."
                    accessibilityActions={[{ name: 'showMenu', label: 'Minute colors and details' }]}
                    onAccessibilityAction={(event) => {
                      if (event.nativeEvent.actionName === 'showMenu') void openCellOptions(day, minute);
                    }}
                    onTouchStart={(event) => {
                      const { pageX: x, pageY: y, touches } = event.nativeEvent;
                      inputTouchRef.current = { key: inlineMinuteKey(day, minute), until: Number.POSITIVE_INFINITY };
                      inlineTapRef.current = beginInlineCellTap(inlineMinuteKey(day, minute), { x, y }, Date.now(), touches.length);
                    }}
                    onTouchMove={(event) => {
                      const { pageX: x, pageY: y, touches } = event.nativeEvent;
                      inlineTapRef.current = trackInlineCellTap(inlineTapRef.current, { x, y }, touches.length);
                    }}
                    onTouchCancel={() => {
                      inlineTapRef.current = null;
                      inputTouchRef.current = { key: inlineMinuteKey(day, minute), until: Date.now() + 400 };
                    }}
                    onTouchEnd={(event) => {
                      const tap = inlineTapRef.current;
                      inlineTapRef.current = null;
                      inputTouchRef.current = { key: inlineMinuteKey(day, minute), until: Date.now() + 400 };
                      const { pageX: x, pageY: y } = event.nativeEvent;
                      const selection = inlineTextSelectionRef.current;
                      if (!isInlineCellTap(tap, inlineMinuteKey(day, minute), { x, y }, Date.now(), selection.start !== selection.end)) return;
                      const token = selectionTokenRef.current;
                      requestAnimationFrame(() => {
                        const current = inlineSelectionRef.current;
                        const selectedText = inlineTextSelectionRef.current;
                        if (mountedRef.current && token === selectionTokenRef.current && current?.dateKey === day &&
                            current.minuteIndex === minute && selectedText.start === selectedText.end) void openCellOptions(day, minute);
                      });
                    }}
                    onSelectionChange={(event) => { inlineTextSelectionRef.current = event.nativeEvent.selection; }}
                    onChangeText={(text) => {
                      markLocalChange([day]);
                      const current = inlineMinuteDrafts.get(day, minute);
                      editInlineMinute(day, minute, { text, keepColor: text.trim() ? false : current?.keepColor ?? false });
                      if (current) inheritNewMinuteColor(day, minute, plan, current.categoryId, current.revision, Boolean(entry));
                    }}
                    onBlur={() => { void inlineMinuteDrafts.flush(inlineMinuteKey(day, minute)); }}
                    onFocus={() => revealInlineMinute(minute)}
                    onSubmitEditing={() => {
                      inlineMinuteDrafts.close(inlineMinuteKey(day, minute));
                      setInlineSelection(null); setCellMenuOpen(false); setColorPanelOpen(false); setRangePanelOpen(false); setRangeSelecting(false); Keyboard.dismiss();
                    }} style={[styles.cellText, styles.inlineInput, {
                      width: noteWidth,
                    }, textStyle]} />
                    : <Text numberOfLines={1} maxFontSizeMultiplier={1.4}
                      style={[styles.cellText, !entry && !draft && styles.planText,
                        !displayedText && styles.placeholder, groupStarts && { maxWidth: noteWidth }, textStyle]}>
                      {displayedText ?? ''}
                    </Text>}
                  {group && groupStarts ? <View pointerEvents="none"
                    style={[styles.activityBadge, { left: noteWidth + 9, width: badgeWidth, borderColor: titleTextColor + '80' }]}>
                    <Text numberOfLines={1} style={[styles.activityTitle, { color: titleTextColor }]}>{group.title}</Text>
                  </View> : null}
                  {isCurrent ? <View pointerEvents="none" style={styles.currentLine}>
                    <View style={styles.currentDot} />
                  </View> : null}
                </Pressable>
              );
            })}
          </View>
        )}
      />
      {groupDragging && groupDragPreview ? (() => {
        const target = groupDragPreview.target;
        const top = Math.max(0, target.startMinute * gridLayout.rowHeight - verticalOffsetRef.current);
        const bottom = Math.min(bodyWindowRef.current.height, (target.endMinute + 1) * gridLayout.rowHeight - verticalOffsetRef.current);
        const left = Math.max(gridLayout.railWidth + target.column * gridLayout.dayWidth, horizontalOffsetRef.current + gridLayout.railWidth);
        const right = Math.min(gridLayout.railWidth + (target.column + 1) * gridLayout.dayWidth,
          horizontalOffsetRef.current + gridLayout.viewportWidth);
        return bottom > top && right > left ? <View pointerEvents="none" style={[styles.groupMovePreview, {
          left, top, height: bottom - top, width: right - left,
        }]}>
          <Text numberOfLines={2} style={styles.groupMoveTitle}>{groupDragPreview.source.title}</Text>
          <Text numberOfLines={1} style={styles.groupMoveTime}>{timeLabel(target.startMinute)} – {timeLabel(target.endMinute)}</Text>
        </View> : null;
      })() : null}
      {inlineSelection && !groupDragging && !colorPanelOpen && !rangePanelOpen && !editor ? (
        <Animated.View {...rangeDragResponder.panHandlers} accessible accessibilityRole="button"
          pointerEvents={fillHandleVisible ? 'auto' : 'none'}
          accessibilityElementsHidden={!fillHandleVisible} importantForAccessibility={fillHandleVisible ? 'yes' : 'no-hide-descendants'}
          accessibilityLabel="Drag to select minutes for Auto fill"
          accessibilityHint="Drag this handle up or down in the same date column, then release for Auto fill or Group. Double tap to choose an endpoint instead."
          onAccessibilityTap={() => void startRangeFromActive()}
          style={[styles.fillHandle, {
            opacity: fillHandleOpacity, transform: [{ translateX: fillHandleLeft }, { translateY: fillHandleTop }],
          }]}>
          <View pointerEvents="none" style={styles.fillHandleDot} />
        </Animated.View>
      ) : null}
      {rangeDragging && selectedRange ? <Animated.View pointerEvents="none" style={[styles.dragPrompt, {
        left: gridLayout.railWidth + 5, maxWidth: gridLayout.viewportWidth - gridLayout.railWidth - 10,
        transform: [{ translateX: horizontalOffset }],
      }]}>
        <Text style={styles.dragPromptText}>{selectedRange.endMinute - selectedRange.startMinute + 1} minutes</Text>
      </Animated.View> : null}
      {cellMenuOpen && inlineSelection && !groupDragging && !rangeDragging && !rangePanelOpen && !colorPanelOpen ? (
        <Animated.View style={[styles.cellMenuPosition, {
          width: Math.min(440, gridLayout.viewportWidth - 16),
          left: Math.max(8, (gridLayout.viewportWidth - Math.min(440, gridLayout.viewportWidth - 16)) / 2),
          transform: [{ translateX: horizontalOffset }, { translateY: cellMenuTop }],
        }]}>
          <CellActionMenu busy={toolBusy || spreadsheetState.busy}
            onCut={() => void captureSelectedCells('cut')} onCopy={() => void captureSelectedCells('copy')}
            onAutoFill={cellPolicy.canAutoFill ? () => void autoFillSelection() : undefined}
            onClear={cellPolicy.canClear ? () => void clearSelection() : undefined}
            onGroup={cellPolicy.canGroup ? () => void openCurrentRangeOptions() : undefined}
            onUngroup={cellPolicy.canUngroup ? () => void ungroupSelection() : undefined}
            onPaste={() => void pasteSelectedCells()} canPaste={Boolean(spreadsheetState.clipboard)}
            format={selectedFormat} textColor={menuTextColor} fillColor={menuFillColor}
            selectedColorId={selectedDraft?.categoryId ?? inlineSelection.entry?.categoryId} colorChoices={pickerColors}
            onToggleBold={cellPolicy.canFormat ? () => formatSelection({ bold: !selectedFormat.bold }) : undefined}
            onToggleItalic={cellPolicy.canFormat ? () => formatSelection({ italic: !selectedFormat.italic }) : undefined}
            onToggleUnderline={cellPolicy.canFormat ? () => formatSelection({ underline: !selectedFormat.underline }) : undefined}
            onTextColor={cellPolicy.canFormat ? (color) => formatSelection({ textColor: color ?? undefined }) : undefined}
            onCellColor={cellPolicy.canFormat ? (id) => void colorSelection(id) : undefined}
            maxHeight={Math.max(80, bodyWindowRef.current.height - 12)} error={toolbarError}
            onHeightChange={(height) => { cellMenuHeightRef.current = height; positionFillHandle(); }}
            onClose={closeRangeOptions} />
        </Animated.View>
      ) : null}
      </View>

        </View>
      </Animated.ScrollView>
      </View>

      {onCreatePlan && !inlineSelection && !rangeSelecting && !editor ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Create calendar event"
          accessibilityHint="Opens your phone calendar's event form."
          onPress={() => { Keyboard.dismiss(); onCreatePlan(); }} style={styles.createEventButton}>
          <Text style={styles.createEventIcon}>+</Text>
        </Pressable>
      ) : null}


      <MinuteEditor visible={editor != null} dateKey={editor?.dateKey ?? activeDate}
        clockFormat={clockFormat}
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
    createEventButton: { position: 'absolute', right: 16, bottom: 16, width: 56, height: 56, borderRadius: 16,
      justifyContent: 'center', alignItems: 'center', backgroundColor: colors.accent },
    createEventIcon: { color: colors.onAccent, fontSize: 34, fontWeight: '400', lineHeight: 40 },
    gridViewport: { flex: 1 },
    horizontalViewport: { flex: 1, backgroundColor: grid },
    horizontalContent: { height: '100%' },
    gridContent: { height: '100%', backgroundColor: grid },
    headerRail: { width: railWidth, height: 66, zIndex: 20, backgroundColor: colors.paper },
    floatingControls: { zIndex: 21, backgroundColor: colors.paper },
    dateHeader: { flexDirection: 'row', alignItems: 'center', height: 66,
      borderBottomWidth: 1, borderBottomColor: gridLine, backgroundColor: colors.paper },
    dateColumn: { height: 66, alignItems: 'center', justifyContent: 'center' },
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
    allDayCell: { minHeight: 34, borderRightWidth: 1, borderRightColor: gridLine },
    allDayEvent: { minHeight: 44, paddingHorizontal: 5, paddingVertical: 5, justifyContent: 'center' },
    allDayText: { color: colors.graphite, fontSize: 10 },
    minuteList: { flex: 1, minHeight: 0 },
    minuteViewport: { flex: 1, minHeight: 0 },
    cellMenuPosition: { position: 'absolute', top: 0, zIndex: 45 },
    groupMovePreview: { position: 'absolute', zIndex: 40, borderWidth: 2, borderColor: colors.currentTime,
      backgroundColor: colors.selectedDay, opacity: 0.92, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden' },
    groupMoveTitle: { color: colors.onSelectedDay, fontSize: 12, fontWeight: '600' },
    groupMoveTime: { color: colors.onSelectedDay, fontSize: 10, paddingTop: 2 },
    cutCellOutline: { position: 'absolute', left: 1, right: 1, top: 1, bottom: 1,
      borderWidth: 1.5, borderStyle: 'dashed', borderColor: focusedCell },
    fillHandle: { position: 'absolute', top: 0, left: 0, width: 24, height: 24, zIndex: 35,
      alignItems: 'center', justifyContent: 'center' },
    fillHandleDot: { width: 13, height: 13, borderRadius: 7, borderWidth: 2,
      borderColor: grid, backgroundColor: focusedCell },
    dragPrompt: { position: 'absolute', top: 5, zIndex: 34, paddingHorizontal: 8, paddingVertical: 5,
      borderRadius: 5, backgroundColor: colors.panel },
    dragPromptText: { color: colors.ink, fontSize: 11 },
    minuteListContent: { paddingBottom: 0 },
    minuteRow: { height: rowHeight, flexDirection: 'row' },
    timeRailWrapper: { width: railWidth, height: rowHeight, zIndex: 15, backgroundColor: grid },
    timeRail: { width: railWidth, height: rowHeight, justifyContent: 'center', alignItems: 'flex-end', paddingLeft: 0, paddingRight: 1,
      borderRightWidth: 1, borderBottomWidth: 1, borderColor: gridLine },
    timeMeasurement: { position: 'absolute', left: 0, top: 0, width: 4096, opacity: 0 },
    timeMeasurementText: { alignSelf: 'flex-start', fontWeight: '600' },
    minuteTime: { color: colors.ink, fontSize: Math.round(16 * layout.zoom), fontWeight: '400', fontVariant: ['tabular-nums'], includeFontPadding: false },
    currentMinuteText: { color: colors.ink, fontWeight: '600' },
    colorPanel: { paddingHorizontal: 12, paddingBottom: 7, borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.hairline, backgroundColor: colors.panel },
    selectionPrompt: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 4,
      borderBottomWidth: 1, borderBottomColor: colors.hairline, backgroundColor: colors.panel },
    selectionPromptText: { flex: 1, color: colors.graphite, fontSize: 12 },
    colorPanelHeading: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
    colorPanelTime: { flex: 1, color: colors.graphite, fontSize: 11 },
    colorPanelAction: { minHeight: 40, minWidth: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
    colorPanelActionText: { color: colors.graphite, fontSize: 12, fontWeight: '600' },
    colorChoices: { gap: 5, alignItems: 'center', paddingHorizontal: 2, paddingBottom: 3 },
    colorChoice: { width: 72, height: 60, borderRadius: 8, borderWidth: 2, borderColor: 'transparent',
      alignItems: 'center', justifyContent: 'center' },
    selectedColorChoice: { borderColor: colors.ink },
    colorCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.swatchBorder },
    colorHex: { color: colors.graphite, fontSize: 10, marginTop: 4 },
    colorName: { color: colors.muted, fontSize: 10, paddingLeft: 5, paddingTop: 2 },
    rangePanel: { paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1,
      borderBottomColor: gridLine, backgroundColor: colors.panel },
    rangeHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rangeHeadingCaption: { flex: 1 },
    rangeCaption: { color: colors.graphite, fontSize: 11 },
    rangeCaveat: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
    rangeControls: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
    rangeInput: { flex: 1, minWidth: 90, minHeight: 40, borderWidth: 1, borderColor: colors.hairline,
      paddingHorizontal: 7, paddingVertical: 4, color: colors.ink, fontSize: 13, backgroundColor: colors.surface },
    activityTitleInput: { minWidth: 120 },
    groupAction: { minHeight: 40, minWidth: 62, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center',
      backgroundColor: colors.accent },
    groupActionText: { color: colors.onAccent, fontSize: 12, fontWeight: '600' },
    groupActionDisabled: { opacity: 0.45 },
    rangeFooter: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    rangeColorName: { flex: 1, color: colors.muted, fontSize: 11 },
    rangeAction: { minHeight: 40, minWidth: 42, paddingHorizontal: 7, justifyContent: 'center', alignItems: 'center' },
    rangeActionText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
    changeSelection: { minHeight: 40, justifyContent: 'center', alignItems: 'flex-start' },
    popupError: { color: colors.danger, fontSize: 12, lineHeight: 17, paddingVertical: 5 },
    dayCell: { height: rowHeight, justifyContent: 'center', paddingLeft: 5, paddingRight: 4,
      borderRightWidth: 1, borderBottomWidth: 1, borderColor: gridLine },
    cellBackground: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: grid },
    activityOutline: { position: 'absolute', left: 1, right: 1, top: 0, bottom: 0,
      borderLeftWidth: 1.5, borderRightWidth: 1.5 },
    activityFirstCell: { borderTopWidth: 1.5 },
    activityLastCell: { borderBottomWidth: 1.5 },
    activityBadge: { position: 'absolute', top: 2, bottom: 2, justifyContent: 'center', paddingLeft: 4,
      borderLeftWidth: 1, backgroundColor: 'transparent' },
    activityTitle: { color: colors.ink, fontSize: Math.max(8, Math.round(11 * layout.zoom)), fontWeight: '600' },
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
