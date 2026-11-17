import {fields,validateRules,findMetric,evaluate,isNumber,assessIntentBoundary} from './logic.mjs';
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
export const chinaToday=now=>new Date(+new Date(now)+8*3600000).toISOString().slice(0,10);
export function freshness(asOf,now=new Date(),maxAgeDays=3){
 if(!day(asOf))return {status:'unknown',label:'时点未记录，待核验'};
 const age=Math.floor((+new Date(chinaToday(now)) - +new Date(asOf))/86400000);
 return age<0?{status:'invalid',label:'时点晚于当前日期，待核验'}:age>maxAgeDays?{status:'stale',label:'已过 '+age+' 个自然日，可能过期，不能当作最新数据'}:{status:'historical',label:'历史快照，截至 '+asOf+'；不代表实时行情'};
}
export function provenance(stock,rule,dataset,now=new Date()){
 const metric=findMetric(stock,rule,dataset),source=fields[rule.field]?.source;
 const asOf=source==='prices'?dataset.asOf:source==='valuation'?(stock.valuationAsOf??dataset.valuationAsOf):source==='fundamentals'?(metric.inputs?.current?.disclosed??stock.reports.filter(r=>r&&r.disclosed<=dataset.asOf).sort((a,b)=>b.period.localeCompare(a.period))[0]?.disclosed):(stock.industryAsOf??dataset.industryAsOf);
 const formula={gain:'(末价/首价-1)×100；前复权',vol:'简单日收益率的样本标准差×100；分母n−1',profit:'(本期累计归母净利润/去年同期−1)×100；去年同期须为正',pe:'pe_ttm；非正值不参与比较',industry:'供应商原始行业标签，六组为本产品归类'}[rule.field];
 const age=freshness(asOf,now,source==='fundamentals'?190:3);
 return {source:'扶摇金融数据 API',url:dataset.refs?.[source]??'https://fuyao.aicubes.cn/docs/',field:{gain:'close_price',vol:'close_price',pe:'pe_ttm',profit:'parent_holder_net_profit',industry:'index_list.name'}[rule.field],unit:fields[rule.field]?.unit??'行业标签',asOf:asOf??null,period:metric.date??'时点缺失',formula,freshness:age,inputs:metric.inputs??(rule.field==='pe'?{pe_ttm:stock.pe}:null)};
}
export function specialStockNotes(stock,dataset){
 const notes=[];
 if(stock.isST===true||/^\*?ST/i.test(stock.name))notes.push('ST 风险标记；仍按数据条件判断，风险状态需单独核验');
 if(stock.suspended===true)notes.push('停牌标记；价格条件待核验');
 if(stock.listingDate&&(+new Date(dataset.asOf)-+new Date(stock.listingDate))<30*86400000)notes.push('上市不足30个自然日；长窗口数据可能不足');
 if(typeof stock.isST!=='boolean'||typeof stock.suspended!=='boolean'||!stock.listingDate)notes.push('ST、停牌或上市日期元数据未完整取得，状态待核验');
 return notes;
}
export function noticeCoverage(stock,snapshot,status='ready'){
 if(status!=='ready')return {state:'unavailable',label:'公告未取得 · 待核验'};
 if(snapshot?.notices?.[stock.code]?.length)return {state:'covered',label:'有公告样本 · 截至 '+snapshot.asOf+' · iFinD · 非全量'};
 if(snapshot?.attempted?.includes(stock.code))return {state:'missing',label:'已检索但无可核验公告 · 待核验'};
 return {state:'not-covered',label:'未纳入公告样本 · 不代表没有公告'};
}
export function compareScreen(stocks,before,after,dataset){
 const pool=stocks.filter(s=>s.pool),a=pool.map(s=>evaluate(s,before,dataset)),b=pool.map(s=>evaluate(s,after,dataset));
 const old=new Set(a.filter(r=>r.status==='in').map(r=>r.stock.code)),next=new Set(b.filter(r=>r.status==='in').map(r=>r.stock.code));
 return {results:b,added:[...next].filter(c=>!old.has(c)),removed:[...old].filter(c=>!next.has(c)),uncertain:b.filter(r=>r.status==='unknown').map(r=>r.stock.code)};
}
export function explainEmpty(stocks,rules,dataset){
 const pool=stocks.filter(s=>s.pool),rows=pool.map(s=>evaluate(s,rules,dataset));
 if(rows.some(r=>r.status==='in'))return [];
 return rules.map((rule,index)=>{
  const failed=rows.filter(r=>r.evidence[index].pass===false).length,missing=rows.filter(r=>r.evidence[index].pass===null).length;
  const eligible=rows.filter(r=>r.evidence.every((e,i)=>i===index||e.pass===true));
  const vals=eligible.map(r=>r.evidence[index].value).filter(isNumber).sort((a,b)=>a-b);
  let proposed=null;
  if(vals.length&&['lt','lte'].includes(rule.op))proposed={...rule,value:vals[0],op:'lte',inferred:true};
  if(vals.length&&['gt','gte'].includes(rule.op))proposed={...rule,value:vals.at(-1),op:'gte',inferred:true};
  const count=proposed?pool.filter(s=>evaluate(s,rules.map((r,i)=>i===index?proposed:r),dataset).status==='in').length:0;
  return {index,rule,failed,missing,proposed:count?proposed:null,count};
 }).sort((a,b)=>b.count-a.count||b.failed-a.failed);
}
export function validateResearchProposal(proposal,stocks,dataset){
 if(!proposal||!Array.isArray(proposal.rules))throw new Error('提议缺少结构化条件');
 const problem=validateRules(proposal.rules);if(problem)throw new Error(problem);
 for(const r of proposal.rules)if(r.field==='industry'&&!stocks.some(s=>s.sector===r.value||s.industry.split(', ').includes(r.value)))throw new Error('行业不在当前可核验样本中');
 const verified=[];
 if(proposal.claims!==undefined&&!Array.isArray(proposal.claims))throw new Error('数值声明格式无效');
 for(const claim of proposal.claims??[]){
  if(!claim||!Object.hasOwn(fields,claim.field))throw new Error('声明包含不存在的指标');
  const stock=stocks.find(s=>s.code===claim.code);if(!stock)throw new Error('声明包含不存在的股票');
  const rule={field:claim.field,days:claim.days??null};
  if(fields[rule.field].days&&(!Number.isInteger(rule.days)||rule.days<2||rule.days>1200))throw new Error('声明缺少有效时间窗口');
  const metric=findMetric(stock,rule,dataset);const proof=provenance(stock,rule,dataset);
  if(metric.value===null)throw new Error('缺失的数据不能声明为已知数字');
  if((isNumber(metric.value)&&(!isNumber(claim.value)||Math.abs(claim.value-metric.value)>1e-8))||(!isNumber(metric.value)&&claim.value!==metric.value))throw new Error('数字或字段内容与原始数据不一致');
  if(claim.source!==undefined&&claim.source!==proof.source)throw new Error('声明来源与原始来源不一致');
  if(claim.asOf!==proof.asOf||claim.unit!==proof.unit)throw new Error('来源时点或单位与原始数据不一致');
  verified.push({code:stock.code,field:claim.field,value:metric.value,provenance:proof});
 }
 return {rules:proposal.rules.map(({field,op,value,days,inferred,phrase})=>({field,op,value,days:days??null,inferred:inferred??false,phrase:''})),verified};
}
export function pointInTime(dataset,cutoff){
 if(!day(cutoff)||cutoff>dataset.asOf)throw new Error('历史时点无效');
 return {...dataset,asOf:cutoff,pointInTime:true,tradingDays:(dataset.tradingDays??[]).filter(d=>d<=cutoff),stocks:dataset.stocks.map(s=>({...s,prices:s.prices.filter(([d])=>d<=cutoff),reports:s.reports.filter(r=>r.disclosed&&r.disclosed<=cutoff&&r.period<=cutoff),pe:s.valuationAsOf&&s.valuationAsOf<=cutoff?s.pe:null,industry:s.industryAsOf&&s.industryAsOf<=cutoff?s.industry:'',sector:s.industryAsOf&&s.industryAsOf<=cutoff?s.sector:null}))};
}
export function shareScreen(rules,origin,asOf){
 const problem=validateRules(rules);if(problem)throw new Error(problem);
 const payload={version:1,asOf,rules:rules.map(({field,op,value,days})=>({field,op,value,days:days??null}))};
 const url=new URL(origin);url.search='';url.username='';url.password='';url.hash='screen='+encodeURIComponent(JSON.stringify(payload));return url.href;
}
export function readSharedScreen(hash){
 if(!hash.startsWith('#screen='))return null;
 if(hash.length>12000)throw new Error('分享条件过长');
 let v;try{v=JSON.parse(decodeURIComponent(hash.slice(8)));}catch{throw new Error('分享链接条件损坏');}
 if(v.version!==1||!Array.isArray(v.rules)||Object.keys(v).some(k=>!['version','asOf','rules'].includes(k)))throw new Error('分享格式不支持');
 if(v.rules.some(r=>!r||Object.keys(r).some(k=>!['field','op','value','days'].includes(k))))throw new Error('分享条件含不支持的字段');
 const problem=validateRules(v.rules);if(problem)throw new Error(problem);
 return v;
}
