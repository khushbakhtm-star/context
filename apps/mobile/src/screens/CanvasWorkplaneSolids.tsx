import { memo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import type { CanvasPoint } from '../utils/canvas';

type WorkplaneFace = { points: readonly CanvasPoint[]; depth: number; shade: number };
const ORIGIN = { x: 0, y: 0 };

function tint(color: string, amount: number) {
  const short = /^#([\da-f]{3,4})$/i.exec(color);
  const hex = short ? Array.from(short[1]!, (value) => value.repeat(2)).join('') : color.slice(1);
  if (!/^(?:[\da-f]{6}|[\da-f]{8})$/i.test(hex)) return color;
  const target = amount < 0 ? 0 : 255;
  const mix = Math.min(1, Math.abs(amount));
  const channels = [0, 2, 4].map((offset) => {
    const component = Number.parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(component + (target - component) * mix).toString(16).padStart(2, '0');
  });
  return '#' + channels.join('') + hex.slice(6);
}

function triangleStyle(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, origin: CanvasPoint, color: string): ViewStyle | null {
  const squaredDistance = (from: CanvasPoint, to: CanvasPoint) => (from.x - to.x) ** 2 + (from.y - to.y) ** 2;
  const ab = squaredDistance(a, b), bc = squaredDistance(b, c), ca = squaredDistance(c, a);
  // A longest side puts the altitude foot inside the base, including obtuse faces.
  let [start, end, apex] = ab >= bc && ab >= ca ? [a, b, c] : bc >= ca ? [b, c, a] : [c, a, b];
  let dx = end.x - start.x, dy = end.y - start.y;
  if (dx * (apex.y - start.y) - dy * (apex.x - start.x) > 0) {
    [start, end] = [end, start]; dx = -dx; dy = -dy;
  }
  const width = Math.hypot(dx, dy);
  if (!Number.isFinite(width) || width < 0.5) return null;
  const cosine = dx / width, sine = dy / width;
  const relativeX = apex.x - start.x, relativeY = apex.y - start.y;
  const height = sine * relativeX - cosine * relativeY;
  if (!Number.isFinite(height) || height < 0.35) return null;
  const foot = Math.max(0, Math.min(width, cosine * relativeX + sine * relativeY));
  const centerX = origin.x + start.x + dx / 2 + sine * height / 2;
  const centerY = origin.y + start.y + dy / 2 - cosine * height / 2;
  // Collapsing the inset borders to the altitude foot makes the bottom
  // border a filled triangle, while the other borders are transparent.
  return { left: centerX - width / 2, top: centerY - height / 2, width, height,
    borderLeftWidth: foot, borderRightWidth: width - foot, borderBottomWidth: height,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color,
    transform: [{ rotate: Math.atan2(dy, dx) + 'rad' }] };
}

export const WorkplaneFaces = memo(function WorkplaneFaces({ faces, origin = ORIGIN, color }: {
  faces: readonly WorkplaneFace[]; origin?: CanvasPoint; color: string;
}) {
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={StyleSheet.absoluteFill}>
    {[...faces].sort((left, right) => left.depth - right.depth).flatMap(({ points, shade }, faceIndex) => {
      const first = points[0];
      if (!first) return [];
      const fill = tint(color, (shade - 0.7) * 0.72);
      return points.slice(1, -1).map((point, index) => {
        const geometry = triangleStyle(first, point, points[index + 2]!, origin, fill);
        return geometry ? <View key={faceIndex + ':' + index} style={[styles.absolute, geometry]} /> : null;
      });
    })}
  </View>;
});

export const WorkplaneSphere = memo(function WorkplaneSphere({ center, radius, color }: {
  center: CanvasPoint; radius: number; color: string;
}) {
  if (!Number.isFinite(radius) || radius < 0.5) return null;
  const diameter = 2 * radius;
  const base = tint(color, -0.14);
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.absolute, { left: center.x - radius, top: center.y - radius, width: diameter, height: diameter,
      borderRadius: radius, overflow: 'hidden', backgroundColor: base,
      experimental_backgroundImage: [{
        type: 'radial-gradient', shape: 'circle', size: 'farthest-corner', position: { left: '30%', top: '24%' },
        colorStops: [
          { color: tint(color, 0.55), positions: ['0%'] },
          { color: tint(color, 0.14), positions: ['30%'] },
          { color: base, positions: ['58%'] },
          { color: tint(color, -0.48), positions: ['100%'] },
        ],
      }],
    }]} />;
});

const styles = StyleSheet.create({ absolute: { position: 'absolute' } });
