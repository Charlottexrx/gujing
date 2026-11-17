import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditReadiness,benchmarkMetrics} from '../backtests/audit.mjs';
const file=name=>JSON.parse(readFileSync(new URL('../backtests/2025-08-01/'+name,import.meta.url)));
const report=file('audit.json'),request=file('request.json');
const rows=readFileSync(new URL('../backtests/2025-08-01/benchmark_daily.csv',import.meta.url),'utf8').trim().split(/\r?\n/).slice(1).map(line=>{const [date,open,close]=line.split(',');return {date,open:Number(open),close:Number(close)};});
test('real audit rejects unverified historical universe and never reports zero passing stocks',()=>{
 const result=auditReadiness(report.evidence);assert.equal(result.status,'BLOCKED');assert(result.missing.includes('historicalUniverseComplete'));assert(result.missing.includes('delistedCoverageVerified'));
 for(const field of ['allPassingStocks','selectedStocks','stockResults','portfolioMetrics','comparisonConclusion'])assert.equal(result[field],null);
 assert.equal(report.status,'BLOCKED');assert.equal(report.allPassingStocks,null);
});
test('one successful historical PE lookup cannot make the whole universe point-in-time verified',()=>{
 assert.equal(report.available.singleStockHistoricalPeParameterVerified,true);assert.equal(report.evidence.asOfValuationsComplete,false);assert.equal(auditReadiness(report.evidence).status,'BLOCKED');
 assert.equal(report.sourceChecks.ifindPe.indicatorParams['市盈率(PE,TTM)']['交易日期'],'20250801');
});
test('future disclosure dates, truncated current universes and ambiguous empty results are not accepted',()=>{
 assert.equal(report.sourceChecks.ifindUniverse.truncated,true);assert.equal(report.sourceChecks.ifindUniverse.containsPostCutoffIPO,true);assert.equal(report.evidence.historicalUniverseComplete,false);
 const future=report.sourceChecks.financialSample.records.filter(r=>r.reportedDisclosureDate>request.signalDate);assert(future.length>0);assert(future.every(r=>r.eligibleByDate===false));
 assert.equal(report.sourceChecks.ifindUniverseRefined.returnedCount,0);assert.equal(report.allPassingStocks,null);
});
test('benchmark numbers reproduce from 71 actual observed bars, independently checked against Python calculation',()=>{
 const result=benchmarkMetrics(rows,rows.map(r=>r.date));assert.equal(result.tradingDays,71);assert.equal(result.closeToCloseObservations,70);assert.equal(result.entryOpen,4037.94);assert.equal(result.exitClose,4568.19);
 assert(Math.abs(result.returnPct-13.131695864723092)<1e-10);assert(Math.abs(result.annualizedVolatilityPct-16.548088947963503)<1e-10);assert(Math.abs(result.maxDrawdownPct-4.145892964828379)<1e-10);
 assert.equal(result.returnPct,report.benchmark.returnPct);
});
test('missing benchmark day is an error, not a silently shortened backtest',()=>{
 assert.throws(()=>benchmarkMetrics(rows.filter((_,i)=>i!==10),rows.map(r=>r.date)),/Missing/);
});
test('fees, slippage, deterministic top-ten and buy-and-hold policy are fixed before any portfolio exists',()=>{
 assert.equal(request.assumedCosts.buyAllInFeePct,.05);assert.equal(request.assumedCosts.sellAllInFeePct,.1);assert.equal(request.assumedCosts.buySlippagePct,.05);assert.equal(request.assumedCosts.sellSlippagePct,.05);
 assert.match(request.ranking,/代码升序/);assert.match(request.portfolio,/不每日再平衡/);assert.match(request.executionPolicy,/未成交保留现金/);assert.match(request.executionPolicy,/不能擅自归零/);
});
test('source-date configuration distinguishes screening information and holding-period evaluation',()=>{
 assert.equal(request.signalCutoff,'2025-08-01T15:00:00+08:00');assert.equal(request.dateOnlyDisclosuresMustBeBefore,'2025-08-01');assert.equal(request.holdingStart,'2025-08-04');assert.equal(request.holdingEnd,'2025-11-18');
 assert.match(request.priceSemantics,/不能倒灌筛选/);assert.equal(request.sourceRules.rules.length,3);
});
