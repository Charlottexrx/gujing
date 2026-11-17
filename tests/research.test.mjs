import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseIntent,findMetric,evaluate,validateRules,diversification} from '../dist/logic.mjs';
import {provenance,freshness,specialStockNotes,noticeCoverage,compareScreen,explainEmpty,validateResearchProposal,pointInTime,shareScreen,readSharedScreen} from '../dist/research.mjs';
const data=JSON.parse(readFileSync(new URL('../dist/market-data.json',import.meta.url)));
data.tradingDays=[...new Set(data.stocks.flatMap(s=>s.prices.map(p=>p[0])))].sort();
const notices=JSON.parse(readFileSync(new URL('../dist/ifind-notices.json',import.meta.url)));
const stock=data.stocks.find(s=>s.code==='600519.SH'),gain={field:'gain',op:'lte',value:30,days:20};
test('threshold comparison reports additions and removals from real sample without changing the old rules',()=>{
 const before=[{...gain,value:5}],after=[{...gain,value:40}];
 const d=compareScreen(data.stocks,before,after,data);
 assert(d.added.length>0);assert.equal(d.removed.length,0);assert.equal(before[0].value,5);
 const reverse=compareScreen(data.stocks,after,before,data);assert.deepEqual(reverse.removed.sort(),d.added.sort());
});
test('empty result explains blocking conditions and a proposed relaxation is actually sufficient',()=>{
 const rules=[{field:'pe',op:'lt',value:.01}];const advice=explainEmpty(data.stocks,rules,data);
 assert(advice[0].failed>0);assert(advice[0].proposed);assert(advice[0].count>0);
 const actual=data.stocks.filter(s=>s.pool&&evaluate(s,[advice[0].proposed],data).status==='in').length;assert.equal(actual,advice[0].count);
 const missing={...data,stocks:data.stocks.map(s=>({...s,pe:null}))};const a=explainEmpty(missing.stocks,rules,missing);assert.equal(a[0].proposed,null);assert.equal(a[0].missing,60);
});
test('each number has source field, units, as-of period, calculation and input trace',()=>{
 for(const r of [gain,{field:'vol',days:20},{field:'profit'},{field:'pe'}]){
  const p=provenance(stock,r,data,new Date('2026-11-17T08:00:00Z'));assert(p.source);assert(p.url.startsWith('https://fuyao'));assert(p.field);assert(p.unit);assert(p.period);assert(p.formula);assert(p.inputs);
 }
 assert.equal(provenance(stock,{field:'gain',days:20},data).inputs.prices.length,21);
});
test('stale or missing timestamps stay explicit; obsolete valuations and statements cannot pass',()=>{
 assert.equal(freshness('2026-01-01','2026-11-17T08:00:00Z').status,'stale');assert.equal(freshness(null).status,'unknown');
 assert.equal(findMetric({...stock,valuationAsOf:'2026-01-01'},{field:'pe'},data).value,null);
 const stale={...stock,reports:stock.reports.map(r=>({...r,period:r.period.replace('2026','2024').replace('2025','2023'),disclosed:'2024-01-01'}))};assert.equal(findMetric(stale,{field:'profit'},data).value,null);
});
test('suspension, ST and young listings stay visible; insufficient 30-day history is unknown',()=>{
 const s={...stock,name:'ST构造样例',isST:true,suspended:true,listingDate:'2026-11-01',prices:stock.prices.slice(-10)};
 const row=evaluate(s,[{...gain,days:30}],data);assert.equal(row.status,'unknown');assert.match(row.evidence[0].reason,/停牌/);
 const young=evaluate({...s,suspended:false},[{...gain,days:30}],data);assert.equal(young.status,'unknown');assert.match(young.evidence[0].reason,/上市不足30/);
 assert(specialStockNotes(s,data).some(n=>n.includes('ST')));assert(specialStockNotes(stock,data).some(n=>n.includes('未完整取得')));
});
test('every one of 60 stocks has explicit announcement coverage and missing is not no announcements',()=>{
 const states=data.stocks.filter(s=>s.pool).map(s=>noticeCoverage(s,notices));assert.equal(states.length,60);assert.equal(states.filter(s=>s.state==='covered').length,7);assert(states.every(s=>s.label));
 assert.match(states.find(s=>s.state==='not-covered').label,/不代表没有公告/);assert.equal(noticeCoverage(stock,null,'unavailable').state,'unavailable');
});
test('follow-up modifies only targeted threshold and keeps operators, time windows and other conditions',()=>{
 const context=[gain,{field:'vol',op:'lt',value:2,days:30},{field:'industry',op:'eq',value:'科技'}];
 const p=parseIntent('把涨幅放宽到40%', ['科技'],context);assert.equal(p.contextUpdated,true);assert.equal(p.rules[0].value,40);assert.equal(p.rules[0].op,'lte');assert.equal(p.rules[0].days,20);assert.deepEqual(p.rules.slice(1),context.slice(1));assert.equal(context[0].value,30);
 const ambiguous=parseIntent('再放宽到40%',[],context);assert.equal(ambiguous.needsClarification,true);assert.deepEqual(ambiguous.rules,context);
 const duplicate=parseIntent('把涨幅放宽到40%',[],[gain,{...gain,days:60}]);assert.equal(duplicate.needsClarification,true);
 const unsupported=parseIntent('把量子因子改到40%',[],context);assert.equal(unsupported.needsClarification,true);assert.deepEqual(unsupported.rules,context);
});
test('a claimed relaxation that tightens a lower bound is explained rather than changing the operator',()=>{
 const r=parseIntent('把涨幅放宽到40%',[],[{...gain,op:'gte',value:30}]);assert.equal(r.rules[0].op,'gte');assert.match(r.notes.join(''),/实际会收紧/);
});
test('hallucinated conditions, numbers, stocks, dates and units are rejected by the output contract',()=>{
 assert(validateRules([{field:'quantumScore',op:'gte',value:5}]));assert.throws(()=>validateResearchProposal({rules:[{field:'quantumScore',op:'gte',value:5}]},data.stocks,data));
 const base={rules:[{field:'pe',op:'lt',value:1000}],claims:[{code:stock.code,field:'pe',value:stock.pe,asOf:stock.valuationAsOf,unit:'倍'}]};
 assert.equal(validateResearchProposal(base,data.stocks,data).verified[0].value,stock.pe);
 assert.equal(validateResearchProposal({...base,rules:base.rules.map(r=>({...r,phrase:'这只必涨，赚9999元'}))},data.stocks,data).rules[0].phrase,'');
 assert.throws(()=>validateResearchProposal({rules:[{field:'industry',op:'eq',value:'火星板块'}]},data.stocks,data));
 for(const altered of [{value:99999},{code:'999999.SH'},{asOf:'2000-01-01'},{unit:'元'},{field:'magic'},{source:'编造的数据源'}])assert.throws(()=>validateResearchProposal({...base,claims:[{...base.claims[0],...altered}]},data.stocks,data));
 assert.throws(()=>validateResearchProposal({...base,claims:[{...base.claims[0],value:0}]},[{...stock,pe:null}],data));
});
test('share serializes conditions only, removes query secrets, and rejects tampered output numbers',()=>{
 const url=shareScreen([gain],'https://stock-lens.test/?session=private#portfolio',data.asOf),parsed=new URL(url);assert.equal(parsed.search,'');assert(!url.includes('private'));assert.equal(readSharedScreen(parsed.hash).rules[0].value,30);
 const payload=JSON.parse(decodeURIComponent(parsed.hash.slice(8)));assert.deepEqual(Object.keys(payload).sort(),['asOf','rules','version']);
 assert.throws(()=>readSharedScreen('#screen='+encodeURIComponent(JSON.stringify({...payload,claims:[{value:99999}]}))));
 assert.throws(()=>readSharedScreen('#screen='+encodeURIComponent(JSON.stringify({...payload,rules:[{field:'madeUp',op:'eq',value:1}]}))));
});
test('point-in-time screening excludes future prices, not-yet-disclosed reports and future estimates',()=>{
 const cutoff='2026-06-30';const pastBars=stock.prices.filter(([d])=>d<=cutoff);const sample={...stock,prices:[...pastBars,['2026-07-01',999999]],valuationAsOf:'2026-07-01',reports:[{period:'2026-03-31',disclosed:'2026-05-01',profit:120,currency:'CNY'},{period:'2025-03-31',disclosed:'2025-05-01',profit:100,currency:'CNY'},{period:'2026-06-30',disclosed:'2026-08-01',profit:99999,currency:'CNY'}]};
 const d={...data,asOf:cutoff,pointInTime:true};const observed=findMetric(sample,{field:'gain',days:20},d);assert.equal(observed.inputs.prices.at(-1)[0],cutoff);assert(!observed.inputs.prices.some(p=>p[0]>cutoff));
 assert(Math.abs(findMetric(sample,{field:'profit'},d).value-20)<1e-10); // JS ratio calculation is approximately 20%.
 assert.equal(findMetric(sample,{field:'pe'},d).value,null);
 const frozen=pointInTime({...data,stocks:[sample]},cutoff);assert(frozen.stocks[0].prices.every(([day])=>day<=cutoff));assert(frozen.stocks[0].reports.every(r=>r.disclosed<=cutoff));assert.equal(frozen.stocks[0].pe,null);assert.equal(frozen.stocks[0].industry,'');
});
test('future price and industry poisoning cannot change candidates selected at the earlier cutoff',()=>{
 const cutoff='2026-07-31',held=data.stocks.filter(s=>['002415.SZ','000063.SZ'].includes(s.code));
 const rank=(h,pool)=>diversification(h,pool,cutoff,[.5,.5],.2,'risk',30).map(c=>({code:c.stock.code,vol:c.after.vol,gain:c.after.gain,dates:c.dates}));
 const normal=rank(held,data.stocks);assert(normal.length);
 const poisoned=data.stocks.map((s,i)=>({...s,sector:'未来行业'+i,industry:'未来分类',prices:s.prices.map(([d,p])=>[d,d>cutoff?p*(i+2)*50:p])}));
 const poisonHeld=held.map(s=>poisoned.find(p=>p.code===s.code));assert.deepEqual(rank(poisonHeld,poisoned),normal);
});
