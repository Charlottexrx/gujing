import { chinaDate } from './monitor.mjs';
const BASE='https://fuyao.aicubes.cn';
const NEWS='https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-news-mcp';
const shiftDay=(day,n)=>new Date(+new Date(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const ms=day=>+new Date(day+'T00:00:00+08:00');
function safeDate(n){return Number.isFinite(n)&&n>0?chinaDate(n):null;}
async function responseBody(response){
 if(!(response.headers.get('Content-Type')??'').includes('text/event-stream')){
  try{return JSON.parse(await response.text());}catch(e){if(e.name==='AbortError')throw e;throw new Error('返回内容无法识别');}
 }
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
 try{
  while(true){
   const {done,value}=await reader.read();buffer+=decoder.decode(value??new Uint8Array(),{stream:!done});
   const messages=buffer.split(/\r?\n\r?\n/);buffer=messages.pop()??'';if(done&&buffer)messages.push(buffer);
   for(const message of messages){
    const data=message.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');
    if(!data)continue;try{const packet=JSON.parse(data);if(packet.result||packet.error)return packet;}catch{}
   }
   if(done)throw new Error('返回内容无法识别');
  }
 }finally{await reader.cancel().catch(()=>{});}
}
export async function requestJson(url,headers,options={},fetcher=fetch,timeout=20000){
 const controller=new AbortController();let timer;
 try{
  return await Promise.race([(async()=>{
   const response=await fetcher(url,{...options,headers,signal:controller.signal});
   if(!response.ok)throw new Error('接口报错（HTTP '+response.status+'）');
   return {body:await responseBody(response),headers:response.headers};
  })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('请求超时'));},timeout);})]);
 }catch(error){throw new Error(error.name==='AbortError'?'请求超时':['请求超时','返回内容无法识别'].includes(error.message)||error.message.startsWith('接口报错')?error.message:'网络连接失败');}
 finally{clearTimeout(timer);}
}
export async function fuyao(env,path,params,fetcher=fetch){
 if(!env.FUYAO_API_KEY)throw new Error('未配置扶摇密钥');
 const {body}=await requestJson(BASE+path+'?'+new URLSearchParams(params),{'X-api-key':env.FUYAO_API_KEY},{},fetcher);
 if(body.code!==0)throw new Error('接口返回错误（业务码 '+String(body.code??'未知')+'）');
 if(!Array.isArray(body.data?.item)||!body.data.item.length)throw new Error('接口返回空数据');
 return {data:body.data,request:{source:'扶摇',endpoint:path,parameters:params,requestId:body.request_id??null,receivedAt:new Date().toISOString()}};
}
export async function noticeSession(env,fetcher=fetch){
 if(!env.IFIND_MCP_KEY)throw new Error('未配置 iFinD 密钥');
 const headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream','Authorization':env.IFIND_MCP_KEY,'User-Agent':'codex'};
 let init;try{init=await requestJson(NEWS,headers,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'stock-lens-monitor',version:'1.0'}}})},fetcher);}catch(e){throw new Error('初始化：'+e.message);}
 const session=init.headers.get('mcp-session-id');if(init.body.error||!init.body.result||!session)throw new Error('初始化失败');
 headers['Mcp-Session-Id']=session;
 // Notifications may return HTTP 202 with no body.
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
 try{const r=await fetcher(NEWS,{method:'POST',headers,signal:controller.signal,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});if(!r.ok)throw new Error('初始化确认失败');}finally{clearTimeout(timer);}
 return headers;
}
export async function fetchNotices(headers,stock,begin,end,fetcher=fetch){
 const args={query:stock.name+' '+stock.code+' 公司公告',time_start:begin,time_end:end,size:50};
 const {body}=await requestJson(NEWS,headers,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'search_notice',arguments:args}})},fetcher);
 const result=body.result;if(body.error||!result||result.isError)throw new Error('公告接口返回错误');
 const rows=[];let valid=false,truncated=false;
 for(const entry of result.content??[]){
  if(entry.type!=='text')continue;
  let packet;try{packet=JSON.parse(entry.text);}catch{continue;}
  if(packet.code!==1)throw new Error('公告接口返回业务错误');
  let payload=packet.data;try{if(typeof payload==='string')payload=JSON.parse(payload);}catch{throw new Error('公告返回内容无法识别');}
  if(!Array.isArray(payload))continue;
  valid=true;if(payload.length>=50||/截断|truncat/i.test(packet.msg??''))truncated=true;
  for(const row of payload){const title=row['公告标题'],date=row['日期'];if(typeof title==='string'&&title.includes(stock.name)&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>=begin&&date<=end)rows.push({title:title.trim(),date});}
 }
 if(!valid||!rows.length)throw new Error('未返回可核验公告，不能确认是否有新公告');
 return {rows:[...new Map(rows.map(n=>[n.date+'|'+n.title,n])).values()],truncated,request:{source:'iFinD',endpoint:'news/search_notice',parameters:args,receivedAt:new Date().toISOString()}};
}
export async function liveBatch(env,task,stocks,now=new Date(),fetcher=fetch){
 const today=chinaDate(now);const chinaClock=new Date(+new Date(now)+8*3600000).toISOString().slice(11,16);const calendarEnd=chinaClock>='15:30'?today:shiftDay(today,-1);const maxDays=Math.max(task.options.volDays,...task.rules.map(r=>r.days??0));
 const start=shiftDay(today,-Math.ceil(maxDays*1.9+90));
 let asOf=today,tradingDays=[],calendarIssue='',requests=[];
 try{
  const c=await fuyao(env,'/api/a-share/calendar/trading-days',{start_date:start.replaceAll('-',''),end_date:calendarEnd.replaceAll('-','')},fetcher);requests.push(c.request);
  tradingDays=c.data.item.map(r=>/^\d{8}$/.test(r.date)?r.date.slice(0,4)+'-'+r.date.slice(4,6)+'-'+r.date.slice(6,8):safeDate(r.date_ms)).filter(Boolean).sort();
  if(!tradingDays.length)throw new Error('交易日历为空');asOf=tradingDays.at(-1);
 }catch(e){calendarIssue='交易日历：'+e.message;}
 const issues=stocks.map(()=>calendarIssue?[calendarIssue]:[]);
 const outputs=stocks.map((s,i)=>({stock:{...s,prices:[],reports:[],pe:null,industry:''},asOf,tradingDays,issues:issues[i],requests:[...requests],notices:[],noticesValid:false}));
 const prices=fuyao(env,'/api/a-share/prices/historical-batch',{thscodes:stocks.map(s=>s.code).join(','),interval:'1d',start:ms(start),end:ms(today)+86399000,adjust:'forward'},fetcher).then(p=>{
  for(let i=0;i<stocks.length;i++){
   outputs[i].requests.push(p.request);const group=p.data.item.find(x=>x.thscode===stocks[i].code);
   const bars=new Map((group?.item??[]).filter(b=>safeDate(b.date_ms)&&Number.isFinite(b.close_price)&&b.close_price>0).map(b=>[safeDate(b.date_ms),b.close_price]));
   outputs[i].stock.prices=[...bars].filter(b=>b[0]<=asOf).sort((a,b)=>a[0].localeCompare(b[0]));
   if(outputs[i].stock.prices.at(-1)?.[0]!==asOf)issues[i].push('扶摇行情缺失或过期，未取得 '+asOf+' 收盘价');
   if(calendarIssue)outputs[i].stock.prices=[];
  }
 }).catch(e=>issues.forEach(list=>list.push('扶摇行情：'+e.message)));
 const valuation=task.rules.some(r=>r.field==='pe')?fuyao(env,'/api/a-share/valuations/snapshot',{thscodes:stocks.map(s=>s.code).join(',')},fetcher).then(p=>{
  for(let i=0;i<stocks.length;i++){outputs[i].requests.push(p.request);const row=p.data.item.find(s=>s.thscode===stocks[i].code);const day=safeDate(p.data.timestamp);outputs[i].valuationAsOf=day;outputs[i].stock.valuationAsOf=day;if(day&&day>=asOf&&day<=today)outputs[i].stock.pe=Number.isFinite(row?.pe_ttm)?row.pe_ttm:null;else issues[i].push('扶摇估值过期或时点无法核验');}
 }).catch(e=>issues.forEach(list=>list.push('扶摇估值：'+e.message))):Promise.resolve();
 const industry=task.rules.some(r=>r.field==='industry')?fuyao(env,'/api/a-share-index/constituents/ths-index-list-by-stock',{thscode:stocks.map(s=>s.code).join(','),type:'industry'},fetcher).then(p=>{
  for(let i=0;i<stocks.length;i++){outputs[i].requests.push(p.request);const row=p.data.item.find(s=>s.thscode===stocks[i].code);outputs[i].stock.industry=(row?.index_list??[]).map(x=>x.name).join(', ');outputs[i].stock.sector=classifySector(outputs[i].stock.industry);if(!outputs[i].stock.industry)issues[i].push('扶摇行业字段缺失');}
 }).catch(e=>issues.forEach(list=>list.push('扶摇行业：'+e.message))):Promise.resolve();
 const financial=task.rules.some(r=>r.field==='profit')?Promise.all(stocks.map(async(s,i)=>{
  try{const p=await fuyao(env,'/api/a-share/financials/income-statements',{thscode:s.code,period:'quarterly',limit:8},fetcher);outputs[i].requests.push(p.request);outputs[i].stock.reports=p.data.item.map(r=>({period:safeDate(r.period_end_ms),disclosed:safeDate(r.report_date_ms),profit:r.parent_holder_net_profit,revenue:r.operating_income,currency:r.currency})).filter(r=>r.period&&r.disclosed&&r.disclosed<=today).sort((a,b)=>b.period.localeCompare(a.period));const last=outputs[i].stock.reports[0];if(!last||+new Date(today)-+new Date(last.period)>190*86400000){outputs[i].stock.reports=[];issues[i].push('扶摇财务数据过期或缺失');}}
  catch(e){issues[i].push('扶摇财务：'+e.message);}
 })):Promise.resolve();
 const notices=task.options.notices?(async()=>{
  let headers;try{headers=await noticeSession(env,fetcher);}catch(e){issues.forEach(list=>list.push('iFinD 公告：'+e.message));return;}
  const last=task.lastCheckAt?chinaDate(task.lastCheckAt):chinaDate(task.createdAt);
  const begin=shiftDay(last,-7);
  for(let i=0;i<stocks.length;i++){
   if(i)await new Promise(resolve=>setTimeout(resolve,550));
   try{const n=await fetchNotices(headers,stocks[i],begin,today,fetcher);outputs[i].notices=n.rows;outputs[i].noticesValid=true;outputs[i].requests.push(n.request);if(n.truncated)issues[i].push('iFinD 公告达到返回条数上限，可能不完整');}
   catch(e){issues[i].push('iFinD 公告：'+e.message);}
  }
 })():Promise.resolve();
 await Promise.all([prices,valuation,industry,financial,notices]);return outputs;
}

function classifySector(industry){
 const groups={'消费':/白酒|家电|食品|饮料|乳品|服装|家居|零售|养殖|旅游|酒店|免税|啤酒|农产品/,'金融':/银行|保险|证券|金融|期货/,'医药':/制药|药店|中药|生物制品|医疗|医药/,'新能源与汽车':/电池|光伏|风电|汽车|电机|电动车/,'科技':/计算机|半导体|消费电子|元件|通信|软件|IT服务|光学|电子|传媒|游戏/,'公用事业与资源':/电力|煤炭|油气|石油|化工|钢铁|有色|金属|水泥|燃气|公用/};
 return Object.entries(groups).find(([,pattern])=>pattern.test(industry))?.[0]??null;
}
