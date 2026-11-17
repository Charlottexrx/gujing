export const example = '想找利润比去年同期高、股价不超过每股盈利的25倍，而且近20个开市日股价每天的起伏低于2%的股票。';
export const fields = {
  gain: {label:'股价这段时间涨跌多少', evidenceLabel:'区间涨跌幅', unit:'%', source:'prices', days:20, op:'gt', value:5},
  vol: {label:'股价每天的起伏', evidenceLabel:'日收益率波动率', unit:'%', source:'prices', days:20, op:'lt', value:2},
  profit: {label:'公司比去年同期多赚多少', evidenceLabel:'归母净利润同比', unit:'%', source:'fundamentals', op:'gt', value:0},
  pe: {label:'股价是每股盈利的多少倍', evidenceLabel:'市盈率（TTM）', unit:'倍', source:'valuation', op:'lte', value:25},
  industry: {label:'公司属于哪个行业', source:'industry', op:'eq', value:''}
};
export const operators = {gt:'超过',gte:'至少',lt:'低于',lte:'不超过',eq:'等于'};
const mappings = [
  ['vol', /波动|每天的起伏|日常起伏|涨跌幅度|涨跌太大|大起大落|走势.{0,4}稳|每天.{0,6}(?:涨跌|幅度)/],
  ['gain', /涨幅|跌幅|涨势|上涨|上升趋势|整体上涨|涨得|涨了|涨跌幅|跑赢/],
  ['profit', /归母|净利润|利润|经营改善|赚得更多|业绩.{0,4}(?:增|好)/],
  ['pe', /估值|市盈率|每股盈利|\bpe\b/i],
];
const operatorPattern = /(不要超过|不要高于|不超过|不高于|低于|小于|不到|少于|至少|不低于|不小于|超过|高于|大于|等于|<=|>=|<|>|=|≤|≥)\s*(-?\d+(?:\.\d+)?)/;
const opNames = {'不要超过':'lte','不要高于':'lte','不超过':'lte','不高于':'lte','低于':'lt','小于':'lt','不到':'lt','少于':'lt','至少':'gte','不低于':'gte','不小于':'gte','超过':'gt','高于':'gt','大于':'gt','等于':'eq','<=':'lte','>=':'gte','<':'lt','>':'gt','=':'eq','≤':'lte','≥':'gte'};
const stockDate = value => new Date(value+'T00:00:00Z');
const fromDate = value => value.toISOString().slice(0,10);
const standardDeviation = values => {
  if (values.length < 2) return null;
  const sum = values.reduce((a,b)=>a+b,0);
  const mean = sum / values.length;
  return Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/(values.length-1));
};
export const isNumber = x => typeof x === 'number' && Number.isFinite(x);
export const percent = (x, signed=false) => isNumber(x) ? (signed && x>0 ? '+' : '')+x.toFixed(2)+'%' : '待核验';

export function makeRule(field, value = fields[field].value) {
  const schema = fields[field];
  return {field, value, op:schema.op, days:schema.days??null, inferred:true, phrase:''};
}

export const complianceMessage='不提供确定性涨跌预测、收益承诺或直接买卖建议。可以改为可核验的历史条件，例如「近20个交易日涨幅超过5%、每天的起伏低于2%」。历史表现不能保证未来结果。';
export function assessIntentBoundary(text) {
  const normalized=String(text??'').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').toLowerCase();
  // Remove only explicitly declined requests, not general instructions such as “不要解释”.
  const declined=/(?:不要|不需要|不要求|不寻求|无需|不提供|不做)(?:你|任何)?(?:直接买卖建议|确定性涨跌预测|收益承诺|收益保证|保证收益|保证盈利|买入建议|卖出建议|买卖建议|涨跌预测|预测涨跌|必涨|稳赚)/g;
  const request=normalized.replace(declined,'').replace(/[\s，。！？、；：,.!?;:"“”‘’（）()\-]/g,'');
  const categories=[];
  if(/必涨|必跌|一定(?:会)?(?:上涨|下跌|涨|跌|赚钱|盈利|赚)|肯定(?:会)?(?:上涨|下跌|涨|跌|赚)|(?:预测|确定|准确|告诉我|说准).{0,16}(?:明天|下周|未来|接下来).{0,12}(?:涨|跌|收益|赚)|(?:明天|下周).{0,10}(?:哪只|哪支|哪个).{0,6}(?:会涨|涨|上涨|跌)|sure(?:torise|togoup)/.test(request))categories.push('确定性涨跌预测');
  if(/稳赚|包赚|保证.{0,8}(?:收益|盈利|赚钱|回报|不亏)|(?:收益|盈利|回报).{0,5}(?:保证|承诺)|保本保息|零风险|不会亏|guarantee(?:d)?returns?|riskfree/.test(request))categories.push('收益承诺');
  if(/(?:直接|明确|具体).{0,10}(?:买|卖|建仓|清仓|抄底|加仓|减仓)|(?:告诉我|推荐|建议|帮我|让我|该|应该|现在就).{0,12}(?:买入|卖出|买哪|卖哪|买什么|卖什么|买股票|买这|卖这|卖掉|建仓|清仓|加仓|减仓)|(?:哪只|哪支|哪个|什么).{0,8}(?:值得买|可以买|适合买|该买|该卖|买入|卖出)|(?:买入|卖出|加仓|减仓|清仓|建仓).{0,8}(?:价位|价格|时机|点位|哪只)|(?:现在|今天|马上).{0,6}(?:买|卖)|(?:whichstock|tellme).{0,20}(?:buy|sell)/.test(request))categories.push('直接买卖建议');
  return {blocked:categories.length>0,categories,message:categories.length?complianceMessage:''};
}

export function parseIntent(text, industries, context=[]) {
  const normalized = text.normalize('NFKC').trim();
  const boundary=assessIntentBoundary(normalized);
  if (boundary.blocked) return {rules:[],notes:[boundary.message],blocked:true,violations:boundary.categories};
  if (context.length && /改|调整|放宽|收紧|提高|降低|设为|变成|放到/.test(normalized)) return reviseIntent(normalized,context,industries);
  const segments = normalized.split(/[、，,。；;\n]|(?:并且|而且|同时|并希望)/).map(x=>x.trim()).filter(Boolean);
  const rules = [];
  const notes = [];
  const unsupported=[];
  let sharedDays = null;
  for (const segment of segments) {
    const explicitDays = segment.match(/(?:近|最近|过去)?\s*(\d+)\s*(?:个)?\s*(?:交易日|开市日|天|日)/);
    const periodDays = explicitDays ? Number(explicitDays[1]) : /(?:半|15天)个月/.test(segment) ? 10 : /(?:三|3)个月/.test(segment) ? 60 : /(?:一|1)年/.test(segment) ? 240 : /(?:上周|本周|一周|1周)/.test(segment) ? 5 : /(?:最近|近|过去)(?:一|1|个)?(?:个)?月/.test(segment) ? 20 : null;
    if (periodDays) sharedDays = periodDays;
    const explicit = segment.match(operatorPattern) ?? segment.match(/(不超过|低于)\s*每股盈利的\s*(\d+(?:\.\d+)?)\s*倍/);
    const recognizedIndustry = industries.filter(industry=>segment.includes(industry)).sort((a,b)=>b.length-a.length);
    const genericIndustry = recognizedIndustry.length ? recognizedIndustry : /新能源/.test(segment) ? industries.filter(x=>x==='新能源与汽车') : [];
    if (genericIndustry.length) {
      rules.push({...makeRule('industry',genericIndustry[0]),phrase:segment,inferred:!recognizedIndustry.length});
      if (genericIndustry.length>1) notes.push('这句话涉及多个行业，请在条件卡里确认要筛选的行业。');
    }
    const applicable = mappings.filter(([,matcher])=>matcher.test(segment));
    const chosen = applicable.some(([field])=>field==='vol') && applicable.some(([field])=>field==='gain') &&
      !/上涨|涨势|涨得|涨了|整体上/.test(segment) ? applicable.filter(([field])=>field!=='gain') : applicable;
    for (const [field] of chosen) {
      const rule = makeRule(field);
      rule.phrase = segment;
      if (rule.days) rule.days = periodDays ?? sharedDays ?? rule.days;
      if (explicit && chosen.length === 1) {
        rule.op = opNames[explicit[1]];
        rule.value = Number(explicit[2]);
        rule.inferred = Boolean(rule.days && !explicitDays);
      } else if (chosen.length>1 && explicit) {
        notes.push('这句话里有多个指标。请在下面确认数字对应的是哪条条件。');
      }
      if (field==='profit' && /单季|最近一季|上一季/.test(segment)) notes.push('此版本的利润同比采用最新披露的累计报告期。请确认这个口径。');
      if (field==='pe' && /同行|行业中位|行业平均/.test(segment)) notes.push('当前条件卡支持固定市盈率范围。若希望和同行比，可先用行业筛选，再比较结果。');
      rules.push(rule);
    }
    if (!chosen.length && !genericIndustry.length && /行业|板块|只看|只选|只要|因子|指标|夏普|动量|换手/.test(segment)) {
      unsupported.push(segment);
      notes.push(/因子|指标|夏普|动量|换手/.test(segment)?'该指标暂不支持，未添加任何虚构条件。':'这个行业在当前样本里未匹配到。可以手动选择样本中可用的行业。');
    }
  }
  if (!rules.length && !notes.length) notes.push('请再写具体一点，比如「近 20 个交易日涨幅超过 5%」，也可以手动添加条件。');
  return {rules:rules.slice(0,12),notes:[...new Set(notes)],unsupported};
}

export function validateRules(rules) {
  if (!Array.isArray(rules)||!rules.length) return '请至少添加一条筛选条件。';
  if(rules.length>12) return '筛选条件最多 12 条。';
  const groups = new Map();
  for (const rule of rules) {
    if(!rule||!Object.hasOwn(fields,rule.field)||!Object.hasOwn(operators,rule.op)) return '筛选条件包含不支持的指标或比较方式。';
    if(rule.field==='industry'&&rule.op!=='eq')return '行业只能使用等于条件。';
    if (rule.field==='industry') {
      if (typeof rule.value!=='string'||!rule.value.trim()) return '请为行业条件选择一个行业。';
    } else if (!isNumber(rule.value)) {
      return '请给每一条条件填一个数字。';
    } else if (fields[rule.field].days && (!Number.isInteger(rule.days)||rule.days<2||rule.days>1200)) {
      return '请填 2 到 1200 个开市日。';
    } else if (rule.field==='vol' && (rule.value<0 || (rule.op==='lt' && rule.value===0))) {
      return '股价每天的起伏至少是 0%，请调整这条条件。';
    }
    const key = rule.field+':'+(rule.days??'');
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(rule);
  }
  for (const group of groups.values()) {
    if (group[0].field==='industry') {
      if (new Set(group.map(r=>r.value)).size>1) return '两条行业条件互相冲突。请只保留一个行业。';
      continue;
    }
    let lower=-Infinity,upper=Infinity,includeLower=true,includeUpper=true;
    for (const r of group) {
      if (['gt','gte','eq'].includes(r.op) && r.value>=lower) {
        includeLower = r.value===lower ? includeLower && r.op!=='gt' : r.op!=='gt';
        lower=r.value;
      }
      if (['lt','lte','eq'].includes(r.op) && r.value<=upper) {
        includeUpper = r.value===upper ? includeUpper && r.op!=='lt' : r.op!=='lt';
        upper=r.value;
      }
    }
    if (lower>upper || (lower===upper && (!includeLower||!includeUpper))) return fields[group[0].field].label+'的条件互相冲突，请修改上限或下限。';
  }
  return '';
}

export const sameRule = (value, rule) => ({
  gt:()=>value>rule.value, gte:()=>value>=rule.value, lt:()=>value<rule.value,
  lte:()=>value<=rule.value, eq:()=>value===rule.value
})[rule.op]();

export function findMetric(stock, rule, dataset) {
  const cutoff=dataset.asOf;
  if(!Object.hasOwn(fields,rule.field))return {value:null,reason:'指标不受支持'};
  if (rule.field==='industry') {
    if(dataset.pointInTime && (!stock.industryAsOf||stock.industryAsOf>cutoff))return {value:null,date:stock.industryAsOf,reason:'缺少该历史时点的行业映射'};
    return {value:stock.industry||null,date:stock.industryAsOf??dataset.industryAsOf??'行业映射取数日期未记录'};
  }
  if (rule.field==='pe') {
    const date=stock.valuationAsOf??dataset.valuationAsOf;
    if(!date)return {value:null,reason:'估值时点缺失，不能当作已核验数字'};
    if(date<new Date(+new Date(cutoff)-3*86400000).toISOString().slice(0,10))return {value:null,date,reason:'估值快照已过期（早于研究时点超过3个自然日）'};
    if(dataset.pointInTime&&(!date||date>cutoff))return {value:null,date,reason:'该估值快照晚于回测时点，不能使用未来估值'};
    return {value:isNumber(stock.pe)&&stock.pe>0?stock.pe:null,date,reason:isNumber(stock.pe)&&stock.pe>0?undefined:isNumber(stock.pe)&&stock.pe<=0?'市盈率非正值，当前口径暂不参与比较':'估值字段缺失'};
  }
  if (rule.field==='profit') {
    const reports=(stock.reports??[]).filter(r=>r&&r.period<=cutoff&&r.disclosed&&r.disclosed<=cutoff).sort((a,b)=>b.period.localeCompare(a.period));
    const last=reports[0];
    if (!last) return {value:null,reason:'利润表缺失，或报告尚未在研究时点披露'};
    if(+new Date(cutoff)-+new Date(last.period)>190*86400000)return {value:null,date:last.period,reason:'财务报告期距研究时点超过190个自然日，数据过期待核验'};
    const priorDate=(Number(last.period.slice(0,4))-1)+last.period.slice(4);
    const prior=reports.find(report=>report.period===priorDate);
    const date=last.period+' 对比 '+priorDate+' · 披露 '+last.disclosed;
    if (!prior || !isNumber(last.profit) || !isNumber(prior.profit) || prior.profit<=0 || last.currency!==prior.currency) return {value:null,date,reason:'缺少同口径可比数据，或去年同期利润不为正'};
    return {value:(last.profit/prior.profit-1)*100,date,raw:Math.round(last.profit).toLocaleString('zh-CN')+' / '+Math.round(prior.profit).toLocaleString('zh-CN')+' '+last.currency,inputs:{current:last,prior}};
  }
  const all=(stock.prices??[]).filter(b=>b[0]<=cutoff).sort((a,b)=>a[0].localeCompare(b[0]));
  const bars=all.slice(-rule.days-1);
  if(stock.suspended===true)return {value:null,reason:'已标记停牌，当前价格条件待核验',date:bars.at(-1)?.[0]};
  const expected=dataset.tradingDays?.filter(d=>d<=cutoff).slice(-rule.days-1);
  const hasGaps=expected?.length===rule.days+1 && bars.some((bar,index)=>bar[0]!==expected[index]);
  if (bars.length!==rule.days+1 || bars.at(-1)?.[0]!==cutoff || hasGaps) {
    const young=stock.listingDate&&(+new Date(cutoff)-+new Date(stock.listingDate))<30*86400000;
    return {value:null,reason:young?'上市不足30个自然日，缺少 '+(rule.days+1)+' 条收盘价（不能推算）':bars.at(-1)?.[0]!==cutoff?'末日行情缺失或过期；停牌状态未核实':'缺少当前时点的足量复权日线或中间交易日缺口',date:bars.at(-1)?.[0],inputs:{available:bars.length,required:rule.days+1,listingDate:stock.listingDate??null}};
  }
  if(bars.some(b=>!Array.isArray(b)||!isNumber(b[1])||b[1]<=0))return {value:null,reason:'原始收盘价字段无效，不能生成正常指标'};
  const returns=bars.slice(1).map((item,index)=>item[1]/bars[index][1]-1);
  const value=rule.field==='gain' ? (bars.at(-1)[1]/bars[0][1]-1)*100 : standardDeviation(returns)*100;
  return {value,date:bars[0][0]+' 至 '+bars.at(-1)[0],raw:'前复权收盘价 · '+bars.length+' 条',inputs:{field:'close_price',adjust:'forward',currency:'CNY',prices:bars}};
}

export function evaluate(stock, rules, dataset) {
  const evidence = rules.map(rule=>{
    const metric=findMetric(stock,rule,dataset);
    let pass=null;
    if (metric.value!==null) pass=rule.field==='industry' ? ([stock.sector,...metric.value.split(', ')].includes(rule.value)) : sameRule(metric.value,rule);
    return {rule,...metric,pass,kind:metric.value===null?'uncertain':'fact',judgementKind:pass===null?'uncertain':'inference'};
  });
  return {stock,evidence,status:evidence.some(e=>e.pass===false)?'out':evidence.some(e=>e.pass===null)?'unknown':'in'};
}

export function slicePrices(prices, mode, asOf, screeningDays=20) {
  prices=prices.filter(([date])=>date<=asOf);
  if (!prices.length || mode==='today') return [];
  if (mode==='screen') return prices.slice(-screeningDays-1);
  if (mode==='history') return prices;
  const today=stockDate(asOf);
  const start=stockDate(asOf);
  if (mode==='week') start.setUTCDate(today.getUTCDate()-(today.getUTCDay()+6)%7);
  if (mode==='month') start.setUTCDate(1);
  if (mode==='quarter' || mode==='year') {
    const offset=mode==='quarter'?3:12;
    start.setUTCDate(1);
    start.setUTCMonth(today.getUTCMonth()-offset);
    const lastOfMonth=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();
    start.setUTCDate(Math.min(today.getUTCDate(),lastOfMonth));
  }
  const since=fromDate(start);
  const first=prices.findIndex(bar=>bar[0]>=since);
  return first<0?[]:prices.slice(first);
}

export function pathMetrics(bars) {
  if (bars.length<2) return {gain:null,vol:null,min:null,max:null};
  const prices=bars.map(row=>row[1]);
  const returns=prices.slice(1).map((p,i)=>p/prices[i]-1);
  const vol=standardDeviation(returns);
  return {gain:(prices.at(-1)/prices[0]-1)*100,vol:vol===null?null:vol*100,min:Math.min(...prices),max:Math.max(...prices)};
}

export function alignedReturns(stocks, asOf) {
  if (!stocks.length) return null;
  const cutoff=stockDate(asOf);
  cutoff.setUTCDate(cutoff.getUTCDate()-365);
  const maps=stocks.map(stock=>new Map(stock.prices.filter(([d])=>d>=fromDate(cutoff)&&d<=asOf)));
  const timeline=[...new Set(maps.flatMap(map=>[...map.keys()]))].sort();
  const fullDates=timeline.filter(day=>maps.every(map=>map.has(day)));
  if (fullDates.length<61 || fullDates.at(-1)!==asOf || fullDates.length<timeline.length*.92) return null;
  const pairs=timeline.slice(1).map((day,index)=>[timeline[index],day])
    .filter(([before,after])=>maps.every(map=>map.has(before)&&map.has(after)));
  if (pairs.length<60) return null;
  return {dates:fullDates, returnDates:pairs.map(([,after])=>after),
    returns:maps.map(map=>pairs.map(([before,after])=>map.get(after)/map.get(before)-1))};
}

export class SnapshotError extends Error {
  constructor(kind, message) {
    super(message);
    this.name='SnapshotError';
    this.kind=kind;
  }
}

export function validMarketSnapshot(data) {
  return Boolean(data && typeof data.asOf==='string' && Array.isArray(data.stocks) &&
    data.stocks.length && data.stocks.some(stock=>stock.pool && stock.prices?.length) &&
    data.stocks.every(stock=>typeof stock.code==='string' && typeof stock.name==='string' &&
      typeof stock.industry==='string' && Array.isArray(stock.prices) && Array.isArray(stock.reports)));
}

export function validNoticeSnapshot(data) {
  return Boolean(data && typeof data.asOf==='string' && Array.isArray(data.attempted) &&
    data.notices && typeof data.notices==='object' && !Array.isArray(data.notices) &&
    Object.values(data.notices).some(rows=>Array.isArray(rows) && rows.length) &&
    Object.values(data.notices).every(rows=>Array.isArray(rows) && rows.every(row=>
      typeof row.title==='string' && Boolean(row.title.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(row.date))));
}

export function sourceFailureText(source, error) {
  const reason=error?.kind==='timeout' ? '请求超时' :
    error?.kind==='empty' ? '返回了空数据或不完整的数据' : '调用失败';
  return source==='fuyao' ? '扶摇数据没拿到：'+reason+'。筛选和组合计算暂不可用，请刷新后重试。' :
    'iFinD 公告没拿到：'+reason+'。公告核验未完成，筛选仅依据扶摇行情和财务数据，请刷新后重试。';
}

export async function readSnapshot(url, isValid, request=fetch, timeoutMs=6000) {
  const controller=new AbortController();
  let timer;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      reject(new SnapshotError('timeout','snapshot timeout'));
      controller.abort();
    },timeoutMs);
  });
  const loading=(async()=>{
    const response=await request(url,{signal:controller.signal,cache:'no-store'});
    if (!response.ok) throw new SnapshotError('error','snapshot unavailable');
    const data=await response.json();
    if (data && typeof data==='object' &&
        ((Object.hasOwn(data,'code') && data.code!==0) || data.ok===false || data.error)) {
      throw new SnapshotError('error','snapshot upstream error');
    }
    if (!isValid(data)) throw new SnapshotError('empty','snapshot incomplete');
    return data;
  })();
  try {
    return await Promise.race([loading,deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function portfolioMetrics(streams, weights) {
  const daily=streams[0].map((_,day)=>streams.reduce((sum,series,i)=>sum+series[day]*weights[i],0));
  let net=1, peak=1, drawdown=0;
  for (const observation of daily) {
    net*=1+observation;
    peak=Math.max(peak,net);
    drawdown=Math.max(drawdown,1-net/peak);
  }
  return {gain:(net-1)*100, vol:standardDeviation(daily)*Math.sqrt(252)*100, drawdown:drawdown*100};
}

export function diversification(stocks, candidates, asOf, weights, allocation, objective, ceiling) {
  const historical=[...stocks,...candidates].some(s=>s.prices.some(([d])=>d>asOf));
  const sectorAt=s=>historical?((s.industryAsOf&&s.industryAsOf<=asOf)?s.sector:null):(s.sector||s.industry);
  const currentSectors=new Set(stocks.map(sectorAt).filter(Boolean));
  return candidates.filter(s=>!stocks.includes(s)).flatMap(stock=>{
    const aligned=alignedReturns([...stocks,stock],asOf);
    if (!aligned) return [];
    const before=portfolioMetrics(aligned.returns,[...weights,0]);
    const after=portfolioMetrics(aligned.returns,[...weights.map(x=>x*(1-allocation)),allocation]);
    const sector=sectorAt(stock);
    const outsider=Boolean(sector)&&!currentSectors.has(sector);
    const baseline=aligned.returns[0].map((_,i)=>aligned.returns.slice(0,-1).reduce((sum,s,index)=>sum+s[i]*weights[index],0));
    const meanS=baseline.reduce((a,b)=>a+b,0)/baseline.length;
    const next=aligned.returns.at(-1);
    const meanN=next.reduce((a,b)=>a+b,0)/next.length;
    const v=standardDeviation(baseline)*standardDeviation(next);
    const correlation=v>0?baseline.reduce((sum,x,i)=>sum+(x-meanS)*(next[i]-meanN),0)/(baseline.length-1)/v:null;
    return [{stock,before,after,outsider,correlation,dates:aligned.dates}];
  }).filter(x=>objective==='risk' ? x.after.vol<x.before.vol : x.after.vol<=ceiling)
    .sort((a,b)=>{
      const bySector=currentSectors.size===1 && objective==='risk' ? Number(b.outsider)-Number(a.outsider) : 0;
      return bySector || (objective==='risk' ? (a.after.vol-a.before.vol)-(b.after.vol-b.before.vol) : b.after.gain-a.after.gain);
    })
    .slice(0,3);
}

function reviseIntent(text,context,industries){
 const base=context.map(r=>({...r}));
 if(validateRules(base))return {rules:[],notes:['上一轮条件无效，请重新描述。']};
 const targets=mappings.filter(([,pattern])=>pattern.test(text)).map(([f])=>f);
 const match=text.match(/(?:改为|改成|改到|放宽到|放宽至|调整为|调整到|设为|变成|提高到|降低到|收紧到|收紧至|放到)\s*(-?\d+(?:\.\d+)?)/);
 if(!match)return {rules:base,notes:['请说清要改哪一项和新的数字，例如「把涨幅上限改到40%」。'],needsClarification:true};
 if(!targets.length&&/因子|指标|夏普|动量|换手/.test(text))return {rules:base,notes:['这个指标尚不支持，没有添加或修改条件。'],needsClarification:true};
 const indexes=base.map((r,i)=>[r,i]).filter(([r])=>targets.length?targets.includes(r.field):r.field!=='industry');
 if(indexes.length!==1)return {rules:base,notes:['有多条可能对应的条件，请指明指标和时间窗口，或直接改条件卡。'],needsClarification:true};
 const [old,index]=indexes[0],value=Number(match[1]);let op=old.op;
 const explicit=text.match(operatorPattern);if(explicit)op=opNames[explicit[1]];
 if(/上限/.test(text))op='lte';if(/下限/.test(text))op='gte';
 base[index]={...old,value,op,inferred:false,phrase:text};
 const tighten=(['gt','gte'].includes(op)&&value>old.value)||(['lt','lte'].includes(op)&&value<old.value);
 return {rules:base,notes:['沿用上一轮的其他条件，只调整「'+fields[old.field].label+'」。'+(/放宽/.test(text)&&tighten?'这个改法实际会收紧条件，请确认上限或下限。':'')],contextUpdated:true};
}
