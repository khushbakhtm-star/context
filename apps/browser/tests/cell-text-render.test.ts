import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { minuteCellPresentation, MINUTE_NOTE_STYLE, MINUTE_TIME_STYLE } from '../src/cell-presentation';
import { calendarCellColor } from '../shared/utils/calendar-cell-color';
import { cellFormatKey, formatFromDocument } from '../shared/utils/cell-format';
import { dateKey, minuteLabel } from '../shared/utils/time';
import { minuteKey } from '../src/ledger';
import { noteColorOnFill } from '../src/text-color';

const day = '2026-10-31';
class Node {
  children: Node[] = []; textContent = ''; className = ''; hidden = false; dataset: Record<string,string> = {};
  attributes: Record<string,string> = {}; classes = new Set<string>();
  style: Record<string,any> = { setProperty(name:string,value:string) { this[name] = value; } };
  classList = { add: (...names:string[]) => names.forEach((name) => this.classes.add(name)) };
  append(...children: Node[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  setAttribute(name:string,value:string) { this.attributes[name] = value; }
  addEventListener() {}
}
function renderFixture(texts: string[], clock12 = true, minute = 0, planned = false, visibleDays = [day], providedDocuments?: any[]) {
  const source = fs.readFileSync(new URL('../src/app.ts', import.meta.url),'utf8');
  const parsed = ts.createSourceFile('app.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const declaration = parsed.statements.find((node:any) => node.name?.text === 'render')!;
  const documents = texts.flatMap((text,index) => [{key:minuteKey(day,index),value:{text,categoryId:'group',blockId:'activity_notes'}},
    {key:cellFormatKey(day,index),value:{kind:'minuteFormat',format:{activityGroup:{id:'activity_notes',title:'One activity'},textColor:'#FFFFFF',bold:index===1}}}]);
  documents.push({key:'category:group',value:{color:'#2952A3'}} as any);
  const grid = new Node(), welcome = new Node();
  const main = {scrollTop:minute*32+50,scrollLeft:0,clientHeight:64};
  const sourceDocuments = providedDocuments ?? (planned ? [] : documents);
  const context:any = {store:{state:{documents:sourceDocuments}},grid,main,clock12,firstRendered:-1,editor:null,
    document:{activeElement:null,createElement:()=>new Node(),createTextNode:(text:string)=>Object.assign(new Node(),{textContent:text})},
    HTMLElement:Node,element:()=>welcome,dates:()=>visibleDays,updateHeader(){},updateBars(){},paintSelection(){},dateKey,
    minuteKey,cellFormatKey,formatFromDocument,minuteLabel,minuteCellPresentation,calendarCellColor,noteColorOnFill,
    MINUTE_NOTE_STYLE,MINUTE_TIME_STYLE,
    planForMinute:()=>planned?{id:'plan',title:'Planned activity',color:'#8D6F47'}:undefined};
  vm.runInNewContext(ts.transpileModule(declaration.getText(parsed),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  context.render();
  const row = (index:number) => grid.children.find((child)=>child.dataset.row===String(index))!;
  return {grid,documents:sourceDocuments,heading:grid.children[0]!,row,cell:(index:number)=>row(index).children[1]!,note:(index:number)=>row(index).children[1]!.children.find((child)=>child.className==='cell-note')!};
}

test('Day view left-aligns its weekday and day number while multi-day headings retain their centered layout', () => {
  const single = renderFixture([]).heading;
  assert.equal(single.children[1]!.style.textAlign, 'left');
  assert.equal(single.children[1]!.style.paddingLeft, '8px');
  assert.equal(single.children[1]!.children[0]!.textContent,
    new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short' }));
  assert.equal(single.children[1]!.children[1]!.textContent, '31');
  assert.equal(single.children[0]!.style.textAlign, undefined, 'the time gutter is unaffected');
  for (const count of [3, 7]) {
    const visible = Array.from({ length: count }, (_, index) => dateKey(new Date(2026, 9, 31 + index)));
    const heading = renderFixture([], true, 0, false, visible).heading;
    assert.equal(heading.children.length, count + 1);
    for (const date of heading.children.slice(1)) {
      assert.equal(date.style.textAlign, undefined, 'multi-day date headings use the existing centered CSS');
      assert.equal(date.style.paddingLeft, undefined);
    }
  }
  const css = fs.readFileSync(new URL('../app.css', import.meta.url), 'utf8');
  assert.match(css, /\.grid-heading>div\{[^}]*text-align:center/);
});

test('actual browser rendering keeps short, long and multiline notes at one size with natural width wrapping', () => {
  const texts=['I','A sentence with natural word boundaries. '.repeat(15),'AReallyLongUnbrokenWord'.repeat(25),'First line\n  keep indentation  '];
  const h=renderFixture(texts);
  texts.forEach((text,index)=>{
    const note=h.note(index);assert.equal(note.textContent,text,'rendering must retain every original character');
    assert.equal(note.style.fontSize,'14px');assert.equal(note.style.lineHeight,'21px');
    assert.equal(note.style.whiteSpace,'pre-wrap');assert.equal(note.style.overflowWrap,'anywhere');
    assert.equal(note.style.wordBreak,'normal');assert.equal(note.style.textOverflow,'clip');
    assert.equal(note.style.width,'100%');assert.equal(note.style.overflow,'hidden');
    assert.equal(note.style.opacity,undefined);assert.equal(note.style.visibility,undefined);
  });
  assert.equal(h.cell(0).children[0]!.className,'cell-event-title','the activity label remains independent of raw note text');
  assert.equal(h.note(0).style.lineHeight,h.note(1).style.lineHeight,'the first event cell cannot use a shorter note line height');
});

test('actual browser event borders use the activity fill independently of its contrasting text color', () => {
  const h=renderFixture(['First note','Second note']);
  for(const index of [0,1]) {
    assert.equal(h.cell(index).style.backgroundColor,'#2952A3');
    assert.equal(h.cell(index).style.borderColor,'#2952A3');
    assert.equal(h.cell(index).style.color,'#FFFFFF');
  }
  const planned=renderFixture([],true,0,true);
  assert.equal(planned.cell(0).style.borderColor,'#8D6F47');
  assert.equal(planned.note(0).textContent,'','a plan title never becomes a minute note');
});

test('fixed-scale browser time labels keep their base font and complete hour/minute values in both clocks', () => {
  for(const clock12 of [false,true]) for(let hour=0;hour<24;hour++) {
    const minute=hour*60,h=renderFixture([],clock12,minute),label=h.row(minute).children[0]!;
    assert.equal(label.textContent,minuteLabel(minute,clock12));
    assert.equal(label.style.fontSize,'12px');assert.equal(label.style.whiteSpace,'nowrap');
    assert.equal(label.style.textOverflow,'clip');assert.doesNotMatch(label.textContent,/…|\.\.\./);
    assert.equal(h.grid.style['--time-width'],clock12?'78px':'51px');
  }
});

test('committed unclassified notes use theme-neutral display fill while explicit activities, groups and sources retain their fill', () => {
  const entry = (minute: number, text: string, categoryId = 'unaccounted') => ({ key: minuteKey(day, minute), value: { text, categoryId, blockId: `block_${minute}` } });
  const documents = [entry(0, 'Unclassified thought'), entry(1, ' \n\t'), entry(2, ''), entry(3, 'Explicit category', 'work'),
    entry(4, 'Bordered activity'), entry(5, 'Reset fill note', 'work'), entry(6, ' \n', 'work'),
    { key: 'category:unaccounted', value: { color: '#5A6986' } }, { key: 'category:work', value: { color: '#2952A3' } },
    { key: cellFormatKey(day, 4), value: { kind: 'minuteFormat', format: { calendarEvent: { id: 'block_4', title: 'Explicit event' } } } },
    ...[5, 6].map((minute) => ({ key: cellFormatKey(day, minute), value: { kind: 'minuteFormat', format: { noFill: true } } }))];
  const before = JSON.stringify(documents), h = renderFixture([], true, 0, false, [day], documents);
  for (const index of [0, 5]) {
    assert.equal(h.cell(index).dataset.defaultFill, 'true'); assert.equal(h.cell(index).style.backgroundColor, undefined);
  }
  for (const index of [1, 2, 6]) {
    assert.equal(h.cell(index).dataset.defaultFill, 'false'); assert.equal(h.cell(index).style.backgroundColor, undefined, 'whitespace/default cells keep the ordinary surface');
  }
  assert.equal(h.cell(3).dataset.defaultFillEligible, 'false'); assert.equal(h.cell(3).style.backgroundColor, '#2952A3');
  assert.equal(h.cell(4).dataset.defaultFillEligible, 'false'); assert.equal(h.cell(4).style.backgroundColor, '#5A6986');
  const source = renderFixture([], true, 0, true, [day], [entry(0, 'A source minute')]);
  assert.equal(source.cell(0).dataset.defaultFillEligible, 'false'); assert.equal(source.cell(0).dataset.defaultFill, 'false');
  const custom = renderFixture([], true, 0, false, [day], [entry(0, 'Deliberate custom color'),
    { key: 'category:unaccounted', value: { color: '#123456', customColor: true } }]);
  assert.equal(custom.cell(0).dataset.defaultFillEligible, 'false'); assert.equal(custom.cell(0).style.backgroundColor, '#123456');
  assert.equal(custom.cell(0).style.color, '#FFFFFF', 'dark custom fills use readable automatic text contrast');
  const explicitText = renderFixture([], true, 0, false, [day], [entry(0, 'Chosen text color', 'custom_focus'),
    { key: 'category:custom_focus', value: { color: '#123456', customColor: true } },
    { key: cellFormatKey(day, 0), value: { kind: 'minuteFormat', format: { textColor: '#FFAABB' } } }]);
  assert.equal(explicitText.cell(0).style.color, '#FFAABB', 'explicit text formatting keeps precedence over automatic contrast');
  assert.equal(JSON.stringify(documents), before, 'rendering cannot update ledger, category or sync payloads');
  const css = fs.readFileSync(new URL('../app.css', import.meta.url), 'utf8');
  assert.match(css, /:root\{--default-text-fill:#E6E6E6\}/);
  assert.match(css, /body\[data-theme=dark\]\{--default-text-fill:#333333\}/);
  assert.match(css, /@media\(prefers-color-scheme:dark\)\{body:not\(\[data-theme=light\]\)\{--default-text-fill:#333333\}\}/);
  assert.match(css, /\.cell\[data-default-fill=true\]\{background-color:var\(--default-text-fill\);color:var\(--ink\)\}/);
});
