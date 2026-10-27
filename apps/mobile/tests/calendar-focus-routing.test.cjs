const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const appFile = path.join(__dirname, '../App.tsx');
const app = ts.createSourceFile(appFile, fs.readFileSync(appFile, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const controller = app.statements.find((node) => node.name?.text === 'AppController');
const emit = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('actual App view changes retain yesterday at 08:50 after the draft-safe transition, including explicit month targets', async () => {
  const fn = controller.body.statements.find((node) => node.name?.text === 'changeViewMode'); assert.ok(fn);
  for (const mode of ['day', 'week', 'month', 'year', 'schedule']) {
    const values = {}; let release; const gate = new Promise((resolve) => release = resolve);
    const module = { exports: {} }; const point = { current: { dateKey: '2026-10-24', minuteIndex: 530 } };
    vm.runInNewContext(emit(fn.getText(app) + '\nexport { changeViewMode };'), { module, exports: module.exports,
      calendarFocusRef: point, activeDate: '2026-10-25', focusSequence: { current: 8 }, viewWrites: { current: Promise.resolve() },
      transitionFromCalendar: async (change) => { await gate; return change(); },
      setViewMode: (value) => values.mode = value, setActiveDate: (value) => values.date = value,
      setDayCount() {}, setSelectedDateKeys() {}, setOverviewMonth() {}, setCalendarViewResetToken() {},
      changeCalendarZoom() {}, setTab() {}, setSetting: async () => {}, setFocusRequest: (value) => values.focus = value,
    });
    const pending = module.exports.changeViewMode(mode); assert.deepEqual(values, {});
    release(); await pending;
    assert.equal(values.date, '2026-10-24'); assert.equal(values.mode, mode);
    assert.deepEqual(plain(values.focus), { dateKey: '2026-10-24', minuteIndex: 530, token: 9, openEditor: false });
    await module.exports.changeViewMode('month', '2026-11-01');
    assert.equal(values.date, '2026-11-01'); assert.equal(values.focus.minuteIndex, 530);
  }
});

test('old-view and invalid coordinate reports cannot replace the active focused minute', () => {
  const statement = controller.body.statements.find((node) => node.declarationList?.declarations.some((value) => value.name?.text === 'reportFocusedMinute'));
  assert.ok(statement); const module = { exports: {} }; const focus = { current: { dateKey: '2026-10-24', minuteIndex: 530 } };
  const scope = { current: 'day|2026-10-24' };
  vm.runInNewContext(emit(statement.getText(app) + '\nexport { reportFocusedMinute };'), { module, exports: module.exports,
    calendarFocusScope: scope.current, calendarFocusScopeRef: scope, calendarFocusRef: focus,
    useMemo: (work) => work(), isDateKey: (value) => /^2026-10-\d\d$/.test(value) });
  module.exports.reportFocusedMinute({ dateKey: '2026-10-24', minuteIndex: 600 }); assert.equal(focus.current.minuteIndex, 600);
  module.exports.reportFocusedMinute({ dateKey: 'bad', minuteIndex: 10 });
  module.exports.reportFocusedMinute({ dateKey: '2026-10-24', minuteIndex: 1440 }); assert.equal(focus.current.minuteIndex, 600);
  scope.current = 'schedule|2026-10-24';
  module.exports.reportFocusedMinute({ dateKey: '2026-10-25', minuteIndex: 0 }); assert.equal(focus.current.minuteIndex, 600);
});

test('actual Today reports selected and manually scrolled minutes without treating programmatic scrolls or keyboard editing as navigation', async (t) => {
  const harness = fs.readFileSync(path.join(__dirname, 'today-cell-actions.test.cjs'), 'utf8'); const fixture = { exports: {} };
  vm.runInNewContext(harness.slice(0, harness.indexOf('\nfunction plan(')) + '\nmodule.exports = screen;',
    { module: fixture, exports: fixture.exports, require, __dirname, console });
  const points = []; const h = fixture.exports(t, { props: { activeDate: '2026-10-24', onFocusedMinuteChange: (point) => points.push(plain(point)) } });
  await h.start(); await h.tap(530); assert.deepEqual(points.at(-1), { dateKey: '2026-10-24', minuteIndex: 530 });
  const find = (node) => { if (!node || typeof node !== 'object') return null; if (node.type === 'FlatList') return node;
    return [node.props?.children].flat(Infinity).map(find).find(Boolean); };
  let list = find(h.tree).props; const row = list.getItemLayout(null, 1).length;
  const before = points.length; list.onScroll({ nativeEvent: { contentOffset: { y: row * 700 } } }); assert.equal(points.length, before);
  list.onScrollBeginDrag(); list.onScroll({ nativeEvent: { contentOffset: { y: row * 531 } } }); list.onScrollEndDrag();
  assert.deepEqual(points.at(-1), { dateKey: '2026-10-24', minuteIndex: 531 });
  await h.tap(530); await h.tap(530); const count = points.length; list = find(h.tree).props;
  list.onScrollBeginDrag(); list.onScroll({ nativeEvent: { contentOffset: { y: row * 800 } } }); list.onScrollEndDrag();
  assert.equal(points.length, count, 'typing remains bound to its selected dated draft');
});


test('returning from a secondary screen restores the same focused point without changing its view or zoom', () => {
  const fn = controller.body.statements.find((node) => node.name?.text === 'returnToCalendar'); assert.ok(fn);
  const module = { exports: {} }; const values = {};
  vm.runInNewContext(emit(fn.getText(app) + '\nexport { returnToCalendar };'), { module, exports: module.exports,
    calendarFocusRef: { current: { dateKey: '2026-10-24', minuteIndex: 530 } }, focusSequence: { current: 12 },
    setFocusRequest: (value) => values.focus = value, setTab: (value) => values.tab = value });
  module.exports.returnToCalendar(); assert.equal(values.tab, 'today');
  assert.deepEqual(plain(values.focus), { dateKey: '2026-10-24', minuteIndex: 530, token: 13, openEditor: false });
});


test('the actual App date chooser callback waits for the same draft-safe transition before presenting its modal', async () => {
  let attribute;
  const visit = (node) => { if (ts.isJsxAttribute(node) && node.name.getText(app) === 'onOpenDatePicker') attribute = node;
    ts.forEachChild(node, visit); }; visit(app); assert.ok(attribute);
  const expression = attribute.initializer.expression; const module = { exports: {} }; let opened = false;
  let release; const gate = new Promise((resolve) => release = resolve);
  vm.runInNewContext(emit('export const open = ' + expression.getText(app) + ';'), { module, exports: module.exports,
    transitionFromCalendar: async (change) => { await gate; change(); }, setDatePickerOpen: (value) => opened = value });
  module.exports.open(); assert.equal(opened, false); release(); for (let i = 0; i < 5; i++) await Promise.resolve(); assert.equal(opened, true);
});
