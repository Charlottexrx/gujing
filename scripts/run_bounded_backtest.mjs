import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {screenStock,selectStocks,buyAndHold,reconstructPe} from '../backtests/bounded.mjs';
const [inputFile,outputDir,mode='screen']=process.argv.slice(2);if(!inputFile||!outputDir)throw Error('Usage: node scripts/run_bounded_backtest.mjs INPUT OUTPUT [screen|evaluate]');
const d=JSON.parse(fs.readFileSync(inputFile));fs.mkdirSync(outputDir,{recursive:true});
for(const s of d.stocks) {
 try {
  const close=s.screenBars.find(b=>b.date===d.signalDate)?.close;
  const pe=reconstructPe(close,s.shareCount,s.annual,s.financial,d.signalDate);
  Object.assign(s,{pe:pe.value,peLower:pe.lower,peUpper:pe.upper,peDate:d.signalDate,peParamDate:'20250801',peSource:{kind:'reconstructed-original-vintage',close,shareCount:s.shareCount,annual:{period:s.annual.period,disclosed:s.annual.disclosed,profit:s.annual.profit,url:s.annual.url,pdfSha256:s.annual.pdfSha256,page:s.annual.pageNumber},financial:{current:s.financial.current,prior:s.financial.prior,disclosed:s.financial.disclosed,period:s.financial.period},ttmProfit:pe.ttmProfit,formula:pe.formula??'A股价×总股本/TTM利润；TTM非正不通过'}});
 } catch(e) {s.pe=null;s.peError=e.message;}
}
const screen=d.stocks.map(s=>screenStock(s,d.screenDates,d.signalDate));const {passing,selected}=selectStocks(screen);
const frozen={signalDate:d.signalDate,universeCount:d.stocks.length,excludedAfterCutoff:d.excludedAfterCutoff,sourceConditions:'源码默认：归母净利润同比>0，0<PE TTM≤25，近20交易日日收益样本波动率<2%；不是用户浏览器本地草稿',ranking:'证券代码升序，前10；不按未来收益挑选',results:screen,passingCodes:passing.map(s=>s.code),selectedCodes:selected.map(s=>s.code)};
const text=JSON.stringify(frozen,null,2)+'\n';const hash=crypto.createHash('sha256').update(text).digest('hex');const snapshot=path.join(outputDir,'screen.json');
if(mode==='screen') {if(screen.some(s=>s.status==='UNKNOWN'))throw Error('Unresolved eligible candidates: keep findings, do not seal incomplete screen');fs.writeFileSync(snapshot,text);fs.writeFileSync(path.join(outputDir,'screen.sha256'),hash+'\n');console.log(JSON.stringify({passing:passing.length,selected:frozen.selectedCodes,sha256:hash}));}
else if(mode==='evaluate') {
 if(fs.readFileSync(snapshot,'utf8')!==text)throw Error('Screen changed after freeze');
 const positions=selected.map(s=>d.stocks.find(x=>x.code===s.code));const results=buyAndHold(positions,d.holdingDates);const priceOnly=buyAndHold(positions,d.holdingDates,undefined,false);
 const singles=passing.map(s=>buyAndHold([d.stocks.find(x=>x.code===s.code)],d.holdingDates).positions[0]);
 const report={status:'COMPLETED_WITH_SURVIVORSHIP_BIAS',screenSha256:hash,signalDate:d.signalDate,holdingStart:d.holdingDates[0],holdingEnd:d.holdingDates.at(-1),poolCount:d.stocks.length,passingCount:passing.length,selectedCount:selected.length,costs:{buyFeePct:.05,sellFeePct:.10,buySlippagePct:.05,sellSlippagePct:.05},rebalancing:'none',...results,priceOnlyMetrics:priceOnly.metrics,allPassingStockResults:singles,benchmark:{returnPct:13.131695864723092,annualizedVolatilityPct:16.548088947963503,maxDrawdownPct:4.145892964828379,kind:'沪深300价格指数，未扣交易成本'},bias:'排除了后来退市的股票，存在幸存者偏差，结果可能偏乐观。当前60只、6行业便利样本，不代表2025-08-01的历史全市场或历史沪深300。'};
 fs.writeFileSync(path.join(outputDir,'result.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(outputDir,'portfolio_daily.csv'),'date,nav\n'+results.daily.map(r=>r.date+','+r.nav).join('\n')+'\n');
 fs.writeFileSync(path.join(outputDir,'stock_results.csv'),'code,name,selected,return_pct,annualized_volatility_pct,max_drawdown_pct,entry_open_cny,exit_close_cny\n'+singles.map(s=>[s.code,s.name,frozen.selectedCodes.includes(s.code),s.returnPct,s.annualizedVolatilityPct,s.maxDrawdownPct,s.entryOpen,s.exitClose].join(',')).join('\n')+'\n');
 console.log(JSON.stringify({metrics:report.metrics,priceOnly:report.priceOnlyMetrics,selected:report.positions.map(s=>[s.code,s.returnPct])}));
}else throw Error('Unknown mode');
