import { memo, useEffect } from 'react';
import { Text, View } from 'react-native';
import { calendarCellTextLayout } from '../utils/calendar-cell-text';

type Props = { text: string; width: number; height: number; rowHeight: number; color: string;
  bold?: boolean; italic?: boolean; underline?: boolean; fontScale?: number; fontSize?: number; lineHeight?: number;
  inset?: number; align?: 'left' | 'right'; verticalAlign?: 'top' | 'center'; onReady?: () => void };

/** Native text wraps at the full available width using the shared zoom-sized
 * font. The cell clips its overflow, preserving the original note and showing
 * every line that fits without ellipsis or content-dependent scaling. */
export const CalendarCellText = memo(function CalendarCellText({ text, width, height, rowHeight, color,
  bold = false, italic = false, underline = false, fontScale = 1, fontSize = 16, lineHeight = 21,
  inset = 2, align = 'left', verticalAlign = 'top', onReady,
}: Props) {
  const layout = calendarCellTextLayout(rowHeight, fontScale);
  const actualFontSize = layout.fontSize * (Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16) / 16;
  const actualLineHeight = layout.lineHeight * (Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 21) / 21;
  const padding = Number.isFinite(inset) && inset >= 0 ? inset : 2;
  const lineCount = actualLineHeight > 0 ? Math.max(0, Math.floor((height - padding * 2) / actualLineHeight)) : 0;
  const visibleHeight = verticalAlign === 'center' ? Math.min(1, lineCount) * actualLineHeight : lineCount * actualLineHeight;
  useEffect(() => { onReady?.(); }, [text, width, height, rowHeight, fontScale, fontSize, lineHeight, bold, italic, underline, onReady]);
  if (![width, height, rowHeight].every(Number.isFinite) || width <= 0 || height <= 0 || rowHeight <= 0) return null;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ width, height, overflow: 'hidden' }}>
    <View style={{ position: 'absolute', top: verticalAlign === 'center' ? Math.max(padding, (height - actualLineHeight) / 2) : padding,
      left: 0, width, height: visibleHeight, overflow: 'hidden', opacity: layout.opacity }}>
      {layout.opacity > 0 && text ? <Text testID="calendar-cell-text" allowFontScaling={false}
        textBreakStrategy="simple" lineBreakStrategyIOS="none"
        style={{ width, fontSize: actualFontSize, lineHeight: actualLineHeight, includeFontPadding: false, textAlign: align,
          color, fontWeight: bold ? '700' : '400', fontStyle: italic ? 'italic' : 'normal',
          textDecorationLine: underline ? 'underline' : 'none' }}>{text}</Text> : null}
    </View>
  </View>;
});
