import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';

/** Decorative monochrome symbols; the containing button provides its accessible name. */
export function CalendarHeaderIcon({ name, active = false, issue = false }: {
  name: 'back' | 'menu' | 'search' | 'reports' | 'sync' | 'print' | 'settings' | 'checklist' | 'notepad' | 'canvas'; active?: boolean; issue?: boolean;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const syncColor = active && !issue ? colors.ink : colors.muted;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.icon}>
    {name === 'back' ? <>
      <View style={styles.backShaft} /><View style={[styles.backArm, { top: 7, transform: [{ rotate: '-45deg' }] }]} />
      <View style={[styles.backArm, { top: 15, transform: [{ rotate: '45deg' }] }]} />
    </> : name === 'menu' ? <>{[4, 11, 18].map((top) => <View key={top} style={[styles.menuLine, { top }]} />)}</> : name === 'search' ? <>
      <View style={styles.searchRing} /><View style={styles.searchHandle} />
    </> : name === 'sync' ? <>
      <View testID={active || issue ? 'sync-loop-closed' : 'sync-loop-open'} style={[styles.syncRing,
        { borderColor: syncColor }, !active && !issue && styles.syncOpen]} />
      {/* Tips sit on the stroke's centerline at opposite ends of one diameter.
          Every arm has the same length; the second arrow is a 180° copy. */}
      <View testID="sync-left-arrow" style={[styles.syncArrow, { left: 1.75 - Math.SQRT2 - 2, top: 12 - Math.SQRT2 - 0.75, backgroundColor: syncColor, transform: [{ rotate: '45deg' }] }]} />
      <View testID="sync-left-arrow" style={[styles.syncArrow, { left: 1.75 + Math.SQRT2 - 2, top: 12 - Math.SQRT2 - 0.75, backgroundColor: syncColor, transform: [{ rotate: '-45deg' }] }]} />
      <View testID="sync-right-arrow" style={[styles.syncArrow, { left: 22.25 - Math.SQRT2 - 2, top: 12 + Math.SQRT2 - 0.75, backgroundColor: syncColor, transform: [{ rotate: '-45deg' }] }]} />
      <View testID="sync-right-arrow" style={[styles.syncArrow, { left: 22.25 + Math.SQRT2 - 2, top: 12 + Math.SQRT2 - 0.75, backgroundColor: syncColor, transform: [{ rotate: '45deg' }] }]} />
      {issue ? <View testID="sync-issue-mark" style={styles.syncIssue}>
        <View testID="sync-issue-stem" style={[styles.syncIssueStem, { backgroundColor: syncColor }]} />
        <View testID="sync-issue-dot" style={[styles.syncIssueDot, { backgroundColor: syncColor }]} />
      </View> : null}
    </> : name === 'checklist' ? <>
      <View style={styles.clipboardBody} /><View style={styles.clipboardClip} />
      {[8, 13, 18].map((top) => <View key={top}>
        <View style={[styles.clipboardCheck, { top }]} />
        <View style={[styles.clipboardLine, { top: top + 1.5 }]} />
      </View>)}
    </> : name === 'notepad' ? <>
      <View style={styles.notePage} />
      {[7, 12, 17].map((top) => <View key={top} style={[styles.noteRule, { top }]} />)}
    </> : name === 'canvas' ? <>
      <View style={styles.canvasLine} />
      <View style={[styles.canvasCard, { left: 1, top: 3 }]} />
      <View style={[styles.canvasCard, { left: 14, top: 13 }]} />
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
  backShaft: { position: 'absolute', left: 1, top: 11, width: 22, height: 2, borderRadius: 1, backgroundColor: colors.graphite },
  backArm: { position: 'absolute', left: 0, width: 12, height: 2, borderRadius: 1, backgroundColor: colors.graphite },
  menuLine: { position: 'absolute', left: 1, width: 22, height: 2, borderRadius: 1, backgroundColor: colors.graphite },
  searchRing: { position: 'absolute', top: 1, left: 1, width: 16, height: 16,
    borderWidth: 2, borderColor: colors.graphite, borderRadius: 8 },
  searchHandle: { position: 'absolute', top: 14, left: 17, height: 10, width: 2,
    borderRadius: 1, backgroundColor: colors.graphite, transform: [{ rotate: '-45deg' }] },
  graphAxes: { position: 'absolute', left: 1, bottom: 1, width: 22, height: 22,
    borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderColor: colors.graphite },
  graphBar: { position: 'absolute', bottom: 4, width: 3, borderRadius: 0.5, backgroundColor: colors.graphite },
  clipboardBody: { position: 'absolute', left: 3, top: 3, width: 18, height: 20, borderWidth: 1.5,
    borderColor: colors.graphite, borderRadius: 2.5 },
  clipboardClip: { position: 'absolute', left: 8, top: 0.5, width: 8, height: 5, borderWidth: 1.5,
    borderColor: colors.graphite, backgroundColor: colors.paper, borderRadius: 1.5 },
  clipboardCheck: { position: 'absolute', left: 6.5, width: 3, height: 3, borderWidth: 1.5, borderColor: colors.graphite, borderRadius: 0.5 },
  clipboardLine: { position: 'absolute', left: 12, width: 6, height: 1.5, backgroundColor: colors.graphite, borderRadius: 0.75 },
  notePage: { position: 'absolute', left: 3, top: 1, width: 18, height: 22, borderWidth: 1.5,
    borderColor: colors.graphite, borderRadius: 2.5 },
  noteRule: { position: 'absolute', left: 7, width: 10, height: 1.5, backgroundColor: colors.graphite, borderRadius: 0.75 },
  canvasLine: { position: 'absolute', left: 7, top: 11.5, width: 11, height: 1.5, backgroundColor: colors.graphite,
    transform: [{ rotate: '38deg' }] },
  canvasCard: { position: 'absolute', width: 9, height: 8, borderWidth: 1.5, borderRadius: 1.5,
    borderColor: colors.graphite, backgroundColor: colors.paper },
  syncRing: { position: 'absolute', left: 1, top: 1, width: 22, height: 22,
    borderWidth: 1.5, borderRadius: 11 },
  syncOpen: { borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  syncArrow: { position: 'absolute', width: 4, height: 1.5, borderRadius: 0.75 },
  syncIssue: { position: 'absolute', left: 11.25, top: 6.5, width: 1.5, height: 11 },
  syncIssueStem: { position: 'absolute', left: 0, top: 0, width: 1.5, height: 7, borderRadius: 0.75 },
  syncIssueDot: { position: 'absolute', left: 0, top: 9.5, width: 1.5, height: 1.5, borderRadius: 0.75 },
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
