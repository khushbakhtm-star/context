export type HistoryDirection = 'undo' | 'redo';

export function bindHistorySwipe(control: HTMLElement, run: (direction: HistoryDirection) => void) {
  const document = control.ownerDocument;
  let pointer: { id: number; x: number; y: number } | undefined;
  let suppressClick = false;
  control.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary) { pointer = undefined; suppressClick = true; return; }
    if (event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    suppressClick = false;
  });
  document.addEventListener('pointermove', (event) => {
    if (pointer?.id !== event.pointerId || suppressClick) return;
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= 8) suppressClick = true;
  });
  document.addEventListener('pointercancel', (event) => {
    if (pointer?.id === event.pointerId) { pointer = undefined; suppressClick = true; }
  });
  document.defaultView?.addEventListener('blur', () => { pointer = undefined; suppressClick = true; });
  document.addEventListener('pointerup', (event) => {
    if (pointer?.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    pointer = undefined;
    if (Math.hypot(dx, dy) >= 8) suppressClick = true;
    if (Math.abs(dx) < 24 || Math.abs(dx) < Math.abs(dy) * 1.7) return;
    run(dx < 0 ? 'undo' : 'redo');
  });
  control.addEventListener('click', (event) => {
    if (suppressClick && event.detail > 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { capture: true });
  control.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    if (!event.repeat) run(event.key === 'ArrowLeft' ? 'undo' : 'redo');
  });
}
