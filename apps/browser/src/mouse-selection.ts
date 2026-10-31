export type GridPoint = { day: string; minute: number };
export type GridSelection = { anchor: GridPoint; end: GridPoint | null };
export type SelectionViewport = { top: number; bottom: number; left: number; right: number };
type MouseSelectionOptions = {
  enabled(): boolean;
  readSelection(): GridSelection;
  select(point: GridPoint, extend: boolean): void;
  restore(selection: GridSelection): void;
  pointFromTarget(target: EventTarget | null): GridPoint | null;
  pointAt(x: number, y: number): GridPoint | null;
  viewport(): SelectionViewport;
  onStart?(): void;
  moveFromTarget?(target: EventTarget | null, x: number, y: number): boolean;
  onMoveStart?(point: GridPoint): boolean;
  onMove?(point: GridPoint): void;
  onMoveComplete?(point: GridPoint, copy: boolean): void;
  onCancel?(): void;
  onAutoScroll?(): void;
  onComplete(x: number, y: number): void;
};

const same = (left: GridPoint, right: GridPoint) => left.day === right.day && left.minute === right.minute;
const copy = (selection: GridSelection): GridSelection => ({ anchor: { ...selection.anchor }, end: selection.end ? { ...selection.end } : null });

/** Pixels per millisecond. Leaving the edge accelerates a long selection without a jump. */
export function edgeScrollVelocity(y: number, top: number, bottom: number): number {
  if (!Number.isFinite(y) || bottom <= top) return 0;
  const edge = Math.min(36, (bottom - top) / 3);
  if (y < top + edge) return -Math.min(2.5, (top + edge - y) / edge) * 1.4;
  if (y > bottom - edge) return Math.min(2.5, (y - bottom + edge) / edge) * 1.4;
  return 0;
}

/** Capture a real desktop drag on a stable surface, not on virtualized minute cells. */
export function bindMouseSelection(surface: HTMLElement, scroller: HTMLElement, options: MouseSelectionOptions) {
  const doc = surface.ownerDocument;
  const win = doc.defaultView;
  if (!win) throw new Error('The calendar view is unavailable.');
  type Gesture = { id: number; x: number; y: number; startX: number; startY: number;
    point: GridPoint; initial: GridSelection; moved: boolean; extended: boolean; captured: boolean; frameTime: number | null;
    mode: 'select' | 'move' };
  let gesture: Gesture | null = null;
  let frame: number | null = null;
  let suppressClick = false;

  function stopFrame() { if (frame !== null) win!.cancelAnimationFrame(frame); frame = null; }
  function release(current: Gesture) {
    try { if (current.captured && surface.hasPointerCapture(current.id)) surface.releasePointerCapture(current.id); } catch { /* The browser may already have released it. */ }
  }
  function cancel(restore = true) {
    const current = gesture; gesture = null; stopFrame();
    if (!current) return;
    suppressClick = current.moved || current.extended;
    release(current);
    if (restore && options.enabled()) options.restore(copy(current.initial));
    options.onCancel?.();
  }
  function capture(current: Gesture) {
    if (current.captured) return;
    try { surface.setPointerCapture(current.id); current.captured = true; } catch { /* Document listeners still finish a drag if capture is unavailable. */ }
  }
  function updatePoint(current: Gesture) {
    const point = options.pointAt(current.x, current.y);
    const beyondThreshold = Math.hypot(current.x - current.startX, current.y - current.startY) >= 4;
    if (!current.moved && !beyondThreshold && (!point || same(point, current.point))) return;
    current.moved = true; suppressClick = true; capture(current);
    if (point && !same(point, current.point)) {
      current.point = { ...point };
      if (current.mode === 'move') options.onMove?.(point); else options.select(point, true);
    }
  }
  function requestFrame() { if (frame === null && gesture?.moved) frame = win!.requestAnimationFrame(scrollFrame); }
  function scrollFrame(time: number) {
    frame = null;
    const current = gesture;
    if (!current) return;
    if (!options.enabled()) { cancel(false); return; }
    const viewport = options.viewport();
    const velocity = edgeScrollVelocity(current.y, viewport.top, viewport.bottom);
    const elapsed = current.frameTime === null ? 16 : Math.max(1, Math.min(32, time - current.frameTime)); current.frameTime = time;
    if (!velocity) return;
    const before = scroller.scrollTop;
    const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.max(0, Math.min(maximum, before + velocity * elapsed));
    if (scroller.scrollTop === before) return;
    options.onAutoScroll?.(); updatePoint(current); requestFrame();
  }
  function down(event: PointerEvent) {
    if (gesture || !options.enabled() || event.button !== 0 || event.pointerType === 'touch' || event.isPrimary === false) return;
    const point = options.pointFromTarget(event.target);
    if (!point) return;
    suppressClick = false;
    const initial = copy(options.readSelection());
    options.onStart?.();
    const moving = !event.shiftKey && options.moveFromTarget?.(event.target, event.clientX, event.clientY) && options.onMoveStart?.(point);
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
      point: { ...point }, initial, moved: false, extended: event.shiftKey && !same(initial.anchor, point), captured: false, frameTime: null,
      mode: moving ? 'move' : 'select' };
    if (!moving) options.select(point, event.shiftKey);
  }
  function move(event: PointerEvent) {
    const current = gesture;
    if (!current || event.pointerId !== current.id) return;
    if (!options.enabled()) { cancel(false); return; }
    if ((event.buttons & 1) === 0) { cancel(); return; }
    current.x = event.clientX; current.y = event.clientY;
    updatePoint(current); if (current.moved) event.preventDefault(); requestFrame();
  }
  function up(event: PointerEvent) {
    const current = gesture;
    if (!current || event.pointerId !== current.id) return;
    if (!options.enabled()) { cancel(false); return; }
    current.x = event.clientX; current.y = event.clientY;
    updatePoint(current);
    gesture = null; stopFrame(); release(current);
    if (current.mode === 'move') {
      if (current.moved) { suppressClick = true; options.onMoveComplete?.(current.point, event.altKey); }
      else options.onCancel?.();
      return;
    }
    const selected = options.readSelection();
    if ((current.moved || current.extended) && selected.end && !same(selected.anchor, selected.end)) {
      suppressClick = true; options.onComplete(current.x, current.y);
    }
  }
  function lost(event: PointerEvent) { if (gesture?.id === event.pointerId) cancel(); }
  function escape(event: KeyboardEvent) { if (gesture && event.key === 'Escape') { event.preventDefault(); cancel(); } }
  function scroll() { if (gesture?.moved && options.enabled()) { updatePoint(gesture); requestFrame(); } }
  const blur = () => cancel();
  surface.addEventListener('pointerdown', down);
  surface.addEventListener('lostpointercapture', lost);
  doc.addEventListener('pointermove', move, { passive: false });
  doc.addEventListener('pointerup', up);
  doc.addEventListener('pointercancel', lost);
  doc.addEventListener('keydown', escape);
  scroller.addEventListener('scroll', scroll, { passive: true });
  win.addEventListener('blur', blur);
  return {
    cancel,
    suppressesClick: () => suppressClick,
    destroy() {
      cancel(); surface.removeEventListener('pointerdown', down); surface.removeEventListener('lostpointercapture', lost);
      doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up);
      doc.removeEventListener('pointercancel', lost); doc.removeEventListener('keydown', escape);
      scroller.removeEventListener('scroll', scroll); win.removeEventListener('blur', blur);
    },
  };
}
