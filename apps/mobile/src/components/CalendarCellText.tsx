import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { calendarCellTextFitRange, calendarCellTextOpacity, calendarCellTextScale, calendarMeasuredTextHeight,
  calendarMeasuredTextWidth } from '../utils/calendar-cell-text';

const measurements = new Map<string, { height: number; width: number | null }>();
const MAX_MEASUREMENTS = 512;

type Props = { text: string; width: number; height: number; rowHeight: number; color: string;
  bold?: boolean; italic?: boolean; underline?: boolean; fontScale?: number; fontSize?: number; lineHeight?: number;
  inset?: number; align?: 'left' | 'right'; verticalAlign?: 'top' | 'center'; onReady?: () => void;
  scaleY?: Animated.Value; inverseScaleY?: Animated.AnimatedDivision };

/** Measure the entire wrapped paragraph once, then scale the whole paragraph.
 * Gesture transforms are native animated nodes; no glyph/layout measurement runs
 * on pointer movement. Invisible measuring text never flashes a clipped line. */
export const CalendarCellText = memo(function CalendarCellText({ text, width, height, rowHeight, color,
  bold = false, italic = false, underline = false, fontScale = 1, fontSize = 16, lineHeight = 21,
  inset = 2, align = 'left', verticalAlign = 'top', onReady, scaleY, inverseScaleY,
}: Props) {
  const multiplier = Number.isFinite(fontScale) && fontScale > 0 ? Math.min(1.4, fontScale) : 1;
  const actualFontSize = fontSize * multiplier, actualLineHeight = lineHeight * multiplier;
  const key = JSON.stringify([text, width, actualFontSize, actualLineHeight, bold, italic]);
  const currentKey = useRef(key); currentKey.current = key;
  const [measured, setMeasured] = useState<{ key: string; height: number; width: number | null } | null>(() => {
    const cached = measurements.get(key); return cached ? { key, ...cached } : null;
  });
  const extent = measured?.key === key ? measured : measurements.get(key);
  const measuredHeight = extent?.height, measuredWidth = extent?.width;
  const horizontalLimit = measuredWidth ? Math.min(1, width / measuredWidth) : 1;
  const scale = Math.min(horizontalLimit, calendarCellTextScale(rowHeight, Math.max(0, height - inset * 2), measuredHeight ?? 0));
  const transform = useMemo(() => {
    if (!scaleY || !inverseScaleY || !measuredHeight) return null;
    const uniform = scaleY.interpolate({ ...calendarCellTextFitRange(rowHeight, height, measuredHeight, inset, horizontalLimit), extrapolate: 'clamp' });
    const vertical = Animated.multiply(uniform, inverseScaleY);
    return { uniform, vertical, inset: verticalAlign === 'center'
      ? Animated.divide(Animated.subtract(height, Animated.multiply(measuredHeight, vertical)), 2)
      : Animated.multiply(inset, inverseScaleY),
      opacity: Animated.multiply(uniform, actualFontSize).interpolate({ inputRange: [0, 6, 8],
        outputRange: [0, 0, 1], extrapolate: 'clamp' }) };
  }, [scaleY, inverseScaleY, measuredHeight, horizontalLimit, actualFontSize, rowHeight, height, inset, verticalAlign]);
  const fadedWithoutMeasurement = !scaleY && calendarCellTextOpacity(Math.min(1, rowHeight / 34), actualFontSize) === 0;
  useEffect(() => { if (!text || fadedWithoutMeasurement || measuredHeight) onReady?.(); },
    [key, measuredHeight, measuredWidth, fadedWithoutMeasurement, onReady]);
  if (!text || width <= 0 || height <= 0) return null;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ width, height, overflow: 'hidden' }}>
    <Animated.View style={{ position: 'absolute', top: 0, left: 0, width,
      transformOrigin: align === 'right' ? 'top right' : 'top left', opacity: !measuredHeight ? 0 : transform?.opacity ?? calendarCellTextOpacity(scale, actualFontSize),
      transform: [{ translateY: transform?.inset ?? (verticalAlign === 'center' && measuredHeight ? (height - measuredHeight * scale) / 2 : inset) },
        { scaleX: transform?.uniform ?? scale }, { scaleY: transform?.vertical ?? scale }] }}>
      <Text testID="calendar-whole-cell-text" allowFontScaling={false}
        onTextLayout={(event) => {
          if (currentKey.current !== key) return;
          const next = calendarMeasuredTextHeight(event.nativeEvent.lines);
          const nextWidth = calendarMeasuredTextWidth(event.nativeEvent.lines);
          if (next == null || event.nativeEvent.lines.some((line) => line.width !== undefined && (!Number.isFinite(line.width) || line.width < 0))) return;
          if (Math.abs(next - (measuredHeight ?? 0)) < 1 / 64 && nextWidth === measuredWidth) return;
          measurements.delete(key); measurements.set(key, { height: next, width: nextWidth });
          if (measurements.size > MAX_MEASUREMENTS) measurements.delete(measurements.keys().next().value!);
          setMeasured({ key, height: next, width: nextWidth });
        }}
        style={{ width, fontSize: actualFontSize, lineHeight: actualLineHeight, includeFontPadding: false, textAlign: align,
          color, fontWeight: bold ? '700' : '400', fontStyle: italic ? 'italic' : 'normal',
          textDecorationLine: underline ? 'underline' : 'none' }}>{text}</Text>
    </Animated.View>
  </View>;
});
