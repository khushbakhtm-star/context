const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function icon(name, color) {
  const filename = path.join(__dirname, '../src/components/CellActionIcon.tsx'), module = { exports: {} };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module, exports: module.exports, require(name) {
    if (name === 'react-native') return { View: 'View' };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    throw Error('Unexpected cell icon dependency: ' + name);
  } }, { filename });
  return module.exports.CellActionIcon({ name, color });
}
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]; }
const styleOf = (node) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy);
}

test('Cut keeps two genuinely hollow finger loops whose interiors are not crossed by the blades', () => {
  for (const color of ['#333333', '#E3E1DD']) {
    const drawing = nodes(icon('cut', color));
    const loops = drawing.filter((node) => node.props.testID === 'cut-finger-loop').map(styleOf);
    const blades = drawing.filter((node) => node.props.testID === 'cut-blade').map(styleOf);
    assert.equal(loops.length, 2); assert.equal(blades.length, 2);
    for (const loop of loops) {
      assert.equal(loop.borderWidth, 2); assert.equal(loop.borderColor, color); assert.equal(loop.backgroundColor, 'transparent');
      assert.equal(loop.width, loop.height); assert.equal(loop.borderRadius, loop.width / 2);
      const center = [loop.left + loop.width / 2, loop.top + loop.height / 2], innerRadius = loop.width / 2 - loop.borderWidth;
      for (const blade of blades) {
        assert.equal(blade.width, 2); assert.equal(blade.backgroundColor, color);
        const angle = parseFloat(blade.transform[0].rotate) * Math.PI / 180;
        const x = blade.left + blade.width / 2, y = blade.top + blade.height / 2;
        const start = [x + blade.height / 2 * Math.sin(angle), y - blade.height / 2 * Math.cos(angle)];
        const end = [x - blade.height / 2 * Math.sin(angle), y + blade.height / 2 * Math.cos(angle)];
        assert.ok(distanceToSegment(center, start, end) - blade.width / 2 >= innerRadius,
          'the filled blade stroke must stay out of each open finger hole');
      }
    }
  }
});

test('Edit is an outlined pencil with a nib and no detached underline', () => {
  const drawing = nodes(icon('edit', '#E3E1DD'));
  const body = styleOf(drawing.find((node) => node.props.testID === 'pencil-body'));
  const tip = styleOf(drawing.find((node) => node.props.testID === 'pencil-tip'));
  assert.equal(body.borderWidth, 2); assert.equal(body.borderBottomWidth, 0); assert.equal(body.backgroundColor, 'transparent');
  assert.equal(tip.borderRightWidth, 2); assert.equal(tip.borderBottomWidth, 2);
  assert.equal(drawing.some((node) => { const style = styleOf(node); return style.width >= 16 && style.height <= 2; }), false,
    'the pencil has no separate horizontal baseline');
});

test('Reset is one circular arrow with the same two-pixel outline, without a second eraser glyph', () => {
  const drawing = nodes(icon('reset', '#333333'));
  const ring = styleOf(drawing.find((node) => node.props.testID === 'reset-ring'));
  const arrow = styleOf(drawing.find((node) => node.props.testID === 'reset-arrowhead'));
  assert.equal(ring.width, ring.height); assert.equal(ring.borderWidth, 2); assert.equal(ring.backgroundColor, 'transparent');
  assert.equal(ring.borderTopColor, 'transparent'); assert.equal(arrow.borderLeftWidth, 2); assert.equal(arrow.borderBottomWidth, 2);
  assert.equal(drawing.filter((node) => node.type === 'View').length, 3, 'one icon host, one ring and one arrowhead');
});
