import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { applySyncGlyphState } from '../src/sync-glyph';

function fixture(fail = false) {
  const text=fs.readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
  const source=ts.createSourceFile('app.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const nodes=source.statements.filter((node:any)=>['updateHeader','synchronize','report'].includes(node.name?.text)||
    ts.isVariableStatement(node)&&node.declarationList.declarations.some((item)=>item.name.getText(source)==='status'));
  const elements:Record<string,any>={};
  const element=(id:string)=>elements[id]??={dataset:{},attributes:{},setAttribute(name:string,value:string){this.attributes[name]=value;}};
  let release!:(value:any)=>void,reached!:()=>void;
  const started=new Promise<void>((resolve)=>{reached=resolve;}),gate=new Promise((resolve)=>{release=resolve;});
  const context:any={Error,busy:false,lastStatus:'Initial status',element,applySyncGlyphState,
    checklistVisible:false,checklistUI:{hasDraft:()=>false,async flush(){},refresh(){},clear(){}},
    dayInput:{value:''},daysInput:{value:''},day:'2026-10-31',days:1,undo:null,
    store:{state:{conflicts:[]},async drain(){}},passphrase:'fixture',editor:null,render(){},
    connection:{identity:{email:'fixture@example.test'},isAuthorized:()=>true,async sync(){reached();if(fail)throw new Error('Synthetic connection error');return gate;}}};
  vm.runInNewContext(ts.transpileModule(nodes.map((node)=>node.getText(source)).join('\n'),
    {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return{context,element,started,release};
}

test('actual browser sync shows a closed active state only during its worker and returns to open idle on success',async()=>{
  const h=fixture(),pending=h.context.synchronize();await h.started;
  assert.equal(h.element('sync').dataset.syncState,'active');assert.equal(h.element('sync').attributes['aria-busy'],'true');
  assert.match(h.element('sync').title,/Synchronizing private ledger/);
  h.release({downloaded:0,uploaded:0});await pending;
  assert.equal(h.element('sync').dataset.syncState,'idle');assert.equal(h.element('sync').attributes['aria-busy'],'false');
  assert.match(h.element('sync').attributes['aria-label'],/Synchronize private ledger/);
});

test('a real browser sync failure keeps the centered issue state after work ends without losing its detailed status',async()=>{
  const h=fixture(true);await h.context.synchronize();
  assert.equal(h.element('sync').dataset.syncState,'issue');assert.equal(h.element('sync').attributes['aria-busy'],'false');
  assert.match(h.context.lastStatus,/Synthetic connection error/);
  assert.match(h.element('sync').title,/Synthetic connection error.*Shift\+F10/);
  assert.match(h.element('sync').attributes['aria-label'],/needs attention.*retry/);
  h.context.busy=true;h.context.updateHeader();
  assert.equal(h.element('sync').dataset.syncState,'issue','a real retained issue takes precedence over a retrying worker');
  assert.equal(h.element('sync').attributes['aria-busy'],'true');
});

test('the browser glyph is a static circular side-arrow emblem with a centered issue mark and no outer badge',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../app.css',import.meta.url),'utf8');
  const button=/<button id="sync"[\s\S]*?<\/button>/.exec(html)![0];
  assert.match(button,/aria-hidden="true" focusable="false"/);assert.match(button,/viewBox="0 0 24 24"/);
  assert.match(button,/stroke-width="1\.5"/);assert.match(button,/class="sync-loop-closed" cx="12" cy="12" r="10\.25"/);
  assert.match(button,/class="sync-loop-open"/);assert.match(button,/class="sync-side-arrows"/);
  assert.match(button,/class="sync-issue"><path d="M12 7\.25V12\.75"/);
  assert.doesNotMatch(button,/⇄|sync-warning|animate|ellipse/i);
  assert.match(css,/#sync\[data-sync-state=active\]\{color:var\(--ink\)\}/);
  assert.match(css,/header #sync\{[^}]*color:var\(--muted\)/);
  assert.doesNotMatch(css,/animation|@keyframes|transition:/);
});

test('sync arrowheads sit on opposite points of the loop with congruent arms',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const shape=/class="sync-side-arrows" d="([^"]+)"/.exec(html)![1];
  const points=[...shape.matchAll(/[-\d.]+/g)].map((match)=>Number(match[0]));
  assert.equal(points.length,12);
  const left=[[points[0]!,points[1]!],[points[2]!,points[3]!],[points[4]!,points[5]!]];
  const right=[[points[6]!,points[7]!],[points[8]!,points[9]!],[points[10]!,points[11]!]];
  for(const tip of [left[1]!,right[1]!]) assert.ok(Math.abs(Math.hypot(tip[0]!-12,tip[1]!-12)-10.25)<1e-8);
  for(let i=0;i<3;i++) {
    assert.ok(Math.abs(left[i]![0]!+right[2-i]![0]!-24)<1e-6);
    assert.ok(Math.abs(left[i]![1]!+right[2-i]![1]!-24)<1e-6);
  }
  assert.match(html,/<svg class="sync-glyph" style="overflow:visible"/,'arrow wings remain visible');
});

test('glyph updates preserve the existing button action and accessible status',()=>{
  const action=()=>undefined,attributes:Record<string,string>={'aria-label':'Existing sync detail'};
  const button={dataset:{},onclick:action,title:'Detailed status',setAttribute(name:string,value:string){attributes[name]=value;}};
  applySyncGlyphState(button as any,true,false);applySyncGlyphState(button as any,false,true);
  assert.equal(button.onclick,action);assert.equal(button.title,'Detailed status');
  assert.equal(attributes['aria-label'],'Existing sync detail');
});
