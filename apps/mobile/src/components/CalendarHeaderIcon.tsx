import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';

/** Decorative monochrome symbols; the containing button provides its accessible name. */
export function CalendarHeaderIcon({ name }: { name: 'menu' | 'search' | 'reports' | 'sync' }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View pointerEvents="none" accessible={false} style={styles.icon}>
    {name === 'menu' ? <>{[4, 11, 18].map((top) => <View key={top} style={[styles.menuLine, { top }]} />)}</> : name === 'search' ? <>
      <View style={styles.searchRing} /><View style={styles.searchHandle} />
    </> : name === 'sync' ? <>
      <View style={styles.syncUpper} /><View style={styles.syncLower} />
      <View style={[styles.syncArrow, { left: 17, top: 2, transform: [{ rotate: '45deg' }] }]} />
      <View style={[styles.syncArrow, { left: 17, top: 6, transform: [{ rotate: '-45deg' }] }]} />
      <View style={[styles.syncArrow, { left: 1, top: 16, transform: [{ rotate: '-45deg' }] }]} />
      <View style={[styles.syncArrow, { left: 1, top: 20, transform: [{ rotate: '45deg' }] }]} />
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
  menuLine: { position: 'absolute', left: 1, width: 22, height: 2, borderRadius: 1, backgroundColor: colors.graphite },
  searchRing: { position: 'absolute', top: 1, left: 1, width: 16, height: 16,
    borderWidth: 2, borderColor: colors.graphite, borderRadius: 8 },
  searchHandle: { position: 'absolute', top: 14, left: 17, height: 10, width: 2,
    borderRadius: 1, backgroundColor: colors.graphite, transform: [{ rotate: '-45deg' }] },
  graphAxes: { position: 'absolute', left: 1, bottom: 1, width: 22, height: 22,
    borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.graphite },
  graphBar: { position: 'absolute', bottom: 4, width: 3, borderRadius: 0.5, backgroundColor: colors.graphite },
  syncUpper: { position: 'absolute', left: 3, top: 4, width: 18, height: 6,
    borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 5, borderColor: colors.graphite },
  syncLower: { position: 'absolute', left: 3, top: 14, width: 18, height: 6,
    borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 5, borderColor: colors.graphite },
  syncArrow: { position: 'absolute', width: 6, height: 2, borderRadius: 1, backgroundColor: colors.graphite },
});
