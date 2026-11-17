import { evaluate, findMetric, validateRules, fields } from '../dist/logic.mjs';
export const chinaDate = now => new Date(+new Date(now)+8*3600000).toISOString().slice(0,10);
export function nextDue(schedule, now) {
 const date=chinaDate(now);
 for(let offset=0;offset<9;offset++) {
  const day=new Date(date+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+offset);
  const stamp=day.toISOString().slice(0,10);
  const candidate=new Date(stamp+'T'+schedule.time+':00+08:00');
  if(schedule.days.includes(day.getUTCDay())&&candidate>new Date(now))return candidate.toISOString();
 }
 throw new Error('无有效检查日期');
}
export function validateTask(input, snapshot) {
 if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>60)throw new Error('请给任务填一个不超过 60 字的名称');
 if(!Array.isArray(input.rules)||input.rules.length>12||input.rules.some(r=>!r||!fields[r.field]||!['gt','gte','lt','lte','eq'].includes(r.op)))throw new Error('筛选条件无效');
 const issue=validateRules(input.rules);if(issue)throw new Error(issue);
 if(!Array.isArray(input.codes)||!input.codes.length||input.codes.length>60||new Set(input.codes).size!==input.codes.length)throw new Error('请选择 1 至 60 只本次符合条件的股票');
 for(const code of input.codes){const s=snapshot.stocks.find(s=>s.pool&&s.code===code);if(!s||evaluate(s,input.rules,snapshot).status!=='in')throw new Error('只能保存本次已确认符合条件的样本股');}
 const s=input.schedule;
 if(!s||!['15:30','16:30','17:30','18:30'].includes(s.time)||!Array.isArray(s.days)||!s.days.length||s.days.some(d=>!Number.isInteger(d)||d<1||d>5))throw new Error('请选择北京时间收盘后的检查时间和工作日');
 const o=input.options;
 if(!o||!Number.isFinite(o.volRise)||o.volRise<10||o.volRise>500||!Number.isInteger(o.volDays)||o.volDays<2||o.volDays>120||typeof o.notices!=='boolean')throw new Error('请检查波动提醒设置');
 return {name:input.name.trim(),rules:input.rules.map(r=>({...r})),codes:input.codes,schedule:{time:s.time,days:[...new Set(s.days)].sort()},options:{volRise:o.volRise,volDays:o.volDays,notices:o.notices}};
}
export function inspectStock(task, stock, live, previous={}) {
 const row={code:stock.code,name:stock.name,asOf:live.asOf,source:'扶摇金融数据 API / iFinD MCP',evidence:[],issues:[...(live.issues??[])],events:[],notices:live.notices??[]};
 const next={...previous,noticeKeys:[...(previous.noticeKeys??[])]};
 if(!live.stock) row.issues.push('扶摇：未取得此股票的实时复查数据');
 const fresh=live.stock??{...stock,prices:[],reports:[],pe:null,industry:''};
 const result=evaluate(fresh,task.rules,{asOf:live.asOf,tradingDays:live.tradingDays,valuationAsOf:live.valuationAsOf});
 row.evidence=result.evidence.map(e=>({...e,inputs:e.rule.field==='pe'?{pe_ttm:fresh.pe}:e.rule.field==='profit'?{reports:fresh.reports.filter(r=>r.period===fresh.reports[0]?.period||r.period===(Number(fresh.reports[0]?.period?.slice(0,4))-1)+fresh.reports[0]?.period?.slice(4))}:e.rule.field==='industry'?{industry:fresh.industry,group:fresh.sector}:priceInputs(fresh,e.rule.days),source:fields[e.rule.field].source==='industry'?'扶摇行业映射':fields[e.rule.field].source==='prices'?'扶摇前复权日线':fields[e.rule.field].source==='valuation'?'扶摇估值快照':'扶摇累计利润表'}));
 row.conditionStatus=result.status;
 for(const e of row.evidence)if(e.pass===null)row.issues.push(fields[e.rule.field].label+'：'+(e.reason??'字段缺失'));
 if(result.status==='out'&&previous.conditionStatus==='in')row.events.push({type:'dropped',code:stock.code,text:stock.name+' 不再符合原来的筛选条件',date:live.asOf});
 if(result.status!=='unknown')next.conditionStatus=result.status;
 const volatility=findMetric(fresh,{field:'vol',days:task.options.volDays},{asOf:live.asOf,tradingDays:live.tradingDays});
 row.volatility={value:volatility.value,date:volatility.date,days:task.options.volDays,previous:previous.vol??null,previousDate:previous.volDate??null,riseThreshold:task.options.volRise};
 if(volatility.value===null)row.issues.push('波动提醒：'+(volatility.reason??'数据缺失'));
 else {
  if(Number.isFinite(previous.vol)&&previous.volDate!==live.asOf&&volatility.value>previous.vol*(1+task.options.volRise/100))row.events.push({type:'volatility',code:stock.code,text:stock.name+' 的日常涨跌幅度明显变大：'+previous.vol.toFixed(2)+'% → '+volatility.value.toFixed(2)+'%',date:live.asOf});
  next.vol=volatility.value;next.volDate=live.asOf;
 }
 if(task.options.notices&&live.noticesValid){
  for(const n of live.notices??[]){
   const key=n.date+'|'+n.title;
   if(!next.noticeKeys.includes(key)){
    if(n.date>=chinaDate(task.createdAt))row.events.push({type:'notice',code:stock.code,text:stock.name+' 首次检索到公告：'+n.title,date:n.date});
    next.noticeKeys.push(key);
   }
  }
  next.noticeKeys=next.noticeKeys.slice(-300);
 }
 row.issues=[...new Set(row.issues)];row.complete=row.issues.length===0;row.requests=live.requests??[];
 return {row,next};
}

function priceInputs(stock,days){
 const bars=stock.prices.slice(-days-1),r=bars.slice(1).map((b,i)=>b[1]/bars[i][1]-1);
 return {field:'close_price',adjust:'forward',unit:'CNY',start:bars[0],end:bars.at(-1),observations:bars.length,dailyReturns:r.length,sumDailyReturns:r.reduce((s,x)=>s+x,0),sumSquaredDailyReturns:r.reduce((s,x)=>s+x*x,0),definition:'区间涨跌幅=(末价/首价-1)*100；日收益率样本标准差*100，分母 n-1'};
}
