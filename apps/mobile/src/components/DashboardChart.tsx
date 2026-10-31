import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';
import { dashboardLineGeometry, dashboardPieGeometry, dashboardPieItems, formatDashboardPercent,
  type DashboardChartItem, type DashboardChartType } from '../utils/dashboard';

export type DashboardChartProps = {
  type: DashboardChartType;
  items: readonly DashboardChartItem[];
  totalMinutes?: number;
  remainderLabel?: string;
  label?: string;
};

export function DashboardChart({ type, items, totalMinutes, remainderLabel, label = 'Activity minutes' }: DashboardChartProps) {
  const { colors } = useAppTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const [width, setWidth] = useState(260);
  const legend = useMemo(() => type === 'pie' ? dashboardPieItems(items,
    totalMinutes ?? items.reduce((sum, item) => sum + item.minutes, 0), remainderLabel, colors.silver) : [...items],
  [type, items, totalMinutes, remainderLabel, colors.silver]);
  const pie = useMemo(() => type === 'pie' ? dashboardPieGeometry(legend) : [], [type, legend]);
  const line = useMemo(() => dashboardLineGeometry(type === 'line' ? items : [], width), [type, items, width]);
  return <View onLayout={(event) => { const measured = event.nativeEvent.layout.width;
    if (Number.isFinite(measured) && measured > 20) setWidth(Math.max(21, measured)); }}>
    {type === 'pie' ? <View testID="dashboard-pie" accessible={false} pointerEvents="none" style={styles.pie}>
      {pie.map((stroke) => <View key={stroke.key} style={{ position: 'absolute', left: stroke.left, top: stroke.top,
        width: stroke.width, height: stroke.height, backgroundColor: stroke.color, transform: [{ rotate: `${stroke.angle}deg` }] }} />)}
    </View> : type === 'line' ? <View testID="dashboard-line" accessible={false} pointerEvents="none" style={styles.line}>
      <View style={styles.axis} />
      {line.segments.map((segment) => <View key={segment.key} style={{ position: 'absolute', left: segment.left, top: segment.top,
        width: segment.width, height: segment.height, backgroundColor: colors.graphite, transform: [{ rotate: `${segment.angle}deg` }] }} />)}
      {line.points.map((point, index) => <View key={point.key} style={{ position: 'absolute', left: point.x - 3, top: point.y - 3,
        width: 6, height: 6, borderRadius: 3, backgroundColor: items[index]!.color }} />)}
      <Text style={styles.scale}>{line.maximum.toLocaleString()} min</Text>
    </View> : null}
    <View accessibilityRole="list" accessibilityLabel={label}>
      {legend.map((item) => <View key={item.key} accessible
        accessibilityLabel={`${item.label}, ${item.minutes} minutes, ${formatDashboardPercent(item.percent)}`} style={styles.row}>
        <View style={styles.heading}><View style={[styles.dot, { backgroundColor: item.color }]} />
          <Text style={styles.name}>{item.label}</Text>
          <Text style={styles.value}>{item.minutes.toLocaleString()} minutes · {formatDashboardPercent(item.percent)}</Text>
        </View>
        {type === 'bar' ? <View style={styles.track}><View style={[styles.fill,
          { width: `${Math.max(0, Math.min(100, item.percent))}%`, backgroundColor: item.color }]} /></View> : null}
      </View>)}
    </View>
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  pie: { width: 180, height: 180, borderRadius: 90, overflow: 'hidden', backgroundColor: colors.panel, alignSelf: 'center', marginVertical: 14 },
  line: { height: 150, marginVertical: 14, position: 'relative' }, axis: { position: 'absolute', left: 10, right: 10, bottom: 10,
    height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline }, scale: { color: colors.muted, fontSize: 10, position: 'absolute', top: 0, right: 0 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 }, dot: { width: 9, height: 9, borderRadius: 5 },
  name: { flexGrow: 1, flexShrink: 1, color: colors.graphite, fontSize: 13 }, value: { color: colors.ink, fontSize: 12, fontVariant: ['tabular-nums'] },
  track: { height: 12, borderRadius: 4, backgroundColor: colors.panel, marginTop: 8, overflow: 'hidden' }, fill: { height: '100%', borderRadius: 4 },
});
