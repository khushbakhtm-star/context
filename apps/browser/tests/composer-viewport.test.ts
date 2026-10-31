import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bindComposerViewport, composerFrame } from '../src/composer-viewport';

test('overlay keyboards lift the composer to the visible bottom without multiplying CSS coordinates by zoom', () => {
  assert.deepEqual(composerFrame(390, 844, { width: 390, height: 484, offsetTop: 0, offsetLeft: 0, scale: 1 }),
    { left: 0, top: 0, width: 390, height: 484, right: 0, bottom: 360, center: 195 });
  const zoomed = composerFrame(390, 844, { width: 195, height: 300, offsetTop: 120, offsetLeft: 95, scale: 2 });
  assert.equal(zoomed.bottom, 424); assert.equal(zoomed.left, 95); assert.equal(zoomed.right, 100);
  assert.equal(zoomed.center, 192.5);
});

test('layout-resizing keyboards do not get a second offset, and desktop/no API restores ordinary geometry', () => {
  assert.equal(composerFrame(390, 484, { width: 390, height: 484, offsetTop: 0, offsetLeft: 0 }).bottom, 0);
  assert.deepEqual(composerFrame(1280, 720), { left: 0, top: 0, width: 1280, height: 720, right: 0, bottom: 0, center: 640 });
  assert.equal(composerFrame(390, 844, { width: 0, height: 0, offsetTop: NaN, offsetLeft: 0 }).height, 844);
});

function fixture(withVisual = true) {
  const events = () => {
    const listeners = new Map<string, Set<() => void>>();
    return { listeners, addEventListener(name: string, callback: () => void) { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); },
      removeEventListener(name: string, callback: () => void) { listeners.get(name)?.delete(callback); },
      emit(name: string) { for (const callback of listeners.get(name) ?? []) callback(); } };
  };
  const style = new Map<string, string>(); const frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
  const visual = Object.assign(events(), { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 });
  const root = { clientWidth: 390, clientHeight: 844, style: { setProperty: (name: string, value: string) => style.set(name, value) } };
  const input = { value: 'Keep my latest raw words', selectionStart: 5, selectionEnd: 12,
    focus() { throw new Error('Geometry must not refocus'); }, blur() { throw new Error('Geometry must not blur'); } };
  const win = Object.assign(events(), { document: { documentElement: root, activeElement: input }, innerWidth: 390, innerHeight: 844,
    visualViewport: withVisual ? visual : null,
    requestAnimationFrame(callback: FrameRequestCallback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame(id: number) { frames.delete(id); } });
  const entry = { hidden: false, getBoundingClientRect: () => ({ height: 88 }) };
  const format = { hidden: true, getBoundingClientRect: () => ({ height: 60 }) };
  const main = { getBoundingClientRect: () => ({ top: 72 }) };
  let observerCallback: () => void = () => {}; let disconnected = false;
  class Observer { constructor(callback: () => void) { observerCallback = callback; } observe() {} disconnect() { disconnected = true; } }
  const controller = bindComposerViewport(win as unknown as Window, main as HTMLElement,
    [entry, format] as unknown as HTMLElement[], Observer as unknown as typeof ResizeObserver);
  const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(0); };
  return { win, visual, root, input, entry, format, style, frames, controller, flush,
    resizeBar: () => observerCallback(), disconnected: () => disconnected };
}

test('real viewport resize/scroll binding keeps textarea draft and partial selection while making room above the keyboard', () => {
  const h = fixture(); assert.equal(h.style.get('--context-main-height'), '684px');
  h.visual.height = 484; h.visual.emit('resize'); h.visual.emit('scroll');
  assert.equal(h.frames.size, 1, 'animation events coalesce into one measurement'); h.flush();
  assert.equal(h.style.get('--context-viewport-bottom'), '360px');
  assert.equal(h.style.get('--context-main-height'), '324px');
  h.visual.offsetTop = 90; h.visual.height = 394; h.visual.emit('scroll'); h.flush();
  assert.equal(h.style.get('--context-viewport-bottom'), '360px');
  assert.equal(h.input.value, 'Keep my latest raw words'); assert.equal(h.input.selectionStart, 5); assert.equal(h.input.selectionEnd, 12);
  h.visual.height = 844; h.visual.offsetTop = 0; h.visual.emit('resize'); h.flush();
  assert.equal(h.style.get('--context-viewport-bottom'), '0px');
  assert.equal(h.style.get('--context-main-height'), '684px'); h.controller.destroy();
});

test('entry/format/closed stages measure their actual heights and retain desktop fallback', () => {
  const h = fixture(false); h.entry.hidden = true; h.format.hidden = false; h.resizeBar(); h.flush();
  assert.equal(h.style.get('--context-main-height'), '712px');
  h.format.hidden = true; h.controller.refresh(); assert.equal(h.style.get('--context-main-height'), '772px');
  h.root.clientHeight = h.win.innerHeight = 600; h.win.emit('resize'); h.flush();
  assert.equal(h.style.get('--context-main-height'), '528px'); h.controller.destroy();
});

test('viewport cleanup cancels pending changes and detaches observers/listeners', () => {
  const h = fixture(); h.visual.height = 400; h.visual.emit('resize'); h.controller.destroy();
  h.flush(); h.visual.emit('scroll'); h.win.emit('resize'); h.resizeBar(); h.controller.refresh();
  assert.equal(h.frames.size, 0); assert.equal(h.style.get('--context-viewport-bottom'), '0px');
  assert.ok(h.disconnected());
  assert.ok([...h.visual.listeners.values()].every((set) => set.size === 0));
});

test('app and styles wire measured viewport geometry into the persistent bottom bars', () => {
  const app = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../app.css', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(app, /bindComposerViewport\(window, main, \[element\('entry-bar'\)\]\)/);
  assert.match(app, /function updateBars\(\)[\s\S]*?composerViewport\.refresh\(\)/);
  assert.match(css, /bottom:var\(--context-viewport-bottom,0px\)/);
  assert.match(css, /height:var\(--context-main-height/);
  assert.match(html, /interactive-widget=resizes-content/);
});
