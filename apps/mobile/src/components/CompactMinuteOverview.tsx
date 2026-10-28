import { useRef, type ComponentRef, type RefObject, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent,
  type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { AppColors } from '../theme';
import { compactMinuteAt, type CompactBand } from '../utils/calendar-compact';

type Touch = { day: string; minute: number; x: number; y: number; long: boolean };
export function CompactMinuteOverview({ scrollRef, days, labels, bands, outlines, rowHeight, railWidth, dayWidth, colors,
  current, selection, disabled, scrolling, timeLabel, onSelect, onHold, onScroll, onBegin, onEnd, onLayout, onContentSizeChange,
  refreshControl,
}: { scrollRef: RefObject<ComponentRef<typeof ScrollView> | null>; days: readonly string[]; labels: ReadonlyMap<string, string>;
  bands: ReadonlyMap<string, readonly CompactBand[]>; outlines?: ReadonlyMap<string, readonly CompactBand[]>;
  rowHeight: number; railWidth: number; dayWidth: number; colors: AppColors;
  current: { day: string; minute: number }; selection?: { day: string; first: number; last: number };
  disabled: boolean; scrolling: boolean; timeLabel: (minute: number) => string;
  onSelect: (day: string, minute: number) => void; onHold: (day: string, minute: number) => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void; onBegin: () => void; onEnd: () => void;
  onLayout: () => void; onContentSizeChange: () => void; refreshControl?: ReactElement;
}) {
  const touch = useRef<Touch | null>(null);
  const previousGeometry = useRef({ days: days.join('|'), rowHeight });
  if (disabled || previousGeometry.current.days !== days.join('|') || previousGeometry.current.rowHeight !== rowHeight) touch.current = null;
  previousGeometry.current = { days: days.join('|'), rowHeight };
  const height = 1440 * rowHeight;
  const hourStep = Math.max(1, Math.ceil(22 / (60 * rowHeight)));
  function start(day: string, event: GestureResponderEvent) {
    const minute = compactMinuteAt(event.nativeEvent.locationY, rowHeight);
    touch.current = !disabled && event.nativeEvent.touches.length === 1 && minute !== null
      ? { day, minute, x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, long: false } : null;
  }
  function move(event: GestureResponderEvent) {
    const held = touch.current;
    if (held && (event.nativeEvent.touches.length !== 1 || Math.hypot(event.nativeEvent.pageX - held.x, event.nativeEvent.pageY - held.y) > 8)) touch.current = null;
  }
  return <ScrollView ref={scrollRef} style={{ flex: 1 }} scrollEnabled={scrolling} nestedScrollEnabled
    keyboardShouldPersistTaps="always" keyboardDismissMode="on-drag" scrollEventThrottle={16} refreshControl={refreshControl}
    onScroll={onScroll} onScrollBeginDrag={onBegin} onMomentumScrollBegin={onBegin}
    onScrollEndDrag={onEnd} onMomentumScrollEnd={onEnd} onLayout={onLayout} onContentSizeChange={onContentSizeChange}>
    <View style={{ height, width: railWidth + days.length * dayWidth, flexDirection: 'row' }}>
      <View accessible={false} pointerEvents="none" style={{ width: railWidth, height, backgroundColor: colors.surface }}>
        {Array.from({ length: 25 }, (_, hour) => hour % hourStep === 0 || hour === 24 ? <Text key={hour} numberOfLines={1} maxFontSizeMultiplier={1.4}
          style={{ position: 'absolute', right: 2, top: Math.max(0, Math.min(height - 20, hour * 60 * rowHeight - 10)),
            fontSize: 16, lineHeight: 20, color: colors.muted }}>{hour === 24 ? timeLabel(0) : timeLabel(hour * 60)}</Text> : null)}
      </View>
      {days.map((day) => <Pressable key={day} accessibilityRole="adjustable" accessibilityLabel={`${labels.get(day)}, compact minute overview`}
        accessibilityHint="Tap a time to select it, then use the pencil for exact dates and times. Hold for cell actions."
        accessibilityValue={{ min: 0, max: 1439, now: selection?.day === day ? selection.first : current.day === day ? current.minute : 540 }}
        accessibilityActions={[{ name: 'increment', label: 'Next minute' }, { name: 'decrement', label: 'Previous minute' }]}
        onAccessibilityAction={(event) => { if (disabled || !['increment', 'decrement'].includes(event.nativeEvent.actionName)) return; const minute = selection?.day === day ? selection.first : current.day === day ? current.minute : 540;
          onSelect(day, Math.max(0, Math.min(1439, minute + (event.nativeEvent.actionName === 'decrement' ? -1 : 1)))); }}
        onTouchStart={(event) => start(day, event)} onTouchMove={move} onTouchCancel={() => { touch.current = null; }}
        onLongPress={() => { const held = touch.current; if (held && held.day === day && !disabled) { held.long = true; onHold(day, held.minute); } }}
        onPress={() => { const held = touch.current; touch.current = null; if (held && held.day === day && !held.long && !disabled) onSelect(day, held.minute); }}
        style={{ width: dayWidth, height, backgroundColor: colors.calendarCell, borderLeftWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }}>
        <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
          {(bands.get(day) ?? []).map((band, index) => {
            const bandHeight = (band.endMinute - band.startMinute) * rowHeight;
            return <View key={`${band.startMinute}:${index}`} style={{ position: 'absolute', left: 0, right: 0,
              top: band.startMinute * rowHeight, height: bandHeight, overflow: 'hidden', backgroundColor: band.color,
              opacity: band.mixed ? 0.8 : 1 }}>
              {!band.mixed && !band.groupId && bandHeight >= 21 && band.text ? <Text maxFontSizeMultiplier={1.4} numberOfLines={Math.min(3, Math.floor(bandHeight / 21))}
                style={{ paddingHorizontal: 2, fontSize: 16, lineHeight: 21, color: band.textColor ?? colors.ink }}>{band.text}</Text> : null}
            </View>;
          })}
          {(outlines?.get(day) ?? []).map((outline) => {
            const height = (outline.endMinute - outline.startMinute) * rowHeight;
            return height >= 2 ? <View key={`outline:${outline.startMinute}:${outline.groupId}`} style={{ position: 'absolute', left: 0, right: 0,
              top: outline.startMinute * rowHeight, height, borderWidth: 1, borderColor: outline.textColor ?? colors.ink, overflow: 'hidden' }}>
              {height >= 16 ? <Text numberOfLines={Math.min(3, Math.floor(height / 14))} maxFontSizeMultiplier={1.4}
                style={{ fontSize: 11, lineHeight: 14, fontWeight: '600', paddingHorizontal: 2, color: outline.textColor ?? colors.ink }}>{outline.title}</Text> : null}
            </View> : null;
          })}
          {Array.from({ length: 25 }, (_, hour) => <View key={hour} style={{ position: 'absolute', left: 0, right: 0,
            top: Math.min(height - StyleSheet.hairlineWidth, hour * 60 * rowHeight), height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline }} />)}
          {current.day === day ? <View style={{ position: 'absolute', left: 0, right: 0, top: (current.minute + 1) * rowHeight,
            height: 2, backgroundColor: colors.currentTime }} /> : null}
          {selection?.day === day ? <View style={{ position: 'absolute', left: 0, right: 0, top: selection.first * rowHeight,
            height: Math.max(2, (selection.last - selection.first + 1) * rowHeight), borderWidth: 2, borderColor: colors.currentTime }} /> : null}
        </View>
      </Pressable>)}
    </View>
  </ScrollView>;
}
