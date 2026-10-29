const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const fixture = path.join(__dirname, 'today-cell-actions.test.cjs');
const source = fs.readFileSync(fixture, 'utf8');
const moduleObject = { exports: {} };
vm.runInNewContext(source.slice(0, source.indexOf('\ntest(')) + '\nmodule.exports = { screen };', {
  require: createRequire(fixture), module: moduleObject, exports: moduleObject.exports,
  __dirname, __filename: fixture, console, Date, TextEncoder, TextDecoder, setTimeout, clearTimeout,
});
const { screen } = moduleObject.exports;
const gesture = (distance) => ({ nativeEvent: { touches: [
  { pageX: 90, pageY: 400 - distance / 2 }, { pageX: 90, pageY: 400 + distance / 2 },
] } });

async function begin(h) {
  const responder = h.pinchResponder();
  assert.equal(responder.onStartShouldSetPanResponderCapture(gesture(200)), true);
  responder.onPanResponderGrant(gesture(200)); await h.settle();
  assert.ok(h.pinchPreview()); return responder;
}

test('many pinch moves update native preview values without relaying out or switching the committed grid', async (t) => {
  const changes = []; const h = screen(t, { props: { dayCount: 7, onZoomChange: (value) => changes.push(value) } }); await h.start();
  h.measureViewport(); await h.settle();
  const initialHeight = h.list().getItemLayout(null, 700).length;
  const responder = await begin(h), preview = h.pinchPreview();
  for (const value of [preview.scaleY, preview.inverseScaleY, preview.translateY]) assert.equal(value.nativeDriver, true, 'preview values use the public native-driver configuration');
  const rendered = h.renderCount();
  for (const distance of [180, 150, 130, 170, 120, 90, 80]) {
    responder.onPanResponderMove(gesture(distance), {}); await h.flushAnimationFrames();
    assert.equal(h.renderCount(), rendered, 'pointer movement must not schedule React layout work');
    assert.equal(h.list().getItemLayout(null, 700).length, initialHeight);
    assert.equal(h.overview(), undefined, 'crossing the compact threshold must not swap renderers during the gesture');
    assert.equal(h.pinchPreview(), preview);
  }
  assert.ok(preview.scaleY.value < 0.02); assert.equal(changes.length, 0);
  responder.onPanResponderRelease({ nativeEvent: {} }, {}); await h.settle();
  assert.equal(changes.length, 1); assert.ok(h.overview());
  assert.ok(h.pinchPreview(), 'the preview covers the renderer handoff');
  await h.flushAnimationFrames(); await h.flushAnimationFrames(); assert.ok(h.pinchPreview(), 'paint frames alone cannot uncover unready native content');
  h.overview().onContentSizeChange(390, h.overview().rowHeight * 1440);
  await h.flushAnimationFrames(); assert.ok(h.pinchPreview());
  await h.flushAnimationFrames(); assert.equal(h.pinchPreview(), undefined);
  assert.equal(h.overview().hidden, false); assert.equal(h.overview().days.length, 7);
  assert.ok(Math.abs(h.overview().rowHeight * 1440 - 500) < 0.05);
});

test('a released zoom waits for interior FlatList cells, tolerates absent partial edges and restores its anchor only once', async (t) => {
  const changes = [], scrolls = [];
  const h = screen(t, { props: { onZoomChange: (value) => changes.push(value) } }); await h.start();
  const list = h.list(); list.ref.current = { scrollToOffset: (value) => scrolls.push(value), scrollToIndex() {} };
  list.onScroll({ nativeEvent: { contentOffset: { y: 12000 } } });
  const responder = await begin(h); const scrollsAtStart = scrolls.length;
  responder.onPanResponderMove(gesture(220), {}); await h.flushAnimationFrames();
  assert.equal(scrolls.length, scrollsAtStart, 'moves cannot issue scrollTo corrections');
  responder.onPanResponderRelease({ nativeEvent: {} }, {}); await h.settle();
  const target = h.list(), height = target.getItemLayout(null, 0).length;
  target.onContentSizeChange(390, height * 1440);
  const offset = scrolls.at(-1).offset;
  const first = Math.ceil(offset / height), last = Math.min(1439, Math.floor((offset + 500) / height) - 1);
  assert.equal(scrolls.length, scrollsAtStart + 1);
  target.onContentSizeChange(390, height * 1440); assert.equal(scrolls.length, scrollsAtStart + 1, 'duplicate layout callbacks cannot scroll again');
  await h.flushAnimationFrames(); await h.flushAnimationFrames(); assert.ok(h.pinchPreview(), 'missing virtualized cells stay covered');
  target.onViewableItemsChanged({ viewableItems: Array.from({ length: last - first + 1 }, (_, n) => ({ index: first + n })) });
  await h.flushAnimationFrames(); assert.ok(h.pinchPreview());
  await h.flushAnimationFrames(); assert.equal(h.pinchPreview(), undefined);
  assert.equal(changes.length, 1); assert.ok(h.list().initialNumToRender * height >= 500);
});

test('a subpixel zoom finishes when native content size rounds unchanged and emits no new size callback', async (t) => {
  const changes = [], h = screen(t, { props: { onZoomChange: (value) => changes.push(value) } }); await h.start();
  const old = h.list(), rowHeight = old.getItemLayout(null, 0).length, offset = 12345;
  old.ref.current = { scrollToOffset() {}, scrollToIndex() {} };
  old.onContentSizeChange(390, rowHeight * 1440);
  old.onScroll({ nativeEvent: { contentOffset: { y: offset } } });
  const first = Math.ceil(offset / rowHeight), last = Math.floor((offset + 500) / rowHeight) - 1;
  old.onViewableItemsChanged({ viewableItems: Array.from({ length: last - first + 1 }, (_, index) => ({ index: first + index })) });
  const responder = await begin(h); responder.onPanResponderMove(gesture(200.0001), {}); await h.flushAnimationFrames();
  responder.onPanResponderRelease({ nativeEvent: {} }, {}); await h.settle();
  assert.equal(changes.length, 1); assert.ok(h.pinchPreview());
  for (let index = 0; index < 4; index++) await h.flushAnimationFrames();
  assert.equal(h.pinchPreview(), undefined, 'unchanged pixel-sized content cannot leave a permanent overlay');
});

test('Day and compact preview use the same blank grid and rail shades in light and dark appearances', async (t) => {
  for (const appearanceMode of ['light', 'dark']) {
    const h = screen(t, { appearanceMode }); await h.start();
    const cell = h.cell(600), normalBackground = cell.props.children[0].props.style[0].backgroundColor;
    const normalLine = cell.props.style[0].borderColor;
    const responder = await begin(h), preview = h.pinchPreview();
    assert.equal(preview.backgroundColor, normalBackground); assert.equal(preview.gridLineColor, normalLine);
    responder.onPanResponderMove(gesture(80), {}); await h.flushAnimationFrames();
    responder.onPanResponderRelease({ nativeEvent: {} }, {}); await h.settle();
    assert.equal(h.overview().backgroundColor, normalBackground); assert.equal(h.overview().gridLineColor, normalLine);
    h.overview().onContentSizeChange(390, h.overview().rowHeight * 1440);
    await h.flushAnimationFrames(); await h.flushAnimationFrames();
    assert.equal(h.pinchPreview(), undefined);
  }
});

test('resizing the viewport during a released handoff cannot leave its stale readiness gate on screen', async (t) => {
  const changes = [], h = screen(t, { props: { onZoomChange: (value) => changes.push(value) } }); await h.start();
  h.measureViewport(); await h.settle();
  const responder = await begin(h); responder.onPanResponderMove(gesture(220), {}); await h.flushAnimationFrames();
  responder.onPanResponderRelease({ nativeEvent: {} }, {}); await h.settle();
  assert.ok(h.pinchPreview()); assert.equal(changes.length, 1);
  h.measureViewport({ height: 340 }); await h.settle();
  await h.flushAnimationFrames(); await h.flushAnimationFrames();
  assert.equal(h.pinchPreview(), undefined); assert.equal(changes.length, 1);
  assert.ok(h.list());
});

test('canceling or backgrounding a pinch discards preview transforms and never commits its zoom', async (t) => {
  for (const kind of ['terminate', 'background']) {
    const changes = []; const h = screen(t, { props: { onZoomChange: (value) => changes.push(value) } }); await h.start();
    const height = h.list().getItemLayout(null, 600).length;
    const responder = await begin(h); responder.onPanResponderMove(gesture(90), {}); await h.flushAnimationFrames();
    if (kind === 'background') await h.background(); else { responder.onPanResponderTerminate(); await h.settle(); }
    await h.flushAnimationFrames();
    assert.equal(h.pinchPreview(), undefined); assert.equal(h.list().getItemLayout(null, 600).length, height);
    assert.equal(changes.length, 0);
  }
});

test('navigation invalidates a queued preview frame and cannot apply its old zoom on release', async (t) => {
  const changes = []; const h = screen(t, { props: { onZoomChange: (value) => changes.push(value) } }); await h.start();
  const responder = await begin(h); responder.onPanResponderMove(gesture(80), {});
  await h.navigate('2026-10-26'); await h.flushAnimationFrames();
  responder.onPanResponderRelease({ nativeEvent: {} }, {}); await h.settle();
  assert.equal(h.pinchPreview(), undefined); assert.equal(changes.length, 0); assert.equal(h.overview(), undefined);
});
