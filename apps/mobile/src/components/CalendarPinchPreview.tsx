import { Animated, StyleSheet, Text, View } from 'react-native';
import type { AppColors } from '../theme';
import type { CompactBand } from '../utils/calendar-compact';

/** Bounded, passive day canvas. No minute controls or layout changes run while
 * fingers move: the parent updates the three native transform values only. */
export function CalendarPinchPreview({ days, bands, outlines, rowHeight, railWidth, dayWidth, colors,
  scaleY, inverseScaleY, translateY, timeLabel, current, selection,
  backgroundColor, gridLineColor,
}: { days: readonly string[]; bands: ReadonlyMap<string, readonly CompactBand[]>;
  outlines: ReadonlyMap<string, readonly CompactBand[]>; rowHeight: number; railWidth: number; dayWidth: number;
  colors: AppColors; scaleY: Animated.Value; inverseScaleY: Animated.Value; translateY: Animated.Value;
  timeLabel: (minute: number) => string; current: { day: string; minute: number };
  selection?: { day: string; first: number; last: number };
  backgroundColor: string; gridLineColor: string;
}) {
  const height = 1440 * rowHeight;
  const labelStyle = { transformOrigin: 'top left' as const, transform: [{ scaleY: inverseScaleY }] };
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[StyleSheet.absoluteFill, { backgroundColor, overflow: 'hidden' }]}>
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, height, width: railWidth + days.length * dayWidth,
      flexDirection: 'row', transformOrigin: 'top left', transform: [{ translateY }, { scaleY }] }}>
      <View style={{ width: railWidth, height, backgroundColor }}>
        {Array.from({ length: 24 }, (_, hour) => <Animated.View key={hour} style={[{ position: 'absolute', right: 2,
          top: hour * 60 * rowHeight }, labelStyle]}>
          <Text numberOfLines={1} allowFontScaling={false} style={{ fontSize: 16, lineHeight: 20, color: colors.ink }}>{timeLabel(hour * 60)}</Text>
        </Animated.View>)}
      </View>
      {days.map((day) => <View key={day} style={{ width: dayWidth, height, backgroundColor,
        borderLeftWidth: StyleSheet.hairlineWidth, borderColor: gridLineColor }}>
        {(bands.get(day) ?? []).map((band, index) => {
          const bandHeight = (band.endMinute - band.startMinute) * rowHeight;
          return <View key={`${band.startMinute}:${index}`} style={{ position: 'absolute', left: 0, right: 0,
            top: band.startMinute * rowHeight, height: bandHeight, overflow: 'hidden', backgroundColor: band.color,
            opacity: band.mixed ? 0.8 : 1 }}>
            {!band.mixed && !band.groupId && band.text && bandHeight >= 21 ? <Animated.View style={labelStyle}>
              <Text numberOfLines={1} allowFontScaling={false} style={{ paddingHorizontal: 2, fontSize: 16, lineHeight: 21,
                color: band.textColor ?? colors.ink }}>{band.text}</Text>
            </Animated.View> : null}
          </View>;
        })}
        {(outlines.get(day) ?? []).map((outline) => <View key={`${outline.startMinute}:${outline.groupId}`}
          style={{ position: 'absolute', left: 0, right: 0, top: outline.startMinute * rowHeight,
            height: (outline.endMinute - outline.startMinute) * rowHeight, borderWidth: 1,
            borderColor: outline.textColor ?? colors.ink, overflow: 'hidden' }}>
          <Animated.View style={labelStyle}><Text numberOfLines={1} allowFontScaling={false}
            style={{ paddingHorizontal: 2, fontSize: 13, lineHeight: 17, fontWeight: '600', color: outline.textColor ?? colors.ink }}>{outline.title}</Text></Animated.View>
        </View>)}
        {Array.from({ length: 25 }, (_, hour) => <View key={hour} style={{ position: 'absolute', left: 0, right: 0,
          top: Math.min(height - StyleSheet.hairlineWidth, hour * 60 * rowHeight), height: StyleSheet.hairlineWidth, backgroundColor: gridLineColor }} />)}
        {current.day === day ? <View style={{ position: 'absolute', left: 0, right: 0,
          top: (current.minute + 1) * rowHeight, height: 2, backgroundColor: colors.currentTime }} /> : null}
        {selection?.day === day ? <View style={{ position: 'absolute', left: 0, right: 0,
          top: selection.first * rowHeight, height: Math.max(2, (selection.last - selection.first + 1) * rowHeight),
          borderWidth: 2, borderColor: colors.currentTime }} /> : null}
      </View>)}
    </Animated.View>
  </View>;
}
