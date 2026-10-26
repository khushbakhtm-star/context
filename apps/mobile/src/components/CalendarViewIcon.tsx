import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';
import type { CalendarViewMode } from '../utils/calendar-view-mode';

/** Decorative, code-native calendar pages. The containing control supplies its label. */
export function CalendarViewIcon({ mode, currentDate }: { mode: CalendarViewMode; currentDate?: Date }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const day = mode === 'day' || mode === 'three-days';
  const month = currentDate ? new Intl.DateTimeFormat(undefined, { month: 'short' })
    .format(currentDate).toLocaleUpperCase() : null;
  return <View pointerEvents="none" accessible={false} style={styles.page}>
    <View style={styles.bindings}><View style={styles.binding} /><View style={styles.binding} /></View>
    <View style={styles.heading}>
      {day && month ? <Text accessible={false} allowFontScaling={false} numberOfLines={1} style={styles.month}>{month}</Text> :
        <View style={styles.headingRule} />}
    </View>
    {day ? <Text accessible={false} allowFontScaling={false} style={styles.day}>{currentDate?.getDate() ?? '1'}</Text> :
      mode === 'schedule' ? <View style={styles.schedule}>{[0, 1].map((row) =>
        <View key={row} style={styles.scheduleRow}>
          <View style={styles.scheduleDate}><View style={styles.scheduleDateLine} /><View style={styles.scheduleDateMark} /></View>
          <View style={styles.scheduleDetails}>
            <View style={styles.scheduleTimes}><View style={styles.scheduleTime} /><View style={styles.scheduleTime} /></View>
            <View style={styles.scheduleLine} /><View style={styles.scheduleDescription} />
          </View>
        </View>)}</View> :
      mode === 'year' ? <View style={styles.year}>{Array.from({ length: 12 }, (_, index) =>
        <View key={index} style={styles.yearMonth} />)}</View> :
      <View style={styles.grid}>
        {Array.from({ length: mode === 'week' ? 1 : 3 }, (_, row) => <View key={row} style={styles.gridRow}>
          {Array.from({ length: 7 }, (_, column) => <View key={column} style={[styles.gridCell,
            mode === 'week' && styles.weekCell]} />)}
        </View>)}
      </View>}
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  page: { width: 30, height: 32, borderWidth: 1.5, borderColor: colors.graphite, borderRadius: 4,
    alignItems: 'center' },
  bindings: { position: 'absolute', left: 5, right: 5, top: -4, flexDirection: 'row', justifyContent: 'space-between' },
  binding: { height: 6, width: 2, backgroundColor: colors.graphite, borderRadius: 1 },
  heading: { width: '100%', height: 11, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  month: { width: '100%', paddingTop: 1, textAlign: 'center', color: colors.graphite,
    fontSize: 7, lineHeight: 9, fontWeight: '700' },
  headingRule: { width: 12, height: 2, borderRadius: 1, backgroundColor: colors.graphite },
  day: { color: colors.graphite, fontSize: 16, lineHeight: 18, fontWeight: '500' },
  grid: { flex: 1, width: 23, justifyContent: 'center', gap: 2 },
  gridRow: { flexDirection: 'row', gap: 1 },
  gridCell: { width: 2.4, height: 3, backgroundColor: colors.graphite, opacity: 0.8 },
  weekCell: { height: 12 },
  year: { width: 22, flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center', gap: 2 },
  yearMonth: { width: 4, height: 3, backgroundColor: colors.graphite, opacity: 0.8 },
  schedule: { width: 22, flex: 1, justifyContent: 'center', gap: 2 },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  scheduleDate: { width: 5, height: 6, borderWidth: 0.5, borderColor: colors.graphite, alignItems: 'center' },
  scheduleDateLine: { width: '100%', height: 1, backgroundColor: colors.graphite },
  scheduleDateMark: { width: 2, height: 2, marginTop: 1, backgroundColor: colors.graphite },
  scheduleDetails: { width: 14, gap: 1 },
  scheduleTimes: { flexDirection: 'row', gap: 2 },
  scheduleTime: { width: 4, height: 1, backgroundColor: colors.graphite },
  scheduleLine: { width: 14, height: 1, backgroundColor: colors.graphite },
  scheduleDescription: { width: 10, height: 1, backgroundColor: colors.graphite, opacity: 0.65 },
});
