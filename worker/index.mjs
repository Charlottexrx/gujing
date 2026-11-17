import {sourceResponse} from './source.mjs';
import {interpret,MODEL} from './ai.mjs';
import {visitor,cronAuthorized,consume} from './access.mjs';
import {validateResearchProposal} from '../dist/research.mjs';
import { validateTask, nextDue, inspectStock } from './monitor.mjs';
import { liveBatch } from './providers.mjs';
import { findMetric } from '../dist/logic.mjs';
const assets=__ASSETS__;
const snapshot=JSON.parse(assets['/market-data.json']);
snapshot.tradingDays=[...new Set(snapshot.stocks.flatMap(s=>s.prices.map(p=>p[0])))].sort();
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const readTask=row=>row?{...JSON.parse(row.data),revision:row.revision}:null;
const publicTask=t=>{const {baseline,checkpoint,revision,...v}=t;return {...v,progress:checkpoint?{done:checkpoint.cursor,total:t.codes.length}:null};};
async function body(request){const raw=await request.text();if(raw.length>30000)throw new Error('请求内容过大');try{return JSON.parse(raw);}catch{throw new Error('请求内容无效');}}
async function getTask(db,id,who){return readTask(await db.prepare('SELECT * FROM monitor_tasks WHERE id = ? AND owner = ?').bind(id,who).first());}
async function persist(db,t,revision,release=true){
 const {revision:_,...value}=t;
 const res=await db.prepare('UPDATE monitor_tasks SET data = ?, revision = revision + 1, lease_until = ? WHERE id = ? AND revision = ?').bind(JSON.stringify(value),release?null:new Date(Date.now()+240000).toISOString(),t.id,revision).run();
 if(!res.meta.changes)throw new Error('任务正在其他窗口更新，请刷新');
 return {...value,revision:revision+1};
}
export async function checkTask(env,id,who=null){
 const now=new Date();const row=await env.DB.prepare('UPDATE monitor_tasks SET lease_until = ?, revision = revision + 1 WHERE id = ? AND (lease_until IS NULL OR lease_until < ?) RETURNING *').bind(new Date(+now+240000).toISOString(),id,now.toISOString()).first();
 if(!row)return {busy:true,message:'任务正在检查中，请稍后刷新'};
 let t=readTask(row);
 if((who&&row.owner!==who)||!t.enabled){await persist(env.DB,t,t.revision);return {skipped:true};}
 try{
  let work=t.checkpoint;
  if(!work)work={runId:crypto.randomUUID(),startedAt:now.toISOString(),cursor:0,rows:[],events:[],baseline:{...t.baseline}};
  const selected=t.codes.slice(work.cursor,work.cursor+5).map(code=>snapshot.stocks.find(s=>s.code===code));
  const observations=await liveBatch(env,t,selected,now);
  for(let i=0;i<selected.length;i++){
   const {row:detail,next}=inspectStock(t,selected[i],observations[i],work.baseline[selected[i].code]);
   work.rows.push(detail);work.events.push(...detail.events);work.baseline[selected[i].code]=next;
  }
  work.cursor+=selected.length;
  if(work.cursor<t.codes.length){t.status='checking';t.checkpoint=work;t=await persist(env.DB,t,t.revision);return {task:publicTask(t),more:true,remaining:true};}
  const checkedAt=new Date().toISOString();const missing=work.rows.filter(r=>!r.complete);
  const report={id:work.runId,taskId:t.id,taskName:t.name,startedAt:work.startedAt,checkedAt,status:missing.length?'missing':work.events.length?'attention':'ok',missingStocks:missing.length,events:work.events,stocks:work.rows};
  t={...t,checkpoint:null,baseline:work.baseline,lastCheckAt:checkedAt,lastSuccessAt:missing.length?t.lastSuccessAt:checkedAt,nextCheckAt:nextDue(t.schedule,checkedAt),status:report.status,lastReport:report};
  const {revision:_,...stored}=t;
  // One D1 transaction: report and state advance together. No silent partial success.
  const updated=await env.DB.batch([
   env.DB.prepare('INSERT INTO monitor_runs (id, task_id, owner, checked_at, data) VALUES (?, ?, ?, ?, ?)').bind(report.id,t.id,row.owner,checkedAt,JSON.stringify(report)),
   env.DB.prepare('UPDATE monitor_tasks SET data = ?, revision = revision + 1, lease_until = NULL WHERE id = ? AND revision = ?').bind(JSON.stringify(stored),id,t.revision),
  ]);
  if(!updated[1].meta.changes)throw new Error('任务状态写入冲突');
  return {task:publicTask(t),report,more:false,remaining:false};
 }catch(error){
  const checkedAt=new Date().toISOString();t.status='missing';t.lastCheckAt=checkedAt;t.nextCheckAt=nextDue(t.schedule,checkedAt);t.checkpoint=null;
  t.lastReport={id:crypto.randomUUID(),taskId:t.id,taskName:t.name,checkedAt,status:'missing',missingStocks:t.codes.length,events:[],stocks:[],issues:['本次检查未完成，数据不可用，请重试']};
  try{await persist(env.DB,t,t.revision);}catch{}
  return {task:publicTask(t),report:t.lastReport,error:'本次检查未完成，未生成正常结论',more:false};
 }
}
async function handle(request,env,who){
 const url=new URL(request.url);const path=url.pathname;
 if(path.startsWith('/source'))return sourceResponse(request);
 if(path.startsWith('/api/')){
  try{
   if(path==='/api/ai/status'&&request.method==='GET')return json({configured:Boolean(env.OPENAI_API_KEY),model:MODEL});
   if(!env.DB)return json({error:'监控存储暂时不可用，任务未保存'},503);
   if(request.method!=='GET'&&request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'请求来源不允许'},403);
   // Public pages never grant access to owner-wide background writes.
   if(['/api/monitoring/check-due','/api/monitoring/readiness'].includes(path)&&!await cronAuthorized(request,env))return json({error:'后台检查需要独立调度授权'},401);
   if(path==='/api/monitoring/instructions'&&request.method==='GET')return json({instructions:'POST /api/monitoring/check-due with {}. Repeat while remaining is true (at most 150 calls). If busy, report that another check is running. Do not republish or create tasks. Summarize each returned report: stock names and events; always report missing/expired data and API errors, never call it normal. If checked is 0 and remaining is false and no reports, say no tasks due; do not send a user notification for that. This public Site requires the server-side MONITOR_CRON_SECRET as a Bearer credential. The public website and Site access token alone do not authorize this endpoint. Do not place the secret in a prompt. Automatic checks require a secure scheduler binding; otherwise use each visitor-owned task check route.',timezone:'Asia/Shanghai',source:'扶摇行情/财务/行业/交易日历；iFinD公告语义检索',limit:'公告仅覆盖可检索记录，不保证全量；空响应按待核验处理。'});
   if(path==='/api/monitoring/check-due'&&request.method==='POST'){
    const tasks=(await env.DB.prepare('SELECT * FROM monitor_tasks').all()).results;
    const due=tasks.map(r=>({t:readTask(r),owner:r.owner})).filter(({t})=>t.enabled&&(t.checkpoint||t.nextCheckAt<=new Date().toISOString()));
    if(!due.length)return json({checked:0,remaining:false,reports:[]});
    const result=await checkTask(env,due[0].t.id);
    return json({...result,checked:result.report?1:0,remaining:result.busy?false:(!!result.more||due.length>1),reports:result.report?[result.report]:[]});
   }
   if(path==='/api/monitoring/readiness'&&request.method==='GET'){
    const row=await env.DB.prepare('SELECT data FROM monitor_runs WHERE owner = ? ORDER BY checked_at DESC LIMIT 1').bind('system-readiness').first();return json({report:row?JSON.parse(row.data):null});
   }
   if(path==='/api/monitoring/readiness'&&request.method==='POST'){
    const id=crypto.randomUUID(),now=new Date().toISOString(),s=snapshot.stocks.find(s=>s.code==='600519.SH');
    const t={id,name:'监控链路验收（非用户任务）',createdAt:now,enabled:true,status:'pending',codes:[s.code],rules:[{field:'pe',op:'lt',value:1000},{field:'profit',op:'gt',value:-100},{field:'industry',op:'eq',value:'消费'},{field:'gain',op:'gt',value:-100,days:20}],schedule:{time:'15:30',days:[1,2,3,4,5]},options:{volDays:20,volRise:50,notices:true},baseline:{[s.code]:{conditionStatus:'in',noticeKeys:[]}},nextCheckAt:'2099-01-01T00:00:00.000Z',lastSuccessAt:null};
    await env.DB.prepare('INSERT INTO monitor_tasks (id, owner, data, revision) VALUES (?, ?, ?, 0)').bind(id,'system-readiness',JSON.stringify(t)).run();
    const result=await checkTask(env,id,'system-readiness');
    await env.DB.prepare('DELETE FROM monitor_tasks WHERE id = ? AND owner = ?').bind(id,'system-readiness').run();
    return json(result);
   }
   if(!who)return json({error:'访客会话尚未配置，监控任务未保存'},503);
   if(path==='/api/ai/interpret'&&request.method==='POST'){if(env.OPENAI_API_KEY&&(!await consume(env.DB,'ai:'+who,20)||!await consume(env.DB,'ai-global',100)))return json({error:'今日AI体验额度已用完，可切换规则解析'},429);const value=await interpret(env,await body(request),snapshot);return json(value,value.error?503:200);}
   if(path==='/api/research/validate'&&request.method==='POST'){const proposal=await body(request);try{return json(validateResearchProposal(proposal,snapshot.stocks,snapshot));}catch(e){return json({error:e.message},422);}}
   if(path==='/api/monitoring/tasks'&&request.method==='GET'){
    const rows=(await env.DB.prepare('SELECT * FROM monitor_tasks WHERE owner = ?').bind(who).all()).results;
    return json({tasks:rows.map(r=>publicTask(readTask(r))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),timezone:'Asia/Shanghai'});
   }
   if(path==='/api/monitoring/tasks'&&request.method==='POST'){
    const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM monitor_tasks WHERE owner = ?').bind(who).first();if(count.n>=10)return json({error:'最多保存 10 个监控任务，请先删除旧任务'},400);
    if(!await consume(env.DB,'monitor-create-global',100))return json({error:'今日演示任务已达上限，请稍后重试'},429);
    const config=validateTask(await body(request),snapshot);const createdAt=new Date().toISOString();const baseline={};
    for(const code of config.codes){const s=snapshot.stocks.find(s=>s.code===code);const vol=findMetric(s,{field:'vol',days:config.options.volDays},snapshot);baseline[code]={conditionStatus:'in',vol:vol.value,volDate:snapshot.asOf,noticeKeys:[]};}
    const t={...config,id:crypto.randomUUID(),createdAt,enabled:true,status:'pending',lastCheckAt:null,lastSuccessAt:null,nextCheckAt:nextDue(config.schedule,createdAt),baseline,savedDataAsOf:snapshot.asOf,lastReport:null,checkpoint:null};
    await env.DB.prepare('INSERT INTO monitor_tasks (id, owner, data, revision) VALUES (?, ?, ?, 0)').bind(t.id,who,JSON.stringify(t)).run();return json({task:publicTask(t)},201);
   }
   const match=path.match(/^\/api\/monitoring\/tasks\/([a-f0-9-]+)(\/check)?$/);
   if(match){
    const t=await getTask(env.DB,match[1],who);if(!t)return json({error:'未找到这个监控任务'},404);
    if(match[2]&&request.method==='POST'){if(!await consume(env.DB,'monitor-check:'+who,12)||!await consume(env.DB,'monitor-check-global',200))return json({error:'今日检查额度已用完，请明天重试'},429);return json(await checkTask(env,t.id,who));}
    if(request.method==='PATCH'){
     const row=await env.DB.prepare('SELECT lease_until FROM monitor_tasks WHERE id = ? AND owner = ?').bind(t.id,who).first();if(row.lease_until&&row.lease_until>new Date().toISOString())return json({error:'任务正在检查，请完成后再修改'},409);
     const changes=await body(request);if(changes.name){if(typeof changes.name!=='string'||changes.name.length>60)throw new Error('任务名称无效');t.name=changes.name.trim();}if(typeof changes.enabled==='boolean')t.enabled=changes.enabled;
     if(changes.schedule){validateTask({...t,schedule:changes.schedule},snapshot);t.schedule=changes.schedule;}
     if(changes.options){validateTask({...t,options:changes.options},snapshot);if(changes.options.volDays!==t.options.volDays){for(const b of Object.values(t.baseline)){b.vol=null;b.volDate=null;}}t.options=changes.options;}
     t.nextCheckAt=nextDue(t.schedule,new Date());return json({task:publicTask(await persist(env.DB,t,t.revision))});
    }
    if(request.method==='DELETE'){
     const res=await env.DB.prepare('DELETE FROM monitor_tasks WHERE id = ? AND owner = ? AND (lease_until IS NULL OR lease_until < ?)').bind(t.id,who,new Date().toISOString()).run();if(!res.meta.changes)return json({error:'任务正在检查，请完成后再删除'},409);
     await env.DB.prepare('DELETE FROM monitor_runs WHERE task_id = ? AND owner = ?').bind(t.id,who).run();return json({deleted:true});
    }
   }
   return json({error:'接口不存在'},404);
  }catch(error){return json({error:error.message&&/请|只能|最多|任务|筛选条件|请求|波动|检查/.test(error.message)?error.message:'监控服务暂时不可用，未能读取或保存，请重试'},400);}
 }
 const key=path==='/'?'/index.html':path;
 if(!(key in assets))return new Response('Not found',{status:404});
 const type=key.endsWith('.html')?'text/html':key.endsWith('.css')?'text/css':key.endsWith('.json')?'application/json':'text/javascript';
 return new Response(assets[key],{headers:{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
}
export default {async fetch(request,env){const v=await visitor(request,env);const response=await handle(request,env,v.owner);if(!v.cookie)return response;const next=new Response(response.body,response);next.headers.set('Set-Cookie',v.cookie);return next;}};
