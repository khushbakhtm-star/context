import { View } from 'react-native';

export type CellActionIconName = 'cut' | 'copy' | 'paste' | 'clear' | 'fill' | 'group' | 'ungroup' | 'reset' | 'edit' | 'event';

/** Code-native monochrome artwork; the containing button supplies its name. */
export function CellActionIcon({ name, color }: { name: CellActionIconName; color: string }) {
  const line = { position: 'absolute' as const, borderColor: color, borderWidth: 1.7 };
  return <View accessible={false} pointerEvents="none" style={{ width: 26, height: 26 }}>
    {name === 'copy' ? <><View style={[line, { left: 3, top: 3, width: 15, height: 17, borderRadius: 1 }]} />
      <View style={[line, { left: 8, top: 7, width: 15, height: 17, borderRadius: 1, backgroundColor: 'transparent' }]} /></>
    : name === 'paste' ? <><View style={[line, { left: 5, top: 4, width: 17, height: 20, borderRadius: 2 }]} />
      <View style={[line, { left: 9, top: 1, width: 9, height: 6, borderRadius: 1 }]} />
      {[11, 16, 20].map((top) => <View key={top} style={{ position: 'absolute', left: 10, top, width: 8, height: 1.5, backgroundColor: color }} />)}</>
    : name === 'cut' ? <>{[4, 15].map((left) => <View key={left} style={[line, { left, top: 16, width: 7, height: 7, borderRadius: 4 }]} />)}
      <View style={{ position: 'absolute', left: 12, top: 1, height: 20, width: 1.8, backgroundColor: color, transform: [{ rotate: '31deg' }] }} />
      <View style={{ position: 'absolute', left: 12, top: 1, height: 20, width: 1.8, backgroundColor: color, transform: [{ rotate: '-31deg' }] }} /></>
    : name === 'edit' ? <><View style={[line, { left: 10, top: 1, width: 6, height: 22, transform: [{ rotate: '40deg' }] }]} />
      <View style={{ position: 'absolute', left: 3, top: 23, width: 20, height: 1.5, backgroundColor: color }} /></>
    : name === 'fill' ? <><View style={{ position: 'absolute', left: 12, top: 2, width: 2, height: 15, backgroundColor: color }} />
      <View style={[line, { left: 8, top: 9, width: 10, height: 10, borderTopWidth: 0, borderLeftWidth: 0, transform: [{ rotate: '45deg' }] }]} />
      <View style={[line, { left: 3, top: 22, width: 20, height: 2, borderWidth: 0, backgroundColor: color }]} /></>
    : name === 'group' || name === 'event' ? <View style={[line, { left: 3, top: 4, width: 21, height: 19, borderWidth: 2.5 }]} />
    : name === 'ungroup' ? <>{[0, 1, 2, 3].map((corner) => <View key={corner} style={[line, { left: corner % 2 ? 16 : 3,
        top: corner > 1 ? 16 : 4, width: 8, height: 8, borderRightWidth: corner % 2 ? 2 : 0,
        borderLeftWidth: corner % 2 ? 0 : 2, borderBottomWidth: corner > 1 ? 2 : 0, borderTopWidth: corner > 1 ? 0 : 2 }]} />)}</>
    : <><View style={[line, { left: 7, top: 5, width: 12, height: 16, transform: [{ rotate: '38deg' }] }]} />
      <View style={{ position: 'absolute', left: 4, top: 23, width: 20, height: 1.5, backgroundColor: color }} />
      {name === 'reset' ? <View style={[line, { left: 1, top: 1, width: 24, height: 24, borderRadius: 13, borderRightColor: 'transparent', borderBottomColor: 'transparent' }]} /> : null}</>}
  </View>;
}
