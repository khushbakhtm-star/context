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
function renderFixture(texts: string[], clock12 = true, minute = 0, planned = false) {
  const source = fs.readFileSync(new URL('../src/app.ts', import.meta.url),'utf8');
  const parsed = ts.createSourceFile('app.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const declaration = parsed.statements.find((node:any) => node.name?.text === 'render')!;
  const documents = texts.flatMap((text,index) => [{key:minuteKey(day,index),value:{text,categoryId:'group',blockId:'activity_notes'}},
    {key:cellFormatKey(day,index),value:{kind:'minuteFormat',format:{activityGroup:{id:'activity_notes',title:'One activity'},textColor:'#FFFFFF',bold:index===1}}}]);
  documents.push({key:'category:group',value:{color:'#2952A3'}} as any);
  const grid = new Node(), welcome = new Node();
  const main = {scrollTop:minute*32+50,scrollLeft:0,clientHeight:64};
  const context:any = {store:{state:{documents:planned?[]:documents}},grid,main,clock12,firstRendered:-1,editor:null,
    document:{activeElement:null,createElement:()=>new Node(),createTextNode:(text:string)=>Object.assign(new Node(),{textContent:text})},
    HTMLElement:Node,element:()=>welcome,dates:()=>[day],updateHeader(){},updateBars(){},paintSelection(){},dateKey,
    minuteKey,cellFormatKey,formatFromDocument,minuteLabel,minuteCellPresentation,calendarCellColor,
    MINUTE_NOTE_STYLE,MINUTE_TIME_STYLE,
    planForMinute:()=>planned?{id:'plan',title:'Planned activity',color:'#8D6F47'}:undefined};
  vm.runInNewContext(ts.transpileModule(declaration.getText(parsed),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  context.render();
  const row = (index:number) => grid.children.find((child)=>child.dataset.row===String(index))!;
  return {grid,row,cell:(index:number)=>row(index).children[1]!,note:(index:number)=>row(index).children[1]!.children.find((child)=>child.className==='cell-note')!};
}

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
