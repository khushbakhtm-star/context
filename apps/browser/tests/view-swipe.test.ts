import test from 'node:test';
import assert from 'node:assert/strict';
import { bindChecklistSwipe, bindViewSwipe } from '../src/view-swipe';

function fixture() {
  const actions: string[] = [];
  const style = new Map<string, string>();
  const button = {
    clientWidth: 48,
    dataset: {},
    style: { setProperty: style.set.bind(style), removeProperty: style.delete.bind(style) },
    setPointerCapture() {},
  } as unknown as HTMLButtonElement;
  bindViewSwipe(button, {
    tap: () => actions.push('tap'),
    hold: () => actions.push('hold'),
    picker: () => actions.push('picker'),
    toggle: () => actions.push('toggle'),
  });
  const point = (clientX = 100, clientY = 30) => ({
    isPrimary: true, button: 0, pointerId: 1, clientX, clientY,
  } as PointerEvent);
  const click = { detail: 1 } as PointerEvent;
  return { actions, style, button, point, click };
}

test('a horizontal swipe keeps the current icon still until release and consumes the resulting click', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const direction of [-1, 1]) {
    const { actions, style, button, point, click } = fixture();
    button.onpointerdown!(point());
    button.onpointermove!(point(100 + direction * 14));
    assert.equal(button.dataset.swipe, undefined);
    assert.equal(style.size, 0);
    t.mock.timers.tick(600);
    assert.deepEqual(actions, []);
    button.onpointerup!(point(100 + direction * 30));
    button.onclick!(click);
    t.mock.timers.tick(600);
    assert.deepEqual(actions, ['toggle']);
    assert.equal(button.dataset.swipe, undefined);
    assert.equal(style.has('--view-swipe-offset'), false);
  }
});

test('short, vertical, cancelled and multi-pointer drags leave the view and picker alone', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { actions, style, button, point, click } = fixture();
  for (const [x, y, cancel] of [[116, 30, false], [104, 70, false], [145, 30, true]] as const) {
    button.onpointerdown!(point());
    button.onpointermove!(point(x, y));
    const release = cancel ? button.onpointercancel! : button.onpointerup!;
    release.call(button, point(x, y));
    button.onclick!(click);
    t.mock.timers.tick(600);
    assert.equal(button.dataset.swipe, undefined);
    assert.equal(style.size, 0);
    assert.deepEqual(actions, []);
  }
  button.onpointerdown!(point());
  button.onpointermove!(point(114));
  button.onpointerdown!({ ...point(114), isPrimary: false, pointerId: 2 });
  button.onpointerup!(point(145));
  button.onclick!(click);
  t.mock.timers.tick(600);
  assert.equal(style.size, 0);
  assert.deepEqual(actions, []);
});

test('tap, double-click, and hold still dispatch their existing actions', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { actions, button, point, click } = fixture();
  const tap = () => { button.onpointerdown!(point()); button.onpointerup!(point()); button.onclick!(click); };
  tap();
  t.mock.timers.tick(260);
  tap();
  tap();
  button.ondblclick!(click);
  t.mock.timers.tick(260);
  button.onpointerdown!(point());
  t.mock.timers.tick(550);
  button.onpointerup!(point());
  button.onclick!(click);
  t.mock.timers.tick(260);
  assert.deepEqual(actions, ['tap', 'picker', 'hold']);
});

test('checklist navigation accepts horizontal touch and keyboard without capturing vertical scrolls or text editing', () => {
  const listeners = new Map<string, (event: any) => void>();
  const scroller = { addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener) } as unknown as HTMLElement;
  const steps: number[] = [];
  let enabled = true;
  bindChecklistSwipe(scroller, () => enabled, (direction) => steps.push(direction));
  const gesture = (x: number, y: number, editing = false) => {
    const target = { closest: () => editing };
    const event = { isPrimary: true, pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 30, target };
    listeners.get('pointerdown')!(event);
    listeners.get('pointerup')!({ ...event, clientX: x, clientY: y, timeStamp: 100 });
  };
  gesture(42, 34);
  gesture(160, 26);
  gesture(90, 100);
  gesture(160, 26, true);
  listeners.get('keydown')!({ key: 'ArrowRight', target: scroller, preventDefault() {} });
  enabled = false;
  gesture(42, 34);
  assert.deepEqual(steps, [1, -1, 1]);
});
