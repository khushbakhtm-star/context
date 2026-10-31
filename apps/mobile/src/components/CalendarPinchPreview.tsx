import { memo, useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { AppColors } from '../theme';
import type { CompactBand } from '../utils/calendar-compact';
import { calendarPinchOffsetRange, type CalendarZoomAnchor } from '../utils/calendar-layout';
import { CalendarCellText } from './CalendarCellText';
import { calendarCellTextLayout, calendarReadableMinuteWindow, type CalendarCellAnnotation } from '../utils/calendar-cell-text';
import { calendarTimeRailLabel, calendarTimeRailLabelTop, calendarTimeRailLayout } from '../utils/calendar-time-labels';

type Props = { active: boolean; days: readonly string[]; bands: ReadonlyMap<string, readonly CompactBand[]>;
  outlines: ReadonlyMap<string, readonly CompactBand[]>; annotations: ReadonlyMap<string, readonly CalendarCellAnnotation[]>;
  rowHeight: number; railWidth: number; dayWidth: number;
  colors: AppColors; scaleY: Animated.Value; anchor?: CalendarZoomAnchor; viewportHeight: number; fontScale?: number;
  timeLabel: (minute: number) => string; clockFormat?: '12h' | '24h'; current: { day: string; minute: number };
  selection?: { day: string; first: number; last: number }; backgroundColor: string; gridLineColor: string };

/** Only this bounded label layer relayouts while pinching. Actual font sizes at
 * the unchanged column width give native wrapping the correct line capacity;
 * scaling a paragraph already wrapped at another font size cannot do that. */
export const CalendarPinchLabels = memo(function CalendarPinchLabels({ active, days, annotations, rowHeight, railWidth,
  dayWidth, colors, scaleY, anchor, viewportHeight, fontScale = 1, clockFormat = '12h',
}: Pick<Props, 'active' | 'days' | 'annotations' | 'rowHeight' | 'railWidth' | 'dayWidth' | 'colors' | 'scaleY' |
  'anchor' | 'viewportHeight' | 'fontScale' | 'clockFormat'>) {
  const [observedScale, setObservedScale] = useState({ source: scaleY, value: 1 });
  const inverseScaleY = useMemo(() => Animated.divide(1, scaleY), [scaleY]);
  useEffect(() => {
    // Subscribe while the canvas is warm so the first gesture frame cannot be
    // lost before an active-only effect attaches. A new base never reuses an old
    // gesture's ratio while inactive; grant always publishes its fresh ratio1.
    const id = scaleY.addListener(({ value }) => {
      if (Number.isFinite(value) && value > 0) setObservedScale(previous =>
        previous.source === scaleY && previous.value === value ? previous : { source: scaleY, value });
    });
    return () => scaleY.removeListener(id);
  }, [scaleY]);
  const currentRowHeight = rowHeight * (active && observedScale.source === scaleY ? observedScale.value : 1);
  const focal = anchor ?? { minute: 0, viewportY: 0 };
  const offset = Math.max(0, Math.min(1440 * currentRowHeight - viewportHeight,
    focal.minute * currentRowHeight - focal.viewportY));
  const first = Math.max(0, Math.floor(offset / currentRowHeight) - 2);
  const last = Math.min(1439, Math.ceil((offset + viewportHeight) / currentRowHeight) + 1);
  const rail = calendarTimeRailLayout(currentRowHeight, fontScale);
  const timeMinutes = rail.hourOnly ? Array.from({ length: 25 }, (_, hour) => hour * 60)
    : Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const wrapper = { transformOrigin: 'top left' as const, transform: [{ scaleY: inverseScaleY }] };
  return <>
    {timeMinutes.map((minute) => {
      const label = calendarTimeRailLabel(minute, currentRowHeight, clockFormat, fontScale);
      return label ? <Animated.View testID="pinch-time-label" key={`time:${minute}`} style={[{
        position: 'absolute', left: 0, width: Math.max(1, railWidth - 2),
        top: calendarTimeRailLabelTop(minute, currentRowHeight, fontScale) / (currentRowHeight / rowHeight),
        height: rail.lineHeight, alignItems: 'flex-end',
      }, wrapper]}>
        <Text numberOfLines={1} ellipsizeMode="clip" allowFontScaling={false} style={{
          fontSize: rail.fontSize, lineHeight: rail.lineHeight, fontVariant: ['tabular-nums'], includeFontPadding: false,
          color: colors.ink }}>{label}</Text>
      </Animated.View> : null;
    })}
    {calendarCellTextLayout(currentRowHeight, fontScale).opacity > 0 ? days.map((day, dayIndex) =>
      (annotations.get(day) ?? []).filter((cell) => cell.minute >= first && cell.minute <= last).map((cell) => {
        const showTitle = Boolean(cell.title && (!cell.text.trim() || dayWidth >= 112));
        const badgeWidth = showTitle ? Math.min(dayWidth * 0.45, Math.max(28, dayWidth * 0.4)) : 0;
        const noteWidth = Math.max(1, dayWidth - badgeWidth - (showTitle ? 18 : 12));
        return <Animated.View testID="pinch-note-row" key={`${day}:${cell.minute}`} style={[{
          position: 'absolute', left: railWidth + dayIndex * dayWidth, top: cell.minute * rowHeight,
          width: dayWidth, height: currentRowHeight,
        }, wrapper]}>
          {cell.text ? <View style={{ position: 'absolute', left: 5, top: 0 }}>
            <CalendarCellText text={cell.text} width={noteWidth} height={currentRowHeight} rowHeight={currentRowHeight}
              color={cell.color} bold={cell.bold} italic={cell.italic} underline={cell.underline} fontScale={fontScale} />
          </View> : null}
          {showTitle ? <View style={{ position: 'absolute', left: noteWidth + 9, top: 0, height: currentRowHeight,
            width: badgeWidth, borderLeftWidth: 1, borderColor: cell.titleColor + '80', paddingLeft: 4 }}>
            <CalendarCellText text={cell.title!} width={Math.max(1, badgeWidth - 5)} height={currentRowHeight} rowHeight={currentRowHeight}
              color={cell.titleColor} bold fontSize={11} lineHeight={14} inset={3} fontScale={fontScale} />
          </View> : null}
        </Animated.View>;
      })) : null}
  </>;
});

/** Background geometry remains on its prewarmed native graph. Pointer frames
 * never rebuild the committed 1,440-row grid; only visible labels reflow. */
export const CalendarPinchPreview = memo(function CalendarPinchPreview({ active, days, bands, outlines, annotations,
  rowHeight, railWidth, dayWidth, colors, scaleY, timeLabel, current, selection, backgroundColor, gridLineColor,
  anchor, viewportHeight, fontScale = 1, clockFormat = '12h',
}: Props) {
  const height = 1440 * rowHeight;
  const inverseScaleY = useMemo(() => Animated.divide(1, scaleY), [scaleY]);
  const focal = anchor ?? { minute: 0, viewportY: 0 };
  const windows = [calendarReadableMinuteWindow(focal, viewportHeight)];
  if (!active && rowHeight >= 9) for (const viewportY of [0, viewportHeight]) windows.push(calendarReadableMinuteWindow({
    minute: focal.minute + (viewportY - focal.viewportY) / rowHeight, viewportY,
  }, viewportHeight));
  const readable = { first: Math.min(...windows.map(value => value.first)), last: Math.max(...windows.map(value => value.last)) };
  const translateY = useMemo(() => scaleY.interpolate({
    ...calendarPinchOffsetRange(anchor ?? { minute: 0, day: 0, viewportX: 0, viewportY: 0 }, rowHeight, viewportHeight),
    extrapolate: 'clamp',
  }), [scaleY, anchor, rowHeight, viewportHeight]);
  const minuteRules = useMemo(() => scaleY.interpolate({ inputRange: [6 / rowHeight, 9 / rowHeight],
    outputRange: [0, 1], extrapolate: 'clamp' }), [scaleY, rowHeight]);
  const bottomInset = useMemo(() => Animated.multiply(-2.5, inverseScaleY), [inverseScaleY]);
  const currentInset = useMemo(() => Animated.multiply(-1.5, inverseScaleY), [inverseScaleY]);
  const selectionInset = useMemo(() => Animated.multiply(-2, inverseScaleY), [inverseScaleY]);
  const content = useMemo(() => <>
    <View style={{ width: railWidth, height, backgroundColor }} />
    {days.map((day) => <View key={day} style={{ width: dayWidth, height, backgroundColor,
      borderLeftWidth: StyleSheet.hairlineWidth, borderColor: gridLineColor }}>
      {(bands.get(day) ?? []).map((band, index) => {
        const bandHeight = (band.endMinute - band.startMinute) * rowHeight;
        return <View key={`${band.startMinute}:${index}`} style={{ position: 'absolute', left: 0, right: 0,
          top: band.startMinute * rowHeight, height: bandHeight, overflow: 'hidden', backgroundColor: band.color,
          opacity: band.mixed ? 0.8 : 1 }} />;
      })}
      {(outlines.get(day) ?? []).map((outline) => {
        const outlineHeight = (outline.endMinute - outline.startMinute) * rowHeight;
        return <View key={`${outline.startMinute}:${outline.groupId}`} style={{ position: 'absolute', left: 0, right: 0,
          top: outline.startMinute * rowHeight, height: outlineHeight, borderLeftWidth: 2.5, borderRightWidth: 2.5,
          borderColor: outline.color ?? colors.ink }}>
          <Animated.View testID="pinch-event-edge" style={{ position: 'absolute', top: 0, left: -2.5, right: -2.5, height: 2.5,
            backgroundColor: outline.color ?? colors.ink, transformOrigin: 'top left', transform: [{ scaleY: inverseScaleY }] }} />
          <Animated.View testID="pinch-event-edge" style={{ position: 'absolute', top: outlineHeight, left: -2.5, right: -2.5, height: 2.5,
            backgroundColor: outline.color ?? colors.ink, transformOrigin: 'top left',
            transform: [{ translateY: bottomInset }, { scaleY: inverseScaleY }] }} />
        </View>;
      })}
      {selection?.day === day ? <View style={{ position: 'absolute', left: 0, right: 0,
        top: selection.first * rowHeight, height: (selection.last - selection.first + 1) * rowHeight,
        borderLeftWidth: 2, borderRightWidth: 2, borderColor: colors.currentTime }}>
        <Animated.View testID="pinch-selection-edge" style={{ position: 'absolute', top: 0, left: -2, right: -2, height: 2,
          backgroundColor: colors.currentTime, transformOrigin: 'top left', transform: [{ scaleY: inverseScaleY }] }} />
        <Animated.View testID="pinch-selection-edge" style={{ position: 'absolute', top: (selection.last - selection.first + 1) * rowHeight, left: -2, right: -2, height: 2,
          backgroundColor: colors.currentTime, transformOrigin: 'top left', transform: [{ translateY: selectionInset }, { scaleY: inverseScaleY }] }} />
      </View> : null}
    </View>)}
    {Array.from({ length: 25 }, (_, hour) => <Animated.View testID="pinch-hour-rule" key={`hour-rule:${hour}`} style={{ position: 'absolute', left: 0, right: 0,
      top: hour * 60 * rowHeight, height: 1, backgroundColor: gridLineColor,
      transformOrigin: 'top left', transform: [{ scaleY: inverseScaleY }] }} />)}
    {Array.from({ length: readable.last - readable.first + 1 }, (_, index) => readable.first + index + 1).map((minute) =>
      <Animated.View testID="pinch-minute-rule" key={`minute-rule:${minute}`} style={{ position: 'absolute', left: 0, right: 0,
        top: minute * rowHeight, height: 1, backgroundColor: gridLineColor, opacity: minuteRules,
        transformOrigin: 'top left', transform: [{ scaleY: inverseScaleY }] }} />)}
    {days.includes(current.day) ? <Animated.View testID="pinch-current-rule" style={{ position: 'absolute', left: railWidth + days.indexOf(current.day) * dayWidth,
      width: dayWidth, top: (current.minute + 1) * rowHeight, height: 1.5, backgroundColor: colors.currentTime,
      transformOrigin: 'top left', transform: [{ translateY: currentInset }, { scaleY: inverseScaleY }] }} /> : null}
  </>, [days, bands, outlines, rowHeight, railWidth, dayWidth, colors, current, selection, backgroundColor,
    gridLineColor, minuteRules, bottomInset, currentInset, selectionInset, height, inverseScaleY, readable.first, readable.last]);
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[StyleSheet.absoluteFill, { backgroundColor, overflow: 'hidden', opacity: active ? 1 : 0 }]}>
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, height, width: railWidth + days.length * dayWidth,
      flexDirection: 'row', transformOrigin: 'top left', transform: [{ translateY }, { scaleY }] }}>
      {content}
      <CalendarPinchLabels active={active} days={days} annotations={annotations} rowHeight={rowHeight} railWidth={railWidth}
        dayWidth={dayWidth} colors={colors} scaleY={scaleY} anchor={anchor} viewportHeight={viewportHeight}
        fontScale={fontScale} clockFormat={clockFormat} />
    </Animated.View>
  </View>;
});
