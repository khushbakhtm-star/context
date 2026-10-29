import { memo, useMemo } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { AppColors } from '../theme';
import type { CompactBand } from '../utils/calendar-compact';
import { calendarPinchOffsetRange, type CalendarZoomAnchor } from '../utils/calendar-layout';
import { CalendarCellText } from './CalendarCellText';
import { calendarReadableMinuteWindow, type CalendarCellAnnotation } from '../utils/calendar-cell-text';

type Props = { active: boolean; days: readonly string[]; bands: ReadonlyMap<string, readonly CompactBand[]>;
  outlines: ReadonlyMap<string, readonly CompactBand[]>; annotations: ReadonlyMap<string, readonly CalendarCellAnnotation[]>;
  rowHeight: number; railWidth: number; dayWidth: number;
  colors: AppColors; scaleY: Animated.Value; anchor?: CalendarZoomAnchor; viewportHeight: number; fontScale?: number;
  timeLabel: (minute: number) => string; current: { day: string; minute: number };
  selection?: { day: string; first: number; last: number }; backgroundColor: string; gridLineColor: string };

/** Prewarmed passive canvas: acquiring a pinch changes transforms/visibility,
 * not hundreds of mounted native cells. Only one Animated value crosses from JS
 * for each frame; offset, inverse scale, glyph scale and fade live in its graph. */
export const CalendarPinchPreview = memo(function CalendarPinchPreview({ active, days, bands, outlines, annotations,
  rowHeight, railWidth, dayWidth, colors, scaleY, timeLabel, current, selection, backgroundColor, gridLineColor,
  anchor, viewportHeight, fontScale = 1,
}: Props) {
  const height = 1440 * rowHeight;
  const inverseScaleY = useMemo(() => Animated.divide(1, scaleY), [scaleY]);
  const focal = anchor ?? { minute: 0, viewportY: 0 };
  const windows = [calendarReadableMinuteWindow(focal, viewportHeight)];
  if (!active && rowHeight >= 9) {
    // Prewarm the union for a pinch started anywhere in this viewport, not just
    // the first hour or its center. All currently readable notes are already
    // mounted/measured when the fingers acquire the gesture.
    for (const viewportY of [0, viewportHeight]) windows.push(calendarReadableMinuteWindow({
      minute: focal.minute + (viewportY - focal.viewportY) / rowHeight, viewportY,
    }, viewportHeight));
  }
  const readable = { first: Math.min(...windows.map((window) => window.first)), last: Math.max(...windows.map((window) => window.last)) };
  const translateY = useMemo(() => scaleY.interpolate({
    ...calendarPinchOffsetRange(anchor ?? { minute: 0, day: 0, viewportX: 0, viewportY: 0 }, rowHeight, viewportHeight),
    extrapolate: 'clamp',
  }), [scaleY, anchor, rowHeight, viewportHeight]);
  const labelStyle = useMemo(() => ({ transformOrigin: 'top left' as const, transform: [{ scaleY: inverseScaleY }] }), [inverseScaleY]);
  const aboveOverview = useMemo(() => scaleY.interpolate({ inputRange: [9 / rowHeight, 13 / rowHeight],
    outputRange: [1, 0], extrapolate: 'clamp' }), [scaleY, rowHeight]);
  const minuteRules = useMemo(() => scaleY.interpolate({ inputRange: [6 / rowHeight, 9 / rowHeight],
    outputRange: [0, 1], extrapolate: 'clamp' }), [scaleY, rowHeight]);
  const bottomInset = useMemo(() => Animated.multiply(-2.5, inverseScaleY), [inverseScaleY]);
  const currentInset = useMemo(() => Animated.multiply(-1.5, inverseScaleY), [inverseScaleY]);
  const selectionInset = useMemo(() => Animated.multiply(-2, inverseScaleY), [inverseScaleY]);
  const content = useMemo(() => <>
    <View style={{ width: railWidth, height, backgroundColor }}>
      {Array.from({ length: 24 }, (_, hour) => <Animated.View key={hour} style={[{ position: 'absolute', right: 2,
        top: hour * 60 * rowHeight, opacity: aboveOverview }, labelStyle]}>
        <Text numberOfLines={1} allowFontScaling={false} style={{ fontSize: 16, lineHeight: 20, color: colors.ink }}>{timeLabel(hour * 60)}</Text>
      </Animated.View>)}
      {Array.from({ length: readable.last - readable.first + 1 }, (_, index) => readable.first + index).map((minute) =>
        <View key={`minute-time:${minute}`} style={{ position: 'absolute', right: 1, top: minute * rowHeight, height: rowHeight }}>
          <CalendarCellText text={timeLabel(minute)} width={Math.max(1, railWidth - 2)} height={rowHeight} rowHeight={rowHeight}
            color={colors.ink} fontScale={fontScale} align="right" verticalAlign="center" scaleY={scaleY} inverseScaleY={inverseScaleY} />
        </View>)}
    </View>
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
          borderColor: outline.textColor ?? colors.ink }}>
          <Animated.View testID="pinch-event-edge" style={{ position: 'absolute', top: 0, left: -2.5, right: -2.5, height: 2.5,
            backgroundColor: outline.textColor ?? colors.ink, transformOrigin: 'top left', transform: [{ scaleY: inverseScaleY }] }} />
          <Animated.View testID="pinch-event-edge" style={{ position: 'absolute', top: outlineHeight, left: -2.5, right: -2.5, height: 2.5,
            backgroundColor: outline.textColor ?? colors.ink, transformOrigin: 'top left',
            transform: [{ translateY: bottomInset }, { scaleY: inverseScaleY }] }} />
        </View>;
      })}
      {(annotations.get(day) ?? []).filter((cell) => cell.minute >= readable.first && cell.minute <= readable.last).map((cell) => {
        const badgeWidth = cell.title ? Math.min(dayWidth * 0.45, Math.max(28, dayWidth * 0.4)) : 0;
        const noteWidth = Math.max(1, dayWidth - badgeWidth - (cell.title ? 18 : 12));
        return <View key={`annotation:${cell.minute}`} style={{ position: 'absolute', left: 0, right: 0,
          top: cell.minute * rowHeight, height: rowHeight }}>
          {cell.text ? <View style={{ position: 'absolute', left: 5, top: 0 }}>
            <CalendarCellText text={cell.text} width={noteWidth} height={rowHeight} rowHeight={rowHeight}
              color={cell.color} bold={cell.bold} italic={cell.italic} underline={cell.underline} fontScale={fontScale}
              scaleY={scaleY} inverseScaleY={inverseScaleY} />
          </View> : null}
          {cell.title ? <View style={{ position: 'absolute', left: noteWidth + 9, top: 0, height: rowHeight,
            width: badgeWidth, borderLeftWidth: 1, borderColor: cell.titleColor + '80', paddingLeft: 4 }}>
            <CalendarCellText text={cell.title} width={Math.max(1, badgeWidth - 5)} height={rowHeight} rowHeight={rowHeight}
              color={cell.titleColor} bold fontSize={11} lineHeight={14} inset={3} fontScale={fontScale}
              scaleY={scaleY} inverseScaleY={inverseScaleY} />
          </View> : null}
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
  </>, [days, bands, outlines, annotations, rowHeight, railWidth, dayWidth, colors, current, selection, backgroundColor,
    gridLineColor, labelStyle, aboveOverview, minuteRules, bottomInset, currentInset, selectionInset,
    height, timeLabel, fontScale, scaleY, inverseScaleY, readable.first, readable.last]);
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[StyleSheet.absoluteFill, { backgroundColor, overflow: 'hidden', opacity: active ? 1 : 0 }]}>
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, height, width: railWidth + days.length * dayWidth,
      flexDirection: 'row', transformOrigin: 'top left', transform: [{ translateY }, { scaleY }] }}>
      {content}
    </Animated.View>
  </View>;
});
