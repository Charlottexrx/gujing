import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const data=JSON.parse(readFileSync(new URL('../dist/market-data.json',import.meta.url)));
const notices=JSON.parse(readFileSync(new URL('../dist/ifind-notices.json',import.meta.url)));
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/compliance-cases.json',import.meta.url)));
const bundle=await build({entryPoints:[new URL('../dist/app.mjs',import.meta.url).pathname],bundle:true,format:'iife',write:false,platform:'browser'});
async function waitFor(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw new Error('DOM state did not settle');}
async function boot(){
 const dom=new JSDOM(html,{url:'https://stock-lens.test/',runScripts:'outside-only'}),w=dom.window;
 w.fetch=async url=>Response.json(String(url).includes('/api/')?{tasks:[]}:String(url).includes('ifind-notices')?notices:data);
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.HTMLCanvasElement.prototype.getContext=function(){return new Proxy({measureText:()=>({width:10})},{get:(o,k)=>k in o?o[k]:()=>{}});};
 w.eval(bundle.outputFiles[0].text);
 await waitFor(()=>w.document.querySelectorAll('#result-table tbody tr').length>0);
 return dom;
}
function input(dom,text){const w=dom.window,el=w.document.getElementById('intent');el.value=text;el.dispatchEvent(new w.Event('input',{bubbles:true}));w.document.getElementById('generate').click();}
test('actual app DOM: 16 blocked inputs clear old candidates and disable screening, saved rules and monitoring',async()=>{
 for(const item of fixtures.blocked){const dom=await boot();try{
  const d=dom.window.document;assert(d.querySelectorAll('#result-table tbody tr').length>0);
  input(dom,item.input);
  assert.equal(d.getElementById('compliance-notice').hidden,false,item.input);assert.match(d.getElementById('compliance-notice').textContent,/不提供确定性涨跌预测、收益承诺或直接买卖建议/);
  assert.equal(d.querySelectorAll('#rules [data-rule]').length,0);assert.equal(d.querySelectorAll('#result-table tbody tr').length,0);
  for(const id of ['run','save-rules','save-monitor','add-rule'])assert.equal(d.getElementById(id).disabled,true,id+' '+item.input);
  // A synthetic event bypasses the HTML disabled attribute; the handler must still reject it.
  d.getElementById('run').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
  assert.equal(d.querySelectorAll('#result-table tbody tr').length,0);assert.equal(d.getElementById('save-monitor').disabled,true);
 }finally{dom.window.close();}}
});
test('actual app DOM: safe rephrasing restores historical screening; facts, inference and uncertainty are visible',async()=>{
 const dom=await boot();try{
  const d=dom.window.document;input(dom,'哪只必涨');input(dom,'近20个交易日涨幅超过5%');d.getElementById('run').click();
  assert.equal(d.getElementById('compliance-notice').hidden,true);assert(d.querySelectorAll('#result-table tbody tr').length>0);
  assert.match(d.getElementById('result-table').textContent,/数据事实/);assert.match(d.getElementById('result-table').textContent,/按条件判断（推断）/);
  const guide=d.getElementById('information-guide').textContent;assert.match(guide,/不确定信息/);assert.match(guide,/缺失、过期或取数失败/);assert.match(guide,/不代表未来涨跌/);
  d.querySelector('#result-table [data-detail]').click();
  assert.match(d.getElementById('detail-content').textContent,/数据事实（历史实际值）/);
  assert.match(d.getElementById('detail-content').textContent,/按条件判断（推断）/);
  assert(d.getElementById('detail-content').textContent.includes(data.asOf));
  assert(d.querySelector('#detail-content a[href^="https://fuyao"]'));
  d.getElementById('detail-dialog').close();
  d.getElementById('portfolio-stock').value='300750.SZ';d.getElementById('add-holding').click();
  assert.match(d.getElementById('portfolio-body').textContent,/历史情境模拟（推断）/);
  assert.match(d.getElementById('portfolio-body').textContent,/不代表未来收益更高或风险一定更低，不是买卖建议/);
  input(dom,'走势相对稳定');assert.match(d.getElementById('rules').textContent,/推断 · 请确认/);
 }finally{dom.window.close();}
});
test('actual app DOM: missing numeric data is labelled uncertain, not a passing factual result',async()=>{
 // Boot the same production module with a missing-field snapshot.
 const dom=new JSDOM(html,{url:'https://stock-lens.test/',runScripts:'outside-only'}),w=dom.window;
 try{
  const missing={...data,stocks:data.stocks.map(s=>({...s,pe:null}))};
  w.fetch=async url=>Response.json(String(url).includes('/api/')?{tasks:[]}:String(url).includes('ifind-notices')?notices:missing);
  w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.eval(bundle.outputFiles[0].text);await waitFor(()=>!w.document.getElementById('run').disabled);
  input(dom,'市盈率低于25倍');w.document.getElementById('run').click();
  w.document.querySelector('[data-tab="unknown"]').click();assert.match(w.document.getElementById('result-table').textContent,/不确定 · 待核验/);assert.equal(w.document.getElementById('save-monitor').disabled,true);
 }finally{w.close();}
});
