import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';

/** Decorative monochrome symbols; the containing button provides its accessible name. */
export function CalendarHeaderIcon({ name }: { name: 'settings' | 'search' | 'reports' }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View pointerEvents="none" accessible={false} style={styles.icon}>
    {name === 'settings' ? <>
      {[0, 45, 90, 135].map((angle) => <View key={angle} style={[styles.gearTeeth, { transform: [{ rotate: `${angle}deg` }] }]} />)}
      <View style={styles.gearRing}><View style={styles.gearCenter} /></View>
    </> : name === 'search' ? <>
      <View style={styles.searchRing} /><View style={styles.searchHandle} />
    </> : <>
      <View style={styles.graphAxes} />
      <View style={[styles.graphBar, { left: 6, height: 7 }]} />
      <View style={[styles.graphBar, { left: 12, height: 12 }]} />
      <View style={[styles.graphBar, { left: 18, height: 17 }]} />
    </>}
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  icon: { width: 24, height: 24 },
  gearTeeth: { position: 'absolute', top: 0, left: 10, width: 4, height: 24,
    borderRadius: 1, backgroundColor: colors.graphite },
  gearRing: { position: 'absolute', top: 3, left: 3, width: 18, height: 18, borderWidth: 2,
    borderColor: colors.graphite, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  gearCenter: { width: 7, height: 7, borderWidth: 1.5, borderColor: colors.graphite, borderRadius: 4 },
  searchRing: { position: 'absolute', top: 1, left: 1, width: 16, height: 16,
    borderWidth: 2, borderColor: colors.graphite, borderRadius: 8 },
  searchHandle: { position: 'absolute', top: 14, left: 17, height: 10, width: 2,
    borderRadius: 1, backgroundColor: colors.graphite, transform: [{ rotate: '-45deg' }] },
  graphAxes: { position: 'absolute', left: 1, bottom: 1, width: 22, height: 22,
    borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.graphite },
  graphBar: { position: 'absolute', bottom: 4, width: 3, borderRadius: 0.5, backgroundColor: colors.graphite },
});
