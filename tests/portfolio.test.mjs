import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {alignedReturns, portfolioMetrics, diversification} from '../dist/logic.mjs';

const json=name=>JSON.parse(readFileSync(new URL('../dist/'+name,import.meta.url),'utf8'));
const market=json('market-data.json'), notices=json('ifind-notices.json');
const stocks=market.stocks, pool=stocks.filter(row=>row.pool);
const stock=code=>stocks.find(row=>row.code===code);
const together=(...codes)=>codes.map(stock);
const weights=rows=>rows.map(()=>1/rows.length);
const rank=(rows, asOf=market.asOf, candidates=pool, goal='risk', cap=30)=>
  diversification(rows,candidates,asOf,weights(rows),.20,goal,cap);

test('real data contains exactly 60 distinct CSI 300 stocks in six equal groups',()=>{
  assert.equal(market.indexMemberCount,300);
  assert.equal(new Set(pool.map(s=>s.code)).size,60);
  const counts=new Map();
  for(const row of pool) {
    counts.set(row.sector,(counts.get(row.sector)||0)+1);
    assert.ok(row.prices.length>=200, row.code);
    assert.ok(Number.isFinite(row.pe),row.code);
    assert.ok(row.reports.length>=5,row.code);
  }
  assert.equal(counts.size,6);
  assert.deepEqual([...counts.values()],[10,10,10,10,10,10]);
});

test('iFinD evidence is attached to known stocks and contains dated issuer-verified metadata only',()=>{
  assert.ok(Object.keys(notices.notices).length>=6);
  for(const [code,rows] of Object.entries(notices.notices)) {
    const issuer=stock(code);
    assert.ok(issuer);
    for(const row of rows) {
      assert.ok(row.title.includes(issuer.name),code);
      assert.ok(row.date>=notices.from&&row.date<=notices.asOf);
      assert.deepEqual(Object.keys(row).sort(),['date','title']);
    }
  }
});

for (const [label,codes] of [
  ['one technology stock',['002415.SZ']],
  ['two technology stocks from distinct subindustries',['002415.SZ','000063.SZ']],
  ['four different sectors',['002415.SZ','600900.SH','600036.SH','600276.SH']]
]) {
  test('real portfolio: '+label,()=>{
    const selected=together(...codes);
    const aligned=alignedReturns(selected,market.asOf);
    assert.ok(aligned.returnDates.length>=230);
    assert.ok(portfolioMetrics(aligned.returns,weights(selected)).vol>0);
    const result=rank(selected);
    assert.ok(result.length>0);
    for(const candidate of result) {
      assert.ok(!codes.includes(candidate.stock.code));
      assert.ok(candidate.after.vol<candidate.before.vol);
      if (label!=='four different sectors') assert.notEqual(candidate.stock.sector,'科技');
    }
  });
}

test('gaps do not turn multi-day moves into one-day returns; weak coverage and infeasible targets stay empty',()=>{
  const [a,b]=together('002415.SZ','600900.SH');
  const full=alignedReturns([a,b],market.asOf);
  const gapIndex=full.dates.length-12;
  const missing=full.dates[gapIndex], following=full.dates[gapIndex+1];
  const withGap=alignedReturns([a,{...b,prices:b.prices.filter(([d])=>d!==missing)}],market.asOf);
  assert.ok(withGap);
  assert.equal(withGap.returnDates.length,full.returnDates.length-2);
  assert.ok(!withGap.returnDates.includes(missing));
  assert.ok(!withGap.returnDates.includes(following));
  const insufficient={...b,prices:b.prices.slice(-40)};
  assert.equal(alignedReturns([a,insufficient],market.asOf),null);
  assert.deepEqual(rank([a],market.asOf,[insufficient]),[]);
  assert.deepEqual(rank([a],market.asOf,pool,'return',0),[]);
});

test('a candidate chosen with earlier real returns is evaluated on a disjoint later period',()=>{
  const cutoff='2026-07-31';
  const selected=together('002415.SZ','000063.SZ');
  const candidate=rank(selected,cutoff)[0];
  assert.ok(candidate);
  assert.ok(candidate.dates.at(-1)<=cutoff);
  const aligned=alignedReturns([...selected,candidate.stock],market.asOf);
  const nextIndex=aligned.returnDates.findIndex(d=>d>cutoff);
  assert.ok(nextIndex>=0);
  assert.ok(aligned.returnDates.length-nextIndex>60);
  const holdout=aligned.returns.map(row=>row.slice(nextIndex));
  const before=portfolioMetrics(holdout,[.5,.5,0]);
  const after=portfolioMetrics(holdout,[.4,.4,.2]);
  assert.ok(Number.isFinite(before.vol)&&Number.isFinite(after.vol));
  console.log(JSON.stringify({trainingEnd:cutoff,holdoutFrom:aligned.returnDates[nextIndex],
    holdoutEnd:aligned.returnDates.at(-1),observations:holdout[0].length,candidate:candidate.stock.code,
    before:+before.vol.toFixed(2),after:+after.vol.toFixed(2)}));
});
