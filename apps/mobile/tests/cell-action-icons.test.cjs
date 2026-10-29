const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function icon(name, color, extra = {}) {
  const filename = path.join(__dirname, '../src/components/CellActionIcon.tsx'), module = { exports: {} };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module, exports: module.exports, require(name) {
    if (name === 'react-native') return { View: 'View', Text: 'Text' };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    throw Error('Unexpected cell icon dependency: ' + name);
  } }, { filename });
  return module.exports.CellActionIcon({ name, color, ...extra });
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
  assert.equal(ring.borderTopColor, 'transparent'); assert.equal(arrow.borderRightWidth, 2); assert.equal(arrow.borderBottomWidth, 2);
  assert.ok(arrow.left >= ring.left + ring.width / 2 && arrow.top < ring.top + ring.height / 2,
    'the clockwise arrowhead sits at the upper-right opening shown in the reference');
  assert.equal(drawing.filter((node) => node.type === 'View').length, 3, 'one icon host, one ring and one arrowhead');
});

test('Copy and Paste use rounded overlapping pages with opaque theme-matched foregrounds and no extra paste lines', () => {
  for (const backgroundColor of ['#EEEEEE', '#242426']) {
    const copy = nodes(icon('copy', '#96938C', { backgroundColor }));
    const back = styleOf(copy.find((node) => node.props.testID === 'copy-back-page'));
    const front = styleOf(copy.find((node) => node.props.testID === 'copy-front-page'));
    assert.ok(front.left > back.left && front.top < back.top, 'the front page is above and right of the rear page');
    assert.equal(front.backgroundColor, backgroundColor, 'rear page edges cannot show through the foreground page');
    assert.equal(front.borderRadius, 4); assert.equal(back.borderRadius, 4);
    const paste = nodes(icon('paste', '#96938C', { backgroundColor }));
    const clipboard = styleOf(paste.find((node) => node.props.testID === 'paste-clipboard'));
    const page = styleOf(paste.find((node) => node.props.testID === 'paste-front-page'));
    const clip = styleOf(paste.find((node) => node.props.testID === 'paste-clip'));
    assert.ok(page.left > clipboard.left && page.top > clipboard.top && page.width < clipboard.width);
    assert.equal(page.backgroundColor, backgroundColor); assert.equal(clip.backgroundColor, backgroundColor);
    assert.equal(paste.filter((node) => node.type === 'View').length, 4, 'clipboard, clip and foreground page have no faux text lines');
    for (const part of [back, front, clipboard, page, clip]) assert.equal(part.borderWidth, 2);
  }
});

test('Group retains the former bottom-bar event border and central minute divider', () => {
  const drawing = nodes(icon('group', '#222222', { secondaryColor: '#777777' }));
  const border = styleOf(drawing.find((node) => node.props.testID === 'group-event-border'));
  const divider = styleOf(drawing.find((node) => node.props.testID === 'group-minute-divider'));
  assert.equal(border.width, 24); assert.equal(border.height, 24); assert.equal(border.borderWidth, 2.5);
  assert.equal(border.justifyContent, 'center'); assert.equal(divider.height, 0.5); assert.equal(divider.backgroundColor, '#777777');
});

test('Format is a centered circled bold italic underlined A with the same two-pixel outline', () => {
  const drawing = nodes(icon('format', '#EEEEEE'));
  const circle = styleOf(drawing.find((node) => node.props.testID === 'format-circle'));
  const letter = drawing.find((node) => node.props.testID === 'format-letter'), style = styleOf(letter);
  assert.equal(circle.borderWidth, 2); assert.equal(circle.width, circle.height); assert.equal(circle.borderRadius, circle.width / 2);
  assert.equal(circle.alignItems, 'center'); assert.equal(circle.justifyContent, 'center');
  assert.equal(letter.props.children, 'A'); assert.equal(style.fontWeight, '800'); assert.equal(style.fontStyle, 'italic');
  assert.equal(style.textDecorationLine, 'underline'); assert.equal(style.includeFontPadding, false);
});
