// Deterministic research backtest. No network or model-generated numbers.
export function sampleVol(values) {
 if(values.length<2||values.some(x=>!Number.isFinite(x)))throw Error('Insufficient/invalid returns');
 const mean=values.reduce((a,b)=>a+b,0)/values.length;
 return Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/(values.length-1));
}
export function screeningVol(bars,events,dates,cutoff) {
 const b=bars.filter(x=>x.date<=cutoff).sort((a,b)=>a.date.localeCompare(b.date)).slice(-21);
 const expected=dates.filter(x=>x<=cutoff).slice(-21);
 if(expected.length!==21||b.length!==21||b.some((x,i)=>x.date!==expected[i]||!Number.isFinite(x.close)||x.close<=0||x.volume<=0))throw Error('Missing, duplicate, stale or untradeable screening bars');
 const used=events.filter(e=>e.date>b[0].date&&e.date<=cutoff);
 const returns=b.slice(1).map((x,i)=>{
  const es=used.filter(e=>e.date===x.date);
  if(es.length>1)throw Error('Multiple unverified corporate actions on one day');
  const e=es[0]??{cash:0,bonus:0};
  if(!Number.isFinite(e.cash)||!Number.isFinite(e.bonus)||e.cash<0||e.bonus<0)throw Error('Invalid corporate action');
  const base=(b[i].close-e.cash)/(1+e.bonus);
  if(base<=0)throw Error('Invalid ex-right reference');
  return x.close/base-1;
 });
 return {value:sampleVol(returns)*100,start:b[0].date,end:b.at(-1).date,observations:returns.length,actionsUsed:used};
}
export function selectStocks(rows,max=10) {
 const passing=rows.filter(x=>x.status==='PASS').sort((a,b)=>a.code.localeCompare(b.code));
 return {passing,selected:passing.slice(0,max)};
}
export function reconstructPe(close,shareCount,annual,financial,cutoff) {
 if(!Number.isFinite(close)||close<=0||shareCount?.date!==cutoff||shareCount?.paramDate!=='20250801'||!Number.isFinite(shareCount.value)||shareCount.value<=0)throw Error('Historical share count/close not verified');
 for(const f of [annual,financial])if(!f?.original||f.disclosed>=cutoff||f.currency!=='CNY')throw Error('Original pre-cutoff financial statement required');
 if(annual.period!=='2024-12-31')throw Error('Wrong annual base');
 const ttm=annual.profit+financial.current-financial.prior;
 if(!Number.isFinite(ttm))throw Error('Missing TTM inputs');
 if(ttm<0)return {value:close*shareCount.value/ttm,lower:close*shareCount.value/ttm,upper:close*shareCount.value/ttm,ttmProfit:ttm,reason:'TTM归母净利润非正，不符合正PE条件'};
 if(ttm===0)throw Error('Zero TTM denominator');
 const q=shareCount.quantum??0;
 return {value:close*shareCount.value/ttm,lower:close*(shareCount.value-q)/ttm,upper:close*(shareCount.value+q)/ttm,ttmProfit:ttm,unit:'倍',formula:'8月1日A股未复权收盘价×当日总股本÷(2024全年归母净利润+2025当期累计归母净利润−2024同期累计归母净利润)'};
}
export function screenStock(s,dates,cutoff) {
 const metrics={};const reasons=[];let failed=false,unknown=false;
 try {if(s.actionsState!=='verified')throw Error('Corporate-action history unavailable');metrics.vol=screeningVol(s.screenBars,s.events,dates,cutoff);if(metrics.vol.value>=2){failed=true;reasons.push('20日波动率不低于2%');}}catch(e){unknown=true;reasons.push('波动率待核验：'+e.message);metrics.vol=null;}
 if(s.peDate!==cutoff||s.peParamDate!=='20250801'||!Number.isFinite(s.pe)){unknown=true;metrics.pe=null;reasons.push('历史估值缺失或底层日期参数未核验');}
 else {metrics.pe={value:s.pe,date:s.peDate,unit:'倍',source:s.peSource,lower:s.peLower,upper:s.peUpper};if(s.peLower<=25&&s.peUpper>25){unknown=true;reasons.push('股本显示精度导致PE区间跨过25倍，待核验');}else if(s.pe<=0||s.pe>25){failed=true;reasons.push('PE非正值或超过25倍');}}
 const f=s.financial;
 if(!f||f.disclosed>=cutoff||f.period>cutoff||!f.original||f.currency!=='CNY'||!Number.isFinite(f.current)||!Number.isFinite(f.prior)) {unknown=true;metrics.profit=null;reasons.push('截止日前原始财报/同口径数值缺失');}
 else if(f.prior<=0){unknown=true;metrics.profit=null;reasons.push('去年同期利润非正，不计算同比');}
 else {metrics.profit={value:(f.current/f.prior-1)*100,current:f.current,prior:f.prior,unit:'%',amountUnit:'CNY元',period:f.period,disclosed:f.disclosed,source:f.url,sha256:f.pdfSha256};if(metrics.profit.value<=0){failed=true;reasons.push('归母净利润未同比增加');}}
 return {code:s.code,name:s.name,listingDate:s.listingDate,status:failed?'FAIL':unknown?'UNKNOWN':'PASS',metrics,reasons:reasons.length?reasons:['三项条件全部通过']};
}
export function navMetrics(rows) {
 if(rows.length<3||rows.some(x=>!Number.isFinite(x.nav)||x.nav<=0))throw Error('Invalid NAV');
 const r=rows.slice(1).map((x,i)=>x.nav/rows[i].nav-1);
 let peak=1,dd=0;for(const x of rows){peak=Math.max(peak,x.nav);dd=Math.max(dd,1-x.nav/peak);}
 return {returnPct:(rows.at(-1).nav-1)*100,annualizedVolatilityPct:sampleVol(r)*Math.sqrt(252)*100,maxDrawdownPct:dd*100,tradingDays:rows.length,closeToCloseObservations:r.length};
}
export function buyAndHold(stocks,dates,costs={buyFee:.0005,sellFee:.001,buySlip:.0005,sellSlip:.0005},dividends=true) {
 if(!stocks.length)throw Error('No verified positions; cannot fabricate portfolio');
 for(const x of Object.values(costs))if(!Number.isFinite(x)||x<0||x>=1)throw Error('Invalid costs');
 const states=stocks.map(s=>{
  if(s.holdBars.length!==dates.length||s.holdBars.some((b,i)=>b.date!==dates[i]||b.volume<=0||b.open<=0||b.close<=0||!Number.isFinite(b.close)||!Number.isFinite(b.open)))throw Error('Incomplete/untradeable holding data '+s.code);
  const entry=s.holdBars[0];
  // One-price bars may be locked at a price limit. Do not assume a fill.
  if(entry.high===entry.low||s.holdBars.at(-1).high===s.holdBars.at(-1).low)throw Error('Unverified one-price execution '+s.code);
  if(s.actionsState!=='verified')throw Error('Missing corporate actions '+s.code);
  return {s,shares:1/stocks.length/(entry.open*(1+costs.buySlip)*(1+costs.buyFee)),cash:0,nav:[]};
 });
 const daily=[];
 for(let i=0;i<dates.length;i++){
  for(const st of states){
   for(const e of st.s.events.filter(e=>e.date===dates[i]&&i>0)){
    if(!Number.isFinite(e.cash)||!Number.isFinite(e.bonus)||e.cash<0||e.bonus<0)throw Error('Unverified corporate action');
    if(dividends)st.cash+=st.shares*e.cash;
    st.shares*=1+e.bonus;
   }
   const exit=i===dates.length-1;
   st.nav.push(st.shares*st.s.holdBars[i].close*(exit?(1-costs.sellSlip)*(1-costs.sellFee):1)+st.cash);
  }
  daily.push({date:dates[i],nav:states.reduce((a,b)=>a+b.nav[i],0)});
 }
 return {metrics:navMetrics(daily),daily,positions:states.map(st=>({code:st.s.code,name:st.s.name,initialWeightPct:100/stocks.length,entryOpen:st.s.holdBars[0].open,exitClose:st.s.holdBars.at(-1).close,dividendCashPerInitialCapital:st.cash,finalSharesPerInitialCapital:st.shares,...navMetrics(st.nav.map((nav,i)=>({date:dates[i],nav:nav*stocks.length})))}))};
}
