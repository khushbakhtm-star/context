import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { bindMouseSelection } from '../src/mouse-selection';

const day = '2026-11-02';
function fixture() {
  const hub = () => { const listeners = new Map<string, Set<(event: any) => void>>(); return {
    addEventListener(name: string, callback: (event: any) => void) { const callbacks = listeners.get(name) ?? new Set(); callbacks.add(callback); listeners.set(name, callbacks); },
    removeEventListener(name: string, callback: (event: any) => void) { listeners.get(name)?.delete(callback); },
    emit(name: string, event: any) { for (const callback of listeners.get(name) ?? []) callback(event); },
  }; };
  const win = { ...hub(), requestAnimationFrame: () => 1, cancelAnimationFrame() {} }; const doc = { ...hub(), defaultView: win, querySelector: () => null };
  class Cell {
    dataset: Record<string, string>; style: Record<string, string> = { backgroundColor: '#0B8043', color: '#FFFFFF' }; attrs: Record<string, string> = {}; classes = new Set(['cell']);
    classList = { contains: (value: string) => this.classes.has(value), add: (...values: string[]) => values.forEach((value) => this.classes.add(value)), remove: (...values: string[]) => values.forEach((value) => this.classes.delete(value)), toggle: (value: string, force: boolean) => force ? this.classes.add(value) : this.classes.delete(value) };
    constructor(minute: number) { this.dataset = { day, minute: String(minute) }; }
    closest(selector: string) { return selector === '.cell.selected' && !this.classes.has('selected') ? null : this; }
    setAttribute(name: string, value: string) { this.attrs[name] = value; }
    focus() {}
    getBoundingClientRect() { return { top: 50 + Number(this.dataset.minute) * 32, bottom: 82 + Number(this.dataset.minute) * 32, left: 51, right: 400, width: 349, height: 32 }; }
  }
  const cells = [new Cell(0), new Cell(1), new Cell(2), new Cell(3)]; const captures = new Set<number>();
  const grid = { ...hub(), ownerDocument: doc, querySelectorAll: () => cells, querySelector: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400 }), classList: { add() {}, remove() {} },
    setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id),
  };
  const main = { ...hub(), scrollTop: 0, scrollHeight: 3000, clientHeight: 250, getBoundingClientRect: () => ({ left: 0, right: 400, top: 0, bottom: 250 }) };
  const timers = new Map<number, () => void>(); let timer = 0; const menu = { hidden: true }; const entries: any[] = [], actions: any[] = [], moves: any[] = [];
  const input = { value: 'Saved cell note', blur() {} }; const context: any = {
    grid, main, document: doc, Element: Cell, editor: null, entryInput: input, entryBarMode: null, commandBusy: false, checklistVisible: false, notepadVisible: false, store: { state: { documents: [] } },
    selected: { day, minute: 0 }, rangeEnd: null, selectionActivated: false, selectedTapTimer: undefined, cellMenuRequest: 0,
    movePreview: [], moveDraft: null, clock12: false,
    bindMouseSelection, dates: () => [day], minuteKey: (date: string, minute: number) => `minute:${date}:${minute}`,
    element: () => menu, cell: (_date: string, minute: number) => cells[minute], updateBars() {}, report(error: Error) { throw error; },
    beginEdit(date: string, minute: number) { entries.push({ date, minute }); context.editor = { input, original: input.value, saving: null }; context.entryBarMode = 'entry'; },
    async showCellMenu(x: number, y: number) {
      actions.push([x, y]); context.beginEdit(context.selected.day, context.selected.minute); menu.hidden = false;
    },
    setTimeout(callback: () => void) { timers.set(++timer, callback); return timer; }, clearTimeout(id: number) { timers.delete(id); },
    selectionCells() { const end = context.rangeEnd ?? context.selected; return Array.from({ length: Math.abs(end.minute - context.selected.minute) + 1 }, (_, i) => ({ day, minute: Math.min(end.minute, context.selected.minute) + i })); },
    selectionStamp: () => JSON.stringify([context.selected, context.rangeEnd]), cellTransferFingerprint: () => 'unchanged_fingerprint', previewMove() {}, completeMove(point: any, copy: boolean) { moves.push({ point, copy }); return Promise.resolve(); },
  };
  const source = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8'); const parsed = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions = ['select', 'paintSelection', 'selectedRegion', 'cancelSelectedTap', 'tapCalendarCell',
    'closeCellMenu', 'closeCleanEditor', 'cellMenuDraftPending', 'clearMovePreview'];
  const nodes = parsed.statements.filter((node: any) => functions.includes(node.name?.text) || ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(parsed) === 'mouseSelection'));
  vm.runInNewContext(ts.transpileModule(nodes.map((node) => node.getText(parsed)).join('\n') + '\nthis.controller = mouseSelection;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const pointer = (minute: number, overrides: Record<string, any> = {}) => ({ target: cells[minute], pointerId: 1, button: 0, buttons: 1, isPrimary: true, pointerType: 'mouse', clientX: 100, clientY: 66 + minute * 32, shiftKey: false, altKey: false, preventDefault() {}, ...overrides });
  return { cells, context, entries, actions, moves, menu, timers, controller: context.controller,
    down: (minute: number, options = {}) => grid.emit('pointerdown', pointer(minute, options)), move: (minute: number, options = {}) => doc.emit('pointermove', pointer(minute, options)), up: (minute: number, options = {}) => doc.emit('pointerup', pointer(minute, options)),
    finishTimers() { for (const callback of [...timers.values()]) callback(); timers.clear(); } };
}

test('the actual calendar binding first selects with bottom entry, then a quick selected-cell tap requests both surfaces', () => {
  const h = fixture(); h.down(0); h.up(0); h.finishTimers(); assert.equal(h.entries.length, 1); assert.equal(h.context.entryBarMode, 'entry'); assert.equal(h.actions.length, 0);
  h.down(0); h.up(0); h.finishTimers(); assert.equal(h.actions.length, 1); assert.equal(h.context.entryBarMode, 'entry'); assert.equal(h.moves.length, 0); h.controller.destroy();
});

test('range selection release stays unobstructed, and a later tap inside the selection opens actions without collapsing it', () => {
  const h = fixture(); h.down(0); h.move(2); h.up(2); h.finishTimers(); assert.equal(h.actions.length, 0); assert.equal(h.context.rangeEnd.minute, 2); assert.equal(h.entries.length, 0);
  h.down(1); h.up(1); h.finishTimers(); assert.equal(h.actions.length, 1); assert.equal(h.context.selected.minute, 0); assert.equal(h.context.rangeEnd.minute, 2);
  assert.equal(h.entries.at(-1).minute, 0); h.controller.destroy();
});

test('finishing a range drag leaves an existing unsaved composer visible', () => {
  const h = fixture(); h.down(0); h.up(0);
  h.context.entryInput.value = 'A note still in progress';
  h.down(0); h.move(2); h.up(2); h.finishTimers();
  assert.equal(h.context.entryBarMode, 'entry');
  assert.equal(h.context.editor.input.value, 'A note still in progress');
  assert.equal(h.context.rangeEnd.minute, 2);
  assert.equal(h.actions.length, 0);
  h.controller.destroy();
});

test('a short drag from the selected cell body moves it without showing the menu or waiting for a long hold', () => {
  for (const pointerType of ['mouse', 'touch']) {
    const h = fixture(); h.down(0, { pointerType }); h.up(0, { pointerType }); h.finishTimers(); h.down(0, { pointerType }); h.move(2, { pointerType }); h.up(2, { pointerType }); h.finishTimers();
    assert.equal(h.actions.length, 0); assert.equal(h.moves.length, 1); assert.equal(h.moves[0]!.point.minute, 2); h.controller.destroy();
  }
});

test('selecting and dragging a colored cell never replaces its actual fill with a selection or neutral note color', () => {
  const h = fixture(); const styles = h.cells.map((cell) => ({ ...cell.style })); h.down(0); h.up(0); h.down(0); h.move(2); h.up(2); h.finishTimers();
  assert.deepEqual(h.cells.map((cell) => cell.style), styles); assert.ok(h.cells[0]!.classes.has('selected')); assert.equal(h.cells[0]!.style.backgroundColor, '#0B8043'); h.controller.destroy();
});

test('canceling the first untouched gesture restores its inactive selection and leaves the next tap as ordinary entry', () => {
  const h = fixture(); h.down(0); h.move(2); h.controller.cancel(); assert.equal(h.context.selectionActivated, false);
  h.down(0); h.up(0); h.finishTimers(); assert.equal(h.entries.length, 1); assert.equal(h.actions.length, 0); h.controller.destroy();
});
