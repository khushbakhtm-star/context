export type BrowserView = 'calendar' | 'priority' | 'notepad';
const BROWSER_VIEWS = ['calendar', 'priority', 'notepad'] as const;

export function stepBrowserView(view: BrowserView, direction: -1 | 1): BrowserView {
  return BROWSER_VIEWS[(BROWSER_VIEWS.indexOf(view) + direction + BROWSER_VIEWS.length) % BROWSER_VIEWS.length]!;
}

type ViewActions = {
  tap: () => void;
  hold: () => void;
  picker: () => void;
  step: (direction: -1 | 1) => void;
};

type ViewPointer = {
  id: number;
  x: number;
  y: number;
  axis?: 'horizontal' | 'vertical';
  held: boolean;
};

export function bindViewSwipe(button: HTMLButtonElement, actions: ViewActions) {
  let pointer: ViewPointer | undefined;
  let tapTimer: ReturnType<typeof setTimeout> | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let suppressPointerClick = false;

  function updateAxis(gesture: ViewPointer, dx: number, dy: number) {
    if (gesture.axis || Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
    gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.7 ? 'horizontal' : 'vertical';
    clearTimeout(holdTimer);
    clearTimeout(tapTimer);
  }

  button.onpointerdown = (event) => {
    if (pointer && event.pointerId !== pointer.id) {
      pointer = undefined;
      clearTimeout(holdTimer);
      clearTimeout(tapTimer);
      suppressPointerClick = true;
      return;
    }
    if (!event.isPrimary || event.button !== 0 || pointer) return;
    suppressPointerClick = false;
    const gesture: ViewPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, held: false };
    pointer = gesture;
    button.setPointerCapture(event.pointerId);
    holdTimer = setTimeout(() => {
      gesture.held = true;
      clearTimeout(tapTimer);
      actions.hold();
    }, 550);
  };

  button.onpointermove = (event) => {
    if (pointer?.id !== event.pointerId || pointer.held) return;
    const dx = event.clientX - pointer.x;
    updateAxis(pointer, dx, event.clientY - pointer.y);
  };

  function finish(event: PointerEvent, released: boolean) {
    if (pointer?.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (released) updateAxis(pointer, dx, dy);
    const gesture = pointer;
    pointer = undefined;
    clearTimeout(holdTimer);
    suppressPointerClick = !released || gesture.held || Boolean(gesture.axis);
    if (released && !gesture.held && gesture.axis === 'horizontal' &&
        Math.abs(dx) >= 24 && Math.abs(dx) > Math.abs(dy) * 1.7) actions.step(dx < 0 ? 1 : -1);
  }

  button.onpointerup = (event) => finish(event, true);
  button.onpointercancel = button.onlostpointercapture = (event) => finish(event, false);

  button.onclick = (event) => {
    if (suppressPointerClick && event.detail > 0) return;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(actions.tap, 260);
  };
  button.ondblclick = () => {
    if (suppressPointerClick) return;
    clearTimeout(tapTimer);
    actions.picker();
  };
  button.onkeydown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    if (event.repeat) return;
    clearTimeout(tapTimer);
    actions.step(event.key === 'ArrowRight' ? 1 : -1);
  };
}

export function bindChecklistSwipe(scroller: HTMLElement, enabled: () => boolean, step: (direction: -1 | 1) => void) {
  let gesture: { id: number; x: number; y: number } | undefined;
  let lastSwipe = -Infinity;
  scroller.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary) { gesture = undefined; return; }
    lastSwipe = -Infinity;
    if (!enabled() || event.pointerType === 'mouse' ||
        (event.target as Element | null)?.closest('button, input, summary, .checklist-actions, textarea:focus')) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  scroller.addEventListener('pointercancel', () => { gesture = undefined; });
  scroller.addEventListener('pointerup', (event) => {
    if (gesture?.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    gesture = undefined;
    if (!enabled() || Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.7) return;
    lastSwipe = event.timeStamp;
    step(dx < 0 ? 1 : -1);
  });
  scroller.addEventListener('click', (event) => {
    if (event.detail > 0 && event.timeStamp - lastSwipe < 450) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, { capture: true });
  scroller.addEventListener('keydown', (event) => {
    if (!enabled() || event.target !== scroller || event.repeat ||
        (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    step(event.key === 'ArrowRight' ? 1 : -1);
  });
}
