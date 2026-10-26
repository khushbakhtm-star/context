import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';

/** Decorative monochrome symbols; the containing button provides its accessible name. */
export function CalendarHeaderIcon({ name }: { name: 'menu' | 'search' | 'reports' | 'sync' | 'print' | 'settings' }) {
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
    </> : name === 'print' ? <>
      <View style={styles.printPaperTop} /><View style={styles.printBody} />
      <View style={styles.printPaperBottom} /><View style={styles.printIndicator} />
    </> : name === 'settings' ? <>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => <View key={angle}
        style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${angle}deg` }] }]}>
        <View style={styles.gearTooth} />
      </View>)}
      <View style={styles.gearRing} />
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
  printPaperTop: { position: 'absolute', left: 6, top: 1, width: 12, height: 8,
    borderWidth: 2, borderBottomWidth: 0, borderColor: colors.graphite, borderTopLeftRadius: 1, borderTopRightRadius: 1 },
  printBody: { position: 'absolute', left: 1, top: 7, width: 22, height: 12,
    borderWidth: 2, borderColor: colors.graphite, borderRadius: 3 },
  printPaperBottom: { position: 'absolute', left: 6, top: 14, width: 12, height: 9,
    borderWidth: 2, borderColor: colors.graphite, borderRadius: 1, backgroundColor: colors.paper },
  printIndicator: { position: 'absolute', left: 17, top: 10, width: 2, height: 2,
    borderRadius: 1, backgroundColor: colors.graphite },
  gearTooth: { position: 'absolute', left: 10, top: 1, width: 4, height: 6,
    borderRadius: 1, backgroundColor: colors.graphite },
  gearRing: { position: 'absolute', left: 5, top: 5, width: 14, height: 14,
    borderWidth: 2, borderColor: colors.graphite, borderRadius: 7 },
});
