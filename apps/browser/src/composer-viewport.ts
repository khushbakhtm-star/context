type VisibleViewport = { width: number; height: number; offsetLeft: number; offsetTop: number; scale?: number };

/** VisualViewport dimensions/offsets already use CSS pixels at the current
 * pinch scale. Multiplying by scale would displace the composer twice. */
export function composerFrame(layoutWidth: number, layoutHeight: number, visual?: VisibleViewport | null) {
  const width = Number.isFinite(layoutWidth) && layoutWidth > 0 ? layoutWidth : 1;
  const height = Number.isFinite(layoutHeight) && layoutHeight > 0 ? layoutHeight : 1;
  const valid = visual && [visual.width, visual.height, visual.offsetLeft, visual.offsetTop].every(Number.isFinite) &&
    visual.width > 0 && visual.height > 0;
  const left = valid ? Math.max(0, Math.min(width, visual.offsetLeft)) : 0;
  const top = valid ? Math.max(0, Math.min(height, visual.offsetTop)) : 0;
  const visibleWidth = valid ? Math.min(visual.width, width - left) : width;
  const visibleHeight = valid ? Math.min(visual.height, height - top) : height;
  return { left, top, width: visibleWidth, height: visibleHeight,
    right: Math.max(0, width - left - visibleWidth), bottom: Math.max(0, height - top - visibleHeight),
    center: left + visibleWidth / 2 };
}

/** Keep the existing textarea in place: resize/scroll events update geometry
 * only and never blur, refocus, rerender or alter the active draft/caret. */
export function bindComposerViewport(win: Window, main: HTMLElement, bars: readonly HTMLElement[],
  Observer: typeof ResizeObserver | undefined = typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver) {
  let disposed = false;
  let scheduled: number | null = null;
  const previous = new Map<string, string>();
  function refresh() {
    if (disposed) return;
    const root = win.document.documentElement;
    const frame = composerFrame(root.clientWidth || win.innerWidth, root.clientHeight || win.innerHeight, win.visualViewport);
    const barHeight = Math.max(0, ...bars.map((bar) => bar.hidden ? 0 : bar.getBoundingClientRect().height));
    const mainTop = main.getBoundingClientRect().top;
    const values = {
      '--context-viewport-bottom': frame.bottom,
      '--context-viewport-left': frame.left,
      '--context-viewport-right': frame.right,
      '--context-viewport-center': frame.center,
      '--context-viewport-width': frame.width,
      '--context-main-height': Math.max(0, frame.top + frame.height - mainTop - barHeight),
    };
    for (const [name, value] of Object.entries(values)) {
      const css = `${Math.round(value * 1000) / 1000}px`;
      if (previous.get(name) !== css) { root.style.setProperty(name, css); previous.set(name, css); }
    }
  }
  const schedule = () => {
    if (!disposed && scheduled === null) scheduled = win.requestAnimationFrame(() => { scheduled = null; refresh(); });
  };
  win.addEventListener('resize', schedule);
  win.addEventListener('orientationchange', schedule);
  win.addEventListener('pageshow', schedule);
  win.visualViewport?.addEventListener('resize', schedule);
  win.visualViewport?.addEventListener('scroll', schedule);
  const observer = Observer ? new Observer(schedule) : null;
  for (const bar of bars) observer?.observe(bar);
  refresh();
  return { refresh, destroy() {
    disposed = true;
    if (scheduled !== null) win.cancelAnimationFrame(scheduled);
    win.removeEventListener('resize', schedule);
    win.removeEventListener('orientationchange', schedule);
    win.removeEventListener('pageshow', schedule);
    win.visualViewport?.removeEventListener('resize', schedule);
    win.visualViewport?.removeEventListener('scroll', schedule);
    observer?.disconnect();
  } };
}
