import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),data=JSON.parse(readFileSync(new URL('../dist/market-data.json',import.meta.url))),notices=JSON.parse(readFileSync(new URL('../dist/ifind-notices.json',import.meta.url)));
const bundle=await build({entryPoints:[new URL('../dist/app.mjs',import.meta.url).pathname],bundle:true,write:false,format:'iife',platform:'browser'});
const storageKey='stock-lens-screen-v1';
async function boot({url='https://stock-lens.test/',saved=null}={}){
 const d=new JSDOM(html,{url,runScripts:'outside-only'}),w=d.window;let requests=0;
 w.fetch=async url=>{requests++;return Response.json(String(url).includes('/api/')?{tasks:[]}:String(url).includes('ifind-notices')?notices:data);};w.HTMLElement.prototype.scrollIntoView=function(){};
 if(saved)w.localStorage.setItem(storageKey,saved);w.eval(bundle.outputFiles[0].text);
 for(let i=0;i<100&&w.document.getElementById('side-date').textContent.includes('加载');i++)await new Promise(r=>setTimeout(r,10));
 return {dom:d,w,doc:w.document,requests:()=>requests};
}
function screen(ctx,text){const {w,doc}=ctx;doc.getElementById('intent').value=text;doc.getElementById('generate').click();doc.getElementById('run').click();}
test('DOM slider input immediately updates named additions and preview count without API calls',async()=>{
 const c=await boot();try{
  screen(c,'近20个交易日涨幅不超过5%');const n=c.requests();const slider=c.doc.querySelector('[data-prop="threshold"]');slider.value='40';slider.dispatchEvent(new c.w.Event('input',{bubbles:true}));
  const impact=c.doc.getElementById('live-impact');assert.equal(impact.hidden,false);assert.match(impact.textContent,/新增 [1-9]/);assert.match(impact.textContent,/贵州茅台/);assert.equal(c.requests(),n);assert.equal(c.doc.getElementById('save-monitor').disabled,true);
 }finally{c.w.close();}
});
test('DOM empty state provides an actionable, data-calculated relaxation',async()=>{
 const c=await boot();try{screen(c,'市盈率低于0.01倍');assert.match(c.doc.getElementById('result-table').textContent,/当前没有符合全部条件/);const action=c.doc.querySelector('[data-relax]');assert(action);action.click();assert.equal(c.doc.getElementById('live-impact').hidden,false);assert.match(c.doc.getElementById('live-impact').textContent,/新增 [1-9]/);}finally{c.w.close();}
});
test('DOM displays per-metric provenance, every announcement status and stale snapshot warning',async()=>{
 const c=await boot();try{const proof=c.doc.querySelector('.metric-line .metric-proof');assert(proof);for(const term of ['来源','时点','单位'])assert(proof.textContent.includes(term));assert.equal(c.doc.querySelectorAll('#coverage-body .coverage-grid p').length,60);assert.match(c.doc.getElementById('coverage-summary').textContent,/7 \/ 60/);assert.match(c.doc.getElementById('coverage-body').textContent,/不代表没有公告/);assert.match(c.doc.getElementById('freshness-notice').textContent,/不是实时数据/);}finally{c.w.close();}
});
test('DOM follow-up keeps prior volatility condition and uses the new gain limit',async()=>{
 const c=await boot();try{screen(c,'近20个交易日涨幅不超过30%，波动率低于2%');c.doc.getElementById('intent').value='把涨幅放宽到40%';c.doc.getElementById('generate').click();const cards=[...c.doc.querySelectorAll('[data-rule]')];assert.equal(cards.length,2);assert.equal(cards[0].querySelector('[data-prop="value"]').value,'40');assert.equal(cards[1].querySelector('[data-prop="value"]').value,'2');assert.match(c.doc.getElementById('parse-notice').textContent,/沿用上一轮/);}finally{c.w.close();}
});
test('DOM saved conditions survive a reload and a shared link reconstructs them in a fresh browser context',async()=>{
 let c=await boot(),saved,url;
 try{screen(c,'近20个交易日涨幅不超过40%');c.doc.getElementById('save-rules').click();saved=c.w.localStorage.getItem(storageKey);assert(saved);c.doc.getElementById('share-screen').click();url=c.doc.getElementById('share-link').value;assert(url.includes('#screen='));}finally{c.w.close();}
 c=await boot({saved});try{assert.equal(c.doc.querySelector('[data-prop="value"]').value,'40');assert.match(c.doc.getElementById('parse-notice').textContent,/已恢复本浏览器/);assert(c.doc.querySelectorAll('#result-table tbody tr').length>0);}finally{c.w.close();}
 c=await boot({url});try{assert.equal(c.doc.querySelector('[data-prop="value"]').value,'40');assert.equal(c.w.localStorage.getItem(storageKey),null);assert.match(c.doc.getElementById('parse-notice').textContent,/按当前快照重算/);}finally{c.w.close();}
});
test('DOM refuses fabricated saved conditions instead of rendering a normal default result',async()=>{
 const c=await boot({saved:JSON.stringify({rules:[{field:'magicFactor',op:'gt',value:8}]})});try{assert.match(c.doc.getElementById('rule-error').textContent,/不支持/);assert.equal(c.doc.querySelectorAll('#result-table tbody tr').length,0);assert.equal(c.doc.getElementById('run').disabled,true);screen(c,'只看科技股，量子因子大于5');assert.equal(c.doc.getElementById('run').disabled,true);assert.equal(c.doc.querySelectorAll('#result-table tbody tr').length,0);assert.match(c.doc.getElementById('result-description').textContent,/未支持或未澄清/);}finally{c.w.close();}
});
