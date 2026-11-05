const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const file = path.join(__dirname, '../src/screens/CanvasWorkplaneSolids.tsx');
const moduleStub = { exports: {} };
const jsx = (type, props) => ({ type, props });
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText, { module: moduleStub, exports: moduleStub.exports,
  require(name) {
    if (name === 'react') return { memo: (render) => render };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { View: 'View', StyleSheet: { absoluteFill: {}, create: (styles) => styles } };
    throw Error('Unexpected solid renderer import: ' + name);
  } });
const { WorkplaneFaces, WorkplaneSphere } = moduleStub.exports;
const styleOf = (node) => Object.assign({}, ...node.props.style);

function nativeTriangleCorners(style) {
  const { left, top, width, height, borderLeftWidth } = style;
  const angle = parseFloat(style.transform[0].rotate), cosine = Math.cos(angle), sine = Math.sin(angle);
  const centerX = left + width / 2, centerY = top + height / 2;
  return [[0, height], [width, height], [borderLeftWidth, 0]].map(([x, y]) => {
    const dx = x - width / 2, dy = y - height / 2;
    return { x: centerX + cosine * dx - sine * dy, y: centerY + sine * dx + cosine * dy };
  });
}

test('native faces fan convex polygons into exact triangles with depth order and origin', () => {
  const origin = { x: 250, y: -70 };
  const quad = [{ x: -43, y: 11 }, { x: 30, y: 6 }, { x: 39, y: 40 }, { x: -21, y: 57 }];
  const triangle = [{ x: -9, y: -30 }, { x: -3, y: 14 }, { x: 23, y: 27 }];
  const faces = WorkplaneFaces({ origin, color: '#667788', faces: [
    { points: triangle, depth: 40, shade: 1 },
    { points: quad, depth: -30, shade: 0.45 },
  ] });
  assert.equal(faces.props.pointerEvents, 'none');
  assert.equal(faces.props.accessibilityElementsHidden, true);
  const styles = faces.props.children.map(styleOf);
  assert.equal(styles.length, 3);
  assert.equal(styles[0].borderBottomColor, styles[1].borderBottomColor);
  assert.ok(parseInt(styles[0].borderBottomColor.slice(1), 16) < parseInt(styles[2].borderBottomColor.slice(1), 16));
  const fan = [[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]], triangle];
  for (const [index, style] of styles.entries()) {
    assert.equal(style.borderLeftColor, 'transparent');
    assert.equal(style.borderRightColor, 'transparent');
    assert.equal(style.position, 'absolute');
    const actual = nativeTriangleCorners(style);
    for (const point of fan[index]) assert.ok(actual.some(({ x, y }) => Math.hypot(x - origin.x - point.x, y - origin.y - point.y) < 1e-8));
  }
});

test('native sphere stays round with a shifted radial highlight and no hit target', () => {
  const sphere = WorkplaneSphere({ center: { x: 62, y: 87 }, radius: 24, color: '#345' });
  assert.equal(sphere.props.pointerEvents, 'none');
  assert.equal(sphere.props.accessible, false);
  const style = styleOf(sphere);
  assert.deepEqual([style.left, style.top, style.width, style.height, style.borderRadius], [38, 63, 48, 48, 24]);
  assert.equal(style.overflow, 'hidden');
  const [gradient] = style.experimental_backgroundImage;
  assert.equal(gradient.type, 'radial-gradient');
  assert.equal(gradient.shape, 'circle');
  assert.notEqual(gradient.position.left, '50%');
  assert.equal(new Set(gradient.colorStops.map(({ color }) => color)).size, 4);
  assert.equal(WorkplaneSphere({ center: { x: 0, y: 0 }, radius: 0, color: '#000' }), null);
});
