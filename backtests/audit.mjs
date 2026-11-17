// Strict data-readiness gate. A failed audit is not a zero-stock screen.
export function auditReadiness(evidence) {
 const required=['historicalUniverseComplete','delistedCoverageVerified','screeningHistoryComplete','asOfFinancialVersionsVerified','asOfValuationsComplete','corporateActionsAndExitsVerified'];
 const missing=required.filter(key=>evidence[key]!==true);
 return {status:missing.length?'BLOCKED':'READY_FOR_SCREENING',missing,
   allPassingStocks:null,selectedStocks:null,stockResults:null,portfolioMetrics:null,comparisonConclusion:null};
}
export function benchmarkMetrics(rows,expectedDates) {
 if(!rows.length||rows.some((r,i)=>!r.date||!Number.isFinite(r.open)||!Number.isFinite(r.close)||r.open<=0||r.close<=0||(i&&r.date<=rows[i-1].date)))throw new Error('Invalid or duplicate daily index bars');
 if(rows.length!==expectedDates.length||rows.some((r,i)=>r.date!==expectedDates[i]))throw new Error('Missing or unexpected benchmark trading day');
 const entry=rows[0].open,nav=[1,...rows.map(r=>r.close/entry)];
 const returns=rows.slice(1).map((r,i)=>r.close/rows[i].close-1);
 if(returns.length<2)throw new Error('Insufficient close-to-close observations');
 const mean=returns.reduce((s,x)=>s+x,0)/returns.length;
 const variance=returns.reduce((s,x)=>s+(x-mean)**2,0)/(returns.length-1);
 let peak=1,drawdown=0;
 for(const value of nav){peak=Math.max(peak,value);drawdown=Math.max(drawdown,1-value/peak);}
 return {entryDate:rows[0].date,exitDate:rows.at(-1).date,tradingDays:rows.length,closeToCloseObservations:returns.length,
 entryOpen:entry,exitClose:rows.at(-1).close,returnPct:(nav.at(-1)-1)*100,annualizedVolatilityPct:Math.sqrt(variance*252)*100,maxDrawdownPct:drawdown*100,
 priceUnit:'指数点',metricUnit:'%',annualization:252,fees:0,slippage:0,dividends:'价格指数，不含现金分红',
 definitions:{return:'2025-08-04开盘点位至2025-11-18收盘点位',volatility:'70个相邻收盘日简单收益率的样本标准差×sqrt(252)',maxDrawdown:'含入场初始净值1的每日收盘归一净值，非日内回撤'}};
}
