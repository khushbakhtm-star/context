import { View } from 'react-native';

export type CellActionIconName = 'cut' | 'copy' | 'paste' | 'fill' | 'group' | 'ungroup' | 'reset' | 'edit' | 'event';

/** Code-native monochrome artwork; the containing button supplies its name. */
export function CellActionIcon({ name, color }: { name: CellActionIconName; color: string }) {
  const line = { position: 'absolute' as const, borderColor: color, borderWidth: 2, backgroundColor: 'transparent' };
  return <View accessible={false} pointerEvents="none" style={{ width: 26, height: 26 }}>
    {name === 'copy' ? <><View style={[line, { left: 3, top: 3, width: 15, height: 17, borderRadius: 1 }]} />
      <View style={[line, { left: 8, top: 7, width: 15, height: 17, borderRadius: 1, backgroundColor: 'transparent' }]} /></>
    : name === 'paste' ? <><View style={[line, { left: 5, top: 4, width: 17, height: 20, borderRadius: 2 }]} />
      <View style={[line, { left: 9, top: 1, width: 9, height: 6, borderRadius: 1 }]} />
      {[11, 16, 20].map((top) => <View key={top} style={{ position: 'absolute', left: 10, top, width: 8, height: 2, backgroundColor: color }} />)}</>
    : name === 'cut' ? <>
      {/* Blade ends meet the outer rings without passing through their holes. */}
      {['32deg', '-32deg'].map((rotate) => <View key={rotate} testID="cut-blade"
        style={{ position: 'absolute', left: 12, top: 0, height: 18, width: 2, borderRadius: 1,
          backgroundColor: color, transform: [{ rotate }] }} />)}
      {[3, 15].map((left) => <View key={left} testID="cut-finger-loop"
        style={[line, { left, top: 16, width: 8, height: 8, borderRadius: 4 }]} />)}
    </>
    : name === 'edit' ? <View style={{ position: 'absolute', left: 9, top: 0, width: 8, height: 23, transform: [{ rotate: '40deg' }] }}>
      <View testID="pencil-body" style={[line, { left: 0, top: 1, width: 8, height: 16, borderBottomWidth: 0, borderRadius: 1 }]} />
      <View style={{ position: 'absolute', left: 1, top: 5, width: 6, height: 2, backgroundColor: color }} />
      <View testID="pencil-tip" style={{ position: 'absolute', left: 1, top: 14, width: 6, height: 6,
        borderRightWidth: 2, borderBottomWidth: 2, borderColor: color, transform: [{ rotate: '45deg' }] }} />
    </View>
    : name === 'fill' ? <><View style={{ position: 'absolute', left: 12, top: 2, width: 2, height: 15, backgroundColor: color }} />
      <View style={[line, { left: 8, top: 9, width: 10, height: 10, borderTopWidth: 0, borderLeftWidth: 0, transform: [{ rotate: '45deg' }] }]} />
      <View style={[line, { left: 3, top: 22, width: 20, height: 2, borderWidth: 0, backgroundColor: color }]} /></>
    : name === 'group' || name === 'event' ? <View style={[line, { left: 3, top: 4, width: 21, height: 19 }]} />
    : name === 'ungroup' ? <>{[0, 1, 2, 3].map((corner) => <View key={corner} style={[line, { left: corner % 2 ? 16 : 3,
        top: corner > 1 ? 16 : 4, width: 8, height: 8, borderRightWidth: corner % 2 ? 2 : 0,
        borderLeftWidth: corner % 2 ? 0 : 2, borderBottomWidth: corner > 1 ? 2 : 0, borderTopWidth: corner > 1 ? 0 : 2 }]} />)}</>
    : name === 'reset' ? <>
      <View testID="reset-ring" style={[line, { left: 4, top: 4, width: 19, height: 19, borderRadius: 10,
        borderTopColor: 'transparent', transform: [{ rotate: '-25deg' }] }]} />
      <View testID="reset-arrowhead" style={{ position: 'absolute', left: 2, top: 2, width: 8, height: 8,
        borderLeftWidth: 2, borderBottomWidth: 2, borderColor: color, transform: [{ rotate: '-10deg' }] }} />
    </> : null}
  </View>;
}
