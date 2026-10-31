import test from 'node:test';
import assert from 'node:assert/strict';
import { bindMouseSelection, edgeScrollVelocity, type GridPoint, type GridSelection } from '../src/mouse-selection';

function fixture() {
  const hub = () => {
    const listeners = new Map<string, Set<(event: any) => void>>();
    return { listeners, addEventListener(name: string, callback: (event: any) => void) { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); },
      removeEventListener(name: string, callback: (event: any) => void) { listeners.get(name)?.delete(callback); },
      emit(name: string, event: any = {}) { for (const callback of listeners.get(name) ?? []) callback(event); } };
  };
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0; const captures = new Set<number>();
  const win = Object.assign(hub(), { requestAnimationFrame(callback: FrameRequestCallback) { frames.set(++sequence, callback); return sequence; }, cancelAnimationFrame(id: number) { frames.delete(id); } });
  const doc = Object.assign(hub(), { defaultView: win });
  const surface = Object.assign(hub(), { ownerDocument: doc, setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id) });
  const scroller = Object.assign(hub(), { scrollTop: 0, scrollHeight: 2000, clientHeight: 200 });
  let enabled = true, moving = false; let selection: GridSelection = { anchor: { day: '2026-10-30', minute: 2 }, end: null };
  let selections = 0, starts = 0, restores = 0, scrolls = 0, cancels = 0;
  const completions: number[][] = [], moved: GridPoint[] = [], drops: { point: GridPoint; copy: boolean }[] = [];
  const options = { enabled: () => enabled, readSelection: () => selection,
    select(point: GridPoint, extend: boolean) { selections++; selection = extend ? { ...selection, end: { ...point } } : { anchor: { ...point }, end: null }; },
    restore(value: GridSelection) { restores++; selection = value; },
    pointFromTarget: (target: any) => target?.point ?? null,
    pointAt: (x: number, y: number) => ({ day: x < 100 ? '2026-10-30' : '2026-10-31', minute: Math.max(0, Math.floor((scroller.scrollTop + Math.max(0, Math.min(199, y))) / 10)) }),
    viewport: () => ({ top: 0, bottom: 200, left: 0, right: 200 }),
    onStart: () => { starts++; }, onAutoScroll: () => { scrolls++; }, onComplete: (x: number, y: number) => completions.push([x, y]),
    moveFromTarget: () => moving, onMoveStart: () => true, onMove: (point: GridPoint) => moved.push(point),
    onMoveComplete: (point: GridPoint, copy: boolean) => drops.push({ point, copy }), onCancel: () => { cancels++; } };
  const controller = bindMouseSelection(surface as unknown as HTMLElement, scroller as unknown as HTMLElement, options);
  const event = (overrides: Record<string, any> = {}) => ({ target: { point: { day: '2026-10-30', minute: 2 } }, pointerId: 1, button: 0, buttons: 1, isPrimary: true,
    pointerType: 'mouse', clientX: 50, clientY: 25, shiftKey: false, altKey: false, preventDefault() {}, ...overrides });
  return { win, doc, surface, scroller, frames, captures, controller, options, event, completions, moved, drops,
    down: (overrides = {}) => surface.emit('pointerdown', event(overrides)),
    move: (overrides = {}) => doc.emit('pointermove', event(overrides)), up: (overrides = {}) => doc.emit('pointerup', event(overrides)),
    flush(time = 16) { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(time)); },
    set enabled(value: boolean) { enabled = value; }, set moving(value: boolean) { moving = value; },
    get selection() { return selection; }, get selections() { return selections; }, get starts() { return starts; }, get restores() { return restores; }, get scrolls() { return scrolls; }, get cancels() { return cancels; } };
}

test('an ordinary desktop click selects without capture or a range menu, leaving native click editing available', () => {
  const h = fixture(); h.down(); h.up(); assert.equal(h.selections, 1); assert.equal(h.starts, 1);
  assert.equal(h.captures.size, 0); assert.equal(h.completions.length, 0); assert.equal(h.controller.suppressesClick(), false); h.controller.destroy();
});
test('a real drag captures the stable grid and completes a rectangle across days once', () => {
  const h = fixture(); h.down(); h.move({ clientX: 150, clientY: 65 }); assert.ok(h.captures.has(1));
  h.up({ clientX: 150, clientY: 65 }); assert.deepEqual(h.selection.end, { day: '2026-10-31', minute: 6 });
  assert.deepEqual(h.completions, [[150, 65]]); assert.equal(h.captures.size, 0); assert.equal(h.controller.suppressesClick(), true);
  h.up(); assert.equal(h.completions.length, 1); h.controller.destroy();
});
test('Shift-click preserves the original anchor and opens the same range actions without a long hold', () => {
  const h = fixture(); h.down({ target: { point: { day: '2026-10-31', minute: 1 } }, shiftKey: true, clientX: 150, clientY: 15 });
  h.up({ shiftKey: true, clientX: 150, clientY: 15 });
  assert.deepEqual(h.selection.anchor, { day: '2026-10-30', minute: 2 }); assert.deepEqual(h.selection.end, { day: '2026-10-31', minute: 1 });
  assert.equal(h.completions.length, 1); assert.equal(h.controller.suppressesClick(), true); h.controller.destroy();
});
test('stationary edge dragging scrolls and extends through virtualized cells, then stops when released', () => {
  const h = fixture(); h.down(); h.move({ clientY: 240 }); assert.equal(h.frames.size, 1); h.flush();
  assert.ok(h.scroller.scrollTop > 0); assert.ok(h.scrolls > 0); assert.ok(h.selection.end!.minute > 19);
  h.up({ clientY: 240 }); assert.equal(h.frames.size, 0); const offset = h.scroller.scrollTop; h.flush(); assert.equal(h.scroller.scrollTop, offset); h.controller.destroy();
});
test('Escape, pointer cancellation and focus loss restore the pre-drag selection without actions', () => {
  for (const reason of ['escape', 'cancel', 'blur']) { const h = fixture(); h.down(); h.move({ clientY: 90 });
    if (reason === 'escape') h.doc.emit('keydown', { key: 'Escape', preventDefault() {} });
    else if (reason === 'cancel') h.doc.emit('pointercancel', h.event()); else h.win.emit('blur');
    assert.deepEqual(h.selection, { anchor: { day: '2026-10-30', minute: 2 }, end: null });
    assert.equal(h.restores, 1); assert.equal(h.completions.length, 0); assert.equal(h.captures.size, 0); assert.equal(h.frames.size, 0); h.controller.destroy(); }
});
test('touch, secondary pointers, right clicks and non-cell targets do not invoke desktop selection', () => {
  const h = fixture(); for (const overrides of [{ pointerType: 'touch' }, { isPrimary: false }, { button: 2 }, { target: {} }]) h.down(overrides);
  assert.equal(h.starts, 0); assert.equal(h.selections, 0); h.controller.destroy();
});
test('account or command state changes cancel stale drags without restoring over the new state', () => {
  const h = fixture(); h.down(); h.move({ clientY: 90 }); h.enabled = false; h.up({ clientY: 90 });
  assert.equal(h.completions.length, 0); assert.equal(h.restores, 0); assert.equal(h.captures.size, 0); h.controller.destroy();
});
test('a selected-border move preserves selection, tracks the drop and Alt-copy, and never opens selection actions', () => {
  const h = fixture(); h.moving = true; h.down(); h.move({ clientX: 150, clientY: 85, altKey: true }); h.up({ clientX: 150, clientY: 85, altKey: true });
  assert.equal(h.selections, 0); assert.deepEqual(h.moved, [{ day: '2026-10-31', minute: 8 }]);
  assert.deepEqual(h.drops, [{ point: { day: '2026-10-31', minute: 8 }, copy: true }]); assert.equal(h.completions.length, 0); h.controller.destroy();
});
test('moving cancellation never drops cells and cleanup detaches every global listener', () => {
  const h = fixture(); h.moving = true; h.down(); h.move({ clientY: 240 }); h.controller.destroy();
  assert.equal(h.drops.length, 0); assert.equal(h.cancels, 1); assert.equal(h.frames.size, 0);
  for (const target of [h.win, h.doc, h.surface, h.scroller]) assert.ok([...target.listeners.values()].every((set) => set.size === 0));
});
test('releasing Alt before pointerup moves even if no extra pointermove follows the key release', () => {
  const h = fixture(); h.moving = true; h.down(); h.move({ clientY: 85, altKey: true }); h.up({ clientY: 85, altKey: false });
  assert.equal(h.drops.length, 1); assert.equal(h.drops[0]!.copy, false); h.controller.destroy();
});
test('edge speed is bounded, reverses direction and does not scroll in the middle or invalid viewports', () => {
  assert.equal(edgeScrollVelocity(100, 0, 200), 0); assert.ok(edgeScrollVelocity(5, 0, 200) < 0); assert.ok(edgeScrollVelocity(195, 0, 200) > 0);
  assert.equal(edgeScrollVelocity(-10000, 0, 200), -3.5); assert.equal(edgeScrollVelocity(10000, 0, 200), 3.5);
  assert.equal(edgeScrollVelocity(NaN, 0, 200), 0); assert.equal(edgeScrollVelocity(0, 200, 0), 0);
});
