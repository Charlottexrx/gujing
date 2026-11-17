import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {example,parseIntent,validateRules,evaluate,makeRule,slicePrices,portfolioMetrics,alignedReturns,diversification,readSnapshot} from '../dist/logic.mjs';

const dataset=JSON.parse(readFileSync(new URL('../dist/market-data.json',import.meta.url),'utf8'));
const stocks=dataset.stocks;
dataset.tradingDays=[...new Set(stocks.flatMap(s=>s.prices.map(b=>b[0])))].sort();
const industries=[...new Set(stocks.flatMap(s=>[s.sector,...s.industry.split(', ')].filter(Boolean)))];
const stock=code=>stocks.find(s=>s.code===code);
const sampleRules=parseIntent(example,industries).rules;

test('example converts to 3 executable rules with an editable 20-day threshold',()=>{
  assert.deepEqual(sampleRules.map(r=>r.field),['profit','pe','vol']);
  assert.equal(sampleRules[1].op,'lte');
  assert.equal(sampleRules[1].value,25);
  assert.equal(sampleRules[2].days,20);
  assert.equal(validateRules(sampleRules),'');
});

test('inconsistent conditions are blocked and unsupported investment predictions get guidance',()=>{
  const clash=parseIntent('市盈率低于15倍，同时市盈率高于25倍',industries);
  assert.match(validateRules(clash.rules),/互相冲突/);
  assert.equal(parseIntent('直接告诉我买哪只股票，保证收益',industries).rules.length,0);
});

test('real sample: higher volatility cap may add CATL without changing the financial criteria',()=>{
  const candidate=stock('300750.SZ');
  assert.equal(evaluate(candidate,sampleRules,dataset).status,'out');
  assert.equal(evaluate(candidate,sampleRules.map(r=>r.field==='vol'?{...r,value:4.5}:r),dataset).status,'in');
  assert.equal(evaluate(stock('000858.SZ'),sampleRules,dataset).status,'in');
});

test('coverage failure and missing valuation remain distinct from a passing condition',()=>{
  const first=stocks[0];
  assert.equal(evaluate({...first,pe:null},[makeRule('pe')],dataset).status,'unknown');
  assert.equal(evaluate({...first,prices:first.prices.slice(0,-1)},[makeRule('vol')],dataset).status,'unknown');
  assert.equal(evaluate({...first,prices:first.prices.filter((_,i)=>i!==first.prices.length-3)},[makeRule('vol')],dataset).status,'unknown');
  assert.equal(stocks.filter(s=>s.pool).length,60);
  assert.equal(stocks.filter(s=>!s.pool).length,2);
});

test('detail ranges preserve their own date boundaries; today has no minute data',()=>{
  const prices=stocks[0].prices;
  assert.equal(slicePrices(prices,'screen',dataset.asOf,20).length,21);
  assert.match(slicePrices(prices,'month',dataset.asOf)[0][0],new RegExp('^'+dataset.asOf.slice(0,7)));
  assert.equal(slicePrices(prices,'today',dataset.asOf).length,0);
  assert.ok(slicePrices(prices,'history',dataset.asOf).length>slicePrices(prices,'year',dataset.asOf).length);
});

test('one holding has actual lower-volatility alternatives and preserves matched dates and weights',()=>{
  const selected=[stock('300750.SZ')];
  const before=alignedReturns(selected,dataset.asOf);
  assert.ok(before.dates.length>=240);
  assert.ok(portfolioMetrics(before.returns,[1]).vol>0);
  const suggestions=diversification(selected,stocks,dataset.asOf,[1],0.20,'risk',30);
  assert.ok(suggestions.length>=1);
  for (const candidate of suggestions) {
    assert.ok(candidate.after.vol<candidate.before.vol);
    assert.ok(candidate.dates.length>=230);
    assert.ok(candidate.correlation>=-1&&candidate.correlation<=1);
  }
  const maxRisk=30;
  assert.ok(diversification(selected,stocks,dataset.asOf,[1],0.20,'return',maxRisk).every(item=>item.after.vol<=maxRisk));
});


test('industry group selection uses the classification shown on the page',()=>{
  const technology=parseIntent('只看科技股',industries).rules;
  assert.equal(technology.length,1);
  assert.equal(technology[0].value,'科技');
  assert.equal(evaluate(stock('002415.SZ'),technology,dataset).status,'in');
  assert.equal(evaluate(stock('600036.SH'),technology,dataset).status,'out');
});

test('network failure, unavailable snapshot and invalid data reject the same input path used by the page',async()=>{
  const usable=data=>data?.stocks?.length>0;
  await assert.rejects(readSnapshot('/data',usable,async()=>{throw new Error('offline')}));
  await assert.rejects(readSnapshot('/data',usable,async()=>({ok:false})),/unavailable/);
  await assert.rejects(readSnapshot('/data',usable,async()=>({ok:true,json:async()=>({stocks:[]})})),/incomplete/);
  assert.equal(await readSnapshot('/data',usable,async()=>({ok:true,json:async()=>dataset})),dataset);
});
