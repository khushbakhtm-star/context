const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Use the existing actual-screen callback fixture, not a parallel move policy.
const source = fs.readFileSync(path.join(__dirname, 'today-cell-actions.test.cjs'), 'utf8');
const fixture = { exports: {} };
vm.runInNewContext(`${source.slice(0, source.indexOf('\nfunction plan('))}\nmodule.exports = screen;`,
  { module: fixture, exports: fixture.exports, require, __dirname, console });
const screen = fixture.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const touch = (x, y, count = 1) => ({ nativeEvent: { pageX: x, pageY: y,
  touches: Array.from({ length: count }, (_, offset) => ({ pageX: x + offset * 15, pageY: y + offset * 15 })) } });
function visit(node, predicate) { if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = visit(child, predicate); if (found) return found; }
  return null;
}
function note(h, minute = 600) { h.rows.set(`${h.day}:${minute}`, { dateKey: h.day, minuteIndex: minute,
  text: `Note ${minute}`, categoryId: 'family', blockId: `note_${minute}` }); }

test('a longer hold moves an ordinary selected range across dates with immutable source/drop tokens and a pointer-transparent minute-note ghost', async (t) => {
  const pages = [];
  const h = screen(t, { props: { selectedDates: ['2026-10-25', '2026-10-26'], onPeriodSwipe: (direction) => pages.push(direction) } });
  note(h); note(h, 601); await h.start(); await h.tap(600); await h.selectThrough(602);
  const drag = await h.beginMove(600); assert.equal(drag.claimed, true);
  assert.equal(h.calls.filter((call) => call.action === 'move-range').length, 0, 'holding never clears a source');
  const ghost = visit(h.tree, (node) => node.props?.pointerEvents === 'none' &&
    [node.props.children].flat(Infinity).some((child) => child?.props?.children === 'Move selected cells'));
  assert.ok(ghost); assert.equal(ghost.props.style.at(-1).overflow, 'hidden');
  assert.ok(visit(ghost, (node) => typeof node.props?.children === 'string' && node.props.children.includes('Note 601')));
  const x = drag.x + 160, y = drag.y + 5 * drag.rowHeight;
  drag.responder.onPanResponderMove(touch(x, y), { dx: 160, dy: 5 * drag.rowHeight, numberActiveTouches: 1 });
  drag.responder.onPanResponderRelease(touch(x, y, 0), { dx: 160, dy: 5 * drag.rowHeight, numberActiveTouches: 0 });
  await h.settle();
  const prepares = h.calls.filter((call) => call.action === 'prepare-range-move');
  assert.deepEqual(plain(prepares[0].source), { dateKey: h.day, startMinute: 600, endMinute: 602 });
  assert.equal(prepares[1].sourceToken, 'move-source-preview');
  const moved = h.calls.find((call) => call.action === 'move-range'); assert.ok(moved);
  assert.deepEqual(plain(moved.destination), { dateKey: '2026-10-26', startMinute: 605 });
  assert.equal(moved.previewToken, 'move-drop-preview'); assert.deepEqual(pages, []);
  assert.equal(h.systemCopies, 0); assert.equal(h.systemReads, 0);
});

test('a one-cell move can be canceled by a second finger, navigation, or overwrite review without applying any cell action', async (t) => {
  for (const cancel of ['second-finger', 'navigation', 'overwrite']) {
    const h = screen(t, { moveOccupied: cancel === 'overwrite' ? 1 : 0, confirmReplace: false }); note(h); await h.start();
    const drag = await h.beginMove(600); assert.equal(drag.claimed, true);
    const y = drag.y + 3 * drag.rowHeight;
    if (cancel === 'second-finger') drag.responder.onPanResponderMove(touch(drag.x, y, 2), { dx: 0, dy: 3 * drag.rowHeight, numberActiveTouches: 2 });
    else if (cancel === 'navigation') await h.navigate('2026-10-26');
    else drag.responder.onPanResponderMove(touch(drag.x, y), { dx: 0, dy: 3 * drag.rowHeight, numberActiveTouches: 1 });
    drag.responder.onPanResponderRelease(touch(drag.x, y, 0), { dx: 0, dy: 3 * drag.rowHeight, numberActiveTouches: 0 });
    await h.settle(); assert.equal(h.calls.filter((call) => call.action === 'move-range' || call.action === 'move-group').length, 0);
    assert.equal(h.rows.get(`${h.day}:600`).text, 'Note 600');
  }
});

test('whole named-group hold retains its identity-preserving path and partial selected membership uses detached range move', async (t) => {
  for (const partial of [false, true]) {
    const group = { blockId: 'activity_coffee', dateKey: '2026-10-25', startMinute: 600, endMinute: 604, title: 'Coffee', categoryId: 'family' };
    const h = screen(t, { readGroups: async () => [group], readMovableGroup: async () => group });
    note(h); await h.start();
    if (partial) { await h.tap(601); await h.selectThrough(602); }
    const drag = await h.beginMove(partial ? 601 : 600); assert.equal(drag.claimed, true);
    const y = drag.y + 3 * drag.rowHeight;
    drag.responder.onPanResponderMove(touch(drag.x, y), { dx: 0, dy: 3 * drag.rowHeight, numberActiveTouches: 1 });
    drag.responder.onPanResponderRelease(touch(drag.x, y, 0), { dx: 0, dy: 3 * drag.rowHeight, numberActiveTouches: 0 });
    await h.settle();
    assert.equal(h.calls.filter((call) => call.action === (partial ? 'move-range' : 'move-group')).length, 1);
    assert.equal(h.calls.filter((call) => call.action === (partial ? 'move-group' : 'move-range')).length, 0);
  }
});

test('the bottom native editor retains partial text selection independently of whole-cell drag responders', async (t) => {
  const h = screen(t); note(h); await h.start(); await h.tap(600); await h.tap(600); assert.ok(h.input());
  assert.equal(h.input().onTouchStart, undefined); assert.equal(h.input().onTouchMove, undefined);
  h.input().onSelectionChange({ nativeEvent: { selection: { start: 0, end: 4 } } }); await h.settle();
  assert.equal(h.calls.some((call) => call.action.includes('move')), false); assert.ok(h.input());
});
