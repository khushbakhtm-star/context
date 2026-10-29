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
  assert.equal(preview.scaleY.nativeDriver, true, 'one public native-driver value drives the entire preview graph');
  assert.equal(preview.inverseScaleY, undefined); assert.equal(preview.translateY, undefined);
  const rendered = h.renderCount();
  for (const distance of [180, 150, 130, 170, 120, 90, 80]) {
    const writes = preview.scaleY.writes;
    responder.onPanResponderMove(gesture(distance), {}); await h.flushAnimationFrames();
    assert.equal(preview.scaleY.writes - writes, 1, 'each pointer frame sends one native scalar update');
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

test('the passive canvas is prewarmed at the current viewport before a pinch starts', async (t) => {
  const h = screen(t); await h.start();
  assert.equal(h.pinchPreview(), undefined); assert.equal(h.warmedPinchPreview().active, false);
  const oldScale = h.warmedPinchPreview().scaleY, rowHeight = h.list().getItemLayout(null, 0).length;
  h.list().onScroll({ nativeEvent: { contentOffset: { y: 600 * rowHeight - 250 } } });
  h.list().onScrollEndDrag(); await h.settle();
  assert.ok(Math.abs(h.warmedPinchPreview().anchor.minute - 600) < 0.001);
  const responder = await begin(h);
  assert.equal(h.pinchPreview().scaleY, oldScale, 'acquiring the gesture retains the warmed native graph');
  responder.onPanResponderTerminate(); await h.settle();
});

test('grouped minute annotations retain independent words, formatting and the actual first-row title in preview data', async (t) => {
  const h = screen(t, { readGroups: async () => [{ dateKey: '2026-10-25', startMinute: 600, endMinute: 610,
    blockId: 'activity_readable', title: 'Morning', categoryId: 'study' }],
    readFormats: async () => new Map([[601, { bold: true, italic: true, underline: true, textColor: '#123456' }]]) });
  for (const [minute, text] of [[600, 'First note'], [601, 'Different note']]) h.rows.set(`${h.day}:${minute}`,
    { dateKey: h.day, minuteIndex: minute, text, categoryId: 'study', blockId: 'activity_readable' });
  await h.start();
  const annotations = h.warmedPinchPreview().annotations.get(h.day);
  assert.equal(annotations.find((cell) => cell.minute === 600).text, 'First note');
  assert.equal(annotations.find((cell) => cell.minute === 600).title, 'Morning');
  const second = annotations.find((cell) => cell.minute === 601);
  assert.equal(second.text, 'Different note'); assert.equal(second.title, undefined);
  assert.equal(second.color, '#123456'); assert.equal(second.bold, true); assert.equal(second.italic, true); assert.equal(second.underline, true);
  const responder = await begin(h);
  assert.equal(h.pinchPreview().annotations, h.warmedPinchPreview().annotations);
  assert.equal(h.fittedTexts(601)[0].text, 'Different note');
  responder.onPanResponderTerminate(); await h.settle();
});

test('handoff waits for every visible native note and title measurement, ignoring an old row-height acknowledgement', async (t) => {
  const h = screen(t, { readGroups: async () => [{ dateKey: '2026-10-25', startMinute: 600, endMinute: 610,
    blockId: 'activity_measure', title: 'Activity', categoryId: 'study' }] });
  h.rows.set(`${h.day}:600`, { dateKey: h.day, minuteIndex: 600, text: 'Wrapped paragraph', categoryId: 'study', blockId: 'activity_measure' });
  h.rows.set(`${h.day}:601`, { dateKey: h.day, minuteIndex: 601, text: 'Second paragraph', categoryId: 'study', blockId: 'activity_measure' });
  await h.start(); h.measureViewport(); await h.settle();
  const oldReady = h.fittedTexts(600)[0].onReady, scrolls = [];
  const old = h.list(), base = old.getItemLayout(null, 0).length;
  old.ref.current = { scrollToOffset: (value) => scrolls.push(value), scrollToIndex() {} };
  old.onScroll({ nativeEvent: { contentOffset: { y: 600 * base - 250 } } });
  const responder = await begin(h); responder.onPanResponderMove(gesture(220), {}); await h.flushAnimationFrames();
  responder.onPanResponderRelease({ nativeEvent: {} }, {}); await h.settle();
  const target = h.list(), rowHeight = target.getItemLayout(null, 0).length;
  target.onContentSizeChange(390, rowHeight * 1440);
  const offset = scrolls.at(-1).offset;
  const first = Math.ceil(offset / rowHeight), last = Math.floor((offset + 500) / rowHeight) - 1;
  target.onViewableItemsChanged({ viewableItems: Array.from({ length: last - first + 1 }, (_, index) => ({ index: first + index })) });
  oldReady(); await h.flushAnimationFrames(); await h.flushAnimationFrames();
  assert.ok(h.pinchPreview(), 'native row visibility and an obsolete text callback cannot reveal unmeasured notes');
  h.fittedTexts(600)[0].onReady(); h.fittedTexts(601)[0].onReady();
  await h.flushAnimationFrames(); await h.flushAnimationFrames(); assert.ok(h.pinchPreview(), 'the independent event title must be ready too');
  h.fittedTexts(600)[1].onReady();
  await h.flushAnimationFrames(); await h.flushAnimationFrames(); assert.equal(h.pinchPreview(), undefined);
});

test('a no-fill hole inside a source event never invents a resumed title or leaves the text handoff waiting forever', async (t) => {
  const day = '2026-10-25';
  const plan = { id: 'source', calendarId: 'native', title: 'Source activity', allDay: false, color: '#0B8043',
    startDate: new Date(2026, 9, 25, 10), endDate: new Date(2026, 9, 25, 10, 30) };
  const h = screen(t, { readNative: async () => ({ plans: [plan], failures: [] }), readFormats: async () => new Map([[610, { noFill: true }]]) });
  h.rows.set(`${day}:611`, { dateKey: day, minuteIndex: 611, text: 'Private annotation', categoryId: 'study', blockId: 'sheet_note' });
  await h.start(); h.measureViewport(); await h.settle();
  const annotations = h.warmedPinchPreview().annotations.get(day);
  assert.equal(annotations.filter((cell) => cell.title).length, 1);
  assert.equal(annotations.find((cell) => cell.title).minute, 600);
  assert.equal(annotations.find((cell) => cell.minute === 611).title, undefined);
  const scrolls = [], old = h.list(), base = old.getItemLayout(null, 0).length;
  old.ref.current = { scrollToOffset: (value) => scrolls.push(value), scrollToIndex() {} };
  old.onScroll({ nativeEvent: { contentOffset: { y: 611 * base - 250 } } });
  const responder = await begin(h); responder.onPanResponderMove(gesture(220), {}); await h.flushAnimationFrames();
  responder.onPanResponderRelease({ nativeEvent: {} }, {}); await h.settle();
  const target = h.list(), rowHeight = target.getItemLayout(null, 0).length;
  target.onContentSizeChange(390, rowHeight * 1440);
  const offset = scrolls.at(-1).offset, first = Math.ceil(offset / rowHeight), last = Math.floor((offset + 500) / rowHeight) - 1;
  target.onViewableItemsChanged({ viewableItems: Array.from({ length: last - first + 1 }, (_, index) => ({ index: first + index })) });
  for (let minute = Math.floor(offset / rowHeight); minute <= Math.ceil((offset + 500) / rowHeight); minute++) {
    for (const text of h.fittedTexts(minute)) text.onReady?.();
  }
  await h.flushAnimationFrames(); await h.flushAnimationFrames(); assert.equal(h.pinchPreview(), undefined);
});
