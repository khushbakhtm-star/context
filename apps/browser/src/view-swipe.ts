type ViewActions = {
  tap: () => void;
  hold: () => void;
  picker: () => void;
  toggle: () => void;
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

  function clearPreview() {
    delete button.dataset.swipe;
    button.style.removeProperty('--view-swipe-offset');
  }

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
      clearPreview();
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
    if (pointer.axis !== 'horizontal') return;
    const width = button.clientWidth;
    button.dataset.swipe = dx < 0 ? 'left' : 'right';
    button.style.setProperty('--view-swipe-offset', `${Math.max(-width, Math.min(width, dx))}px`);
  };

  function finish(event: PointerEvent, released: boolean) {
    if (pointer?.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (released) updateAxis(pointer, dx, dy);
    const gesture = pointer;
    pointer = undefined;
    clearTimeout(holdTimer);
    clearPreview();
    suppressPointerClick = !released || gesture.held || Boolean(gesture.axis);
    if (released && !gesture.held && gesture.axis === 'horizontal' &&
        Math.abs(dx) >= 24 && Math.abs(dx) > Math.abs(dy) * 1.7) actions.toggle();
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
    actions.toggle();
  };
}
