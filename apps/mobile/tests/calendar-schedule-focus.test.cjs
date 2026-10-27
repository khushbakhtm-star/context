const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'calendar-overview-focus.test.cjs'), 'utf8');
const fixture = { exports: {} };
vm.runInNewContext(source.slice(0, source.indexOf('\ntest(')) + '\nmodule.exports = screenHarness;',
  { module: fixture, exports: fixture.exports, require, __dirname, console });
const screen = fixture.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const plan = (id, start, end) => ({ id, calendarId: 'native', title: id, color: '#0B8043',
  startDate: new Date(2026, 9, 24, Math.floor(start / 60), start % 60),
  endDate: new Date(2026, 9, 24, Math.floor(end / 60), end % 60), allDay: false });

test('Schedule reveals an exact yesterday 08:50 marker before the covering activity without changing real event times', async (t) => {
  const points = []; const plans = [plan('Earlier', 480, 500), plan('Covering activity', 520, 550), plan('Later', 600, 620)];
  const h = screen(t, 'schedule', { props: { activeDate: '2026-10-24', focusRequest: { dateKey: '2026-10-24', minuteIndex: 530, token: 5 },
    onFocusedMinuteChange: (point) => points.push(plain(point)) }, plans: (day) => day === '2026-10-24' ? plans : [] });
  await h.settle(); h.advance();
  const row = h.list().props.renderItem({ item: '2026-10-24' }); const nodes = h.nodes(row);
  const marker = nodes.find((node) => node.props.accessibilityLabel?.startsWith('Focused time ')); assert.ok(marker);
  const markerText = h.nodes(marker).find((node) => node.type === 'Text').props.children.join('');
  assert.match(markerText, /Oct 24, 2026/); assert.match(markerText, /08:50$/);
  const covering = nodes.find((node) => node.props.accessibilityLabel?.includes('Covering activity'));
  assert.match(covering.props.accessibilityLabel, /08:40 – 09:10/);
  assert.ok(nodes.indexOf(marker) < nodes.indexOf(covering));
  marker.props.onLayout({ nativeEvent: { layout: { y: 440 } } }); h.advance();
  assert.equal(h.calls.at(-1).index, 23); assert.equal(h.calls.at(-1).viewOffset, -440);
  h.list().props.onScrollBeginDrag(); const count = h.calls.length;
  marker.props.onLayout({ nativeEvent: { layout: { y: 650 } } }); h.advance(250);
  assert.equal(h.calls.length, count, 'late providers cannot move a user who has manually scrolled');
  nodes.find((node) => node.props.accessibilityLabel?.startsWith('Open Saturday')).props.onPress();
  assert.deepEqual(plain(h.opened.at(-1)), ['2026-10-24', 530]); assert.deepEqual(points.at(-1), { dateKey: '2026-10-24', minuteIndex: 530 });
  assert.equal(plans[1].startDate.getHours(), 8); assert.equal(plans[1].startDate.getMinutes(), 40);
});

test('an empty focused day still has an exact time anchor and stale marker measurements cannot retarget a newer request', async (t) => {
  const h = screen(t, 'schedule', { props: { activeDate: '2026-10-24', focusRequest: { dateKey: '2026-10-24', minuteIndex: 530, token: 5 } } });
  await h.settle(); const oldRow = h.list().props.renderItem({ item: '2026-10-24' });
  const oldMarker = h.nodes(oldRow).find((node) => node.props.accessibilityLabel?.startsWith('Focused time ')); assert.ok(oldMarker);
  h.setProps({ focusRequest: { dateKey: '2026-10-26', minuteIndex: 700, token: 6 } }); await h.settle(); h.advance();
  const count = h.calls.length; oldMarker.props.onLayout({ nativeEvent: { layout: { y: 800 } } }); h.advance(); assert.equal(h.calls.length, count);
  const row = h.list().props.renderItem({ item: '2026-10-26' });
  const marker = h.nodes(row).find((node) => node.props.accessibilityLabel?.startsWith('Focused time '));
  assert.match(h.nodes(marker).find((node) => node.type === 'Text').props.children.join(''), /Oct 26, 2026.*11:40$/);
  marker.props.onLayout({ nativeEvent: { layout: { y: 80 } } }); h.advance(); assert.equal(h.calls.at(-1).index, 25);
  assert.equal(h.calls.at(-1).viewOffset, -80);
});


test('Schedule can place a last-day late marker at the viewport top and skips an event whose exclusive end is exactly the focused minute', async (t) => {
  const h = screen(t, 'schedule', { props: { activeDate: '2026-10-24', selectedDates: ['2026-10-24'],
    focusRequest: { dateKey: '2026-10-24', minuteIndex: 530, token: 9 } },
    plans: () => [plan('Ends at focus', 480, 530), plan('Next activity', 600, 620)] });
  h.tree.props.onLayout({ nativeEvent: { layout: { height: 640 } } }); h.render(); await h.settle();
  const padding = Object.assign({}, ...[h.list().props.contentContainerStyle].flat()).paddingBottom;
  assert.ok(padding >= 640, 'trailing space prevents native end clamping of the final date');
  const row = h.list().props.renderItem({ item: '2026-10-24' }); const nodes = h.nodes(row);
  const marker = nodes.find((node) => node.props.accessibilityLabel?.startsWith('Focused time '));
  const ended = nodes.find((node) => node.props.accessibilityLabel?.includes('Ends at focus'));
  const next = nodes.find((node) => node.props.accessibilityLabel?.includes('Next activity'));
  assert.ok(nodes.indexOf(ended) < nodes.indexOf(marker)); assert.ok(nodes.indexOf(marker) < nodes.indexOf(next));
  marker.props.onLayout({ nativeEvent: { layout: { y: 420 } } }); h.advance();
  assert.equal(h.calls.at(-1).index, 0); assert.equal(h.calls.at(-1).viewOffset, -420);
  h.list().props.onContentSizeChange(390, 1120); h.advance(); assert.equal(h.calls.at(-1).viewOffset, -420);
});
